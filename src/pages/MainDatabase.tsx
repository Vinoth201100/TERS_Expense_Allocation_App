import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

type AnyRow = Record<string, any>;

const QA_COLS: { key: string; label: string }[] = [
  { key: "expense_number", label: "Expense #" },
  { key: "employee", label: "Employee" },
  { key: "user_id_field", label: "User ID" },
  { key: "branch", label: "Branch" },
  { key: "user_location", label: "Location" },
  { key: "category", label: "Category" },
  { key: "amount", label: "Amount" },
  { key: "currency", label: "Currency" },
  { key: "date_submitted", label: "Date" },
  { key: "merchant", label: "Merchant" },
  { key: "project", label: "Project" },
  { key: "approved_by", label: "Approved By" },
  { key: "qa_status_derived", label: "QA Status" },
  { key: "audit_status", label: "Audit Status" },
  { key: "qc_category", label: "QC Category" },
  { key: "qc_type_of_issue", label: "Type of Issue" },
  { key: "qc_qa_checks", label: "QA Checks" },
  { key: "qc_comment", label: "QA Comment" },
  { key: "assigned_to_name", label: "QA Auditor" },
  { key: "leads_feedback", label: "TL Feedback" },
  { key: "leads_agrees", label: "TL Agrees" },
  { key: "aa_status", label: "EA Status" },
  { key: "aa_comment", label: "EA Comment" },
  { key: "aa_review_agree", label: "EA Review Agree" },
  { key: "aa_review_comment", label: "EA Review Comment" },
  { key: "aa_assigned_to_name", label: "EA Reviewer" },
  { key: "qc_completed_at", label: "QC Completed" },
  { key: "allocated_date", label: "Allocated" },
  { key: "published_at", label: "Published" },
];

const EA_COLS: { key: string; label: string }[] = [
  { key: "expense_number", label: "Expense #" },
  { key: "employee", label: "Employee" },
  { key: "user_id_field", label: "User ID" },
  { key: "branch", label: "Branch" },
  { key: "category", label: "Category" },
  { key: "amount", label: "Amount" },
  { key: "currency", label: "Currency" },
  { key: "date_submitted", label: "Date" },
  { key: "merchant", label: "Merchant" },
  { key: "project", label: "Project" },
  { key: "approved_by", label: "Approved By" },
  { key: "status", label: "EA Status" },
  { key: "final_decision", label: "Final Decision" },
  { key: "decision_comment", label: "Decision Comment" },
  { key: "rejected_reason", label: "Rejected Reason" },
  { key: "exception_hold_comment", label: "Exception/Hold" },
  { key: "escalated_comment", label: "Escalated Comment" },
  { key: "escalated_date", label: "Escalated Date" },
  { key: "followup_1_date", label: "Follow-up 1" },
  { key: "followup_2_date", label: "Follow-up 2" },
  { key: "followup_3_date", label: "Follow-up 3" },
  { key: "is_resubmitted", label: "Resubmitted" },
  { key: "previous_status", label: "Previous Status" },
  { key: "assigned_ea_name", label: "EA Auditor" },
  { key: "allocated_date", label: "Allocated" },
  { key: "decided_at", label: "Decided" },
];

const fmt = (v: any) => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  if (s.length > 80) return s.slice(0, 77) + "…";
  return s;
};

const StatusBadge = ({ value }: { value: any }) => {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <Badge variant="secondary" className="text-[10px]">{String(value)}</Badge>;
};

const DataGrid = ({
  rows,
  cols,
  loading,
  search,
}: {
  rows: AnyRow[];
  cols: { key: string; label: string }[];
  loading: boolean;
  search: string;
}) => {
  const filtered = search
    ? rows.filter((r) =>
        cols.some((c) => String(r[c.key] ?? "").toLowerCase().includes(search.toLowerCase()))
      )
    : rows;

  if (loading) {
    return (
      <div className="p-6 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto border-t">
      <Table>
        <TableHeader className="sticky top-0 bg-card z-10">
          <TableRow>
            {cols.map((c) => (
              <TableHead key={c.key} className="whitespace-nowrap text-xs">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={cols.length} className="text-center text-muted-foreground py-12">
                No rows
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((r, i) => (
              <TableRow key={r.id ?? i}>
                {cols.map((c) => (
                  <TableCell key={c.key} className="text-xs whitespace-nowrap">
                    {c.key.endsWith("status") || c.key === "qa_status_derived" || c.key === "audit_status" || c.key === "final_decision" ? (
                      <StatusBadge value={r[c.key]} />
                    ) : (
                      fmt(r[c.key])
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
};

const MainDatabase = () => {
  const [tab, setTab] = useState<"qa" | "ea">("qa");
  const [qa, setQa] = useState<AnyRow[]>([]);
  const [ea, setEa] = useState<AnyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [qaRes, eaRes, profRes] = await Promise.all([
        supabase.from("lines").select("*").order("created_at", { ascending: false }).limit(1000),
        supabase.from("ea_lines").select("*").order("created_at", { ascending: false }).limit(1000),
        supabase.from("profiles").select("user_id, full_name, email"),
      ]);
      const profMap = new Map(
        (profRes.data ?? []).map((p: any) => [p.user_id, p.full_name || p.email])
      );
      setQa(
        (qaRes.data ?? []).map((r: any) => ({
          ...r,
          assigned_to_name: profMap.get(r.assigned_to) ?? "—",
          aa_assigned_to_name: profMap.get(r.aa_assigned_to) ?? "—",
          qa_status_derived: r.qc_completed_at
            ? "Completed"
            : r.assigned_to
            ? "Allocated"
            : "Unallocated",
        }))
      );
      setEa(
        (eaRes.data ?? []).map((r: any) => ({
          ...r,
          assigned_ea_name: profMap.get(r.assigned_ea) ?? "—",
        }))
      );
      setLoading(false);
    })();
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Main Database"
        description="Unified view of all expense lines across QA and EA allocations"
      />
      <div className="px-6 pt-4 pb-2 flex items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "qa" | "ea")}>
          <TabsList>
            <TabsTrigger value="qa" className="gap-2">
              QA Allocation
              <Badge variant="secondary" className="text-[10px] tabular-nums">{qa.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="ea" className="gap-2">
              EA Allocation
              <Badge variant="secondary" className="text-[10px] tabular-nums">{ea.length}</Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          placeholder="Search any field…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs ml-auto"
        />
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        {tab === "qa" ? (
          <DataGrid rows={qa} cols={QA_COLS} loading={loading} search={search} />
        ) : (
          <DataGrid rows={ea} cols={EA_COLS} loading={loading} search={search} />
        )}
      </div>
    </div>
  );
};

export default MainDatabase;
