
## New Team Lead tab: "Benchmarks"

A new sidebar entry visible to **Team Lead only** (not auditors, not EA-only, not pure admin) that lets the TL view and edit per-auditor daily benchmarks for both QA Auditors and Expense Auditors. These benchmarks become the source of truth used by auto-allocation when a file is uploaded.

### 1. What the page shows

Two side-by-side cards (stack on mobile):

```text
┌─────────────────────────┐  ┌─────────────────────────┐
│ Expense Auditors        │  │ QA Auditors             │
│ Total daily target: 240 │  │ Total daily target: 180 │
├─────────────────────────┤  ├─────────────────────────┤
│ Auditor    Default  Today│  │ Auditor    Default Today│
│ Alice       60      [60]│  │ Ravi        45     [45]│
│ Bob         80      [80]│  │ Priya       50     [50]│
│ ...                     │  │ ...                     │
└─────────────────────────┘  └─────────────────────────┘
                  [ Save changes ]
```

- **Default** column: persistent benchmark per auditor (reused every day).
- **Today** column: editable override for today only. Empty = use default.
- **Total daily target**: live sum of "today" values — this is the "main total count of expenses to allocate every day", and is the number used by auto-allocate.
- Only auditors mapped to the current TL appear (via `auditor_team_leads`).

### 2. How it drives Upload & Allocate

When the TL uploads a file in **Upload & Allocate**:

- Auto-allocation reads each mapped auditor's effective benchmark for today (`today` value if set, else `default`, else 0).
- Distributes uploaded lines round-robin **weighted by benchmark**, capped at each auditor's benchmark for the day. Auditors marked absent today are skipped.
- Same logic for both EA upload and QA upload paths.
- If uploaded lines exceed total benchmark → remaining lines stay **unallocated** (visible in Upload & Allocate as "X unallocated").

### 3. "Add more lines" action (Upload & Allocate)

When the queue is high and the TL needs to push more work to an auditor:

- New "Add more lines" button on each auditor row in the Upload & Allocate allocation summary (one section per pool: EA / QA).
- Click → small dialog: "How many more lines for {auditor name}?"
- Pulls that many oldest unallocated lines from the most recent unallocated pool and assigns them to that auditor.
- Works for both QA and EA.

### 4. Access rules

- Sidebar item "Benchmarks" visible only when `roles.includes("team_lead")`.
- Route `/benchmarks` guarded by `allowedRoles: ["team_lead"]`.
- Admin can also see it (admins see everything by convention).

---

## Technical details

### Database (single migration)

New table `auditor_benchmarks` keyed by `(team_lead_id, auditor_id, kind)`:

```sql
create type public.benchmark_kind as enum ('qa', 'ea');

create table public.auditor_benchmarks (
  id uuid primary key default gen_random_uuid(),
  team_lead_id uuid not null,
  auditor_id   uuid not null,
  kind         public.benchmark_kind not null,
  default_count integer not null default 0 check (default_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_lead_id, auditor_id, kind)
);

create table public.auditor_benchmarks_daily (
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
```

RLS:
- TL can `select/insert/update/delete` rows where `team_lead_id = auth.uid()`.
- Admins manage all.
- Auditors can `select` rows where `auditor_id = auth.uid()` (so dashboards can read their own target).

New RPCs:
- `get_tl_benchmarks()` → list of `{auditor_id, full_name, email, kind, default_count, today_count, present_today}` for the calling TL's mapped auditors.
- `upsert_benchmark(_auditor uuid, _kind benchmark_kind, _default int, _today int|null)` — TL only.
- `add_more_lines_qa(_auditor uuid, _count int)` and `add_more_lines_ea(_auditor uuid, _count int)` — assign N oldest unallocated lines to that auditor (RLS-checked: TL must own that auditor).

Update existing allocators:
- `allocate_qa_batch` and `allocate_ea_batch` rewritten to weight by today's effective benchmark per mapped auditor (and per branch-mapped EA), capping each auditor at their benchmark and leaving overflow unassigned.

### Frontend

- New page `src/pages/BenchmarksPage.tsx` with two cards, editable `today` inputs, persistent `default` inputs, single "Save changes" button.
- New nav item in `AppLayout.tsx` ("Targets / Benchmarks") under the Manage section, gated by `isTeamLead || isAdmin`.
- New route in `App.tsx`: `/benchmarks` → `Shell allowedRoles={["team_lead"]}`.
- `UploadPage.tsx`: per-auditor row in the post-upload summary gets an "Add more" button → small dialog → calls the new RPC.

No changes to other pages.

### Files touched

- `supabase/migrations/<new>.sql` — tables, RLS, RPCs, allocator rewrite.
- `src/App.tsx` — add route.
- `src/components/AppLayout.tsx` — add nav item.
- `src/pages/BenchmarksPage.tsx` — new.
- `src/pages/UploadPage.tsx` — add "Add more lines" affordance.
