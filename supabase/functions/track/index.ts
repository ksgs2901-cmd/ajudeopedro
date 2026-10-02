import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

Deno.serve(async (req: Request) => {
  // ── CORS preflight ──
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    console.log(`[TRACK] event=${body.eventName} id=${body.eventId}`);

    // ── Facebook Conversions API (CAPI) ──
    // Para ativar, configure as variáveis FB_PIXEL_ID e FB_ACCESS_TOKEN
    const FB_PIXEL_ID = Deno.env.get("FB_PIXEL_ID");
    const FB_ACCESS_TOKEN = Deno.env.get("FB_ACCESS_TOKEN");

    if (!FB_PIXEL_ID || !FB_ACCESS_TOKEN) {
      // CAPI não configurada — aceita silenciosamente
      return new Response(JSON.stringify({ ok: true, capi: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Monta o payload para a CAPI ──
    const userData: Record<string, string> = {};
    if (body.email) userData.em = await sha256(body.email.toLowerCase().trim());
    if (body.phone) userData.ph = await sha256(normalizePhone(body.phone));
    if (body.nome) {
      const parts = body.nome.trim().split(/\s+/);
      userData.fn = await sha256(parts[0].toLowerCase());
      if (parts.length > 1) userData.ln = await sha256(parts[parts.length - 1].toLowerCase());
    }
    if (body.fbp) userData.fbp = body.fbp;
    if (body.fbc) userData.fbc = body.fbc;
    if (body.eid) userData.external_id = await sha256(body.eid);
    userData.country = await sha256("br");

    const eventData: Record<string, unknown> = {
      event_name: body.eventName || "PageView",
      event_time: Math.floor(Date.now() / 1000),
      event_id: body.eventId || undefined,
      action_source: "website",
      user_data: userData,
    };

    if (body.value) {
      eventData.custom_data = {
        value: body.value,
        currency: "BRL",
      };
    }

    const capiResponse = await fetch(
      `https://graph.facebook.com/v18.0/${FB_PIXEL_ID}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [eventData],
          access_token: FB_ACCESS_TOKEN,
        }),
      }
    );

    const capiResult = await capiResponse.json();
    console.log(`[TRACK] CAPI response:`, JSON.stringify(capiResult));

    return new Response(JSON.stringify({ ok: true, capi: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[TRACK] Error:", err);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Helpers ──
async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 11 && !digits.startsWith("55")) return "55" + digits;
  return digits;
}
