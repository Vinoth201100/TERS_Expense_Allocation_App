-- EA daily allocation: separate batches + lines tables, status enum, RPCs, RLS

-- 1) Status enum for EA daily expense decisions
DO $$ BEGIN
  CREATE TYPE public.ea_daily_status AS ENUM ('allocated','approved','rejected','exception','escalated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) EA batches (separate upload stream from QA)
CREATE TABLE IF NOT EXISTS public.ea_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  filename text NOT NULL,
  sharepoint_url text,
  uploaded_by uuid NOT NULL,
  upload_date date NOT NULL DEFAULT CURRENT_DATE,
  total_lines integer NOT NULL DEFAULT 0,
  total_branches integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'allocated',
  allocation_mode text NOT NULL DEFAULT 'auto',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ea_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated view ea_batches" ON public.ea_batches
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage ea_batches" ON public.ea_batches
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "TLs create ea_batches" ON public.ea_batches
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'team_lead') AND uploaded_by = auth.uid());

-- 3) EA daily lines
CREATE TABLE IF NOT EXISTS public.ea_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES public.ea_batches(id) ON DELETE CASCADE,
  assigned_ea uuid,
  status public.ea_daily_status NOT NULL DEFAULT 'allocated',
  branch text,
  expense_number text,
  employee text,
  user_id_field text,
  date_submitted date,
  category text,
  amount numeric,
  currency text,
  project text,
  merchant text,
  approved_by text,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  allocated_date date,
  decided_at timestamptz,
  decision_comment text,
  rejected_reason text,
  exception_hold_comment text,
  followup_1_date date,
  followup_2_date date,
  followup_3_date date,
  final_decision text,
  escalated_comment text,
  escalated_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ea_lines_assigned_ea_idx ON public.ea_lines(assigned_ea);
CREATE INDEX IF NOT EXISTS ea_lines_batch_idx ON public.ea_lines(batch_id);
CREATE INDEX IF NOT EXISTS ea_lines_status_idx ON public.ea_lines(status);
CREATE INDEX IF NOT EXISTS ea_lines_branch_idx ON public.ea_lines(branch);

ALTER TABLE public.ea_lines ENABLE ROW LEVEL SECURITY;

-- View: EA sees own; TL sees their EAs; admin sees all
CREATE POLICY "EA lines view" ON public.ea_lines
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR assigned_ea = auth.uid()
    OR (public.has_role(auth.uid(), 'team_lead') AND assigned_ea IS NOT NULL AND public.is_my_reporting_auditor(assigned_ea))
  );

-- Insert: admin + TL who uploaded the batch
CREATE POLICY "Admins insert ea_lines" ON public.ea_lines
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "TLs insert ea_lines for own batches" ON public.ea_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'team_lead')
    AND EXISTS (SELECT 1 FROM public.ea_batches b WHERE b.id = ea_lines.batch_id AND b.uploaded_by = auth.uid())
  );

-- Update: assigned EA can update own; admin all; TL can update own EAs' lines
CREATE POLICY "EA updates own ea_lines" ON public.ea_lines
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'approved_auditor') AND assigned_ea = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'approved_auditor') AND assigned_ea = auth.uid());

CREATE POLICY "Admins update ea_lines" ON public.ea_lines
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "TLs update their EAs ea_lines" ON public.ea_lines
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'team_lead') AND assigned_ea IS NOT NULL AND public.is_my_reporting_auditor(assigned_ea))
  WITH CHECK (public.has_role(auth.uid(), 'team_lead') AND assigned_ea IS NOT NULL AND public.is_my_reporting_auditor(assigned_ea));

CREATE POLICY "Admins delete ea_lines" ON public.ea_lines
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- updated_at trigger
DROP TRIGGER IF EXISTS ea_lines_updated_at ON public.ea_lines;
CREATE TRIGGER ea_lines_updated_at BEFORE UPDATE ON public.ea_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- allocated_date defaulting trigger
CREATE OR REPLACE FUNCTION public.set_ea_allocated_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.allocated_date IS NULL THEN
    SELECT upload_date INTO NEW.allocated_date FROM public.ea_batches WHERE id = NEW.batch_id;
    IF NEW.allocated_date IS NULL THEN NEW.allocated_date := CURRENT_DATE; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ea_lines_set_allocated ON public.ea_lines;
CREATE TRIGGER ea_lines_set_allocated BEFORE INSERT ON public.ea_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_ea_allocated_date();

-- 4) RPC: allocate EA batch by branch, even-split across mapped + present EAs
CREATE OR REPLACE FUNCTION public.allocate_ea_batch(_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_assigned integer := 0;
  unassigned integer := 0;
  br record;
  ea_ids uuid[];
  line_rec record;
  i integer;
  n integer;
  branches_seen integer := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team_lead')) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  FOR br IN
    SELECT DISTINCT branch FROM public.ea_lines
    WHERE batch_id = _batch_id AND assigned_ea IS NULL
  LOOP
    branches_seen := branches_seen + 1;
    -- Pick EAs mapped to this branch who are present today (or have no attendance row = treat as present)
    SELECT array_agg(DISTINCT bc.approved_auditor_id) INTO ea_ids
    FROM public.aa_branch_codes bc
    WHERE br.branch IS NOT NULL
      AND lower(trim(bc.branch_code)) = lower(trim(br.branch))
      AND public.has_role(bc.approved_auditor_id, 'approved_auditor')
      AND NOT EXISTS (
        SELECT 1 FROM public.attendance a
        WHERE a.user_id = bc.approved_auditor_id
          AND a.date = CURRENT_DATE
          AND a.present = false
      );

    IF ea_ids IS NULL OR array_length(ea_ids,1) = 0 THEN
      SELECT count(*) INTO n FROM public.ea_lines WHERE batch_id = _batch_id AND assigned_ea IS NULL AND branch IS NOT DISTINCT FROM br.branch;
      unassigned := unassigned + n;
      CONTINUE;
    END IF;

    n := array_length(ea_ids, 1);
    i := 0;
    FOR line_rec IN
      SELECT id FROM public.ea_lines
      WHERE batch_id = _batch_id AND assigned_ea IS NULL AND branch IS NOT DISTINCT FROM br.branch
      ORDER BY created_at
    LOOP
      UPDATE public.ea_lines
      SET assigned_ea = ea_ids[(i % n) + 1], updated_at = now()
      WHERE id = line_rec.id;
      i := i + 1;
      total_assigned := total_assigned + 1;
    END LOOP;
  END LOOP;

  UPDATE public.ea_batches SET total_branches = branches_seen WHERE id = _batch_id;

  RETURN jsonb_build_object('assigned', total_assigned, 'unassigned', unassigned, 'branches', branches_seen);
END;
$$;

-- 5) RPC: fix QA auto-allocation — round-robin unassigned QA lines across active QA auditors present today
CREATE OR REPLACE FUNCTION public.allocate_qa_batch(_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ea_ids uuid[];
  line_rec record;
  i integer := 0;
  n integer;
  total integer := 0;
  uploader uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team_lead')) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  SELECT uploaded_by INTO uploader FROM public.batches WHERE id = _batch_id;
  IF uploader IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;

  -- QA auditors mapped under the uploader TL, present today (no false attendance row)
  SELECT array_agg(DISTINCT m.auditor_id) INTO ea_ids
  FROM public.auditor_team_leads m
  WHERE m.team_lead_id = uploader
    AND public.has_role(m.auditor_id, 'auditor')
    AND NOT EXISTS (
      SELECT 1 FROM public.attendance a
      WHERE a.user_id = m.auditor_id AND a.date = CURRENT_DATE AND a.present = false
    );

  IF ea_ids IS NULL OR array_length(ea_ids,1) = 0 THEN
    RETURN jsonb_build_object('assigned', 0, 'reason', 'no active QA auditors mapped to this TL');
  END IF;

  n := array_length(ea_ids, 1);

  FOR line_rec IN
    SELECT id FROM public.lines
    WHERE batch_id = _batch_id AND assigned_to IS NULL AND status = 'allocated'
    ORDER BY created_at
  LOOP
    UPDATE public.lines
    SET assigned_to = ea_ids[(i % n) + 1], updated_at = now()
    WHERE id = line_rec.id;
    i := i + 1;
    total := total + 1;
  END LOOP;

  RETURN jsonb_build_object('assigned', total, 'auditors', n);
END;
$$;

-- 6) RPC: EA decision (records status + decision fields atomically)
CREATE OR REPLACE FUNCTION public.ea_set_decision(
  _line_id uuid,
  _status public.ea_daily_status,
  _comment text DEFAULT NULL,
  _rejected_reason text DEFAULT NULL,
  _exception_hold_comment text DEFAULT NULL,
  _followup_1 date DEFAULT NULL,
  _followup_2 date DEFAULT NULL,
  _followup_3 date DEFAULT NULL,
  _final_decision text DEFAULT NULL,
  _escalated_comment text DEFAULT NULL,
  _escalated_date date DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.ea_lines WHERE id = _line_id AND assigned_ea = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  UPDATE public.ea_lines SET
    status = _status,
    decision_comment = COALESCE(_comment, decision_comment),
    rejected_reason = CASE WHEN _status = 'rejected' THEN COALESCE(_rejected_reason, rejected_reason) ELSE rejected_reason END,
    exception_hold_comment = CASE WHEN _status = 'exception' THEN COALESCE(_exception_hold_comment, exception_hold_comment) ELSE exception_hold_comment END,
    followup_1_date = CASE WHEN _status = 'exception' THEN COALESCE(_followup_1, followup_1_date) ELSE followup_1_date END,
    followup_2_date = CASE WHEN _status = 'exception' THEN COALESCE(_followup_2, followup_2_date) ELSE followup_2_date END,
    followup_3_date = CASE WHEN _status = 'exception' THEN COALESCE(_followup_3, followup_3_date) ELSE followup_3_date END,
    final_decision = CASE WHEN _status = 'exception' THEN COALESCE(_final_decision, final_decision) ELSE final_decision END,
    escalated_comment = CASE WHEN _status = 'escalated' THEN COALESCE(_escalated_comment, escalated_comment) ELSE escalated_comment END,
    escalated_date = CASE WHEN _status = 'escalated' THEN COALESCE(_escalated_date, escalated_date) ELSE escalated_date END,
    decided_at = now(),
    updated_at = now()
  WHERE id = _line_id;
END;
$$;