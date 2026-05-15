
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin', 'auditor');
CREATE TYPE public.line_status AS ENUM ('allocated', 'completed', 'issue');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role security definer
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- updated_at trigger fn
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- auto-create profile + first user becomes admin, others auditor
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  user_count INT;
  assigned_role public.app_role;
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email
  );

  SELECT COUNT(*) INTO user_count FROM auth.users;
  IF user_count <= 1 THEN
    assigned_role := 'admin';
  ELSE
    assigned_role := 'auditor';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, assigned_role);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS for profiles
CREATE POLICY "Users view all profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- RLS for user_roles
CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ BATCHES ============
CREATE TABLE public.batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  upload_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_lines INT NOT NULL DEFAULT 0,
  total_groups INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'allocated',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated view batches" ON public.batches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage batches" ON public.batches FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ ATTENDANCE ============
CREATE TABLE public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  present BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated view attendance" ON public.attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage attendance" ON public.attendance FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ LINES ============
CREATE TABLE public.lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  group_key TEXT NOT NULL, -- EXPENSE NUMBER + EMPLOYEE
  status public.line_status NOT NULL DEFAULT 'allocated',
  -- key columns from xlsx
  expense_number TEXT,
  employee TEXT,
  user_id_field TEXT,
  date_submitted DATE,
  category TEXT,
  amount NUMERIC,
  currency TEXT,
  branch TEXT,
  project TEXT,
  merchant TEXT,
  -- QC fields filled by auditor
  qc_category TEXT,
  qc_type_of_issue TEXT,
  qc_qa_checks TEXT,
  qc_comment TEXT,
  qc_completed_at TIMESTAMPTZ,
  -- raw row stored as JSONB for full fidelity
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lines_assigned ON public.lines(assigned_to, status);
CREATE INDEX idx_lines_batch ON public.lines(batch_id);
CREATE INDEX idx_lines_group ON public.lines(batch_id, group_key);

CREATE TRIGGER update_lines_updated_at BEFORE UPDATE ON public.lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auditors view assigned lines, admins all" ON public.lines FOR SELECT TO authenticated
  USING (assigned_to = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Auditors update assigned lines, admins all" ON public.lines FOR UPDATE TO authenticated
  USING (assigned_to = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (assigned_to = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert lines" ON public.lines FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete lines" ON public.lines FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============ STORAGE BUCKET for raw xlsx ============
INSERT INTO storage.buckets (id, name, public) VALUES ('raw-uploads', 'raw-uploads', false);
CREATE POLICY "Admins upload raw files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'raw-uploads' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins read raw files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'raw-uploads' AND public.has_role(auth.uid(), 'admin'));
