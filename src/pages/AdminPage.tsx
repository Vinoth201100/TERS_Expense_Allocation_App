import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { invokeEdgeFunction } from "@/lib/edgeFunctionHelper";
import {
  UserPlus, Trash2, Ban, KeyRound, ShieldCheck, Unlock, Shuffle, RefreshCw,
  ScrollText, Database, Users as UsersIcon, Link2, CheckCircle2, XCircle, Clock,
} from "lucide-react";

type RoleName = "admin" | "auditor" | "team_lead" | "expense_auditor";

interface UserRow {
  user_id: string;
  email: string;
  full_name: string;
  roles: RoleName[];
  banned_until?: string | null;
}
interface Batch {
  id: string;
  filename: string;
  upload_date: string;
  total_lines: number;
  status: string;
  uploaded_by: string;
}
interface AuditRow {
  id: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  reason: string;
  metadata: Record<string, unknown>;
  created_at: string;
}
interface Mapping {
  id: string;
  auditor_id: string;
  team_lead_id: string;
  updated_at: string;
}
interface DeleteRequest {
  id: string;
  batch_id: string;
  requested_by: string;
  requested_at: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewer_id: string | null;
  reviewed_at: string | null;
  decision_reason: string | null;
  assigned_team_lead: string | null;
}

const ROLE_OPTIONS: RoleName[] = ["auditor", "expense_auditor", "team_lead", "admin"];

type ConfirmCfg = {
  title: string;
  description: string;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<void> | void;
};

const AdminPage = () => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [requests, setRequests] = useState<DeleteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmCfg, setConfirmCfg] = useState<ConfirmCfg | null>(null);
  const [reason, setReason] = useState("");

  // Invite
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");

  // Mapping creator
  const [mapAuditor, setMapAuditor] = useState("");
  const [mapTL, setMapTL] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: profiles }, { data: roles }, { data: bs }, { data: al }, { data: maps }, { data: reqs }] = await Promise.all([
      supabase.from("profiles").select("user_id, full_name, email"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("batches").select("*").order("upload_date", { ascending: false }),
      supabase.from("admin_audit_log").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("auditor_team_leads").select("*"),
      supabase.from("batch_delete_requests").select("*").order("requested_at", { ascending: false }),
    ]);
    const rolesByUser = new Map<string, RoleName[]>();
    (roles ?? []).forEach((r: { user_id: string; role: string }) => {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role as RoleName);
      rolesByUser.set(r.user_id, arr);
    });
    setUsers(
      (profiles ?? []).map((p: { user_id: string; full_name: string; email: string }) => ({
        user_id: p.user_id,
        full_name: p.full_name || "—",
        email: p.email,
        roles: rolesByUser.get(p.user_id) ?? [],
      }))
    );
    setBatches((bs ?? []) as Batch[]);
    setAudit((al ?? []) as AuditRow[]);
    setMappings((maps ?? []) as Mapping[]);
    setRequests((reqs ?? []) as DeleteRequest[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const ask = (cfg: ConfirmCfg) => { setReason(""); setConfirmCfg(cfg); };
  const runConfirm = async () => {
    if (!confirmCfg) return;
    if (reason.trim().length < 3) { toast.error("Reason must be at least 3 characters"); return; }
    try {
      await confirmCfg.onConfirm(reason.trim());
      setConfirmCfg(null); setReason("");
    } catch (e) { toast.error((e as Error).message); }
  };

  // ── User actions
  const callAdminUsers = async (op: string, payload: Record<string, unknown>, reason: string) => {
    try {
      const { data, error } = await invokeEdgeFunction(supabase, "admin-users", {
        body: { op, reason, ...payload },
      });

      if (error) {
        console.error(`[admin-users:${op}] Error:`, error.message);
        toast.error("Operation failed", {
          description: error.message,
          duration: 5000,
        });
        throw error;
      }

      if (op === "reset_password" && data?.action_link) {
        try {
          await navigator.clipboard.writeText(data.action_link);
        } catch {
          /* ignore clipboard errors */
        }
        toast.success("Recovery link copied to clipboard", {
          description: "Share it with the user to reset their password.",
          duration: 10000,
        });
      } else {
        toast.success(`${op} done`);
      }
      load();
    } catch (err) {
      console.error(`[admin-users:${op}] Exception:`, err);
      // Error already shown in toast above
    }
  };

  const toggleRole = async (u: UserRow, role: RoleName, has: boolean) => {
    if (has) {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", u.user_id).eq("role", role);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("user_roles").insert({ user_id: u.user_id, role });
      if (error) return toast.error(error.message);
    }
    await supabase.rpc("admin_log_action", {
      _action: has ? "role_revoke" : "role_grant",
      _target_type: "user", _target_id: u.user_id,
      _reason: `${has ? "Revoked" : "Granted"} ${role} for ${u.email}`,
      _metadata: { role },
    });
    toast.success("Role updated"); load();
  };

  // Pre-disable check: warn if user has pending lines
  const askDisable = async (u: UserRow) => {
    const { data, error } = await supabase.rpc("user_pending_workload" as never, { _user_id: u.user_id } as never);
    if (error) { toast.error(error.message); return; }
    const w = (data ?? {}) as { qa_allocated?: number; ea_allocated?: number; qa_issue_review_pending?: number; total?: number };
    const total = w.total ?? 0;
    const lines = [
      w.qa_allocated ? `${w.qa_allocated} QA allocated line${w.qa_allocated === 1 ? "" : "s"}` : null,
      w.ea_allocated ? `${w.ea_allocated} EA allocated line${w.ea_allocated === 1 ? "" : "s"}` : null,
      w.qa_issue_review_pending ? `${w.qa_issue_review_pending} QA issue review${w.qa_issue_review_pending === 1 ? "" : "s"} pending` : null,
    ].filter(Boolean).join(", ");

    if (total > 0) {
      ask({
        title: `⚠️ ${u.full_name || u.email} has ${total} pending item${total === 1 ? "" : "s"}`,
        description: `Before disabling, please reassign: ${lines}. Use Reallocate (in Batches) or unassign in the relevant tabs first. To override and disable anyway, type a reason below — the user will be blocked but their pending items will remain assigned to them.`,
        destructive: true,
        onConfirm: (r) => callAdminUsers("disable", { user_id: u.user_id }, `[OVERRIDE pending=${total}] ${r}`),
      });
    } else {
      ask({
        title: "Disable user",
        description: `${u.email} has no pending items. They will be blocked from signing in.`,
        destructive: true,
        onConfirm: (r) => callAdminUsers("disable", { user_id: u.user_id }, r),
      });
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail) return toast.error("Email required");
    try {
      await callAdminUsers("invite", { email: inviteEmail, full_name: inviteName }, `Invited ${inviteEmail}`);
      setInviteOpen(false); setInviteEmail(""); setInviteName("");
    } catch (e) { toast.error((e as Error).message); }
  };

  // ── Batch actions — now uses approval flow
  const requestBatchDeletion = (b: Batch) =>
    ask({
      title: `Request deletion of "${b.filename}"?`,
      description: `Sends a delete request to the assigned Team Lead for review. ${b.total_lines} lines will be removed only if approved.`,
      destructive: true,
      onConfirm: async (r) => {
        const { error } = await supabase.rpc("request_batch_deletion", { _batch_id: b.id, _reason: r });
        if (error) throw error;
        toast.success("Delete request submitted for approval");
        load();
      },
    });

  const reallocateBatch = (b: Batch) => setReallocCfg({ batch: b, target: "" });
  const [reallocCfg, setReallocCfg] = useState<{ batch: Batch; target: string } | null>(null);
  const [reallocReason, setReallocReason] = useState("");
  const runRealloc = async () => {
    if (!reallocCfg?.target || reallocReason.trim().length < 3) {
      toast.error("Target + reason (3+ chars) required"); return;
    }
    const { data, error } = await supabase.rpc("admin_reallocate_batch", {
      _batch_id: reallocCfg.batch.id, _to: reallocCfg.target, _reason: reallocReason.trim(),
    });
    if (error) return toast.error(error.message);
    toast.success(`Reallocated ${data ?? 0} lines`);
    setReallocCfg(null); setReallocReason(""); load();
  };

  // ── Lines danger zone
  const [lineId, setLineId] = useState("");
  const unlockLine = () =>
    ask({
      title: "Force-unlock line",
      description: `Clear qc_completed_at and reopen line ${lineId} to allocated.`,
      onConfirm: async (r) => {
        const { error } = await supabase.rpc("admin_force_unlock_line", { _line_id: lineId, _reason: r });
        if (error) throw error;
        toast.success("Line unlocked"); setLineId("");
      },
    });
  const deleteLine = () =>
    ask({
      title: "Delete line", description: `Permanently delete line ${lineId}.`, destructive: true,
      onConfirm: async (r) => {
        const { error } = await supabase.rpc("admin_delete_line", { _line_id: lineId, _reason: r });
        if (error) throw error;
        toast.success("Line deleted"); setLineId("");
      },
    });

  // ── Mappings
  const auditors = users.filter((u) => u.roles.includes("auditor") || u.roles.includes("expense_auditor"));
  const teamLeads = users.filter((u) => u.roles.includes("team_lead"));

  const addMapping = async () => {
    if (!mapAuditor || !mapTL) return toast.error("Pick an auditor and a team lead");
    const { error } = await supabase
      .from("auditor_team_leads")
      .upsert({ auditor_id: mapAuditor, team_lead_id: mapTL, created_by: (await supabase.auth.getUser()).data.user?.id }, { onConflict: "auditor_id" });
    if (error) return toast.error(error.message);
    await supabase.rpc("admin_log_action", {
      _action: "map_auditor", _target_type: "user", _target_id: mapAuditor,
      _reason: `Mapped to TL ${userMap.get(mapTL)?.email ?? mapTL}`,
      _metadata: { team_lead_id: mapTL },
    });
    toast.success("Mapping saved"); setMapAuditor(""); setMapTL(""); load();
  };

  const removeMapping = (m: Mapping) =>
    ask({
      title: "Remove mapping",
      description: `Unlink auditor ${userMap.get(m.auditor_id)?.email ?? m.auditor_id} from team lead.`,
      destructive: true,
      onConfirm: async (r) => {
        const { error } = await supabase.from("auditor_team_leads").delete().eq("id", m.id);
        if (error) throw error;
        await supabase.rpc("admin_log_action", {
          _action: "unmap_auditor", _target_type: "user", _target_id: m.auditor_id, _reason: r, _metadata: {},
        });
        toast.success("Mapping removed"); load();
      },
    });

  // ── Approvals
  const approveReq = (req: DeleteRequest) => {
    const b = batches.find((x) => x.id === req.batch_id);
    ask({
      title: `Approve deletion of "${b?.filename ?? req.batch_id.slice(0, 8)}"?`,
      description: `This will delete the batch and all of its lines. This cannot be undone.`,
      destructive: true,
      onConfirm: async (r) => {
        const { error } = await supabase.rpc("approve_batch_deletion", { _request_id: req.id, _decision_reason: r });
        if (error) throw error;
        toast.success("Approved & deleted"); load();
      },
    });
  };
  const rejectReq = (req: DeleteRequest) =>
    ask({
      title: "Reject delete request",
      description: `The batch will be retained. The requester will see the rejection reason.`,
      onConfirm: async (r) => {
        const { error } = await supabase.rpc("reject_batch_deletion", { _request_id: req.id, _decision_reason: r });
        if (error) throw error;
        toast.success("Request rejected"); load();
      },
    });

  const userMap = new Map(users.map((u) => [u.user_id, u]));
  const batchMap = new Map(batches.map((b) => [b.id, b]));
  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Admin Control"
        description="Full administrative access. All destructive actions are logged with a reason."
        action={
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
        }
      />

      <div className="flex-1 min-h-0 overflow-auto px-6 pb-6 pt-4">
        <Tabs defaultValue="users" className="w-full">
          <TabsList>
            <TabsTrigger value="users"><UsersIcon className="w-4 h-4 mr-2" />Users & Roles</TabsTrigger>
            <TabsTrigger value="mappings"><Link2 className="w-4 h-4 mr-2" />Mappings</TabsTrigger>
            <TabsTrigger value="batches"><Database className="w-4 h-4 mr-2" />Batches</TabsTrigger>
            <TabsTrigger value="approvals">
              <Clock className="w-4 h-4 mr-2" />Approvals
              {pendingCount > 0 && <Badge className="ml-2" variant="destructive">{pendingCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="lines"><Unlock className="w-4 h-4 mr-2" />Lines</TabsTrigger>
            <TabsTrigger value="audit"><ScrollText className="w-4 h-4 mr-2" />Audit Log</TabsTrigger>
          </TabsList>

          {/* USERS */}
          <TabsContent value="users" className="mt-4">
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex justify-between items-center">
                  <div className="text-sm text-muted-foreground">{users.length} users</div>
                  <Button size="sm" onClick={() => setInviteOpen(true)}>
                    <UserPlus className="w-4 h-4 mr-2" /> Invite user
                  </Button>
                </div>
                <div className="overflow-auto rounded border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2">User</th>
                        <th className="px-3 py-2">Roles</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.user_id} className="border-t border-border hover:bg-accent/20">
                          <td className="px-3 py-2">
                            <div className="font-medium">{u.full_name}</div>
                            <div className="text-xs text-muted-foreground">{u.email}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {ROLE_OPTIONS.map((r) => {
                                const has = u.roles.includes(r);
                                return (
                                  <button key={r} onClick={() => toggleRole(u, r, has)} className="focus:outline-none"
                                    title={has ? `Click to revoke ${r}` : `Click to grant ${r}`}>
                                    <Badge variant={has ? (r === "admin" ? "default" : "secondary") : "outline"} className="text-[10px]">
                                      {has && <ShieldCheck className="w-2.5 h-2.5 mr-1" />}{r}
                                    </Badge>
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" className="h-7"
                                onClick={() => ask({
                                  title: "Send password reset",
                                  description: `Generate a recovery link for ${u.email}.`,
                                  onConfirm: (r) => callAdminUsers("reset_password", { email: u.email }, r),
                                })}>
                                <KeyRound className="w-3.5 h-3.5 mr-1" /> Reset
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7"
                                onClick={() => askDisable(u)}>
                                <Ban className="w-3.5 h-3.5 mr-1" /> Disable
                              </Button>
                              <Button size="sm" variant="destructive" className="h-7"
                                onClick={() => ask({
                                  title: `Delete ${u.email}?`,
                                  description: "Removes the user from auth and the system. Lines they worked on remain.",
                                  destructive: true,
                                  onConfirm: (r) => callAdminUsers("delete", { user_id: u.user_id }, r),
                                })}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* MAPPINGS */}
          <TabsContent value="mappings" className="mt-4">
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="text-sm text-muted-foreground">
                  Map each auditor to a Team Lead. The mapped TL receives that auditor's published issues and approves their batch-delete requests.
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Auditor</label>
                    <Select value={mapAuditor} onValueChange={setMapAuditor}>
                      <SelectTrigger><SelectValue placeholder="Select auditor…" /></SelectTrigger>
                      <SelectContent>
                        {auditors.map((u) => (
                          <SelectItem key={u.user_id} value={u.user_id}>{u.full_name} ({u.email})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Team Lead</label>
                    <Select value={mapTL} onValueChange={setMapTL}>
                      <SelectTrigger><SelectValue placeholder="Select team lead…" /></SelectTrigger>
                      <SelectContent>
                        {teamLeads.map((u) => (
                          <SelectItem key={u.user_id} value={u.user_id}>{u.full_name} ({u.email})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={addMapping}><Link2 className="w-4 h-4 mr-2" /> Assign / Update</Button>
                </div>

                <div className="overflow-auto rounded border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2">Auditor</th>
                        <th className="px-3 py-2">Team Lead</th>
                        <th className="px-3 py-2">Updated</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mappings.map((m) => (
                        <tr key={m.id} className="border-t border-border hover:bg-accent/20">
                          <td className="px-3 py-2">{userMap.get(m.auditor_id)?.email ?? m.auditor_id.slice(0, 8)}</td>
                          <td className="px-3 py-2">{userMap.get(m.team_lead_id)?.email ?? m.team_lead_id.slice(0, 8)}</td>
                          <td className="px-3 py-2 text-xs">{format(new Date(m.updated_at), "MMM d, yyyy")}</td>
                          <td className="px-3 py-2 text-right">
                            <Button size="sm" variant="destructive" className="h-7" onClick={() => removeMapping(m)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {mappings.length === 0 && (
                        <tr><td colSpan={4} className="text-center text-muted-foreground py-6">No mappings yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* BATCHES */}
          <TabsContent value="batches" className="mt-4">
            <Card>
              <CardContent className="p-4">
                <div className="overflow-auto rounded border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2">Filename</th>
                        <th className="px-3 py-2">Uploaded</th>
                        <th className="px-3 py-2 text-right">Lines</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batches.map((b) => {
                        const pending = requests.find((r) => r.batch_id === b.id && r.status === "pending");
                        return (
                          <tr key={b.id} className="border-t border-border hover:bg-accent/20">
                            <td className="px-3 py-2 font-mono text-xs">{b.filename}</td>
                            <td className="px-3 py-2 text-xs">{b.upload_date}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{b.total_lines}</td>
                            <td className="px-3 py-2">
                              {pending
                                ? <Badge variant="outline" className="text-[10px]"><Clock className="w-2.5 h-2.5 mr-1" />Pending Approval</Badge>
                                : <Badge variant="secondary">{b.status}</Badge>}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="outline" className="h-7" onClick={() => reallocateBatch(b)}>
                                  <Shuffle className="w-3.5 h-3.5 mr-1" /> Reallocate
                                </Button>
                                <Button size="sm" variant="destructive" className="h-7"
                                  disabled={!!pending}
                                  onClick={() => requestBatchDeletion(b)}>
                                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Request delete
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {batches.length === 0 && !loading && (
                        <tr><td colSpan={5} className="text-center text-muted-foreground py-6">No batches</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* APPROVALS */}
          <TabsContent value="approvals" className="mt-4">
            <Card>
              <CardContent className="p-4">
                <div className="overflow-auto rounded border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Batch</th>
                        <th className="px-3 py-2">Requested by</th>
                        <th className="px-3 py-2">Assigned TL</th>
                        <th className="px-3 py-2">Reason</th>
                        <th className="px-3 py-2">Reviewed by</th>
                        <th className="px-3 py-2">When</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map((r) => {
                        const b = batchMap.get(r.batch_id);
                        return (
                          <tr key={r.id} className="border-t border-border hover:bg-accent/10">
                            <td className="px-3 py-2">
                              {r.status === "pending" && <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Pending</Badge>}
                              {r.status === "approved" && <Badge className="bg-primary text-primary-foreground hover:bg-primary"><CheckCircle2 className="w-3 h-3 mr-1" />Approved</Badge>}
                              {r.status === "rejected" && <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Rejected</Badge>}
                            </td>
                            <td className="px-3 py-2 text-xs font-mono">{b?.filename ?? r.batch_id.slice(0, 8)}</td>
                            <td className="px-3 py-2 text-xs">{userMap.get(r.requested_by)?.email ?? r.requested_by.slice(0, 8)}</td>
                            <td className="px-3 py-2 text-xs">{r.assigned_team_lead ? (userMap.get(r.assigned_team_lead)?.email ?? r.assigned_team_lead.slice(0, 8)) : <span className="text-muted-foreground">—</span>}</td>
                            <td className="px-3 py-2 text-xs max-w-xs truncate" title={r.reason}>{r.reason}</td>
                            <td className="px-3 py-2 text-xs">{r.reviewer_id ? (userMap.get(r.reviewer_id)?.email ?? r.reviewer_id.slice(0, 8)) : <span className="text-muted-foreground">—</span>}</td>
                            <td className="px-3 py-2 text-xs whitespace-nowrap">{format(new Date(r.reviewed_at ?? r.requested_at), "MMM d, HH:mm")}</td>
                            <td className="px-3 py-2 text-right">
                              {r.status === "pending" ? (
                                <div className="flex justify-end gap-1">
                                  <Button size="sm" variant="outline" className="h-7" onClick={() => approveReq(r)}>
                                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve
                                  </Button>
                                  <Button size="sm" variant="destructive" className="h-7" onClick={() => rejectReq(r)}>
                                    <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground" title={r.decision_reason ?? ""}>
                                  {r.decision_reason ? r.decision_reason.slice(0, 40) : "—"}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {requests.length === 0 && (
                        <tr><td colSpan={8} className="text-center text-muted-foreground py-6">No delete requests</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* LINES */}
          <TabsContent value="lines" className="mt-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="text-sm text-muted-foreground">
                  Override the freeze policy or hard-delete a single line. Get the line ID from any tab's row detail.
                </div>
                <div className="flex gap-2 items-center">
                  <Input placeholder="Line UUID…" value={lineId} onChange={(e) => setLineId(e.target.value)} className="font-mono text-xs" />
                  <Button size="sm" variant="outline" disabled={!lineId} onClick={unlockLine}>
                    <Unlock className="w-3.5 h-3.5 mr-1" /> Force unlock
                  </Button>
                  <Button size="sm" variant="destructive" disabled={!lineId} onClick={deleteLine}>
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete line
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* AUDIT */}
          <TabsContent value="audit" className="mt-4">
            <Card>
              <CardContent className="p-4">
                <div className="overflow-auto rounded border border-border max-h-[60vh]">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2">When</th>
                        <th className="px-3 py-2">Actor</th>
                        <th className="px-3 py-2">Action</th>
                        <th className="px-3 py-2">Target</th>
                        <th className="px-3 py-2">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.map((a) => (
                        <tr key={a.id} className="border-t border-border hover:bg-accent/10">
                          <td className="px-3 py-2 text-xs whitespace-nowrap">{format(new Date(a.created_at), "MMM d, HH:mm:ss")}</td>
                          <td className="px-3 py-2 text-xs">{userMap.get(a.actor_id)?.email ?? a.actor_id.slice(0, 8)}</td>
                          <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">{a.action}</Badge></td>
                          <td className="px-3 py-2 text-xs font-mono">{a.target_type}/{a.target_id?.slice(0, 12)}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{a.reason}</td>
                        </tr>
                      ))}
                      {audit.length === 0 && (
                        <tr><td colSpan={5} className="text-center text-muted-foreground py-6">No actions logged yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Confirm + reason dialog */}
      <Dialog open={!!confirmCfg} onOpenChange={(o) => !o && setConfirmCfg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmCfg?.title}</DialogTitle>
            <DialogDescription>{confirmCfg?.description}</DialogDescription>
          </DialogHeader>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Reason (required, logged)</label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you doing this?" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCfg(null)}>Cancel</Button>
            <Button variant={confirmCfg?.destructive ? "destructive" : "default"} onClick={runConfirm}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite user</DialogTitle>
            <DialogDescription>Sends an invite email. They'll set their own password.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Email</label>
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="user@company.com" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Full name (optional)</label>
              <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Jane Doe" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={handleInvite}>Send invite</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reallocate batch dialog */}
      <Dialog open={!!reallocCfg} onOpenChange={(o) => !o && setReallocCfg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reallocate batch</DialogTitle>
            <DialogDescription>
              Move all pending lines in <strong>{reallocCfg?.batch.filename}</strong> to one auditor.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={reallocCfg?.target ?? ""} onValueChange={(v) => setReallocCfg((c) => c ? { ...c, target: v } : c)}>
              <SelectTrigger><SelectValue placeholder="Target auditor…" /></SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.user_id} value={u.user_id}>{u.full_name} ({u.email})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea value={reallocReason} onChange={(e) => setReallocReason(e.target.value)} placeholder="Reason (logged)" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReallocCfg(null)}>Cancel</Button>
            <Button onClick={runRealloc}>Reallocate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminPage;
