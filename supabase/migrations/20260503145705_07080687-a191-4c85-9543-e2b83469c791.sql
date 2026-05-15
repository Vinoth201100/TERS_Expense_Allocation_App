CREATE OR REPLACE FUNCTION public.publish_issues_to_aa_by_approved_by(_line_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  routed integer := 0;
  unmatched integer := 0;
  rec record;
  target_aa uuid;
  unmatched_names text[] := ARRAY[]::text[];
  approver_norm text;
  approver_local text;
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
    approver_norm := lower(trim(COALESCE(rec.approved_by, '')));
    approver_local := split_part(approver_norm, '@', 1);

    IF length(approver_norm) > 0 THEN
      -- Exact email match
      SELECT p.user_id INTO target_aa
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'approved_auditor'
      WHERE lower(trim(p.email)) = approver_norm
      ORDER BY p.created_at ASC LIMIT 1;

      -- Exact full_name match
      IF target_aa IS NULL THEN
        SELECT p.user_id INTO target_aa
        FROM public.profiles p
        JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'approved_auditor'
        WHERE lower(trim(p.full_name)) = approver_norm
        ORDER BY p.created_at ASC LIMIT 1;
      END IF;

      -- Match approver email local-part to profile email local-part
      IF target_aa IS NULL AND length(approver_local) > 0 THEN
        SELECT p.user_id INTO target_aa
        FROM public.profiles p
        JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'approved_auditor'
        WHERE lower(split_part(p.email, '@', 1)) = approver_local
        ORDER BY p.created_at ASC LIMIT 1;
      END IF;

      -- Fuzzy contains on full_name
      IF target_aa IS NULL THEN
        SELECT p.user_id INTO target_aa
        FROM public.profiles p
        JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'approved_auditor'
        WHERE (length(trim(p.full_name)) > 0 AND (
              lower(trim(p.full_name)) ILIKE '%' || approver_norm || '%'
           OR approver_norm ILIKE '%' || lower(trim(p.full_name)) || '%'
        ))
        ORDER BY length(p.full_name) ASC LIMIT 1;
      END IF;

      -- Fuzzy contains on email local-part
      IF target_aa IS NULL AND length(approver_local) > 0 THEN
        SELECT p.user_id INTO target_aa
        FROM public.profiles p
        JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'approved_auditor'
        WHERE lower(split_part(p.email, '@', 1)) ILIKE '%' || approver_local || '%'
           OR approver_local ILIKE '%' || lower(split_part(p.email, '@', 1)) || '%'
        ORDER BY length(p.email) ASC LIMIT 1;
      END IF;
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
$function$;