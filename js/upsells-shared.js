// Ordem da cadeia de upsells — segue a mesma ordem do arquivo /ga/index.html
// Fluxo: front -> up1 -> up4 -> up5 -> up6 -> up7 -> up9 -> up10 -> up11 -> up12 -> up8 -> up2 -> up3 -> destino final
const upsellOrder = [1, 4, 5, 6, 7, 9, 10, 11, 12, 8, 2, 3];

// Ao terminar toda a cadeia de upsells, volta pro up1 (mantém o cliente no funil em loop)
const finalDestination = '/up1/index.html';

function upsellPathFor(n) {
  return '/up' + n + '/index.html';
}

function getCookie(name) {
  const cookies = document.cookie.split('; ');
  for (const cookie of cookies) {
    const [cookieName, cookieValue] = cookie.split('=');
    if (cookieName === name) {
      return cookieValue;
    }
  }
  return null;
}

function setCookie(name, value, days = 30) {
  const date = new Date();
  date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
  const expires = `expires=${date.toUTCString()}`;
  document.cookie = `${name}=${value};${expires};path=/`;
}

function markUpsellAsVisited(upsellNumber) {
  if (upsellOrder.indexOf(upsellNumber) !== -1) {
    setCookie(`visited_upsell_${upsellNumber}`, 'true', 30);
  }
}

function hasVisitedUpsell(upsellNumber) {
  return getCookie(`visited_upsell_${upsellNumber}`) === 'true';
}

// Retorna o número do próximo upsell ainda não visitado, na ordem do /ga (-1 = acabou)
function getNextUpsellNumber() {
  for (let i = 0; i < upsellOrder.length; i++) {
    if (!hasVisitedUpsell(upsellOrder[i])) {
      return upsellOrder[i];
    }
  }
  return -1;
}

function redirectToNextUpsell() {
  const next = getNextUpsellNumber();
  const queryString = window.location.search; // mantém UTMs/params na navegação
  if (next >= 0) {
    window.location.href = upsellPathFor(next) + queryString;
  } else {
    window.location.href = finalDestination + queryString;
  }
}

function initUpsell(currentUpsellNumber) {
  markUpsellAsVisited(currentUpsellNumber);
  console.log(`Upsell ${currentUpsellNumber} carregado e marcado como visitado.`);
}

window.redirectToNextUpsell = redirectToNextUpsell;
window.initUpsell = initUpsell;
