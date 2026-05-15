import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListChecks, CheckCircle2, AlertTriangle, TrendingUp, ClipboardCheck, XCircle, ArrowUpRight, PauseCircle } from "lucide-react";
import { format, startOfWeek, startOfMonth, subDays } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";

interface QAStats { allocated: number; completed: number; issues: number; weekCompleted: number; }
interface AAStats { allocated: number; approved: number; rejected: number; escalated: number; exception: number; }

type Range = "daily" | "weekly";
type Viz = "table" | "pie" | "trend";
type TeamView = "qa" | "aa";

const Dashboard = () => {
  const { user, role, roles } = useAuth();
  const isAdmin = role === "admin";
  const isTeamLead = roles.includes("team_lead") && !isAdmin;
  const showTeamPanel = isAdmin || isTeamLead;

  // Personal QA stats (everyone)
  const [stats, setStats] = useState<QAStats>({ allocated: 0, completed: 0, issues: 0, weekCompleted: 0 });
  const [chart, setChart] = useState<{ day: string; completed: number; issues: number }[]>([]);

  // TL/Admin team panels
  const [teamView, setTeamView] = useState<TeamView>("qa");
  const [tlRange, setTlRange] = useState<Range>("daily");
  const [tlViz, setTlViz] = useState<Viz>("table");
  const [personFilter, setPersonFilter] = useState<string>("all");

  // QA team breakdown
  const [qaTeam, setQaTeam] = useState<{ id: string; name: string; allocated: number; completed: number; issues: number }[]>([]);
  // AA team breakdown
  const [aaTeam, setAaTeam] = useState<{ id: string; name: string; allocated: number; approved: number; rejected: number; escalated: number; exception: number }[]>([]);

  useEffect(() => {
    const load = async () => {
      if (!user) return;

      // Personal cards (always scoped to own data unless admin/TL)
      const buildQuery = (status: "allocated" | "completed" | "issue") => {
        let q = supabase.from("lines").select("id", { count: "exact", head: true }).eq("status", status);
        if (!isAdmin && !isTeamLead) q = q.eq("assigned_to", user.id);
        return q;
      };
      const [a, c, i] = await Promise.all([buildQuery("allocated"), buildQuery("completed"), buildQuery("issue")]);
      const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
      let wq = supabase
        .from("lines")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed")
        .gte("qc_completed_at", weekStart);
      if (!isAdmin && !isTeamLead) wq = wq.eq("assigned_to", user.id);
      const w = await wq;

      setStats({
        allocated: a.count ?? 0,
        completed: c.count ?? 0,
        issues: i.count ?? 0,
        weekCompleted: w.count ?? 0,
      });

      // 7-day trend
      const since = format(subDays(new Date(), 6), "yyyy-MM-dd");
      let lq = supabase
        .from("lines")
        .select("status, qc_completed_at, assigned_to")
        .gte("qc_completed_at", since)
        .not("qc_completed_at", "is", null);
      if (!isAdmin && !isTeamLead) lq = lq.eq("assigned_to", user.id);
      const { data: lines } = await lq;

      const days: Record<string, { completed: number; issues: number }> = {};
      for (let d = 6; d >= 0; d--) {
        const k = format(subDays(new Date(), d), "MMM d");
        days[k] = { completed: 0, issues: 0 };
      }
      (lines ?? []).forEach((l: { status: string; qc_completed_at: string }) => {
        const k = format(new Date(l.qc_completed_at), "MMM d");
        if (!days[k]) return;
        if (l.status === "completed") days[k].completed++;
        else if (l.status === "issue") days[k].issues++;
      });
      setChart(Object.entries(days).map(([day, v]) => ({ day, ...v })));

      // ===== TL/Admin panels =====
      if (showTeamPanel) {
        const fromDate = isTeamLead
          ? (tlRange === "daily" ? format(new Date(), "yyyy-MM-dd") : weekStart)
          : format(startOfMonth(new Date()), "yyyy-MM-dd");

        const [{ data: profiles }, { data: rolesData }] = await Promise.all([
          supabase.from("profiles").select("user_id, full_name"),
          supabase.from("user_roles").select("user_id, role"),
        ]);
        const profileMap = new Map<string, string>();
        (profiles ?? []).forEach((p: { user_id: string; full_name: string }) => {
          profileMap.set(p.user_id, p.full_name || "—");
        });
        const qaUserIds = new Set<string>();
        const aaUserIds = new Set<string>();
        (rolesData ?? []).forEach((r: { user_id: string; role: string }) => {
          if (r.role === "auditor") qaUserIds.add(r.user_id);
          if (r.role === "expense_auditor") aaUserIds.add(r.user_id);
        });

        // QA breakdown — restrict to users with the 'auditor' role
        const { data: qaLines } = await supabase
          .from("lines")
          .select("status, assigned_to, qc_completed_at");
        const qaMap = new Map<string, { id: string; name: string; allocated: number; completed: number; issues: number }>();
        qaUserIds.forEach((id) => qaMap.set(id, { id, name: profileMap.get(id) ?? "—", allocated: 0, completed: 0, issues: 0 }));
        (qaLines ?? []).forEach((l: { status: string; assigned_to: string | null; qc_completed_at: string | null }) => {
          if (!l.assigned_to || !qaMap.has(l.assigned_to)) return;
          const e = qaMap.get(l.assigned_to)!;
          if (l.status === "allocated") e.allocated++;
          else if (l.qc_completed_at && l.qc_completed_at >= fromDate) {
            if (l.status === "completed") e.completed++;
            else if (l.status === "issue") e.issues++;
          }
        });
        setQaTeam(Array.from(qaMap.values()));

        // EA breakdown — show all expense_auditors (with 0s if no activity)
        const { data: aaLines } = await supabase
          .from("ea_lines")
          .select("status, assigned_ea, decided_at");
        const aaMap = new Map<string, { id: string; name: string; allocated: number; approved: number; rejected: number; escalated: number; exception: number }>();
        aaUserIds.forEach((id) => aaMap.set(id, { id, name: profileMap.get(id) ?? "—", allocated: 0, approved: 0, rejected: 0, escalated: 0, exception: 0 }));
        (aaLines ?? []).forEach((l: { status: string | null; assigned_ea: string | null; decided_at: string | null }) => {
          if (!l.assigned_ea || !aaMap.has(l.assigned_ea) || !l.status) return;
          const e = aaMap.get(l.assigned_ea)!;
          if (l.status === "allocated" || l.status === "exception") {
            (e as unknown as Record<string, number>)[l.status]++;
          } else if (l.decided_at && l.decided_at >= fromDate) {
            if (l.status === "approved") e.approved++;
            else if (l.status === "rejected") e.rejected++;
            else if (l.status === "escalated") e.escalated++;
          }
        });
        setAaTeam(Array.from(aaMap.values()));
      }
    };
    load();
  }, [user, role, isAdmin, isTeamLead, tlRange, showTeamPanel]);

  const filteredQa = useMemo(
    () => personFilter === "all" ? qaTeam : qaTeam.filter((t) => t.id === personFilter),
    [qaTeam, personFilter]
  );
  const filteredAa = useMemo(
    () => personFilter === "all" ? aaTeam : aaTeam.filter((t) => t.id === personFilter),
    [aaTeam, personFilter]
  );

  const peopleOptions = teamView === "qa" ? qaTeam : aaTeam;

  const qaPieData = useMemo(() => filteredQa.flatMap((t) => [
    { name: `${t.name} · Completed`, value: t.completed },
    { name: `${t.name} · Issues`, value: t.issues },
  ]).filter((p) => p.value > 0), [filteredQa]);

  const aaPieData = useMemo(() => filteredAa.flatMap((t) => [
    { name: `${t.name} · Approved`, value: t.approved },
    { name: `${t.name} · Rejected`, value: t.rejected },
    { name: `${t.name} · Escalated`, value: t.escalated },
    { name: `${t.name} · Exception`, value: t.exception },
  ]).filter((p) => p.value > 0), [filteredAa]);

  const COLORS = ["hsl(var(--primary))", "hsl(var(--warning))", "hsl(var(--success))", "hsl(var(--destructive))", "hsl(var(--accent-foreground))", "hsl(var(--muted-foreground))"];

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Dashboard"
        description={isAdmin ? "Team productivity overview" : isTeamLead ? "QA and Expense Auditor performance" : "Your daily summary"}
      />
      <div className="flex-1 min-h-0 overflow-y-auto p-8 space-y-6">
        {/* Personal cards — always shown for everyone */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={ListChecks} label="Allocated" value={stats.allocated} tone="default" />
          <StatCard icon={CheckCircle2} label="Completed" value={stats.completed} tone="success" />
          <StatCard icon={AlertTriangle} label="Issues" value={stats.issues} tone="warning" />
          <StatCard icon={TrendingUp} label="This week" value={stats.weekCompleted} tone="primary" />
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Last 7 days</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Bar dataKey="completed" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="issues" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* TL / Admin team panel with QA / AA toggle */}
        {showTeamPanel && (
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">Team performance</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  {isTeamLead && (
                    <div className="flex rounded-md border border-border overflow-hidden text-xs">
                      <button className={`px-3 py-1 ${tlRange === "daily" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`} onClick={() => setTlRange("daily")}>Daily</button>
                      <button className={`px-3 py-1 border-l border-border ${tlRange === "weekly" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`} onClick={() => setTlRange("weekly")}>Weekly</button>
                    </div>
                  )}
                  <div className="flex rounded-md border border-border overflow-hidden text-xs">
                    <button className={`px-3 py-1 ${tlViz === "table" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`} onClick={() => setTlViz("table")}>Table</button>
                    <button className={`px-3 py-1 border-l border-border ${tlViz === "pie" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`} onClick={() => setTlViz("pie")}>+ Pie</button>
                    <button className={`px-3 py-1 border-l border-border ${tlViz === "trend" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`} onClick={() => setTlViz("trend")}>+ Trend</button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Tabs value={teamView} onValueChange={(v) => { setTeamView(v as TeamView); setPersonFilter("all"); }}>
                  <TabsList>
                    <TabsTrigger value="qa"><ListChecks className="w-3.5 h-3.5 mr-1.5" /> QA Team</TabsTrigger>
                    <TabsTrigger value="aa"><ClipboardCheck className="w-3.5 h-3.5 mr-1.5" /> Expense Auditors</TabsTrigger>
                  </TabsList>
                </Tabs>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Person:</span>
                  <Select value={personFilter} onValueChange={setPersonFilter}>
                    <SelectTrigger className="h-8 text-xs w-[200px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All {teamView === "qa" ? "QA" : "AA"}</SelectItem>
                      {peopleOptions.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {teamView === "qa" ? (
                filteredQa.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4">No QA activity in this range.</div>
                ) : (
                  <>
                    <div className="overflow-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-xs text-muted-foreground">
                            <th className="py-2 px-3">QA Auditor</th>
                            <th className="py-2 px-3 text-right">Allocated</th>
                            <th className="py-2 px-3 text-right">Completed</th>
                            <th className="py-2 px-3 text-right">Issues</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredQa.map((t) => (
                            <tr key={t.id} className="border-b border-border">
                              <td className="py-2 px-3 font-medium">{t.name}</td>
                              <td className="py-2 px-3 text-right tabular-nums">{t.allocated}</td>
                              <td className="py-2 px-3 text-right tabular-nums">{t.completed}</td>
                              <td className="py-2 px-3 text-right tabular-nums">{t.issues}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {tlViz === "pie" && qaPieData.length > 0 && (
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={qaPieData} dataKey="value" nameKey="name" outerRadius={90} label>
                              {qaPieData.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                            </Pie>
                            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    {tlViz === "trend" && (
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chart}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Line type="monotone" dataKey="completed" stroke="hsl(var(--primary))" strokeWidth={2} />
                            <Line type="monotone" dataKey="issues" stroke="hsl(var(--warning))" strokeWidth={2} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </>
                )
              ) : (
                filteredAa.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4">No Expense Auditor activity in this range.</div>
                ) : (
                  <>
                    <div className="overflow-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-xs text-muted-foreground">
                            <th className="py-2 px-3">Expense Auditor</th>
                            <th className="py-2 px-3 text-right">Allocated</th>
                            <th className="py-2 px-3 text-right">Approved</th>
                            <th className="py-2 px-3 text-right">Rejected</th>
                            <th className="py-2 px-3 text-right">Escalated</th>
                            <th className="py-2 px-3 text-right">Exception</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredAa.map((t) => (
                            <tr key={t.id} className="border-b border-border">
                              <td className="py-2 px-3 font-medium">{t.name}</td>
                              <td className="py-2 px-3 text-right tabular-nums">{t.allocated}</td>
                              <td className="py-2 px-3 text-right tabular-nums">{t.approved}</td>
                              <td className="py-2 px-3 text-right tabular-nums">{t.rejected}</td>
                              <td className="py-2 px-3 text-right tabular-nums">{t.escalated}</td>
                              <td className="py-2 px-3 text-right tabular-nums">{t.exception}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <MiniStat icon={ListChecks} label="Allocated" value={filteredAa.reduce((s, t) => s + t.allocated, 0)} />
                      <MiniStat icon={CheckCircle2} label="Approved" value={filteredAa.reduce((s, t) => s + t.approved, 0)} tone="success" />
                      <MiniStat icon={XCircle} label="Rejected" value={filteredAa.reduce((s, t) => s + t.rejected, 0)} tone="destructive" />
                      <MiniStat icon={ArrowUpRight} label="Escalated" value={filteredAa.reduce((s, t) => s + t.escalated, 0)} tone="warning" />
                    </div>
                    {tlViz === "pie" && aaPieData.length > 0 && (
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={aaPieData} dataKey="value" nameKey="name" outerRadius={90} label>
                              {aaPieData.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                            </Pie>
                            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    {tlViz === "trend" && (
                      <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">
                        Trend view for AA decisions coming soon.
                      </div>
                    )}
                  </>
                )
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

const StatCard = ({
  icon: Icon, label, value, tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: number;
  tone: "default" | "success" | "warning" | "primary";
}) => {
  const toneClass = {
    default: "bg-secondary text-secondary-foreground",
    success: "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]",
    warning: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]",
    primary: "bg-accent text-accent-foreground",
  }[tone];
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="text-3xl font-semibold mt-1 tabular-nums">{value}</div>
          </div>
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${toneClass}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const MiniStat = ({
  icon: Icon, label, value, tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: number;
  tone?: "default" | "success" | "warning" | "destructive";
}) => {
  const toneClass = {
    default: "bg-muted text-muted-foreground",
    success: "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]",
    warning: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]",
    destructive: "bg-destructive/10 text-destructive",
  }[tone];
  return (
    <div className="rounded-md border border-border p-3 flex items-center gap-3">
      <div className={`w-8 h-8 rounded-md flex items-center justify-center ${toneClass}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold tabular-nums leading-tight">{value}</div>
      </div>
    </div>
  );
};

export default Dashboard;
