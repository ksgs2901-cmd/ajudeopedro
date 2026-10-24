/**
 * pix-modal.js — Juntos Pela Vida / Ajude o Pedro
 *
 * Integração com a API BlackCat via Cloudflare Pages Functions:
 *   POST /api/create-pix  → { transactionId, qrCodeBase64, copyPaste, expiresAt }
 *   GET  /api/pix-status?transactionId=xxx → { status: "PENDING"|"PAID"|"CANCELLED" }
 *
 * Uso público: window.openPixModal(amountInCents)
 * Ex.: openPixModal(5000) → R$ 50,00
 */
(function () {
  "use strict";

  /* ── Injetar CSS ── */
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "/css/pix-modal.css";
  document.head.appendChild(stylesheet);

  /* ── Helpers ── */
  const formatBRL = (cents) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

  /* Gera QR Code como Data URL via API externa */
  async function generateQrImage(text, size) {
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = "anonymous";
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&margin=8`;
      });
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      return canvas.toDataURL("image/png");
    } catch { return ""; }
  }

  const isDataUri = (s) => /^data:image\//i.test(s);

  function currentUtm() {
    const q = new URLSearchParams(location.search);
    return Object.fromEntries(
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]
        .map((k) => [k, q.get(k) || ""])
    );
  }

  /* ── Estado global ── */
  let overlay    = null;
  let pollTimer  = null;
  let pollCount  = 0;
  const POLL_INTERVAL = 3000;
  const POLL_MAX      = 100;

  /* ── Fechar modal ── */
  function closeModal() {
    clearTimeout(pollTimer);
    overlay?.remove();
    overlay   = null;
    pollCount = 0;
  }

  const qs = (sel) => overlay?.querySelector(sel);

  /* ── Mostrar erro ── */
  function showError(message) {
    if (!overlay) return;
    const body = qs(".pix-body");
    body.innerHTML = `<p class="pix-error">${message}</p>
      <button type="button" class="pix-retry-btn">Tentar novamente</button>`;
    body.querySelector(".pix-retry-btn").addEventListener("click", () => {
      body.innerHTML = "";
      submitDonation(overlay._amount);
    });
  }

  /* ── Mostrar confirmação ── */
  function showConfirmed() {
    if (!overlay) return;
    qs(".pix-title").textContent = "✅ Pagamento Confirmado!";
    const body = qs(".pix-body");
    body.innerHTML = `
      <p class="pix-confirmed-text">Obrigado pela sua contribuição! 💚</p>
      <p class="pix-confirmed-sub">Sua doação ajuda o Pedro a continuar respirando.</p>`;

    /* Facebook Pixel */
    if (typeof window !== "undefined" && window.fbq) {
      const val = overlay._amount / 100;
      window.fbq("track", "Purchase", { value: val, currency: "BRL" });
    }
  }

  /* ── Mostrar link de checkout externo ── */
  function showCheckoutLink(url) {
    if (!overlay) return;
    qs(".pix-title").textContent = "📱 Pague pelo link";
    const body = qs(".pix-body");
    body.innerHTML = `
      <a href="${url}" target="_blank" rel="noopener" class="pix-checkout-link">Abrir página de pagamento</a>
      <p class="pix-instructions">Clique acima para abrir a página de pagamento segura.</p>`;
  }

  /* ── Mostrar QR Code + código PIX + botão copiar ── */
  async function showQr(qrCodeBase64, copyPaste) {
    if (!overlay) return;

    qs(".pix-title").textContent       = "📱 Aguardando Confirmação";
    qs(".pix-value-label").textContent = "Valor";

    const body = qs(".pix-body");
    let html = "";

    /* QR Code - determinar src da imagem */
    const pixCode = copyPaste || qrCodeBase64 || "";
    let qrSrc = "";

    if (qrCodeBase64 && isDataUri(qrCodeBase64)) {
      /* Já é uma imagem base64 */
      qrSrc = qrCodeBase64;
    } else if (pixCode) {
      /* É texto (BR Code) — gerar QR no navegador */
      qrSrc = await generateQrImage(pixCode, 560);
    }

    if (qrSrc) {
      html += `<div class="pix-qr-wrap"><div class="pix-qr-box">
        <img alt="QR Code PIX" width="200" height="200" src="${qrSrc}"/>
      </div></div>`;
    }

    /* Campo copia e cola */
    if (copyPaste) {
      html += `<input type="text" class="pix-code-field" readonly value="${copyPaste}" aria-label="Código PIX copia e cola"/>`;
      html += `<button type="button" class="pix-copy-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg> Copiar código Pix
      </button>`;
    }

    html += `<p class="pix-instructions">Abra o app do seu banco, escolha <strong>Pix</strong> e escaneie o QR Code acima ou cole o código.</p>`;

    body.innerHTML = html;

    /* Botão copiar */
    const copyBtn = body.querySelector(".pix-copy-btn");
    if (copyBtn && copyPaste) {
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(copyPaste);
          copyBtn.innerHTML = `✅ Copiado!`;
          setTimeout(() => {
            copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg> Copiar código Pix`;
          }, 2000);
        } catch {
          const field = body.querySelector(".pix-code-field");
          if (field) { field.select(); field.setSelectionRange(0, 99999); }
        }
      });
    }
  }

  /* ── Polling de status ── */
  function pollStatus(transactionId) {
    if (!overlay || ++pollCount > POLL_MAX) return;

    fetch(`/api/pix-status?transactionId=${encodeURIComponent(transactionId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!overlay) return;
        if (data.status === "PAID") {
          showConfirmed();
        } else if (data.status === "CANCELLED") {
          showError("O PIX expirou ou foi cancelado. Tente novamente.");
        } else {
          pollTimer = setTimeout(() => pollStatus(transactionId), POLL_INTERVAL);
        }
      })
      .catch(() => {
        if (overlay) pollTimer = setTimeout(() => pollStatus(transactionId), POLL_INTERVAL);
      });
  }

  /* ── Criar cobrança PIX via API ── */
  async function submitDonation(amount) {
    if (!overlay) return;

    const body = qs(".pix-body");

    /* Spinner */
    body.innerHTML = `
      <p class="pix-spinner-wrap" role="status" aria-label="Gerando seu Pix">
        <span class="pix-spinner"></span>
      </p>
      <p class="pix-wait-text">Só um instante, o QR Code aparece aqui em segundos.</p>`;

    try {
      const res = await fetch("/api/create-pix", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ amountCents: amount, ...currentUtm() }),
      });

      const data = await res.json();
      if (!overlay) return;

      if (!res.ok) {
        showError(data.error || data.message || "Não foi possível gerar o PIX. Tente novamente.");
        return;
      }

      if (data.checkoutUrl && data.transactionId) {
        showCheckoutLink(data.checkoutUrl);
        pollStatus(data.transactionId);
        return;
      }

      const { transactionId, qrCodeBase64, copyPaste } = data;

      if (!transactionId || (!qrCodeBase64 && !copyPaste)) {
        showError("Resposta incompleta da API. Tente novamente.");
        return;
      }

      showQr(qrCodeBase64, copyPaste);
      pollStatus(transactionId);

    } catch {
      if (overlay) showError("Falha de conexão. Verifique sua internet e tente novamente.");
    }
  }

  /* ── Criar e exibir o modal ── */
  function createModal(amount) {
    closeModal();

    overlay          = document.createElement("div");
    overlay.className = "pix-backdrop";
    overlay._amount  = amount;

    overlay.innerHTML = `
      <section class="pix-dialog" role="dialog" aria-modal="true" aria-labelledby="pix-modal-title">
        <button class="pix-close" type="button" aria-label="Fechar">&#x2715;</button>
        <div style="margin:0 auto 4px;text-align:center">
          <svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#24ca68" stroke-width="1.5" style="display:block;margin:0 auto"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
          <div style="font-family:Montserrat,sans-serif;font-weight:900;font-size:13px;color:#24ca68;letter-spacing:.03em;margin-top:4px">VAKINHA</div>
        </div>
        <h2 class="pix-title" id="pix-modal-title">Gerando seu Pix...</h2>
        <p class="pix-value-label">Valor da contribuição</p>
        <p class="pix-amount-display">${formatBRL(amount)}</p>
        <div class="pix-body"></div>
      </section>`;

    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
    overlay.querySelector(".pix-close").addEventListener("click", closeModal);
    const onKey = (e) => {
      if (e.key === "Escape") { closeModal(); document.removeEventListener("keydown", onKey); }
    };
    document.addEventListener("keydown", onKey);

    submitDonation(amount);
  }

  /* ── API pública ── */
  window.openPixModal = createModal;

  /* ── Bind botões de valor ── */
  function bindAmountButtons() {
    document.querySelectorAll(".gridWrap .opt, .vk-grid .opt").forEach((button) => {
      if (button.dataset.pixModalBound === "true") return;
      const match = button.textContent.match(/R\$\s*([\d.]+)/);
      const amount = match ? Number(match[1].replace(/\./g, "")) : NaN;
      if (!Number.isInteger(amount) || amount < 30 || amount > 1000) return;

      button.dataset.pixModalBound = "true";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        createModal(amount * 100);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindAmountButtons, { once: true });
  } else {
    bindAmountButtons();
  }

})();
