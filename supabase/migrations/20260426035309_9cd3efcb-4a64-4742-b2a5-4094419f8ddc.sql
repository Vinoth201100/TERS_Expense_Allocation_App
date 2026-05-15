CREATE OR REPLACE FUNCTION public.publish_issues_to_aa_user(_line_ids uuid[], _aa_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  routed integer := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
       OR public.has_role(auth.uid(), 'team_lead')
       OR public.has_role(auth.uid(), 'auditor')
       OR public.has_role(auth.uid(), 'approved_auditor')) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  IF _aa_user_id IS NULL THEN
    RAISE EXCEPTION 'An Approved Auditor must be selected';
  END IF;

  IF NOT public.has_role(_aa_user_id, 'approved_auditor') THEN
    RAISE EXCEPTION 'Selected user is not an Approved Auditor';
  END IF;

  UPDATE public.lines
  SET aa_assigned_to = _aa_user_id,
      aa_status = 'allocated',
      aa_allocated_at = now(),
      aa_published_by = auth.uid(),
      updated_at = now()
  WHERE id = ANY(_line_ids)
    AND status = 'issue'
    AND aa_assigned_to IS NULL;

  GET DIAGNOSTICS routed = ROW_COUNT;

  RETURN jsonb_build_object('routed', routed);
END;
$function$;