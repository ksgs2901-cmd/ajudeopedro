/**
 * pix-status.js — Cloudflare Pages Function
 *
 * Endpoint: GET /api/pix-status?transactionId=xxx
 *           POST /api/pix-status  { transactionId: "xxx" }
 *
 * Responde com status: PENDING, PAID, CANCELLED
 *
 * API BlackCat: GET /sales/{transactionId}/status com header X-API-Key
 */

const API_URL = "https://api.blackcatoficial.com/api";

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

async function handleRequest(context) {
  const { env, request } = context;

  const apiKey = env.BLACKCAT_API_KEY;
  if (!apiKey) return jsonResponse(503, { error: "Gateway de pagamento não configurado." });

  let input = {};
  const url = new URL(request.url);

  if (request.method === "POST") {
    try {
      input = await request.json();
    } catch {
      return jsonResponse(400, { error: "Payload inválido." });
    }
  }

  const transactionId = String(
    url.searchParams.get("transactionId") || input.transactionId || input.id || ""
  ).trim();

  if (!transactionId || !/^[A-Za-z0-9_\-]{1,120}$/.test(transactionId)) {
    return jsonResponse(400, { error: "ID de transação inválido." });
  }

  try {
    const res = await fetch(
      `${API_URL}/sales/${encodeURIComponent(transactionId)}/status`,
      { headers: { "x-api-key": apiKey } }
    );

    const result = await res.json().catch(() => ({}));

    if (!res.ok || !result.success) {
      return jsonResponse(502, { error: result.message || "Não foi possível consultar o pagamento." });
    }

    const rawStatus = String(result.data?.status || "PENDING").toUpperCase();
    const status = rawStatus === "CONFIRMED" ? "PAID"
      : rawStatus === "REFUNDED" ? "CANCELLED"
        : rawStatus;

    return jsonResponse(200, {
      status,
      transactionId: result.data?.transactionId || transactionId,
      paidAt: result.data?.paidAt || null,
    });

  } catch {
    return jsonResponse(502, { error: "Falha ao consultar o pagamento." });
  }
}

export const onRequestGet = handleRequest;
export const onRequestPost = handleRequest;
