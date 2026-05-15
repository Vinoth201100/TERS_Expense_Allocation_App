import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface AAUser { user_id: string; full_name: string; email: string }
interface Mapping { id: string; approved_auditor_id: string; branch_code: string }

export const AABranchMapping = () => {
  const [aaUsers, setAaUsers] = useState<AAUser[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [selectedAA, setSelectedAA] = useState<string>("");
  const [newCode, setNewCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: roles }, { data: profiles }, { data: maps }] = await Promise.all([
      supabase.from("user_roles").select("user_id, role").eq("role", "expense_auditor"),
      supabase.from("profiles").select("user_id, full_name, email"),
      supabase.from("aa_branch_codes" as never).select("id, approved_auditor_id, branch_code"),
    ]);
    const aaIds = new Set((roles ?? []).map((r: { user_id: string }) => r.user_id));
    const users = (profiles ?? [])
      .filter((p: { user_id: string }) => aaIds.has(p.user_id))
      .map((p: { user_id: string; full_name: string; email: string }) => ({
        user_id: p.user_id, full_name: p.full_name || "—", email: p.email,
      }));
    setAaUsers(users);
    setMappings(((maps ?? []) as unknown) as Mapping[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addCode = async () => {
    if (!selectedAA || !newCode.trim()) return toast.error("Pick an Expense Auditor and enter a branch code");
    setBusy(true);
    const { error } = await supabase
      .from("aa_branch_codes" as never)
      .insert({ approved_auditor_id: selectedAA, branch_code: newCode.trim() } as never);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Branch code added");
    setNewCode("");
    load();
  };

  const removeCode = async (id: string) => {
    const { error } = await supabase.from("aa_branch_codes" as never).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removed");
    load();
  };

  const groupedByAA = aaUsers.map((u) => ({
    user: u,
    codes: mappings.filter((m) => m.approved_auditor_id === u.user_id),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="w-4 h-4" /> Expense Auditor — Branch Mapping
        </CardTitle>
        <CardDescription>
          Map branch codes to Expense Auditors. Issue lines are auto-routed by the line's Branch column when QA clicks "Publish to EA".
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[220px]">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Expense Auditor</label>
            <Select value={selectedAA} onValueChange={setSelectedAA}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Pick an AA…" /></SelectTrigger>
              <SelectContent>
                {aaUsers.map((u) => (
                  <SelectItem key={u.user_id} value={u.user_id}>{u.full_name} <span className="text-muted-foreground">· {u.email}</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[180px]">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Branch code</label>
            <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="e.g. NYC-01" className="h-9" />
          </div>
          <Button onClick={addCode} disabled={busy} className="h-9">
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>

        {groupedByAA.length === 0 ? (
          <div className="text-sm text-muted-foreground py-2">No Expense Auditors yet. Assign the role to a user first.</div>
        ) : (
          <div className="rounded-md border border-border divide-y divide-border">
            {groupedByAA.map((g) => (
              <div key={g.user.user_id} className="p-3 flex flex-wrap items-center gap-3">
                <div className="min-w-[200px]">
                  <div className="text-sm font-medium">{g.user.full_name}</div>
                  <div className="text-xs text-muted-foreground">{g.user.email}</div>
                </div>
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {g.codes.length === 0
                    ? <span className="text-xs text-muted-foreground italic">No branches mapped</span>
                    : g.codes.map((c) => (
                      <Badge key={c.id} variant="secondary" className="font-mono text-[11px] gap-1">
                        {c.branch_code}
                        <button onClick={() => removeCode(c.id)} className="hover:text-destructive ml-0.5" title="Remove">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
