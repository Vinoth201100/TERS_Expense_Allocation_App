import { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Inbox, Upload, Users, LogOut, Shield, ClipboardCheck, Target, Database, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const NavItem = ({ to, icon: Icon, label }: { to: string; icon: React.ComponentType<{ className?: string }>; label: string }) => (
  <NavLink
    to={to}
    end
    className={({ isActive }) =>
      cn(
        "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
      )
    }
  >
    <Icon className="w-4 h-4" />
    {label}
  </NavLink>
);

export const AppLayout = ({ children }: { children: ReactNode }) => {
  const { user, role, roles, signOut } = useAuth();
  const nav = useNavigate();

  const isAdmin = role === "admin";
  const isTeamLead = roles.includes("team_lead");
  const isApprovedAuditor = roles.includes("expense_auditor");
  const isQAAuditor = roles.includes("auditor");
  // EA-only: hide every QA module (Dashboard, My Queue, Review Queue, Upload, Team).
  const eaOnly = isApprovedAuditor && !isAdmin && !isTeamLead && !isQAAuditor;
  // QA-only: hide every EA module (EA Queue, EA Dashboard).
  const qaOnly = isQAAuditor && !isAdmin && !isTeamLead && !isApprovedAuditor;

  // Review (TL feedback) queue is for TLs / admins only — EAs no longer access it.
  const canSeeReviewQueue = isTeamLead || isAdmin;
  const canManageTeam = isAdmin || isTeamLead;

  const handleSignOut = async () => {
    await signOut();
    nav("/auth", { replace: true });
  };

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <aside className="w-60 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border shrink-0">
        <div className="px-4 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
              <span className="text-primary-foreground font-bold text-sm">A</span>
            </div>
            <div>
              <div className="text-sm font-semibold">TERS Applications</div>
              <div className="text-xs text-sidebar-foreground/60">Expense reimbursement audit</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {eaOnly ? (
            <>
              <div className="pb-1 px-3 text-[10px] uppercase tracking-wider text-sidebar-foreground/40">Expense Auditor</div>
              <NavItem to="/ea/dashboard" icon={LayoutDashboard} label="EA Dashboard" />
            </>
          ) : (
            <>
              <div className="pb-1 px-3 text-[10px] uppercase tracking-wider text-sidebar-foreground/40">QA Auditor</div>
              <NavItem to="/" icon={LayoutDashboard} label="QA Dashboard" />
              <NavItem to="/my-queue" icon={Inbox} label="My Queue" />
            </>
          )}
          {/* EA section — hidden from QA-only users. */}
          {isApprovedAuditor && !qaOnly && !eaOnly && (
            <>
              <div className="pt-4 pb-1 px-3 text-[10px] uppercase tracking-wider text-sidebar-foreground/40">Expense Auditor</div>
              <NavItem to="/ea/dashboard" icon={LayoutDashboard} label="EA Dashboard" />
              <NavItem to="/ea/queue" icon={ClipboardCheck} label="My EA Queue" />
            </>
          )}
          {/* Self-attendance for QA / EA auditors who are NOT TL or Admin. */}
          {!canManageTeam && (isQAAuditor || isApprovedAuditor) && (
            <NavItem to="/team" icon={Users} label="My Attendance" />
          )}
          <div className="pt-4 pb-1 px-3 text-[10px] uppercase tracking-wider text-sidebar-foreground/40">AI Dashboard</div>
          <NavItem to="/ai-analysis" icon={Sparkles} label="AI Analysis" />
          {(canSeeReviewQueue || canManageTeam) && (
            <>
              <div className="pt-4 pb-1 px-3 text-[10px] uppercase tracking-wider text-sidebar-foreground/40">TL / Admin</div>
              {canSeeReviewQueue && <NavItem to="/queue" icon={Inbox} label="Review Queue" />}
              {canManageTeam && <NavItem to="/upload" icon={Upload} label="Upload & Allocate" />}
              {canManageTeam && (isTeamLead || isAdmin) && (
                <NavItem to="/benchmarks" icon={Target} label="Benchmarks" />
              )}
              {(isTeamLead || isAdmin) && (
                <NavItem to="/main-database" icon={Database} label="Main Database" />
              )}
              {/* TL/Admin always see full Team & Attendance grid. */}
              <NavItem to="/team" icon={Users} label="Team & Attendance" />
              {canManageTeam && isAdmin && <NavItem to="/admin" icon={Shield} label="Admin Control" />}
            </>
          )}
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <div className="px-2 pb-2">
            <div className="text-xs text-sidebar-foreground/90 truncate">{user?.email}</div>
            <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50 mt-0.5">{role ?? "no role"}</div>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent" onClick={handleSignOut}>
            <LogOut className="w-4 h-4 mr-2" /> Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">{children}</main>
    </div>
  );
};
