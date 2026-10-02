/**
 * server.js — Netlify Function
 *
 * Intercepta as chamadas do TanStack Server Functions (/_server?_serverFnId=...)
 * e roteia para a lógica correta baseada no serverFnId:
 *
 *   85a7da13... → create-pix  (recebe { amountCents })
 *   3b1a0052... → pix-status  (recebe { id: donationId })
 */

const API_URL = "https://api.blackcatoficial.com/api";

const respond = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  },
  body: JSON.stringify(body),
});

const digits = (v) => String(v || "").replace(/\D/g, "");

/* ── IDs dos Server Functions do TanStack (hash do bundle) ── */
const FN_CREATE_PIX  = "85a7da13ce7fdaba6b1e1edac497a7cc5455cf15bdf57dbd1be6c4e29433c09d";
const FN_PIX_STATUS  = "3b1a0052fd354b5b4496c6da9443af5ea22064f1c9124c326789d1436d1dbb1b";

/* ── Handler principal ─────────────────────────────────────── */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-headers": "content-type" }, body: "" };
  }
  if (event.httpMethod !== "POST") return respond(405, { error: "Método não permitido." });

  /* TanStack envia o fnId como query param */
  const fnId = event.queryStringParameters?._serverFnId || "";

  let input;
  try {
    const parsed = JSON.parse(event.body || "{}");
    /* TanStack encapsula os dados em { data: {...} } */
    input = parsed.data || parsed;
  } catch {
    return respond(400, { error: "Payload inválido." });
  }

  if (fnId === FN_CREATE_PIX) {
    return handleCreatePix(input);
  }
  if (fnId === FN_PIX_STATUS) {
    return handlePixStatus(input);
  }

  return respond(404, { error: `Server function não encontrada: ${fnId}` });
};

/* ── Criar cobrança PIX ─────────────────────────────────────── */
async function handleCreatePix(input) {
  const apiKey = process.env.BLACKCAT_API_KEY;
  if (!apiKey) return respond(503, { error: "Gateway de pagamento não configurado." });

  const amountCents = Math.round(Number(input.amountCents || 0));
  if (!Number.isInteger(amountCents) || amountCents < 3000 || amountCents > 100000) {
    return respond(400, { error: "Valor inválido. Escolha entre R$ 30 e R$ 1.000." });
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
  if (missing.length) return respond(503, { error: `Variáveis ausentes: ${missing.join(", ")}` });

  /* UTMs */
  const utmFields = {};
  for (const k of ["utm_source","utm_medium","utm_campaign","utm_content","utm_term"]) {
    if (typeof input[k] === "string" && input[k]) utmFields[k] = input[k].slice(0, 200);
  }

  const payload = {
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
      body: JSON.stringify(payload),
    });
    const result = await res.json().catch(() => ({}));

    if (!res.ok || !result.success || !result.data?.transactionId) {
      return respond(502, { error: result.message || "Não conseguimos gerar o Pix. Tente novamente." });
    }

    const { transactionId } = result.data;
    const payment = result.data.paymentData || {};

    /* Se vier invoiceUrl (PagBank), usa checkoutUrl */
    if (result.data.invoiceUrl && !payment.copyPaste) {
      return respond(200, { kind: "pix", checkoutUrl: result.data.invoiceUrl, donationId: transactionId });
    }

    return respond(200, {
      kind: "pix",
      payload: payment.copyPaste || payment.qrCode || "",
      donationId: transactionId,
    });

  } catch {
    return respond(502, { error: "Falha de conexão ao gerar o Pix. Tente novamente." });
  }
}

/* ── Consultar status do PIX ────────────────────────────────── */
async function handlePixStatus(input) {
  const apiKey = process.env.BLACKCAT_API_KEY;
  if (!apiKey) return respond(503, { error: "Gateway não configurado." });

  const transactionId = String(input.id || "").trim();
  if (!transactionId) return respond(400, { error: "ID de transação inválido." });

  try {
    const res = await fetch(
      `${API_URL}/sales/${encodeURIComponent(transactionId)}/status`,
      { headers: { "x-api-key": apiKey } }
    );
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.success) return respond(502, { error: "Erro ao consultar pagamento." });

    const statusMap = { PAID: "pago", CONFIRMED: "pago", PENDING: "pendente", CANCELLED: "cancelado", REFUNDED: "cancelado" };
    const status = statusMap[String(result.data?.status || "PENDING").toUpperCase()] || "pendente";

    return respond(200, { status, transactionId });
  } catch {
    return respond(502, { error: "Falha ao consultar o pagamento." });
  }
}
