const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = "/css/pix-modal.css";
document.head.append(stylesheet);

const formatAmount = (cents) => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL", maximumFractionDigits: 0,
}).format(cents / 100);
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
      <button class="pix-close" type="button" aria-label="Fechar">&times;</button>
      <header class="pix-head">
        <img class="pix-logo" src="/__l5e/assets-v1/62a9e234-bc8a-4819-a7a0-0ce611ae11d0/logo-juntos-pela-vida-pedro.png" alt="Juntos Pela Vida">
        <h2 class="pix-title" id="pix-title">Gerando seu Pix...</h2>
        <p class="pix-subtitle">Só um instante, o QR Code aparece aqui em segundos.</p>
      </header>
      <div class="pix-content"><div class="pix-amount"><span>Valor da contribuição</span><strong>${formatAmount(amount)}</strong></div>
        <p class="pix-loading" role="status" aria-label="Gerando seu Pix"><span class="pix-spinner"></span></p>
        <p class="pix-error" role="alert" hidden></p>
        <button class="pix-copy pix-retry" type="button" hidden>Tentar novamente</button>
      </div>
    </section>`;
  document.body.append(overlay);
  overlay.querySelector(".pix-close").addEventListener("click", closeModal);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) closeModal(); });
  overlay.querySelector(".pix-retry").addEventListener("click", () => submitDonation(amount));
  submitDonation(amount);
}

async function submitDonation(amount) {
  if (!overlay) return;
  const retry = overlay.querySelector(".pix-retry");
  const error = overlay.querySelector(".pix-error");
  const loading = overlay.querySelector(".pix-loading");
  retry.hidden = true;
  error.hidden = true;
  loading.hidden = false;
  loading.setAttribute("aria-label", "Gerando seu Pix...");
  try {
    const response = await fetch("/api/create-pix", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount, utm: currentUtm() }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "Não conseguimos gerar o Pix agora.");
    showPix(result, amount);
    if (result.transactionId) pollStatus(result.transactionId);
  } catch (err) {
    loading.hidden = true;
    setError(err.message || "Falha ao gerar o Pix. Tente novamente.");
    retry.hidden = false;
  }
}

function showPix(payment, amount) {
  const content = overlay.querySelector(".pix-content");
  overlay.querySelector(".pix-title").textContent = "Seu Pix está pronto";
  overlay.querySelector(".pix-subtitle").textContent = "Escaneie o QR Code ou copie o código para pagar.";
  content.innerHTML = `<div class="pix-qr"><div class="pix-amount"><span>Valor da contribuição</span><strong class="pix-value"></strong></div>
    <img class="pix-image" alt="QR Code Pix para pagamento" hidden>
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