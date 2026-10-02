/**
 * pix-modal.js — Juntos Pela Vida / Ajude o Pedro
 *
 * Integração com a API BlackCat via Netlify Functions:
 *   POST /.netlify/functions/create-pix  → { transactionId, qrCodeBase64, copyPaste, expiresAt }
 *   GET  /.netlify/functions/pix-status?transactionId=xxx → { status: "PENDING"|"PAID"|"CANCELLED" }
 *
 * Uso público: window.openPixModal(amountInCents)
 * Ex.: openPixModal(10000) → R$ 100,00
 */
(function () {
  "use strict";

  /* ── Injetar CSS ──────────────────────────────── */
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "/css/pix-modal.css";
  document.head.appendChild(stylesheet);

  /* ── Helpers ──────────────────────────────────── */
  const formatBRL = (cents) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

  function currentUtm() {
    const q = new URLSearchParams(location.search);
    return Object.fromEntries(
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]
        .map((k) => [k, q.get(k) || ""])
    );
  }

  /* ── Estado global ────────────────────────────── */
  let overlay    = null;
  let pollTimer  = null;
  let pollCount  = 0;
  const POLL_INTERVAL = 3000;  // ms entre cada consulta de status
  const POLL_MAX      = 100;   // ~5 min no total

  /* ── Fechar modal ─────────────────────────────── */
  function closeModal() {
    clearTimeout(pollTimer);
    overlay?.remove();
    overlay   = null;
    pollCount = 0;
  }

  /* ── Selector conveniente ─────────────────────── */
  const qs = (sel) => overlay?.querySelector(sel);

  /* ── Limpar conteúdo dinâmico do body ─────────── */
  function clearBody(...selectors) {
    selectors.forEach((s) => qs(s)?.remove());
  }

  /* ── Mostrar estado de erro ───────────────────── */
  function showError(message) {
    if (!overlay) return;
    clearBody(
      ".pix-spinner-wrap", ".pix-wait-text",
      ".pix-qr-wrap", ".pix-code-field",
      ".pix-copy-btn", ".pix-instructions",
      ".pix-confirmed-text", ".pix-confirmed-sub"
    );

    let errEl = qs(".pix-error");
    if (!errEl) {
      errEl = document.createElement("p");
      errEl.className = "pix-error";
      qs(".pix-body").appendChild(errEl);
    }
    errEl.textContent = message;

    if (!qs(".pix-retry-btn")) {
      const retryEl = document.createElement("button");
      retryEl.type      = "button";
      retryEl.className = "pix-retry-btn";
      retryEl.textContent = "Tentar novamente";
      qs(".pix-body").appendChild(retryEl);
      retryEl.addEventListener("click", () => {
        errEl.remove();
        retryEl.remove();
        submitDonation(overlay._amount);
      });
    }
  }

  /* ── Mostrar QR Code + código PIX + botão copiar ── */
  function showQr(qrCodeBase64, copyPaste) {
    if (!overlay) return;

    qs(".pix-title").textContent       = "⏳ Aguardando Confirmação";
    qs(".pix-value-label").textContent = "Valor";

    const body = qs(".pix-body");
    clearBody(
      ".pix-spinner-wrap", ".pix-wait-text",
      ".pix-error", ".pix-retry-btn"
    );

    /* QR Code — a API retorna base64 da imagem */
    if (!qs(".pix-qr-wrap")) {
      const imageData = String(qrCodeBase64 || "").trim();
      const dataUriPattern = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i;
      const base64Pattern = /^[a-z0-9+/=\s]+$/i;
      if (!dataUriPattern.test(imageData) && !base64Pattern.test(imageData)) {
        showError("A Blackcat retornou um QR Code inválido. Tente novamente.");
        return;
      }
      const qrWrap = document.createElement("div");
      qrWrap.className = "pix-qr-wrap";
      const qrBox = document.createElement("div");
      qrBox.className = "pix-qr-box";
      const image = document.createElement("img");
      image.alt = "QR Code PIX";
      image.width = 200;
      image.height = 200;
      image.src = dataUriPattern.test(imageData) ? imageData : `data:image/png;base64,${imageData}`;
      qrBox.appendChild(image);
      qrWrap.appendChild(qrBox);
      body.appendChild(qrWrap);
    }

    /* Campo copia e cola */
    if (!qs(".pix-code-field")) {
      const codeField = document.createElement("input");
      codeField.type      = "text";
      codeField.className = "pix-code-field";
      codeField.readOnly  = true;
      codeField.value     = copyPaste;
      codeField.setAttribute("aria-label", "Código PIX copia e cola");
      body.appendChild(codeField);
    }

    /* Botão copiar */
    if (!qs(".pix-copy-btn")) {
      const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      const copyBtn = document.createElement("button");
      copyBtn.type      = "button";
      copyBtn.className = "pix-copy-btn";
      copyBtn.innerHTML = `${ICON} Copiar código`;
      body.appendChild(copyBtn);

      copyBtn.addEventListener("click", () => {
        const doCopied = () => {
          copyBtn.classList.add("copied");
          copyBtn.textContent = "✓ Código copiado!";
          setTimeout(() => {
            copyBtn.classList.remove("copied");
            copyBtn.innerHTML = `${ICON} Copiar código`;
          }, 2500);
        };

        if (navigator.clipboard) {
          navigator.clipboard.writeText(copyPaste).then(doCopied).catch(() => {
            fallbackCopy(copyPaste);
            doCopied();
          });
        } else {
          fallbackCopy(copyPaste);
          doCopied();
        }
      });
    }

    /* Instruções finais */
    if (!qs(".pix-instructions")) {
      const inst = document.createElement("p");
      inst.className = "pix-instructions";
      inst.innerHTML  = `Abra seu banco &bull; Escolha PIX Copia e Cola &bull; Confirme<br><strong>A confirmação aparece aqui automaticamente<br>após o pagamento.</strong>`;
      body.appendChild(inst);
    }
  }

  /* Fallback para navigator.clipboard indisponível */
  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:-999px;left:-999px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }

  /* ── Mostrar pagamento confirmado ─────────────── */
  function showConfirmed() {
    if (!overlay) return;

    qs(".pix-title").textContent       = "✅ Pagamento confirmado!";
    qs(".pix-value-label").textContent = "";

    const body = qs(".pix-body");
    clearBody(
      ".pix-spinner-wrap", ".pix-wait-text", ".pix-qr-wrap",
      ".pix-code-field", ".pix-copy-btn", ".pix-instructions",
      ".pix-error", ".pix-retry-btn"
    );

    const conf = document.createElement("p");
    conf.className   = "pix-confirmed-text";
    conf.textContent = "Muito obrigado! 💚";
    body.appendChild(conf);

    const sub = document.createElement("p");
    sub.className   = "pix-confirmed-sub";
    sub.textContent = "Sua doação vai fazer a diferença na vida do Pedro.";
    body.appendChild(sub);

    setTimeout(closeModal, 5000);
  }

  /* ── Polling de status ────────────────────────── */
  function pollStatus(transactionId) {
    if (!overlay || pollCount++ > POLL_MAX) return;

    fetch(`/.netlify/functions/pix-status?transactionId=${encodeURIComponent(transactionId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!overlay) return;
        /* Status "PAID" = pago; "CANCELLED" = expirado/cancelado */
        if (data.status === "PAID") {
          showConfirmed();
        } else if (data.status === "CANCELLED") {
          showError("O PIX expirou ou foi cancelado. Tente novamente.");
        } else {
          /* PENDING — continua polling */
          pollTimer = setTimeout(() => pollStatus(transactionId), POLL_INTERVAL);
        }
      })
      .catch(() => {
        if (overlay) pollTimer = setTimeout(() => pollStatus(transactionId), POLL_INTERVAL);
      });
  }

  /* ── Criar cobrança PIX via Netlify Function ──── */
  async function submitDonation(amount) {
    if (!overlay) return;

    const body = qs(".pix-body");

    /* Spinner de loading */
    if (!qs(".pix-spinner-wrap")) {
      const sw = document.createElement("p");
      sw.className = "pix-spinner-wrap";
      sw.setAttribute("role", "status");
      sw.setAttribute("aria-label", "Gerando seu Pix");
      sw.innerHTML = `<span class="pix-spinner"></span>`;
      body.appendChild(sw);
    }
    if (!qs(".pix-wait-text")) {
      const wt = document.createElement("p");
      wt.className   = "pix-wait-text";
      wt.textContent = "Só um instante, o QR Code aparece aqui em segundos.";
      body.appendChild(wt);
    }

    try {
      const res = await fetch("/.netlify/functions/create-pix", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ amount, ...currentUtm() }),
      });

      const data = await res.json();
      if (!overlay) return;

      if (!res.ok) {
        showError(data.error || data.message || "Não foi possível gerar o PIX. Tente novamente.");
        return;
      }

      /* Campos retornados pela nossa Netlify Function (alinhados com doc BlackCat):
         - data.transactionId  → ID da transação
         - data.qrCodeBase64   → "data:image/png;base64,..." para o <img>
         - data.copyPaste      → string longa do PIX copia e cola
      */
      const { transactionId, qrCodeBase64, copyPaste } = data;

      if (!transactionId || !qrCodeBase64 || !copyPaste) {
        showError("Resposta incompleta da API. Tente novamente.");
        return;
      }

      showQr(qrCodeBase64, copyPaste);
      pollStatus(transactionId);

    } catch {
      if (overlay) showError("Falha de conexão. Verifique sua internet e tente novamente.");
    }
  }

  /* ── Criar e exibir o modal ───────────────────── */
  function createModal(amount) {
    closeModal();

    overlay          = document.createElement("div");
    overlay.className = "pix-backdrop";
    overlay._amount  = amount;

    overlay.innerHTML = `
      <section class="pix-dialog" role="dialog" aria-modal="true" aria-labelledby="pix-modal-title">
        <button class="pix-close" type="button" aria-label="Fechar">&#x2715;</button>

        <img
          class="pix-logo"
          src="/__l5e/assets-v1/62a9e234-bc8a-4819-a7a0-0ce611ae11d0/logo-juntos-pela-vida-pedro.png"
          alt="Juntos Pela Vida"
        />

        <h2 class="pix-title" id="pix-modal-title">Gerando seu Pix...</h2>
        <p class="pix-value-label">Valor da contribuição</p>
        <p class="pix-amount-display">${formatBRL(amount)}</p>

        <div class="pix-body"></div>
      </section>`;

    document.body.appendChild(overlay);

    /* Fechar ao clicar no backdrop */
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

    /* Fechar com botão X */
    overlay.querySelector(".pix-close").addEventListener("click", closeModal);

    /* Fechar com Escape */
    const onKey = (e) => {
      if (e.key === "Escape") { closeModal(); document.removeEventListener("keydown", onKey); }
    };
    document.addEventListener("keydown", onKey);

    /* Iniciar geração do PIX */
    submitDonation(amount);
  }

  /* ── API pública ──────────────────────────────── */
  window.openPixModal = createModal;

  function bindAmountButtons() {
    document.querySelectorAll(".gridWrap .opt").forEach((button) => {
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
