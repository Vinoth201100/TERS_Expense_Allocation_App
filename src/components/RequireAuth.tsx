import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth, Role } from "@/hooks/useAuth";
import AccessDenied from "@/pages/AccessDenied";

export const RequireAuth = ({
  children,
  adminOnly = false,
  allowedRoles,
  module,
}: {
  children: ReactNode;
  adminOnly?: boolean;
  allowedRoles?: Role[];
  module?: string;
}) => {
  const { user, role, roles, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (adminOnly && role !== "admin") return <AccessDenied module={module} />;
  if (allowedRoles && allowedRoles.length > 0) {
    const ok = roles.some((r) => allowedRoles.includes(r)) || role === "admin";
    if (!ok) return <AccessDenied module={module} />;
  }
  return <>{children}</>;
};
