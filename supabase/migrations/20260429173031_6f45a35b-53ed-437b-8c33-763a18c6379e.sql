-- 1) New EA-review columns on lines
ALTER TABLE public.lines
  ADD COLUMN IF NOT EXISTS aa_review_agree boolean,
  ADD COLUMN IF NOT EXISTS aa_review_comment text;

-- 2) Tighten EA + TL update policies so locked rows can't be edited.
--    A row is "locked" once EA has submitted (aa_decision_at IS NOT NULL)
--    AND TL has submitted (leads_feedback_at IS NOT NULL).
DROP POLICY IF EXISTS "AA updates own assigned lines" ON public.lines;
CREATE POLICY "AA updates own assigned lines"
ON public.lines
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'approved_auditor')
  AND aa_assigned_to = auth.uid()
  AND NOT (aa_decision_at IS NOT NULL AND leads_feedback_at IS NOT NULL)
)
WITH CHECK (
  public.has_role(auth.uid(), 'approved_auditor')
  AND aa_assigned_to = auth.uid()
);

DROP POLICY IF EXISTS "Reviewers update leads feedback" ON public.lines;
CREATE POLICY "Reviewers update leads feedback"
ON public.lines
FOR UPDATE
TO authenticated
USING (
  (public.has_role(auth.uid(), 'team_lead') OR public.has_role(auth.uid(), 'approved_auditor'))
  AND NOT (aa_decision_at IS NOT NULL AND leads_feedback_at IS NOT NULL)
)
WITH CHECK (
  public.has_role(auth.uid(), 'team_lead') OR public.has_role(auth.uid(), 'approved_auditor')
);

-- 3) RPC: publish issue lines to EA by matching `approved_by` -> profile full_name -> approved_auditor
CREATE OR REPLACE FUNCTION public.publish_issues_to_aa_by_approved_by(_line_ids uuid[])
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
  unmatched_names text[] := ARRAY[]::text[];
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'team_lead')
    OR public.has_role(auth.uid(), 'auditor')
    OR public.has_role(auth.uid(), 'approved_auditor')
  ) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  FOR rec IN
    SELECT id, approved_by
    FROM public.lines
    WHERE id = ANY(_line_ids)
      AND status = 'issue'
      AND aa_assigned_to IS NULL
  LOOP
    target_aa := NULL;

    IF rec.approved_by IS NOT NULL AND length(trim(rec.approved_by)) > 0 THEN
      SELECT p.user_id
        INTO target_aa
      FROM public.profiles p
      JOIN public.user_roles ur
        ON ur.user_id = p.user_id AND ur.role = 'approved_auditor'
      WHERE lower(trim(p.full_name)) = lower(trim(rec.approved_by))
      ORDER BY p.created_at ASC
      LIMIT 1;
    END IF;

    IF target_aa IS NOT NULL THEN
      UPDATE public.lines
      SET aa_assigned_to    = target_aa,
          aa_status         = 'allocated',
          aa_allocated_at   = now(),
          aa_published_by   = auth.uid(),
          published_at      = COALESCE(published_at, now()),
          published_by      = COALESCE(published_by, auth.uid()),
          updated_at        = now()
      WHERE id = rec.id;
      routed := routed + 1;
    ELSE
      unmatched := unmatched + 1;
      IF rec.approved_by IS NOT NULL THEN
        unmatched_names := unmatched_names || rec.approved_by;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'routed', routed,
    'unmatched', unmatched,
    'unmatched_approvers', (
      SELECT COALESCE(jsonb_agg(DISTINCT n), '[]'::jsonb)
      FROM unnest(unmatched_names) AS n
    )
  );
END;
$$;