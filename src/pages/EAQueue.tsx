import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  RefreshCw, CheckCircle2, XCircle, PauseCircle, ArrowUpRight, FileWarning, ThumbsUp, ThumbsDown, Lock, AlertTriangle,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { differenceInBusinessDays, format } from "date-fns";
import { cn } from "@/lib/utils";

type EAStatus = "allocated" | "approved" | "rejected" | "exception" | "escalated";

interface EALine {
  id: string;
  expense_number: string | null;
  employee: string | null;
  branch: string | null;
  merchant: string | null;
  category: string | null;
  amount: number | null;
  currency: string | null;
  approved_by: string | null;
  status: EAStatus;
  allocated_date: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  rejected_reason: string | null;
  exception_hold_comment: string | null;
  followup_1_date: string | null;
  followup_2_date: string | null;
  followup_3_date: string | null;
  final_decision: string | null;
  escalated_comment: string | null;
  escalated_date: string | null;
  is_resubmitted: boolean | null;
  previous_status: string | null;
}

const TABS: { value: EAStatus; label: string }[] = [
  { value: "allocated", label: "Allocated" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "exception", label: "Exception" },
  { value: "escalated", label: "Escalated" },
];

const QA_TAB = "qa_issues";

const EAQueue = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<EAStatus | typeof QA_TAB>("allocated");
  const [lines, setLines] = useState<EALine[]>([]);
  const [qaLines, setQaLines] = useState<Array<{ id: string; expense_number: string | null; employee: string | null; branch: string | null; amount: number | null; currency: string | null; qc_category: string | null; qc_type_of_issue: string | null; qc_qa_checks: string | null; qc_comment: string | null; aa_status: string | null; aa_allocated_at: string | null; aa_decision_at: string | null; aa_review_agree: boolean | null; aa_review_comment: string | null; leads_feedback_at: string | null; approved_by: string | null }>>([]);
  const [qaReview, setQaReview] = useState<typeof qaLines[number] | null>(null);
  const [reviewAgree, setReviewAgree] = useState<boolean | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({
    allocated: 0, approved: 0, rejected: 0, exception: 0, escalated: 0, qa_issues: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Decision dialog state
  const [decision, setDecision] = useState<{ line: EALine; status: EAStatus } | null>(null);
  const [comment, setComment] = useState("");
  const [rejectedReason, setRejectedReason] = useState("");
  const [holdComment, setHoldComment] = useState("");
  const [f1, setF1] = useState(""); const [f2, setF2] = useState(""); const [f3, setF3] = useState("");
  const [finalDecision, setFinalDecision] = useState("");
  const [escComment, setEscComment] = useState("");
  const [escDate, setEscDate] = useState("");
  const [busy, setBusy] = useState(false);

  const today = format(new Date(), "yyyy-MM-dd");

  const loadCounts = useCallback(async () => {
    if (!user) return;
    const promises = TABS.map((t) =>
      supabase.from("ea_lines" as never).select("id", { count: "exact", head: true })
        .eq("assigned_ea", user.id).eq("status", t.value)
    );
    const qaP = supabase.from("lines").select("id", { count: "exact", head: true })
      .eq("aa_assigned_to", user.id);
    const results = await Promise.all([...promises, qaP]);
    const next: Record<string, number> = {};
    TABS.forEach((t, i) => { next[t.value] = (results[i] as { count: number | null }).count ?? 0; });
    next[QA_TAB] = (results[results.length - 1] as { count: number | null }).count ?? 0;
    setCounts(next);
  }, [user]);

  const loadLines = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    if (activeTab === QA_TAB) {
      const { data, error } = await supabase
        .from("lines")
        .select("id, expense_number, employee, branch, amount, currency, qc_category, qc_type_of_issue, qc_qa_checks, qc_comment, aa_status, aa_allocated_at, aa_decision_at, aa_review_agree, aa_review_comment, leads_feedback_at, approved_by")
        .eq("aa_assigned_to", user.id)
        .order("aa_allocated_at", { ascending: true, nullsFirst: false })
        .limit(500);
      if (error) toast.error(error.message);
      setQaLines(((data ?? []) as unknown) as typeof qaLines);
      setLines([]);
    } else {
      const { data, error } = await supabase
        .from("ea_lines" as never)
        .select("*")
        .eq("assigned_ea", user.id)
        .eq("status", activeTab)
        .order("allocated_date", { ascending: true, nullsFirst: false })
        .limit(500);
      if (error) toast.error(error.message);
      setLines(((data ?? []) as unknown) as EALine[]);
      setQaLines([]);
    }
    setLoading(false);
  }, [user, activeTab]);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { loadLines(); }, [loadLines]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("ea-queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "ea_lines" }, () => { loadCounts(); loadLines(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "lines" }, () => { loadCounts(); loadLines(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, loadCounts, loadLines]);

  const filtered = useMemo(() => {
    if (!search) return lines;
    const s = search.toLowerCase();
    return lines.filter((l) => (
      l.expense_number?.toLowerCase().includes(s)
      || l.employee?.toLowerCase().includes(s)
      || l.branch?.toLowerCase().includes(s)
      || l.merchant?.toLowerCase().includes(s)
    ));
  }, [lines, search]);

  const filteredQa = useMemo(() => {
    if (!search) return qaLines;
    const s = search.toLowerCase();
    return qaLines.filter((l) => (
      l.expense_number?.toLowerCase().includes(s)
      || l.employee?.toLowerCase().includes(s)
      || l.branch?.toLowerCase().includes(s)
    ));
  }, [qaLines, search]);

  const agingBadge = (date: string | null) => {
    if (!date) return <span className="text-muted-foreground text-xs">—</span>;
    const days = Math.max(0, differenceInBusinessDays(new Date(today), new Date(date)));
    const tone = days >= 7 ? "destructive" : days >= 3 ? "warning" : "muted";
    return (
      <span className={cn(
        "inline-flex items-center justify-center rounded px-1.5 py-0.5 text-xs tabular-nums",
        tone === "destructive" && "bg-destructive/15 text-destructive",
        tone === "warning" && "bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}>{days}d</span>
    );
  };

  const openDecision = (line: EALine, status: EAStatus) => {
    setDecision({ line, status });
    setComment(line.decision_comment ?? "");
    setRejectedReason(line.rejected_reason ?? "");
    setHoldComment(line.exception_hold_comment ?? "");
    setF1(line.followup_1_date ?? ""); setF2(line.followup_2_date ?? ""); setF3(line.followup_3_date ?? "");
    setFinalDecision(line.final_decision ?? "");
    setEscComment(line.escalated_comment ?? "");
    setEscDate(line.escalated_date ?? "");
  };

  const submitDecision = async () => {
    if (!decision) return;
    if (decision.status === "rejected" && !rejectedReason.trim()) { toast.error("Rejection reason is required."); return; }
    if (decision.status === "exception" && !holdComment.trim()) { toast.error("Hold comment is required for exceptions."); return; }
    if (decision.status === "escalated" && (!escComment.trim() || !escDate)) { toast.error("Escalation comment and date are required."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("ea_set_decision" as never, {
      _line_id: decision.line.id,
      _status: decision.status,
      _comment: comment.trim() || null,
      _rejected_reason: rejectedReason.trim() || null,
      _exception_hold_comment: holdComment.trim() || null,
      _followup_1: f1 || null,
      _followup_2: f2 || null,
      _followup_3: f3 || null,
      _final_decision: finalDecision.trim() || null,
      _escalated_comment: escComment.trim() || null,
      _escalated_date: escDate || null,
    } as never);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${decision.status}`);
    setDecision(null);
    loadCounts(); loadLines();
  };

  const openQaReview = (l: typeof qaLines[number]) => {
    setQaReview(l);
    setReviewAgree(l.aa_review_agree);
    setReviewComment(l.aa_review_comment ?? "");
  };

  const submitQaReview = async () => {
    if (!qaReview) return;
    if (reviewAgree === null) { toast.error("Choose Agree or Disagree."); return; }
    if (!reviewComment.trim()) { toast.error("Comment is required."); return; }
    setBusy(true);
    const { error } = await supabase
      .from("lines")
      .update({
        aa_review_agree: reviewAgree,
        aa_review_comment: reviewComment.trim(),
        aa_decision_at: new Date().toISOString(),
        aa_decision_by: user!.id,
        aa_status: "completed",
      } as never)
      .eq("id", qaReview.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Review submitted");
    setQaReview(null);
    loadCounts(); loadLines();
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Expense Auditor Queue"
        description="Daily expense lines allocated to you by branch. Aging is in business days from allocation."
        action={
          <Button onClick={() => { loadCounts(); loadLines(); }} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col px-6 pb-6 pt-4 space-y-3">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as EAStatus | typeof QA_TAB)} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="self-start flex-wrap h-auto">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="gap-2">
                {t.label}
                <Badge variant="secondary" className="text-[10px] tabular-nums px-1.5 py-0">{counts[t.value] ?? 0}</Badge>
              </TabsTrigger>
            ))}
            <TabsTrigger value={QA_TAB} className="gap-2">
              <FileWarning className="w-3.5 h-3.5" /> QA Issues Published
              <Badge variant="secondary" className="text-[10px] tabular-nums px-1.5 py-0">{counts[QA_TAB] ?? 0}</Badge>
            </TabsTrigger>
          </TabsList>

          <Input
            placeholder="Search expense, employee, branch, merchant…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-sm max-w-md mt-3"
          />

          {TABS.map((t) => (
            <TabsContent key={t.value} value={t.value} className="flex-1 min-h-0 mt-3">
              {loading ? (
                <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>
              ) : filtered.length === 0 ? (
                <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No lines in {t.label}.</CardContent></Card>
              ) : (
                <div className="rounded-md border border-border overflow-auto bg-card">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-xs text-muted-foreground">
                      <tr>
                        <th className="text-left py-2 px-3">Expense #</th>
                        <th className="text-left py-2 px-3">Employee</th>
                        <th className="text-left py-2 px-3">Branch</th>
                        <th className="text-left py-2 px-3">Approved By</th>
                        <th className="text-right py-2 px-3">Amount</th>
                        <th className="text-center py-2 px-3">Aging</th>
                        <th className="text-right py-2 px-3 min-w-[280px]">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((l) => (
                        <tr key={l.id} className={cn(
                          "border-t border-border hover:bg-accent/20",
                          l.is_resubmitted && "bg-[hsl(var(--warning))]/10 hover:bg-[hsl(var(--warning))]/15"
                        )}>
                          <td className="py-2 px-3 font-mono text-xs">
                            <div className="flex items-center gap-1.5">
                              {l.is_resubmitted && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <AlertTriangle className="w-3.5 h-3.5 text-[hsl(var(--warning))] shrink-0" />
                                    </TooltipTrigger>
                                    <TooltipContent>Previously rejected — resubmitted with documents</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                              <span>{l.expense_number ?? "—"}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3">{l.employee ?? "—"}</td>
                          <td className="py-2 px-3"><Badge variant="outline" className="font-normal">{l.branch ?? "—"}</Badge></td>
                          <td className="py-2 px-3 text-xs">{l.approved_by ?? "—"}</td>
                          <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                            {l.amount != null ? `${l.currency ?? ""} ${Number(l.amount).toLocaleString()}` : "—"}
                          </td>
                          <td className="py-2 px-3 text-center">{agingBadge(l.allocated_date)}</td>
                          <td className="py-2 px-3 text-right">
                            <div className="flex items-center justify-end gap-1 flex-wrap">
                              {activeTab === "allocated" ? (
                                <>
                                  <Button size="sm" variant="outline" className="h-7" onClick={() => openDecision(l, "approved")}>
                                    <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-[hsl(var(--success))]" /> Approve
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7" onClick={() => openDecision(l, "rejected")}>
                                    <XCircle className="w-3.5 h-3.5 mr-1 text-destructive" /> Reject
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7" onClick={() => openDecision(l, "exception")}>
                                    <PauseCircle className="w-3.5 h-3.5 mr-1" /> Exception
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7" onClick={() => openDecision(l, "escalated")}>
                                    <ArrowUpRight className="w-3.5 h-3.5 mr-1 text-[hsl(var(--warning))]" /> Escalate
                                  </Button>
                                </>
                              ) : (
                                <Button size="sm" variant="ghost" className="h-7" onClick={() => openDecision(l, "allocated")}>Reopen</Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
          ))}

          <TabsContent value={QA_TAB} className="flex-1 min-h-0 mt-3">
            {loading ? (
              <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>
            ) : filteredQa.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No QA-published issues for you.</CardContent></Card>
            ) : (
              <div className="rounded-md border border-border overflow-auto bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left py-2 px-3">Expense #</th>
                      <th className="text-left py-2 px-3">Employee</th>
                      <th className="text-left py-2 px-3">Branch</th>
                      <th className="text-left py-2 px-3">Approved By</th>
                      <th className="text-left py-2 px-3">QC Issue</th>
                      <th className="text-right py-2 px-3">Amount</th>
                      <th className="text-center py-2 px-3">Aging</th>
                      <th className="text-left py-2 px-3">Review</th>
                      <th className="text-right py-2 px-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredQa.map((l) => {
                      const locked = !!l.aa_decision_at && !!l.leads_feedback_at;
                      return (
                      <tr key={l.id} className="border-t border-border hover:bg-accent/20">
                        <td className="py-2 px-3 font-mono text-xs">{l.expense_number ?? "—"}</td>
                        <td className="py-2 px-3">{l.employee ?? "—"}</td>
                        <td className="py-2 px-3"><Badge variant="outline" className="font-normal">{l.branch ?? "—"}</Badge></td>
                        <td className="py-2 px-3 text-xs">{l.approved_by ?? "—"}</td>
                        <td className="py-2 px-3 text-xs">
                          {l.qc_category && <div className="text-destructive font-medium">{l.qc_category}</div>}
                          {l.qc_type_of_issue && <div className="text-muted-foreground">{l.qc_type_of_issue}</div>}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                          {l.amount != null ? `${l.currency ?? ""} ${Number(l.amount).toLocaleString()}` : "—"}
                        </td>
                        <td className="py-2 px-3 text-center">{agingBadge(l.aa_allocated_at)}</td>
                        <td className="py-2 px-3 text-xs">
                          {l.aa_review_agree === true && <Badge className="text-[10px] bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/20"><ThumbsUp className="w-3 h-3 mr-1" />Agree</Badge>}
                          {l.aa_review_agree === false && <Badge variant="destructive" className="text-[10px]"><ThumbsDown className="w-3 h-3 mr-1" />Disagree</Badge>}
                          {l.aa_review_agree === null && <span className="text-muted-foreground">Pending</span>}
                          {locked && <Badge variant="outline" className="ml-1 text-[10px]"><Lock className="w-3 h-3 mr-1" />Locked</Badge>}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <Button size="sm" variant="outline" className="h-7" onClick={() => openQaReview(l)} disabled={locked}>
                            {l.aa_review_agree !== null ? "Edit review" : "Review"}
                          </Button>
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Decision dialog */}
      <Dialog open={!!decision} onOpenChange={(o) => !o && setDecision(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="capitalize">Mark {decision?.status}</DialogTitle>
            <DialogDescription>
              {decision?.line.expense_number ?? "—"} · {decision?.line.employee ?? "—"} · {decision?.line.branch ?? "—"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-auto pr-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Comment (optional)</Label>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-[60px]" placeholder="Decision note…" />
            </div>

            {decision?.status === "rejected" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Rejection reason <span className="text-destructive">*</span></Label>
                <Textarea value={rejectedReason} onChange={(e) => setRejectedReason(e.target.value)} className="min-h-[60px]" placeholder="Why is this rejected?" />
              </div>
            )}

            {decision?.status === "exception" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Hold comment <span className="text-destructive">*</span></Label>
                  <Textarea value={holdComment} onChange={(e) => setHoldComment(e.target.value)} className="min-h-[60px]" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1"><Label className="text-xs">Follow-up 1</Label><Input type="date" value={f1} onChange={(e) => setF1(e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs">Follow-up 2</Label><Input type="date" value={f2} onChange={(e) => setF2(e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs">Follow-up 3</Label><Input type="date" value={f3} onChange={(e) => setF3(e.target.value)} /></div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Final decision</Label>
                  <Input value={finalDecision} onChange={(e) => setFinalDecision(e.target.value)} placeholder="Final outcome (optional now)" />
                </div>
              </>
            )}

            {decision?.status === "escalated" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Escalation comment <span className="text-destructive">*</span></Label>
                  <Textarea value={escComment} onChange={(e) => setEscComment(e.target.value)} className="min-h-[60px]" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Escalation date <span className="text-destructive">*</span></Label>
                  <Input type="date" value={escDate} onChange={(e) => setEscDate(e.target.value)} />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)}>Cancel</Button>
            <Button onClick={submitDecision} disabled={busy}>{busy ? "Saving…" : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QA Issue Review dialog */}
      <Dialog open={!!qaReview} onOpenChange={(o) => !o && setQaReview(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Review QA Issue</DialogTitle>
            <DialogDescription>
              {qaReview?.expense_number ?? "—"} · {qaReview?.employee ?? "—"} · {qaReview?.branch ?? "—"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-auto pr-1">
            {(qaReview?.qc_category || qaReview?.qc_type_of_issue || qaReview?.qc_qa_checks || qaReview?.qc_comment) && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
                {qaReview?.qc_category && <div><span className="text-muted-foreground">Category: </span><span className="text-destructive font-medium">{qaReview.qc_category}</span></div>}
                {qaReview?.qc_type_of_issue && <div><span className="text-muted-foreground">Type: </span>{qaReview.qc_type_of_issue}</div>}
                {qaReview?.qc_qa_checks && <div><span className="text-muted-foreground">Checks: </span>{qaReview.qc_qa_checks}</div>}
                {qaReview?.qc_comment && <div><span className="text-muted-foreground">QA comment: </span>{qaReview.qc_comment}</div>}
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Your decision <span className="text-destructive">*</span></Label>
              <div className="flex gap-2">
                <Button
                  type="button" size="sm"
                  variant={reviewAgree === true ? "default" : "outline"}
                  className={cn(reviewAgree === true && "bg-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/90")}
                  onClick={() => setReviewAgree(true)}
                >
                  <ThumbsUp className="w-4 h-4 mr-1" /> Agree
                </Button>
                <Button
                  type="button" size="sm"
                  variant={reviewAgree === false ? "destructive" : "outline"}
                  onClick={() => setReviewAgree(false)}
                >
                  <ThumbsDown className="w-4 h-4 mr-1" /> Disagree
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Comment <span className="text-destructive">*</span></Label>
              <Textarea value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} className="min-h-[80px]" placeholder="Explain your decision…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQaReview(null)}>Cancel</Button>
            <Button onClick={submitQaReview} disabled={busy}>{busy ? "Saving…" : "Submit review"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EAQueue;
