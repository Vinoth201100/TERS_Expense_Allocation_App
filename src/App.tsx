import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { RequireAuth } from "@/components/RequireAuth";
import { AppLayout } from "@/components/AppLayout";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import MyQueue from "./pages/MyQueue";
import Queue from "./pages/Queue";
import UploadPage from "./pages/UploadPage";
import TeamPage from "./pages/TeamPage";
import AdminPage from "./pages/AdminPage";
import BenchmarksPage from "./pages/BenchmarksPage";
import MainDatabase from "./pages/MainDatabase";
import EAQueue from "./pages/EAQueue";
import EADashboard from "./pages/EADashboard";
import AIAnalysis from "./pages/AIAnalysis";
import NotFound from "./pages/NotFound.tsx";
import type { Role } from "@/hooks/useAuth";

const queryClient = new QueryClient();

const Shell = ({
  children,
  adminOnly = false,
  allowedRoles,
  module,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
  allowedRoles?: Role[];
  module?: string;
}) => (
  <RequireAuth adminOnly={adminOnly} allowedRoles={allowedRoles} module={module}>
    <AppLayout>{children}</AppLayout>
  </RequireAuth>
);

// EA-only users land directly on the EA dashboard. Anyone with QA capability
// (auditor / team_lead / admin) sees the QA dashboard at "/".
const HomeRedirect = () => {
  const { roles, role, loading } = useAuth();
  if (loading) return null;
  const isEAOnly =
    roles.includes("expense_auditor") &&
    !roles.includes("auditor") &&
    !roles.includes("team_lead") &&
    role !== "admin";
  if (isEAOnly) return <Navigate to="/ea/dashboard" replace />;
  return <Dashboard />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            {/* QA Dashboard is for QA auditors, TLs, and admins. EA-only users are redirected to /ea/dashboard. */}
            <Route
              path="/"
              element={
                <Shell allowedRoles={["auditor", "team_lead", "expense_auditor"]} module="Dashboard">
                  <HomeRedirect />
                </Shell>
              }
            />
            {/* QA-only "My Queue" — explicitly NOT for EA-only users. */}
            <Route
              path="/my-queue"
              element={
                <Shell allowedRoles={["auditor", "team_lead"]} module="QA My Queue">
                  <MyQueue />
                </Shell>
              }
            />
            {/* Back-compat redirects from old per-status routes */}
            <Route path="/allocated" element={<Navigate to="/my-queue?tab=allocated" replace />} />
            <Route path="/completed" element={<Navigate to="/my-queue?tab=completed" replace />} />
            <Route path="/issues" element={<Navigate to="/my-queue?tab=issue" replace />} />
            <Route path="/duplicates" element={<Navigate to="/my-queue?tab=duplicate" replace />} />
            {/* TL feedback / review queue — TLs and admins only. EAs are excluded. */}
            <Route
              path="/queue"
              element={
                <Shell allowedRoles={["team_lead"]} module="Review Queue">
                  <Queue />
                </Shell>
              }
            />
            <Route
              path="/ea/queue"
              element={
                <Shell allowedRoles={["expense_auditor"]} module="EA Queue">
                  <EAQueue />
                </Shell>
              }
            />
            <Route
              path="/ea/dashboard"
              element={
                <Shell allowedRoles={["expense_auditor"]} module="EA Dashboard">
                  <EADashboard />
                </Shell>
              }
            />
            <Route path="/aa/queue" element={<Navigate to="/ea/queue" replace />} />
            <Route path="/aa/dashboard" element={<Navigate to="/ea/dashboard" replace />} />
            <Route
              path="/upload"
              element={
                <Shell allowedRoles={["team_lead"]} module="Upload & Allocate">
                  <UploadPage />
                </Shell>
              }
            />
            <Route
              path="/team"
              element={
                <Shell allowedRoles={["team_lead", "auditor", "expense_auditor"]} module="Team & Attendance">
                  <TeamPage />
                </Shell>
              }
            />
            <Route
              path="/benchmarks"
              element={
                <Shell allowedRoles={["team_lead"]} module="Benchmarks">
                  <BenchmarksPage />
                </Shell>
              }
            />
            <Route
              path="/main-database"
              element={
                <Shell allowedRoles={["team_lead"]} module="Main Database">
                  <MainDatabase />
                </Shell>
              }
            />
            <Route
              path="/ai-analysis"
              element={
                <Shell module="AI Analysis">
                  <AIAnalysis />
                </Shell>
              }
            />
            <Route path="/admin" element={<Shell adminOnly module="Admin Control"><AdminPage /></Shell>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
