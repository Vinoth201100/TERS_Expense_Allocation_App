ALTER TABLE public.lines
  ADD COLUMN IF NOT EXISTS user_location text,
  ADD COLUMN IF NOT EXISTS approved_by text;