import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Role = "admin" | "auditor" | "team_lead" | "expense_auditor" | null;

interface AuthCtx {
  user: User | null;
  session: Session | null;
  role: Role;
  roles: Role[]; // all roles the user has
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  session: null,
  role: null,
  roles: [],
  loading: true,
  signOut: async () => {},
});

// Priority: admin > team_lead > expense_auditor > auditor
const ROLE_PRIORITY: Record<string, number> = {
  admin: 4,
  team_lead: 3,
  expense_auditor: 2,
  auditor: 1,
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        // Mark roles as loading until fetch completes — prevents
        // RequireAuth from briefly rendering "Access denied" right after login.
        setRolesLoading(true);
        setTimeout(() => fetchRole(s.user.id), 0);
      } else {
        setRole(null);
        setRoles([]);
        setRolesLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        setRolesLoading(true);
        fetchRole(s.user.id);
      } else {
        setRolesLoading(false);
      }
      setSessionLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const fetchRole = async (uid: string) => {
    try {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid);
      if (data && data.length > 0) {
        const all = data.map((r: { role: string }) => r.role as Role);
        setRoles(all);
        const sorted = [...all].sort((a, b) => (ROLE_PRIORITY[b ?? ""] ?? 0) - (ROLE_PRIORITY[a ?? ""] ?? 0));
        setRole(sorted[0]);
      } else {
        setRole(null);
        setRoles([]);
      }
    } finally {
      setRolesLoading(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setRole(null);
    setRoles([]);
  };

  const loading = sessionLoading || (!!user && rolesLoading);

  return (
    <AuthContext.Provider value={{ user, session, role, roles, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
