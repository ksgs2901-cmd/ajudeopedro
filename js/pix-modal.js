/**
 * pix-modal.js — Juntos Pela Vida / Ajude o Pedro
 *
 * Gera PIX localmente no navegador (sem API externa).
 * Clicou no valor → abre modal com QR Code + código copia e cola.
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

  /* ── Configuração PIX ── */
  const PIX_KEY  = "805a6b5b-8348-4ea4-9be1-f26d470fdc4f";
  const PIX_NAME = "INSTITUTO ESPERANCA DO BEM LTDA";
  const PIX_CITY = "SAO PAULO";

  /* ── Helpers ── */
  const formatBRL = (cents) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

  /* Normaliza string: remove acentos, caracteres especiais, uppercase */
  function sanitize(str, maxLen) {
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9 .\-]/g, "")
      .trim()
      .toUpperCase()
      .slice(0, maxLen);
  }

  /* Monta campo EMV TLV: ID(2) + Length(2) + Value */
  function tlv(id, value) {
    return id + String(value.length).padStart(2, "0") + value;
  }

  /* CRC16-CCITT */
  function crc16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
        crc &= 0xFFFF;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  }

  /* Gera payload PIX EMV (BR Code) */
  function generatePixPayload(valueBRL) {
    const merchant = tlv("00", "BR.GOV.BCB.PIX") + tlv("01", PIX_KEY);
    const payload =
      tlv("00", "01") +
      tlv("01", "12") +
      tlv("26", merchant) +
      tlv("52", "0000") +
      tlv("53", "986") +
      tlv("54", valueBRL.toFixed(2)) +
      tlv("58", "BR") +
      tlv("59", sanitize(PIX_NAME, 25)) +
      tlv("60", sanitize(PIX_CITY, 15)) +
      tlv("62", tlv("05", "***")) +
      "6304";
    return payload + crc16(payload);
  }

  /* Gera QR Code como Data URL (canvas puro, sem dependência externa) */
  function generateQrCanvas(text, size) {
    return new Promise((resolve) => {
      /* Tenta usar a lib qrcode se disponível, senão usa API externa */
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => resolve("");
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&margin=8`;
    });
  }

  /* ── Estado global ── */
  let overlay = null;

  /* ── Fechar modal ── */
  function closeModal() {
    overlay?.remove();
    overlay = null;
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
      generateAndShow(overlay._amount);
    });
  }

  /* ── Gerar PIX e mostrar QR ── */
  async function generateAndShow(amountCents) {
    if (!overlay) return;
    const body = qs(".pix-body");

    /* Spinner */
    body.innerHTML = `
      <p class="pix-spinner-wrap" role="status" aria-label="Gerando seu Pix">
        <span class="pix-spinner"></span>
      </p>
      <p class="pix-wait-text">Só um instante, o QR Code aparece aqui em segundos.</p>`;

    try {
      const valueBRL = amountCents / 100;
      const pixCode = generatePixPayload(valueBRL);
      const qrImage = await generateQrCanvas(pixCode, 560);

      if (!overlay) return;

      qs(".pix-title").textContent = "📱 Escaneie o QR Code";
      qs(".pix-value-label").textContent = "Valor";

      let html = "";

      if (qrImage) {
        html += `<div class="pix-qr-wrap"><div class="pix-qr-box">
          <img alt="QR Code PIX" width="200" height="200" src="${qrImage}"/>
        </div></div>`;
      }

      html += `<input type="text" class="pix-code-field" readonly value="${pixCode}" aria-label="Código PIX copia e cola"/>`;
      html += `<button type="button" class="pix-copy-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg> Copiar código Pix
      </button>`;
      html += `<p class="pix-instructions">Abra o app do seu banco, escolha <strong>Pix</strong> e escaneie o QR Code acima ou cole o código.</p>`;

      body.innerHTML = html;

      /* Botão copiar */
      body.querySelector(".pix-copy-btn").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(pixCode);
          const btn = body.querySelector(".pix-copy-btn");
          btn.innerHTML = `✅ Copiado!`;
          setTimeout(() => {
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg> Copiar código Pix`;
          }, 2000);
        } catch {
          /* fallback: selecionar o campo */
          const field = body.querySelector(".pix-code-field");
          field.select();
          field.setSelectionRange(0, 99999);
        }
      });

      /* Facebook Pixel - track AddToCart */
      if (typeof window !== "undefined" && window.fbq) {
        window.fbq("track", "AddToCart", {
          value: valueBRL,
          currency: "BRL",
          content_name: "Doação Juntos Pela Vida - Pedro",
          content_type: "product",
        });
      }

    } catch {
      if (overlay) showError("Não conseguimos gerar o QR Code. Tente novamente.");
    }
  }

  /* ── Criar e exibir o modal ── */
  function createModal(amountCents) {
    closeModal();

    overlay = document.createElement("div");
    overlay.className = "pix-backdrop";
    overlay._amount = amountCents;

    overlay.innerHTML = `
      <section class="pix-dialog" role="dialog" aria-modal="true" aria-labelledby="pix-modal-title">
        <button class="pix-close" type="button" aria-label="Fechar">&#x2715;</button>
        <img class="pix-logo"
          src="/__l5e/assets-v1/62a9e234-bc8a-4819-a7a0-0ce611ae11d0/logo-juntos-pela-vida-pedro.png"
          alt="Juntos Pela Vida" />
        <h2 class="pix-title" id="pix-modal-title">Gerando seu Pix...</h2>
        <p class="pix-value-label">Valor da contribuição</p>
        <p class="pix-amount-display">${formatBRL(amountCents)}</p>
        <div class="pix-body"></div>
      </section>`;

    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
    overlay.querySelector(".pix-close").addEventListener("click", closeModal);
    const onKey = (e) => {
      if (e.key === "Escape") { closeModal(); document.removeEventListener("keydown", onKey); }
    };
    document.addEventListener("keydown", onKey);

    generateAndShow(amountCents);
  }

  /* ── API pública ── */
  window.openPixModal = createModal;

  /* ── Bind botões de valor ── */
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
