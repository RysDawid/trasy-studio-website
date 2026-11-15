// Trasy Studio: podstrona splaty.html. 1 km² Starego Miasta w Krakowie jako gaussian splatting.
// Kolejność: mały plik punktów (od razu na ekranie), potem 64 kafle plamek pobierane od środka na zewnątrz. Punkty
// zamieniają się w plamki falą, która biegnie od Rynku tak daleko, jak sięgają już wczytane kafle; na końcu rusza przejazd kamery.
// three (WebGPU, zapasowo WebGL2) + gaussian-splat-lite z vendor/ (mapa importów w splaty.html), bez budowania.
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { GaussianSplatRenderer, SplatMesh, SplatEdit, SplatEditSdf, SplatEditSdfType, SplatEditRgbaBlendMode } from 'gaussian-splat-lite';

const $ = (id) => document.getElementById(id);
const stage = $('sp');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = matchMedia('(pointer: coarse)').matches;
const rad = (d) => (d * Math.PI) / 180;
const SRC = mobile ? stage.dataset.srcMobile : stage.dataset.src;
if (mobile || innerWidth < 680) document.querySelector('.sp-info').open = false;

// Układ: x wschód, y góra, z południe, metry; środek bloku (Rynek Główny) = (0, 0), blok ±500 m.
const HALF = 500, GROUND = 15;
const TONE = 0.84; // przyciemnienie: plamki z treningu są dość jasne
const LOOP = [[-250, 250], [-100, 60], [60, -40], [230, -180], [330, 40], [180, 230], [0, 300]]; // pętla przejazdu, 1,6 km
const SPEED = 24; // m/s
const START = { az: rad(-30), el: rad(40), r: 1050 }; // widok całego bloku podczas wczytywania
const RIDE = { el: rad(31), r: 330 }; // przejazd: kamera 280 m za punktem i 170 m nad nim
const LIMIT = { rMin: 120, rMax: 1500, elMin: rad(14), elMax: rad(86) };

let renderer;
try {
  renderer = new WebGPURenderer({ antialias: false, alpha: false });
  await renderer.init();
} catch (e) {
  $('spLoadT').textContent = 'Ta przeglądarka nie obsługuje WebGPU ani WebGL2.';
  throw e;
}
const backend = renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
$('spBackend').textContent = backend;
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setClearColor(0x0b0d12);
const canvas = renderer.domElement;
stage.prepend(canvas);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 2, 6000);
scene.add(new GaussianSplatRenderer({ renderer, sortRadial: true }));

// ---- kamera: orbita wokół punktu, który podczas przejazdu sunie po pętli; azymut liczony względem kierunku jazdy,
// więc przeciągnięcie to rozglądanie się, a kamera sama nadąża za zakrętami
const curve = new THREE.CatmullRomCurve3(LOOP.map(([x, z]) => new THREE.Vector3(x, GROUND, z)), true, 'centripetal');
const LENGTH = curve.getLength();
const goal = { t: new THREE.Vector3(0, GROUND, 0), az: START.az, el: START.el, r: START.r };
const cur = { t: goal.t.clone(), az: goal.az, el: goal.el, r: goal.r };
const ride = { on: false, wanted: !reduce, along: 0, yaw: 0, look: 0 }; // look: odchylenie od kierunku jazdy (rozglądanie)
const here = new THREE.Vector3(), tan = new THREE.Vector3();
let idle = true; // przed przejazdem: powolny obrót wokół całego bloku
function setRide(on) {
  ride.wanted = on; $('spPlay').classList.toggle('on', on);
  if (on && !ride.on) { // start: kamera ustawia się za punktem, z miejsca, w którym jest
    curve.getTangentAt(ride.along / LENGTH, tan); ride.yaw = Math.atan2(tan.x, tan.z); ride.look = 0;
    goal.el = RIDE.el; goal.r = RIDE.r; idle = false;
  }
  if (!on && ride.on) goal.az = ride.yaw + Math.PI + ride.look; // pauza: zwykła orbita wokół bieżącego punktu
  ride.on = on;
}
function applyCamera(dt) {
  if (ride.on) {
    ride.along = (ride.along + SPEED * dt) % LENGTH;
    const u = ride.along / LENGTH; curve.getPointAt(u, here); curve.getTangentAt(u, tan);
    const yaw = Math.atan2(tan.x, tan.z);
    ride.yaw += Math.atan2(Math.sin(yaw - ride.yaw), Math.cos(yaw - ride.yaw)) * (1 - Math.exp(-dt * 1.6));
    goal.t.copy(here);
    const az = ride.yaw + Math.PI + ride.look; // kamera za punktem
    goal.az = cur.az + Math.atan2(Math.sin(az - cur.az), Math.cos(az - cur.az));
  } else if (idle && !reduce) goal.az += dt * 0.05;
  const k = reduce ? 1 : 1 - Math.exp(-dt * 2.6);
  cur.t.lerp(goal.t, ride.on ? 1 - Math.exp(-dt * 6) : k);
  cur.az += (goal.az - cur.az) * k; cur.el += (goal.el - cur.el) * k; cur.r += (goal.r - cur.r) * k;
  const c = Math.cos(cur.el);
  camera.position.set(cur.t.x + Math.sin(cur.az) * c * cur.r, cur.t.y + Math.sin(cur.el) * cur.r, cur.t.z + Math.cos(cur.az) * c * cur.r);
  camera.lookAt(cur.t);
}
const clampGoal = () => { goal.r = Math.min(LIMIT.rMax, Math.max(LIMIT.rMin, goal.r)); goal.el = Math.min(LIMIT.elMax, Math.max(LIMIT.elMin, goal.el)); };
const touched = () => { stage.classList.add('touched'); if (!ride.on) idle = false; };

const ptr = new Map(); let pinch = 0;
canvas.addEventListener('pointerdown', (e) => { ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture(e.pointerId); pinch = 0; touched(); });
canvas.addEventListener('pointermove', (e) => {
  const p = ptr.get(e.pointerId); if (!p) return;
  if (ptr.size === 1) { const d = (e.clientX - p.x) * 0.005; if (ride.on) ride.look -= d; else goal.az -= d; goal.el += (e.clientY - p.y) * 0.004; }
  p.x = e.clientX; p.y = e.clientY;
  if (ptr.size === 2) { const [a, b] = [...ptr.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) goal.r *= pinch / d; pinch = d; }
  clampGoal();
});
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, (e) => { ptr.delete(e.pointerId); pinch = 0; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); touched(); goal.r *= Math.exp(e.deltaY * (e.ctrlKey ? 0.004 : 0.0012)); clampGoal(); }, { passive: false });
$('spPlay').addEventListener('click', () => setRide(!ride.wanted));
addEventListener('keydown', (e) => { if (e.code === 'Space' && !$('spPlay').disabled) { e.preventDefault(); setRide(!ride.wanted); } });

// ---- pola SDF biblioteki (SplatEdit): miękka krawędź bloku oraz odsłanianie. Kula o rosnącym promieniu R wokół środka:
// punkty widać tylko poza nią, plamki tylko w niej; tuż przed i tuż za frontem jasna obwódka.
const MUL = SplatEditRgbaBlendMode.MULTIPLY_RGBA, ADD = SplatEditRgbaBlendMode.ADD_RGBA;
const center = new THREE.Vector3(0, GROUND, 0);
function sphereEdit(mode, softEdge, invert, props) {
  const edit = new SplatEdit({ rgbaBlendMode: mode, softEdge, invert });
  const sdf = new SplatEditSdf({ type: SplatEditSdfType.SPHERE, radius: 1, ...props }); sdf.position.copy(center); edit.add(sdf);
  return { edit, sdf };
}
function edgeEdit() {
  const edit = new SplatEdit({ rgbaBlendMode: MUL, softEdge: 30, invert: true });
  const sdf = new SplatEditSdf({ type: SplatEditSdfType.BOX, opacity: 0 }); sdf.scale.set(HALF - 8, 2000, HALF - 8); edit.add(sdf);
  return edit;
}
const pHide = sphereEdit(MUL, 45, false, { opacity: 0 }); // punkty: znikają w kuli
const pGlow = sphereEdit(ADD, 70, false, { color: new THREE.Color(0, 0, 0) }); // punkty: rozjaśnienie przed frontem
// punkty: fala pulsu biegnąca od frontu do krawędzi, dopóki trwa pobieranie. Pierścień = rozjaśnienie w kuli o promieniu P
// cofnięte w mniejszej kuli (P - szerokość)
const pPulse = sphereEdit(MUL, 55, false, { color: new THREE.Color(1, 1, 1) });
const pPulseIn = sphereEdit(MUL, 55, false, { color: new THREE.Color(1, 1, 1) });
const PULSE = { v: 420, width: 130, gap: 260 }; // m/s, m, przerwa między falami w m
const sHide = sphereEdit(MUL, 45, true, { opacity: 0 }); // plamki: niewidoczne poza kulą
const sGlow = sphereEdit(ADD, 60, true, { color: new THREE.Color(0, 0, 0) }); // plamki: rozjaśnienie tuż za frontem
// wspólne pola dla wszystkich kafli plamek, przekazywane przez listę edits. Pola nie są w scenie (tam działałyby na
// wszystko, także na punkty), więc macierze liczy im osobna grupa
const tileEdits = [edgeEdit(), sHide.edit, sGlow.edit];
const editHost = new THREE.Group(); editHost.add(...tileEdits);

// front fali: R goni zasięg wczytanych danych (reach), nie szybciej niż FRONT_V; po wczytaniu całości dobiega do R_END
const R_END = HALF * Math.SQRT2 + 120, FRONT_V = 170; // m, m/s
const front = { R: 1, reach: 1, glow: 0, done: false };
function setFront(R, glow) {
  pHide.sdf.radius = R; sHide.sdf.radius = R;
  pGlow.sdf.radius = R + 110; sGlow.sdf.radius = Math.max(1, R - 90);
  pGlow.sdf.color.setRGB(0.45, 0.55, 1).multiplyScalar(glow * 0.9);
  sGlow.sdf.color.setRGB(0.55, 0.4, 0.2).multiplyScalar(glow * 0.55);
}
function applyFront(now, dt) {
  if (front.done) return;
  front.R = reduce ? front.reach : Math.min(front.reach, front.R + FRONT_V * dt);
  // obwódka świeci, dopóki fala ma dokąd iść; gdy czeka na dane, lekko pulsuje
  const waiting = front.R >= front.reach && front.reach < R_END;
  const want = front.R >= R_END ? 0 : waiting ? 0.55 + 0.25 * Math.sin(now / 260) : 1;
  front.glow += (want - front.glow) * (1 - Math.exp(-dt * 5));
  setFront(front.R, front.glow);
  // puls: startuje na froncie, gaśnie przy krawędzi; gdy fala plamek dobiega końca, znika
  const span = Math.max(1, R_END - front.R), d = (now / 1000 * PULSE.v) % (span + PULSE.gap), u = Math.min(1, d / span);
  const amp = reduce || front.R >= R_END - 60 ? 0 : Math.sin(u * Math.PI) ** 0.6 * Math.min(1, span / 300);
  pPulse.sdf.radius = front.R + d; pPulseIn.sdf.radius = Math.max(1, front.R + d - PULSE.width);
  pPulse.sdf.color.setRGB(1 + 1.3 * amp, 1 + 1.6 * amp, 1 + 2.4 * amp);
  pPulseIn.sdf.color.setRGB(1 / (1 + 1.3 * amp), 1 / (1 + 1.6 * amp), 1 / (1 + 2.4 * amp));
  if (front.R >= R_END && front.glow < 0.02) { front.done = true; setFront(R_END, 0); points.visible = false; $('spReplay').disabled = false; }
}
$('spReplay').addEventListener('click', () => { front.R = 1; front.glow = 0; front.done = false; points.visible = true; $('spReplay').disabled = true; });

// ---- dane: punkty od razu, kafle plamek po kolei od środka (do 4 pobrań naraz)
const points = new SplatMesh({ url: stage.dataset.points, maxSh: 0, raycastable: false });
points.recolor.setScalar(TONE);
const pointEdits = [edgeEdit(), pPulse.edit, pPulseIn.edit, pHide.edit, pGlow.edit]; editHost.add(...pointEdits); editHost.updateMatrixWorld(true); points.edits = pointEdits;
scene.add(points);
const load = { tiles: [], next: 0, active: 0, n: 0, bytes: 0, total: 0, totalN: 0, failed: false };
const mln = (v) => (v / 1e6).toFixed(1).replace('.', ',');
function tileDone(t) {
  t.ready = true; load.n += t.n; load.bytes += t.b; load.active--;
  // zasięg = odległość od środka do najbliższego jeszcze niewczytanego kafla (do jego bliższej krawędzi)
  let reach = R_END;
  for (const q of load.tiles) if (!q.ready) reach = Math.min(reach, Math.hypot(Math.max(0, Math.abs(q.c[0]) - load.half), Math.max(0, Math.abs(q.c[1]) - load.half)));
  front.reach = Math.max(1, reach);
  $('spN').textContent = load.n < load.totalN ? `${mln(load.n)} z ${mln(load.totalN)} mln` : `${mln(load.n)} mln`;
  $('spBar').style.width = `${((load.bytes / load.total) * 100).toFixed(1)}%`;
  $('spLoadT').textContent = `Plamki: ${(load.bytes / 1048576).toFixed(0)} z ${(load.total / 1048576).toFixed(0)} MB`;
  if (load.n >= load.totalN) allLoaded(); else pump();
}
function pump() {
  while (load.active < 4 && load.next < load.tiles.length) {
    const t = load.tiles[load.next++]; load.active++;
    const mesh = new SplatMesh({ url: new URL(t.f, load.base).href, maxSh: 0, raycastable: false });
    mesh.recolor.setScalar(TONE); mesh.edits = tileEdits; scene.add(mesh);
    mesh.initialized.then(() => tileDone(t), fail);
  }
}
function allLoaded() {
  stage.classList.add('ready');
  // przejazd rusza, gdy fala dochodzi do krawędzi bloku
  const wait = () => { if (front.R < HALF && !reduce) return setTimeout(wait, 200); if (ride.wanted && !ride.on) setRide(true); };
  wait();
}

// ---- pętla
let last = performance.now(), W = 0, H = 0, fpsT = 0, fpsN = 0;
renderer.setAnimationLoop((now) => {
  if (document.hidden) { last = now; return; }
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const w = stage.clientWidth, h = stage.clientHeight;
  if (w !== W || h !== H) { W = w; H = h; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 62 : 45; camera.updateProjectionMatrix(); }
  applyCamera(dt); applyFront(now, dt);
  renderer.render(scene, camera);
  fpsT += dt; fpsN++; if (fpsT > 0.5) { $('spFps').textContent = Math.round(fpsN / fpsT); fpsT = 0; fpsN = 0; }
});

function fail(e) { if (load.failed) return; load.failed = true; $('spLoadT').textContent = 'Nie udało się wczytać sceny.'; console.warn('splat:', e?.message ?? e); }
points.initialized.then(() => { stage.classList.add('points'); $('spPlay').disabled = false; if (!ride.wanted) $('spPlay').classList.remove('on'); }, fail);
try {
  const url = new URL(SRC, location.href); const man = await (await fetch(url)).json();
  load.tiles = man.tiles; load.base = url; load.half = man.size / 2;
  load.total = man.tiles.reduce((a, t) => a + t.b, 0); load.totalN = man.tiles.reduce((a, t) => a + t.n, 0);
  $('spMb').textContent = (load.total / 1048576).toFixed(1).replace('.', ','); $('spTiles').textContent = man.tiles.length;
  $('spLoadT').textContent = 'Wczytywanie plamek…';
  pump();
} catch (e) { fail(e); }

if (new URLSearchParams(location.search).has('splatdev')) window.__sp = { goal, cur, ride, front, load, points, backend, setRide };
