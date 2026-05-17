import { useState, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, FileSpreadsheet, Link as LinkIcon, Users, Briefcase } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

import { FIELD_ALIASES, buildHeaderMap } from "@/lib/headerAliases";

interface Batch {
  id: string;
  filename: string;
  upload_date: string;
  total_lines: number;
  total_groups: number;
  created_at: string;
  sharepoint_url?: string | null;
}

interface RawRow { [key: string]: unknown; }

const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const allHeadersForField = (excelHeaders: string[], field: string): string[] => {
  const aliases = new Set((FIELD_ALIASES[field] ?? []).map(normHeader));
  return excelHeaders.filter((h) => aliases.has(normHeader(h)));
};
const getStrSmart = (row: RawRow, allHeaders: string[]): string | null => {
  for (const h of allHeaders) {
    const v = row[h];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
};
const getNumSmart = (row: RawRow, allHeaders: string[]): number | null => {
  const v = getStrSmart(row, allHeaders);
  if (v == null) return null;
  const n = Number(v.replace(/[, ]/g, ""));
  return isNaN(n) ? null : n;
};
const getDateSmart = (row: RawRow, allHeaders: string[]): string | null => {
  const v = getStrSmart(row, allHeaders);
  if (!v) return null;
  const num = Number(v);
  if (!isNaN(num) && num > 25000 && num < 60000) {
    const d = XLSX.SSF.parse_date_code(num);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const sharePointToDownloadUrl = (url: string): string => {
  const trimmed = url.trim();
  if (/sharepoint\.com|1drv\.ms|onedrive/i.test(trimmed)) {
    const sep = trimmed.includes("?") ? "&" : "?";
    return trimmed.replace(/&download=\d/, "") + `${sep}download=1`;
  }
  return trimmed;
};

const UploadPage = () => {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [eaBatches, setEaBatches] = useState<Batch[]>([]);
  const [sharepointUrl, setSharepointUrl] = useState("");
  const [eaSharepointUrl, setEaSharepointUrl] = useState("");

  const loadBatches = useCallback(async () => {
    const [{ data: qa }, { data: ea }] = await Promise.all([
      supabase.from("batches").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("ea_batches" as never).select("*").order("created_at", { ascending: false }).limit(20),
    ]);
    setBatches((qa as Batch[]) ?? []);
    setEaBatches((ea as unknown as Batch[]) ?? []);
  }, []);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  // ============ QA ALLOCATION ============
  const processQAWorkbook = async (buf: ArrayBuffer, filename: string, sourceUrl: string | null) => {
    if (!user) { toast.error("Not signed in."); return; }
    setBusy(true);
    try {
      const today = format(new Date(), "yyyy-MM-dd");

      let wb: XLSX.WorkBook;
      try { wb = XLSX.read(buf, { type: "array" }); }
      catch (e) { throw new Error(`Excel parse failed: ${e instanceof Error ? e.message : "unknown"}`); }
      if (!wb.SheetNames.length) throw new Error("No sheets found.");
      const ws = wb.Sheets[wb.SheetNames[0]];

      const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
      if (aoa.length === 0) throw new Error("File is empty.");
      const excelHeaders = (aoa[0] as unknown[]).map((h) => (h == null ? "" : String(h).trim())).filter((h) => h.length > 0);

      const headerMap = buildHeaderMap(excelHeaders);
      if (headerMap.missingRequired.length > 0) {
        throw new Error(`Missing required column(s): ${headerMap.missingRequired.join(", ")}`);
      }

      const rows: RawRow[] = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
      if (rows.length === 0) throw new Error("No data rows found.");

      const fieldHeaders: Record<string, string[]> = {};
      for (const field of Object.keys(FIELD_ALIASES)) fieldHeaders[field] = allHeadersForField(excelHeaders, field);

      // Duplicate detection
      const uploadExpNums = Array.from(new Set(rows.map((r) => getStrSmart(r, fieldHeaders.expense_number)).filter((v): v is string => !!v)));
      const existingExpSet = new Set<string>();
      for (let i = 0; i < uploadExpNums.length; i += 500) {
        const chunk = uploadExpNums.slice(i, i + 500);
        const { data: existing } = await supabase.from("lines").select("expense_number").in("expense_number", chunk);
        (existing ?? []).forEach((r: { expense_number: string | null }) => { if (r.expense_number) existingExpSet.add(r.expense_number); });
      }

      const seenInUpload = new Set<string>();
      interface Prepared { row: RawRow; exp: string; emp: string; isDup: boolean; key: string }
      const prepared: Prepared[] = [];
      const groupSet = new Set<string>();
      let dupRowCount = 0, fallback = 0;
      for (const row of rows) {
        const exp = getStrSmart(row, fieldHeaders.expense_number) ?? "";
        const emp = getStrSmart(row, fieldHeaders.employee) ?? "";
        let dup = false;
        if (exp) { if (existingExpSet.has(exp) || seenInUpload.has(exp)) dup = true; else seenInUpload.add(exp); }
        if (dup) { dupRowCount++; prepared.push({ row, exp, emp, isDup: true, key: `__dup|${exp}` }); continue; }
        const key = (exp || emp) ? `${exp}|${emp}` : `__row_${fallback++}`;
        groupSet.add(key);
        prepared.push({ row, exp, emp, isDup: false, key });
      }

      const { data: batch, error: bErr } = await supabase
        .from("batches")
        .insert({
          filename, uploaded_by: user.id, upload_date: today,
          total_lines: rows.length, total_groups: groupSet.size,
          allocation_mode: "auto", sharepoint_url: sourceUrl,
        } as never)
        .select().single();
      if (bErr || !batch) throw bErr ?? new Error("Batch insert failed");

      const lineRows = prepared.map((p) => ({
        batch_id: batch.id,
        assigned_to: null,
        group_key: p.key,
        status: (p.isDup ? "duplicate" : "allocated") as "allocated" | "duplicate",
        expense_number: p.exp || null,
        employee: p.emp || null,
        user_id_field: getStrSmart(p.row, fieldHeaders.user_id_field),
        user_location: getStrSmart(p.row, fieldHeaders.user_location),
        approved_by: getStrSmart(p.row, fieldHeaders.approved_by),
        date_submitted: getDateSmart(p.row, fieldHeaders.date_submitted),
        category: getStrSmart(p.row, fieldHeaders.category),
        amount: getNumSmart(p.row, fieldHeaders.amount),
        currency: getStrSmart(p.row, fieldHeaders.currency),
        branch: getStrSmart(p.row, fieldHeaders.branch),
        project: getStrSmart(p.row, fieldHeaders.project),
        merchant: getStrSmart(p.row, fieldHeaders.merchant),
        raw_data: p.row as Record<string, unknown>,
      }));

      for (let i = 0; i < lineRows.length; i += 500) {
        const chunk = lineRows.slice(i, i + 500);
        const { error } = await supabase.from("lines").insert(chunk as never);
        if (error) throw error;
      }

      // Auto-allocate via RPC (round-robin across active QA auditors mapped to this TL)
      const { data: alloc, error: rpcErr } = await supabase.rpc("allocate_qa_batch" as never, { _batch_id: batch.id } as never);
      if (rpcErr) throw rpcErr;
      const result = (alloc ?? {}) as { assigned?: number; auditors?: number; reason?: string };

      if (result.reason) {
        toast.warning(`Batch uploaded (${rows.length} lines), but ${result.reason}. Map QA auditors to your team or mark attendance present.`);
      } else {
        toast.success(
          `QA batch uploaded: ${result.assigned ?? 0} lines auto-split across ${result.auditors ?? 0} QA auditor${result.auditors === 1 ? "" : "s"}` +
          (dupRowCount ? ` · ${dupRowCount} duplicates routed` : "")
        );
      }
      setSharepointUrl("");
      loadBatches();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      console.error("[QA Upload] failed", e);
      toast.error(msg.includes("row-level security") ? "Upload failed: your account does not have permission to create batches." : msg);
    } finally { setBusy(false); }
  };

  const handleQAFile = async (file: File) => {
    try { const buf = await file.arrayBuffer(); await processQAWorkbook(buf, file.name, null); }
    catch { toast.error("Could not read the file. Try saving as .xlsx and re-uploading."); }
  };
  const handleQASharepoint = async () => {
    if (!sharepointUrl.trim()) { toast.error("Paste a SharePoint URL first."); return; }
    setBusy(true);
    try {
      const dl = sharePointToDownloadUrl(sharepointUrl);
      const res = await fetch(dl, { credentials: "include" });
      if (!res.ok) throw new Error(`Fetch failed (${res.status}). Make sure the link is publicly accessible.`);
      const buf = await res.arrayBuffer();
      const filename = decodeURIComponent(sharepointUrl.split("/").pop()?.split("?")[0] || "sharepoint.xlsx");
      await processQAWorkbook(buf, filename, sharepointUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "SharePoint fetch failed");
      setBusy(false);
    }
  };

  // ============ EXPENSE (EA) ALLOCATION ============
  const processEAWorkbook = async (buf: ArrayBuffer, filename: string, sourceUrl: string | null) => {
    if (!user) { toast.error("Not signed in."); return; }
    setBusy(true);
    try {
      const today = format(new Date(), "yyyy-MM-dd");
      let wb: XLSX.WorkBook;
      try { wb = XLSX.read(buf, { type: "array" }); }
      catch (e) { throw new Error(`Excel parse failed: ${e instanceof Error ? e.message : "unknown"}`); }
      if (!wb.SheetNames.length) throw new Error("No sheets found.");
      const ws = wb.Sheets[wb.SheetNames[0]];

      const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
      if (aoa.length === 0) throw new Error("File is empty.");
      const excelHeaders = (aoa[0] as unknown[]).map((h) => (h == null ? "" : String(h).trim())).filter((h) => h.length > 0);

      const rows: RawRow[] = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
      if (rows.length === 0) throw new Error("No data rows found.");

      const fieldHeaders: Record<string, string[]> = {};
      for (const field of Object.keys(FIELD_ALIASES)) fieldHeaders[field] = allHeadersForField(excelHeaders, field);

      // Validate at least branch column is present
      if (fieldHeaders.branch.length === 0) {
        throw new Error("No branch column found. The file must include a 'Branch' column for EA allocation.");
      }

      const branchSet = new Set<string>();
      const eaRows = rows.map((row) => {
        const branch = getStrSmart(row, fieldHeaders.branch);
        if (branch) branchSet.add(branch.trim().toLowerCase());
        return {
          branch,
          expense_number: getStrSmart(row, fieldHeaders.expense_number),
          employee: getStrSmart(row, fieldHeaders.employee),
          user_id_field: getStrSmart(row, fieldHeaders.user_id_field),
          approved_by: getStrSmart(row, fieldHeaders.approved_by),
          date_submitted: getDateSmart(row, fieldHeaders.date_submitted),
          category: getStrSmart(row, fieldHeaders.category),
          amount: getNumSmart(row, fieldHeaders.amount),
          currency: getStrSmart(row, fieldHeaders.currency),
          project: getStrSmart(row, fieldHeaders.project),
          merchant: getStrSmart(row, fieldHeaders.merchant),
          raw_data: row as Record<string, unknown>,
        };
      });

      // Validate at least one EA mapping exists
      const { data: mappings } = await supabase.from("aa_branch_codes").select("branch_code").limit(1);
      if (!mappings || mappings.length === 0) {
        throw new Error("No Expense Auditor branch mappings exist. Map EAs to branches in Team & Attendance first.");
      }

      // Per-row dedup on expense_number — fetch existing rows in chunks
      const incomingExp = Array.from(new Set(eaRows.map((r) => r.expense_number).filter((v): v is string => !!v)));
      const existingByExp = new Map<string, { id: string; status: string }>();
      for (let i = 0; i < incomingExp.length; i += 500) {
        const chunk = incomingExp.slice(i, i + 500);
        const { data: existing } = await supabase
          .from("ea_lines" as never)
          .select("id, expense_number, status")
          .in("expense_number", chunk);
        ((existing ?? []) as Array<{ id: string; expense_number: string | null; status: string }>).forEach((r) => {
          if (r.expense_number) existingByExp.set(r.expense_number, { id: r.id, status: r.status });
        });
      }

      // Insert batch
      const { data: batch, error: bErr } = await supabase
        .from("ea_batches" as never)
        .insert({
          filename, uploaded_by: user.id, upload_date: today,
          total_lines: rows.length, total_branches: branchSet.size,
          sharepoint_url: sourceUrl, allocation_mode: "auto",
        } as never)
        .select().single();
      if (bErr || !batch) throw bErr ?? new Error("EA batch insert failed");
      const batchId = (batch as { id: string }).id;

      // Route each row: fresh insert vs. resubmit-update vs. skip
      const freshRows: typeof eaRows = [];
      const resubmitIds: string[] = [];
      const skippedExceptions: string[] = [];
      const skippedOther: string[] = [];

      for (const r of eaRows) {
        const existing = r.expense_number ? existingByExp.get(r.expense_number) : null;
        if (!existing) {
          freshRows.push(r);
          continue;
        }
        if (existing.status === "rejected") {
          resubmitIds.push(existing.id);
        } else if (existing.status === "exception") {
          skippedExceptions.push(existing.id);
        } else {
          skippedOther.push(existing.id);
        }
      }

      // Case 1: insert fresh lines
      if (freshRows.length > 0) {
        const lineRows = freshRows.map((r) => ({
          batch_id: batchId, status: "allocated" as const, is_resubmitted: false, ...r,
        }));
        for (let i = 0; i < lineRows.length; i += 500) {
          const chunk = lineRows.slice(i, i + 500);
          const { error } = await supabase.from("ea_lines" as never).insert(chunk as never);
          if (error) throw error;
        }
      }

      // Case 3: reopen previously-rejected lines
      if (resubmitIds.length > 0) {
        for (let i = 0; i < resubmitIds.length; i += 200) {
          const chunk = resubmitIds.slice(i, i + 200);
          const { error } = await supabase
            .from("ea_lines" as never)
            .update({
              status: "allocated",
              is_resubmitted: true,
              previous_status: "rejected",
              decided_at: null,
              final_decision: null,
              rejected_reason: null,
              decision_comment: null,
              updated_at: new Date().toISOString(),
            } as never)
            .in("id", chunk);
          if (error) throw error;
        }
      }

      // Run allocation only for the fresh rows in this batch
      const { data: alloc, error: rpcErr } = await supabase.rpc("allocate_ea_batch" as never, { _batch_id: batchId } as never);
      if (rpcErr) throw rpcErr;
      const result = (alloc ?? {}) as { assigned?: number; unassigned?: number; branches?: number };

      const parts = [
        `${freshRows.length} new`,
        `${resubmitIds.length} resubmitted`,
        `${skippedExceptions.length} skipped (exception)`,
        `${skippedOther.length} skipped (in flight)`,
      ];
      const summary = parts.join(" · ");

      if ((result.unassigned ?? 0) > 0) {
        toast.warning(`EA upload: ${summary}. ${result.unassigned} unassigned (no EA mapped or all absent).`);
      } else {
        toast.success(`EA upload: ${summary}.`);
      }
      setEaSharepointUrl("");
      loadBatches();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "EA upload failed";
      console.error("[EA Upload] failed", e);
      toast.error(msg);
    } finally { setBusy(false); }
  };

  const handleEAFile = async (file: File) => {
    try { const buf = await file.arrayBuffer(); await processEAWorkbook(buf, file.name, null); }
    catch { toast.error("Could not read the file."); }
  };
  const handleEASharepoint = async () => {
    if (!eaSharepointUrl.trim()) { toast.error("Paste a SharePoint URL first."); return; }
    setBusy(true);
    try {
      const dl = sharePointToDownloadUrl(eaSharepointUrl);
      const res = await fetch(dl, { credentials: "include" });
      if (!res.ok) throw new Error(`Fetch failed (${res.status}).`);
      const buf = await res.arrayBuffer();
      const filename = decodeURIComponent(eaSharepointUrl.split("/").pop()?.split("?")[0] || "sharepoint.xlsx");
      await processEAWorkbook(buf, filename, eaSharepointUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "SharePoint fetch failed");
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader title="Upload & Allocate" description="Two independent upload flows: QA Allocation feeds the QA queue; Expense Allocation feeds Expense Auditors." />
      <div className="flex-1 min-h-0 overflow-y-auto p-8 space-y-6">
        <Tabs defaultValue="qa" className="w-full">
          <TabsList className="grid w-full grid-cols-2 max-w-lg">
            <TabsTrigger value="qa"><Users className="w-4 h-4 mr-2" /> QA Allocation</TabsTrigger>
            <TabsTrigger value="ea"><Briefcase className="w-4 h-4 mr-2" /> Expense Allocation</TabsTrigger>
          </TabsList>

          {/* === QA Allocation === */}
          <TabsContent value="qa" className="mt-4 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">New QA batch</CardTitle>
                <CardDescription>Upload a file or paste a SharePoint link. Lines are auto-split equally across QA auditors mapped to your team and present today.</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="file" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 max-w-md">
                    <TabsTrigger value="file"><Upload className="w-4 h-4 mr-2" /> Upload file</TabsTrigger>
                    <TabsTrigger value="sharepoint"><LinkIcon className="w-4 h-4 mr-2" /> SharePoint link</TabsTrigger>
                  </TabsList>
                  <TabsContent value="file" className="mt-4">
                    <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-lg p-12 cursor-pointer hover:border-primary/50 hover:bg-accent/30 transition-colors">
                      <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center"><Upload className="w-6 h-6 text-accent-foreground" /></div>
                      <div className="text-center">
                        <div className="text-sm font-medium">{busy ? "Processing…" : "Click to upload .xlsx"}</div>
                        <div className="text-xs text-muted-foreground mt-1">Auto-allocates round-robin across active QA auditors</div>
                      </div>
                      <input type="file" accept=".xlsx,.xls" className="hidden" disabled={busy}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleQAFile(f); e.target.value = ""; }} />
                    </label>
                  </TabsContent>
                  <TabsContent value="sharepoint" className="mt-4 space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="sp-url">SharePoint / OneDrive file URL</Label>
                      <Input id="sp-url" type="url" placeholder="https://…/file.xlsx" value={sharepointUrl} onChange={(e) => setSharepointUrl(e.target.value)} disabled={busy} />
                      <p className="text-xs text-muted-foreground">Link must be shared with "Anyone with the link".</p>
                    </div>
                    <Button onClick={handleQASharepoint} disabled={busy || !sharepointUrl.trim()}>
                      {busy ? "Fetching & allocating…" : "Fetch & allocate"}
                    </Button>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <AddMorePanel kind="qa" />
            <BatchList title="Recent QA batches" items={batches} />
          </TabsContent>

          {/* === Expense (EA) Allocation === */}
          <TabsContent value="ea" className="mt-4 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">New Expense Auditor batch</CardTitle>
                <CardDescription>
                  Upload a file or paste a SharePoint link. Lines are read by branch (e.g. CC01) and auto-split evenly across EAs mapped to that branch and present today.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="file" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 max-w-md">
                    <TabsTrigger value="file"><Upload className="w-4 h-4 mr-2" /> Upload file</TabsTrigger>
                    <TabsTrigger value="sharepoint"><LinkIcon className="w-4 h-4 mr-2" /> SharePoint link</TabsTrigger>
                  </TabsList>
                  <TabsContent value="file" className="mt-4">
                    <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-lg p-12 cursor-pointer hover:border-primary/50 hover:bg-accent/30 transition-colors">
                      <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center"><Upload className="w-6 h-6 text-accent-foreground" /></div>
                      <div className="text-center">
                        <div className="text-sm font-medium">{busy ? "Processing…" : "Click to upload .xlsx for EAs"}</div>
                        <div className="text-xs text-muted-foreground mt-1">Branch-based even split across mapped Expense Auditors</div>
                      </div>
                      <input type="file" accept=".xlsx,.xls" className="hidden" disabled={busy}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleEAFile(f); e.target.value = ""; }} />
                    </label>
                  </TabsContent>
                  <TabsContent value="sharepoint" className="mt-4 space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="ea-sp-url">SharePoint / OneDrive file URL</Label>
                      <Input id="ea-sp-url" type="url" placeholder="https://…/file.xlsx" value={eaSharepointUrl} onChange={(e) => setEaSharepointUrl(e.target.value)} disabled={busy} />
                    </div>
                    <Button onClick={handleEASharepoint} disabled={busy || !eaSharepointUrl.trim()}>
                      {busy ? "Fetching & allocating…" : "Fetch & allocate"}
                    </Button>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <AddMorePanel kind="ea" />
            <BatchList title="Recent EA batches" items={eaBatches} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

const BatchList = ({ title, items }: { title: string; items: Batch[] }) => (
  <Card>
    <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
    <CardContent>
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4">No batches uploaded yet.</div>
      ) : (
        <div className="space-y-2">
          {items.map((b) => (
            <div key={b.id} className="flex items-center gap-3 p-3 rounded-md border border-border">
              <FileSpreadsheet className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{b.filename}</div>
                <div className="text-xs text-muted-foreground">
                  {format(new Date(b.created_at), "MMM d, yyyy · HH:mm")} · {b.total_lines} lines
                  {b.sharepoint_url ? " · from SharePoint" : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </CardContent>
  </Card>
);

interface AuditorRow {
  auditor_id: string;
  full_name: string;
  email: string;
  kind: "qa" | "ea";
  default_count: number;
  today_count: number;
  present_today: boolean;
}

const AddMorePanel = ({ kind }: { kind: "qa" | "ea" }) => {
  const [rows, setRows] = useState<AuditorRow[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const role = kind === "qa" ? "auditor" : "expense_auditor";
    const { data } = await supabase.rpc("get_auditors_by_role" as never, { _role: role, _kind: kind } as never);
    setRows(((data ?? []) as AuditorRow[]).filter((r) => r.kind === kind));
  }, [kind]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (r: AuditorRow) => {
    const n = parseInt(counts[r.auditor_id] || "0", 10);
    if (!n || n <= 0) { toast.error("Enter a count"); return; }
    setBusyId(r.auditor_id);
    try {
      const fn = kind === "qa" ? "add_more_lines_qa" : "add_more_lines_ea";
      const { data, error } = await supabase.rpc(fn as never, { _auditor: r.auditor_id, _count: n } as never);
      if (error) throw error;
      const moved = (data as number) ?? 0;
      if (moved === 0) toast.warning("No unallocated lines available to add");
      else toast.success(`Added ${moved} line${moved === 1 ? "" : "s"} to ${r.full_name || r.email}`);
      setCounts((p) => ({ ...p, [r.auditor_id]: "" }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add lines");
    } finally { setBusyId(null); }
  };

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add more lines</CardTitle>
        <CardDescription>
          Push extra unallocated {kind === "qa" ? "QA" : "Expense"} lines to a specific auditor when their queue is light.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div key={r.auditor_id} className="flex items-center gap-3 py-2 border-t border-border/60 first:border-t-0">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{r.full_name || r.email}</div>
              <div className="text-xs text-muted-foreground">Today target: {r.today_count}{!r.present_today ? " · marked absent" : ""}</div>
            </div>
            <Input type="number" min={1} placeholder="Count"
              className="h-9 w-24 text-right"
              value={counts[r.auditor_id] ?? ""}
              onChange={(e) => setCounts((p) => ({ ...p, [r.auditor_id]: e.target.value }))} />
            <Button size="sm" disabled={busyId === r.auditor_id} onClick={() => handleAdd(r)}>
              {busyId === r.auditor_id ? "Adding…" : "Add"}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default UploadPage;
