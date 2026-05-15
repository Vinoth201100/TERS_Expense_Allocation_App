-- Protect the bootstrap admin: vinothk201100@gmail.com is always admin and cannot be removed.

-- 1. Re-assert admin role for the protected user (idempotent)
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::public.app_role
FROM auth.users u
WHERE lower(u.email) = 'vinothk201100@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.user_id = u.id AND r.role = 'admin'::public.app_role
  );

-- 2. Trigger: block delete of admin row for the protected user
CREATE OR REPLACE FUNCTION public.protect_bootstrap_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  protected_email constant text := 'vinothk201100@gmail.com';
  target_email text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT lower(email) INTO target_email FROM auth.users WHERE id = OLD.user_id;
    IF target_email = protected_email AND OLD.role = 'admin'::public.app_role THEN
      RAISE EXCEPTION 'Cannot remove admin role from the protected bootstrap admin (%).', protected_email;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT lower(email) INTO target_email FROM auth.users WHERE id = OLD.user_id;
    IF target_email = protected_email
       AND OLD.role = 'admin'::public.app_role
       AND NEW.role <> 'admin'::public.app_role THEN
      RAISE EXCEPTION 'Cannot change admin role of the protected bootstrap admin (%).', protected_email;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS protect_bootstrap_admin_trg ON public.user_roles;
CREATE TRIGGER protect_bootstrap_admin_trg
BEFORE UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.protect_bootstrap_admin();
