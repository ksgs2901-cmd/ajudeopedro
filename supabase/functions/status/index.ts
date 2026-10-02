import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BLACKCAT_URL = "https://api.blackcatoficial.com/api";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

Deno.serve(async (req: Request) => {
  // ── CORS preflight ──
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ paid: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL(req.url);
    const txnId = url.searchParams.get("id");

    if (!txnId) {
      return new Response(JSON.stringify({ paid: false, error: "Missing id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const BLACKCAT_SECRET = Deno.env.get("BLACKCAT_SECRET_KEY");
    if (!BLACKCAT_SECRET) {
      console.error("BLACKCAT_SECRET_KEY not configured");
      return new Response(JSON.stringify({ paid: false, error: "Server config error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Consulta status na Blackcat ──
    const bcResponse = await fetch(`${BLACKCAT_URL}/sales/${txnId}/status`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": BLACKCAT_SECRET,
      },
    });

    const bcData = await bcResponse.json();

    if (!bcResponse.ok) {
      console.error(`[STATUS] Blackcat error for txn=${txnId}:`, JSON.stringify(bcData));
      return new Response(JSON.stringify({ paid: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Verifica se está pago ──
    // Blackcat retorna: { success: true, data: { status: "PAID" | "PENDING" | "CANCELLED" | "REFUNDED" } }
    const status = (bcData.data?.status || bcData.status || "").toUpperCase();
    const isPaid = status === "PAID";

    console.log(`[STATUS] txn=${txnId} status=${status} paid=${isPaid}`);

    return new Response(JSON.stringify({ paid: isPaid }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[STATUS] Unexpected error:", err);
    return new Response(JSON.stringify({ paid: false }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
