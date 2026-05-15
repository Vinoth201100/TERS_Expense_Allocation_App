DROP POLICY IF EXISTS "Admins manage batches" ON public.batches;
CREATE POLICY "Admins manage batches"
ON public.batches
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Team leads create own batches"
ON public.batches
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'team_lead')
  AND uploaded_by = auth.uid()
);

DROP POLICY IF EXISTS "Admins insert lines" ON public.lines;
CREATE POLICY "Admins insert lines"
ON public.lines
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Team leads create lines for own uploaded batches"
ON public.lines
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'team_lead')
  AND EXISTS (
    SELECT 1
    FROM public.batches b
    WHERE b.id = lines.batch_id
      AND b.uploaded_by = auth.uid()
  )
  AND (
    assigned_to IS NULL
    OR public.is_my_reporting_auditor(assigned_to)
  )
);