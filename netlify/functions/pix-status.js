/**
 * pix-status.js — Netlify Function
 *
 * Recebe do React: { id: donationId }  (via POST body)
 * Responde para o React: { status: "pago" | "pendente" | "cancelado" }
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
  if (event.httpMethod !== "POST") return json(405, { error: "Método não permitido." });

  const apiKey = process.env.BLACKCAT_API_KEY;
  if (!apiKey) return json(503, { error: "Gateway de pagamento não configurado." });

  let input;
  try { input = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Payload inválido." }); }

  /* O React envia { id: donationId } */
  const transactionId = String(input.id || "").trim();
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

    /* Mapear status BlackCat → formato que o React entende */
    const statusMap = {
      PAID:      "pago",
      CONFIRMED: "pago",       /* alias por segurança */
      PENDING:   "pendente",
      CANCELLED: "cancelado",
      REFUNDED:  "cancelado",
    };

    const rawStatus = String(result.data?.status || "PENDING").toUpperCase();
    const status    = statusMap[rawStatus] || "pendente";

    return json(200, {
      status,
      transactionId: result.data?.transactionId || transactionId,
      paidAt: result.data?.paidAt || null,
    });

  } catch {
    return json(502, { error: "Falha ao consultar o pagamento." });
  }
};