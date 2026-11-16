// Galeria playerów: lista z api.php, klik w plakat uruchamia player, „Kopiuj embed” kopiuje <iframe>.
(() => {
  const list = document.getElementById('list');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const ratio = (a) => { const [w, h] = String(a).split(':').map(Number); return w > 0 && h > 0 ? `${w} / ${h}` : '16 / 9'; };
  // ten sam kod co embedCode() w edytorze (src/core/publish/publishPlan.js)
  const embed = (p) => `<iframe src="${p.url}" title="${String(p.title).replace(/[<>"&]/g, '')}" style="display:block;width:100%;aspect-ratio:${ratio(p.aspect)};border:0" allow="fullscreen" loading="lazy"></iframe>`;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const fmt = (a) => { const [w, h] = String(a).split(':').map(Number); const g = gcd(w, h) || 1; return `${w / g}:${h / g}`; };
  const date = (d) => new Date(d).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });

  function card(p) {
    const el = document.createElement('article');
    el.className = 'card pl-card';
    el.innerHTML = `
      <div class="pl-media" style="aspect-ratio:${ratio(p.aspect)}${p.poster ? `;background-image:url('${esc(p.poster)}')` : ''}">
        <button class="play" type="button" aria-label="Uruchom player"></button>
      </div>
      <div class="pl-meta">
        <div><span class="t">${esc(p.title)}</span><span class="m mono">${esc(fmt(p.aspect))} · ${date(p.date)}</span></div>
        <div class="pl-act">
          <a class="btn ghost sm" href="${esc(p.url)}" target="_blank" rel="noopener">Otwórz</a>
          <button class="btn sm" type="button" data-copy>Kopiuj embed</button>
        </div>
      </div>`;
    el.querySelector('.play').addEventListener('click', () => {
      const f = document.createElement('iframe');
      Object.assign(f, { src: p.url, title: p.title, allow: 'fullscreen; autoplay', allowFullscreen: true });
      f.style.aspectRatio = ratio(p.aspect);
      el.querySelector('.pl-media').replaceWith(f);
    });
    const copy = el.querySelector('[data-copy]');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(embed(p)); copy.textContent = 'Skopiowano'; }
      catch { prompt('Skopiuj kod:', embed(p)); }
      setTimeout(() => { copy.textContent = 'Kopiuj embed'; }, 1800);
    });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--x', `${e.clientX - r.left}px`); el.style.setProperty('--y', `${e.clientY - r.top}px`);
    });
    return el;
  }

  fetch('api.php?a=list', { cache: 'no-store' })
    .then((r) => r.json())
    .then(({ players = [] }) => {
      list.replaceChildren(...(players.length ? players.map(card) : [Object.assign(document.createElement('p'), { className: 'note mono', textContent: 'Jeszcze nic tu nie ma.' })]));
    })
    .catch(() => { list.innerHTML = '<p class="note mono">Nie udało się wczytać listy.</p>'; });
})();
