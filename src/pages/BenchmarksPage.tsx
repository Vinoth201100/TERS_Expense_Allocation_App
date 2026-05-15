import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Users, Briefcase, Save, AlertCircle } from "lucide-react";
import { toast } from "sonner";

type Kind = "qa" | "ea";

interface BenchRow {
  auditor_id: string;
  full_name: string;
  email: string;
  kind: Kind;
  default_count: number;
  today_count: number;
  present_today: boolean;
}

interface Edited { default_count: number; today_count: number | null }

const BenchmarksPage = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<BenchRow[]>([]);
  const [edits, setEdits] = useState<Record<string, Edited>>({}); // key = `${kind}:${auditor_id}`

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_tl_benchmarks" as never);
    if (error) {
      toast.error(error.message);
      setRows([]);
    } else {
      const list = (data ?? []) as BenchRow[];
      setRows(list);
      const next: Record<string, Edited> = {};
      list.forEach((r) => {
        next[`${r.kind}:${r.auditor_id}`] = {
          default_count: r.default_count,
          today_count: r.today_count,
        };
      });
      setEdits(next);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setVal = (kind: Kind, id: string, field: "default_count" | "today_count", val: string) => {
    const key = `${kind}:${id}`;
    const num = val === "" ? (field === "today_count" ? null : 0) : Math.max(0, parseInt(val, 10) || 0);
    setEdits((p) => ({ ...p, [key]: { ...p[key], [field]: num } }));
  };

  const dirty = useMemo(() => {
    return rows.some((r) => {
      const e = edits[`${r.kind}:${r.auditor_id}`];
      if (!e) return false;
      return e.default_count !== r.default_count || e.today_count !== r.today_count;
    });
  }, [rows, edits]);

  const save = async () => {
    setSaving(true);
    try {
      const changed = rows.filter((r) => {
        const e = edits[`${r.kind}:${r.auditor_id}`];
        return e && (e.default_count !== r.default_count || e.today_count !== r.today_count);
      });
      for (const r of changed) {
        const e = edits[`${r.kind}:${r.auditor_id}`];
        const { error } = await supabase.rpc("upsert_benchmark" as never, {
          _auditor: r.auditor_id, _kind: r.kind, _default: e.default_count, _today: e.today_count,
        } as never);
        if (error) throw error;
      }
      toast.success(`Saved ${changed.length} benchmark${changed.length === 1 ? "" : "s"}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally { setSaving(false); }
  };

  const ea = rows.filter((r) => r.kind === "ea");
  const qa = rows.filter((r) => r.kind === "qa");
  const totalToday = (list: BenchRow[]) =>
    list.reduce((s, r) => s + (edits[`${r.kind}:${r.auditor_id}`]?.today_count ?? r.today_count ?? 0), 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Daily Benchmarks"
        description="Set how many expense lines each auditor should handle per day. Today's value is used by auto-allocation."
      />
      <div className="flex-1 min-h-0 overflow-y-auto p-8 space-y-6">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              <AlertCircle className="w-6 h-6 mx-auto mb-2 opacity-60" />
              No auditors mapped to your team yet. Map QA / Expense auditors in Admin Control first.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2">
              <BenchCard
                title="Expense Auditors"
                icon={Briefcase}
                rows={ea}
                edits={edits}
                total={totalToday(ea)}
                onChange={(id, field, val) => setVal("ea", id, field, val)}
              />
              <BenchCard
                title="QA Auditors"
                icon={Users}
                rows={qa}
                edits={edits}
                total={totalToday(qa)}
                onChange={(id, field, val) => setVal("qa", id, field, val)}
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={save} disabled={!dirty || saving}>
                <Save className="w-4 h-4 mr-2" /> {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const BenchCard = ({
  title, icon: Icon, rows, edits, total, onChange,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  rows: BenchRow[];
  edits: Record<string, Edited>;
  total: number;
  onChange: (id: string, field: "default_count" | "today_count", val: string) => void;
}) => (
  <Card>
    <CardHeader>
      <div className="flex items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Icon className="w-4 h-4" /> {title}
        </CardTitle>
        <Badge variant="secondary">Today total: {total}</Badge>
      </div>
      <CardDescription>Default applies every day. Today overrides only today.</CardDescription>
    </CardHeader>
    <CardContent>
      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4">No {title.toLowerCase()} mapped to your team.</div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-2 text-[11px] uppercase tracking-wider text-muted-foreground px-1">
            <div className="col-span-6">Auditor</div>
            <div className="col-span-3 text-right">Default</div>
            <div className="col-span-3 text-right">Today</div>
          </div>
          {rows.map((r) => {
            const e = edits[`${r.kind}:${r.auditor_id}`];
            return (
              <div key={r.auditor_id} className="grid grid-cols-12 gap-2 items-center py-1.5 border-t border-border/60">
                <div className="col-span-6 min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-2">
                    {r.full_name || r.email}
                    {!r.present_today && <Badge variant="outline" className="text-[10px]">absent</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{r.email}</div>
                </div>
                <div className="col-span-3">
                  <Input type="number" min={0} className="h-8 text-right"
                    value={e?.default_count ?? 0}
                    onChange={(ev) => onChange(r.auditor_id, "default_count", ev.target.value)} />
                </div>
                <div className="col-span-3">
                  <Input type="number" min={0} className="h-8 text-right"
                    placeholder={String(e?.default_count ?? 0)}
                    value={e?.today_count ?? ""}
                    onChange={(ev) => onChange(r.auditor_id, "today_count", ev.target.value)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </CardContent>
  </Card>
);

export default BenchmarksPage;
