CREATE OR REPLACE FUNCTION public.reassign_auditor(_from uuid, _to uuid, _limit integer DEFAULT NULL)
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
  IF _limit IS NOT NULL AND _limit <= 0 THEN
    RAISE EXCEPTION 'Limit must be a positive number or null';
  END IF;

  IF _limit IS NULL THEN
    UPDATE public.lines
    SET assigned_to = _to, updated_at = now()
    WHERE assigned_to = _from;
  ELSE
    WITH picked AS (
      SELECT id FROM public.lines
      WHERE assigned_to = _from
      ORDER BY (status = 'allocated') DESC, allocated_date ASC NULLS LAST, created_at ASC
      LIMIT _limit
    )
    UPDATE public.lines l
    SET assigned_to = _to, updated_at = now()
    FROM picked
    WHERE l.id = picked.id;
  END IF;

  GET DIAGNOSTICS moved_count = ROW_COUNT;

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'reassign_auditor', 'user', _from::text,
          CASE WHEN _limit IS NULL THEN 'Reassigned all lines' ELSE format('Reassigned up to %s lines', _limit) END,
          jsonb_build_object('from', _from, 'to', _to, 'lines_moved', moved_count, 'limit', _limit));

  RETURN moved_count;
END;
$$;