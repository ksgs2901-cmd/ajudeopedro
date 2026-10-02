const API_URL = "https://api.blackcatoficial.com/api";

exports.handler = async (event) => {
  const respond = (statusCode, body) => ({
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body),
  });
  if (event.httpMethod !== "GET") return respond(405, { message: "Método não permitido." });
  const apiKey = process.env.BLACKCAT_API_KEY;
  if (!apiKey) return respond(503, { message: "O pagamento ainda não foi configurado." });
  const transactionId = event.queryStringParameters?.transactionId || "";
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(transactionId)) return respond(400, { message: "Identificador inválido." });

  try {
    const response = await fetch(`${API_URL}/sales/${encodeURIComponent(transactionId)}/status`, {
      headers: { "x-api-key": apiKey },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) return respond(502, { message: result.message || "Não foi possível consultar o pagamento." });
    return respond(200, {
      transactionId: result.data.transactionId,
      status: result.data.status,
      paidAt: result.data.paidAt || "",
    });
  } catch {
    return respond(502, { message: "Falha ao consultar o pagamento." });
  }
};