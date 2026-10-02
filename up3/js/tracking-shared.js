// Rastreamento avançado do TOPO do funil (páginas de entrada).
// Faz Advanced Matching MAXIMIZADO em toda página + expõe fbTrack() com dedup browser↔CAPI.
// (Nos upsells quem cuida disso é o checkout-shared.js — este script é p/ as páginas iniciais.)

// captura fbclid p/ montar fbc depois (in-app browser do Instagram não passa cookie)
(function () {
  try {
    var c = new URLSearchParams(location.search).get('fbclid');
    if (c) { sessionStorage.setItem('_fbclid', c); localStorage.setItem('fbclid', c); }
  } catch (e) {}
})();

// captura UTMs no PRIMEIRO toque (landing) e guarda no localStorage — sobrevive até os upsells
(function () {
  try {
    var p = new URLSearchParams(location.search);
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'src', 'sck'];
    var fresh = {};
    keys.forEach(function (k) { var v = p.get(k); if (v) fresh[k] = v; });
    if (Object.keys(fresh).length) {
      try { sessionStorage.setItem('_utms', JSON.stringify(fresh)); } catch (e) {}
      var prev = {};
      try { prev = JSON.parse(localStorage.getItem('_utms') || '{}'); } catch (e) {}
      localStorage.setItem('_utms', JSON.stringify(Object.assign(prev, fresh)));
    }
  } catch (e) {}
})();

