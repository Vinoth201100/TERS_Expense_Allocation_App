-- 2. Lines table: add columns
ALTER TABLE public.lines
  ADD COLUMN IF NOT EXISTS allocated_date date,
  ADD COLUMN IF NOT EXISTS audit_status text NOT NULL DEFAULT 'Audited',
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by uuid;

-- Backfill allocated_date from batches.upload_date
UPDATE public.lines l
SET allocated_date = b.upload_date
FROM public.batches b
WHERE l.batch_id = b.id AND l.allocated_date IS NULL;

-- Default future inserts: trigger to set allocated_date from batch
CREATE OR REPLACE FUNCTION public.set_allocated_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.allocated_date IS NULL THEN
    SELECT upload_date INTO NEW.allocated_date FROM public.batches WHERE id = NEW.batch_id;
    IF NEW.allocated_date IS NULL THEN
      NEW.allocated_date := CURRENT_DATE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_allocated_date ON public.lines;
CREATE TRIGGER trg_set_allocated_date
  BEFORE INSERT ON public.lines
  FOR EACH ROW
  EXECUTE FUNCTION public.set_allocated_date();

-- Indexes for paging
CREATE INDEX IF NOT EXISTS idx_lines_status_allocated_date ON public.lines (status, allocated_date DESC);
CREATE INDEX IF NOT EXISTS idx_lines_published_at ON public.lines (published_at DESC) WHERE published_at IS NOT NULL;

-- 3. issue_feedback table
CREATE TABLE IF NOT EXISTS public.issue_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES public.lines(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  author_role public.app_role NOT NULL,
  comment text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issue_feedback_line ON public.issue_feedback (line_id, created_at DESC);

ALTER TABLE public.issue_feedback ENABLE ROW LEVEL SECURITY;

-- Anyone with a privileged role OR the assigned auditor can read feedback
CREATE POLICY "Privileged and assigned can view feedback"
ON public.issue_feedback FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'team_lead')
  OR public.has_role(auth.uid(), 'approved_auditor')
  OR EXISTS (SELECT 1 FROM public.lines l WHERE l.id = line_id AND l.assigned_to = auth.uid())
);

-- Privileged roles can post feedback
CREATE POLICY "Privileged can post feedback"
ON public.issue_feedback FOR INSERT
TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'team_lead')
    OR public.has_role(auth.uid(), 'approved_auditor')
  )
);

-- 4. Attendance: leave_type + Sunday freeze trigger
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS leave_type text;

ALTER TABLE public.attendance
  DROP CONSTRAINT IF EXISTS attendance_leave_type_check;
ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_leave_type_check
  CHECK (leave_type IS NULL OR leave_type IN ('emergency','sick','planned','optional'));

CREATE OR REPLACE FUNCTION public.block_sunday_attendance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXTRACT(DOW FROM NEW.date) = 0 THEN
    RAISE EXCEPTION 'Sunday attendance is frozen';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_sunday_attendance ON public.attendance;
CREATE TRIGGER trg_block_sunday_attendance
  BEFORE INSERT OR UPDATE ON public.attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.block_sunday_attendance();

-- 5. Freeze rule: tighten lines UPDATE policy (auditor same-day only; admin bypass)
DROP POLICY IF EXISTS "Auditors update assigned lines, admins all" ON public.lines;
CREATE POLICY "Auditors update assigned lines, admins all"
ON public.lines FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (
    assigned_to = auth.uid()
    AND (qc_completed_at IS NULL OR qc_completed_at::date = CURRENT_DATE)
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR (
    assigned_to = auth.uid()
    AND (qc_completed_at IS NULL OR qc_completed_at::date = CURRENT_DATE)
  )
);

-- Allow team_lead and approved_auditor to view all lines
DROP POLICY IF EXISTS "Auditors view assigned lines, admins all" ON public.lines;
CREATE POLICY "Lines view policy"
ON public.lines FOR SELECT
TO authenticated
USING (
  assigned_to = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'team_lead')
  OR public.has_role(auth.uid(), 'approved_auditor')
);

-- 6. reassign_auditor RPC (admin only)
CREATE OR REPLACE FUNCTION public.reassign_auditor(_from uuid, _to uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  moved_count integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can reassign auditors';
  END IF;

  UPDATE public.lines
  SET assigned_to = _to, updated_at = now()
  WHERE assigned_to = _from AND status = 'allocated';

  GET DIAGNOSTICS moved_count = ROW_COUNT;
  RETURN moved_count;
END;
$$;

-- 7. Realtime
ALTER TABLE public.lines REPLICA IDENTITY FULL;
ALTER TABLE public.issue_feedback REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'lines'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.lines';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'issue_feedback'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.issue_feedback';
  END IF;
END $$;