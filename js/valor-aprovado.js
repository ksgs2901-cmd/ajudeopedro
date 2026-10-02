/* ============================================================
   SuperSim · Valor aprovado dinâmico nos upsells
   Cada lead recebe um valor específico no front (analise-ia / simulação),
   salvo em localStorage.selectedLoanAmount. Estas páginas de upsell tinham
   o valor FIXO "R$ 4.600" hardcodado — este script troca pelo valor real
   daquele lead, mantendo o mesmo formato pt-BR do restante do funil.

   Uso: <script src="../js/valor-aprovado.js" defer></script>
   ============================================================ */
(function () {
  var raw = localStorage.getItem('selectedLoanAmount');
  if (!raw) return;                       // sem valor salvo → mantém o placeholder
  var amount = parseFloat(raw);
  if (!isFinite(amount) || amount <= 0) return;

  // mesmos formatos usados no front (9.html): "3.000,00" e "3.000"
  var withCents = amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var noCents   = amount.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

  function swap(txt) {
    // ordem importa: primeiro a versão com centavos, depois a sem
    return txt.replace(/4\.600,00/g, withCents).replace(/4\.600/g, noCents);
  }

  function walk(node) {
    if (node.nodeType === 3) {            // nó de texto
      if (node.nodeValue && node.nodeValue.indexOf('4.600') !== -1) {
        node.nodeValue = swap(node.nodeValue);
      }
      return;
    }
    if (node.nodeType === 1) {            // elemento
      var tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return;
      for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
    }
  }

  function run() { if (document.body) walk(document.body); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
