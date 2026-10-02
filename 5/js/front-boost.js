/* ============================================================
   SuperSim · Kit de Conversão do Front (prova social + atividade ao vivo)
   Auto-injeta estilo e widgets. Basta incluir em qualquer página:
   <script src="js/front-boost.js" defer></script>
   Notificações na identidade SuperSim (âmbar/dourado + grafite), com
   variação: a cada 3 aparições, uma vem como push oficial com a logo.
   Mix de APROVADO (verde) e NÃO APROVADO (vermelho) pra passar a
   sensação de escassez: nem todo mundo é aprovado.
   ============================================================ */
(function () {
  if (window.__cfBoost) return; window.__cfBoost = true;

  var NOMES = ['Maria S.','João P.','Ana C.','Carlos M.','Juliana R.','Pedro A.','Fernanda L.','Lucas O.','Patrícia G.','Rafael T.','Camila F.','Bruno N.','Aline D.','Marcos V.','Beatriz S.','Diego R.','Larissa M.','Thiago C.','Vanessa P.','Gustavo H.'];
  var CIDADES = ['São Paulo, SP','Rio de Janeiro, RJ','Belo Horizonte, MG','Curitiba, PR','Salvador, BA','Recife, PE','Fortaleza, CE','Porto Alegre, RS','Goiânia, GO','Campinas, SP','Manaus, AM','Brasília, DF','Belém, PA','Guarulhos, SP','São Luís, MA'];
  var VALORES = ['5.000','7.500','9.000','12.000','15.000','18.000','20.000','25.000','30.000'];
  var BRAND_MSG = ['Seu crédito está pré-aprovado','Oferta liberada só pra você','Pix na conta em até 10 min','Simulação aprovada, é só continuar','Vagas de aprovação limitadas hoje'];
  // Mensagens NEGATIVAS (nem todo mundo é aprovado) — neutras de gênero
  var NEG_MSG = ['Crédito não aprovado desta vez','Análise não aprovada no momento','Não atingiu o score mínimo','Solicitação não aprovada','Não aprovado — limite indisponível'];
  var NEG_CHANCE = 0.35; // ~35% das notificações de pessoas vêm negativas

  function pick(a){ return a[Math.floor(Math.random()*a.length)]; }
  function rint(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }

  var CHK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';
  var XIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  var css = ''
    + '.cfb-toast{position:fixed;left:14px;top:12px;z-index:99000;max-width:300px;background:#fff;border:1px solid #efe7d6;border-radius:16px;box-shadow:0 16px 38px -14px rgba(37,31,24,.34),0 2px 8px -4px rgba(0,0,0,.06);padding:11px 13px 11px 15px;display:flex;gap:11px;align-items:center;transform:translateY(-180%);opacity:0;transition:transform .55s cubic-bezier(.2,.75,.2,1),opacity .4s;font-family:"Plus Jakarta Sans",Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'
    + '.cfb-toast.cfb-show{transform:none;opacity:1}'
    + '.cfb-toast::before{content:"";position:absolute;left:0;top:11px;bottom:11px;width:4px;border-radius:0 4px 4px 0;background:linear-gradient(180deg,#FFC000,#F0900F)}'
    + '.cfb-toast.cfb-neg::before{background:linear-gradient(180deg,#f0665f,#cf2a24)}' /* barra vermelha p/ negativo */
    + '.cfb-av{position:relative;width:42px;height:42px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;color:#fff;overflow:visible;background:linear-gradient(135deg,#FFB300,#E07C08);box-shadow:0 6px 14px -6px rgba(224,124,8,.55)}'
    + '.cfb-toast.cfb-neg .cfb-av{background:linear-gradient(135deg,#b7b0a4,#877f72);box-shadow:0 6px 14px -6px rgba(120,112,100,.5)}' /* avatar acinzentado p/ negativo */
    + '.cfb-avin{width:100%;height:100%;border-radius:12px;overflow:hidden;display:flex;align-items:center;justify-content:center}'
    + '.cfb-avin img{width:100%;height:100%;object-fit:contain;padding:5px;background:#fff}'
    + '.cfb-av .vbadge{position:absolute;right:-4px;bottom:-4px;width:17px;height:17px;border-radius:50%;background:#12a150;border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff}'
    + '.cfb-av .vbadge.no{background:#cf2a24}' /* selo X vermelho */
    + '.cfb-av .vbadge svg{width:9px;height:9px}'
    + '.cfb-tx{font-size:12.5px;color:#2b2620;line-height:1.34;min-width:0}'
    + '.cfb-tx b{font-weight:800;color:#201d18}'
    + '.cfb-tx .ago{color:#a7a096;font-weight:500;font-size:10.5px}'
    + '.cfb-tx .ok{display:flex;align-items:center;gap:4px;color:#12a150;font-size:11px;font-weight:700;margin-top:2px}'
    + '.cfb-tx .no{display:flex;align-items:center;gap:4px;color:#cf2a24;font-size:11px;font-weight:700;margin-top:2px}' /* status vermelho */
    + '.cfb-tx .ok svg,.cfb-tx .no svg{width:11px;height:11px;flex-shrink:0}'
    + '.cfb-live{position:fixed;left:14px;bottom:16px;z-index:98000;background:rgba(30,25,20,.9);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:#f7f1e6;font-family:"Plus Jakarta Sans",Inter,system-ui,sans-serif;font-size:11.5px;font-weight:600;padding:8px 14px;border-radius:100px;display:flex;align-items:center;gap:7px;border:1px solid rgba(255,255,255,.08);box-shadow:0 10px 24px -10px rgba(37,31,24,.55);opacity:0;transition:opacity .45s}'
    + '.cfb-live.cfb-show{opacity:1}'
    + '.cfb-live i{width:7px;height:7px;border-radius:50%;background:#3ddc84;box-shadow:0 0 0 0 rgba(61,220,132,.7);animation:cfbPulse 1.6s infinite}'
    + '@keyframes cfbPulse{0%{box-shadow:0 0 0 0 rgba(61,220,132,.6)}70%{box-shadow:0 0 0 7px rgba(61,220,132,0)}100%{box-shadow:0 0 0 0 rgba(61,220,132,0)}}'
    + '@media (max-width:380px){.cfb-toast{max-width:84vw}}'
    + '@media (prefers-reduced-motion:reduce){.cfb-toast,.cfb-live{transition:opacity .3s}.cfb-toast{transform:none}}';

  function inject() {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

    /* contador "ao vivo" no canto inferior */
    var live = document.createElement('div'); live.className = 'cfb-live';
    var base = rint(180, 320);
    live.innerHTML = '<i></i> <span>' + base + ' pessoas analisando agora</span>';
    document.body.appendChild(live);

    /* guarda: não deixar o contador tampar selos de confiança / rodapé */
    var guardCount = 0;
    var guards = document.querySelectorAll('.ra-seal, .site-footer, footer');
    if ('IntersectionObserver' in window && guards.length) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { guardCount += e.isIntersecting ? 1 : -1; });
        if (guardCount < 0) guardCount = 0;
        if (guardCount > 0) live.classList.remove('cfb-show');
        else live.classList.add('cfb-show');
      }, { threshold: 0.1 });
      guards.forEach(function (g) { io.observe(g); });
    }

    setTimeout(function(){ if (guardCount === 0) live.classList.add('cfb-show'); }, 900);
    setInterval(function(){
      base += rint(-3, 5); if (base < 120) base = 120 + rint(0,30);
      live.querySelector('span').textContent = base + ' pessoas analisando agora';
    }, 4000);

    /* toast de prova social / push da marca */
    var toast = document.createElement('div'); toast.className = 'cfb-toast';
    toast.innerHTML = '<div class="cfb-av"><span class="cfb-avin" id="cfbAvIn"></span><span class="vbadge" id="cfbBadge">' + CHK + '</span></div>'
      + '<div class="cfb-tx"><b id="cfbNome"></b> <span class="ago" id="cfbAgo"></span><span class="ok" id="cfbOk"></span></div>';
    document.body.appendChild(toast);
    var avIn = toast.querySelector('#cfbAvIn'), nomeEl = toast.querySelector('#cfbNome'),
        agoEl = toast.querySelector('#cfbAgo'), okEl = toast.querySelector('#cfbOk'), badgeEl = toast.querySelector('#cfbBadge');

    var count = 0;
    function showOne() {
      var brand = (count % 3 === 2);   // a cada 3 aparições, uma vem como push oficial da marca
      count++;

      if (brand) {
        toast.classList.remove('cfb-neg');
        avIn.innerHTML = '<img src="images/supersim-logo.png" alt="SuperSim">';
        badgeEl.className = 'vbadge'; badgeEl.innerHTML = CHK;
        nomeEl.textContent = 'SuperSim';
        agoEl.textContent = '· agora';
        okEl.className = 'ok'; okEl.innerHTML = CHK + ' ' + pick(BRAND_MSG);
      } else {
        var nome = pick(NOMES), cidade = pick(CIDADES), ago = rint(1, 9);
        avIn.innerHTML = ''; avIn.textContent = nome.charAt(0);
        nomeEl.textContent = nome + ' — ' + cidade;
        agoEl.textContent = '· há ' + ago + ' min';

        if (Math.random() < NEG_CHANCE) {
          // NÃO APROVADO — cria a sensação de que nem todo mundo consegue
          toast.classList.add('cfb-neg');
          badgeEl.className = 'vbadge no'; badgeEl.innerHTML = XIC;
          okEl.className = 'no'; okEl.innerHTML = XIC + ' ' + pick(NEG_MSG);
        } else {
          // APROVADO
          toast.classList.remove('cfb-neg');
          badgeEl.className = 'vbadge'; badgeEl.innerHTML = CHK;
          okEl.className = 'ok'; okEl.innerHTML = CHK + ' Crédito de R$ ' + pick(VALORES) + ' aprovado';
        }
      }

      toast.classList.add('cfb-show');
      setTimeout(function(){ toast.classList.remove('cfb-show'); }, 4600);
    }
    setTimeout(showOne, 12000);   // 1ª aparição só depois de 12s
    setInterval(showOne, 35000);  // depois, no máximo a cada 35s
  }

  if (document.body) inject();
  else document.addEventListener('DOMContentLoaded', inject);
})();
