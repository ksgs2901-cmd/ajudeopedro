/**
 * pix-modal.js — Juntos Pela Vida / Ajude o Pedro
 *
 * Injeta o CSS, gera o modal PIX e consulta o status
 * usando as Netlify Functions /.netlify/functions/create-pix
 * e /.netlify/functions/pix-status.
 *
 * Uso: chame window.openPixModal(amountInCents) em qualquer botão.
 * Ex.: openPixModal(10000) → R$ 100,00
 */

(function () {
  "use strict";

  /* ── Injetar CSS ─────────────────────────────────────────── */
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "/css/pix-modal.css";
  document.head.appendChild(stylesheet);

  /* ── Helpers ─────────────────────────────────────────────── */
  const formatBRL = (cents) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(cents / 100);

  function currentUtm() {
    const q = new URLSearchParams(location.search);
    return Object.fromEntries(
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].map(
        (k) => [k, q.get(k) || ""]
      )
    );
  }

  /* ── Estado global ───────────────────────────────────────── */
  let overlay = null;
  let pollTimer = null;
  let pollCount = 0;
  const POLL_INTERVAL = 3000; // ms
  const POLL_MAX = 100;       // ~5 min

  /* ── Fechar modal ────────────────────────────────────────── */
  function closeModal() {
    clearTimeout(pollTimer);
    overlay?.remove();
    overlay = null;
    pollCount = 0;
  }

  /* ── Selectors convenientes ──────────────────────────────── */
  const qs = (sel) => overlay?.querySelector(sel);

  /* ── Mostrar estado de erro ──────────────────────────────── */
  function showError(message) {
    if (!overlay) return;
    qs(".pix-spinner-wrap")?.remove();
    qs(".pix-wait-text")?.remove();
    qs(".pix-qr-wrap")?.remove();
    qs(".pix-code-field")?.remove();
    qs(".pix-copy-btn")?.remove();
    qs(".pix-instructions")?.remove();
    qs(".pix-confirmed-text")?.remove();
    qs(".pix-confirmed-sub")?.remove();

    let errEl = qs(".pix-error");
    if (!errEl) {
      errEl = document.createElement("p");
      errEl.className = "pix-error";
      qs(".pix-body").appendChild(errEl);
    }
    errEl.textContent = message;
    errEl.hidden = false;

    let retryEl = qs(".pix-retry-btn");
    if (!retryEl) {
      retryEl = document.createElement("button");
      retryEl.type = "button";
      retryEl.className = "pix-retry-btn";
      retryEl.textContent = "Tentar novamente";
      qs(".pix-body").appendChild(retryEl);
      retryEl.addEventListener("click", () => {
        errEl.hidden = true;
        retryEl.remove();
        submitDonation(overlay._amount);
      });
    }
  }

  /* ── Renderizar QR Code + código + botão copiar ──────────── */
  function showQr(qrUrl, pixCode, amount) {
    if (!overlay) return;

    /* título */
    qs(".pix-title").innerHTML = "⏳ Aguardando Confirmação";
    qs(".pix-value-label").textContent = "Valor";

    const body = qs(".pix-body");

    /* remover spinner e wait-text */
    qs(".pix-spinner-wrap")?.remove();
    qs(".pix-wait-text")?.remove();
    qs(".pix-error")?.remove();
    qs(".pix-retry-btn")?.remove();

    /* QR Code */
    if (!qs(".pix-qr-wrap")) {
      const qrWrap = document.createElement("div");
      qrWrap.className = "pix-qr-wrap";
      qrWrap.innerHTML = `
        <div class="pix-qr-box">
          <img src="${qrUrl}" alt="QR Code PIX" width="200" height="200" />
        </div>`;
      body.appendChild(qrWrap);
    }

    /* Campo código */
    if (!qs(".pix-code-field")) {
      const codeField = document.createElement("input");
      codeField.type = "text";
      codeField.className = "pix-code-field";
      codeField.readOnly = true;
      codeField.value = pixCode;
      codeField.setAttribute("aria-label", "Código PIX copia e cola");
      body.appendChild(codeField);
    }

    /* Botão copiar */
    if (!qs(".pix-copy-btn")) {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "pix-copy-btn";
      copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar código`;
      body.appendChild(copyBtn);

      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(pixCode).then(() => {
          copyBtn.classList.add("copied");
          copyBtn.innerHTML = `✓ Código copiado!`;
          setTimeout(() => {
            copyBtn.classList.remove("copied");
            copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar código`;
          }, 2500);
        }).catch(() => {
          /* Fallback para navegadores sem clipboard API */
          const ta = document.createElement("textarea");
          ta.value = pixCode;
          ta.style.cssText = "position:fixed;top:-999px;left:-999px;opacity:0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
          copyBtn.classList.add("copied");
          copyBtn.innerHTML = `✓ Código copiado!`;
          setTimeout(() => {
            copyBtn.classList.remove("copied");
            copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar código`;
          }, 2500);
        });
      });
    }

    /* Instruções */
    if (!qs(".pix-instructions")) {
      const inst = document.createElement("p");
      inst.className = "pix-instructions";
      inst.innerHTML = `Abra seu banco &bull; Escolha PIX Copia e Cola &bull; Confirme<br><span style="color:#321e13;font-weight:600">A confirmação aparece aqui automaticamente<br>após o pagamento.</span>`;
      body.appendChild(inst);
    }
  }

  /* ── Mostrar confirmação de pagamento ────────────────────── */
  function showConfirmed() {
    if (!overlay) return;
    qs(".pix-title").textContent = "✅ Pagamento confirmado!";
    qs(".pix-value-label").textContent = "";

    const body = qs(".pix-body");
    qs(".pix-spinner-wrap")?.remove();
    qs(".pix-wait-text")?.remove();
    qs(".pix-qr-wrap")?.remove();
    qs(".pix-code-field")?.remove();
    qs(".pix-copy-btn")?.remove();
    qs(".pix-instructions")?.remove();
    qs(".pix-error")?.remove();
    qs(".pix-retry-btn")?.remove();

    const conf = document.createElement("p");
    conf.className = "pix-confirmed-text";
    conf.textContent = "Muito obrigado! 💚";
    body.appendChild(conf);

    const sub = document.createElement("p");
    sub.className = "pix-confirmed-sub";
    sub.textContent = "Sua doação vai fazer a diferença na vida do Pedro.";
    body.appendChild(sub);

    /* fechar automaticamente após 5 s */
    setTimeout(closeModal, 5000);
  }

  /* ── Polling de status ───────────────────────────────────── */
  function pollStatus(transactionId) {
    if (!overlay) return;
    pollCount++;
    if (pollCount > POLL_MAX) return; /* parar após ~5 min */

    fetch(`/.netlify/functions/pix-status?transactionId=${encodeURIComponent(transactionId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!overlay) return;
        if (data.status === "CONFIRMED" || data.status === "PAID" || data.status === "approved") {
          showConfirmed();
        } else {
          pollTimer = setTimeout(() => pollStatus(transactionId), POLL_INTERVAL);
        }
      })
      .catch(() => {
        if (!overlay) return;
        pollTimer = setTimeout(() => pollStatus(transactionId), POLL_INTERVAL);
      });
  }

  /* ── Enviar doação à API ─────────────────────────────────── */
  async function submitDonation(amount) {
    if (!overlay) return;

    /* Garantir estado de loading */
    const body = qs(".pix-body");
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
      wt.className = "pix-wait-text";
      wt.textContent = "Só um instante, o QR Code aparece aqui em segundos.";
      body.appendChild(wt);
    }

    try {
      const res = await fetch("/.netlify/functions/create-pix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount, ...currentUtm() }),
      });

      const data = await res.json();

      if (!overlay) return;

      if (!res.ok) {
        showError(data.message || "Não foi possível gerar o PIX. Tente novamente.");
        return;
      }

      /* A BlackCat API retorna: transactionId, qrCodeUrl (imagem), pixCode (copia e cola) */
      const transactionId = data.transactionId || data.id || data.transaction_id;
      const qrUrl = data.qrCodeUrl || data.qr_code_url || data.qrCode || data.qr_code;
      const pixCode = data.pixCode || data.pix_code || data.copiaecola || data.copia_e_cola || data.emv;

      if (!qrUrl || !pixCode || !transactionId) {
        showError("Resposta da API inválida. Tente novamente.");
        return;
      }

      showQr(qrUrl, pixCode, amount);
      pollStatus(transactionId);
    } catch (err) {
      if (!overlay) return;
      showError("Falha de conexão. Verifique sua internet e tente novamente.");
    }
  }

  /* ── Criar modal do zero ─────────────────────────────────── */
  function createModal(amount) {
    closeModal(); /* fechar qualquer modal aberto */

    overlay = document.createElement("div");
    overlay.className = "pix-backdrop";
    overlay._amount = amount;

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
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });

    /* Fechar ao clicar no X */
    overlay.querySelector(".pix-close").addEventListener("click", closeModal);

    /* Fechar com Escape */
    const onKeyDown = (e) => {
      if (e.key === "Escape") { closeModal(); document.removeEventListener("keydown", onKeyDown); }
    };
    document.addEventListener("keydown", onKeyDown);

    /* Iniciar geração do PIX */
    submitDonation(amount);
  }

  /* ── API pública ─────────────────────────────────────────── */
  window.openPixModal = createModal;

})();
