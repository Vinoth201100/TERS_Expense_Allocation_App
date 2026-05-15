import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, AlertTriangle, RefreshCw, RotateCcw, Check, Lock, Send, Download, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { format, differenceInBusinessDays } from "date-fns";
import { DataTable, ColumnDef } from "@/components/DataTable";
import { cn } from "@/lib/utils";
import { ALL_KNOWN_ALIASES_NORM, normHeader } from "@/lib/headerAliases";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AttachmentsGallery } from "@/components/AttachmentsGallery";

type Status = "allocated" | "completed" | "issue" | "duplicate";

interface Line {
  id: string;
  expense_number: string | null;
  employee: string | null;
  category: string | null;
  amount: number | null;
  currency: string | null;
  branch: string | null;
  project: string | null;
  merchant: string | null;
  status: Status;
  qc_category: string | null;
  qc_type_of_issue: string | null;
  qc_qa_checks: string | null;
  qc_comment: string | null;
  qc_completed_at: string | null;
  audit_status: string | null;
  allocated_date: string | null;
  published_at: string | null;
  assigned_to: string | null;
  date_submitted: string | null;
  user_id_field: string | null;
  approved_by: string | null;
  // EA + TL final-review fields (read-only display in QA's "Final Review" filter)
  aa_assigned_to: string | null;
  aa_review_agree: boolean | null;
  aa_review_comment: string | null;
  aa_decision_at: string | null;
  aa_comment: string | null;
  leads_feedback: string | null;
  leads_agrees: boolean | null;
  leads_feedback_at: string | null;
  raw_data: Record<string, unknown> | null;
}

const QC_CATEGORIES = ["OK", "Incorrect VAT number", "Duplicate", "Missing receipt", "Wrong category", "Policy breach", "Incorrect amount", "Missing approval", "Wrong currency", "Out of policy date", "Personal expense", "Other"];

// Any Excel header whose normalized form matches a known alias is already
// shown as a mapped column — keep it out of the "Excel extras" picker so we
// don't render duplicate columns like both "Expense #" and "EXPENSE#".

export const LinesView = ({ status, title, description, embedded = false }: { status: Status; title: string; description: string; embedded?: boolean }) => {
  const { user, role } = useAuth();
  const isAdmin = role === "admin";
  const [lines, setLines] = useState<Line[]>([]);
  const [total, setTotal] = useState(0);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [attachmentsLine, setAttachmentsLine] = useState<Line | null>(null);
  // (Legacy AA-pick dialog state removed — publishing now auto-maps via Approved By.)
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(`linesview.${status}.v2`);
      if (raw) return JSON.parse(raw).pageSize ?? 65;
    } catch { /* ignore */ }
    return 65;
  });

  // Filters
  const [filterEmployee, setFilterEmployee] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterQcCategory, setFilterQcCategory] = useState<string>("all");
  const [filterDateFrom, setFilterDateFrom] = useState<string>("");
  const [filterDateTo, setFilterDateTo] = useState<string>("");
  // Issues-tab only: "all" | "open" (not yet locked) | "final" (EA + TL both submitted; read-only)
  const [filterReviewState, setFilterReviewState] = useState<"all" | "open" | "final">("all");
  // EA-decision review dialog (Final Review read-only inspector)
  const [reviewLine, setReviewLine] = useState<Line | null>(null);

  const today = format(new Date(), "yyyy-MM-dd");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setSelected(new Set());
    const statusFilter: Status[] = status === "completed" ? ["completed", "issue"] : [status];

    let q = supabase
      .from("lines")
      .select("*", { count: "exact" })
      .in("status", statusFilter)
      .order("allocated_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (!isAdmin) q = q.eq("assigned_to", user.id);

    // Server-side filters (apply broad ones; text search stays client-side on the page)
    if (filterEmployee !== "all") q = q.eq("employee", filterEmployee);
    if (filterCategory !== "all") q = q.eq("category", filterCategory);
    if (filterQcCategory !== "all") q = q.eq("qc_category", filterQcCategory);
    if (filterDateFrom) q = q.gte("date_submitted", filterDateFrom);
    if (filterDateTo) q = q.lte("date_submitted", filterDateTo);
    // Issues tab — review-state filter (open vs final/locked).
    // A line is "final/locked" once both EA decision and TL feedback are submitted.
    if (status === "issue" && filterReviewState === "final") {
      q = q.not("aa_decision_at", "is", null).not("leads_feedback_at", "is", null);
    } else if (status === "issue" && filterReviewState === "open") {
      q = q.or("aa_decision_at.is.null,leads_feedback_at.is.null");
    }

    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await q.range(from, to);

    if (error) toast.error(error.message);
    setLines((data as Line[]) ?? []);
    setTotal(count ?? 0);

    if (isAdmin && (!Object.keys(profiles).length)) {
      const { data: pr } = await supabase.from("profiles").select("user_id, full_name");
      const map: Record<string, string> = {};
      (pr ?? []).forEach((p: { user_id: string; full_name: string }) => { map[p.user_id] = p.full_name; });
      setProfiles(map);
    }
    setLoading(false);
  }, [user, isAdmin, status, page, pageSize, filterEmployee, filterCategory, filterQcCategory, filterDateFrom, filterDateTo, filterReviewState, profiles]);

  useEffect(() => { load(); }, [load]);

  // Reset to first page when filters change
  useEffect(() => { setPage(0); }, [filterEmployee, filterCategory, filterQcCategory, filterDateFrom, filterDateTo, filterReviewState]);

  const isFrozen = useCallback((l: Line): boolean => {
    if (isAdmin) return false;
    if (status !== "completed") return false;
    if (!l.qc_completed_at) return false;
    const completedDay = l.qc_completed_at.slice(0, 10);
    return completedDay !== today;
  }, [isAdmin, status, today]);

  const isCommentFrozen = useCallback((l: Line): boolean => {
    if (isAdmin) return false;
    if (status === "issue" && !!l.published_at && !!l.aa_decision_at && !!l.leads_feedback_at) return true;
    return false;
  }, [isAdmin, status]);

  const updateField = async (id: string, field: keyof Line, value: string) => {
    const line = lines.find((l) => l.id === id);
    if (field === "qc_comment" && line && isCommentFrozen(line)) return;
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
    const { error } = await supabase.from("lines").update({ [field]: value } as never).eq("id", id);
    if (error) toast.error(error.message);
  };

  const markStatus = async (id: string, newStatus: Status) => {
    const update: Record<string, unknown> = { status: newStatus };
    if (newStatus === "completed" || newStatus === "issue") {
      update.qc_completed_at = new Date().toISOString();
    } else {
      update.qc_completed_at = null;
    }
    const { error } = await supabase.from("lines").update(update as never).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(newStatus === "completed" ? "Marked Completed - No issues" : newStatus === "issue" ? "Marked Completed - Issues" : "Reopened");
    load();
  };

  const markDone = async (line: Line) => {
    if (!line.qc_qa_checks) return toast.error("Set QA Checks (Issue / No-issue) before marking Done");
    const newStatus: Status = line.qc_qa_checks === "Issue" ? "issue" : "completed";
    await markStatus(line.id, newStatus);
  };

  const bulkDoneAs = async (qa: "Issue" | "No-issue") => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const newStatus: Status = qa === "Issue" ? "issue" : "completed";
    const now = new Date().toISOString();
    let totalMoved = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { error, count } = await supabase
        .from("lines")
        .update({ qc_qa_checks: qa, status: newStatus, qc_completed_at: now } as never, { count: "exact" })
        .in("id", chunk);
      if (error) { toast.error(error.message); setBulkBusy(false); return; }
      totalMoved += count ?? chunk.length;
    }
    setBulkBusy(false);
    toast.success(`Marked ${totalMoved} line${totalMoved === 1 ? "" : "s"} done as ${qa}`);
    load();
  };

  const bulkReopen = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    let totalMoved = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { error, count } = await supabase
        .from("lines")
        .update({ status: "allocated", qc_completed_at: null } as never, { count: "exact" })
        .in("id", chunk);
      if (error) { toast.error(error.message); setBulkBusy(false); return; }
      totalMoved += count ?? chunk.length;
    }
    setBulkBusy(false);
    toast.success(`Reopened ${totalMoved} line${totalMoved === 1 ? "" : "s"}`);
    load();
  };

  // Single publish action: stamps published_at (so Team Leads see it in their Review Queue)
  // AND auto-routes each line to the Expense Auditor whose profile matches "Approved By".
  const publishToReviewers = async (ids: string[]) => {
    if (!user) return;
    if (ids.length === 0) return toast.error("No issues to publish");
    setBulkBusy(true);

    // 1) Stamp published_at / published_by so Team Leads see them in Review Queue
    const now = new Date().toISOString();
    let tlCount = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { error, count } = await supabase
        .from("lines")
        .update({ published_at: now, published_by: user.id } as never, { count: "exact" })
        .in("id", chunk);
      if (error) { toast.error(error.message); setBulkBusy(false); return; }
      tlCount += count ?? chunk.length;
    }

    // 2) Auto-route to Expense Auditors via Approved By mapping
    const { data, error: rpcError } = await supabase.rpc(
      "publish_issues_to_aa_by_approved_by" as never,
      { _line_ids: ids } as never,
    );
    setBulkBusy(false);
    if (rpcError) { toast.error(rpcError.message); load(); return; }

    const result = (data ?? {}) as { routed?: number; unmatched?: number; unmatched_approvers?: string[] };
    const routed = result.routed ?? 0;
    const unmatched = result.unmatched ?? 0;

    if (unmatched > 0) {
      const sample = (result.unmatched_approvers ?? []).slice(0, 3).join(", ");
      const more = (result.unmatched_approvers?.length ?? 0) > 3 ? "…" : "";
      toast.warning(
        `Published ${tlCount} to Team Leads · routed ${routed} to EAs · ${unmatched} unmapped (${sample}${more})`,
        { duration: 8000 },
      );
    } else {
      toast.success(`Published ${tlCount} to Team Leads & ${routed} to Expense Auditors`);
    }
    load();
  };

  // Client-side text search across the current page only.
  const filtered = useMemo(() => {
    if (!search) return lines;
    const s = search.toLowerCase();
    return lines.filter((l) => (
      l.expense_number?.toLowerCase().includes(s)
      || l.employee?.toLowerCase().includes(s)
      || l.merchant?.toLowerCase().includes(s)
      || l.project?.toLowerCase().includes(s)
    ));
  }, [lines, search]);

  // Discover extra raw_data column keys from current page.
  const rawColumns = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of lines) {
      if (!l.raw_data || typeof l.raw_data !== "object") continue;
      for (const k of Object.keys(l.raw_data)) {
        // Skip headers that are already shown as mapped columns
        // (covers "Expense #", "EXPENSE#", "Expense Number", etc.).
        if (ALL_KNOWN_ALIASES_NORM.has(normHeader(k))) continue;
        const upper = k.trim().toUpperCase();
        if (!seen.has(upper)) seen.set(upper, k);
      }
    }
    return Array.from(seen.entries()).map(([upper, label]) => ({ key: `raw:${upper}`, label, originalKey: label }));
  }, [lines]);

  const getRawValue = (line: Line, originalKey: string): string => {
    const rd = line.raw_data;
    if (!rd || typeof rd !== "object") return "—";
    const target = originalKey.trim().toUpperCase();
    const hit = Object.keys(rd).find((k) => k.trim().toUpperCase() === target);
    if (!hit) return "—";
    const v = rd[hit];
    if (v == null || v === "") return "—";
    return String(v);
  };

  const allVisibleSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.id));
  const someVisibleSelected = filtered.some((l) => selected.has(l.id));

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((l) => next.delete(l.id));
      else filtered.forEach((l) => next.add(l.id));
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const resetFilters = () => {
    setSearch(""); setFilterEmployee("all"); setFilterCategory("all");
    setFilterQcCategory("all"); setFilterDateFrom(""); setFilterDateTo("");
    setFilterReviewState("all");
  };

  // Aging in business days from allocated_date
  const agingBadge = (l: Line) => {
    if (!l.allocated_date) return <span className="text-muted-foreground">—</span>;
    const days = Math.max(0, differenceInBusinessDays(new Date(today), new Date(l.allocated_date)));
    const tone = days >= 7 ? "destructive" : days >= 3 ? "warning" : "muted";
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded px-1.5 py-0.5 text-xs tabular-nums",
          tone === "destructive" && "bg-destructive/15 text-destructive",
          tone === "warning" && "bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]",
          tone === "muted" && "bg-muted text-muted-foreground",
        )}
      >
        {days}d
      </span>
    );
  };

  // Build columns
  const columns: ColumnDef<Line>[] = useMemo(() => {
    const cols: ColumnDef<Line>[] = [];

    cols.push({
      key: "_select",
      label: "",
      pinned: "left",
      hideFromPicker: true,
      headClassName: "w-10",
      headerRender: () => (
        <Checkbox
          checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
          onCheckedChange={toggleAllVisible}
        />
      ),
      render: (l) => (
        <Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggleOne(l.id)} />
      ),
    });

    const fixed: ColumnDef<Line>[] = [
      { key: "expense_number", label: "Expense #", group: "Mapped", defaultVisible: true,
        render: (l) => <span className="font-mono text-xs">{l.expense_number ?? "—"}</span> },
      { key: "employee", label: "Employee", group: "Mapped", defaultVisible: true,
        render: (l) => <span className="text-sm">{l.employee ?? "—"}</span> },
      { key: "allocated_date", label: "Allocated Date", group: "Computed", defaultVisible: true,
        render: (l) => <span className="text-sm tabular-nums">{l.allocated_date ?? "—"}</span> },
      { key: "aging", label: "Aging (biz days)", group: "Computed", defaultVisible: true,
        render: (l) => agingBadge(l) },
      ...(isAdmin ? [{
        key: "auditor", label: "Auditor", group: "Mapped", defaultVisible: true,
        render: (l: Line) => (
          <Badge variant="secondary" className="font-normal">
            {l.assigned_to ? profiles[l.assigned_to] ?? "—" : "Unassigned"}
          </Badge>
        ),
      } as ColumnDef<Line>] : []),
      { key: "category", label: "Category", group: "Mapped", defaultVisible: true,
        render: (l) => <span className="text-sm">{l.category ?? "—"}</span> },
      { key: "amount", label: "Amount", group: "Mapped", defaultVisible: true, className: "text-right tabular-nums whitespace-nowrap",
        render: (l) => <span className="text-sm">{l.amount != null ? Number(l.amount).toLocaleString() : "—"}</span> },
      { key: "currency", label: "Currency", group: "Mapped", defaultVisible: true,
        render: (l) => <span className="text-sm">{l.currency ?? "—"}</span> },
      { key: "merchant", label: "Merchant", group: "Mapped", defaultVisible: true,
        render: (l) => <span className="text-sm">{l.merchant ?? "—"}</span> },
      { key: "project", label: "Project", group: "Mapped", defaultVisible: true,
        render: (l) => <span className="text-sm">{l.project ?? "—"}</span> },
      { key: "branch", label: "Branch", group: "Mapped", defaultVisible: true,
        render: (l) => <span className="text-sm">{l.branch ?? "—"}</span> },
      { key: "date_submitted", label: "Date Submitted", group: "Mapped", defaultVisible: true,
        render: (l) => <span className="text-sm tabular-nums">{l.date_submitted ?? "—"}</span> },
      { key: "user_id_field", label: "User ID", group: "Mapped", defaultVisible: true,
        render: (l) => <span className="text-xs text-muted-foreground">{l.user_id_field ?? "—"}</span> },
      // QA needs "Approved By" visible across Allocated / Completed / Issues —
      // it determines which Expense Auditor the case is published to.
      { key: "approved_by", label: "Approved By", group: "Mapped", defaultVisible: true,
        render: (l) => <span className="text-sm">{l.approved_by ?? "—"}</span> },
    ];

    // Audit status (Completed + Issues only)
    if (status === "completed" || status === "issue") {
      fixed.push({
        key: "audit_status", label: "Audit Status", group: "Computed", defaultVisible: true,
        render: (l) => <Badge variant="outline" className="font-normal">{l.audit_status ?? "Audited"}</Badge>,
      });
    }
    if (status === "issue") {
      fixed.push({
        key: "published", label: "Published", group: "Computed", defaultVisible: true,
        render: (l) => l.published_at
          ? <Badge className="bg-primary/15 text-primary hover:bg-primary/20 font-normal">Published</Badge>
          : <span className="text-xs text-muted-foreground">—</span>,
      });
      fixed.push({
        key: "review_state", label: "Review State", group: "Computed", defaultVisible: true,
        render: (l) => {
          const eaDone = !!l.aa_decision_at;
          const tlDone = !!l.leads_feedback_at;
          if (eaDone && tlDone) {
            return <Badge className="font-normal bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/20"><Lock className="w-3 h-3 mr-1" /> Final · Locked</Badge>;
          }
          if (eaDone || tlDone) {
            return <Badge variant="outline" className="font-normal">{eaDone ? "EA done · awaiting TL" : "TL done · awaiting EA"}</Badge>;
          }
          if (l.aa_assigned_to) return <Badge variant="secondary" className="font-normal">Awaiting EA + TL</Badge>;
          return <span className="text-xs text-muted-foreground">Not published to EA</span>;
        },
      });
    }

    cols.push(...fixed);

    // Raw extra columns (off by default)
    rawColumns.forEach((c) => {
      cols.push({
        key: c.key,
        label: c.label,
        group: "Excel extras",
        defaultVisible: false,
        render: (l) => (
          <span className="text-xs text-muted-foreground max-w-[220px] truncate inline-block" title={getRawValue(l, c.originalKey)}>
            {getRawValue(l, c.originalKey)}
          </span>
        ),
      });
    });

    // QC editing columns
    cols.push(
      {
        key: "qc_category", label: "QC Category", group: "QC", defaultVisible: true,
        render: (l) => <QcSelect disabled={isFrozen(l)} value={l.qc_category} options={QC_CATEGORIES} onChange={(v) => updateField(l.id, "qc_category", v)} />,
      },
      {
        key: "qc_type_of_issue", label: "Type of Issue", group: "QC", defaultVisible: true,
        render: (l) => <QcSelect disabled={isFrozen(l)} value={l.qc_type_of_issue} options={["None", "Documentation", "Amount mismatch", "Duplicate", "Compliance", "Approval"]} onChange={(v) => updateField(l.id, "qc_type_of_issue", v)} />,
      },
      {
        key: "qc_qa_checks", label: "QA Checks", group: "QC", defaultVisible: true,
        render: (l) => <QcSelect disabled={isFrozen(l)} value={l.qc_qa_checks} options={["Issue", "No-issue"]} onChange={(v) => updateField(l.id, "qc_qa_checks", v)} />,
      },
      {
        key: "qc_comment", label: "Comment", group: "QC", defaultVisible: true,
        render: (l) => (
          <Input
            disabled={isFrozen(l) || isCommentFrozen(l)}
            value={l.qc_comment ?? ""}
            onChange={(e) => setLines((prev) => prev.map((p) => p.id === l.id ? { ...p, qc_comment: e.target.value } : p))}
            onBlur={(e) => updateField(l.id, "qc_comment", e.target.value)}
            placeholder={isCommentFrozen(l) ? "Review completed — read-only" : "Notes…"}
            className="h-8 text-sm min-w-[180px]"
          />
        ),
      },
      {
        key: "attachments", label: "Files", group: "QC", defaultVisible: true,
        render: (l) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setAttachmentsLine(l)}
            title="View / upload attachments"
          >
            <Paperclip className="w-3.5 h-3.5 mr-1" /> Files
          </Button>
        ),
      },
    );

    cols.push({
      key: "_actions",
      label: "Actions",
      pinned: "right",
      hideFromPicker: true,
      headClassName: "text-right",
      className: "text-right",
      render: (l) => {
        // Locked final review on the Issues tab → read-only inspector
        if (status === "issue" && l.aa_decision_at && l.leads_feedback_at) {
          return (
            <Button size="sm" variant="outline" onClick={() => setReviewLine(l)}>
              <Lock className="w-3.5 h-3.5 mr-1" /> View final review
            </Button>
          );
        }
        if (isFrozen(l)) {
          return (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Read-only — completed on a previous day">
              <Lock className="w-3 h-3" /> Frozen
            </span>
          );
        }
        if (status === "allocated") {
          return (
            <Button
              size="sm" variant="default"
              onClick={() => markDone(l)}
              disabled={!l.qc_qa_checks}
              title={l.qc_qa_checks ? `Mark Done (${l.qc_qa_checks === "Issue" ? "Completed - Issues" : "Completed - No issues"})` : "Set QA Checks first"}
            >
              <Check className="w-4 h-4 mr-1" /> Done
            </Button>
          );
        }
        return (
          <Button size="sm" variant="ghost" onClick={() => markStatus(l.id, "allocated")}>Reopen</Button>
        );
      },
    });

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, status, profiles, rawColumns, isFrozen, selected, allVisibleSelected, someVisibleSelected]);

  const exportCsv = async () => {
    // Re-run the same query without pagination to export the full filtered set
    const statusFilter: Status[] = status === "completed" ? ["completed", "issue"] : [status];
    let q = supabase.from("lines").select("*").in("status", statusFilter)
      .order("allocated_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (!isAdmin && user) q = q.eq("assigned_to", user.id);
    if (filterEmployee !== "all") q = q.eq("employee", filterEmployee);
    if (filterCategory !== "all") q = q.eq("category", filterCategory);
    if (filterQcCategory !== "all") q = q.eq("qc_category", filterQcCategory);
    if (filterDateFrom) q = q.gte("date_submitted", filterDateFrom);
    if (filterDateTo) q = q.lte("date_submitted", filterDateTo);
    const { data, error } = await q.limit(10000);
    if (error) return toast.error(error.message);
    const rows = (data as Line[]) ?? [];
    const headers = ["Expense #", "Employee", "Allocated Date", "Auditor", "Category", "Amount", "Currency", "Merchant", "Project", "Branch", "Date Submitted", "User ID", "Status", "QC Category", "Type of Issue", "QA Checks", "Comment", "Completed At"];
    const escape = (v: unknown) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const csvRows = rows.map((l) => [
      l.expense_number, l.employee, l.allocated_date,
      l.assigned_to ? profiles[l.assigned_to] ?? "" : "",
      l.category, l.amount, l.currency, l.merchant, l.project, l.branch,
      l.date_submitted, l.user_id_field, l.status, l.qc_category, l.qc_type_of_issue,
      l.qc_qa_checks, l.qc_comment, l.qc_completed_at,
    ].map(escape).join(","));
    const csv = [headers.join(","), ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${status}_${format(new Date(), "yyyy-MM-dd")}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"}`);
  };

  const headerAction = (
    <div className="flex items-center gap-2">
      {status === "issue" && (
        <Button
          onClick={() => publishToReviewers(selected.size > 0 ? Array.from(selected) : lines.map((l) => l.id))}
          variant="default" size="sm" disabled={bulkBusy || lines.length === 0}
          title="Publishes to Team Leads' Review Queue and auto-routes each line to the EA matching 'Approved By'"
        >
          <Send className="w-4 h-4 mr-2" />
          Publish {selected.size > 0 ? `${selected.size} selected` : "all on this page"}
        </Button>
      )}
      <Button onClick={exportCsv} variant="outline" size="sm" disabled={loading || total === 0}>
        <Download className="w-4 h-4 mr-2" /> Export CSV
      </Button>
      <Button onClick={load} variant="outline" size="sm" disabled={loading}>
        <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
      </Button>
    </div>
  );

  // Compact filter bar
  const filterBar = (
    <div className="flex flex-wrap items-end gap-2 mb-3">
      <div className="flex-1 min-w-[200px]">
        <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Search (this page)</label>
        <Input placeholder="Expense, employee, merchant, project…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-sm" />
      </div>
      <div className="w-[160px]">
        <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">QC Category</label>
        <Select value={filterQcCategory} onValueChange={setFilterQcCategory}>
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {QC_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="w-[130px]">
        <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">From</label>
        <Input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="h-8 text-sm" />
      </div>
      <div className="w-[130px]">
        <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">To</label>
        <Input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="h-8 text-sm" />
      </div>
      {status === "issue" && (
        <div className="w-[160px]">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Review state</label>
          <Select value={filterReviewState} onValueChange={(v) => setFilterReviewState(v as "all" | "open" | "final")}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="open">Open (in review)</SelectItem>
              <SelectItem value="final">Final · Locked</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <Button variant="ghost" size="sm" onClick={resetFilters} className="h-8">
        <RotateCcw className="w-4 h-4 mr-1" /> Reset
      </Button>
    </div>
  );

  const bulkBar = selected.size > 0 ? (
    <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-md border border-border bg-accent/30">
      <span className="text-sm font-medium">{selected.size} selected</span>
      <div className="flex-1" />
      {status === "allocated" && (
        <>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => bulkDoneAs("No-issue")}>
            <CheckCircle2 className="w-4 h-4 mr-1 text-[hsl(var(--success))]" /> Done · No-issue
          </Button>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => bulkDoneAs("Issue")}>
            <AlertTriangle className="w-4 h-4 mr-1 text-[hsl(var(--warning))]" /> Done · Issue
          </Button>
        </>
      )}
      {status !== "allocated" && status !== "issue" && (
        <Button size="sm" variant="outline" disabled={bulkBusy} onClick={bulkReopen}>Reopen</Button>
      )}
      {status === "issue" && (
        <Button size="sm" variant="default" disabled={bulkBusy} onClick={() => publishToReviewers(Array.from(selected))}>
          <Send className="w-4 h-4 mr-1" /> Publish selected
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
    </div>
  ) : null;

  // Layout: Header + (filter bar + bulk bar + table) all stacked, table fills remaining height.
  return (
    <div className="flex flex-col h-full min-h-0">
      {!embedded && (
        <PageHeader
          title={
            status === "issue"
              ? <span className="flex items-baseline gap-3">{title}<span className="text-sm font-normal text-muted-foreground tabular-nums">{total.toLocaleString()} total</span></span>
              : title
          }
          description={description}
          action={headerAction}
        />
      )}
      {embedded && headerAction && (
        <div className="px-6 pt-3 pb-1 flex items-center justify-between">
          <div className="text-xs text-muted-foreground tabular-nums">{total.toLocaleString()} total</div>
          <div>{headerAction}</div>
        </div>
      )}
      <div className={cn("flex-1 min-h-0 flex flex-col pb-6", embedded ? "px-6 pt-2" : "px-6 pt-4")}>
        {filterBar}
        {bulkBar}
        <div className="flex-1 min-h-0">
          <DataTable<Line>
            rows={filtered}
            total={total}
            loading={loading}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(0); }}
            columns={columns}
            rowKey={(r) => r.id}
            storageKey={`linesview.${status}.v2`}
            emptyMessage={`No ${status === "issue" ? "issues" : `${status} lines`}.`}
          />
        </div>
      </div>

      <Dialog open={!!attachmentsLine} onOpenChange={(o) => !o && setAttachmentsLine(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Attachments — <span className="font-mono text-xs">{attachmentsLine?.expense_number ?? "—"}</span>
              <span className="text-muted-foreground font-normal"> · {attachmentsLine?.employee ?? "—"}</span>
            </DialogTitle>
          </DialogHeader>
          {attachmentsLine && (
            <AttachmentsGallery lineId={attachmentsLine.id} rawData={attachmentsLine.raw_data} />
          )}
        </DialogContent>
      </Dialog>

      {/* Final Review (read-only) inspector — opened from a locked Issues row */}
      <Dialog open={!!reviewLine} onOpenChange={(o) => !o && setReviewLine(null)}>
        <DialogContent className="max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 bg-gradient-to-br from-primary/5 via-accent/30 to-transparent border-b border-border">
            <DialogTitle className="text-sm">
              <span className="inline-flex items-center gap-2 text-foreground">
                <span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <Lock className="w-3.5 h-3.5" />
                </span>
                Final review <span className="text-xs font-normal text-muted-foreground">· read-only</span>
              </span>
              <div className="text-xs text-muted-foreground font-normal mt-2 ml-9">
                <span className="font-mono text-foreground/80">{reviewLine?.expense_number ?? "—"}</span>
                <span className="mx-1.5">·</span>
                {reviewLine?.employee ?? "—"}
              </div>
            </DialogTitle>
          </DialogHeader>
          {reviewLine && (
            <div className="px-6 py-5 space-y-5 text-sm">
              <section className="space-y-3">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-primary/80">Expense Auditor</div>
                <ReadOnlyField
                  label="EA Decision"
                  value={
                    reviewLine.aa_review_agree === true ? "Agree"
                    : reviewLine.aa_review_agree === false ? "Disagree"
                    : "—"
                  }
                  tone={reviewLine.aa_review_agree === true ? "success" : reviewLine.aa_review_agree === false ? "destructive" : undefined}
                />
                <ReadOnlyField
                  label="EA Comment"
                  value={reviewLine.aa_review_comment ?? reviewLine.aa_comment ?? "—"}
                  multiline
                />
                <ReadOnlyField
                  label="EA Submitted"
                  value={reviewLine.aa_decision_at ? format(new Date(reviewLine.aa_decision_at), "MMM d yyyy, HH:mm") : "—"}
                />
              </section>
              <section className="space-y-3 pt-4 border-t border-dashed border-border">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-primary/80">Team Lead</div>
                <ReadOnlyField
                  label="TL Feedback"
                  value={reviewLine.leads_feedback ?? "—"}
                  multiline
                />
                <ReadOnlyField
                  label="TL Submitted"
                  value={reviewLine.leads_feedback_at ? format(new Date(reviewLine.leads_feedback_at), "MMM d yyyy, HH:mm") : "—"}
                />
              </section>
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                <Lock className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0" />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  This record is locked. QA can review but cannot edit, re-publish, or override EA/TL inputs.
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const QcSelect = ({ value, options, onChange, disabled }: { value: string | null; options: string[]; onChange: (v: string) => void; disabled?: boolean }) => (
  <Select value={value ?? ""} onValueChange={onChange} disabled={disabled}>
    <SelectTrigger className="h-8 text-sm min-w-[130px]">
      <SelectValue placeholder="—" />
    </SelectTrigger>
    <SelectContent>
      {options.map((o) => (
        <SelectItem key={o} value={o}>{o}</SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const ReadOnlyField = ({ label, value, multiline, tone }: { label: string; value: string; multiline?: boolean; tone?: "success" | "destructive" }) => (
  <div className="space-y-1.5">
    <div className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{label}</div>
    <div
      className={cn(
        "text-sm rounded-md border border-border bg-card px-3 py-2 shadow-sm",
        multiline ? "whitespace-pre-wrap min-h-[60px]" : "",
        tone === "success" && "text-[hsl(var(--success))] font-medium border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5",
        tone === "destructive" && "text-destructive font-medium border-destructive/30 bg-destructive/5",
      )}
    >
      {value || "—"}
    </div>
  </div>
);
