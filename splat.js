// Trasy Studio: demo gaussian splatting (sekcja #splaty). Jeden blok Krakowa (Rynek Główny, splat/rynek.spz).
// three (WebGPU, zapasowo WebGL2) + gaussian-splat-lite z katalogu vendor/ (mapa importów w index.html), bez budowania.
// Ładowane przez app.js dopiero, gdy sekcja zbliża się do ekranu.
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { GaussianSplatRenderer, SplatMesh, SplatEdit, SplatEditSdf, SplatEditSdfType, SplatEditRgbaBlendMode } from 'gaussian-splat-lite';

const root = document.getElementById('splat');
const view = root.querySelector('.splat-view');
const labelsEl = root.querySelector('.splat-labels');
const loadEl = root.querySelector('.splat-load');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const rad = (d) => (d * Math.PI) / 180;

// Budynki: punkt etykiety (szczyt), bryła podświetlenia (środek, połowy wymiarów, obrót wokół pionu) i ujęcie kamery.
// Układ: x wschód, y góra, z południe, metry; środek bloku = (0, 0).
const PLACES = [
  { id: 'sukiennice', name: 'Sukiennice', at: [-48, 33, -16], box: { c: [-48, 21, -16], half: [19, 15, 56], rot: rad(-27.7) }, cam: { az: rad(-72), el: rad(24), r: 215 } },
  { id: 'mariacki', name: 'Kościół Mariacki', at: [69, 90, -18], box: { c: [108, 49, -9], half: [43, 43, 21], rot: rad(-2) }, cam: { az: rad(-100), el: rad(17), r: 235 } },
  { id: 'ratusz', name: 'Wieża Ratuszowa', at: [-115, 69, 10], box: { c: [-115, 38, 10], half: [8, 33, 8], rot: rad(-27.7) }, cam: { az: rad(-38), el: rad(18), r: 190 } },
];
// Ujęcia ogólne (przyciski): cel, azymut (0 = kamera od południa), kąt nad horyzontem, odległość
const VIEWS = {
  plac: { t: [-15, 14, -8], az: rad(-36), el: rad(31), r: 340 },
  gora: { t: [0, 10, 0], az: 0, el: rad(88), r: 500 },
  nisko: { t: [-35, 24, -10], az: rad(24), el: rad(13), r: 195 },
};
const LIMIT = { rMin: 70, rMax: 520, elMin: rad(7), elMax: rad(88) };

let renderer;
try {
  renderer = new WebGPURenderer({ antialias: false, alpha: false });
  await renderer.init();
} catch (e) {
  loadEl.textContent = 'Ta przeglądarka nie obsługuje WebGPU ani WebGL2.';
  throw e;
}
const backend = renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setClearColor(0x0b0d12);
const canvas = renderer.domElement;
view.prepend(canvas);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 1, 3000);
const splats = new GaussianSplatRenderer({ renderer, sortRadial: true });
scene.add(splats);

// ---- kamera: orbita wokół celu; wartości bieżące gonią docelowe (płynne przejścia między ujęciami)
const goal = { t: new THREE.Vector3(...VIEWS.plac.t), az: VIEWS.plac.az, el: VIEWS.plac.el, r: VIEWS.plac.r };
const cur = { t: goal.t.clone(), az: goal.az + 0.5, el: goal.el + 0.25, r: goal.r * 1.25 };
let auto = !reduce; // powolny obrót do pierwszego dotknięcia
function flyTo(v, t) {
  goal.t.set(...t); goal.r = v.r; goal.el = v.el;
  goal.az = cur.az + Math.atan2(Math.sin(v.az - cur.az), Math.cos(v.az - cur.az)); // najkrótszą drogą
}
function applyCamera(dt) {
  const k = reduce ? 1 : 1 - Math.exp(-dt * 3.2);
  if (auto) goal.az += dt * 0.06;
  cur.t.lerp(goal.t, k); cur.az += (goal.az - cur.az) * k; cur.el += (goal.el - cur.el) * k; cur.r += (goal.r - cur.r) * k;
  const c = Math.cos(cur.el);
  camera.position.set(cur.t.x + Math.sin(cur.az) * c * cur.r, cur.t.y + Math.sin(cur.el) * cur.r, cur.t.z + Math.cos(cur.az) * c * cur.r);
  camera.lookAt(cur.t);
}
const clampGoal = () => { goal.r = Math.min(LIMIT.rMax, Math.max(LIMIT.rMin, goal.r)); goal.el = Math.min(LIMIT.elMax, Math.max(LIMIT.elMin, goal.el)); };

// wskaźnik w oknie splatu steruje kamerą: przeciągnięcie obraca, kółko i dwa palce przybliżają; strona przewija się poza oknem
const ptr = new Map(); let pinch = 0;
canvas.addEventListener('pointerdown', (e) => { ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture(e.pointerId); pinch = 0; auto = false; root.classList.add('touched'); });
canvas.addEventListener('pointermove', (e) => {
  const p = ptr.get(e.pointerId); if (!p) return;
  if (ptr.size === 1) { goal.az -= (e.clientX - p.x) * 0.006; goal.el += (e.clientY - p.y) * 0.005; }
  p.x = e.clientX; p.y = e.clientY;
  if (ptr.size === 2) { const [a, b] = [...ptr.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) goal.r *= pinch / d; pinch = d; }
  clampGoal();
});
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, (e) => { ptr.delete(e.pointerId); pinch = 0; });
view.addEventListener('wheel', (e) => { e.preventDefault(); auto = false; root.classList.add('touched'); goal.r *= Math.exp(e.deltaY * (e.ctrlKey ? 0.004 : 0.0012)); clampGoal(); }, { passive: false });

// ---- podświetlenie budynku: reszta sceny bez zmian, bryła dostaje ciepły, pulsujący blask, a od dołu do góry
// przechodzi jasna fala. Bryły to pola SDF biblioteki (SplatEdit), plamki nie są zmieniane na stałe.
const glow = new SplatEdit({ rgbaBlendMode: SplatEditRgbaBlendMode.ADD_RGBA, softEdge: 4 });
const glowBox = new SplatEditSdf({ type: SplatEditSdfType.BOX, color: new THREE.Color(0, 0, 0) });
glow.add(glowBox);
const wave = new SplatEdit({ rgbaBlendMode: SplatEditRgbaBlendMode.ADD_RGBA, softEdge: 5 });
const waveBox = new SplatEditSdf({ type: SplatEditSdfType.BOX, color: new THREE.Color(0, 0, 0) });
wave.add(waveBox);
// miękka krawędź bloku: plamki przy granicy wycięcia zanikają
const edge = new SplatEdit({ rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY_RGBA, softEdge: 14, invert: true });
const edgeBox = new SplatEditSdf({ type: SplatEditSdfType.BOX, opacity: 0 }); edgeBox.scale.set(170, 400, 170); edge.add(edgeBox);
const hl = { place: null, k: 0, on: false, t0: 0 };
function setBox(p) {
  const b = p.box;
  for (const s of [glowBox]) { s.position.set(...b.c); s.scale.set(...b.half); s.rotation.y = b.rot; }
  waveBox.scale.set(b.half[0] + 2, 3, b.half[2] + 2); waveBox.rotation.y = b.rot;
}
function highlight(p, now) {
  for (const el of labelsEl.children) el.classList.toggle('on', el.dataset.id === p?.id);
  hl.on = !!p; if (!p) return;
  hl.place = p; hl.t0 = now; setBox(p);
}
function applyHighlight(now, dt) {
  hl.k += ((hl.on ? 1 : 0) - hl.k) * (reduce ? 1 : 1 - Math.exp(-dt * 4));
  const k = hl.k, p = hl.place; if (!p) return;
  const s = (now - hl.t0) / 1000;
  const pulse = reduce ? 0.6 : 0.5 + 0.5 * Math.sin(s * 2.4 - 1.2);
  glowBox.color.setRGB(0.36, 0.22, 0.07).multiplyScalar(k * (0.55 + 0.45 * pulse));
  // fala: 1,6 s w górę, potem przerwa; okres 3,2 s
  const u = reduce ? 2 : (s % 3.2) / 1.6, b = p.box;
  waveBox.position.set(b.c[0], b.c[1] - b.half[1] + Math.min(1, u) * b.half[1] * 2, b.c[2]);
  waveBox.color.setRGB(0.75, 0.8, 1).multiplyScalar(u < 1 ? k * Math.sin(u * Math.PI) : 0);
}

// ---- etykiety: przyciski HTML przypięte do punktów w scenie
const v3 = new THREE.Vector3();
for (const p of PLACES) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'splat-label'; b.dataset.id = p.id; b.innerHTML = `<span>${p.name}</span><i></i>`;
  b.addEventListener('click', () => { auto = false; setView(null); flyTo(p.cam, [p.box.c[0], p.box.c[1], p.box.c[2]]); highlight(p, performance.now()); });
  labelsEl.append(b); p.el = b;
}
function placeLabels(w, h) {
  for (const p of PLACES) {
    v3.set(...p.at).project(camera);
    const ok = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1;
    p.el.style.visibility = ok ? '' : 'hidden';
    if (ok) p.el.style.transform = `translate(${((v3.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v3.y) / 2 * h).toFixed(1)}px)`;
  }
}

// ---- przyciski ujęć
const viewsEl = root.querySelector('.splat-views');
function setView(id) { for (const b of viewsEl.children) b.classList.toggle('on', b.dataset.view === id); }
viewsEl.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  auto = false; setView(b.dataset.view); const v = VIEWS[b.dataset.view]; flyTo(v, v.t); highlight(null);
});

// ---- dane
const mesh = new SplatMesh({ url: root.dataset.src, maxSh: 0,
  onProgress: (e) => { if (e.stage === 'download' && e.lengthComputable) loadEl.textContent = `Wczytywanie ${Math.round((e.loaded / e.total) * 100)}%`; } });
mesh.recolor.setScalar(0.84); // przyciemnienie: plamki z treningu są dość jasne
mesh.add(edge, glow, wave);
scene.add(mesh);

// ---- pętla: rysuje tylko, gdy sekcja jest na ekranie
let visible = true, last = performance.now(), W = 0, H = 0;
new IntersectionObserver(([e]) => { visible = e.isIntersecting; last = performance.now(); }).observe(view);
renderer.setAnimationLoop((now) => {
  if (!visible || document.hidden) return;
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const w = view.clientWidth, h = view.clientHeight;
  if (w !== W || h !== H) { W = w; H = h; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 58 : 42; camera.updateProjectionMatrix(); }
  applyCamera(dt); applyHighlight(now, dt);
  renderer.render(scene, camera);
  placeLabels(w, h);
});

mesh.initialized.then(() => {
  root.classList.add('ready');
  root.querySelector('.splat-info').textContent = `${Math.round(mesh.numSplats / 1000)} tys. plamek · ${backend}`;
  highlight(PLACES[0], performance.now());
}, (e) => { loadEl.textContent = 'Nie udało się wczytać sceny.'; console.warn('splat:', e?.message ?? e); });

if (new URLSearchParams(location.search).has('splatdev')) { // strojenie ujęć i brył: ?splatdev
  const ray = new THREE.Raycaster();
  window.__splat = { goal, cur, PLACES, VIEWS, mesh, camera, highlight, setBox, backend,
    stop() { auto = false; },
    ground(x, z) { ray.set(new THREE.Vector3(x, 500, z), new THREE.Vector3(0, -1, 0)); return ray.intersectObject(mesh, true)[0]?.point.y ?? null; } };
}
