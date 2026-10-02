/**
 * server.js — Netlify Function
 *
 * Intercepta chamadas do TanStack Server Functions:
 *   POST /_serverFn/{fnHash}
 *
 * O TanStack envia: { data: { amountCents } } ou { data: { id } }
 * O TanStack lê:   JSON com header "x-tss-serialized: 1"
 *
 * Hash dos server functions (do bundle routes-BJthbIvo.js):
 *   85a7da13... → createPix  (input: { amountCents })
 *   3b1a0052... → pixStatus  (input: { id: donationId })
 */

const API_URL = "https://api.blackcatoficial.com/api";

const FN_CREATE_PIX = "85a7da13ce7fdaba6b1e1edac497a7cc5455cf15bdf57dbd1be6c4e29433c09d";
const FN_PIX_STATUS = "3b1a0052fd354b5b4496c6da9443af5ea22064f1c9124c326789d1436d1dbb1b";

const digits = (v) => String(v || "").replace(/\D/g, "");

/* Retorna no formato que o TanStack/Seroval espera para objetos simples (JSON puro) */
const tssRespond = (statusCode, data) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "x-tss-serialized": "1",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  },
  body: JSON.stringify(data),
});

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST,OPTIONS",
        "access-control-allow-headers": "content-type,x-tss-serialized",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return tssRespond(405, { error: "Método não permitido." });
  }

  /* Extrair o hash do path: /_serverFn/{hash} */
  const pathParts = (event.path || event.rawUrl || "").split("/");
  const fnHash = pathParts[pathParts.length - 1] || "";

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return tssRespond(400, { error: "Payload inválido." });
  }

  /* TanStack encapsula em { data: ... } */
  const input = body.data || body;

  if (fnHash === FN_CREATE_PIX || fnHash.startsWith("85a7da13")) {
    return handleCreatePix(input);
  }

  if (fnHash === FN_PIX_STATUS || fnHash.startsWith("3b1a0052")) {
    return handlePixStatus(input);
  }

  return tssRespond(404, { error: `Server function desconhecida: ${fnHash}` });
};

/* ── Criar cobrança PIX ─────────────────────────────────────── */
async function handleCreatePix(input) {
  const apiKey = process.env.BLACKCAT_API_KEY;
  if (!apiKey) return tssRespond(503, { error: "Gateway de pagamento não configurado." });

  const amountCents = Math.round(Number(input.amountCents || 0));
  if (!Number.isInteger(amountCents) || amountCents < 3000 || amountCents > 100000) {
    return tssRespond(400, { error: "Valor inválido. Escolha entre R$ 30 e R$ 1.000." });
  }

  const name  = String(process.env.BLACKCAT_CUSTOMER_NAME  || "Contribuição Anônima").trim();
  const email = String(process.env.BLACKCAT_CUSTOMER_EMAIL || "").trim();
  const phone = digits(process.env.BLACKCAT_CUSTOMER_PHONE);
  const cpf   = digits(process.env.BLACKCAT_CUSTOMER_DOCUMENT);

  const missing = [
    !email && "BLACKCAT_CUSTOMER_EMAIL",
    !phone && "BLACKCAT_CUSTOMER_PHONE",
    !cpf   && "BLACKCAT_CUSTOMER_DOCUMENT",
  ].filter(Boolean);
  if (missing.length) return tssRespond(503, { error: `Variáveis ausentes: ${missing.join(", ")}` });

  const utmFields = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    if (typeof input[k] === "string" && input[k]) utmFields[k] = input[k].slice(0, 200);
  }

  const pixPayload = {
    amount: amountCents,
    currency: "BRL",
    paymentMethod: "pix",
    items: [{ title: "Contribuição para o tratamento do Pedro", unitPrice: amountCents, quantity: 1, tangible: false }],
    customer: { name, email, phone, document: { number: cpf, type: "cpf" } },
    pix: { expiresInDays: 1 },
    externalRef: `pedro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    metadata: "Doação Juntos Pela Vida — Pedro",
    ...utmFields,
  };

  try {
    const res = await fetch(`${API_URL}/sales/create-sale`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(pixPayload),
    });
    const result = await res.json().catch(() => ({}));

    if (!res.ok || !result.success || !result.data?.transactionId) {
      return tssRespond(502, { error: result.message || "Não conseguimos gerar o Pix. Tente novamente." });
    }

    const { transactionId } = result.data;
    const payment = result.data.paymentData || {};

    if (result.data.invoiceUrl && !payment.copyPaste) {
      return tssRespond(200, { kind: "pix", checkoutUrl: result.data.invoiceUrl, donationId: transactionId });
    }

    return tssRespond(200, {
      kind: "pix",
      payload: payment.copyPaste || payment.qrCode || "",
      donationId: transactionId,
    });

  } catch {
    return tssRespond(502, { error: "Falha de conexão ao gerar o Pix. Tente novamente." });
  }
}

/* ── Consultar status PIX ────────────────────────────────────── */
async function handlePixStatus(input) {
  const apiKey = process.env.BLACKCAT_API_KEY;
  if (!apiKey) return tssRespond(503, { error: "Gateway não configurado." });

  const transactionId = String(input.id || "").trim();
  if (!transactionId) return tssRespond(400, { error: "ID inválido." });

  try {
    const res = await fetch(
      `${API_URL}/sales/${encodeURIComponent(transactionId)}/status`,
      { headers: { "x-api-key": apiKey } }
    );
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.success) return tssRespond(502, { error: "Erro ao consultar." });

    const map = { PAID: "pago", CONFIRMED: "pago", PENDING: "pendente", CANCELLED: "cancelado", REFUNDED: "cancelado" };
    const status = map[String(result.data?.status || "PENDING").toUpperCase()] || "pendente";

    return tssRespond(200, { status, transactionId });
  } catch {
    return tssRespond(502, { error: "Falha ao consultar o pagamento." });
  }
}
