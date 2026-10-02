import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CPF_API_URL = "https://pixnobolso.lol/api/cpf";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const cpf = new URL(req.url).searchParams.get("cpf")?.replace(/\D/g, "") || "";
  if (cpf.length !== 11) return json({ error: "CPF inválido" }, 400);

  try {
    const response = await fetch(`${CPF_API_URL}?cpf=${encodeURIComponent(cpf)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text || "Resposta inválida da API de CPF" };
    }

    if (!response.ok) {
      console.error(`[CPF] Provider returned ${response.status}`);
      return json({ error: "Consulta de CPF indisponível" }, response.status);
    }

    return json(data);
  } catch (error) {
    console.error("[CPF] Provider request failed:", error);
    return json({ error: "Falha ao consultar CPF" }, 502);
  }
});
