import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, Send, MessageSquare, ThumbsUp, ThumbsDown, Save, Lock } from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { AttachmentsGallery } from "@/components/AttachmentsGallery";

interface PublishedLine {
  id: string;
  expense_number: string | null;
  employee: string | null;
  amount: number | null;
  currency: string | null;
  merchant: string | null;
  category: string | null;
  branch: string | null;
  qc_category: string | null;
  qc_type_of_issue: string | null;
  qc_qa_checks: string | null;
  qc_comment: string | null;
  audit_status: string | null;
  aa_decision_at: string | null;
  aa_review_agree: boolean | null;
  aa_review_comment: string | null;
  aa_assigned_to: string | null;
  published_at: string;
  published_by: string | null;
  assigned_to: string | null;
  leads_feedback: string | null;
  leads_agrees: boolean | null;
  leads_feedback_at: string | null;
  leads_feedback_by: string | null;
  raw_data: Record<string, unknown> | null;
}

interface Feedback {
  id: string;
  line_id: string;
  author_id: string;
  author_role: string;
  comment: string;
  created_at: string;
}

const Queue = () => {
  const { user, role, roles } = useAuth();
  const [lines, setLines] = useState<PublishedLine[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [latestApprover, setLatestApprover] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  // Leads feedback edit state for the selected line
  const [leadsDraft, setLeadsDraft] = useState<string>("");
  const [agreesDraft, setAgreesDraft] = useState<boolean | null>(null);
  const [savingLeads, setSavingLeads] = useState(false);

  const myAuthorRole =
    roles.includes("team_lead") ? "team_lead"
    : roles.includes("expense_auditor") ? "expense_auditor"
    : role === "admin" ? "admin"
    : "auditor";

  const canEditLeads = myAuthorRole === "team_lead" || myAuthorRole === "expense_auditor" || myAuthorRole === "admin";

  const loadLines = useCallback(async () => {
    setLoading(true);
    const [{ data, error }, { data: pr }] = await Promise.all([
      supabase
        .from("lines")
        .select("id, expense_number, employee, amount, currency, merchant, category, branch, qc_category, qc_type_of_issue, qc_qa_checks, qc_comment, audit_status, aa_decision_at, aa_review_agree, aa_review_comment, aa_assigned_to, published_at, published_by, assigned_to, leads_feedback, leads_agrees, leads_feedback_at, leads_feedback_by, raw_data")
        .not("published_at", "is", null)
        .order("published_at", { ascending: false })
        .limit(200),
      supabase.from("profiles").select("user_id, full_name"),
    ]);
    if (error) toast.error(error.message);
    const lineRows = (data as PublishedLine[]) ?? [];
    setLines(lineRows);
    const map: Record<string, string> = {};
    (pr ?? []).forEach((p: { user_id: string; full_name: string }) => { map[p.user_id] = p.full_name; });
    setProfiles(map);

    if (lineRows.length > 0) {
      const ids = lineRows.map((l) => l.id);
      const { data: fbs } = await supabase
        .from("issue_feedback")
        .select("line_id, author_id, author_role, created_at")
        .in("line_id", ids)
        .eq("author_role", "expense_auditor")
        .order("created_at", { ascending: false });
      const seen = new Map<string, string>();
      (fbs ?? []).forEach((f: { line_id: string; author_id: string }) => {
        if (!seen.has(f.line_id)) seen.set(f.line_id, f.author_id);
      });
      const approverMap: Record<string, string> = {};
      seen.forEach((authorId, lineId) => { approverMap[lineId] = map[authorId] ?? "Approved auditor"; });
      setLatestApprover(approverMap);
    } else {
      setLatestApprover({});
    }
    setLoading(false);
  }, []);

  const loadFeedback = useCallback(async (lineId: string) => {
    const { data, error } = await supabase
      .from("issue_feedback")
      .select("*")
      .eq("line_id", lineId)
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);
    setFeedback((data as Feedback[]) ?? []);
  }, []);

  useEffect(() => { loadLines(); }, [loadLines]);

  useEffect(() => {
    const ch = supabase
      .channel("queue-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "lines" }, () => loadLines())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "issue_feedback" }, (payload) => {
        const fb = payload.new as Feedback;
        if (selectedId && fb.line_id === selectedId) {
          setFeedback((prev) => [...prev, fb]);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadLines, selectedId]);

  // Sync local leads-feedback drafts when selection changes / line refreshes
  useEffect(() => {
    if (!selectedId) { setLeadsDraft(""); setAgreesDraft(null); setFeedback([]); return; }
    loadFeedback(selectedId);
    const sel = lines.find((l) => l.id === selectedId);
    setLeadsDraft(sel?.leads_feedback ?? "");
    setAgreesDraft(sel?.leads_agrees ?? null);
  }, [selectedId, lines, loadFeedback]);

  const postFeedback = async () => {
    if (!user || !selectedId || !comment.trim()) return;
    setPosting(true);
    const { error } = await supabase.from("issue_feedback").insert({
      line_id: selectedId,
      author_id: user.id,
      author_role: myAuthorRole as "admin" | "team_lead" | "expense_auditor" | "auditor",
      comment: comment.trim(),
    });
    setPosting(false);
    if (error) return toast.error(error.message);
    setComment("");
    toast.success("Feedback posted");
    loadFeedback(selectedId);
  };

  const saveLeadsFeedback = async () => {
    if (!selectedId) return;
    setSavingLeads(true);
    const { error } = await supabase
      .from("lines")
      .update({ leads_feedback: leadsDraft.trim() || null, leads_agrees: agreesDraft } as never)
      .eq("id", selectedId);
    setSavingLeads(false);
    if (error) return toast.error(error.message);
    toast.success("Leads feedback saved");
    loadLines();
  };

  const selectedLine = lines.find((l) => l.id === selectedId);
  const leadsDirty =
    !!selectedLine &&
    ((selectedLine.leads_feedback ?? "") !== leadsDraft || (selectedLine.leads_agrees ?? null) !== agreesDraft);

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title={<span className="flex items-baseline gap-3">Review Queue<span className="text-sm font-normal text-muted-foreground tabular-nums">{lines.length} published</span></span>}
        description="Issues published by auditors. Review every field, add leads feedback, and attach supporting files."
        action={
          <Button onClick={loadLines} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        }
      />
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1fr_460px] gap-4 px-6 pb-6 pt-4">
        {/* List */}
        <div className="rounded-md border border-border bg-card overflow-hidden flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-border bg-muted/30 text-xs text-muted-foreground">
            Published issues
          </div>
          <ScrollArea className="flex-1">
            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
            ) : lines.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Nothing published yet.</div>
            ) : (
              <ul className="divide-y divide-border">
                {lines.map((l) => (
                  <li key={l.id}>
                    <button
                      onClick={() => setSelectedId(l.id)}
                      className={cn(
                        "w-full text-left px-4 py-3 hover:bg-accent/40 transition-colors",
                        selectedId === l.id && "bg-accent/60",
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs">{l.expense_number ?? "—"}</span>
                        <Badge variant="outline" className="text-[10px] font-normal">{l.audit_status ?? "Audited"}</Badge>
                        {l.leads_agrees === true && <Badge className="text-[10px] font-normal bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/20">Agree</Badge>}
                        {l.leads_agrees === false && <Badge variant="destructive" className="text-[10px] font-normal">Disagree</Badge>}
                        <div className="flex-1" />
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(l.published_at), { addSuffix: true })}
                        </span>
                      </div>
                      <div className="text-sm font-medium truncate">{l.employee ?? "Unknown employee"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {l.merchant ?? "—"} · {l.category ?? "—"} · {l.amount != null ? `${l.currency ?? ""} ${Number(l.amount).toLocaleString()}` : "—"}
                      </div>
                      <div className="text-[11px] mt-1 flex items-center gap-2 flex-wrap">
                        <span className="text-muted-foreground">QA:</span>
                        <span className="font-medium">{l.assigned_to ? profiles[l.assigned_to] ?? "—" : "—"}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">Approved by:</span>
                        <span className={cn(latestApprover[l.id] ? "font-medium" : "text-muted-foreground/60")}>
                          {latestApprover[l.id] ?? "—"}
                        </span>
                      </div>
                      {l.qc_category && (
                        <div className="text-xs mt-1">
                          <span className="text-destructive">{l.qc_category}</span>
                          {l.qc_type_of_issue ? <span className="text-muted-foreground"> · {l.qc_type_of_issue}</span> : null}
                        </div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </div>

        {/* Detail */}
        <div className="rounded-md border border-border bg-card overflow-hidden flex flex-col min-h-0">
          {!selectedLine ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
              <div>
                <MessageSquare className="w-6 h-6 mx-auto mb-2 opacity-40" />
                Select an issue to review fields, attachments, and feedback
              </div>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-5">
                {/* Header */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs">{selectedLine.expense_number ?? "—"}</span>
                    <Badge variant="outline" className="text-[10px] font-normal">{selectedLine.audit_status ?? "Audited"}</Badge>
                  </div>
                  <div className="text-sm font-medium">{selectedLine.employee ?? "—"}</div>
                </div>

                {/* All Issues fields */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <Field label="Approved by" value={latestApprover[selectedLine.id]} />
                  <Field label="Audit Status" value={selectedLine.audit_status ?? "Audited"} />
                  <Field label="QC Category" value={selectedLine.qc_category} highlight={!!selectedLine.qc_category} />
                  <Field label="Employee" value={selectedLine.employee} />
                  <Field label="Expense #" value={selectedLine.expense_number} mono />
                  <Field label="Branch" value={selectedLine.branch} />
                  <Field label="Merchant" value={selectedLine.merchant} />
                  <Field label="Type of Issue" value={selectedLine.qc_type_of_issue} />
                  <Field label="QC Checks" value={selectedLine.qc_qa_checks} />
                  <Field label="Auditor" value={selectedLine.assigned_to ? profiles[selectedLine.assigned_to] : null} />
                  <div className="col-span-2">
                    <Field label="Comment" value={selectedLine.qc_comment} block />
                  </div>
                </div>

                {/* EA Review (if EA was assigned) */}
                {selectedLine.aa_assigned_to && (
                  <div className="border-t border-border pt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">EA Review</div>
                      {selectedLine.aa_decision_at && (
                        <span className="text-[10px] text-muted-foreground">
                          Submitted {formatDistanceToNow(new Date(selectedLine.aa_decision_at), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">EA:</span>
                      <span className="text-xs font-medium">{profiles[selectedLine.aa_assigned_to] ?? "—"}</span>
                      {selectedLine.aa_review_agree === true && <Badge className="text-[10px] bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/20">Agree</Badge>}
                      {selectedLine.aa_review_agree === false && <Badge variant="destructive" className="text-[10px]">Disagree</Badge>}
                      {selectedLine.aa_review_agree === null && <Badge variant="outline" className="text-[10px]">Pending</Badge>}
                    </div>
                    <div className="text-sm whitespace-pre-wrap text-foreground/90 rounded-md border border-border bg-muted/30 p-2">
                      {selectedLine.aa_review_comment ?? <span className="italic text-muted-foreground/60">No EA comment yet</span>}
                    </div>
                  </div>
                )}

                {/* Leads Feedback section */}
                {(() => {
                  const locked = !!selectedLine.aa_decision_at && !!selectedLine.leads_feedback_at;
                  const editable = canEditLeads && !locked;
                  return (
                <div className="border-t border-border pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                      Leads Feedback
                      {locked && <Badge variant="outline" className="text-[10px] font-normal"><Lock className="w-3 h-3 mr-1" />Locked</Badge>}
                    </div>
                    {selectedLine.leads_feedback_at && (
                      <span className="text-[10px] text-muted-foreground">
                        Last edited {formatDistanceToNow(new Date(selectedLine.leads_feedback_at), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                  <Textarea
                    value={leadsDraft}
                    onChange={(e) => setLeadsDraft(e.target.value)}
                    disabled={!editable}
                    placeholder={editable ? "Write leads feedback…" : "Read-only"}
                    className="text-sm min-h-[80px]"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={agreesDraft === true ? "default" : "outline"}
                      disabled={!editable}
                      onClick={() => setAgreesDraft(agreesDraft === true ? null : true)}
                      className={cn(agreesDraft === true && "bg-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/90")}
                    >
                      <ThumbsUp className="w-4 h-4 mr-1" /> Agree
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={agreesDraft === false ? "destructive" : "outline"}
                      disabled={!editable}
                      onClick={() => setAgreesDraft(agreesDraft === false ? null : false)}
                    >
                      <ThumbsDown className="w-4 h-4 mr-1" /> Disagree
                    </Button>
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      onClick={saveLeadsFeedback}
                      disabled={!editable || !leadsDirty || savingLeads}
                    >
                      <Save className="w-4 h-4 mr-1" /> {savingLeads ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
                  );
                })()}

                {/* Attachments */}
                <div className="border-t border-border pt-4">
                  <AttachmentsGallery lineId={selectedLine.id} rawData={selectedLine.raw_data} />
                </div>

                {/* Discussion thread */}
                <div className="border-t border-border pt-4 space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Discussion</div>
                  {feedback.length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-4">No discussion yet</div>
                  ) : (
                    <ul className="space-y-3">
                      {feedback.map((f) => (
                        <li key={f.id} className="text-sm">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium">{profiles[f.author_id] ?? "Unknown"}</span>
                            <Badge variant="secondary" className="text-[9px] font-normal py-0 px-1.5">{f.author_role}</Badge>
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {format(new Date(f.created_at), "MMM d, HH:mm")}
                            </span>
                          </div>
                          <div className="text-sm text-foreground/90 whitespace-pre-wrap">{f.comment}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {(myAuthorRole === "team_lead" || myAuthorRole === "expense_auditor" || myAuthorRole === "admin") && (
                    <div className="space-y-2">
                      <Textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Add to the discussion…"
                        className="text-sm min-h-[60px]"
                      />
                      <Button
                        size="sm" className="w-full"
                        onClick={postFeedback}
                        disabled={posting || !comment.trim()}
                      >
                        <Send className="w-4 h-4 mr-2" /> Post comment
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, value, mono, highlight, block }: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  highlight?: boolean;
  block?: boolean;
}) => (
  <div className={cn(block && "col-span-2")}>
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className={cn(
      "text-sm",
      mono && "font-mono text-xs",
      highlight && "text-destructive font-medium",
      !value && "text-muted-foreground/60 italic",
    )}>
      {value || "—"}
    </div>
  </div>
);

export default Queue;
