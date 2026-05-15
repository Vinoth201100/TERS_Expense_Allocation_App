-- 1. Audit log table
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view audit log"
ON public.admin_audit_log FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert audit log"
ON public.admin_audit_log FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin') AND actor_id = auth.uid());

CREATE INDEX idx_admin_audit_log_created ON public.admin_audit_log(created_at DESC);

-- 2. Force-unlock a completed line (clears qc_completed_at)
CREATE OR REPLACE FUNCTION public.admin_force_unlock_line(_line_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can unlock lines';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  UPDATE public.lines
  SET qc_completed_at = NULL,
      status = 'allocated',
      updated_at = now()
  WHERE id = _line_id;

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason)
  VALUES (auth.uid(), 'unlock_line', 'line', _line_id::text, _reason);
END;
$$;

-- 3. Hard delete a line
CREATE OR REPLACE FUNCTION public.admin_delete_line(_line_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can delete lines';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  DELETE FROM public.lines WHERE id = _line_id;

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason)
  VALUES (auth.uid(), 'delete_line', 'line', _line_id::text, _reason);
END;
$$;

-- 4. Delete a batch and cascade its lines
CREATE OR REPLACE FUNCTION public.admin_delete_batch(_batch_id uuid, _reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
  fname text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can delete batches';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT filename INTO fname FROM public.batches WHERE id = _batch_id;

  DELETE FROM public.lines WHERE batch_id = _batch_id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  DELETE FROM public.batches WHERE id = _batch_id;

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'delete_batch', 'batch', _batch_id::text, _reason,
          jsonb_build_object('filename', fname, 'lines_removed', removed));

  RETURN removed;
END;
$$;

-- 5. Reallocate an entire batch's pending lines to one auditor
CREATE OR REPLACE FUNCTION public.admin_reallocate_batch(_batch_id uuid, _to uuid, _reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  moved integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can reallocate batches';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  UPDATE public.lines
  SET assigned_to = _to, updated_at = now()
  WHERE batch_id = _batch_id AND status = 'allocated';
  GET DIAGNOSTICS moved = ROW_COUNT;

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'reallocate_batch', 'batch', _batch_id::text, _reason,
          jsonb_build_object('to', _to, 'lines_moved', moved));

  RETURN moved;
END;
$$;

-- 6. Log helper for actions performed via direct SQL (role grants, user mgmt via edge function)
CREATE OR REPLACE FUNCTION public.admin_log_action(_action text, _target_type text, _target_id text, _reason text, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can log';
  END IF;
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), _action, _target_type, _target_id, COALESCE(_reason, ''), COALESCE(_metadata, '{}'::jsonb));
END;
$$;