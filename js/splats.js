// Optional photo-real Gaussian-splat layers (manifest.splat_layers[], DATA_CONTRACT.md section 2b), rendered with
// Spark 2.3.1 (@sparkjsdev/spark, MIT, World Labs; vendor/spark/). Spark is imported lazily (dynamic import()) the
// first time a layer is switched on, so with the layer off nothing of it is downloaded or run and the engine behaves
// exactly like v2. The hall mesh stays the collider, the nav and minimap source; while splats are shown the hall is
// drawn as a backdrop pushed back along the view rays (depthPush, see installHallHooks) so that the splats win where
// both describe the same surface, and the mesh fills in wherever the splats are thin or missing.
import * as THREE from 'three';

const SPARK_URL = new URL('../vendor/spark/dist/spark.module.min.js', import.meta.url).href;

// Per quality preset: how many splats are drawn (the SPZ is written importance-ordered, so a prefix is the best
// subset), the pixel-ratio cap while splats are visible (splat cost scales with the pixel count) and the highest
// spherical-harmonics degree evaluated (Spark SplatMesh.maxSh; the shipped layer carries SH 3).
export const SPLAT_QUALITY = {
  low: { maxSplats: 250000, pixelRatio: 0.75, maxSh: 1 },
  medium: { maxSplats: 600000, pixelRatio: 1.0, maxSh: 2 },
  high: { maxSplats: Infinity, pixelRatio: 1.5, maxSh: 3 },
};

/**
 * Hall-material hooks while splats are shown (both are no-ops while the layer is off, so v2 behaviour is untouched):
 *  - depth push: every vertex moves away from the camera by depthPush metres along its view ray. The projected pixel
 *    is unchanged (a radial scale about the eye), only the depth grows, so splats win where splats and mesh describe
 *    the same surface and the mesh fills in where the splats are thin or missing;
 *  - free-space discard: hall fragments inside voxels that the training views of the hand-held video prove empty (freeTex, W frame,
 *    splat_web.py freespace) are dropped: mesh floaters in the walked aisle, blobby thin structures that the splats
 *    show properly.
 * For built-in materials via onBeforeCompile (installHallHooks); ProjectivePanoMaterial has the same code inline.
 */
export const HALL_HOOK_PARS_VERT = /* glsl */`
uniform float depthPush;
varying vec3 vHallWp;`;
export const HALL_HOOK_VERT = /* glsl */`
vHallWp = (modelMatrix * vec4(transformed, 1.0)).xyz;
if (depthPush > 0.0) gl_Position = projectionMatrix * vec4(mvPosition.xyz * (1.0 + depthPush / max(length(mvPosition.xyz), 1e-3)), 1.0);`;
export const HALL_HOOK_PARS_FRAG = /* glsl */`
precision highp sampler3D;
uniform sampler3D freeTex; uniform vec3 freeOrigin; uniform vec3 freeSize; uniform float freeOn; uniform float freeVoxel;
bool inFreeSpace(vec3 gl) {                    // layers >= 1: space the video views saw empty
  if (freeOn < 0.5) return false;
  vec3 w = vec3(gl.x, -gl.z, gl.y);            // GL -> W
  if (w.z < 0.1) return false;                 // never the floor (that is floorOwned)
  vec3 tc = (w - freeOrigin) / freeSize;
  if (any(lessThan(tc, vec3(0.0))) || any(greaterThanEqual(tc, vec3(1.0)))) return false;
  return texture(freeTex, tc).r > 0.5;
}
bool floorOwned(vec3 gl) {                     // layer 0: floor cells the splats (floor + mirror splats) cover
  if (freeOn < 0.5 || freeOrigin.z >= 0.0) return false;
  vec3 w = vec3(gl.x, -gl.z, gl.y);
  if (w.z >= 0.1) return false;
  vec2 t = (w.xy - freeOrigin.xy) / freeSize.xy;
  if (any(lessThan(t, vec2(0.0))) || any(greaterThanEqual(t, vec2(1.0)))) return false;
  return texture(freeTex, vec3(t, 0.5 * freeVoxel / freeSize.z)).r > 0.5;
}`;
// fragment code of the hooks; compiled in only while splats are shown (define SPLAT_HOOKS), so the v2 path keeps
// early depth testing. Owned floor -> drawn at the far plane (backdrop behind every splat incl. the reflections).
export const HALL_HOOK_FRAG = /* glsl */`
#ifdef SPLAT_HOOKS
  if (inFreeSpace(vHallWp)) discard;
  gl_FragDepth = floorOwned(vHallWp) ? 0.99999994 : gl_FragCoord.z;
#endif`;

export function makeHallUniforms() {
  const empty = new THREE.Data3DTexture(new Uint8Array([0]), 1, 1, 1);
  empty.format = THREE.RedFormat; empty.needsUpdate = true;
  return { depthPush: { value: 0 }, freeTex: { value: empty }, freeOrigin: { value: new THREE.Vector3() },
    freeSize: { value: new THREE.Vector3(1, 1, 1) }, freeOn: { value: 0 }, freeVoxel: { value: 1 } };
}

export function installHallHooks(material, uniforms) {
  if (!material || material.userData.hallHooksInstalled) return;
  material.userData.hallHooksInstalled = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    if (prev) prev.call(material, shader, r);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${HALL_HOOK_PARS_VERT}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${HALL_HOOK_VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vHallWp;\n${HALL_HOOK_PARS_FRAG}`)
      .replace('void main() {', `void main() {\n${HALL_HOOK_FRAG}`);
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => '';
  material.customProgramCacheKey = () => `${key()}|hallhooks`;
  material.needsUpdate = true;
}

async function fetchGz(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const ds = r.body.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(ds).arrayBuffer());
}

async function fetchBytes(url, expected, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const total = +(r.headers.get('content-length') || 0) || expected || 0;
  if (!r.body || !r.body.getReader) {
    const b = new Uint8Array(await r.arrayBuffer());
    onProgress(b.length, b.length);
    return b;
  }
  const reader = r.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export class SplatLayers {
  /**
   * @param {object} o renderer, scene, onProgress(frac, loadedBytes, totalBytes, label), onState(state)
   */
  constructor({ renderer, scene, onProgress = () => {}, onState = () => {}, onHooks = () => {} }) {
    this.onHooks = onHooks;      // (on) => toggle the SPLAT_HOOKS define of the hall materials
    this.renderer = renderer;
    this.scene = scene;
    this.onProgress = onProgress;
    this.onState = onState;
    this.descs = [];
    this.layers = [];          // {desc, mesh, count}
    this.spark = null;
    this.module = null;
    this.group = new THREE.Group();
    this.group.name = 'splatLayers';
    this.state = 'off';        // off | loading | on | error
    this.wanted = false;       // user switch
    this.visible = true;       // engine mode (hidden in panorama / photo modes)
    this.quality = 'high';
    this.hallUniforms = makeHallUniforms();
    this.pushUniform = this.hallUniforms.depthPush;
    this.pushM = 0.3;
    this.freeEnabled = true;
    this.freeLoaded = false;
    this.stats = { bytes: 0, count: 0, loadMs: 0, importMs: 0, decodeMs: 0, error: null };
    this.loading = null;
  }

  /** manifest.splat_layers (urls already resolved). */
  setDescs(descs) {
    this.descs = (descs || []).filter((d) => d && d.url && (!d.format || d.format === 'spz' || d.format === 'ply'));
    const d0 = this.descs[0];
    if (d0 && d0.mesh_push_m != null) this.pushM = +d0.mesh_push_m;
    // view fade: training camera centres + forwards (W) of the capture
    this.views = d0 && Array.isArray(d0.views_W) ? d0.views_W : null;
    const vf = (d0 && d0.view_fade) || {};
    this.fadeDot = vf.dot || [0.15, 0.55];
    this.fadeDist = vf.dist_m || [5.0, 10.0];
    this.tourFadeM = vf.tour_m || null;      // [near, far] m from a projectable tour spot (null: projection's fade)
    this.fadeEnabled = !!this.views;
    this.tourFade = true;
    this.fade = 1;
  }

  /** Target opacity for a viewer at W position p looking along W forward f (horizontal parts are used): the best
   *  agreement with the forward of a training camera within fadeDist[1] (horizontal distance), weighted by distance. */
  viewFadeTarget(p, f) {
    if (!this.fadeEnabled || !this.views) return 1;
    const fl = Math.hypot(f[0], f[1]) || 1;
    const fx = f[0] / fl, fy = f[1] / fl;
    let best = 0;
    const [d0, d1] = this.fadeDist, [c0, c1] = this.fadeDot;
    const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    for (const v of this.views) {
      const d = Math.hypot(v[0] - p[0], v[1] - p[1]);
      if (d > d1) continue;
      const vl = Math.hypot(v[3], v[4]) || 1;
      const dot = (v[3] * fx + v[4] * fy) / vl;
      best = Math.max(best, sm(c0, c1, dot) * (1 - sm(d0, d1, d)));
    }
    return best;
  }

  /** Per frame: ease the layer opacity towards the target (about 0.3 s): view fade x (1 - tour photo strength).
   *  The hall hooks (free-space discard, floor backdrop) are on only while the layer is mostly visible, so near the
   *  tour spots the hall looks exactly as without the layer. */
  update(dt, pW, fW, tourStrength = 0) {
    if (!this.shown || !this.layers.length) return;
    const tgt = this.viewFadeTarget(pW, fW) * (this.tourFade === false ? 1 : 1 - tourStrength);
    const k = Math.min(1, dt * 4);
    this.fade += (tgt - this.fade) * k;
    if (Math.abs(tgt - this.fade) < 0.01) this.fade = tgt;
    for (const l of this.layers) l.mesh.opacity = this.fade;
    const hooks = this.fade > 0.35;
    this.hallUniforms.freeOn.value = hooks && this.freeEnabled && this.freeLoaded ? 1 : 0;
    this.pushUniform.value = hooks ? this.pushM : 0;
    const vis = this.fade > 0.01 && !this.forceHidden;   // forceHidden: test hook (mesh alone with the hooks)
    if (this.group.visible !== vis) this.group.visible = vis;
  }

  get available() { return this.descs.length > 0; }

  /** Switch the layer on or off (loads on the first switch-on). Resolves when the state is settled. */
  async setWanted(on) {
    this.wanted = !!on && this.available;
    if (this.wanted && !this.layers.length) {
      try { await this.load(); } catch (e) {
        this.state = 'error'; this.stats.error = String(e && e.message || e); console.warn('splats', e);
        this.wanted = false; this.onState(this.state); return false;
      }
    }
    this._apply();
    return this.wanted;
  }

  setVisible(on) { this.visible = !!on; this._apply(); }

  setQuality(q) {
    this.quality = SPLAT_QUALITY[q] ? q : 'high';
    for (const l of this.layers) {
      const src = l.mesh.extSplats || l.mesh.packedSplats;
      if (!src) continue;
      const cap = Math.min(l.count, SPLAT_QUALITY[this.quality].maxSplats);
      src.numSplats = cap;
      l.mesh.maxSh = SPLAT_QUALITY[this.quality].maxSh;
      l.mesh.updateGenerator();
    }
    return SPLAT_QUALITY[this.quality];
  }

  /** True while splats are actually drawn (the hall is then pushed back). */
  get shown() { return this.state === 'on' && this.wanted && this.visible; }

  _apply() {
    const show = this.shown;
    if (show && !this.group.parent) this.scene.add(this.group);
    if (!show && this.group.parent) this.scene.remove(this.group);
    if (this.spark) this.spark.visible = show;
    this.pushUniform.value = show ? this.pushM : 0;
    this.hallUniforms.freeOn.value = show && this.freeEnabled && this.freeLoaded ? 1 : 0;
    if (this.hooksOn !== show) { this.hooksOn = show; this.onHooks(show); }
    this.onState(this.state);
  }

  load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      this.state = 'loading';
      this.onState(this.state);
      const t0 = performance.now();
      const total = this.descs.reduce((s, d) => s + (d.bytes || 0), 0);
      const loaded = new Array(this.descs.length).fill(0);
      const report = (label) => {
        const l = loaded.reduce((a, b) => a + b, 0);
        this.onProgress(total ? Math.min(1, l / total) : 0, l, total, label);
      };
      // download the data and the library in parallel
      const imp = import(SPARK_URL).then((m) => { this.stats.importMs = Math.round(performance.now() - t0); return m; });
      const bytes = await Promise.all(this.descs.map((d, i) => fetchBytes(d.url, d.bytes, (n) => { loaded[i] = n; report(d.id); })));
      const fs = this.descs[0].free_space;
      if (fs && fs.url) {
        try {
          const data = await fetchGz(fs.url);
          const [nx, ny, nz] = fs.dims;
          if (data.length !== nx * ny * nz) throw new Error(`free space: ${data.length} bytes, expected ${nx * ny * nz}`);
          const tex = new THREE.Data3DTexture(data, nx, ny, nz);
          tex.format = THREE.RedFormat; tex.type = THREE.UnsignedByteType;
          tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.unpackAlignment = 1; tex.needsUpdate = true;
          const u = this.hallUniforms;
          u.freeTex.value = tex;
          u.freeOrigin.value.set(...fs.origin_W);
          u.freeSize.value.set(nx * fs.voxel_m, ny * fs.voxel_m, nz * fs.voxel_m);
          u.freeVoxel.value = fs.voxel_m;
          this.freeLoaded = true;
          this.stats.freeBytes = data.length;
        } catch (e) { console.warn('splat free space', e); }
      }
      const S = await imp;
      this.module = S;
      const t1 = performance.now();
      const r = this.descs[0].render || {};
      this.spark = new S.SparkRenderer({
        renderer: this.renderer,
        enableLod: false,
        blurAmount: r.blur_amount ?? 0.0,           // trained without the anti-aliasing tweak (3DGUT): no 2D blur
        preBlurAmount: r.pre_blur_amount ?? 0.0,
        maxStdDev: r.max_std_dev ?? Math.sqrt(8),
        sortRadial: r.sort_radial ?? true,
      });
      this.spark.name = 'sparkRenderer';
      this.group.add(this.spark);
      for (let i = 0; i < this.descs.length; i++) {
        const d = this.descs[i];
        const fileType = d.format === 'ply' ? S.SplatFileType.PLY : S.SplatFileType.SPZ;
        const mesh = new S.SplatMesh({ fileBytes: bytes[i], fileType, fileName: d.url.split('/').pop(),
          extSplats: d.ext_splats ?? true, lod: false, raycastable: false });
        mesh.name = 'splats:' + (d.id || i);
        await mesh.initialized;
        const src = mesh.extSplats || mesh.packedSplats;
        const count = src ? src.numSplats : (d.count || 0);
        this.layers.push({ desc: d, mesh, count });
        this.group.add(mesh);
        this.stats.bytes += bytes[i].length;
        this.stats.count += count;
      }
      this.stats.decodeMs = Math.round(performance.now() - t1);
      this.stats.loadMs = Math.round(performance.now() - t0);
      this.state = 'on';
      this.setQuality(this.quality);
      report('');
    })();
    return this.loading;
  }

  info() {
    return { available: this.available, state: this.state, wanted: this.wanted, visible: this.visible, shown: this.shown,
      quality: this.quality, push_m: this.pushUniform.value, free_on: this.hallUniforms.freeOn.value,
      fade: +this.fade.toFixed(3), fade_enabled: this.fadeEnabled, tour_fade: this.tourFade, layers: this.layers.map((l) => ({ id: l.desc.id, count: l.count,
        drawn: (l.mesh.extSplats || l.mesh.packedSplats || {}).numSplats, max_sh: l.mesh.maxSh })), ...this.stats };
  }

  /** First n splats of layer 0 as decoded by Spark (for the round-trip test against the Python writer). */
  probe(n = 8, stride = 1) {
    const l = this.layers[0];
    if (!l) return null;
    const out = [];
    l.mesh.forEachSplat((i, c, s, q, o, col) => {
      if (i % stride || out.length >= n) return;
      out.push({ i, center: [c.x, c.y, c.z], scales: [s.x, s.y, s.z], quat_xyzw: [q.x, q.y, q.z, q.w], opacity: o,
        color: [col.r, col.g, col.b] });
    });
    return out;
  }
}
