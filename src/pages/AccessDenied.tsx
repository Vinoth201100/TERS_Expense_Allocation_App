import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

const AccessDenied = ({ module }: { module?: string }) => {
  const { user, role } = useAuth();

  useEffect(() => {
    // Best-effort audit log of unauthorized access attempts
    // Failures are silent — this is informational only.
    try {
      // eslint-disable-next-line no-console
      console.warn("[RBAC] Access denied", {
        user_id: user?.id ?? null,
        role: role ?? null,
        module: module ?? "unknown",
        path: typeof window !== "undefined" ? window.location.pathname : null,
        at: new Date().toISOString(),
      });
    } catch {
      /* noop */
    }
  }, [user, role, module]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
          <ShieldAlert className="w-7 h-7 text-destructive" />
        </div>
        <h1 className="text-xl font-semibold">Access denied</h1>
        <p className="text-sm text-muted-foreground">
          You are not authorized to view this module.
          {module ? <> <span className="text-foreground/80">({module})</span></> : null}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/">Go to your dashboard</Link>
        </Button>
      </div>
    </div>
  );
};

export default AccessDenied;
