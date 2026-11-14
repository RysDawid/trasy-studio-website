// Trasy Studio: podgląd 3D w hero (canvas 2D z prostą projekcją), HUD, oś czasu, efekty kart.
(() => {
  const $ = (id) => document.getElementById(id);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- deterministyczne losowanie
  const rng = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  // --- miasto: siatka kwartałów, każdy dzielony na 4 działki
  const CELL = 10, R = 9, GAP = 1.5;
  const rand = rng(11);
  const lots = [], blocks = [], parks = [];
  for (let i = -R; i < R; i++) for (let j = -R; j < R; j++) {
    const x0 = i * CELL + GAP, z0 = j * CELL + GAP, s = CELL - GAP * 2;
    blocks.push([x0, z0, s]);
    if (rand() < 0.07) { parks.push([x0, z0, s]); continue; }
    const half = (s - 0.7) / 2;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const x = x0 + a * (half + 0.7), z = z0 + b * (half + 0.7);
      const d = Math.min(1, Math.hypot(x, z) / (R * CELL));
      const h = 1.4 + Math.pow(rand(), 2.6) * 17 * (1 - d * 0.7) + rand() * 1.5;
      lots.push({ x, z, w: half, d: half, h, cx: x + half / 2, cz: z + half / 2 });
    }
  }

  // --- trasa: błądzenie po skrzyżowaniach, preferuje jazdę prosto
  function makeRoute() {
    for (let seed = 3; ; seed++) {
      const r = rng(seed), lim = R - 2, seen = new Set(['-4,-3']);
      let p = [-4, -3], dir = [1, 0];
      const pts = [p.slice()];
      for (let n = 0; n < 70; n++) {
        const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => {
          const q = [p[0] + dx, p[1] + dz];
          return !(dx === -dir[0] && dz === -dir[1]) && Math.abs(q[0]) <= lim && Math.abs(q[1]) <= lim && !seen.has(q + '');
        });
        if (!opts.length) break;
        const straight = opts.find((o) => o[0] === dir[0] && o[1] === dir[1]);
        dir = straight && r() < 0.6 ? straight : opts[Math.floor(r() * opts.length)];
        p = [p[0] + dir[0], p[1] + dir[1]];
        seen.add(p + '');
        pts.push(p.slice());
      }
      if (pts.length > 46) return pts.map(([a, b]) => [a * CELL, b * CELL]);
    }
  }
  const raw = makeRoute();
  const route = raw.filter((p, i) => { // usuń punkty współliniowe
    if (!i || i === raw.length - 1) return true;
    const a = raw[i - 1], b = raw[i + 1];
    return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
  });
  const cum = [0];
  for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]));
  const LEN = cum[cum.length - 1];
  const KM = 21.1, FRAMES = 6456, FPS = 60, RACE_S = 1 * 3600 + 32 * 60 + 18;
  const STREETS = ['Mikołaja Kopernika', 'Westerplatte', 'Starowiślna', 'Dietla', 'Józefa', 'Krakowska', 'Most Powstańców Śląskich', 'Na Zjeździe', 'Limanowskiego', 'Wielicka', 'Bulwar Kurlandzki', 'Grzegórzecka', 'Lubicz', 'Basztowa', 'Długa', 'Karmelicka', 'Aleje Trzech Wieszczów', 'Zwierzyniecka', 'Bulwar Czerwieński', 'Św. Gertrudy'];

  function at(t) {
    const s = Math.max(0, Math.min(1, t)) * LEN;
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const a = route[i - 1], b = route[i], k = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, seg: i - 1, dx: b[0] - a[0], dz: b[1] - a[1] };
  }
  const elevAt = (u) => 205 + 7 * Math.sin(u * 9.1) + 4 * Math.sin(u * 23 + 1.3) + 2.5 * Math.sin(u * 61 + 0.4) - 6 * Math.cos(u * 3.4);

  // --- profil wysokości (SVG)
  const ES = 160, ev = Array.from({ length: ES + 1 }, (_, i) => elevAt(i / ES));
  const emin = Math.min(...ev), emax = Math.max(...ev);
  const ey = (e) => 64 - ((e - emin) / (emax - emin)) * 56;
  const line = ev.map((e, i) => `${i ? 'L' : 'M'}${(i / ES) * 400},${ey(e).toFixed(1)}`).join('');
  $('eline').setAttribute('d', line); $('edone').setAttribute('d', line); $('efill').setAttribute('d', line + 'L400,70L0,70Z');
  $('emin').textContent = Math.round(emin); $('emax').textContent = Math.round(emax);

  // --- palety
  const PAL = {
    night: { bg: [11, 13, 18], ground: [17, 20, 27], park: [16, 30, 24], top: [40, 45, 58], sa: [27, 31, 41], sb: [21, 24, 32], edge: 'rgba(120,140,255,0.10)', rest: 'rgba(160,170,200,0.28)', label: '#0b0d12' },
    day: { bg: [233, 230, 223], ground: [221, 217, 208], park: [200, 224, 186], top: [246, 244, 240], sa: [214, 209, 199], sb: [199, 193, 182], edge: 'rgba(0,0,0,0.05)', rest: 'rgba(60,70,110,0.30)', label: '#fff' },
  };
  const state = { t: 0.08, playing: !reduce, night: 1, mode3d: 1, mx: 0, my: 0, mix: 1, pitch: 0.82 };
  const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

  // --- canvas i kamera
  const cv = $('city'), ctx = cv.getContext('2d');
  const mini = $('mini'), mctx = mini.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(2, devicePixelRatio || 1);
    const r = cv.getBoundingClientRect(); W = r.width; H = r.height;
    cv.width = W * DPR; cv.height = H * DPR;
    const m = mini.getBoundingClientRect(); mini.width = m.width * DPR; mini.height = m.height * DPR;
  }
  new ResizeObserver(resize).observe(cv);

  const cam = { x: 0, y: 0, z: 0, tx: route[0][0], tz: route[0][1], yaw: 0.7, r: [0, 0, 0], u: [0, 0, 0], f: [0, 0, 0], foc: 1 };
  function setupCam(yaw, pitch, dist) {
    cam.x = cam.tx + dist * Math.cos(pitch) * Math.sin(yaw);
    cam.y = dist * Math.sin(pitch);
    cam.z = cam.tz + dist * Math.cos(pitch) * Math.cos(yaw);
    const f = [cam.tx - cam.x, -cam.y, cam.tz - cam.z], fl = Math.hypot(...f);
    cam.f = f.map((v) => v / fl);
    const r = [cam.f[2], 0, -cam.f[0]], rl = Math.hypot(...r) || 1; // cross(f, up)
    cam.r = [-r[0] / rl, 0, -r[2] / rl];
    cam.u = [cam.r[1] * cam.f[2] - cam.r[2] * cam.f[1], cam.r[2] * cam.f[0] - cam.r[0] * cam.f[2], cam.r[0] * cam.f[1] - cam.r[1] * cam.f[0]];
    cam.foc = Math.max(W, H * 1.6) * 1.05;
  }
  const P = [0, 0, 0];
  function proj(x, y, z) {
    const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
    const zz = dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2];
    if (zz < 1) return null;
    P[0] = W / 2 + (cam.foc * (dx * cam.r[0] + dy * cam.r[1] + dz * cam.r[2])) / zz;
    P[1] = H / 2 - (cam.foc * (dx * cam.u[0] + dy * cam.u[1] + dz * cam.u[2])) / zz;
    P[2] = zz;
    return P;
  }
  function poly(pts, fill) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) i ? ctx.lineTo(pts[i], pts[i + 1]) : ctx.moveTo(pts[i], pts[i + 1]);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }
  function quad(x, z, s, col, pal, y = 0) {
    const out = [];
    for (const [a, b] of [[x, z], [x + s, z], [x + s, z + s], [x, z + s]]) { const p = proj(a, y, b); if (!p) return; out.push(p[0], p[1]); }
    poly(out, rgb(mixc(col, pal.bg, fog(Math.hypot(x + s / 2 - cam.tx, z + s / 2 - cam.tz)))));
  }
  const fog = (d) => Math.max(0, Math.min(1, (d - 40) / 75));

  function drawRouteLine(t0, t1, style, width) {
    ctx.beginPath();
    let started = false;
    const s0 = t0 * LEN, s1 = t1 * LEN;
    const pts = [at(t0)];
    for (let i = 1; i < route.length - 1; i++) if (cum[i] > s0 && cum[i] < s1) pts.push({ x: route[i][0], z: route[i][1] });
    pts.push(at(t1));
    for (const p of pts) { const q = proj(p.x, 0.15, p.z); if (!q) continue; started ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); started = true; }
    ctx.strokeStyle = style; ctx.lineWidth = width; ctx.stroke();
  }
  function pin(p, text, color, pal) {
    const q = proj(p[0], 0.2, p[1]); if (!q) return;
    const x = q[0], y = q[1];
    ctx.font = '500 10px "Geist Mono", monospace';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 30, w, 18, 4); ctx.fill();
    ctx.fillRect(x - 0.5, y - 12, 1, 10);
    ctx.fillStyle = '#0b0d12'; ctx.fillText(text, x - w / 2 + 6, y - 17.5);
  }

  let last = performance.now(), fpsAcc = 0, fpsN = 0, visible = true, time0 = last;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { $('fps').textContent = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    if (state.playing && !dragging) { state.t += dt / 70; if (state.t > 1) state.t = 0; }
    if (visible && W) render(now, dt);
    requestAnimationFrame(frame);
  }

  function render(now, dt) {
    const k = 1 - Math.pow(0.001, dt);
    state.mix += (state.night - state.mix) * k * 1.5;
    state.pitch += ((state.mode3d ? 0.8 - state.my * 0.18 : 1.5) - state.pitch) * k;
    const pal = {};
    for (const key of ['bg', 'ground', 'park', 'top', 'sa', 'sb']) pal[key] = mixc(PAL.day[key], PAL.night[key], state.mix);
    const N = state.mix > 0.5 ? PAL.night : PAL.day;
    pal.edge = N.edge; pal.rest = N.rest; pal.label = N.label;

    const p = at(state.t);
    cam.tx += (p.x - cam.tx) * k * 0.9; cam.tz += (p.z - cam.tz) * k * 0.9;
    const yaw = 0.6 + (reduce ? 0 : (now - time0) / 1000 * 0.035) + state.mx * 0.7;
    setupCam(yaw, state.pitch, state.mode3d ? 95 : 140);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = rgb(pal.bg); ctx.fillRect(0, 0, W, H);

    const near = (x, z) => Math.hypot(x - cam.tx, z - cam.tz) < 120;
    for (const b of blocks) if (near(b[0], b[1])) quad(b[0], b[1], b[2], pal.ground, pal);
    for (const b of parks) if (near(b[0], b[1])) quad(b[0] + 0.6, b[1] + 0.6, b[2] - 1.2, pal.park, pal, 0.02);

    // trasa pod budynkami
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    drawRouteLine(0, 1, pal.rest, 3);
    drawRouteLine(0, state.t, 'rgba(79,107,255,0.25)', 12);
    drawRouteLine(0, state.t, '#4f6bff', 4);

    // budynki: od najdalszego
    const vis = [];
    for (const l of lots) { const d = Math.hypot(l.cx - cam.tx, l.cz - cam.tz); if (d < 115) { l.cd = (l.cx - cam.x) ** 2 + (l.cz - cam.z) ** 2; l.fd = d; vis.push(l); } }
    vis.sort((a, b) => b.cd - a.cd);
    const c = [];
    for (const l of vis) {
      const h = l.h, x0 = l.x, x1 = l.x + l.w, z0 = l.z, z1 = l.z + l.d;
      const corners = [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]];
      let ok = true;
      for (let i = 0; i < 8; i++) { const q = proj(...corners[i]); if (!q) { ok = false; break; } c[i * 2] = q[0]; c[i * 2 + 1] = q[1]; }
      if (!ok) continue;
      const fg = fog(l.fd);
      const sa = rgb(mixc(pal.sa, pal.bg, fg)), sb = rgb(mixc(pal.sb, pal.bg, fg));
      if (cam.z < z0) poly([c[0], c[1], c[2], c[3], c[10], c[11], c[8], c[9]], sb);
      if (cam.z > z1) poly([c[4], c[5], c[6], c[7], c[14], c[15], c[12], c[13]], sb);
      if (cam.x < x0) poly([c[6], c[7], c[0], c[1], c[8], c[9], c[14], c[15]], sa);
      if (cam.x > x1) poly([c[2], c[3], c[4], c[5], c[12], c[13], c[10], c[11]], sa);
      poly([c[8], c[9], c[10], c[11], c[12], c[13], c[14], c[15]], rgb(mixc(pal.top, pal.bg, fg)));
      if (fg < 0.6 && h > 8) { ctx.strokeStyle = pal.edge; ctx.lineWidth = 1; ctx.stroke(); }
    }

    pin(route[0], 'START', '#ffffff', pal);
    pin(route[route.length - 1], 'META', '#ff9a3c', pal);

    // biegacz
    const q = proj(p.x, 0.3, p.z);
    if (q) {
      const pulse = (now / 1400) % 1;
      ctx.beginPath(); ctx.arc(q[0], q[1], 8 + pulse * 22, 0, 7); ctx.strokeStyle = `rgba(79,107,255,${0.6 * (1 - pulse)})`; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(q[0], q[1], 7.5, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(q[0], q[1], 4.5, 0, 7); ctx.fillStyle = '#4f6bff'; ctx.fill();
    }
    drawMini(p);
    updateHud(p);
  }

  // --- mini-mapa
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (const [x, z] of route) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
  function drawMini(p) {
    const w = mini.width, h = mini.height; if (!w) return;
    const pad = 16 * DPR, s = Math.min((w - pad * 2) / (bx1 - bx0), (h - pad * 2) / (bz1 - bz0));
    const ox = (w - (bx1 - bx0) * s) / 2, oz = (h - (bz1 - bz0) * s) / 2;
    const m = (x, z) => [ox + (x - bx0) * s, oz + (z - bz0) * s];
    mctx.clearRect(0, 0, w, h); mctx.lineJoin = 'round'; mctx.lineCap = 'round';
    const path = (t1) => { mctx.beginPath(); let i = 0; mctx.moveTo(...m(...route[0])); for (i = 1; i < route.length && cum[i] <= t1 * LEN; i++) mctx.lineTo(...m(...route[i])); if (t1 < 1) mctx.lineTo(...m(p.x, p.z)); };
    path(1); mctx.strokeStyle = 'rgba(255,255,255,0.35)'; mctx.lineWidth = 1.5 * DPR; mctx.stroke();
    path(state.t); mctx.strokeStyle = '#4f6bff'; mctx.lineWidth = 2.5 * DPR; mctx.stroke();
    const [x, y] = m(p.x, p.z);
    mctx.beginPath(); mctx.arc(x, y, 4.5 * DPR, 0, 7); mctx.fillStyle = '#fff'; mctx.fill();
    mctx.beginPath(); mctx.arc(x, y, 2.8 * DPR, 0, 7); mctx.fillStyle = '#4f6bff'; mctx.fill();
  }

  // --- HUD i oś czasu
  const fmt = (s) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`;
  let lastSeg = -1;
  function updateHud(p) {
    const t = state.t, f = Math.round(t * FRAMES);
    $('km').textContent = (t * KM).toFixed(1);
    $('frame').textContent = f;
    $('head').style.left = t * 100 + '%';
    const sec = f / FPS;
    $('time').textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
    $('pace').textContent = fmt(t * RACE_S);
    $('ecur').textContent = Math.round(elevAt(t));
    $('eclip').setAttribute('width', t * 400);
    $('ebar').setAttribute('x1', t * 400); $('ebar').setAttribute('x2', t * 400);
    if (p.seg !== lastSeg) { lastSeg = p.seg; $('street').textContent = STREETS[p.seg % STREETS.length]; }
  }

  const win = $('win'), track = $('track');
  let dragging = false;
  const scrub = (e) => { const r = track.getBoundingClientRect(); state.t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); scrub(e); });
  track.addEventListener('pointermove', (e) => dragging && scrub(e));
  track.addEventListener('pointerup', () => { dragging = false; });
  const setPlaying = (v) => { state.playing = v; win.classList.toggle('paused', !v); };
  setPlaying(state.playing);
  $('play').addEventListener('click', () => setPlaying(!state.playing));

  for (const seg of document.querySelectorAll('.seg')) {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      state[seg.dataset.k] = +b.dataset.v;
      for (const x of seg.children) x.classList.toggle('on', x === b);
    });
  }

  // --- okno: przechył za kursorem, prostuje się przy przewijaniu
  const hero = document.querySelector('.hero');
  hero.addEventListener('pointermove', (e) => {
    const nx = e.clientX / innerWidth - 0.5, ny = e.clientY / innerHeight - 0.5;
    state.mx = nx; state.my = ny;
    if (!reduce) { win.style.setProperty('--ry', nx * 6 + 'deg'); win.style.setProperty('--rx', -ny * 4 + 'deg'); }
  });
  hero.addEventListener('pointerleave', () => { win.style.setProperty('--ry', '0deg'); win.style.setProperty('--rx', '0deg'); });
  const lift = () => win.style.setProperty('--lift', reduce ? 0 : Math.max(0, 1 - scrollY / 380));
  addEventListener('scroll', lift, { passive: true }); lift();

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(cv);
  requestAnimationFrame(frame);

  // --- karty: poświata za kursorem
  for (const c of document.querySelectorAll('.card')) {
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      c.style.setProperty('--x', e.clientX - r.left + 'px'); c.style.setProperty('--y', e.clientY - r.top + 'px');
    });
  }

  // --- dema: klik ładuje player w miejscu plakatu; bez adresu tylko "wkrótce"
  for (const d of document.querySelectorAll('.demo[data-src]')) {
    d.querySelector('.play').addEventListener('click', () => {
      if (!d.dataset.src) { d.classList.add('soon'); return; }
      const f = document.createElement('iframe');
      f.src = d.dataset.src; f.allow = 'fullscreen; autoplay'; f.title = d.querySelector('.t').textContent;
      d.querySelector('.demo-poster').replaceWith(f);
    });
  }
})();
