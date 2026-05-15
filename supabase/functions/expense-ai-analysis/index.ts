import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

const SYSTEM = `You are an expense analytics assistant for the TERS app.
You analyze the public.lines table (one row per QA-audited expense line).
Useful columns: employee (text), user_id_field, branch, category, merchant,
project, amount (numeric), currency, date_submitted (date), approved_by,
qc_category, qc_type_of_issue, status.

Each unique expense is keyed by expense_number; treat duplicate expense_numbers
as the same expense (same row both for QA & EA). When summing or counting across
the dataset, use the query_expenses tool which already de-duplicates.

Workflow:
1. Use the query_expenses tool 1-3 times to get the data you need.
2. Then call render_dashboard EXACTLY ONCE with widgets that answer the user's
   question. Always include 1-2 KPI cards plus at least one chart or table.
3. Keep summary <= 2 short sentences. Be specific (numbers, names).

If the user asks something unrelated to expense data, politely answer in
render_dashboard with widgets:[] and a brief summary.`;

const tools = [
  {
    type: "function",
    function: {
      name: "query_expenses",
      description:
        "Aggregate the de-duplicated expense lines. Returns rows with `key` and `value` (and `count`).",
      parameters: {
        type: "object",
        properties: {
          group_by: {
            type: "string",
            enum: [
              "employee",
              "category",
              "branch",
              "merchant",
              "project",
              "currency",
              "month",
              "approved_by",
              "none",
            ],
          },
          metric: { type: "string", enum: ["sum_amount", "count", "avg_amount"] },
          filters: {
            type: "object",
            properties: {
              employee: { type: "string" },
              branch: { type: "string" },
              category: { type: "string" },
              merchant: { type: "string" },
              project: { type: "string" },
              date_from: { type: "string", description: "YYYY-MM-DD" },
              date_to: { type: "string", description: "YYYY-MM-DD" },
            },
            additionalProperties: false,
          },
          order: { type: "string", enum: ["value_desc", "value_asc", "key_asc"] },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        required: ["group_by", "metric"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "render_dashboard",
      description: "Final response. Renders widgets in the user's dashboard.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          widgets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["kpi", "bar", "line", "pie", "table"] },
                title: { type: "string" },
                subtitle: { type: "string" },
                // for kpi
                value: { type: "string" },
                // for chart/table
                data: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      key: { type: "string" },
                      value: { type: "number" },
                      count: { type: "number" },
                    },
                    required: ["key"],
                    additionalProperties: true,
                  },
                },
              },
              required: ["type", "title"],
              additionalProperties: false,
            },
          },
        },
        required: ["summary", "widgets"],
        additionalProperties: false,
      },
    },
  },
];

async function runQuery(args: any) {
  const { group_by, metric, filters = {}, order = "value_desc", limit = 15 } = args;

  // Fetch deduped rows then aggregate in memory (simpler & safe).
  let q = admin
    .from("lines")
    .select(
      "expense_number,employee,branch,category,merchant,project,currency,amount,date_submitted,approved_by",
    )
    .limit(10000);

  if (filters.employee) q = q.ilike("employee", `%${filters.employee}%`);
  if (filters.branch) q = q.ilike("branch", `%${filters.branch}%`);
  if (filters.category) q = q.ilike("category", `%${filters.category}%`);
  if (filters.merchant) q = q.ilike("merchant", `%${filters.merchant}%`);
  if (filters.project) q = q.ilike("project", `%${filters.project}%`);
  if (filters.date_from) q = q.gte("date_submitted", filters.date_from);
  if (filters.date_to) q = q.lte("date_submitted", filters.date_to);

  const { data, error } = await q;
  if (error) return { error: error.message };

  // Dedupe by expense_number
  const seen = new Map<string, any>();
  for (const r of data ?? []) {
    const k = r.expense_number || crypto.randomUUID();
    if (!seen.has(k)) seen.set(k, r);
  }
  const rows = [...seen.values()];

  const keyOf = (r: any): string => {
    if (group_by === "none") return "all";
    if (group_by === "month") {
      return r.date_submitted ? String(r.date_submitted).slice(0, 7) : "unknown";
    }
    return (r[group_by] ?? "unknown")?.toString() || "unknown";
  };

  const buckets = new Map<string, { sum: number; count: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    const b = buckets.get(k) ?? { sum: 0, count: 0 };
    b.sum += Number(r.amount) || 0;
    b.count += 1;
    buckets.set(k, b);
  }

  let out = [...buckets.entries()].map(([key, v]) => ({
    key,
    value:
      metric === "sum_amount"
        ? Math.round(v.sum * 100) / 100
        : metric === "avg_amount"
          ? v.count ? Math.round((v.sum / v.count) * 100) / 100 : 0
          : v.count,
    count: v.count,
  }));

  if (order === "value_desc") out.sort((a, b) => b.value - a.value);
  else if (order === "value_asc") out.sort((a, b) => a.value - b.value);
  else out.sort((a, b) => a.key.localeCompare(b.key));

  out = out.slice(0, limit);
  return { rows: out, total_rows_considered: rows.length };
}

async function callGateway(messages: any[]) {
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        tools,
        tool_choice: "auto",
      }),
    });
    
    if (!res.ok) {
      const t = await res.text();
      const errorMsg = `AI gateway error: ${res.status} ${t}`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    return await res.json();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[callGateway] Error:", msg);
    throw new Error(`AI Gateway: ${msg}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { messages: userMessages } = body;
    
    if (!Array.isArray(userMessages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messages: any[] = [
      { role: "system", content: SYSTEM },
      ...userMessages,
    ];

    let dashboard: any = null;
    let summary = "";
    
    try {
      for (let i = 0; i < 6; i++) {
        const data = await callGateway(messages);
        const msg = data.choices?.[0]?.message;
        if (!msg) break;
        messages.push(msg);
        const calls = msg.tool_calls ?? [];
        if (!calls.length) {
          summary = msg.content || "";
          break;
        }
        let finished = false;
        for (const tc of calls) {
          const name = tc.function?.name;
          let args: any = {};
          try {
            args = JSON.parse(tc.function?.arguments || "{}");
          } catch (e) {
            console.warn(`[render] Failed to parse tool args: ${e}`);
          }
          
          if (name === "render_dashboard") {
            dashboard = args;
            summary = args.summary || "";
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: "ok",
            });
            finished = true;
          } else if (name === "query_expenses") {
            const result = await runQuery(args);
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(result),
            });
          } else {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify({ error: `unknown tool ${name}` }),
            });
          }
        }
        if (finished) break;
      }
    } catch (loopErr) {
      const msg = loopErr instanceof Error ? loopErr.message : String(loopErr);
      console.error("[ai-loop] Error:", msg);
      throw new Error(`Analysis failed: ${msg}`);
    }

    return new Response(
      JSON.stringify({
        summary: summary || "Done.",
        dashboard: dashboard ?? { summary, widgets: [] },
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[expense-ai-analysis] Exception:", e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
