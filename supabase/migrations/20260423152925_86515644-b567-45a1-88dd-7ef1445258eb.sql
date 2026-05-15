
-- 1. Lines table: leads feedback + agree/disagree + audit-trail-friendly timestamp
ALTER TABLE public.lines
  ADD COLUMN IF NOT EXISTS leads_feedback text,
  ADD COLUMN IF NOT EXISTS leads_agrees boolean,
  ADD COLUMN IF NOT EXISTS leads_feedback_at timestamptz,
  ADD COLUMN IF NOT EXISTS leads_feedback_by uuid;

-- 2. Batches table: allocation mode (auto | manual)
ALTER TABLE public.batches
  ADD COLUMN IF NOT EXISTS allocation_mode text NOT NULL DEFAULT 'auto'
    CHECK (allocation_mode IN ('auto', 'manual'));

-- 3. Audit trail for leads feedback edits
CREATE TABLE IF NOT EXISTS public.leads_feedback_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES public.lines(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  feedback text,
  agrees boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.leads_feedback_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View feedback history scoped"
  ON public.leads_feedback_history FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'team_lead')
    OR has_role(auth.uid(), 'approved_auditor')
    OR EXISTS (SELECT 1 FROM public.lines l WHERE l.id = line_id AND l.assigned_to = auth.uid())
  );

CREATE POLICY "Privileged insert feedback history"
  ON public.leads_feedback_history FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'team_lead') OR has_role(auth.uid(), 'approved_auditor'))
  );

-- Trigger: log every change to leads_feedback / leads_agrees
CREATE OR REPLACE FUNCTION public.log_leads_feedback_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.leads_feedback IS DISTINCT FROM OLD.leads_feedback)
     OR (NEW.leads_agrees IS DISTINCT FROM OLD.leads_agrees) THEN
    NEW.leads_feedback_at := now();
    NEW.leads_feedback_by := auth.uid();
    INSERT INTO public.leads_feedback_history (line_id, author_id, feedback, agrees)
    VALUES (NEW.id, COALESCE(auth.uid(), NEW.leads_feedback_by), NEW.leads_feedback, NEW.leads_agrees);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_leads_feedback ON public.lines;
CREATE TRIGGER trg_log_leads_feedback
  BEFORE UPDATE ON public.lines
  FOR EACH ROW EXECUTE FUNCTION public.log_leads_feedback_change();

-- 4. Allow team leads + approved auditors to update leads_feedback / leads_agrees
DROP POLICY IF EXISTS "Reviewers update leads feedback" ON public.lines;
CREATE POLICY "Reviewers update leads feedback"
  ON public.lines FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'team_lead') OR has_role(auth.uid(), 'approved_auditor'))
  WITH CHECK (has_role(auth.uid(), 'team_lead') OR has_role(auth.uid(), 'approved_auditor'));

-- 5. Attachments: table + storage bucket
CREATE TABLE IF NOT EXISTS public.line_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES public.lines(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL,
  storage_path text NOT NULL,
  filename text NOT NULL,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.line_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View attachments scoped"
  ON public.line_attachments FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'team_lead')
    OR has_role(auth.uid(), 'approved_auditor')
    OR EXISTS (SELECT 1 FROM public.lines l WHERE l.id = line_id AND l.assigned_to = auth.uid())
  );

CREATE POLICY "Authenticated insert attachments"
  ON public.line_attachments FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "Uploader or admin delete attachments"
  ON public.line_attachments FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid() OR has_role(auth.uid(), 'admin'));

-- Storage bucket for attachments (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-attachments', 'expense-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: any authenticated user can upload; viewing scoped via signed URLs
CREATE POLICY "Authenticated read expense attachments"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'expense-attachments');

CREATE POLICY "Authenticated upload expense attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'expense-attachments');

CREATE POLICY "Owner or admin delete expense attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'expense-attachments' AND (owner = auth.uid() OR has_role(auth.uid(), 'admin')));
