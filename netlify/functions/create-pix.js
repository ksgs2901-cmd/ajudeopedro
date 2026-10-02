/**
 * create-pix.js — Netlify Function
 *
 * Recebe do React: { amountCents, utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer, host, path, fbp, fbc, visitorId }
 * Responde para o React: { kind: "pix", payload, donationId } ou { kind: "pix", checkoutUrl, donationId }
 *
 * API BlackCat: POST /sales/create-sale com header X-API-Key
 */

const API_URL = "https://api.blackcatoficial.com/api";
const QRCode = require("qrcode");

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  },
  body: JSON.stringify(body),
});

const digits = (v) => String(v || "").replace(/\D/g, "");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-headers": "content-type" }, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Método não permitido." });

  const apiKey = process.env.BLACKCAT_API_KEY;
  if (!apiKey) return json(503, { error: "Gateway de pagamento não configurado." });

  let input;
  try { input = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Payload inválido." }); }

  /* O React envia amountCents (ex: 10000 = R$100) */
  const amountCents = Math.round(Number(input.amountCents || input.amount || 0));
  if (!Number.isInteger(amountCents) || amountCents < 3000 || amountCents > 100000) {
    return json(400, { error: "Valor inválido. Escolha entre R$ 30 e R$ 1.000." });
  }

  /* Dados do doador vindos das env vars (anonimato) */
  const name  = String(process.env.BLACKCAT_CUSTOMER_NAME  || "Contribuição Anônima").trim();
  const email = String(process.env.BLACKCAT_CUSTOMER_EMAIL || "").trim();
  const phone = digits(process.env.BLACKCAT_CUSTOMER_PHONE);
  const cpf   = digits(process.env.BLACKCAT_CUSTOMER_DOCUMENT);

  const missing = [
    !email && "BLACKCAT_CUSTOMER_EMAIL",
    !phone && "BLACKCAT_CUSTOMER_PHONE",
    !cpf   && "BLACKCAT_CUSTOMER_DOCUMENT",
  ].filter(Boolean);
  if (missing.length) return json(503, { error: `Variáveis de ambiente ausentes: ${missing.join(", ")}` });

  /* Montar UTMs */
  const utmFields = {};
  for (const k of ["utm_source","utm_medium","utm_campaign","utm_content","utm_term"]) {
    if (typeof input[k] === "string" && input[k]) utmFields[k] = input[k].slice(0, 200);
  }

  const externalRef = `pedro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const payload = {
    amount: amountCents,
    currency: "BRL",
    paymentMethod: "pix",
    items: [{
      title: "Contribuição para o tratamento do Pedro",
      unitPrice: amountCents,
      quantity: 1,
      tangible: false,
    }],
    customer: {
      name,
      email,
      phone,
      document: { number: cpf, type: "cpf" },
    },
    pix: { expiresInDays: 1 },
    externalRef,
    metadata: "Doação Juntos Pela Vida — Pedro",
    ...utmFields,
  };

  try {
    const res = await fetch(`${API_URL}/sales/create-sale`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    const result = await res.json().catch(() => ({}));

    if (!res.ok || !result.success || !result.data?.transactionId) {
      return json(502, { error: result.message || "Não conseguimos gerar o Pix agora. Tente novamente." });
    }

    const { transactionId } = result.data;
    const paymentSources = [result.data.paymentData, result.data.pix, result.data]
      .filter((value) => value && typeof value === "object");
    const getPaymentText = (keys) => {
      for (const source of paymentSources) {
        for (const key of keys) {
          if (typeof source[key] === "string" && source[key].trim()) return source[key].trim();
        }
      }
      return "";
    };
    const qrImagePattern = /^data:image\/(?:png|jpeg|webp);base64,/i;
    const imageData = getPaymentText([
      "qrCodeBase64", "qrCodeImage", "qrImage", "qr_code_base64", "qr_code_image",
    ]);
    const rawQr = getPaymentText(["qrCode", "qr_code", "brCode", "pixCode", "payload"]);
    const copyPaste = getPaymentText([
      "copyPaste", "pixCopyPaste", "qrCodeText", "qr_code_text", "pix_copy_paste",
    ]) || (rawQr && !qrImagePattern.test(rawQr) ? rawQr : "");
    const qrCodeBase64 = imageData || (qrImagePattern.test(rawQr) ? rawQr : "");
    const invoiceUrl = getPaymentText(["invoiceUrl", "checkoutUrl", "paymentUrl"]);

    let generatedQr = qrCodeBase64;
    if (!generatedQr && copyPaste) {
      generatedQr = await QRCode.toDataURL(copyPaste, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 320,
      });
    }

    if (!generatedQr && !copyPaste && invoiceUrl) {
      return json(200, {
        transactionId,
        checkoutUrl: invoiceUrl,
        expiresAt: getPaymentText(["expiresAt"]),
      });
    }

    if (!generatedQr && !copyPaste) {
      const fields = paymentSources.flatMap((source) => Object.keys(source)).filter((key, index, all) => all.indexOf(key) === index);
      return json(502, {
        error: `A Blackcat criou a cobrança, mas não retornou QR, código Pix ou link. Campos: ${fields.slice(0, 20).join(", ") || "nenhum"}.`,
        transactionId,
      });
    }

    return json(200, {
      transactionId,
      qrCodeBase64: generatedQr,
      copyPaste,
      expiresAt: getPaymentText(["expiresAt"]),
      invoiceUrl,
    });

  } catch (err) {
    return json(502, { error: "Falha de conexão ao gerar o Pix. Tente novamente." });
  }
};