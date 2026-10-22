// ZeMA twin: browser "walk and discover" engine. Entry point.
// URL parameters: manifest=<url> (default web_data/manifest.json), quality=low|medium|high, lang=de|en,
//   autostart=1 (skip the start screen; no intro unless intro=1), intro=0|1, nolock=1 (never request pointer lock),
//   spawn=<station id>, debug=0..3, proj=0|1
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { wToGl, glToW, glDirToTexUv, panoPoseToGl, toMatrix3Elements, panoDirCam, matVec } from './coords.js';
import { setLang, getLang, t, pick, defaultLang } from './i18n.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Stations } from './stations.js';
import { Minimap } from './minimap.js';
import { ProjectiveTexturing, makePanoSphere, DEPTH_LAYER, PANO_UV_GLSL } from './projective.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// GPU memory: hall_lo = 4 pages of 2048^2 (~85 MB with mips), hall_hi = 11 pages of 4096^2 (~940 MB with mips).
// medium therefore stays on hall_lo (the projected tour photos give the detail near the tour spots); only high loads
// hall_hi. Touch / low-memory devices default to medium (review web-and-video F2).
const QUALITY = {
  low: { pixelRatio: 0.75, panos: 0, cube: 256, maxLod: 0 },
  medium: { pixelRatio: 1.0, panos: 2, cube: 256, maxLod: 0 },
  high: { pixelRatio: 2.0, panos: 4, cube: 512, maxLod: 99 },
};
const COARSE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
const LOW_MEM = !!(navigator.deviceMemory && navigator.deviceMemory <= 4);
const maxPixelRatio = (q) => Math.min(window.devicePixelRatio || 1, QUALITY[q].pixelRatio, COARSE ? 1.5 : 4);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const lerpAngle = (a, b, k) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };

// ------------------------------------------------------------------------------------------------ settings
const SETTINGS_KEY = 'zema_twin_settings_v1';
const settings = Object.assign({ lang: defaultLang(), quality: 'high', sensitivity: 1.0, fov: 70, invertY: false,
  proj: true, showFps: false, debug: 0 }, readJson(SETTINGS_KEY));
if (params.get('quality') && QUALITY[params.get('quality')]) settings.quality = params.get('quality');
else if (!settings.qualityChosen && (COARSE || LOW_MEM)) settings.quality = 'medium';
const DEBUG_KEYS = params.has('debug');   // free flight (F, no collision) only with ?debug=...
if (params.get('lang')) settings.lang = params.get('lang');
if (params.get('debug')) settings.debug = +params.get('debug');
if (params.get('proj')) settings.proj = params.get('proj') !== '0';
function readJson(k) { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (_) { return {}; } }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) { /* ignore */ } }
setLang(settings.lang);
if (COARSE) {
  document.body.classList.add('touch');
  document.querySelectorAll('.controls-hint').forEach((el) => { el.dataset.i18n = 'controls_touch'; el.textContent = t('controls_touch'); });
}

// ------------------------------------------------------------------------------------------------ renderer
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setPixelRatio(maxPixelRatio(settings.quality));
renderer.setSize(window.innerWidth, window.innerHeight, false);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2027);
const camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.05, 400);
camera.layers.enable(DEPTH_LAYER);
scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x404040, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(10, 30, 8);
scene.add(sun);

const ktx2 = new KTX2Loader().setTranscoderPath(new URL('../vendor/three/examples/jsm/libs/basis/', import.meta.url).href).detectSupport(renderer);
const gltfLoader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
const loaders = { gltf: gltfLoader, ktx2 };

const player = new Player({ eyeHeight: 1.6 });
const input = new Input(canvas, { sensitivity: settings.sensitivity });
input.invertY = settings.invertY;
input.allowLock = !params.has('nolock');
const minimap = new Minimap($('minimap'), $('bigmap-canvas'));
const proj = new ProjectiveTexturing(renderer, scene, { maxActive: QUALITY[settings.quality].panos, cubeSize: QUALITY[settings.quality].cube });
proj.pinned = new Set();
// two spheres so that panoramas can cross-fade into each other
const spheres = [makePanoSphere(), makePanoSphere()];
spheres.forEach((s, i) => { s.name = 'panoSphere' + i; s.userData.pano = null; scene.add(s); });
const depthOnlyMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });

const state = {
  manifest: null, baseUrl: null, hallRoot: new THREE.Group(), colliders: [], robot: null, robotW: null,
  stations: null, mode: 'walk', pano: null, sphere: null, savedPose: null, ready: false, started: false,
  fps: 0, fpsHistory: [], frame: 0, errors: [], hallLod: -1, timings: {}, camPos: new THREE.Vector3(),
  composite: 'off', userOpacity: 1, nav: null, overlaysHidden: false, intro: null, transitions: 0,
};
state.hallRoot.name = 'hall';
scene.add(state.hallRoot);
window.__twin = { state, THREE, scene, camera, renderer, player, proj, input, spheres };

// ------------------------------------------------------------------------------------------------ loading
const progress = { steps: {}, set(key, frac, label) { this.steps[key] = frac; this.render(label); },
  render(label) {
    const w = { manifest: 0.05, stations: 0.05, collider: 0.3, hall0: 0.6 };
    let s = 0; for (const k in w) s += w[k] * (this.steps[k] || 0);
    $('load-bar').style.width = `${Math.round(s * 100)}%`;
    if (label) $('load-text').textContent = `${t('loading')} ${label}`;
  } };

function loadGlb(url, key, label) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(url, (g) => { progress.set(key, 1, label); resolve(g); },
      (e) => { if (e.total) progress.set(key, e.loaded / e.total, label); }, reject);
  });
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

function boxToGlMatrix(b) {
  // remove box in W: {center_W, size_W, yaw_deg} -> GL world matrix of the unit cube [-1,1]^3
  const c = wToGl(b.center_W), s = b.size_W;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...c),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(b.yaw_deg || 0)),
    new THREE.Vector3(s[0] / 2, s[2] / 2, s[1] / 2));
  return m;
}

/** Walkable-floor grid (manifest.nav: PNG, white = walkable, row 0 = north) for teleport snapping. */
async function loadNav(nv, U) {
  const img = new Image();
  img.src = U(nv.image);
  await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const free = new Uint8Array(c.width * c.height);
  for (let i = 0; i < free.length; i++) free[i] = px[i * 4] > 127 ? 1 : 0;
  return { free, cols: c.width, rows: c.height, cell: nv.cell_m, x0: nv.bounds_W.min[0], y1: nv.bounds_W.max[1] };
}

/** Nearest walkable W point to (x, y) within maxM (null if none). */
function navSnap(x, y, maxM = 3) {
  const n = state.nav;
  if (!n) return [x, y];
  const r0 = Math.floor((n.y1 - y) / n.cell), c0 = Math.floor((x - n.x0) / n.cell);
  const k = Math.ceil(maxM / n.cell);
  let best = null, bd = Infinity;
  for (let r = Math.max(0, r0 - k); r <= Math.min(n.rows - 1, r0 + k); r++) {
    for (let c = Math.max(0, c0 - k); c <= Math.min(n.cols - 1, c0 + k); c++) {
      if (!n.free[r * n.cols + c]) continue;
      const d = (r - r0) * (r - r0) + (c - c0) * (c - c0);
      if (d < bd) { bd = d; best = [r, c]; }
    }
  }
  if (!best) return null;
  return [n.x0 + (best[1] + 0.5) * n.cell, n.y1 - (best[0] + 0.5) * n.cell];
}

async function load() {
  const t0 = performance.now();
  const manifestUrl = new URL(params.get('manifest') || 'web_data/manifest.json', location.href).href;
  const manifest = await fetchJson(manifestUrl);
  progress.set('manifest', 1, t('load_manifest'));
  state.manifest = manifest;
  state.baseUrl = manifestUrl;
  const U = (u) => new URL(u, manifestUrl).href;
  applyTitles();

  // stations
  const stUrl = manifest.stations && (manifest.stations.url || manifest.stations);
  const stData = stUrl ? await fetchJson(U(stUrl)).catch((e) => { console.warn(e); return { stations: [] }; }) : { stations: [] };
  state.stations = new Stations(scene, U(stUrl || './'), 'zema_twin_discovered:' + (manifest.id || manifestUrl));
  state.stations.set(stData);
  state.stations.onChange = updateCounter;
  state.stations.onDiscover = (s) => {
    const c = state.stations.count();
    toast(`★ ${t('discovered')}: ${pick(s.short) || pick(s.title)} (${c.found}/${c.total})`, 3200);
    if (c.found === c.total && c.total > 0) setTimeout(() => toast('★ ' + t('all_found'), 4000), 3300);
  };
  progress.set('stations', 1, t('load_stations'));
  fillFeatures();

  // collider first (walking needs it), then the coarsest hall LOD
  const hallList = (Array.isArray(manifest.hall) ? manifest.hall : [manifest.hall]).filter(Boolean)
    .map((h) => (typeof h === 'string' ? { url: h, lod: 0 } : h)).sort((a, b) => (a.lod || 0) - (b.lod || 0));
  const colliderUrls = [manifest.collider].flat().filter(Boolean).map((c) => (typeof c === 'string' ? c : c.url));
  const [colliders, hall0, nav] = await Promise.all([
    Promise.all(colliderUrls.map((u) => loadGlb(U(u), 'collider', t('load_collider')))),
    loadGlb(U(hallList[0].url), 'hall0', t('load_hall')),
    manifest.nav && manifest.nav.image ? loadNav(manifest.nav, U).catch((e) => { console.warn('nav', e); return null; }) : null,
  ]);
  state.nav = nav;
  for (const g of colliders) {
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundsTree();
      o.visible = false;
      state.colliders.push(o);
    });
  }
  state.timings.collider_tris = state.colliders.reduce((s, m) => s + (m.geometry.index ? m.geometry.index.count / 3 : 0), 0);
  setHall(hall0.scene, hallList[0].lod || 0);
  player.colliders = state.colliders;
  player.minY = (manifest.bounds_W ? manifest.bounds_W.min[2] : -1) - 6;
  player.onRespawn = () => toast(t('respawn'));

  // panoramas + projective texturing (sorted west -> east for the [ ] cycling order)
  const removes = (manifest.remove_W || []).map((b) => ({ ...b, inverseGl: boxToGlMatrix(b).invert() }));
  const resolve = (o) => (o && o.url ? { ...o, url: U(o.url) } : o);
  const panoList = (manifest.panos || []).map((p) => ({ ...p,
    pose_W: { ...(p.pose_W || p.pose), cam_convention: (p.pose_W || p.pose || {}).cam_convention || manifest.pano_cam_convention },
    equirect: resolve(p.equirect),
    equirect_lowres: resolve(p.equirect_lowres), depth: resolve(p.depth) }));
  panoList.sort((a, b) => a.pose_W.t_W[0] - b.pose_W.t_W[0]);
  proj.setPanos(panoList, removes);
  if (manifest.projection) {
    proj.camNear = manifest.projection.cam_near_m ?? proj.camNear;
    proj.camFar = manifest.projection.cam_far_m ?? proj.camFar;
  }
  proj.attach(state.hallRoot);
  proj.onTexture = (p) => { for (const s of spheres) if (s.userData.pano === p) bindSphere(s, p); };
  applyProjSettings();

  // minimap
  const bw = manifest.bounds_W || boundsOf(state.hallRoot);
  const mm = manifest.minimap || {};
  if (mm.image) await minimap.loadImage(U(mm.image), mm.bounds_W || { min: bw.min, max: bw.max });
  else {
    const wasProj = proj.enabled; proj.setEnabled(false);
    minimap.renderBackground(renderer, scene, { min: bw.min, max: bw.max }, (bw.min[2] || 0) + (mm.clip_height_m || 2.6), mm.px_per_m || 16,
      DEPTH_LAYER, (bw.min[2] || 0) - 0.5);
    proj.setEnabled(wasProj);
  }

  // spawn
  const sp = params.get('spawn') && state.stations.list.find((s) => s.id === params.get('spawn'));
  if (sp) teleportToStation(sp, false);
  else placeAtSpawn();
  // the intro pano (hub) is preloaded while the start screen is shown
  const intro = manifest.intro && proj.byId.get(manifest.intro.pano_id);
  if (intro) {
    proj.pinned.add(intro);
    proj.ensureTexture(intro, loaders);
    if (intro.src.equirect_lowres) { const bg = $('start-bg'); bg.style.backgroundImage = `url("${intro.src.equirect_lowres.url}")`; bg.classList.add('on'); }
  }
  state.timings.first_playable_ms = Math.round(performance.now() - t0);
  state.ready = true;
  $('load-text').textContent = t('ready') + (manifest.placeholder ? ` · ${t('placeholder')}` : '');
  $('start-btn').hidden = !intro;
  $('start-direct').hidden = false;
  if (!intro) $('start-direct').classList.add('primary');
  updateCounter();
  if (params.has('autostart')) start(params.get('intro') === '1');

  // progressive: higher LODs, robot
  const rest = [];
  const maxLod = QUALITY[settings.quality].maxLod;
  for (const h of hallList.slice(1)) {
    if ((h.lod || 0) > maxLod) continue;
    rest.push(loadGlb(U(h.url), 'hall' + h.lod, t('load_hall_hi')).then((g) => { setHall(g.scene, h.lod || 0); }));
  }
  if (manifest.robot && manifest.robot.url) rest.push(loadRobot(manifest.robot, U).catch((e) => console.warn('robot', e)));
  await Promise.all(rest);
  state.timings.all_loaded_ms = Math.round(performance.now() - t0);
  state.loadedAll = true;
}

function applyTitles() {
  const m = state.manifest;
  if (!m) return;
  document.title = pick(m.title) || document.title;
  $('app-title').textContent = pick(m.title) || t('app_title');
  if (m.subtitle) $('app-sub').textContent = pick(m.subtitle);
  $('credits').textContent = pick(m.credits) || '';
}

function fillFeatures() {
  const ul = $('features');
  ul.textContent = '';
  const n = state.stations ? state.stations.list.length : 0;
  const robot = state.stations && state.stations.list.find((s) => s.group === 'robot');
  for (const [k, cls] of [['feat_1', ''], ['feat_2', ''], ...(robot ? [['feat_3', 'violet']] : [])]) {
    const li = document.createElement('li'); li.textContent = t(k).replace('{t}', n); if (cls) li.className = cls; ul.appendChild(li);
  }
  document.querySelectorAll('.lang-switch [data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === getLang()));
}

/** Ground snap height: walkable targets (nav grid) are free up to 1.75 m, so only look 0.3 m up (a 2 m look-up
 *  would land the player on top of an overhang or table next to the target). */
function snapUp() { return state.nav ? 0.3 : 2.0; }

function placeAtSpawn() {
  const s = state.manifest.spawn || { position_W: [0, 0, 0], yaw_deg: 0 };
  player.setPose(new THREE.Vector3(...wToGl(s.position_W)), THREE.MathUtils.degToRad((s.heading_deg ?? s.yaw_deg ?? 0) - 90), -0.05);
  player.snapToGround(snapUp());
}

function boundsOf(obj) {
  const b = new THREE.Box3().setFromObject(obj);
  const mn = glToW([b.min.x, b.min.y, b.max.z]), mx = glToW([b.max.x, b.max.y, b.min.z]);
  return { min: [mn[0], mn[1], mn[2]], max: [mx[0], mx[1], mx[2]] };
}

function setHall(root, lod) {
  if (lod <= state.hallLod) return;
  // replace previous LOD
  for (const c of [...state.hallRoot.children]) {
    proj.detach(c);
    state.hallRoot.remove(c);
    c.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      // free the old LOD's textures too (hall_lo: ~85 MB of GPU memory)
      for (const m of new Set([o.userData.origMaterial, o.userData.projMaterial, o.material])) {
        if (!m) continue;
        if (m.map) m.map.dispose();
        m.dispose();
      }
    });
  }
  root.traverse((o) => { if (o.isMesh) { o.frustumCulled = true; } });
  state.hallRoot.add(root);
  state.hallLod = lod;
  state.hallTris = 0;
  root.traverse((o) => { if (o.isMesh && o.geometry.index) state.hallTris += o.geometry.index.count / 3; });
  if (state.ready) { proj.attach(root); proj.invalidateDepth(); applyComposite(state.composite); }
}

async function loadRobot(r, U) {
  const g = await loadGlb(U(r.url), 'robot', t('load_robot'));
  const root = new THREE.Group();
  root.name = 'robot';
  root.add(g.scene);
  const pose = r.pose_W || { t_W: [0, 0, 0], yaw_deg: 0 };
  root.position.set(...wToGl(pose.t_W));
  root.rotation.y = THREE.MathUtils.degToRad(pose.yaw_deg || 0);
  g.scene.traverse((o) => {
    if (o.isMesh && o.material) {
      // the G1 glb is lit (MeshStandard); give it the satin look
      if (o.material.isMeshStandardMaterial) { o.material.metalness = 0.55; o.material.roughness = 0.38; }
    }
  });
  scene.add(root);
  root.updateMatrixWorld(true);
  state.robot = root;
  const bb = new THREE.Box3().setFromObject(root);
  const c = bb.getCenter(new THREE.Vector3());
  state.robotW = glToW([c.x, c.y, c.z]);
  // simple box collider so that you cannot walk through the robot
  if (r.collide !== false) {
    const size = bb.getSize(new THREE.Vector3());
    const geo = new THREE.BoxGeometry(size.x * 0.8, size.y, size.z * 0.8);
    const m = new THREE.Mesh(geo);
    m.name = 'robot_collider';
    m.position.copy(c);
    m.updateMatrixWorld(true);
    geo.computeBoundsTree();
    state.colliders.push(m);
    state.robotCollider = m;
  }
  applyComposite(state.composite);
}

// ------------------------------------------------------------------------------------------------ UI
let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function updateCounter() {
  const c = state.stations.count();
  $('discovered').textContent = `${c.found} / ${c.total}`;
  if (!$('panel-stations').hidden) showStations();
}

function openPanel(id) {
  for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== id;
  if (id) { if (document.pointerLockElement) document.exitPointerLock(); input.keys.clear(); }
}
function closePanels() { for (const p of document.querySelectorAll('.panel')) p.hidden = true; $('bigmap').hidden = true; }
function anyPanelOpen() { return [...document.querySelectorAll('.panel')].some((p) => !p.hidden) || !$('bigmap').hidden; }

function openInfo(s) {
  if (!s) return;
  state.stations.fillCard(s, $('panel-info'));
  const pb = $('info-pano');
  const pano = s.pano_id && proj.byId.get(s.pano_id);
  pb.hidden = !pano;
  pb.onclick = () => { closePanels(); enterPano(s.pano_id); };
  state.infoStation = s;
  openPanel('panel-info');
}

function showStations() {
  state.stations.fillList($('station-list'), (s) => {
    closePanels();
    teleportToStation(s);
    // stations whose tour pano is not registered: there is little to see in 3D there, open the real photo directly
    // (viewing the panorama also discovers the entry). Review fidelity #9.
    const p = s.pano_id && proj.byId.get(s.pano_id);
    if (s.photo_only && p) enterPano(s.pano_id);
  }, $('progress'));
  openPanel('panel-stations');
}

function teleportToStation(s, announce = true) {
  if (state.mode === 'pano') exitPanoNow();
  const feet = state.stations.standPoint(s);
  const look = state.stations.lookAtPoint(s);
  const eye = feet.clone().add(new THREE.Vector3(0, player.eyeHeight, 0));
  const d = look.clone().sub(eye);
  player.setPose(feet, Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.hypot(d.x, d.z)) * 0.6);
  player.snapToGround(snapUp());
  state.stations.setFocus(s);
  if (announce) toast(pick(s.title));
}

function teleportToW(xW, yW) {
  if (state.mode === 'pano') exitPanoNow();
  const s = navSnap(xW, yW, 4);
  if (!s) { toast('–'); return false; }
  const p = new THREE.Vector3(...wToGl([s[0], s[1], 0]));
  player.setPose(p, player.yaw, player.pitch);
  player.snapToGround(snapUp(), 10);
  return true;
}

function fillHelp() {
  const rows = [['W A S D / ↑ ← ↓ →', 'k_move'], [t('key_mouse'), 'k_look'], ['Shift', 'k_run'], [t('key_space'), 'k_jump'],
    ['E', 'k_info'], ['M', 'k_map'], ['P', 'k_pano'], ['[ / ]', 'k_panocycle'], ['T', 'k_proj'],
    ...(DEBUG_KEYS ? [['F', 'k_fly']] : []), ['Tab', 'k_stations'], ['H', 'k_help'], ['Esc', 'k_esc']];
  const tb = $('help-table'); tb.textContent = '';
  for (const [k, d] of rows) {
    const tr = document.createElement('tr');
    const a = document.createElement('td'); a.textContent = k;
    const b = document.createElement('td'); b.textContent = t(d);
    tr.append(a, b); tb.appendChild(tr);
  }
}

function applyProjSettings() {
  const q = QUALITY[settings.quality];
  proj.maxActive = q.panos;
  if (proj.cubeSize !== q.cube) { proj.cubeSize = q.cube; proj.invalidateDepth(); }
  proj.setEnabled(settings.proj && q.panos > 0 && proj.panos.length > 0);
  proj.setDebug(settings.debug);
  proj._dirty = true;
  $('btn-proj').classList.toggle('on', proj.enabled);
  applyComposite(state.composite);
}

function setLanguage(l) {
  settings.lang = l; setLang(l); $('set-lang').value = l; fillHelp(); applyTitles(); fillFeatures(); saveSettings();
  if (state.stations) updateCounter();
}

function wireUi() {
  $('start-btn').addEventListener('click', () => start(true));
  $('start-direct').addEventListener('click', () => start(false));
  document.querySelectorAll('.lang-switch [data-lang]').forEach((b) => b.addEventListener('click', () => setLanguage(b.dataset.lang)));
  $('intro-skip').addEventListener('click', skipIntro);
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closePanels));
  $('btn-stations').addEventListener('click', showStations);
  $('discovered').addEventListener('click', showStations);
  $('btn-settings').addEventListener('click', () => openPanel('panel-settings'));
  $('btn-help').addEventListener('click', () => { fillHelp(); openPanel('panel-help'); });
  $('btn-map').addEventListener('click', toggleBigMap);
  $('btn-pano').addEventListener('click', () => (state.mode === 'pano' ? exitPano() : enterPano()));
  $('btn-proj').addEventListener('click', toggleProj);
  $('prompt').addEventListener('click', () => state.stations.near && openInfo(state.stations.near));
  $('pano-exit').addEventListener('click', () => exitPano());
  $('pano-prev').addEventListener('click', () => cyclePano(-1));
  $('pano-next').addEventListener('click', () => cyclePano(1));
  $('pano-opacity').addEventListener('input', (e) => setUserOpacity(+e.target.value));
  $('reset-progress').addEventListener('click', () => { state.stations.reset(); showStations(); });
  $('minimap').addEventListener('click', toggleBigMap);
  $('bigmap-canvas').addEventListener('click', (e) => {
    const w = minimap.pickW($('bigmap-canvas'), e, true);
    if (!w) return;
    // snap to a station if clicked near one
    let best = null, bd = 2.0;
    for (const s of state.stations.list) { const d = Math.hypot(s.position_W[0] - w[0], s.position_W[1] - w[1]); if (d < bd) { bd = d; best = s; } }
    $('bigmap').hidden = true;
    if (best) teleportToStation(best); else teleportToW(w[0], w[1]);
  });

  const sl = $('set-lang'), sq = $('set-quality'), ss = $('set-sens'), sf = $('set-fov'), si = $('set-invert'),
    sp = $('set-proj'), sfps = $('set-fps'), sd = $('set-debug');
  sl.value = settings.lang; sq.value = settings.quality; ss.value = settings.sensitivity; sf.value = settings.fov;
  si.checked = settings.invertY; sp.checked = settings.proj; sfps.checked = settings.showFps; sd.value = String(settings.debug);
  $('fps').hidden = !settings.showFps;
  sl.addEventListener('change', () => setLanguage(sl.value));
  sq.addEventListener('change', () => {
    settings.quality = sq.value; if (!autoQ.applying) settings.qualityChosen = true; saveSettings();
    renderer.setPixelRatio(maxPixelRatio(settings.quality));
    onResize(); applyProjSettings();
  });
  ss.addEventListener('input', () => { settings.sensitivity = +ss.value; input.sensitivity = settings.sensitivity; saveSettings(); });
  sf.addEventListener('input', () => { settings.fov = +sf.value; camera.fov = settings.fov; camera.updateProjectionMatrix(); saveSettings(); });
  si.addEventListener('change', () => { settings.invertY = si.checked; input.invertY = si.checked; saveSettings(); });
  sp.addEventListener('change', () => { settings.proj = sp.checked; applyProjSettings(); saveSettings(); });
  sfps.addEventListener('change', () => { settings.showFps = sfps.checked; $('fps').hidden = !sfps.checked; saveSettings(); });
  sd.addEventListener('change', () => { settings.debug = +sd.value; proj.setDebug(settings.debug); saveSettings(); });

  input.on('KeyM', () => { if (state.mode !== 'intro') toggleBigMap(); });
  input.on('KeyP', () => { if (state.mode === 'pano') exitPano(); else if (state.mode === 'walk') enterPano(); });
  input.on('KeyT', toggleProj);
  input.on('KeyH', () => { if (!$('panel-help').hidden) closePanels(); else { fillHelp(); openPanel('panel-help'); } });
  input.on('Tab', () => { if (!$('panel-stations').hidden) closePanels(); else showStations(); });
  input.on('KeyE', () => { if (state.stations.near && state.mode === 'walk') openInfo(state.stations.near); });
  if (DEBUG_KEYS) input.on('KeyF', () => { player.fly = !player.fly; toast(t(player.fly ? 'fly_on' : 'fly_off')); updateModePill(); });
  input.on('BracketLeft', () => cyclePano(-1));
  input.on('BracketRight', () => cyclePano(1));
  input.on('Escape', () => { if (state.mode === 'intro') skipIntro(); else if (anyPanelOpen()) closePanels(); else if (state.mode === 'pano') exitPano(); });
  input.on('Space', () => { if (state.mode === 'intro') skipIntro(); });
  canvas.addEventListener('click', () => { if (state.mode === 'intro') skipIntro(); else if (anyPanelOpen()) closePanels(); });
  window.addEventListener('resize', onResize);
}

function toggleProj() {
  settings.proj = !proj.enabled; $('set-proj').checked = settings.proj; saveSettings();
  applyProjSettings();
  toast(t(proj.enabled ? 'proj_on' : 'proj_off'));
}

function toggleBigMap() {
  const bm = $('bigmap');
  if (bm.hidden) { closePanels(); bm.hidden = false; if (document.pointerLockElement) document.exitPointerLock(); minimap.drawBig(mapState()); }
  else bm.hidden = true;
}

function updateModePill() {
  const el = $('mode-pill');
  const txt = state.mode === 'pano' ? t('mode_pano') : (player.fly ? t('mode_fly') : '');
  el.textContent = txt; el.hidden = !txt;
  document.body.classList.toggle('mode-pano', state.mode === 'pano');
}

// ------------------------------------------------------------------------------------------------ animations
// One camera animation at a time (pano transitions, intro). finishAnim() completes the running one at once.
const anim = { cur: null };
function runAnim(dur, update) {
  finishAnim();
  return new Promise((resolve) => {
    anim.cur = { t: 0, dur: Math.max(dur, 1e-3), update, resolve };
    update(0);
  });
}
function stepAnim(dt) {
  const a = anim.cur;
  if (!a) return;
  a.t += dt;
  const k = clamp01(a.t / a.dur);
  a.update(k);
  if (k >= 1 && anim.cur === a) { anim.cur = null; a.resolve(); }
}
function finishAnim() {
  const a = anim.cur;
  if (!a) return;
  anim.cur = null;
  a.update(1);
  a.resolve();
}
async function waitFor(cond, ms = 15000) {
  const t0 = performance.now();
  while (!cond() && performance.now() - t0 < ms) await new Promise((r) => setTimeout(r, 30));
  return cond();
}

// ------------------------------------------------------------------------------------------------ panorama mode
function panoOrder() { return proj.nearest(camera.position, proj.panos.length); }

function bindSphere(s, p) {
  const u = s.material.uniforms;
  s.userData.pano = p;
  u.center.value.copy(p.position); u.rot.value.copy(p.rot);
  u.gain.value.copy(p.gain);
  s.position.copy(p.position);
  if (p.tex) { u.tex.value = p.tex; u.flipV.value = p.flipV ? 1 : 0; }
  else u.tex.value = null;
}
function sphereOpacity(s, o) {
  s.material.uniforms.opacity.value = o;
  s.visible = o > 0.001 && !!s.material.uniforms.tex.value;
}

/** In which panorama (if any) is the camera, and how are photo and twin combined:
 *  'off'   walk mode: hall with projective texturing, no sphere
 *  'trans' / 'blend': spheres drawn transparently OVER the twin (cross-fades, opacity slider < 1)
 *  'full'  the photo is the background; the hall writes depth only, so the robot and markers are composited into the
 *          real photo with correct occlusion (camera exactly at the pano centre); photo-only panos hide the 3D. */
function applyComposite(mode) {
  state.composite = mode;
  const p = state.pano;
  const photoOnly = !!(p && p.src.photo_only);
  const full = mode === 'full';
  for (const s of spheres) {
    const m = s.material;
    m.transparent = !full || s !== state.sphere;
    m.depthTest = false; m.depthWrite = false;
    s.renderOrder = full && s === state.sphere ? -1000 : 1000;
    m.needsUpdate = true;
  }
  // hall: depth only in full mode, hidden for photo-only panos, else the normal (projective) materials
  proj.setEnabled(proj.enabled);
  if (full && !photoOnly) for (const o of proj.meshes) o.material = depthOnlyMat;
  state.hallRoot.visible = !(full && photoOnly);
  const show3d = !(full && photoOnly) && !state.overlaysHidden;
  if (state.robot) state.robot.visible = !(full && photoOnly) && !state.robotHidden;
  if (state.stations) state.stations.group.visible = show3d;
  $('pano-opacity-wrap').hidden = photoOnly;
  $('pano-note').hidden = !photoOnly;
  $('pano-note').textContent = photoOnly ? t('photo_only') : '';
}

function setUserOpacity(o) {
  state.userOpacity = o;
  $('pano-opacity').value = o;
  if (state.mode !== 'pano' || anim.cur) return;
  sphereOpacity(state.sphere, o);
  applyComposite(o >= 0.99 ? 'full' : 'blend');
}

/** Fly into a tour panorama (the nearest, or `id`) and cross-fade the photo in. */
async function enterPano(id) {
  if (!proj.panos.length) { toast(t('no_panos')); return; }
  if (state.mode === 'intro') return;
  const p = id ? proj.byId.get(id) : panoOrder()[0];
  if (!p) return;
  finishAnim();
  if (state.mode === 'exiting') finishExit();
  if (state.mode === 'walk') {
    state.savedPose = { feet: player.feet.clone(), yaw: player.yaw, pitch: player.pitch, fly: player.fly };
    state.camPos.copy(camera.position);
  }
  if (state.mode === 'pano' && state.pano === p) return;
  const prevS = state.mode === 'pano' ? state.sphere : null;
  const nextS = spheres.find((s) => s !== prevS);
  state.mode = 'pano'; state.pano = p; state.sphere = nextS;
  state.transitions++;
  proj.pinned = new Set([p, ...(prevS && prevS.userData.pano ? [prevS.userData.pano] : []),
    ...(state.manifest.intro ? [proj.byId.get(state.manifest.intro.pano_id)] : [])].filter(Boolean));
  $('pano-bar').hidden = false;
  $('pano-label').textContent = pick(p.label) || p.id;
  updateModePill();
  bindSphere(nextS, p);
  nextS.material.uniforms.gainMix.value = 0;
  sphereOpacity(nextS, 0);
  applyComposite('trans');
  proj.ensureTexture(p, loaders);
  const from = state.camPos.clone(), to = p.position.clone();
  const dist = from.distanceTo(to);
  const dur = dist < 0.05 ? 0.45 : THREE.MathUtils.clamp(0.55 + dist * 0.11, 0.7, 2.0);
  const prevO = prevS ? prevS.material.uniforms.opacity.value : 0;
  await runAnim(dur, (k) => {
    state.camPos.lerpVectors(from, to, easeInOut(k));
    if (prevS) sphereOpacity(prevS, prevO * (1 - smooth(0, 0.35, k)));
    sphereOpacity(nextS, smooth(0.55, 1, k) * (dist < 0.05 ? 1 : 1));
  });
  if (state.pano !== p) return;
  if (prevS) { sphereOpacity(prevS, 0); prevS.userData.pano = null; }
  if (!p.tex) {
    $('pano-label').textContent = t('loading_pano');
    await waitFor(() => p.tex || state.pano !== p, 20000);
    if (state.pano !== p) return;
    $('pano-label').textContent = pick(p.label) || p.id;
    bindSphere(nextS, p);
    await runAnim(0.35, (k) => sphereOpacity(nextS, k));
    if (state.pano !== p) return;
  }
  sphereOpacity(nextS, state.userOpacity);
  applyComposite(state.userOpacity >= 0.99 ? 'full' : 'blend');
  // viewing a station's real panorama counts as discovering it
  for (const s of state.stations.list) if (s.pano_id === p.id) state.stations.discover(s);
  // exposure "adaptation": from the projection's harmonised gain to the raw photo
  await runAnim(0.8, (k) => { nextS.material.uniforms.gainMix.value = smooth(0, 1, k); });
}

function cyclePano(step) {
  if (state.mode !== 'pano') return;
  const list = proj.panos;
  const i = list.indexOf(state.pano);
  enterPano(list[(i + step + list.length) % list.length].id);
}

/** Leave the panorama: fade the photo out and step down to the floor below the pano (snapped to walkable floor). */
async function exitPano() {
  if (state.mode !== 'pano') return;
  finishAnim();
  if (state.mode !== 'pano') return;
  const p = state.pano, s = state.sphere;
  state.mode = 'exiting';
  applyComposite('trans');
  s.material.uniforms.gainMix.value = 0;
  const o0 = s.material.uniforms.opacity.value;
  const w = glToW([p.position.x, p.position.y, p.position.z]);
  const xy = navSnap(w[0], w[1], 4) || (state.savedPose ? glToW([state.savedPose.feet.x, 0, state.savedPose.feet.z]) : w);
  const feet = new THREE.Vector3(...wToGl([xy[0], xy[1], 0]));
  player.setPose(feet, player.yaw, player.pitch);
  player.snapToGround(snapUp());
  const from = state.camPos.clone(), to = player.eye(new THREE.Vector3());
  await runAnim(0.6, (k) => {
    sphereOpacity(s, o0 * (1 - smooth(0, 0.6, k)));
    state.camPos.lerpVectors(from, to, easeInOut(k));
  });
  if (state.mode === 'exiting') finishExit();   // not superseded by a new enterPano / teleport
}
function exitPanoNow() { finishAnim(); if (state.mode === 'pano' || state.mode === 'exiting') finishExit(); }
function finishExit() {
  for (const s of spheres) { sphereOpacity(s, 0); s.userData.pano = null; }
  state.mode = 'walk'; state.pano = null; state.sphere = null;
  proj.pinned = new Set();
  applyComposite('off');
  $('pano-bar').hidden = true;
  updateModePill();
}

// ------------------------------------------------------------------------------------------------ intro
/** GL player yaw/pitch that look along pano yaw/pitch (degrees) of pano p. */
function panoView(p, yawDeg, pitchDeg = 0) {
  const d = matVec(p.R_GL_cam, panoDirCam(yawDeg, pitchDeg));
  return { yaw: Math.atan2(-d[0], -d[2]), pitch: Math.asin(THREE.MathUtils.clamp(d[1], -1, 1)) };
}

function caption(txt) { const c = $('intro-caption'); c.style.opacity = 0; setTimeout(() => { c.textContent = txt; c.style.opacity = 1; }, 150); }

async function playIntro() {
  const cfg = state.manifest.intro;
  const hub = cfg && proj.byId.get(cfg.pano_id);
  if (!hub) { endIntro(); return; }
  state.mode = 'intro';
  state.intro = { skipped: false, phase: 'load' };
  $('intro-bar').hidden = false;
  $('hud').hidden = true;
  caption(t('intro_1'));
  proj.pinned.add(hub);
  proj.ensureTexture(hub, loaders);
  await waitFor(() => hub.tex || state.intro.skipped, 15000);
  if (state.intro.skipped || !hub.tex) { endIntro(); return; }
  state.pano = hub; state.sphere = spheres[0];
  bindSphere(spheres[0], hub);
  spheres[0].material.uniforms.gainMix.value = 1;
  sphereOpacity(spheres[0], 1);
  state.camPos.copy(hub.position);
  applyComposite('full');
  const v0 = panoView(hub, cfg.start_yaw_deg ?? 0, -10);
  player.yaw = v0.yaw; player.pitch = v0.pitch;
  state.intro.phase = 'hold';
  await runAnim(cfg.hold_s ?? 3, (k) => { player.yaw = v0.yaw - 0.45 * easeInOut(k); });
  if (state.intro.skipped) { endIntro(); return; }
  state.intro.phase = 'fade';
  caption(t('intro_2'));
  applyComposite('trans');
  const g = spheres[0].material.uniforms.gainMix;
  const yawF = player.yaw;
  await runAnim(cfg.fade_s ?? 1.2, (k) => { sphereOpacity(spheres[0], 1 - smooth(0, 1, k)); g.value = 1 - k; player.yaw = yawF - 0.12 * k; });
  sphereOpacity(spheres[0], 0);
  state.pano = null; state.sphere = null;
  applyComposite('off');
  if (state.intro.skipped) { endIntro(); return; }
  state.intro.phase = 'fly';
  caption(t('intro_3'));
  const sp = state.manifest.spawn;
  const spawnFeet = new THREE.Vector3(...wToGl(sp.position_W));
  const spawnEye = spawnFeet.clone().add(new THREE.Vector3(0, player.eyeHeight, 0));
  const pts = [hub.position.clone(), ...(cfg.via_W || []).map((w) => new THREE.Vector3(...wToGl(w))), spawnEye];
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const y0 = player.yaw, p0 = player.pitch;
  const y1 = THREE.MathUtils.degToRad((sp.heading_deg ?? 0) - 90), p1 = -0.05;
  await runAnim(cfg.fly_s ?? 6, (k) => {
    const e = easeInOut(k);
    state.camPos.copy(curve.getPointAt(e));
    player.yaw = lerpAngle(y0, y1, smooth(0, 0.85, k));
    player.pitch = THREE.MathUtils.lerp(p0, p1, smooth(0, 0.9, k));
  });
  endIntro();
}

function skipIntro() {
  if (state.mode !== 'intro' || !state.intro) return;
  state.intro.skipped = true;
  finishAnim();
}

function endIntro() {
  finishAnim();
  for (const s of spheres) { sphereOpacity(s, 0); s.userData.pano = null; }
  state.pano = null; state.sphere = null;
  proj.pinned = new Set();
  applyComposite('off');
  placeAtSpawn();
  state.mode = 'walk';
  if (state.intro) state.intro.phase = 'done';
  $('intro-bar').hidden = true;
  $('hud').hidden = false;
  const c = state.stations.count();
  toast(t(COARSE ? 'welcome_touch' : 'welcome').replace('{t}', c.total), 5000);
  canvas.focus();
}

// ------------------------------------------------------------------------------------------------ main loop
function start(withIntro) {
  if (state.started) return;
  state.started = true;
  $('loading').hidden = true;
  if (!params.has('autostart') && input.allowLock && !input.isTouch) {
    try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* ignore */ }
  }
  if (withIntro && state.manifest.intro) { playIntro(); return; }
  $('hud').hidden = false;
  if (!params.has('autostart')) {
    const c = state.stations.count();
    toast(t(COARSE ? 'welcome_touch' : 'welcome').replace('{t}', c.total), 5000);
  }
  canvas.focus();
}

/**
 * Slow GPU: if walking runs below ~35 fps for 5 s in a row on "high", step down to "medium" once (2 instead of 4
 * projected panos, 256 cubes, pixel ratio 1). Only when the quality was not chosen explicitly (URL or settings).
 */
const autoQ = { slow: 0, done: params.has('quality') || !!settings.qualityChosen };
function autoQuality() {
  if (autoQ.done || state.mode !== 'walk' || !state.started || document.hidden) return;
  autoQ.slow = state.fps < 35 ? autoQ.slow + 1 : 0;
  if (autoQ.slow >= 5 && settings.quality === 'high') {
    autoQ.done = true;
    $('set-quality').value = 'medium'; settings.quality = 'medium';
    renderer.setPixelRatio(maxPixelRatio('medium'));
    onResize(); applyProjSettings();
    toast(`${t('quality')}: ${t('q_medium')} (auto)`);
  }
}

function mapState() {
  const dirW = glToW([-Math.sin(player.yaw), 0, -Math.cos(player.yaw)]);
  return {
    playerW: glToW([camera.position.x, camera.position.y, camera.position.z]),
    headingW: Math.atan2(dirW[1], dirW[0]),
    stations: state.stations.list, discovered: state.stations.discovered, near: state.stations.near,
    panos: proj.panos, activePano: state.pano, robotW: state.robotW, labelOf: (s) => pick(s.short) || pick(s.title),
  };
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}

const timer = new THREE.Timer();
let fpsFrames = 0, fpsT = 0;
state.simTime = 0;
function frame(timestamp) {
  timer.update(timestamp);
  const dtReal = timer.getDelta();
  const dt = Math.min(dtReal, 0.1);     // simulation step is clamped (slow frames slow the simulation down)
  state.frame++;
  state.simTime += dt;
  fpsFrames++; fpsT += dtReal;
  if (fpsT >= 1) {
    state.fps = fpsFrames / fpsT; state.fpsHistory.push(+state.fps.toFixed(2)); if (state.fpsHistory.length > 600) state.fpsHistory.shift();
    fpsFrames = 0; fpsT = 0;
    if (settings.showFps) $('fps').textContent = `${state.fps.toFixed(0)} fps`;
    autoQuality();
  }
  if (state.ready) {
    stepAnim(dt);
    input.enabled = state.started && !anyPanelOpen() && state.mode !== 'intro';
    const look = input.consumeLook();
    if (state.mode !== 'intro' && state.mode !== 'cam' && state.mode !== 'camM') player.applyLook(look.dx, look.dy);
    if (state.mode === 'walk') {
      if (state.steer) state.steer(dt);
      player.update(dt, state.steer ? state.steerMove : input.move());
      player.applyToCamera(camera);
    } else if (state.mode === 'camM') {
      camera.position.copy(state.camPos);
      camera.quaternion.copy(state.camQuat);
    } else {
      camera.position.copy(state.camPos);
      camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    }
    camera.updateMatrixWorld();
    const near = state.stations.update(dt, player.feet, state.mode === 'walk');
    const pr = $('prompt');
    if (near && state.mode === 'walk') { pr.hidden = false; pr.textContent = `${pick(near.short) || pick(near.title)} · ${t('press_e')}`; } else pr.hidden = true;
    proj.update(camera, loaders);
    if (state.frame % 2 === 0 || !$('bigmap').hidden) {
      const ms = mapState();
      minimap.draw(ms);
      if (!$('bigmap').hidden && state.frame % 10 === 0) minimap.drawBig(ms);
    }
  }
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------------------------------------ test hooks
Object.assign(window.__twin, {
  teleport(id) { const s = state.stations.list.find((x) => x.id === id); if (s) teleportToStation(s); return !!s; },
  teleportW: (x, y) => teleportToW(x, y),
  setView(yawDeg, pitchDeg = 0) { player.yaw = THREE.MathUtils.degToRad(yawDeg); player.pitch = THREE.MathUtils.degToRad(pitchDeg); },
  setFeetW(p) { player.setPose(new THREE.Vector3(...wToGl(p)), player.yaw, player.pitch); },
  /** Walk for `ms` of SIMULATION time (independent of the frame rate, e.g. software GL). */
  walk(ms, mv = { z: 1 }) {
    Object.assign(input.virtual, { x: 0, z: 0, run: false, up: 0 }, mv);
    return this.waitSim(ms).then(() => { Object.assign(input.virtual, { x: 0, z: 0, run: false, up: 0 }); });
  },
  waitSim(ms) {
    const until = state.simTime + ms / 1000;
    return new Promise((res) => { const chk = () => (state.simTime >= until ? res() : setTimeout(chk, 10)); chk(); });
  },
  /**
   * Walk along W waypoints [[x, y], ...] with the normal player physics, steering the view to the next waypoint
   * (simulation time). Returns how it went: reached, time, min/max feet z, respawns, stuck episodes, closest
   * approach to the goal.
   */
  walkPath(pts, { timeoutS = 120, tol = 0.45, run = false } = {}) {
    return new Promise((resolve) => {
      let i = 0, tAcc = 0, stuckT = 0, stuck = 0, lastPos = player.feet.clone(), lastCheck = 0;
      const r0 = player.respawns;
      let minZ = Infinity, maxZ = -Infinity;
      const goal = pts[pts.length - 1];
      let closest = Infinity;
      const track = [];
      state.steerMove = { x: 0, z: 1, run, up: 0 };
      state.steer = (dt) => {
        tAcc += dt;
        const f = glToW([player.feet.x, player.feet.y, player.feet.z]);
        minZ = Math.min(minZ, f[2]); maxZ = Math.max(maxZ, f[2]);
        closest = Math.min(closest, Math.hypot(f[0] - goal[0], f[1] - goal[1]));
        if (state.frame % 10 === 0) track.push([+f[0].toFixed(2), +f[1].toFixed(2), +f[2].toFixed(3)]);
        while (i < pts.length - 1 && Math.hypot(f[0] - pts[i][0], f[1] - pts[i][1]) < tol) i++;
        const tgt = pts[i];
        const dW = [tgt[0] - f[0], tgt[1] - f[1]];
        const dGl = wToGl([dW[0], dW[1], 0]);
        player.yaw = Math.atan2(-dGl[0], -dGl[2]); player.pitch = 0;
        if (tAcc - lastCheck > 1.0) {   // < 0.25 m progress per second while walking = stuck
          if (player.feet.distanceTo(lastPos) < 0.25) { stuckT += tAcc - lastCheck; stuck++; } else stuckT = 0;
          lastPos.copy(player.feet); lastCheck = tAcc;
        }
        const done = i === pts.length - 1 && Math.hypot(f[0] - tgt[0], f[1] - tgt[1]) < tol;
        if (done || tAcc > timeoutS || stuckT > 4) {
          state.steer = null;
          resolve({ reached: done, time_s: +tAcc.toFixed(2), waypoint: i, n_waypoints: pts.length, minZ, maxZ,
            respawns: player.respawns - r0, stuck_seconds: stuck, gave_up_stuck: stuckT > 4,
            closest_to_goal_m: +closest.toFixed(3), endW: f, track });
        }
      };
    });
  },
  feetW() { return glToW([player.feet.x, player.feet.y, player.feet.z]); },
  setProj(on) { settings.proj = on; applyProjSettings(); },
  setDebug(m) { settings.debug = m; proj.setDebug(m); },
  setPanoYawOffset(id, deg) {
    const p = proj.byId.get(id);
    const pose = { ...(p.src.pose_W || p.src.pose), yaw_offset_deg: deg };
    const g = panoPoseToGl(pose);
    p.rot.fromArray(toMatrix3Elements(g.R_cam_GL));
    proj.rebind();
  },
  /** Include / exclude one pano from the projection (leave-one-out checks). */
  setPanoProject(id, on) { const p = proj.byId.get(id); if (p) { p.project = on; proj._dirty = true; proj.lastSelectPos.set(1e9, 0, 0); } },
  setProjFade(near, far) { proj.camNear = near; proj.camFar = far; },
  /** Free camera from a W pose given as OpenCV camera-from-world (R row-major, t) and a vertical fov. */
  setCamCv(R, t, fovYDeg) {
    exitPanoNow();
    state.mode = 'camM';
    const Rt = [[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]];
    const C = [0, 1, 2].map((i) => -(Rt[i][0] * t[0] + Rt[i][1] * t[1] + Rt[i][2] * t[2]));
    // GL camera axes in W: x = cv x, y = -cv y, z = -cv z; then W -> GL
    const ax = (j, sgn) => wToGl([sgn * Rt[0][j], sgn * Rt[1][j], sgn * Rt[2][j]]);
    const X = ax(0, 1), Y = ax(1, -1), Z = ax(2, -1);
    const m = new THREE.Matrix4().set(X[0], Y[0], Z[0], 0, X[1], Y[1], Z[1], 0, X[2], Y[2], Z[2], 0, 0, 0, 0, 1);
    state.camPos.set(...wToGl(C));
    state.camQuat = new THREE.Quaternion().setFromRotationMatrix(m);
    camera.fov = fovYDeg; camera.updateProjectionMatrix();
    proj.lastSelectPos.set(1e9, 0, 0);
  },
  setPanoGain(id, g) { const p = proj.byId.get(id); if (p) { p.gain.set(...g); proj.rebind(); } },
  /** Free camera (no player physics) at a W eye position looking along pano yaw/pitch of pano `id` (or W yaw/pitch). */
  setCamPano(id, yawDeg, pitchDeg, fovDeg) {
    const p = proj.byId.get(id);
    exitPanoNow();
    state.mode = 'cam';
    state.camPos.copy(p.position);
    const v = panoView(p, yawDeg, pitchDeg);
    player.yaw = v.yaw; player.pitch = v.pitch;
    if (fovDeg) { camera.fov = fovDeg; camera.updateProjectionMatrix(); }
    proj.lastSelectPos.set(1e9, 0, 0);
    return { yaw: v.yaw, pitch: v.pitch, fov: camera.fov, aspect: camera.aspect };
  },
  setCamW(eyeW, yawGl, pitchGl, fovDeg) {
    exitPanoNow();
    state.mode = 'cam';
    state.camPos.set(...wToGl(eyeW));
    player.yaw = yawGl; player.pitch = pitchGl;
    if (fovDeg) { camera.fov = fovDeg; camera.updateProjectionMatrix(); }
    proj.lastSelectPos.set(1e9, 0, 0);
  },
  endCam() { if (state.mode === 'cam' || state.mode === 'camM') { state.mode = 'walk'; camera.fov = settings.fov; camera.updateProjectionMatrix(); } },
  overlays(on) { state.overlaysHidden = !on; state.robotHidden = !on; applyComposite(state.composite); },
  robotVisible(on) { state.robotHidden = !on; applyComposite(state.composite); },
  panoReady(id) { const p = id ? proj.byId.get(id) : null; return p ? !!p.tex && p.texLevel >= 1 : false; },
  activeReady() { return proj.active.every((p) => !p || (p.tex && p.texLevel >= 1 && (!p.src.depth || p.depth))); },
  ensurePano(id) { const p = proj.byId.get(id); proj.pinned.add(p); return proj.ensureTexture(p, loaders).then(() => p.texLevel); },
  hud(on) { $('hud').hidden = !on; },
  enterPano, exitPano, exitPanoNow, cyclePano, setUserOpacity, skipIntro, playIntro, navSnap,
  animating: () => !!anim.cur,
  openInfo: (id) => openInfo(state.stations.list.find((x) => x.id === id)), closePanels, showStations,
  discovered: () => [...state.stations.discovered], resetProgress: () => state.stations.reset(),
  toggleBigMap, setQuality(q) { $('set-quality').value = q; $('set-quality').dispatchEvent(new Event('change')); },
  info() {
    return { ready: state.ready, loadedAll: !!state.loadedAll, mode: state.mode, fps: state.fps, fpsHistory: state.fpsHistory,
      feetW: this.feetW(), onGround: player.onGround, hallLod: state.hallLod, hallTris: state.hallTris,
      colliders: state.colliders.length, stations: state.stations.count(), near: state.stations.near && state.stations.near.id,
      projEnabled: proj.enabled, activePanos: proj.active.map((p) => p && p.id), projStats: proj.stats, timings: state.timings,
      respawns: player.respawns, contextLost: state.contextLost || 0, gl: renderer.getContext().getParameter(renderer.getContext().VERSION),
      renderer: rendererName(), drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      composite: state.composite, pano: state.pano && state.pano.id, intro: state.intro && state.intro.phase,
      transitions: state.transitions, nav: !!state.nav };
  },
  selfTest,
  /** Synchronous render benchmark (no vsync cap): ms per frame at the current canvas size, GPU-synchronised. */
  bench(n = 60) {
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    camera.updateMatrixWorld();
    proj.update(camera, loaders);
    renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      camera.rotation.y += 0.01;
      camera.updateMatrixWorld();
      renderer.render(scene, camera);
      // submit per frame and sync every 10 frames: one huge command batch can trip the driver's GPU job timeout
      // (seen on the AMD iGPU: amdgpu "ring gfx timeout" -> WebGL context lost)
      gl.flush();
      if (i % 10 === 9) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = (performance.now() - t0) / n;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    return { ms_per_frame: +ms.toFixed(2), fps_equiv: +(1000 / ms).toFixed(1), width: size.x, height: size.y, proj: proj.enabled };
  },
});

function rendererName() {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER);
}

/**
 * GPU-side checks of the conventions: (1) the GLSL panoUv matches coords.js glDirToTexUv; (2) the runtime distance
 * cubemap, sampled with a world direction, matches a BVH raycast against the hall (and not its x-mirror).
 */
async function selfTest(nDirs = 48, id = null) {
  const p = id ? proj.byId.get(id) : (proj.active.find((x) => x) || proj.panos[0]);
  if (!p) return { error: 'no pano' };
  proj.loaders = proj.loaders || loaders;
  proj.ensureDepth(p);
  if (p.depthLoading) await p.depthLoading;
  if (!p.depth) proj.ensureDepth(p);
  if (!p.depth) return { error: 'no depth', pano: p.id };
  const dirs = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < nDirs; i++) {
    const yaw = rnd() * Math.PI * 2, pitch = (rnd() - 0.6) * 1.6;
    dirs.push(new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)));
  }
  const rt = new THREE.WebGLRenderTarget(nDirs, 1, { type: THREE.FloatType, depthBuffer: false });
  const mat = new THREE.ShaderMaterial({
    uniforms: { dirs: { value: dirs }, cube: { value: p.depth.texture }, rot: { value: p.rot } },
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform vec3 dirs[${nDirs}]; uniform samplerCube cube; uniform mat3 rot;
      ${PANO_UV_GLSL}
      void main(){ int i = int(gl_FragCoord.x); vec3 d = dirs[i];
        vec2 uv = panoUv(rot, d, 0.0);
        gl_FragColor = vec4(texture(cube, d).r, texture(cube, vec3(-d.x, d.y, d.z)).r, uv); }`,
    depthTest: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(quad);
  renderer.setRenderTarget(rt);
  renderer.render(sc, new THREE.Camera());
  const px = new Float32Array(nDirs * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, nDirs, 1, px);
  renderer.setRenderTarget(null);
  rt.dispose(); mat.dispose();
  // CPU references
  const hallMeshes = [];
  state.hallRoot.traverse((o) => { if (o.isMesh) { if (!o.geometry.boundsTree) o.geometry.computeBoundsTree(); hallMeshes.push(o); } });
  const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
  const errDirect = [], errMirror = [], errUv = [];
  for (let i = 0; i < nDirs; i++) {
    ray.set(p.position, dirs[i]); ray.far = 300;
    const h = ray.intersectObjects(hallMeshes, false)[0];
    const ref = h ? h.distance : 0;
    if (ref > 0.2 && px[i * 4] > 0) {
      errDirect.push(Math.abs(px[i * 4] - ref) / ref);
      errMirror.push(Math.abs(px[i * 4 + 1] - ref) / ref);
    }
    const R = [[p.rot.elements[0], p.rot.elements[3], p.rot.elements[6]], [p.rot.elements[1], p.rot.elements[4], p.rot.elements[7]],
      [p.rot.elements[2], p.rot.elements[5], p.rot.elements[8]]];
    const [u, v] = glDirToTexUv(R, [dirs[i].x, dirs[i].y, dirs[i].z]);
    let du = Math.abs(u - px[i * 4 + 2]); du = Math.min(du, 1 - du);
    errUv.push(Math.max(du, Math.abs(v - px[i * 4 + 3])));
  }
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  return { pano: p.id, n: nDirs, nDepthCompared: errDirect.length, depthRelErrMedian: med(errDirect), depthRelErrMedianMirrored: med(errMirror),
    depthWithin5pct: errDirect.filter((e) => e < 0.05).length, uvMaxErr: Math.max(...errUv), cubeSize: proj.cubeSize,
    depthSource: p.depthSource };
}

// ------------------------------------------------------------------------------------------------ boot
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); state.contextLost = (state.contextLost || 0) + 1; console.warn('WebGL context lost'); });
canvas.addEventListener('webglcontextrestored', () => { proj.invalidateDepth(); toast('WebGL restored'); });
window.addEventListener('error', (e) => state.errors.push(String(e.message || e)));
window.addEventListener('unhandledrejection', (e) => state.errors.push(String(e.reason && e.reason.message || e.reason)));
wireUi();
fillHelp();
renderer.setAnimationLoop(frame);
window.__twin.ready = load().catch((e) => {
  console.error(e);
  $('load-error').hidden = false;
  $('load-error').textContent = String(e && e.message || e);
  throw e;
});
