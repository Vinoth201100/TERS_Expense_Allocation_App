
-- Enum
do $$ begin
  create type public.benchmark_kind as enum ('qa', 'ea');
exception when duplicate_object then null; end $$;

-- Tables
create table if not exists public.auditor_benchmarks (
  id uuid primary key default gen_random_uuid(),
  team_lead_id uuid not null,
  auditor_id   uuid not null,
  kind         public.benchmark_kind not null,
  default_count integer not null default 0 check (default_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_lead_id, auditor_id, kind)
);

create table if not exists public.auditor_benchmarks_daily (
  id uuid primary key default gen_random_uuid(),
  team_lead_id uuid not null,
  auditor_id   uuid not null,
  kind         public.benchmark_kind not null,
  date         date not null default current_date,
  count        integer not null check (count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_lead_id, auditor_id, kind, date)
);

alter table public.auditor_benchmarks enable row level security;
alter table public.auditor_benchmarks_daily enable row level security;

-- RLS: auditor_benchmarks
drop policy if exists "TL manages own benchmarks" on public.auditor_benchmarks;
create policy "TL manages own benchmarks" on public.auditor_benchmarks
  for all to authenticated
  using (team_lead_id = auth.uid() and public.has_role(auth.uid(), 'team_lead'))
  with check (team_lead_id = auth.uid() and public.has_role(auth.uid(), 'team_lead'));

drop policy if exists "Admins manage benchmarks" on public.auditor_benchmarks;
create policy "Admins manage benchmarks" on public.auditor_benchmarks
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Auditor views own benchmark" on public.auditor_benchmarks;
create policy "Auditor views own benchmark" on public.auditor_benchmarks
  for select to authenticated
  using (auditor_id = auth.uid());

-- RLS: auditor_benchmarks_daily (mirror)
drop policy if exists "TL manages own daily benchmarks" on public.auditor_benchmarks_daily;
create policy "TL manages own daily benchmarks" on public.auditor_benchmarks_daily
  for all to authenticated
  using (team_lead_id = auth.uid() and public.has_role(auth.uid(), 'team_lead'))
  with check (team_lead_id = auth.uid() and public.has_role(auth.uid(), 'team_lead'));

drop policy if exists "Admins manage daily benchmarks" on public.auditor_benchmarks_daily;
create policy "Admins manage daily benchmarks" on public.auditor_benchmarks_daily
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Auditor views own daily benchmark" on public.auditor_benchmarks_daily;
create policy "Auditor views own daily benchmark" on public.auditor_benchmarks_daily
  for select to authenticated
  using (auditor_id = auth.uid());

-- Updated_at trigger
drop trigger if exists trg_ab_updated on public.auditor_benchmarks;
create trigger trg_ab_updated before update on public.auditor_benchmarks
  for each row execute function public.update_updated_at_column();

drop trigger if exists trg_abd_updated on public.auditor_benchmarks_daily;
create trigger trg_abd_updated before update on public.auditor_benchmarks_daily
  for each row execute function public.update_updated_at_column();

-- RPC: list TL's auditors with benchmarks
create or replace function public.get_tl_benchmarks()
returns table(
  auditor_id uuid,
  full_name text,
  email text,
  kind public.benchmark_kind,
  default_count integer,
  today_count integer,
  present_today boolean
)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not (public.has_role(auth.uid(), 'team_lead') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Not allowed';
  end if;

  return query
  select
    m.auditor_id,
    coalesce(p.full_name, '') as full_name,
    coalesce(p.email, '') as email,
    k.kind,
    coalesce(b.default_count, 0) as default_count,
    coalesce(d.count, b.default_count, 0) as today_count,
    coalesce(not (a.present is false), true) as present_today
  from public.auditor_team_leads m
  cross join (values ('qa'::benchmark_kind), ('ea'::benchmark_kind)) as k(kind)
  left join public.profiles p on p.user_id = m.auditor_id
  left join public.user_roles ur on ur.user_id = m.auditor_id and (
       (k.kind = 'qa' and ur.role = 'auditor')
    or (k.kind = 'ea' and ur.role = 'approved_auditor')
  )
  left join public.auditor_benchmarks b
    on b.team_lead_id = m.team_lead_id and b.auditor_id = m.auditor_id and b.kind = k.kind
  left join public.auditor_benchmarks_daily d
    on d.team_lead_id = m.team_lead_id and d.auditor_id = m.auditor_id and d.kind = k.kind and d.date = current_date
  left join public.attendance a
    on a.user_id = m.auditor_id and a.date = current_date
  where m.team_lead_id = auth.uid()
    and ur.role is not null
  order by k.kind, full_name;
end $$;

-- RPC: upsert benchmark
create or replace function public.upsert_benchmark(
  _auditor uuid, _kind public.benchmark_kind, _default integer, _today integer
)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.has_role(auth.uid(), 'team_lead') then
    raise exception 'Only team leads can set benchmarks';
  end if;
  if not exists (select 1 from public.auditor_team_leads
                 where team_lead_id = auth.uid() and auditor_id = _auditor) then
    raise exception 'Auditor not in your team';
  end if;
  if _default is null or _default < 0 then _default := 0; end if;

  insert into public.auditor_benchmarks (team_lead_id, auditor_id, kind, default_count)
  values (auth.uid(), _auditor, _kind, _default)
  on conflict (team_lead_id, auditor_id, kind)
  do update set default_count = excluded.default_count, updated_at = now();

  if _today is null then
    delete from public.auditor_benchmarks_daily
     where team_lead_id = auth.uid() and auditor_id = _auditor and kind = _kind and date = current_date;
  else
    insert into public.auditor_benchmarks_daily (team_lead_id, auditor_id, kind, date, count)
    values (auth.uid(), _auditor, _kind, current_date, greatest(_today, 0))
    on conflict (team_lead_id, auditor_id, kind, date)
    do update set count = excluded.count, updated_at = now();
  end if;
end $$;

-- RPC: add more QA lines
create or replace function public.add_more_lines_qa(_auditor uuid, _count integer)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  moved integer := 0;
begin
  if not (public.has_role(auth.uid(), 'team_lead') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Not allowed';
  end if;
  if _count is null or _count <= 0 then return 0; end if;
  -- Allow team leads/admins to add lines to any user that holds the auditor role
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(_auditor, 'auditor')) then
    raise exception 'Selected user is not a QA auditor';
  end if;

  with picked as (
    select l.id from public.lines l
    join public.batches b on b.id = l.batch_id
    where l.assigned_to is null and l.status = 'allocated'
      and (public.has_role(auth.uid(),'admin') or b.uploaded_by = auth.uid())
    order by l.created_at asc
    limit _count
  )
  update public.lines l set assigned_to = _auditor, updated_at = now()
  from picked where l.id = picked.id;
  get diagnostics moved = row_count;
  return moved;
end $$;

-- RPC: add more EA lines
create or replace function public.add_more_lines_ea(_auditor uuid, _count integer)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare moved integer := 0;
begin
  if not (public.has_role(auth.uid(), 'team_lead') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Not allowed';
  end if;
  if _count is null or _count <= 0 then return 0; end if;
  -- Allow team leads/admins to add lines to any user that holds the expense_auditor role
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(_auditor, 'expense_auditor')) then
    raise exception 'Selected user is not an Expense Auditor';
  end if;

  with picked as (
    select l.id from public.ea_lines l
    join public.ea_batches b on b.id = l.batch_id
    where l.assigned_ea is null
      and (public.has_role(auth.uid(),'admin') or b.uploaded_by = auth.uid())
    order by l.created_at asc
    limit _count
  )
  update public.ea_lines l set assigned_ea = _auditor, updated_at = now()
  from picked where l.id = picked.id;
  get diagnostics moved = row_count;
  return moved;
end $$;

-- Rewrite QA allocator: weight by benchmark, cap per auditor
create or replace function public.allocate_qa_batch(_batch_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  uploader uuid;
  total_assigned integer := 0;
  rec record;
  line_id uuid;
  remaining integer;
  picked_auditor uuid;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'team_lead')) then
    raise exception 'Not allowed';
  end if;

  select uploaded_by into uploader from public.batches where id = _batch_id;
  if uploader is null then raise exception 'Batch not found'; end if;

  -- Build remaining-capacity map (temp table) for this TL's QA auditors
  create temporary table if not exists tmp_cap (auditor_id uuid primary key, remaining integer) on commit drop;
  delete from tmp_cap;

  insert into tmp_cap (auditor_id, remaining)
  select m.auditor_id,
         greatest(coalesce(d.count, b.default_count, 0)
                  - coalesce((select count(*) from public.lines lx
                              where lx.assigned_to = m.auditor_id
                                and lx.allocated_date = current_date), 0), 0)
  from public.auditor_team_leads m
  join public.user_roles ur on ur.user_id = m.auditor_id and ur.role = 'auditor'
  left join public.auditor_benchmarks b
    on b.team_lead_id = m.team_lead_id and b.auditor_id = m.auditor_id and b.kind = 'qa'
  left join public.auditor_benchmarks_daily d
    on d.team_lead_id = m.team_lead_id and d.auditor_id = m.auditor_id and d.kind = 'qa' and d.date = current_date
  where m.team_lead_id = uploader
    and not exists (
      select 1 from public.attendance a
      where a.user_id = m.auditor_id and a.date = current_date and a.present = false
    );

  for line_id in
    select id from public.lines
    where batch_id = _batch_id and assigned_to is null and status = 'allocated'
    order by created_at
  loop
    -- pick auditor with most remaining capacity > 0
    select auditor_id into picked_auditor from tmp_cap where remaining > 0
      order by remaining desc limit 1;
    exit when picked_auditor is null;

    update public.lines set assigned_to = picked_auditor, updated_at = now() where id = line_id;
    update tmp_cap set remaining = remaining - 1 where auditor_id = picked_auditor;
    total_assigned := total_assigned + 1;
    picked_auditor := null;
  end loop;

  return jsonb_build_object('assigned', total_assigned);
end $$;

-- Rewrite EA allocator: branch + benchmark cap
create or replace function public.allocate_ea_batch(_batch_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  total_assigned integer := 0;
  unassigned integer := 0;
  branches_seen integer := 0;
  br record;
  line_id uuid;
  picked_auditor uuid;
  uploader uuid;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'team_lead')) then
    raise exception 'Not allowed';
  end if;

  select uploaded_by into uploader from public.ea_batches where id = _batch_id;

  create temporary table if not exists tmp_eacap (auditor_id uuid primary key, remaining integer) on commit drop;
  delete from tmp_eacap;

  -- Seed capacity for every EA in this TL's team that is present today
  insert into tmp_eacap (auditor_id, remaining)
  select m.auditor_id,
         greatest(coalesce(d.count, b.default_count, 0)
                  - coalesce((select count(*) from public.ea_lines lx
                              where lx.assigned_ea = m.auditor_id
                                and lx.allocated_date = current_date), 0), 0)
  from public.auditor_team_leads m
  join public.user_roles ur on ur.user_id = m.auditor_id and ur.role = 'approved_auditor'
  left join public.auditor_benchmarks b
    on b.team_lead_id = m.team_lead_id and b.auditor_id = m.auditor_id and b.kind = 'ea'
  left join public.auditor_benchmarks_daily d
    on d.team_lead_id = m.team_lead_id and d.auditor_id = m.auditor_id and d.kind = 'ea' and d.date = current_date
  where m.team_lead_id = uploader
    and not exists (
      select 1 from public.attendance a
      where a.user_id = m.auditor_id and a.date = current_date and a.present = false
    );

  for br in select distinct branch from public.ea_lines where batch_id = _batch_id and assigned_ea is null
  loop
    branches_seen := branches_seen + 1;
    for line_id in
      select id from public.ea_lines
      where batch_id = _batch_id and assigned_ea is null
        and branch is not distinct from br.branch
      order by created_at
    loop
      -- prefer EAs mapped to this branch with remaining capacity
      select c.auditor_id into picked_auditor
      from tmp_eacap c
      join public.aa_branch_codes bc on bc.approved_auditor_id = c.auditor_id
      where c.remaining > 0
        and br.branch is not null
        and lower(trim(bc.branch_code)) = lower(trim(br.branch))
      order by c.remaining desc limit 1;

      -- fallback: any EA with capacity
      if picked_auditor is null then
        select auditor_id into picked_auditor from tmp_eacap where remaining > 0
          order by remaining desc limit 1;
      end if;

      if picked_auditor is null then
        unassigned := unassigned + 1;
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
end $$;
