const API_URL = "https://api.blackcatoficial.com/api";
const json = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  body: JSON.stringify(body),
});
const digits = (value) => String(value || "").replace(/\D/g, "");

function validCpf(value) {
  const cpf = digits(value);
  if (cpf.length !== 11 || /^([0-9])\1{10}$/.test(cpf)) return false;
  const check = (length) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return check(9) === Number(cpf[9]) && check(10) === Number(cpf[10]);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { message: "Método não permitido." });
  const apiKey = process.env.BLACKCAT_API_KEY;
  if (!apiKey) return json(503, { message: "O pagamento ainda não foi configurado." });

  let input;
  try { input = JSON.parse(event.body || "{}"); }
  catch { return json(400, { message: "Não foi possível ler os dados do pagamento." }); }

  const amount = Number(input.amount);
  const customer = input.customer || {};
  const name = String(customer.name || "").trim();
  const email = String(customer.email || "").trim();
  const phone = digits(customer.phone);
  const cpf = digits(customer.document);
  if (!Number.isInteger(amount) || amount < 3000 || amount > 100000) return json(400, { message: "Escolha um valor entre R$ 30 e R$ 1.000." });
  if (name.length < 3 || name.length > 120) return json(400, { message: "Informe seu nome completo." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 180) return json(400, { message: "Confira seu e-mail." });
  if (phone.length < 10 || phone.length > 13) return json(400, { message: "Confira seu telefone com DDD." });
  if (!validCpf(cpf)) return json(400, { message: "Confira o CPF informado." });

  const payload = {
    amount,
    currency: "BRL",
    paymentMethod: "pix",
    items: [{ title: "Contribuição para o tratamento do Pedro", unitPrice: amount, quantity: 1, tangible: false }],
    customer: { name, email, phone, document: { number: cpf, type: "cpf" } },
    pix: { expiresInDays: 1 },
    externalRef: `pedro-${require("node:crypto").randomUUID()}`,
    metadata: "Doação para o tratamento do Pedro",
  };
  const utm = input.utm || {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    if (typeof utm[key] === "string" && utm[key].length <= 180) payload[key] = utm[key];
  }

  try {
    const response = await fetch(`${API_URL}/sales/create-sale`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success || !result.data?.transactionId) {
      return json(502, { message: result.message || "Não conseguimos gerar o Pix agora." });
    }
    const payment = result.data.paymentData || {};
    return json(200, {
      transactionId: result.data.transactionId,
      status: result.data.status,
      qrCodeBase64: payment.qrCodeBase64 || "",
      copyPaste: payment.copyPaste || payment.qrCode || "",
      expiresAt: payment.expiresAt || "",
      invoiceUrl: result.data.invoiceUrl || "",
    });
  } catch {
    return json(502, { message: "Falha de conexão ao gerar o Pix. Tente novamente." });
  }
};