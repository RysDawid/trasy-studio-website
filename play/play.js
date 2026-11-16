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
  // warianty jak w edytorze (Desktop: kadr projektu); domyślny z szerokości ekranu, jak w kodzie osadzenia
  const VARIANTS = [
    { id: 'desktop', label: 'Desktop', ar: (p) => { const [w, h] = parts(p.aspect); return w / h; } },
    { id: 'tablet', label: 'Tablet 4:3', ar: () => 4 / 3 },
    { id: 'mobile', label: 'Mobile 9:16', ar: () => 9 / 16 },
  ];
  const defaultVariant = () => (innerWidth <= MOBILE_MAX ? 'mobile' : innerWidth <= TABLET_MAX ? 'tablet' : 'desktop');
  const ICON = {
    copy: '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H4a1.5 1.5 0 0 0-1.5 1.5V9A1.5 1.5 0 0 0 4 10.5h1.5"/></svg>',
    out: '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3H4a1.5 1.5 0 0 0-1.5 1.5v7.5A1.5 1.5 0 0 0 4 13.5h7.5A1.5 1.5 0 0 0 13 12V9M9.5 2.5h4v4M13.5 2.5 7.5 8.5"/></svg>',
    close: '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="m4 4 8 8M12 4l-8 8"/></svg>',
    desktop: '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="1.5" y="2.5" width="13" height="8.5" rx="1.2"/><path d="M6 14h4M8 11v3"/></svg>',
    tablet: '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="2" y="3" width="12" height="10" rx="1.4"/><path d="M12 7.3v1.4"/></svg>',
    mobile: '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="4.5" y="1.5" width="7" height="13" rx="1.4"/><path d="M7.2 12.5h1.6"/></svg>',
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

  // okno z playerem: kadr jak największy w oknie przeglądarki (--ar) w proporcjach wybranego wariantu; przełącznik
  // Desktop / Tablet / Mobile w belce jak w edytorze: player w środku przechodzi na układ HUD tego wariantu
  function open(p) {
    const pick = (id) => {
      const v = VARIANTS.find((x) => x.id === id) ?? VARIANTS[0];
      modal.style.setProperty('--ar', `${v.ar(p)}`);
      for (const b of modal.querySelectorAll('[data-variant]')) {
        const on = b.dataset.variant === v.id;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      }
    };
    modal.innerHTML = `
      <div class="pl-modal-box">
        <header class="pl-modal-head">
          <div class="pl-modal-title"><b>${esc(p.title)}</b><span class="mono">${date(p.date)}</span></div>
          <div class="seg pl-variants" role="group" aria-label="Podgląd osadzenia">${VARIANTS.map((v) => `<button type="button" data-variant="${v.id}" title="${v.id === 'desktop' ? `Desktop ${esc(fmt(p.aspect))}` : v.label}" aria-label="${v.label}">${ICON[v.id]}</button>`).join('')}</div>
          <div class="pl-act">${actions(p)}<button class="btn ghost sm icon-only" type="button" data-close title="Zamknij (Esc)" aria-label="Zamknij">${ICON.close}</button></div>
        </header>
        <iframe src="${esc(p.url)}" title="${esc(p.title)}" allow="fullscreen; autoplay" allowfullscreen></iframe>
      </div>`;
    modal.querySelector('[data-copy]').addEventListener('click', (e) => copyEmbed(e.currentTarget, p));
    modal.querySelector('[data-close]').addEventListener('click', () => modal.close());
    for (const b of modal.querySelectorAll('[data-variant]')) b.addEventListener('click', () => pick(b.dataset.variant));
    pick(defaultVariant());
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
