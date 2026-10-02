// Captura progressiva e RESILIENTE de leads do funil -> /api/lead -> Supabase.
// Estratégia: estado completo do lead no localStorage, reenviado (idempotente) a cada
// evento E a cada pageview. Se um envio falha (in-app browser do FB descarta sendBeacon),
// o próximo pageview reconcilia. Nada se perde.
(function () {
  var STAGES = {
    landing: 1, cpf: 2, quiz_mae: 3, finalidade: 4, ocupacao: 5,
    renda: 6, escolaridade: 7, situacao: 8, termos: 9,
    // back-half do funil (analise-ia em diante) — casa 1:1 com o painel
    analise: 10, assinatura: 11, facial: 12, oferta: 13, vencimento: 14,
    contato: 15, senha: 16, chave: 17, saque: 18, transferencia: 19, checkout: 20
  };
  var KEY = 'arx_lead_v2';

  function uuid() {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } }
  function persist(st) { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }

  function state() {
    var st = load();
    if (!st) {
      // Migra sid do formato antigo (v1) se existir, pra não duplicar lead em progresso.
      var oldSid = null;
      try { oldSid = localStorage.getItem('arx_lead_sid'); } catch (e) {}
      st = { sid: oldSid || uuid(), data: {}, timeline: {}, stage: null, stage_order: 0, utm: {} };
      persist(st);
    }
    return st;
  }

  function collectUtms(st) {
    try {
      var qs = new URLSearchParams(location.search);
      var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'src', 'sck', 'fbclid'];
      keys.forEach(function (k) { var v = qs.get(k); if (v && !st.utm[k]) st.utm[k] = v; });
    } catch (e) {}
  }

  function send(st) {
    var body = JSON.stringify({
      sid: st.sid, project: 'supersimorpin',
      patch: st.data || {}, stage: st.stage, stage_order: st.stage_order || 0,
      utm: st.utm || {}, timeline: st.timeline || {}
    });
    // fetch keepalive é bem mais confiável que sendBeacon no in-app browser do Facebook.
    try {
      fetch('/api/lead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: body, keepalive: true
      }).catch(function () { try { if (navigator.sendBeacon) navigator.sendBeacon('/api/lead', new Blob([body], { type: 'application/json' })); } catch (e) {} });
    } catch (e) {
      try { if (navigator.sendBeacon) navigator.sendBeacon('/api/lead', new Blob([body], { type: 'application/json' })); } catch (e2) {}
    }
  }

  function save(patch, stage) {
    var st = state();
    collectUtms(st);
    if (patch) { for (var k in patch) { if (patch[k] != null && patch[k] !== '') st.data[k] = patch[k]; } }
    if (stage) {
      var ord = STAGES[stage] || 0;
      if (!st.timeline[stage]) st.timeline[stage] = Date.now(); // first-touch de cada etapa
      if (ord >= (st.stage_order || 0)) { st.stage = stage; st.stage_order = ord; }
    }
    persist(st);
    send(st);
  }

  // Reconciliação: reenvia o estado acumulado (idempotente). Conserta qualquer envio perdido.
  function flush() { var st = load(); if (st) { collectUtms(st); persist(st); send(st); } }

  // Registra uma pergunta+resposta do funil no transcript (data.qa[]) e, opcional,
  // avança a etapa + grava campos (patch). Idempotente: dedupe consecutivo evita que
  // o reenvio por pageview duplique a mesma resposta.
  function clean(s, max) {
    return String(s == null ? '' : s).replace(/\*\*/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 300);
  }
  function log(q, a, stage, patch) {
    try {
      var st = state();
      st.data.qa = st.data.qa || [];
      var qa = st.data.qa;
      var entry = { q: clean(q), a: clean(a), t: Date.now(), p: location.pathname };
      var last = qa[qa.length - 1];
      if (!last || last.q !== entry.q || last.a !== entry.a || last.p !== entry.p) qa.push(entry);
      persist(st);
      save(patch || {}, stage); // persiste (com qa) + marca etapa + envia
    } catch (e) {}
  }

  window.arxLead = { save: save, log: log, sid: function () { return state().sid; }, flush: flush };

  // Heartbeat: enquanto a aba está visível, reenvia o snapshot a cada 25s.
  // Mantém o updated_at fresco pro painel saber quem está "online no funil" agora.
  setInterval(function () {
    if (document.visibilityState === 'visible') { var st = load(); if (st) send(st); }
  }, 25000);

  // Amarra o checkout ao lead: injeta o sid no corpo das chamadas /api/pix
  // (checkout-shared usa fetch). Assim o pix.js grava o PIX no lead certo.
  try {
    var _fetch = window.fetch;
    if (_fetch && !_fetch.__arxPatched) {
      window.fetch = function (input, init) {
        try {
          var u = (typeof input === 'string') ? input : (input && input.url) || '';
          if (u.indexOf('https://ziznxwaehnifcinosenv.supabase.co/functions/v1/pix') >= 0 && init && typeof init.body === 'string') {
            var b = JSON.parse(init.body);
            if (b && typeof b === 'object' && !b.sid) { b.sid = state().sid; init.body = JSON.stringify(b); }
          }
        } catch (e) {}
        return _fetch.apply(this, arguments);
      };
      window.fetch.__arxPatched = true;
    }
  } catch (e) {}

  // ============ PROGRESSÃO DE ETAPA (back-half do funil) ============
  // Registra APENAS se o lead passou por cada etapa (chegou na tela / clicou no
  // botão). NÃO guarda nenhum valor digitado: sem senha/PIN, sem chave PIX, sem
  // CPF, sem banco, sem assinatura, sem vídeo, sem e-mail/telefone. Só o fato de
  // ter avançado, pra o painel mostrar até onde o lead foi.
  function txtOf(el) { return el ? clean(el.textContent, 90) : ''; }
  var IGNORE = /^(limpar|cancelar|voltar|gravar novamente|editar dados|menu|fechar|del|apagar|\d{1,2})$/i;
  function onClick(sel, cb) {
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest(sel) : null;
      if (b) cb(b, e);
    }, true);
  }

  function initCapture() {
    var p = location.pathname;

    // 6.html — verificação facial (só marca que passou/clicou; sem vídeo/foto)
    if (/(^|\/)6\.html/.test(p)) {
      onClick('button, .opt, [role=button], .btn', function (b) {
        var t = txtOf(b); if (!t || IGNORE.test(t)) return;
        if (/concordo/i.test(t)) log('Verificação facial', 'Aceitou e prosseguiu', 'facial');
        else if (/confirmar\s+v[ií]deo/i.test(t)) log('Verificação facial', 'Confirmou o vídeo', 'facial');
        else if (/finaliz|concluir/i.test(t)) log('Verificação facial', 'Finalizou a etapa', 'facial');
      });
    }
    // 7.html — oferta/CET + dia de vencimento (dia é preferência, não é dado sensível)
    else if (/(^|\/)7\.html/.test(p)) {
      onClick('button, .opt, [role=button], .btn, [data-dia], [data-day]', function (b) {
        var t = txtOf(b); if (!t || IGNORE.test(t)) return;
        if (/li e concordo/i.test(t)) log('Oferta / termos do CET', 'Li e Concordo', 'oferta');
        else if (/dia\s*\d+|todo\s*m[eê]s/i.test(t)) {
          var d = (t.match(/\d+/) || [''])[0];
          log('Escolheu dia de vencimento', d ? 'Dia ' + d : 'Escolheu', 'vencimento');
        }
      });
    }
    // 8.html — dados de contato: só marca que clicou pra confirmar (sem e-mail/telefone)
    else if (/(^|\/)8\.html/.test(p)) {
      onClick('button, .opt, [role=button], .btn', function (b) {
        var t = txtOf(b); if (!/confirmar|continuar/i.test(t)) return;
        log('Dados de contato', 'Confirmou e prosseguiu', 'contato');
      });
    }
    // criar-senha.html — só marca que confirmou a senha; NÃO lê o PIN.
    // Detecta pelo overlay de conclusão (#done.show) que a etapa 2 (confirmar) fechou.
    else if (/criar-senha\.html/.test(p)) {
      var sent = false;
      var iv = setInterval(function () {
        var done = document.getElementById('done');
        if (done && /(^|\s)show(\s|$)/.test(done.className) && !sent) {
          sent = true; clearInterval(iv); log('Criação de senha', 'Criou e confirmou a senha', 'senha');
        }
      }, 400);
      setTimeout(function () { clearInterval(iv); }, 300000);
    }
    // conta.html — saque/transferência: só marca que clicou; sem chave PIX/CPF/banco
    else if (/conta\.html/.test(p)) {
      onClick('.btn-sq, button, .opt, .btn', function (b) {
        var t = txtOf(b);
        if (/sacar/i.test(t)) log('Tela de saque', 'Clicou em Sacar', 'saque');
        else if (/confirmar\s+transfer/i.test(t)) log('Confirmar transferência', 'Confirmou a transferência', 'transferencia');
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCapture);
  else initCapture();

  // Reenvia no carregamento de TODA página que tem o script (inclui as proxiadas).
  try { var st0 = load(); if (st0) { collectUtms(st0); persist(st0); send(st0); } } catch (e) {}

  // Garante o último estado ao sair da página (backup do keepalive).
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
})();
