import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  op: "invite" | "delete" | "disable" | "enable" | "reset_password";
  email?: string;
  user_id?: string;
  reason: string;
  full_name?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: cErr } = await userClient.auth.getClaims(token);
    if (cErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);

    const callerId = claims.claims.sub as string;
    const admin = createClient(SUPABASE_URL, SERVICE);

    // Verify caller is admin
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "Forbidden — admin only" }, 403);

    const body = (await req.json()) as Body;
    if (!body?.op) return json({ error: "op required" }, 400);
    if (!body.reason || body.reason.trim().length < 3) {
      return json({ error: "Reason (min 3 chars) required" }, 400);
    }

    let targetId = body.user_id ?? null;
    let result: Record<string, unknown> = {};

    switch (body.op) {
      case "invite": {
        if (!body.email) return json({ error: "email required" }, 400);
        const { data, error } = await admin.auth.admin.inviteUserByEmail(body.email, {
          data: { full_name: body.full_name ?? body.email.split("@")[0] },
        });
        if (error) return json({ error: error.message }, 400);
        targetId = data.user?.id ?? null;
        result = { email: body.email, user_id: targetId };
        break;
      }
      case "delete": {
        if (!body.user_id) return json({ error: "user_id required" }, 400);
        if (body.user_id === callerId) return json({ error: "Cannot delete yourself" }, 400);
        const { error } = await admin.auth.admin.deleteUser(body.user_id);
        if (error) return json({ error: error.message }, 400);
        result = { user_id: body.user_id };
        break;
      }
      case "disable":
      case "enable": {
        if (!body.user_id) return json({ error: "user_id required" }, 400);
        if (body.user_id === callerId && body.op === "disable") {
          return json({ error: "Cannot disable yourself" }, 400);
        }
        // ban_duration: '876000h' (~100 yrs) to disable, 'none' to enable
        const ban = body.op === "disable" ? "876000h" : "none";
        const { error } = await admin.auth.admin.updateUserById(body.user_id, {
          ban_duration: ban,
        } as never);
        if (error) return json({ error: error.message }, 400);
        result = { user_id: body.user_id, banned: body.op === "disable" };
        break;
      }
      case "reset_password": {
        if (!body.email) return json({ error: "email required" }, 400);
        const origin = req.headers.get("origin") ?? req.headers.get("referer") ?? "";
        const redirectTo = origin ? `${origin.replace(/\/$/, "")}/auth` : undefined;
        
        try {
          const { data, error } = await admin.auth.admin.generateLink({
            type: "recovery",
            email: body.email,
            options: redirectTo ? { redirectTo } : undefined,
          });
          
          if (error) {
            console.error("[reset_password] Generate link error:", {
              message: error.message,
              status: error.status,
              email: body.email
            });
            return json({ 
              error: `Failed to generate recovery link: ${error.message}` 
            }, 400);
          }
          
          result = {
            email: body.email,
            action_link: data?.properties?.action_link ?? null,
          };
        } catch (err) {
          console.error("[reset_password] Exception:", err);
          return json({ 
            error: `Exception generating recovery link: ${(err as Error).message}` 
          }, 500);
        }
        break;
      }
      default:
        return json({ error: "Unknown op" }, 400);
    }

    // Log
    await admin.from("admin_audit_log").insert({
      actor_id: callerId,
      action: `user_${body.op}`,
      target_type: "user",
      target_id: targetId ?? body.email ?? null,
      reason: body.reason,
      metadata: result,
    });

    return json({ ok: true, ...result });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
