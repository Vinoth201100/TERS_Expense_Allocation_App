-- 1) Auditor ↔ Team Lead mapping
CREATE TABLE public.auditor_team_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auditor_id uuid NOT NULL UNIQUE,
  team_lead_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.auditor_team_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage mappings"
ON public.auditor_team_leads
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users view relevant mappings"
ON public.auditor_team_leads
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR auditor_id = auth.uid()
  OR team_lead_id = auth.uid()
);

CREATE TRIGGER trg_auditor_team_leads_updated
BEFORE UPDATE ON public.auditor_team_leads
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helper: get team lead for an auditor
CREATE OR REPLACE FUNCTION public.get_team_lead_for(_auditor uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT team_lead_id FROM public.auditor_team_leads WHERE auditor_id = _auditor LIMIT 1;
$$;

-- 2) Batch delete approval requests
CREATE TYPE public.delete_request_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE public.batch_delete_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  status public.delete_request_status NOT NULL DEFAULT 'pending',
  reviewer_id uuid,
  reviewed_at timestamptz,
  decision_reason text,
  assigned_team_lead uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bdr_batch ON public.batch_delete_requests(batch_id);
CREATE INDEX idx_bdr_status ON public.batch_delete_requests(status);
CREATE INDEX idx_bdr_tl ON public.batch_delete_requests(assigned_team_lead);

ALTER TABLE public.batch_delete_requests ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_bdr_updated
BEFORE UPDATE ON public.batch_delete_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "View delete requests"
ON public.batch_delete_requests
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR requested_by = auth.uid()
  OR assigned_team_lead = auth.uid()
  OR (
    public.has_role(auth.uid(), 'team_lead')
    AND EXISTS (
      SELECT 1 FROM public.lines l
      JOIN public.auditor_team_leads m ON m.auditor_id = l.assigned_to
      WHERE l.batch_id = batch_delete_requests.batch_id
        AND m.team_lead_id = auth.uid()
    )
  )
);

-- All writes must go through SECURITY DEFINER RPCs
CREATE POLICY "No direct insert"
ON public.batch_delete_requests
FOR INSERT TO authenticated
WITH CHECK (false);

-- 3) RPCs
CREATE OR REPLACE FUNCTION public.request_batch_deletion(_batch_id uuid, _reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  req_id uuid;
  tl uuid;
  any_auditor uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
       OR public.has_role(auth.uid(), 'auditor')
       OR public.has_role(auth.uid(), 'approved_auditor')
       OR public.has_role(auth.uid(), 'team_lead')) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.batch_delete_requests
             WHERE batch_id = _batch_id AND status = 'pending') THEN
    RAISE EXCEPTION 'A pending delete request already exists for this batch';
  END IF;

  -- Pick a team lead from the requester's mapping, else from any auditor in the batch
  SELECT public.get_team_lead_for(auth.uid()) INTO tl;
  IF tl IS NULL THEN
    SELECT l.assigned_to INTO any_auditor
    FROM public.lines l
    WHERE l.batch_id = _batch_id AND l.assigned_to IS NOT NULL
    LIMIT 1;
    IF any_auditor IS NOT NULL THEN
      SELECT public.get_team_lead_for(any_auditor) INTO tl;
    END IF;
  END IF;

  INSERT INTO public.batch_delete_requests
    (batch_id, requested_by, reason, assigned_team_lead)
  VALUES (_batch_id, auth.uid(), _reason, tl)
  RETURNING id INTO req_id;

  RETURN req_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_batch_deletion(_request_id uuid, _decision_reason text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
  removed integer;
BEGIN
  SELECT * INTO r FROM public.batch_delete_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Request already %', r.status; END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'team_lead')
        AND (r.assigned_team_lead = auth.uid()
             OR EXISTS (SELECT 1 FROM public.lines l
                        JOIN public.auditor_team_leads m ON m.auditor_id = l.assigned_to
                        WHERE l.batch_id = r.batch_id AND m.team_lead_id = auth.uid())))
  ) THEN
    RAISE EXCEPTION 'Not allowed to approve this request';
  END IF;

  DELETE FROM public.lines WHERE batch_id = r.batch_id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  DELETE FROM public.batches WHERE id = r.batch_id;

  UPDATE public.batch_delete_requests
  SET status = 'approved',
      reviewer_id = auth.uid(),
      reviewed_at = now(),
      decision_reason = _decision_reason
  WHERE id = _request_id;

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'approve_batch_deletion', 'batch', r.batch_id::text,
          COALESCE(_decision_reason, ''),
          jsonb_build_object('request_id', _request_id, 'lines_removed', removed,
                             'requested_by', r.requested_by));
  RETURN removed;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_batch_deletion(_request_id uuid, _decision_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r record;
BEGIN
  IF _decision_reason IS NULL OR length(trim(_decision_reason)) < 3 THEN
    RAISE EXCEPTION 'A decision reason is required';
  END IF;
  SELECT * INTO r FROM public.batch_delete_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Request already %', r.status; END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'team_lead')
        AND (r.assigned_team_lead = auth.uid()
             OR EXISTS (SELECT 1 FROM public.lines l
                        JOIN public.auditor_team_leads m ON m.auditor_id = l.assigned_to
                        WHERE l.batch_id = r.batch_id AND m.team_lead_id = auth.uid())))
  ) THEN
    RAISE EXCEPTION 'Not allowed to reject this request';
  END IF;

  UPDATE public.batch_delete_requests
  SET status = 'rejected',
      reviewer_id = auth.uid(),
      reviewed_at = now(),
      decision_reason = _decision_reason
  WHERE id = _request_id;

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'reject_batch_deletion', 'batch', r.batch_id::text, _decision_reason,
          jsonb_build_object('request_id', _request_id, 'requested_by', r.requested_by));
END;
$$;
