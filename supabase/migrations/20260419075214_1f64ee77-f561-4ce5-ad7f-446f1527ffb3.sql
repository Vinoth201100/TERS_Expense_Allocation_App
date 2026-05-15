-- 1. Benchmark column on attendance (per-auditor per-day target)
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS benchmark integer NOT NULL DEFAULT 0;

-- 2. Helper: is _auditor mapped to caller (as team lead)?
CREATE OR REPLACE FUNCTION public.is_my_reporting_auditor(_auditor uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.auditor_team_leads
    WHERE auditor_id = _auditor AND team_lead_id = auth.uid()
  )
$$;

-- 3. Tighten lines SELECT policy
DROP POLICY IF EXISTS "Lines view policy" ON public.lines;
CREATE POLICY "Lines view policy"
ON public.lines
FOR SELECT
TO authenticated
USING (
  assigned_to = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR (
    public.has_role(auth.uid(), 'team_lead')
    AND assigned_to IS NOT NULL
    AND public.is_my_reporting_auditor(assigned_to)
  )
  OR (
    public.has_role(auth.uid(), 'approved_auditor')
    AND assigned_to IS NOT NULL
    AND public.is_my_reporting_auditor(assigned_to)
  )
);

-- 4. Attendance: scope view + management
DROP POLICY IF EXISTS "Authenticated view attendance" ON public.attendance;
DROP POLICY IF EXISTS "Admins manage attendance" ON public.attendance;

CREATE POLICY "View attendance scoped"
ON public.attendance
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR user_id = auth.uid()
  OR (
    public.has_role(auth.uid(), 'team_lead')
    AND public.is_my_reporting_auditor(user_id)
  )
);

CREATE POLICY "Admins manage all attendance"
ON public.attendance
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Team leads manage their auditors attendance"
ON public.attendance
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'team_lead')
  AND public.is_my_reporting_auditor(user_id)
)
WITH CHECK (
  public.has_role(auth.uid(), 'team_lead')
  AND public.is_my_reporting_auditor(user_id)
);