-- Rename role enum value approved_auditor -> expense_auditor
ALTER TYPE public.app_role RENAME VALUE 'approved_auditor' TO 'expense_auditor';

-- Recreate functions that reference the old literal
CREATE OR REPLACE FUNCTION public.request_batch_deletion(_batch_id uuid, _reason text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  req_id uuid; tl uuid; any_auditor uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
       OR public.has_role(auth.uid(), 'auditor')
       OR public.has_role(auth.uid(), 'expense_auditor')
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
  SELECT public.get_team_lead_for(auth.uid()) INTO tl;
  IF tl IS NULL THEN
    SELECT l.assigned_to INTO any_auditor FROM public.lines l
    WHERE l.batch_id = _batch_id AND l.assigned_to IS NOT NULL LIMIT 1;
    IF any_auditor IS NOT NULL THEN
      SELECT public.get_team_lead_for(any_auditor) INTO tl;
    END IF;
  END IF;
  INSERT INTO public.batch_delete_requests (batch_id, requested_by, reason, assigned_team_lead)
  VALUES (_batch_id, auth.uid(), _reason, tl) RETURNING id INTO req_id;
  RETURN req_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.publish_issues_to_aa_by_approved_by(_line_ids uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  routed integer := 0; unmatched integer := 0; rec record; target_aa uuid;
  unmatched_names text[] := ARRAY[]::text[]; approver_norm text; approver_local text;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'team_lead')
       OR public.has_role(auth.uid(),'auditor') OR public.has_role(auth.uid(),'expense_auditor')) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  FOR rec IN SELECT id, approved_by FROM public.lines
    WHERE id = ANY(_line_ids) AND status = 'issue' AND aa_assigned_to IS NULL
  LOOP
    target_aa := NULL;
    approver_norm := lower(trim(COALESCE(rec.approved_by, '')));
    approver_local := split_part(approver_norm, '@', 1);
    IF length(approver_norm) > 0 THEN
      SELECT p.user_id INTO target_aa FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'expense_auditor'
      WHERE lower(trim(p.email)) = approver_norm ORDER BY p.created_at ASC LIMIT 1;
      IF target_aa IS NULL THEN
        SELECT p.user_id INTO target_aa FROM public.profiles p
        JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'expense_auditor'
        WHERE lower(trim(p.full_name)) = approver_norm ORDER BY p.created_at ASC LIMIT 1;
      END IF;
      IF target_aa IS NULL AND length(approver_local) > 0 THEN
        SELECT p.user_id INTO target_aa FROM public.profiles p
        JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'expense_auditor'
        WHERE lower(split_part(p.email, '@', 1)) = approver_local ORDER BY p.created_at ASC LIMIT 1;
      END IF;
      IF target_aa IS NULL THEN
        SELECT p.user_id INTO target_aa FROM public.profiles p
        JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'expense_auditor'
        WHERE (length(trim(p.full_name)) > 0 AND (
              lower(trim(p.full_name)) ILIKE '%' || approver_norm || '%'
           OR approver_norm ILIKE '%' || lower(trim(p.full_name)) || '%'))
        ORDER BY length(p.full_name) ASC LIMIT 1;
      END IF;
      IF target_aa IS NULL AND length(approver_local) > 0 THEN
        SELECT p.user_id INTO target_aa FROM public.profiles p
        JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'expense_auditor'
        WHERE lower(split_part(p.email, '@', 1)) ILIKE '%' || approver_local || '%'
           OR approver_local ILIKE '%' || lower(split_part(p.email, '@', 1)) || '%'
        ORDER BY length(p.email) ASC LIMIT 1;
      END IF;
    END IF;
    IF target_aa IS NOT NULL THEN
      UPDATE public.lines SET aa_assigned_to = target_aa, aa_status='allocated',
        aa_allocated_at=now(), aa_published_by=auth.uid(),
        published_at=COALESCE(published_at,now()), published_by=COALESCE(published_by,auth.uid()),
        updated_at=now() WHERE id = rec.id;
      routed := routed + 1;
    ELSE
      unmatched := unmatched + 1;
      IF rec.approved_by IS NOT NULL THEN unmatched_names := unmatched_names || rec.approved_by; END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('routed', routed, 'unmatched', unmatched,
    'unmatched_approvers', (SELECT COALESCE(jsonb_agg(DISTINCT n),'[]'::jsonb) FROM unnest(unmatched_names) AS n));
END; $function$;

CREATE OR REPLACE FUNCTION public.publish_issues_to_aa_user(_line_ids uuid[], _aa_user_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE routed integer := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'team_lead')
       OR public.has_role(auth.uid(),'auditor') OR public.has_role(auth.uid(),'expense_auditor')) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF _aa_user_id IS NULL THEN RAISE EXCEPTION 'An Expense Auditor must be selected'; END IF;
  IF NOT public.has_role(_aa_user_id, 'expense_auditor') THEN
    RAISE EXCEPTION 'Selected user is not an Expense Auditor';
  END IF;
  UPDATE public.lines SET aa_assigned_to=_aa_user_id, aa_status='allocated',
    aa_allocated_at=now(), aa_published_by=auth.uid(), updated_at=now()
  WHERE id = ANY(_line_ids) AND status='issue' AND aa_assigned_to IS NULL;
  GET DIAGNOSTICS routed = ROW_COUNT;
  RETURN jsonb_build_object('routed', routed);
END; $function$;

CREATE OR REPLACE FUNCTION public.publish_issues_to_aa(_line_ids uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE routed integer := 0; unmatched integer := 0; rec record; target_aa uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'team_lead')
       OR public.has_role(auth.uid(),'auditor') OR public.has_role(auth.uid(),'expense_auditor')) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  FOR rec IN SELECT id, branch FROM public.lines
    WHERE id = ANY(_line_ids) AND status='issue' AND aa_assigned_to IS NULL
  LOOP
    target_aa := NULL;
    IF rec.branch IS NOT NULL THEN
      SELECT approved_auditor_id INTO target_aa FROM public.aa_branch_codes
      WHERE lower(trim(branch_code)) = lower(trim(rec.branch))
      ORDER BY created_at ASC LIMIT 1;
    END IF;
    IF target_aa IS NOT NULL THEN
      UPDATE public.lines SET aa_assigned_to=target_aa, aa_status='allocated',
        aa_allocated_at=now(), aa_published_by=auth.uid(), updated_at=now()
      WHERE id = rec.id;
      routed := routed + 1;
    ELSE unmatched := unmatched + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('routed', routed, 'unmatched', unmatched);
END; $function$;

CREATE OR REPLACE FUNCTION public.allocate_ea_batch(_batch_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  total_assigned integer := 0; unassigned integer := 0; branches_seen integer := 0;
  br record; line_id uuid; picked_auditor uuid; uploader uuid;
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'team_lead')) then
    raise exception 'Not allowed';
  end if;
  select uploaded_by into uploader from public.ea_batches where id = _batch_id;
  create temporary table if not exists tmp_eacap (auditor_id uuid primary key, remaining integer) on commit drop;
  delete from tmp_eacap;
  insert into tmp_eacap (auditor_id, remaining)
  select m.auditor_id,
         greatest(coalesce(d.count, b.default_count, 0)
                  - coalesce((select count(*) from public.ea_lines lx
                              where lx.assigned_ea = m.auditor_id and lx.allocated_date = current_date),0),0)
  from public.auditor_team_leads m
  join public.user_roles ur on ur.user_id = m.auditor_id and ur.role = 'expense_auditor'
  left join public.auditor_benchmarks b on b.team_lead_id=m.team_lead_id and b.auditor_id=m.auditor_id and b.kind='ea'
  left join public.auditor_benchmarks_daily d on d.team_lead_id=m.team_lead_id and d.auditor_id=m.auditor_id and d.kind='ea' and d.date=current_date
  where m.team_lead_id = uploader
    and not exists (select 1 from public.attendance a where a.user_id=m.auditor_id and a.date=current_date and a.present=false);
  for br in select distinct branch from public.ea_lines where batch_id=_batch_id and assigned_ea is null
  loop
    branches_seen := branches_seen + 1;
    for line_id in select id from public.ea_lines where batch_id=_batch_id and assigned_ea is null and branch is not distinct from br.branch order by created_at
    loop
      select c.auditor_id into picked_auditor from tmp_eacap c
      join public.aa_branch_codes bc on bc.approved_auditor_id = c.auditor_id
      where c.remaining > 0 and br.branch is not null
        and lower(trim(bc.branch_code)) = lower(trim(br.branch))
      order by c.remaining desc limit 1;
      if picked_auditor is null then
        select auditor_id into picked_auditor from tmp_eacap where remaining > 0 order by remaining desc limit 1;
      end if;
      if picked_auditor is null then unassigned := unassigned + 1;
      else
        update public.ea_lines set assigned_ea = picked_auditor, updated_at = now() where id = line_id;
        update tmp_eacap set remaining = remaining - 1 where auditor_id = picked_auditor;
        total_assigned := total_assigned + 1;
      end if;
      picked_auditor := null;
    end loop;
  end loop;
  update public.ea_batches set total_branches = branches_seen where id = _batch_id;
  return jsonb_build_object('assigned', total_assigned, 'unassigned', unassigned, 'branches', branches_seen);
end $function$;

CREATE OR REPLACE FUNCTION public.get_tl_benchmarks()
 RETURNS TABLE(auditor_id uuid, full_name text, email text, kind benchmark_kind, default_count integer, today_count integer, present_today boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if not (public.has_role(auth.uid(),'team_lead') or public.has_role(auth.uid(),'admin')) then
    raise exception 'Not allowed';
  end if;
  return query
  select m.auditor_id, coalesce(p.full_name,'') as full_name, coalesce(p.email,'') as email,
    k.kind, coalesce(b.default_count,0) as default_count,
    coalesce(d.count, b.default_count, 0) as today_count,
    coalesce(not (a.present is false), true) as present_today
  from public.auditor_team_leads m
  cross join (values ('qa'::benchmark_kind), ('ea'::benchmark_kind)) as k(kind)
  left join public.profiles p on p.user_id = m.auditor_id
  left join public.user_roles ur on ur.user_id = m.auditor_id and (
       (k.kind = 'qa' and ur.role = 'auditor')
    or (k.kind = 'ea' and ur.role = 'expense_auditor'))
  left join public.auditor_benchmarks b on b.team_lead_id=m.team_lead_id and b.auditor_id=m.auditor_id and b.kind=k.kind
  left join public.auditor_benchmarks_daily d on d.team_lead_id=m.team_lead_id and d.auditor_id=m.auditor_id and d.kind=k.kind and d.date=current_date
  left join public.attendance a on a.user_id = m.auditor_id and a.date = current_date
  where m.team_lead_id = auth.uid() and ur.role is not null
  order by k.kind, full_name;
end $function$;

-- Return all users who have a specific auditor role (auditor or expense_auditor)
CREATE OR REPLACE FUNCTION public.get_auditors_by_role(_role text, _kind benchmark_kind)
 RETURNS TABLE(auditor_id uuid, full_name text, email text, kind benchmark_kind, default_count integer, today_count integer, present_today boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(),'team_lead') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  RETURN QUERY
  SELECT p.user_id, coalesce(p.full_name,'') as full_name, coalesce(p.email,'') as email,
    _kind as kind, 0 as default_count, 0 as today_count, coalesce(not (a.present is false), true) as present_today
  FROM public.profiles p
  JOIN public.user_roles ur on ur.user_id = p.user_id and ur.role = _role
  LEFT JOIN public.attendance a on a.user_id = p.user_id and a.date = current_date
  ORDER BY full_name;
END $function$;