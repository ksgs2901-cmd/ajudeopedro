import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ══════════════════════════════════════════════════════════════
// CLOAK ADMIN API — Backend JSON para o painel admin
// O frontend HTML é servido via Vercel (arquivo estático)
// ══════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ADMIN_PASSWORD = Deno.env.get("CLOAK_ADMIN_PASSWORD") || "cloak2024";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-password",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isAuthorized(req: Request): boolean {
  const pw = req.headers.get("x-admin-password") || "";
  return pw === ADMIN_PASSWORD;
}

async function supabaseRest(
  path: string,
  method: string = "GET",
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extraHeaders,
  };

  if (method === "POST") headers["Prefer"] = "return=representation";
  if (method === "PATCH") headers["Prefer"] = "return=representation";

  const opts: RequestInit = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

// ══════════════════════════════════════════════════════════════
// REQUEST HANDLER
// ══════════════════════════════════════════════════════════════
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // ── Verify password ──
  if (action === "verify") {
    if (!isAuthorized(req)) {
      return json({ error: "unauthorized" }, 401);
    }
    return json({
      ok: true,
      supabase_url: SUPABASE_URL,
      key: SUPABASE_SERVICE_ROLE_KEY,
    });
  }

  // ── Todas as outras ações requerem autenticação ──
  if (!isAuthorized(req)) {
    return json({ error: "unauthorized" }, 401);
  }

  // ── GET Stats ──
  if (action === "stats") {
    const period = url.searchParams.get("period") || "7d";
    let dateFilter = "";
    const now = new Date();
    if (period === "24h") {
      dateFilter = `&created_at=gte.${new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()}`;
    } else if (period === "7d") {
      dateFilter = `&created_at=gte.${new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()}`;
    } else if (period === "30d") {
      dateFilter = `&created_at=gte.${new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()}`;
    }

    const [logsResult, campaignsResult] = await Promise.all([
      supabaseRest(`cloak_logs?select=campaign_id,verdict${dateFilter}&limit=10000`),
      supabaseRest("cloak_campaigns?select=id,name,slug,is_active&order=created_at.asc"),
    ]);

    return json({
      logs: logsResult.data,
      campaigns: campaignsResult.data,
    });
  }

  // ── GET Campaigns ──
  if (action === "campaigns" && req.method === "GET") {
    const result = await supabaseRest("cloak_campaigns?select=*&order=created_at.desc");
    return json(result.data);
  }

  // ── CREATE Campaign ──
  if (action === "campaigns" && req.method === "POST") {
    const body = await req.json();
    const result = await supabaseRest("cloak_campaigns", "POST", {
      name: body.name,
      slug: body.slug,
      safe_url: body.safe_url,
      money_url: body.money_url,
    });
    return json(result.data, result.status < 300 ? 201 : result.status);
  }

  // ── UPDATE Campaign ──
  if (action === "campaign-update") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "missing id" }, 400);
    const body = await req.json();
    const result = await supabaseRest(`cloak_campaigns?id=eq.${id}`, "PATCH", body);
    return json(result.data);
  }

  // ── DELETE Campaign ──
  if (action === "campaign-delete") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "missing id" }, 400);
    await supabaseRest(`cloak_campaigns?id=eq.${id}`, "DELETE");
    return json({ ok: true });
  }

  // ── GET Logs ──
  if (action === "logs") {
    const page = parseInt(url.searchParams.get("page") || "0");
    const limit = 50;
    const offset = page * limit;
    const campaignId = url.searchParams.get("campaign_id");
    const verdict = url.searchParams.get("verdict");
    const ip = url.searchParams.get("ip");

    let query = `cloak_logs?select=*,cloak_campaigns(name,slug)&order=created_at.desc&limit=${limit}&offset=${offset}`;
    if (campaignId) query += `&campaign_id=eq.${campaignId}`;
    if (verdict) query += `&verdict=eq.${verdict}`;
    if (ip) query += `&ip=eq.${ip}`;

    const result = await supabaseRest(query);
    return json(result.data);
  }

  return json({ error: "unknown action" }, 400);
});
