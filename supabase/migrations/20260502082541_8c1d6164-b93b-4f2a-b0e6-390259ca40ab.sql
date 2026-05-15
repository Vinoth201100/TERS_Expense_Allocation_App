ALTER TABLE public.ea_lines
  ADD COLUMN IF NOT EXISTS is_resubmitted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS previous_status text NULL;

CREATE INDEX IF NOT EXISTS idx_ea_lines_expense_number ON public.ea_lines (expense_number);
CREATE INDEX IF NOT EXISTS idx_ea_lines_is_resubmitted ON public.ea_lines (is_resubmitted) WHERE is_resubmitted = true;