// Galeria playerów: lista z api.php. Kafelek = plakat (jeden kadr 16:10 dla wszystkich, równa siatka), tytuł, proporcje, data i akcje; klik w plakat otwiera player w oknie nad stroną
// (duży kadr w proporcjach projektu, Esc / tło / X zamyka i zatrzymuje player), a nie w miniaturze kafelka, gdzie HUD się nie mieści.
(() => {
  const list = document.getElementById('list');
  const modal = document.getElementById('modal');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const parts = (a) => { const [w, h] = String(a).split(':').map(Number); return w > 0 && h > 0 ? [w, h] : [16, 9]; };
  const ratio = (a) => parts(a).join(' / ');
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const fmt = (a) => { const [w, h] = parts(a); const g = gcd(w, h) || 1; return `${w / g}:${h / g}`; };
  const date = (d) => new Date(d).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });
  // ten sam kod co embedCode() w edytorze (src/core/publish/publishPlan.js): proporcje jak warianty edytora według szerokości
  // miejsca na stronie (Desktop: kadr projektu, do 1000 px Tablet 4:3, do 600 px Mobile 9:16)
  const MOBILE_MAX = 600;
  const TABLET_MAX = 1000;
  const embed = (p) => {
    const css = `.trasy-player iframe{display:block;width:100%;aspect-ratio:${ratio(p.aspect)};max-height:90vh;border:0}`
      + `@container (max-width:${TABLET_MAX}px){.trasy-player iframe{aspect-ratio:4 / 3}}`
      + `@container (max-width:${MOBILE_MAX}px){.trasy-player iframe{aspect-ratio:9 / 16}}`;
    return `<div class="trasy-player" style="container-type:inline-size"><iframe src="${p.url}" title="${String(p.title).replace(/[<>"&]/g, '')}" allow="fullscreen" loading="lazy"></iframe></div>\n<style>${css}</style>`;
  };
  // okno z playerem: proporcje wariantu dla szerokości ekranu (jak w kodzie osadzenia); telefon: cały ekran
  const modalAspect = (p) => { const [w, h] = parts(p.aspect); return innerWidth <= MOBILE_MAX ? 9 / 16 : innerWidth <= TABLET_MAX ? 4 / 3 : w / h; };
  const ICON = {
    copy: '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H4a1.5 1.5 0 0 0-1.5 1.5V9A1.5 1.5 0 0 0 4 10.5h1.5"/></svg>',
    out: '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3H4a1.5 1.5 0 0 0-1.5 1.5v7.5A1.5 1.5 0 0 0 4 13.5h7.5A1.5 1.5 0 0 0 13 12V9M9.5 2.5h4v4M13.5 2.5 7.5 8.5"/></svg>',
    close: '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="m4 4 8 8M12 4l-8 8"/></svg>',
  };

  async function copyEmbed(btn, p) {
    const label = btn.querySelector('span');
    try { await navigator.clipboard.writeText(embed(p)); label.textContent = 'Skopiowano'; btn.classList.add('done'); }
    catch { prompt('Skopiuj kod:', embed(p)); }
    setTimeout(() => { label.textContent = 'Kopiuj kod'; btn.classList.remove('done'); }, 1800);
  }
  const actions = (p) => `
    <button class="btn ghost sm" type="button" data-copy>${ICON.copy}<span>Kopiuj kod</span></button>
    <a class="btn ghost sm icon-only" href="${esc(p.url)}" target="_blank" rel="noopener" title="Otwórz w nowej karcie" aria-label="Otwórz w nowej karcie">${ICON.out}</a>`;

  // okno z playerem: kadr jak największy w oknie przeglądarki (--ar)
  function open(p) {
    modal.style.setProperty('--ar', `${modalAspect(p)}`);
    modal.innerHTML = `
      <div class="pl-modal-box">
        <header class="pl-modal-head">
          <div class="pl-modal-title"><b>${esc(p.title)}</b><span class="mono">${esc(fmt(p.aspect))} · ${date(p.date)}</span></div>
          <div class="pl-act">${actions(p)}<button class="btn ghost sm icon-only" type="button" data-close title="Zamknij (Esc)" aria-label="Zamknij">${ICON.close}</button></div>
        </header>
        <iframe src="${esc(p.url)}" title="${esc(p.title)}" allow="fullscreen; autoplay" allowfullscreen></iframe>
      </div>`;
    modal.querySelector('[data-copy]').addEventListener('click', (e) => copyEmbed(e.currentTarget, p));
    modal.querySelector('[data-close]').addEventListener('click', () => modal.close());
    modal.showModal();
    modal.querySelector('iframe').focus();
  }
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); }); // klik w tło
  modal.addEventListener('close', () => { modal.innerHTML = ''; }); // player zatrzymany razem z ramką

  function card(p) {
    const el = document.createElement('article');
    el.className = 'card pl-card';
    el.innerHTML = `
      <button class="pl-media" type="button"${p.poster ? ` style="--img:url('${esc(p.poster)}')"` : ''} aria-label="Uruchom: ${esc(p.title)}">
        <span class="play" aria-hidden="true"></span>
      </button>
      <div class="pl-meta">
        <h3 class="t" title="${esc(p.title)}">${esc(p.title)}</h3>
        <div class="pl-row">
          <span class="m mono">${esc(fmt(p.aspect))} · ${date(p.date)}</span>
          <div class="pl-act">${actions(p)}</div>
        </div>
      </div>`;
    el.querySelector('.pl-media').addEventListener('click', () => open(p));
    el.querySelector('[data-copy]').addEventListener('click', (e) => copyEmbed(e.currentTarget, p));
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--x', `${e.clientX - r.left}px`); el.style.setProperty('--y', `${e.clientY - r.top}px`);
    });
    return el;
  }

  const note = (text) => Object.assign(document.createElement('p'), { className: 'note mono pl-note', textContent: text });
  fetch('api.php?a=list', { cache: 'no-store' })
    .then((r) => r.json())
    .then(({ players = [] }) => list.replaceChildren(...(players.length ? players.map(card) : [note('Jeszcze nic tu nie ma.')])))
    .catch(() => list.replaceChildren(note('Nie udało się wczytać listy.')));
})();
