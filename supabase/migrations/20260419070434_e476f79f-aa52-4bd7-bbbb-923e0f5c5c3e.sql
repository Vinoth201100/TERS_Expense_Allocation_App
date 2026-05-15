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
  IF _from = _to THEN
    RAISE EXCEPTION 'Source and target auditor must differ';
  END IF;

  -- Move ALL lines, regardless of status (allocated, completed, issue, duplicate)
  UPDATE public.lines
  SET assigned_to = _to, updated_at = now()
  WHERE assigned_to = _from;

  GET DIAGNOSTICS moved_count = ROW_COUNT;

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'reassign_auditor', 'user', _from::text,
          'Reassigned all lines',
          jsonb_build_object('from', _from, 'to', _to, 'lines_moved', moved_count));

  RETURN moved_count;
END;
$$;