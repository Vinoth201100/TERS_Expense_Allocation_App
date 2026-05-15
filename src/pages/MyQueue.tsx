import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { LinesView } from "@/components/LinesView";

type Status = "allocated" | "completed" | "issue" | "duplicate";

const TABS: { value: Status; label: string; description: string }[] = [
  { value: "allocated", label: "Allocated", description: "Lines waiting for QC review" },
  { value: "completed", label: "Completed", description: "Lines marked as reviewed and clean" },
  { value: "issue", label: "Issues", description: "Lines flagged for follow-up" },
  { value: "duplicate", label: "Duplicates", description: "Lines skipped because their expense number already exists." },
];

const MyQueue = () => {
  const { user, role } = useAuth();
  const isAdmin = role === "admin";
  const [params, setParams] = useSearchParams();
  const initial = (params.get("tab") as Status) || "allocated";
  const [tab, setTab] = useState<Status>(initial);
  const [counts, setCounts] = useState<Record<Status, number>>({
    allocated: 0, completed: 0, issue: 0, duplicate: 0,
  });

  const loadCounts = useCallback(async () => {
    if (!user) return;
    const promises = TABS.map((t) => {
      let q = supabase.from("lines").select("id", { count: "exact", head: true }).eq("status", t.value);
      if (!isAdmin) q = q.eq("assigned_to", user.id);
      return q;
    });
    const results = await Promise.all(promises);
    const next: Record<Status, number> = { allocated: 0, completed: 0, issue: 0, duplicate: 0 };
    results.forEach((r, i) => { next[TABS[i].value] = r.count ?? 0; });
    setCounts(next);
  }, [user, isAdmin]);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("my-queue-counts")
      .on("postgres_changes", { event: "*", schema: "public", table: "lines" }, () => loadCounts())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, loadCounts]);

  const handleTabChange = (v: string) => {
    setTab(v as Status);
    setParams({ tab: v }, { replace: true });
  };

  const current = TABS.find((t) => t.value === tab)!;

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader title="My Queue" description={current.description} />
      <div className="px-6 pt-3">
        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="gap-2">
                {t.label}
                <Badge variant="secondary" className="text-[10px] tabular-nums px-1.5 py-0">{counts[t.value]}</Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <LinesView key={tab} status={tab} title={current.label} description={current.description} embedded />
      </div>
    </div>
  );
};

export default MyQueue;
