/* ============================================================
   SuperSim · Back Redirect — Recuperação por Downsell (v4)
   Prende o botão "voltar" / gesto de swipe-back.

   Pareamento FIXO (cada upsell tem o SEU downsell) — SEM bagunça:
     - FRONT (/9/):               voltar → /downsell/front/index.html
     - UPSELL  /upN/:             voltar → /downsell/upN/index.html  (o downsell DAQUELE upsell)
     - DOWNSELL /downsell/*:      voltar → NÃO vai pra lugar nenhum (fica no downsell)

   O downsell é o FIM DA LINHA do "voltar": nunca empurra pra outros upsells.
   Cada upsell manda só pro seu próprio downsell, e o downsell não redireciona.

   Os destinos são caminhos ABSOLUTOS (começam com "/"), então funcionam
   igual de qualquer profundidade de pasta. Não use caminhos relativos aqui:
   de /9/index.html um "downsell/front/index.html" vira /9/downsell/... → 404.

   Inclua no FINAL de cada página, antes de </body>. Cada pasta tem a sua
   própria cópia do script, então o src é sempre o mesmo:
     <script src="js/back-redirect.js?v=5"></script>
   ============================================================ */
(function () {
  if (window.__cfBackRedirect) return;
  window.__cfBackRedirect = true;

  var upMatch    = location.pathname.match(/\/up(\d+)\//); // estamos num /upN/
  var isDownsell = /\/downsell\//.test(location.pathname); // estamos em qualquer /downsell/*

  function destination() {
    var qs = location.search || '';

    // 1) DOWNSELL (front ou upN) → FIM DA LINHA: não manda pra lugar nenhum.
    //    Isso mata a bagunça de ficar ciclando up1, up2, up3...
    if (isDownsell) return null;

    // 2) UPSELL → o downsell DAQUELE upsell (pareamento fixo).
    if (upMatch) {
      var n = parseInt(upMatch[1], 10);
      return '/downsell/up' + n + '/index.html' + qs;
    }

    // 3) FRONT (/9/) → downsell do front.
    return '/downsell/front/index.html' + qs;
  }

  // Empilha um estado falso pra capturar o 1º "voltar" no nosso handler
  try { history.pushState({ cfBack: 1 }, '', location.href); } catch (e) {}

  window.addEventListener('popstate', function () {
    try { history.pushState({ cfBack: 1 }, '', location.href); } catch (e) {} // re-trava
    var dest = destination();
    if (dest) window.location.href = dest; // se null (downsell), fica onde está
  });
})();
