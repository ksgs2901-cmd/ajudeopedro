const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = "/css/pix-modal.css";
document.head.append(stylesheet);

const formatAmount = (cents) => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL", maximumFractionDigits: 0,
}).format(cents / 100);
const digits = (value) => value.replace(/\D/g, "");
let overlay;
let pollTimer;

function closeModal() {
  clearTimeout(pollTimer);
  overlay?.remove();
  overlay = null;
}

function setError(message) {
  const error = overlay.querySelector(".pix-error");
  error.textContent = message;
  error.hidden = false;
}

function currentUtm() {
  const query = new URLSearchParams(location.search);
  return Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]
    .map((key) => [key, query.get(key) || ""]));
}

function createModal(amount) {
  closeModal();
  overlay = document.createElement("div");
  overlay.className = "pix-backdrop";
  overlay.innerHTML = `
    <section class="pix-dialog" role="dialog" aria-modal="true" aria-labelledby="pix-title">
      <header class="pix-head"><div><h2 class="pix-title" id="pix-title">Sua contribuição para o Pedro</h2><p class="pix-subtitle">Preencha os dados para gerar seu Pix.</p></div>
        <button class="pix-close" type="button" aria-label="Fechar">&times;</button></header>
      <div class="pix-content"><div class="pix-amount"><span>Valor da contribuição</span><strong>${formatAmount(amount)}</strong></div>
        <form class="pix-form"><div class="pix-fields">
          <label class="pix-field">Nome completo<input name="name" autocomplete="name" minlength="3" maxlength="120" required></label>
          <label class="pix-field">E-mail<input name="email" type="email" autocomplete="email" maxlength="180" required></label>
          <label class="pix-field">Telefone com DDD<input name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="18" placeholder="(11) 99999-9999" required></label>
          <label class="pix-field">CPF<input name="document" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="000.000.000-00" required></label>
          <button class="pix-primary" type="submit">Gerar Pix</button>
        </div><p class="pix-privacy">Seus dados são enviados com segurança para processar a contribuição.</p><p class="pix-error" role="alert" hidden></p></form>
      </div>
    </section>`;
  document.body.append(overlay);
  overlay.querySelector(".pix-close").addEventListener("click", closeModal);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) closeModal(); });
  overlay.querySelector("form").addEventListener("submit", (event) => submitDonation(event, amount));
  overlay.querySelector('input[name="phone"]').addEventListener("input", (event) => {
    const value = digits(event.target.value).slice(0, 11);
    event.target.value = value.length > 6
      ? `(${value.slice(0, 2)}) ${value.slice(2, value.length === 11 ? 7 : 6)}-${value.slice(value.length === 11 ? 7 : 6)}`
      : value;
  });
  overlay.querySelector('input[name="document"]').addEventListener("input", (event) => {
    const value = digits(event.target.value).slice(0, 11);
    event.target.value = value.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  });
  overlay.querySelector('input[name="name"]').focus();
}

async function submitDonation(event, amount) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const error = form.querySelector(".pix-error");
  const values = new FormData(form);
  const customer = {
    name: String(values.get("name")).trim(),
    email: String(values.get("email")).trim(),
    phone: digits(String(values.get("phone"))),
    document: digits(String(values.get("document"))),
  };
  submit.disabled = true;
  submit.textContent = "Gerando Pix...";
  error.hidden = true;
  try {
    const response = await fetch("/api/create-pix", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount, customer, utm: currentUtm() }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "Não conseguimos gerar o Pix agora.");
    showPix(result, amount);
    if (result.transactionId) pollStatus(result.transactionId);
  } catch (err) {
    setError(err.message || "Falha ao gerar o Pix. Tente novamente.");
    submit.disabled = false;
    submit.textContent = "Tentar novamente";
  }
}

function showPix(payment, amount) {
  const content = overlay.querySelector(".pix-content");
  content.innerHTML = `<div class="pix-qr"><div class="pix-amount"><span>Valor da contribuição</span><strong class="pix-value"></strong></div>
    <img class="pix-image" alt="QR Code Pix para pagamento" hidden>
    <p class="pix-subtitle">Escaneie o QR Code no app do seu banco ou copie o código Pix.</p>
    <textarea class="pix-copycode" readonly aria-label="Código Pix copia e cola"></textarea>
    <button class="pix-copy" type="button">Copiar código Pix</button>
    <p class="pix-status" aria-live="polite">Aguardando confirmação do pagamento.</p>
    <p class="pix-status pix-expiry" hidden></p><a class="pix-invoice" target="_blank" rel="noopener" hidden>Ver pagamento</a></div>`;
  content.querySelector(".pix-value").textContent = formatAmount(amount);
  const image = content.querySelector(".pix-image");
  if (typeof payment.qrCodeBase64 === "string" && payment.qrCodeBase64.startsWith("data:image/")) {
    image.src = payment.qrCodeBase64;
    image.hidden = false;
  }
  const code = payment.copyPaste || "";
  content.querySelector(".pix-copycode").value = code;
  const expiry = content.querySelector(".pix-expiry");
  if (payment.expiresAt) {
    expiry.textContent = `Válido até ${new Date(payment.expiresAt).toLocaleString("pt-BR")}`;
    expiry.hidden = false;
  }
  const invoice = content.querySelector(".pix-invoice");
  if (typeof payment.invoiceUrl === "string" && payment.invoiceUrl.startsWith("https://")) {
    invoice.href = payment.invoiceUrl;
    invoice.hidden = false;
  }
  content.querySelector(".pix-copy").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try { await navigator.clipboard.writeText(code); }
    catch {
      content.querySelector(".pix-copycode").select();
      document.execCommand("copy");
    }
    button.textContent = "Código copiado";
  });
}

async function pollStatus(transactionId, attempt = 0) {
  if (attempt >= 120 || !overlay) return;
  try {
    const response = await fetch(`/api/pix-status?transactionId=${encodeURIComponent(transactionId)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    const status = overlay.querySelector('.pix-status[aria-live]');
    if (result.status === "PAID") { if (status) status.textContent = "Pix confirmado. Obrigado por ajudar o Pedro!"; return; }
    if (["CANCELLED", "REFUNDED"].includes(result.status)) { if (status) status.textContent = "Este Pix expirou ou foi cancelado. Gere outro para contribuir."; return; }
  } catch {
    // Keep the payment code visible if status polling is temporarily unavailable.
  }
  pollTimer = setTimeout(() => pollStatus(transactionId, attempt + 1), 5000);
}

document.addEventListener("keydown", (event) => { if (event.key === "Escape" && overlay) closeModal(); });
document.querySelectorAll(".gridWrap .opt").forEach((button) => {
  const value = Number(button.innerText.replace(/\s+/g, " ").match(/[\d.]+/)?.[0]?.replace(/\./g, ""));
  if (Number.isFinite(value) && value >= 30 && value <= 1000) {
    button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); createModal(value * 100); });
  }
});