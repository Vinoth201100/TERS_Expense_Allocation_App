-- 1. Branch-code mapping for Approved Auditors
CREATE TABLE IF NOT EXISTS public.aa_branch_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approved_auditor_id uuid NOT NULL,
  branch_code text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (approved_auditor_id, branch_code)
);

CREATE INDEX IF NOT EXISTS idx_aa_branch_codes_branch ON public.aa_branch_codes(branch_code);
CREATE INDEX IF NOT EXISTS idx_aa_branch_codes_aa ON public.aa_branch_codes(approved_auditor_id);

ALTER TABLE public.aa_branch_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage aa branch codes"
ON public.aa_branch_codes FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Team leads manage aa branch codes"
ON public.aa_branch_codes FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'team_lead'))
WITH CHECK (public.has_role(auth.uid(), 'team_lead'));

CREATE POLICY "AA view own branch codes"
ON public.aa_branch_codes FOR SELECT TO authenticated
USING (approved_auditor_id = auth.uid()
       OR public.has_role(auth.uid(), 'admin')
       OR public.has_role(auth.uid(), 'team_lead'));

-- 2. AA status enum
DO $$ BEGIN
  CREATE TYPE public.aa_status AS ENUM ('allocated','approved','rejected','escalated','exception');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. AA workflow fields on lines
ALTER TABLE public.lines
  ADD COLUMN IF NOT EXISTS aa_assigned_to uuid,
  ADD COLUMN IF NOT EXISTS aa_status public.aa_status,
  ADD COLUMN IF NOT EXISTS aa_allocated_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS aa_decision_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS aa_decision_by uuid,
  ADD COLUMN IF NOT EXISTS aa_comment text,
  ADD COLUMN IF NOT EXISTS aa_published_by uuid;

CREATE INDEX IF NOT EXISTS idx_lines_aa_assigned ON public.lines(aa_assigned_to) WHERE aa_assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lines_aa_status ON public.lines(aa_status) WHERE aa_status IS NOT NULL;

-- 4. Update RLS so AAs can view their assigned lines
DROP POLICY IF EXISTS "Lines view policy" ON public.lines;
CREATE POLICY "Lines view policy"
ON public.lines FOR SELECT TO authenticated
USING (
  assigned_to = auth.uid()
  OR aa_assigned_to = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR (public.has_role(auth.uid(), 'team_lead') AND assigned_to IS NOT NULL AND public.is_my_reporting_auditor(assigned_to))
  OR (public.has_role(auth.uid(), 'team_lead') AND aa_assigned_to IS NOT NULL AND public.is_my_reporting_auditor(aa_assigned_to))
  OR (public.has_role(auth.uid(), 'approved_auditor') AND assigned_to IS NOT NULL AND public.is_my_reporting_auditor(assigned_to))
);

-- Allow AA to update aa_* fields on their own assigned lines
DROP POLICY IF EXISTS "AA updates own assigned lines" ON public.lines;
CREATE POLICY "AA updates own assigned lines"
ON public.lines FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'approved_auditor')
  AND aa_assigned_to = auth.uid()
)
WITH CHECK (
  public.has_role(auth.uid(), 'approved_auditor')
  AND aa_assigned_to = auth.uid()
);

-- 5. Publish-to-AA function
CREATE OR REPLACE FUNCTION public.publish_issues_to_aa(_line_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  routed integer := 0;
  unmatched integer := 0;
  rec record;
  target_aa uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
       OR public.has_role(auth.uid(), 'team_lead')
       OR public.has_role(auth.uid(), 'auditor')
       OR public.has_role(auth.uid(), 'approved_auditor')) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  FOR rec IN
    SELECT id, branch FROM public.lines
    WHERE id = ANY(_line_ids)
      AND status = 'issue'
      AND aa_assigned_to IS NULL
  LOOP
    target_aa := NULL;
    IF rec.branch IS NOT NULL THEN
      SELECT approved_auditor_id INTO target_aa
      FROM public.aa_branch_codes
      WHERE lower(trim(branch_code)) = lower(trim(rec.branch))
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;

    IF target_aa IS NOT NULL THEN
      UPDATE public.lines
      SET aa_assigned_to = target_aa,
          aa_status = 'allocated',
          aa_allocated_at = now(),
          aa_published_by = auth.uid(),
          updated_at = now()
      WHERE id = rec.id;
      routed := routed + 1;
    ELSE
      unmatched := unmatched + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('routed', routed, 'unmatched', unmatched);
END;
$$;