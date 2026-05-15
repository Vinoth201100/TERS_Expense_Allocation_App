import { useEffect, useState, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format, addDays, startOfWeek, endOfWeek, eachDayOfInterval, isSunday, isToday, parseISO } from "date-fns";
import { Download, Shuffle, ArrowRight, Lock, Check, X, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { AABranchMapping } from "@/components/AABranchMapping";

type RoleName = "admin" | "auditor" | "team_lead" | "expense_auditor";
type LeaveType = "emergency" | "sick" | "planned" | "optional";

interface Member {
  user_id: string;
  full_name: string;
  email: string;
  roles: RoleName[];
  allocated: number;
  total: number;
}

interface AttRecord {
  user_id: string;
  date: string;
  present: boolean;
  leave_type: string | null;
  benchmark?: number;
}

const ROLE_OPTIONS: { value: RoleName; label: string }[] = [
  { value: "auditor", label: "Auditor" },
  { value: "expense_auditor", label: "Expense Auditor" },
  { value: "team_lead", label: "Team Lead" },
  { value: "admin", label: "Admin" },
];

const TeamPage = () => {
  const { user, role, roles } = useAuth();
  const isManager = role === "admin" || roles.includes("team_lead");
  const [members, setMembers] = useState<Member[]>([]);
  const [attendance, setAttendance] = useState<Map<string, AttRecord>>(new Map());
  const [loading, setLoading] = useState(true);

  // Week range
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [weekEnd, setWeekEnd] = useState<Date>(() => endOfWeek(new Date(), { weekStartsOn: 1 }));
  const days = useMemo(() => eachDayOfInterval({ start: weekStart, end: weekEnd }), [weekStart, weekEnd]);

  // Leave dialog
  const [leaveDialog, setLeaveDialog] = useState<{ userId: string; date: string } | null>(null);
  const [leaveType, setLeaveType] = useState<LeaveType>("planned");

  // Reassign dialog
  const [reassignDialog, setReassignDialog] = useState<Member | null>(null);
  const [reassignTarget, setReassignTarget] = useState<string>("");
  const [reassignAll, setReassignAll] = useState<boolean>(true);
  const [reassignCount, setReassignCount] = useState<string>("");

  // Roles dialog
  const [rolesDialog, setRolesDialog] = useState<Member | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const fromStr = format(weekStart, "yyyy-MM-dd");
    const toStr = format(weekEnd, "yyyy-MM-dd");
    const [{ data: profiles }, { data: roles }, { data: att }, { data: lines }] = await Promise.all([
      supabase.from("profiles").select("user_id, full_name, email"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("attendance").select("user_id, date, present, leave_type, benchmark").gte("date", fromStr).lte("date", toStr),
      supabase.from("lines").select("assigned_to, status"),
    ]);

    const rolesByUser = new Map<string, RoleName[]>();
    (roles ?? []).forEach((r: { user_id: string; role: string }) => {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role as RoleName);
      rolesByUser.set(r.user_id, arr);
    });

    const attMap = new Map<string, AttRecord>();
    (att ?? []).forEach((a: AttRecord) => {
      attMap.set(`${a.user_id}|${a.date}`, a);
    });
    setAttendance(attMap);

    const allocCount = new Map<string, number>();
    const totalCount = new Map<string, number>();
    (lines ?? []).forEach((l: { assigned_to: string | null; status: string }) => {
      if (!l.assigned_to) return;
      totalCount.set(l.assigned_to, (totalCount.get(l.assigned_to) ?? 0) + 1);
      if (l.status === "allocated") {
        allocCount.set(l.assigned_to, (allocCount.get(l.assigned_to) ?? 0) + 1);
      }
    });

    const allMembers: Member[] = (profiles ?? []).map((p: { user_id: string; full_name: string; email: string }) => ({
      user_id: p.user_id,
      full_name: p.full_name || "—",
      email: p.email,
      roles: rolesByUser.get(p.user_id) ?? ["auditor"],
      allocated: allocCount.get(p.user_id) ?? 0,
      total: totalCount.get(p.user_id) ?? 0,
    }));
    const m = isManager ? allMembers : allMembers.filter((x) => x.user_id === user?.id);
    setMembers(m);
    setLoading(false);
  }, [weekStart, weekEnd, isManager, user?.id]);

  useEffect(() => { load(); }, [load]);

  const upsertAttendance = async (userId: string, date: string, present: boolean, leave?: LeaveType | null) => {
    const existing = attendance.get(`${userId}|${date}`);
    const payload = {
      user_id: userId,
      date,
      present,
      leave_type: present ? null : (leave ?? null),
      benchmark: existing?.benchmark ?? 0,
    };
    const { error } = await supabase.from("attendance").upsert(payload, { onConflict: "user_id,date" });
    if (error) return toast.error(error.message);
    const next = new Map(attendance);
    next.set(`${userId}|${date}`, payload);
    setAttendance(next);
  };

  const updateBenchmark = async (userId: string, date: string, value: number) => {
    const existing = attendance.get(`${userId}|${date}`);
    const payload = {
      user_id: userId,
      date,
      present: existing?.present ?? true,
      leave_type: existing?.leave_type ?? null,
      benchmark: Math.max(0, Math.floor(value || 0)),
    };
    const { error } = await supabase.from("attendance").upsert(payload, { onConflict: "user_id,date" });
    if (error) return toast.error(error.message);
    const next = new Map(attendance);
    next.set(`${userId}|${date}`, payload);
    setAttendance(next);
  };

  const handleCellClick = (member: Member, day: Date) => {
    if (!isManager) {
      toast.info("Only Team Lead / Admin can edit attendance");
      return;
    }
    if (isSunday(day)) {
      toast.error("Sundays are frozen");
      return;
    }
    const dateStr = format(day, "yyyy-MM-dd");
    const rec = attendance.get(`${member.user_id}|${dateStr}`);
    const currentPresent = rec?.present ?? false;
    if (currentPresent) {
      // Switching to absent → require leave type
      setLeaveType("planned");
      setLeaveDialog({ userId: member.user_id, date: dateStr });
    } else {
      // Switching to present
      upsertAttendance(member.user_id, dateStr, true);
    }
  };

  const confirmLeave = async () => {
    if (!leaveDialog) return;
    await upsertAttendance(leaveDialog.userId, leaveDialog.date, false, leaveType);
    setLeaveDialog(null);
  };

  const reassign = async () => {
    if (!reassignDialog || !reassignTarget) return;
    let limit: number | null = null;
    if (!reassignAll) {
      const n = parseInt(reassignCount, 10);
      if (!Number.isFinite(n) || n <= 0) return toast.error("Enter a positive number of lines");
      if (n > reassignDialog.total) return toast.error(`Only ${reassignDialog.total} lines available`);
      limit = n;
    }
    const { data, error } = await supabase.rpc("reassign_auditor", {
      _from: reassignDialog.user_id,
      _to: reassignTarget,
      _limit: limit,
    });
    if (error) return toast.error(error.message);
    toast.success(`Moved ${data ?? 0} line${data === 1 ? "" : "s"} to ${members.find((m) => m.user_id === reassignTarget)?.full_name ?? "auditor"}`);
    setReassignDialog(null);
    setReassignTarget("");
    setReassignAll(true);
    setReassignCount("");
    load();
  };

  const toggleRole = async (userId: string, role: RoleName, has: boolean) => {
    if (has) {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error) return toast.error(error.message);
    }
    toast.success("Role updated");
    load();
  };

  const exportAttendance = (fmt: "csv" | "xlsx") => {
    const rows = members.flatMap((m) =>
      days.map((d) => {
        const ds = format(d, "yyyy-MM-dd");
        const rec = attendance.get(`${m.user_id}|${ds}`);
        return {
          Auditor: m.full_name,
          Email: m.email,
          Date: ds,
          Day: format(d, "EEE"),
          Status: isSunday(d) ? "Frozen (Sun)" : rec?.present ? "Present" : rec ? "Absent" : "—",
          "Leave Type": rec && !rec.present ? rec.leave_type ?? "" : "",
        };
      })
    );
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    const filename = `attendance_${format(weekStart, "yyyy-MM-dd")}_to_${format(weekEnd, "yyyy-MM-dd")}.${fmt}`;
    if (fmt === "csv") {
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } else {
      XLSX.writeFile(wb, filename);
    }
    toast.success(`Exported ${filename}`);
  };

  const shiftWeek = (delta: number) => {
    setWeekStart((s) => addDays(s, 7 * delta));
    setWeekEnd((e) => addDays(e, 7 * delta));
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title={isManager ? "Team & Attendance" : "My Attendance"}
        description={isManager ? "Weekly attendance tracking with leave reasons. Sundays are frozen." : "View your weekly attendance. Only Team Lead / Admin can edit."}
        action={
          isManager ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => exportAttendance("csv")}>
                <Download className="w-4 h-4 mr-2" /> CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportAttendance("xlsx")}>
                <Download className="w-4 h-4 mr-2" /> Excel
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex-1 min-h-0 overflow-auto px-6 pb-6 pt-4 space-y-4">
        {/* Week selector */}
        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">From</label>
              <Input
                type="date"
                value={format(weekStart, "yyyy-MM-dd")}
                onChange={(e) => setWeekStart(parseISO(e.target.value))}
                className="h-9 w-[150px]"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">To</label>
              <Input
                type="date"
                value={format(weekEnd, "yyyy-MM-dd")}
                onChange={(e) => setWeekEnd(parseISO(e.target.value))}
                className="h-9 w-[150px]"
              />
            </div>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => shiftWeek(-1)}>← Prev week</Button>
              <Button variant="outline" size="sm" onClick={() => {
                const s = startOfWeek(new Date(), { weekStartsOn: 1 });
                setWeekStart(s); setWeekEnd(endOfWeek(new Date(), { weekStartsOn: 1 }));
              }}>This week</Button>
              <Button variant="outline" size="sm" onClick={() => shiftWeek(1)}>Next week →</Button>
            </div>
          </CardContent>
        </Card>

        {/* Attendance grid */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attendance</CardTitle>
            <CardDescription>Click a cell to toggle. Marking absent requires a leave type.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground py-4">Loading…</div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left font-medium text-xs text-muted-foreground py-2 px-3 sticky left-0 bg-card z-10 min-w-[200px]">Auditor</th>
                      {days.map((d) => (
                        <th key={d.toISOString()} className={cn(
                          "text-center font-medium text-xs py-2 px-2 min-w-[80px]",
                          isToday(d) && "bg-accent/30",
                          isSunday(d) && "text-muted-foreground/50",
                        )}>
                          <div>{format(d, "EEE")}</div>
                          <div className="text-[10px] text-muted-foreground tabular-nums">{format(d, "MMM d")}</div>
                        </th>
                      ))}
                      {isManager && <th className="text-center text-xs text-muted-foreground py-2 px-3 min-w-[110px]" title="Today's lines target — used by allocation">Benchmark (today)</th>}
                      {isManager && <th className="text-right text-xs text-muted-foreground py-2 px-3 min-w-[140px]">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.user_id} className="border-b border-border hover:bg-accent/20">
                        <td className="py-2 px-3 sticky left-0 bg-card">
                          <div className="font-medium">{m.full_name}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                            {m.roles.map((r) => (
                              <Badge key={r} variant={r === "admin" ? "default" : "secondary"} className="text-[9px] font-normal py-0 px-1.5">{r}</Badge>
                            ))}
                            <span className="text-muted-foreground">· {m.allocated} alloc.</span>
                          </div>
                        </td>
                        {days.map((d) => {
                          const ds = format(d, "yyyy-MM-dd");
                          const rec = attendance.get(`${m.user_id}|${ds}`);
                          const sunday = isSunday(d);
                          return (
                            <td key={ds} className={cn("py-2 px-2 text-center", isToday(d) && "bg-accent/20")}>
                              {sunday ? (
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground/40" title="Sundays are frozen">
                                  <Lock className="w-3 h-3" />
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleCellClick(m, d)}
                                  className={cn(
                                    "inline-flex items-center justify-center w-7 h-7 rounded transition-colors",
                                    rec?.present && "bg-[hsl(var(--success))]/20 text-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/30",
                                    rec && !rec.present && "bg-destructive/15 text-destructive hover:bg-destructive/25",
                                    !rec && "bg-muted text-muted-foreground hover:bg-muted-foreground/20",
                                  )}
                                  title={rec ? (rec.present ? "Present" : `Absent (${rec.leave_type ?? "no reason"})`) : "Not marked"}
                                >
                                  {rec?.present ? <Check className="w-3.5 h-3.5" /> : rec ? <X className="w-3.5 h-3.5" /> : "—"}
                                </button>
                              )}
                            </td>
                          );
                        })}
                        {isManager && (
                          <td className="py-2 px-2 text-center">
                            <Input
                              type="number"
                              min={0}
                              value={attendance.get(`${m.user_id}|${format(new Date(), "yyyy-MM-dd")}`)?.benchmark ?? 0}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                const ds = format(new Date(), "yyyy-MM-dd");
                                const next = new Map(attendance);
                                const cur = next.get(`${m.user_id}|${ds}`) ?? { user_id: m.user_id, date: ds, present: true, leave_type: null, benchmark: 0 };
                                next.set(`${m.user_id}|${ds}`, { ...cur, benchmark: v });
                                setAttendance(next);
                              }}
                              onBlur={(e) => updateBenchmark(m.user_id, format(new Date(), "yyyy-MM-dd"), Number(e.target.value))}
                              className="h-8 w-20 text-sm text-center mx-auto"
                            />
                          </td>
                        )}
                        {isManager && (
                          <td className="py-2 px-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setRolesDialog(m)} title="Manage roles">
                                <UserCog className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="sm" variant="outline" className="h-7" onClick={() => { setReassignDialog(m); setReassignTarget(""); setReassignAll(true); setReassignCount(""); }}>
                                <Shuffle className="w-3.5 h-3.5 mr-1" /> Reassign
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {isManager && <AABranchMapping />}
      </div>

      {/* Leave dialog */}
      <Dialog open={!!leaveDialog} onOpenChange={(o) => !o && setLeaveDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark absent</DialogTitle>
            <DialogDescription>Select a leave type to record this absence.</DialogDescription>
          </DialogHeader>
          <Select value={leaveType} onValueChange={(v) => setLeaveType(v as LeaveType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="emergency">Emergency</SelectItem>
              <SelectItem value="sick">Sick</SelectItem>
              <SelectItem value="planned">Planned</SelectItem>
              <SelectItem value="optional">Optional</SelectItem>
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaveDialog(null)}>Cancel</Button>
            <Button onClick={confirmLeave}>Confirm absent</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reassign dialog */}
      <Dialog open={!!reassignDialog} onOpenChange={(o) => !o && setReassignDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign lines</DialogTitle>
            <DialogDescription>
              Move lines from <strong>{reassignDialog?.full_name}</strong> to another auditor.
              They have <strong>{reassignDialog?.total ?? 0}</strong> total ({reassignDialog?.allocated ?? 0} still allocated).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Badge variant="secondary">{reassignDialog?.full_name}</Badge>
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
              <Select value={reassignTarget} onValueChange={setReassignTarget}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Select target auditor…" /></SelectTrigger>
                <SelectContent>
                  {members.filter((x) => x.user_id !== reassignDialog?.user_id).map((x) => (
                    <SelectItem key={x.user_id} value={x.user_id}>{x.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">How many lines?</div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    checked={reassignAll}
                    onChange={() => setReassignAll(true)}
                  />
                  All lines ({reassignDialog?.total ?? 0})
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    checked={!reassignAll}
                    onChange={() => setReassignAll(false)}
                  />
                  Specific count
                </label>
                <Input
                  type="number"
                  min={1}
                  max={reassignDialog?.total ?? undefined}
                  placeholder="e.g. 50"
                  value={reassignCount}
                  onChange={(e) => { setReassignCount(e.target.value); setReassignAll(false); }}
                  disabled={reassignAll}
                  className="h-9 w-32"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                When you pick a count, the oldest still-allocated lines move first.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignDialog(null)}>Cancel</Button>
            <Button onClick={reassign} disabled={!reassignTarget || (!reassignAll && !reassignCount)}>Reassign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Roles dialog */}
      <Dialog open={!!rolesDialog} onOpenChange={(o) => !o && setRolesDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage roles · {rolesDialog?.full_name}</DialogTitle>
            <DialogDescription>Toggle roles for this user. Team Leads and Expense Auditors get access to the Review Queue.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {rolesDialog && ROLE_OPTIONS.map((opt) => {
              const has = rolesDialog.roles.includes(opt.value);
              return (
                <div key={opt.value} className="flex items-center justify-between p-2 rounded border border-border">
                  <span className="text-sm">{opt.label}</span>
                  <Button
                    size="sm"
                    variant={has ? "default" : "outline"}
                    onClick={async () => {
                      await toggleRole(rolesDialog.user_id, opt.value, has);
                      // Sync local state in dialog
                      setRolesDialog((prev) => prev ? {
                        ...prev,
                        roles: has ? prev.roles.filter((r) => r !== opt.value) : [...prev.roles, opt.value],
                      } : prev);
                    }}
                  >
                    {has ? "Assigned" : "Assign"}
                  </Button>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRolesDialog(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TeamPage;
