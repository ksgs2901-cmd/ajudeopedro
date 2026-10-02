/**
 * pix-status.js — Netlify Function
 *
 * Recebe transactionId por query string (GET) ou id no body (POST).
 * Responde com status Blackcat em maiúsculas: PENDING, PAID, CANCELLED.
 *
 * API BlackCat: GET /sales/{transactionId}/status com header X-API-Key
 * Status BlackCat: PENDING → "pendente", PAID → "pago", CANCELLED → "cancelado"
 */

const API_URL = "https://api.blackcatoficial.com/api";

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-headers": "content-type" }, body: "" };
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return json(405, { error: "Método não permitido." });

  const apiKey = process.env.BLACKCAT_API_KEY;
  if (!apiKey) return json(503, { error: "Gateway de pagamento não configurado." });

  let input = {};
  if (event.httpMethod === "POST") {
    try { input = JSON.parse(event.body || "{}"); }
    catch { return json(400, { error: "Payload inválido." }); }
  }

  const transactionId = String(
    event.queryStringParameters?.transactionId || input.transactionId || input.id || ""
  ).trim();
  if (!transactionId || !/^[A-Za-z0-9_\-]{1,120}$/.test(transactionId)) {
    return json(400, { error: "ID de transação inválido." });
  }

  try {
    const res = await fetch(
      `${API_URL}/sales/${encodeURIComponent(transactionId)}/status`,
      { headers: { "x-api-key": apiKey } }
    );

    const result = await res.json().catch(() => ({}));

    if (!res.ok || !result.success) {
      return json(502, { error: result.message || "Não foi possível consultar o pagamento." });
    }

    const rawStatus = String(result.data?.status || "PENDING").toUpperCase();
    const status = rawStatus === "CONFIRMED" ? "PAID"
      : rawStatus === "REFUNDED" ? "CANCELLED"
        : rawStatus;

    return json(200, {
      status,
      transactionId: result.data?.transactionId || transactionId,
      paidAt: result.data?.paidAt || null,
    });

  } catch {
    return json(502, { error: "Falha ao consultar o pagamento." });
  }
};