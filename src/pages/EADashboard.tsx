import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Inbox, CheckCircle2, XCircle, ArrowUpRight, PauseCircle, Clock } from "lucide-react";
import { differenceInBusinessDays, format, subDays } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface EAStats { allocated: number; approved: number; rejected: number; escalated: number; exception: number; agingAvg: number; }

const EADashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<EAStats>({ allocated: 0, approved: 0, rejected: 0, escalated: 0, exception: 0, agingAvg: 0 });
  const [chart, setChart] = useState<{ day: string; approved: number; rejected: number }[]>([]);
  const [branches, setBranches] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    const today = format(new Date(), "yyyy-MM-dd");
    const load = async () => {
      const statuses = ["allocated", "approved", "rejected", "escalated", "exception"] as const;
      const counts = await Promise.all(statuses.map((s) =>
        supabase.from("ea_lines" as never).select("id", { count: "exact", head: true })
          .eq("assigned_ea", user.id).eq("status", s)
      ));
      const c: Record<string, number> = {};
      statuses.forEach((s, i) => { c[s] = (counts[i] as { count: number | null }).count ?? 0; });

      const { data: alloc } = await supabase
        .from("ea_lines" as never)
        .select("allocated_date")
        .eq("assigned_ea", user.id).eq("status", "allocated")
        .not("allocated_date", "is", null);
      let agingAvg = 0;
      const aRows = (alloc ?? []) as Array<{ allocated_date: string }>;
      if (aRows.length > 0) {
        const sum = aRows.reduce((s, l) => s + Math.max(0, differenceInBusinessDays(new Date(today), new Date(l.allocated_date))), 0);
        agingAvg = Math.round((sum / aRows.length) * 10) / 10;
      }
      setStats({ allocated: c.allocated, approved: c.approved, rejected: c.rejected, escalated: c.escalated, exception: c.exception, agingAvg });

      const since = format(subDays(new Date(), 6), "yyyy-MM-dd");
      const { data: decisions } = await supabase
        .from("ea_lines" as never)
        .select("status, decided_at")
        .eq("assigned_ea", user.id)
        .gte("decided_at", since)
        .not("decided_at", "is", null);
      const days: Record<string, { approved: number; rejected: number }> = {};
      for (let d = 6; d >= 0; d--) {
        const k = format(subDays(new Date(), d), "MMM d");
        days[k] = { approved: 0, rejected: 0 };
      }
      ((decisions ?? []) as Array<{ status: string; decided_at: string }>).forEach((l) => {
        const k = format(new Date(l.decided_at), "MMM d");
        if (!days[k]) return;
        if (l.status === "approved") days[k].approved++;
        else if (l.status === "rejected") days[k].rejected++;
      });
      setChart(Object.entries(days).map(([day, v]) => ({ day, ...v })));

      const { data: bc } = await supabase.from("aa_branch_codes").select("branch_code").eq("approved_auditor_id", user.id);
      setBranches((bc ?? []).map((b: { branch_code: string }) => b.branch_code));
    };
    load();
  }, [user]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader title="Expense Auditor Dashboard" description="Your daily review activity and pending workload." />
      <div className="flex-1 min-h-0 overflow-y-auto p-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard icon={Inbox} label="Allocated" value={stats.allocated} tone="primary" />
          <StatCard icon={CheckCircle2} label="Approved" value={stats.approved} tone="success" />
          <StatCard icon={XCircle} label="Rejected" value={stats.rejected} tone="destructive" />
          <StatCard icon={ArrowUpRight} label="Escalated" value={stats.escalated} tone="warning" />
          <StatCard icon={PauseCircle} label="Exception" value={stats.exception} tone="muted" />
          <StatCard icon={Clock} label="Avg aging" value={stats.agingAvg} tone="default" suffix="d" />
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Last 7 days · decisions</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Bar dataKey="approved" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="rejected" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Your branch coverage</CardTitle></CardHeader>
          <CardContent>
            {branches.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No branch codes assigned. Ask your Team Lead or Admin to map you to branches in <span className="font-medium">Team & Attendance</span>.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {branches.map((b) => (
                  <span key={b} className="inline-flex items-center px-2.5 py-1 rounded-md bg-accent text-accent-foreground text-xs font-mono">{b}</span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const StatCard = ({ icon: Icon, label, value, tone, suffix }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; tone: "default" | "success" | "warning" | "primary" | "destructive" | "muted"; suffix?: string; }) => {
  const toneClass = {
    default: "bg-secondary text-secondary-foreground",
    success: "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]",
    warning: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]",
    primary: "bg-accent text-accent-foreground",
    destructive: "bg-destructive/10 text-destructive",
    muted: "bg-muted text-muted-foreground",
  }[tone];
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="text-3xl font-semibold mt-1 tabular-nums">{value}{suffix ?? ""}</div>
          </div>
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${toneClass}`}><Icon className="w-5 h-5" /></div>
        </div>
      </CardContent>
    </Card>
  );
};

export default EADashboard;
