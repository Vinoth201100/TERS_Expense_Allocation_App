import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Sparkles, Loader2, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { invokeEdgeFunction } from "@/lib/edgeFunctionHelper";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from "recharts";

type Widget =
  | { type: "kpi"; title: string; subtitle?: string; value: string }
  | {
      type: "bar" | "line" | "pie" | "table";
      title: string;
      subtitle?: string;
      data: { key: string; value: number; count?: number }[];
    };

type Dashboard = { summary: string; widgets: Widget[] };
type Msg = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "aianalysis.chat";
const DASHBOARD_KEY = "aianalysis.dashboard";

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(217 91% 60%)",
  "hsl(142 71% 45%)",
  "hsl(38 92% 50%)",
  "hsl(0 84% 60%)",
  "hsl(280 70% 60%)",
  "hsl(190 80% 50%)",
];

function KPI({ w }: { w: Extract<Widget, { type: "kpi" }> }) {
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{w.title}</div>
      <div className="text-3xl font-bold mt-1">{w.value}</div>
      {w.subtitle && <div className="text-xs text-muted-foreground mt-1">{w.subtitle}</div>}
    </Card>
  );
}

type ChartW = { type: "bar" | "line" | "pie"; title: string; subtitle?: string; data: { key: string; value: number; count?: number }[] };
function ChartWidget({ w }: { w: ChartW }) {
  return (
    <Card className="p-4 col-span-2">
      <div className="font-semibold text-sm">{w.title}</div>
      {w.subtitle && <div className="text-xs text-muted-foreground mb-2">{w.subtitle}</div>}
      <div className="h-64 mt-2">
        <ResponsiveContainer width="100%" height="100%">
          {w.type === "bar" ? (
            <BarChart data={w.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="key" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          ) : w.type === "line" ? (
            <LineChart data={w.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="key" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} />
            </LineChart>
          ) : (
            <PieChart>
              <Pie data={w.data} dataKey="value" nameKey="key" outerRadius={90} label>
                {w.data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

type TableW = { type: "table"; title: string; subtitle?: string; data: { key: string; value: number; count?: number }[] };
function TableWidget({ w }: { w: TableW }) {
  return (
    <Card className="p-4 col-span-2 overflow-hidden">
      <div className="font-semibold text-sm mb-2">{w.title}</div>
      <div className="overflow-auto max-h-72">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b">
            <tr>
              <th className="text-left py-2 px-2">Item</th>
              <th className="text-right py-2 px-2">Value</th>
              <th className="text-right py-2 px-2">Count</th>
            </tr>
          </thead>
          <tbody>
            {w.data.map((r, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="py-1.5 px-2">{r.key}</td>
                <td className="text-right py-1.5 px-2 font-mono">
                  {r.value?.toLocaleString?.() ?? r.value}
                </td>
                <td className="text-right py-1.5 px-2 text-muted-foreground">{r.count ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function AIAnalysis() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const rawMessages = localStorage.getItem(STORAGE_KEY);
      const rawDashboard = localStorage.getItem(DASHBOARD_KEY);
      if (rawMessages) setMessages(JSON.parse(rawMessages));
      if (rawDashboard) setDashboard(JSON.parse(rawDashboard));
    } catch (error) {
      console.warn("Failed to load AI chat history", error);
    }
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (dashboard) {
      localStorage.setItem(DASHBOARD_KEY, JSON.stringify(dashboard));
    } else {
      localStorage.removeItem(DASHBOARD_KEY);
    }
  }, [dashboard]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setLoading(true);
    try {
      const { data, error } = await invokeEdgeFunction(supabase, "expense-ai-analysis", {
        body: { messages: next },
      });
      
      if (error) {
        const msg = error.message;
        console.error("[expense-ai-analysis] Error:", msg);
        toast.error("Analysis failed", { description: msg, duration: 5000 });
        setMessages([...next, { role: "assistant", content: `⚠️ ${msg}` }]);
        return;
      }
      
      const dash: Dashboard = data?.dashboard;
      setDashboard(dash);
      setMessages([...next, { role: "assistant", content: data?.summary || "Updated." }]);
    } catch (e: any) {
      const msg = e?.message || "Request failed";
      console.error("[expense-ai-analysis] Exception:", e);
      toast.error(msg);
      setMessages([...next, { role: "assistant", content: `⚠️ ${msg}` }]);
    } finally {
      setLoading(false);
    }
  };

  const suggestions = [
    "Top 10 spenders this year",
    "Monthly spend trend",
    "Spend by category",
    "Top merchants by total amount",
  ];

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Dashboard */}
      <div className="flex-1 min-w-0 overflow-auto p-6 bg-muted/20">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold">AI Expense Analysis</h1>
        </div>

        {!dashboard || dashboard.widgets.length === 0 ? (
          <div className="h-[80%] flex flex-col items-center justify-center text-center">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: "var(--gradient-primary)" }}
            >
              <Sparkles className="w-8 h-8 text-primary-foreground" />
            </div>
            <h2 className="text-2xl font-bold">Build your customized dashboard</h2>
            <p className="text-muted-foreground mt-2 max-w-md">
              Ask the AI assistant on the right anything about expenses — users, categories,
              trends. The dashboard will update based on your questions.
            </p>
          </div>
        ) : (
          <>
            {dashboard.summary && (
              <p className="text-sm text-muted-foreground mb-4">{dashboard.summary}</p>
            )}
            <div className="grid grid-cols-2 gap-4">
              {dashboard.widgets.map((w, i) => {
                if (w.type === "kpi") return <KPI key={i} w={w as any} />;
                if (w.type === "table") return <TableWidget key={i} w={w as any} />;
                return <ChartWidget key={i} w={w as any} />;
              })}
            </div>
          </>
        )}
      </div>

      {/* Right: Chat */}
      <div className="w-[420px] border-l border-border flex flex-col bg-background shrink-0">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <div className="font-semibold text-sm">Chat Agent</div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setMessages([]);
              setDashboard(null);
              localStorage.removeItem(STORAGE_KEY);
              localStorage.removeItem(DASHBOARD_KEY);
            }}
          >
            Clear
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div ref={scrollRef} className="p-4 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">Try asking:</div>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="block w-full text-left text-sm px-3 py-2 rounded-md border border-border hover:bg-muted transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "ml-8 bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm"
                    : "mr-8 bg-muted rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
                }
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <div className="mr-8 bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Analyzing…
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-3 border-t border-border flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Ask about expenses…"
            disabled={loading}
          />
          <Button onClick={() => send()} disabled={loading || !input.trim()} size="icon">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
