// Projective texturing from real equirectangular panoramas ("photo texture").
//
// For every hall surface point P the fragment shader looks P up in up to 4 nearby panoramas (chosen by camera
// position), tests visibility against a per-pano distance cubemap (rendered at runtime from the hall geometry, or
// decoded from an optional depth equirect), weights the panos by facing, distance, view-ray alignment and the
// tripod-nadir mask, masks rays that pass through "remove" boxes (objects that exist in the photos but not in the
// twin, e.g. the green tool cabinet replaced by the G1), and blends the result over the baked colour.
import * as THREE from 'three';
import { HALL_HOOK_PARS_FRAG, HALL_HOOK_FRAG, makeHallUniforms } from './splats.js';
import { panoPoseToGl, toMatrix3Elements } from './coords.js';

export const MAX_PANOS = 4;
export const MAX_REMOVE = 4;
export const DEPTH_LAYER = 2;   // objects on this layer occlude in the pano distance cubemaps

// GLSL: world (GL) direction -> equirect texture coordinate (3DVista yaw/pitch, cam x right / y down / z forward).
export const PANO_UV_GLSL = /* glsl */`
const float PI_ = 3.141592653589793;
vec2 panoUv(mat3 R_cam_gl, vec3 dirGl, float flipV) {
  vec3 dc = R_cam_gl * dirGl;
  float yaw = atan(dc.x, dc.z);
  float pitch = asin(clamp(-dc.y, -1.0, 1.0));
  float v = 0.5 + pitch / PI_;               // GL texture v (flipY image): 1 = top = zenith
  return vec2(0.5 + yaw / (2.0 * PI_), mix(v, 1.0 - v, flipV));
}
// Seam-safe gradients: pick the u derivative of the representation (u or u+0.5 wrapped) that is continuous here.
// Returns (dFdx(uv), dFdy(uv)). Must be called in uniform control flow.
vec4 panoGrad(vec2 uv) {
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  float u2 = fract(uv.x + 0.5);
  float dx2 = dFdx(u2), dy2 = dFdy(u2);
  if (abs(dx2) + abs(dy2) < abs(dx.x) + abs(dy.x)) { dx.x = dx2; dy.x = dy2; }
  return vec4(dx, dy);
}
vec4 panoSample(sampler2D tex, vec2 uv) { vec4 g = panoGrad(uv); return textureGrad(tex, uv, g.xy, g.zw); }
`;

const VERT = /* glsl */`
#include <color_pars_vertex>
varying vec3 vWorldPos;
varying vec2 vUv0;
uniform float depthPush;   // v3 splat layer: hall drawn as a backdrop pushed back along the view rays (0 = v2)
void main() {
  #include <color_vertex>
  vUv0 = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  if (depthPush > 0.0) {
    vec4 vp = viewMatrix * wp;
    gl_Position = projectionMatrix * vec4(vp.xyz * (1.0 + depthPush / max(length(vp.xyz), 1e-3)), 1.0);
  }
}
`;

const FRAG = /* glsl */`
#include <common>
#include <color_pars_fragment>
varying vec3 vWorldPos;
varying vec2 vUv0;
uniform vec3 baseColor;
uniform sampler2D baseMap;
uniform mat3 baseMapTransform;          // the map's uv transform (KHR_texture_transform from gltfpack quantisation)
uniform float hasBaseMap;
uniform sampler2D panoTex0; uniform sampler2D panoTex1; uniform sampler2D panoTex2; uniform sampler2D panoTex3;
uniform samplerCube panoDepth0; uniform samplerCube panoDepth1; uniform samplerCube panoDepth2; uniform samplerCube panoDepth3;
uniform vec3 panoPos[${MAX_PANOS}];
uniform mat3 panoRot[${MAX_PANOS}];
uniform vec4 panoParam[${MAX_PANOS}];   // x active, y hasDepth, z flipV, w maxRange (m)
uniform vec3 panoGain[${MAX_PANOS}];
uniform float panoCamFac[${MAX_PANOS}]; // 1 near the camera, 0 far (photo projection only near the tour spots)
uniform mat4 removeInv[${MAX_REMOVE}];  // GL world -> unit box [-1,1]^3
uniform int removeCount;
uniform vec3 camPos;
uniform float projStrength;
uniform float sharpness;
uniform float depthTol;
uniform float nadirSin;                 // sin of the lowest usable pitch (tripod mask)
uniform int debugMode;
${HALL_HOOK_PARS_FRAG}
${PANO_UV_GLSL}

float rayHitsRemoveBox(vec3 ro, vec3 rd, float tmax) {
  float hit = 0.0;
  for (int k = 0; k < ${MAX_REMOVE}; k++) {
    if (k >= removeCount) break;
    vec3 o = (removeInv[k] * vec4(ro, 1.0)).xyz;
    vec3 d = (removeInv[k] * vec4(rd, 0.0)).xyz;
    vec3 inv = 1.0 / (d + vec3(1e-9));
    vec3 t0 = (-1.0 - o) * inv, t1 = (1.0 - o) * inv;
    vec3 tmin = min(t0, t1), tmaxv = max(t0, t1);
    float tn = max(max(tmin.x, tmin.y), tmin.z);
    float tf = min(min(tmaxv.x, tmaxv.y), tmaxv.z);
    if (tf >= max(tn, 0.0) && tn < tmax) hit = 1.0;
  }
  return hit;
}

float panoWeight(int i, vec3 P, vec3 N, vec3 viewDir, float stored, out vec3 dir, out float q) {
  vec3 d = P - panoPos[i];
  float dist = max(length(d), 1e-4);
  dir = d / dist;
  vec3 dc = panoRot[i] * dir;
  float nadir = smoothstep(nadirSin - 0.02, nadirSin + 0.02, -dc.y);
  float facing = smoothstep(0.02, 0.3, dot(N, -dir));
  float lim = stored * (1.0 + depthTol) + 0.06;
  float vis = (panoParam[i].y < 0.5 || stored <= 1e-3) ? 1.0 : 1.0 - smoothstep(lim, lim + 0.12, dist);
  float range = 1.0 - smoothstep(panoParam[i].w * 0.8, panoParam[i].w, dist);
  float cv = dot(viewDir, dir);
  float align = 0.15 + 0.85 * pow(clamp(cv * 0.5 + 0.5, 0.0, 1.0), 6.0);
  float keep = (removeCount > 0 && rayHitsRemoveBox(panoPos[i], dir, dist - 0.02) > 0.5) ? 0.0 : 1.0;
  float w = panoParam[i].x * nadir * facing * vis * range * align * panoCamFac[i] * keep / (1.0 + 0.04 * dist * dist);
  // q: how much this pano may replace the baked colour here (no distance / alignment terms)
  q = panoParam[i].x * nadir * smoothstep(0.05, 0.35, dot(N, -dir)) * vis * range * panoCamFac[i] * keep;
  return w;
}

void main() {
  #define vHallWp vWorldPos
  ${HALL_HOOK_FRAG}
  #undef vHallWp
  vec3 vc = vec3(1.0);
  #if defined( USE_COLOR_ALPHA )
    vc = vColor.rgb;
  #elif defined( USE_COLOR )
    vc = vColor;
  #endif
  vec3 baked = baseColor * vc;
  if (hasBaseMap > 0.5) baked *= texture(baseMap, (baseMapTransform * vec3(vUv0, 1.0)).xy).rgb;

  vec3 P = vWorldPos;
  vec3 N = normalize(cross(dFdx(P), dFdy(P)));
  vec3 toCam = camPos - P;
  if (dot(N, toCam) < 0.0) N = -N;
  vec3 viewDir = normalize(P - camPos);

  // 1) uv + seam-safe gradients for all slots (uniform control flow: derivatives are valid here)
  vec3 dir0 = normalize(P - panoPos[0]); vec3 dir1 = normalize(P - panoPos[1]);
  vec3 dir2 = normalize(P - panoPos[2]); vec3 dir3 = normalize(P - panoPos[3]);
  vec2 uv0 = panoUv(panoRot[0], dir0, panoParam[0].z); vec2 uv1 = panoUv(panoRot[1], dir1, panoParam[1].z);
  vec2 uv2 = panoUv(panoRot[2], dir2, panoParam[2].z); vec2 uv3 = panoUv(panoRot[3], dir3, panoParam[3].z);
  vec4 g0 = panoGrad(uv0), g1 = panoGrad(uv1), g2 = panoGrad(uv2), g3 = panoGrad(uv3);
  // 2) visibility (depth cube) + weights; inactive slots are skipped by a uniform branch
  vec3 dd;
  vec4 w = vec4(0.0), q = vec4(0.0);
  if (panoParam[0].x > 0.5) w.x = panoWeight(0, P, N, viewDir, texture(panoDepth0, dir0).r, dd, q.x);
  if (panoParam[1].x > 0.5) w.y = panoWeight(1, P, N, viewDir, texture(panoDepth1, dir1).r, dd, q.y);
  if (panoParam[2].x > 0.5) w.z = panoWeight(2, P, N, viewDir, texture(panoDepth2, dir2).r, dd, q.z);
  if (panoParam[3].x > 0.5) w.w = panoWeight(3, P, N, viewDir, texture(panoDepth3, dir3).r, dd, q.w);
  float wmax = max(max(w.x, w.y), max(w.z, w.w));
  vec4 ws = pow(w / max(wmax, 1e-6), vec4(sharpness)) * step(1e-6, w);
  ws *= step(0.02, ws);                     // drop negligible contributions (saves texture fetches)
  float wsum = ws.x + ws.y + ws.z + ws.w;
  // 3) colour fetches for active slots only (uniform branches; per-fragment divergent texture branches were
  //    avoided after GPU hangs on an AMD iGPU, see the v2 web dev notes)
  vec3 proj = vec3(0.0);
  if (panoParam[0].x > 0.5) proj += ws.x * textureGrad(panoTex0, uv0, g0.xy, g0.zw).rgb * panoGain[0];
  if (panoParam[1].x > 0.5) proj += ws.y * textureGrad(panoTex1, uv1, g1.xy, g1.zw).rgb * panoGain[1];
  if (panoParam[2].x > 0.5) proj += ws.z * textureGrad(panoTex2, uv2, g2.xy, g2.zw).rgb * panoGain[2];
  if (panoParam[3].x > 0.5) proj += ws.w * textureGrad(panoTex3, uv3, g3.xy, g3.zw).rgb * panoGain[3];
  proj /= max(wsum, 1e-6);
  float qmax = max(max(q.x, q.y), max(q.z, q.w));
  float cover = smoothstep(0.0, 0.02, wmax) * step(1e-6, wsum) * clamp(qmax, 0.0, 1.0);
  vec3 outc = mix(baked, proj, cover * projStrength);

  if (debugMode == 1) {
    vec3 dbg = (vec3(1.0, 0.2, 0.2) * ws.x + vec3(0.2, 1.0, 0.2) * ws.y + vec3(0.25, 0.4, 1.0) * ws.z + vec3(1.0, 0.9, 0.2) * ws.w) / max(wsum, 1e-6);
    outc = mix(baked * 0.35, dbg, cover);
  } else if (debugMode == 2) {
    outc = vec3(cover);
  } else if (debugMode == 3) {
    outc = baked;
  }
  gl_FragColor = vec4(outc, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function blackTexture() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

const DIST_VERT = /* glsl */`
varying vec3 vWp;
void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWp = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
`;
const DIST_FRAG = /* glsl */`
uniform vec3 center;
varying vec3 vWp;
void main() { gl_FragColor = vec4(length(vWp - center), 0.0, 0.0, 1.0); }
`;
// decode an equirect depth image (RG = 16 bit big-endian, metres = value / 65535 * scale) into the distance cube
const DEPTH_EQ_FRAG = /* glsl */`
uniform sampler2D depthTex; uniform mat3 rot; uniform float scale; uniform float flipV;
varying vec3 vWp; uniform vec3 center;
${PANO_UV_GLSL}
void main() {
  vec3 dir = normalize(vWp - center);
  vec2 uv = panoUv(rot, dir, flipV);
  vec4 t = texture(depthTex, uv);
  float d = (floor(t.r * 255.0 + 0.5) * 256.0 + floor(t.g * 255.0 + 0.5)) / 65535.0 * scale;
  gl_FragColor = vec4(d, 0.0, 0.0, 1.0);
}
`;

export class ProjectiveTexturing {
  constructor(renderer, scene, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.enabled = opts.enabled ?? true;
    this.maxActive = opts.maxActive ?? 4;
    this.cubeSize = opts.cubeSize ?? 512;
    this.maxCacheTextures = opts.maxCacheTextures ?? 6;
    this.camNear = opts.camNear ?? 1e6;      // default: no camera-distance fade (manifest.projection sets it)
    this.camFar = opts.camFar ?? 2e6;
    this.panos = [];
    this.byId = new Map();
    this.active = [];               // pano entries in slots 0..3
    this.lastSelectPos = new THREE.Vector3(1e9, 0, 0);
    this.materials = new Map();     // original material -> projective material
    this.meshes = [];
    this.loading = new Map();
    this.texLoader = null;
    this.ktx2 = opts.ktx2Loader || null;
    this._black = blackTexture();
    this._emptyCube = new THREE.WebGLCubeRenderTarget(1, { type: THREE.HalfFloatType });
    this.stats = { depthCubesRendered: 0, texturesLoaded: 0, lastSelectMs: 0 };
    const u = {
      panoTex0: { value: this._black }, panoTex1: { value: this._black }, panoTex2: { value: this._black }, panoTex3: { value: this._black },
      panoDepth0: { value: this._emptyCube.texture }, panoDepth1: { value: this._emptyCube.texture },
      panoDepth2: { value: this._emptyCube.texture }, panoDepth3: { value: this._emptyCube.texture },
      panoPos: { value: Array.from({ length: MAX_PANOS }, () => new THREE.Vector3()) },
      panoRot: { value: Array.from({ length: MAX_PANOS }, () => new THREE.Matrix3()) },
      panoParam: { value: Array.from({ length: MAX_PANOS }, () => new THREE.Vector4(0, 0, 0, 60)) },
      panoGain: { value: Array.from({ length: MAX_PANOS }, () => new THREE.Vector3(1, 1, 1)) },
      panoCamFac: { value: [1, 1, 1, 1] },
      removeInv: { value: Array.from({ length: MAX_REMOVE }, () => new THREE.Matrix4()) },
      removeCount: { value: 0 },
      camPos: { value: new THREE.Vector3() },
      projStrength: { value: 1.0 },
      sharpness: { value: 3.0 },
      depthTol: { value: 0.03 },
      nadirSin: { value: -Math.sin(THREE.MathUtils.degToRad(76)) },
      debugMode: { value: 0 },
      ...(opts.hallUniforms || makeHallUniforms()),   // v3: depthPush + free-space discard (splats.js)
    };
    this.uniforms = u;
    this.distMat = new THREE.ShaderMaterial({ vertexShader: DIST_VERT, fragmentShader: DIST_FRAG,
      uniforms: { center: { value: new THREE.Vector3() } }, side: THREE.DoubleSide });
  }

  setPanos(list, removeBoxes = []) {
    this.panos = list.map((p) => {
      const g = panoPoseToGl(p.pose_W || p.pose, p.pose_W?.cam_convention);
      const e = {
        id: p.id, label: p.label, src: p,
        position: new THREE.Vector3(...g.position),
        rot: new THREE.Matrix3().fromArray(toMatrix3Elements(g.R_cam_GL)),
        R_GL_cam: g.R_GL_cam,
        gain: new THREE.Vector3(...(p.gain || [1, 1, 1])),
        maxRange: p.max_range_m || 60,
        project: p.project !== false,
        tex: null, texLevel: -1, depth: null, lastUsed: 0,
      };
      this.byId.set(e.id, e);
      return e;
    });
    const u = this.uniforms;
    u.removeCount.value = Math.min(removeBoxes.length, MAX_REMOVE);
    removeBoxes.slice(0, MAX_REMOVE).forEach((b, k) => { u.removeInv.value[k].copy(b.inverseGl); });
  }

  /** Replace the materials of the hall meshes (call after each hall LOD load). */
  attach(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.layers.enable(DEPTH_LAYER);
      if (!o.userData.origMaterial) o.userData.origMaterial = o.material;
      o.userData.projMaterial = this._materialFor(o.userData.origMaterial, o.geometry);
      this.meshes.push(o);
      o.material = this.enabled ? o.userData.projMaterial : o.userData.origMaterial;
    });
  }

  detach(root) {
    root.traverse((o) => { if (o.isMesh) this.meshes = this.meshes.filter((m) => m !== o); });
  }

  _materialFor(orig, geometry) {
    if (this.materials.has(orig)) return this.materials.get(orig);
    const uniforms = {
      ...this.uniforms,
      baseColor: { value: (orig.color ? orig.color.clone() : new THREE.Color(1, 1, 1)) },
      baseMap: { value: orig.map || this._black },
      baseMapTransform: { value: orig.map ? (orig.map.updateMatrix(), orig.map.matrix) : new THREE.Matrix3() },
      hasBaseMap: { value: orig.map ? 1 : 0 },
    };
    const m = new THREE.ShaderMaterial({
      name: 'ProjectivePanoMaterial', vertexShader: VERT, fragmentShader: FRAG, uniforms,
      vertexColors: !!geometry.attributes.color, side: THREE.DoubleSide, defines: { HALL_CUT: '' },
    });
    this.materials.set(orig, m);
    return m;
  }

  setEnabled(on) {
    this.enabled = on;
    for (const o of this.meshes) o.material = on ? o.userData.projMaterial : o.userData.origMaterial;
  }

  setDebug(mode) { this.uniforms.debugMode.value = mode | 0; }

  nearest(pos, k = 1, onlyProjectable = false) {
    return this.panos.filter((p) => !onlyProjectable || p.project).sort((a, b) => a.position.distanceToSquared(pos) - b.position.distanceToSquared(pos)).slice(0, k);
  }

  /** Called every frame. Re-selects the active set when the camera moved > 0.5 m. */
  update(camera, loaders) {
    this.uniforms.camPos.value.copy(camera.position);
    // camera-distance fade: a pano's photo is projected fully while the camera is within camNear of the tour spot
    // and fades to the baked texture by camFar (projecting a photo taken 5-15 m away onto approximate geometry
    // is worse than the multi-view baked texture; measured at held-out frames of the hand-held video)
    const cf = this.uniforms.panoCamFac.value;
    for (let k = 0; k < MAX_PANOS; k++) {
      const p = this.active[k];
      if (!p) { cf[k] = 0; continue; }
      const d = camera.position.distanceTo(p.position);
      const x = Math.min(1, Math.max(0, (d - this.camNear) / Math.max(1e-3, this.camFar - this.camNear)));
      cf[k] = 1 - x * x * (3 - 2 * x);
    }
    if (!this.enabled || !this.panos.length) return;
    if (camera.position.distanceTo(this.lastSelectPos) < 0.5 && !this._dirty) return;
    this._dirty = false;
    const t0 = performance.now();
    this.lastSelectPos.copy(camera.position);
    this.loaders = loaders;
    const want = this.nearest(camera.position, Math.min(this.maxActive, MAX_PANOS), true);
    // keep panos that stay selected in their slot to avoid texture rebinding pops
    const slots = [null, null, null, null];
    want.forEach((p) => { const k = this.active.indexOf(p); if (k >= 0 && k < MAX_PANOS) slots[k] = p; });
    want.forEach((p) => { if (!slots.includes(p)) { const k = slots.indexOf(null); slots[k] = p; } });
    this.active = slots;
    const now = performance.now();
    slots.forEach((p, k) => {
      if (p) { p.lastUsed = now; this.ensureTexture(p, loaders); this.ensureDepth(p); }
      this._bindSlot(k, p);
    });
    this._evict();
    this.stats.lastSelectMs = performance.now() - t0;
  }

  _bindSlot(k, p) {
    const u = this.uniforms;
    const ready = p && p.tex;
    u['panoTex' + k].value = ready ? p.tex : this._black;
    u['panoDepth' + k].value = ready && p.depth ? p.depth.texture : this._emptyCube.texture;
    u.panoParam.value[k].set(ready ? 1 : 0, ready && p.depth ? 1 : 0, p && p.flipV ? 1 : 0, p ? p.maxRange : 60);
    if (p) {
      u.panoPos.value[k].copy(p.position);
      u.panoRot.value[k].copy(p.rot);
      u.panoGain.value[k].copy(p.gain);
    }
  }

  rebind() { this.active.forEach((p, k) => this._bindSlot(k, p)); }

  /** Progressive: low-res first, then the full equirect. */
  ensureTexture(p, loaders, levels = ['equirect_lowres', 'equirect']) {
    if (this.loading.get(p.id)) return this.loading.get(p.id);
    const maxTex = this.renderer.capabilities.maxTextureSize;
    const jobs = levels.map((key, level) => ({ key, level })).filter(({ key }) => p.src[key] && p.src[key].url
      && (p.src[key].width || 0) <= maxTex);
    // `await null` first: without it, a pano whose levels are all loaded finishes synchronously and deletes its
    // `loading` entry before it is set below, which left a stale entry that blocked any reload after eviction
    const run = (async () => {
      await null;
      for (const { key, level } of jobs) {
        if (p.texLevel >= level) continue;
        try {
          const tex = await loadEquirect(p.src[key].url, loaders, this.renderer);
          if (p.tex && p.tex !== tex) p.tex.dispose();
          p.tex = tex;
          p.flipV = tex.userData.flipV;
          p.texLevel = level;
          this.stats.texturesLoaded++;
          this.rebind();
          this.onTexture && this.onTexture(p, key);
        } catch (e) { console.warn('pano texture failed', p.id, key, e); }
      }
      if (this.loading.get(p.id) === run) this.loading.delete(p.id);
    })();
    this.loading.set(p.id, run);
    return run;
  }

  ensureDepth(p) {
    if (p.depth || p.depthLoading) return p.depth;
    if (p.src.depth && p.src.depth.url && this.loaders) {
      // precomputed depth equirect -> cube (async); until then the pano is used without a visibility test
      p.depthLoading = this.depthFromEquirect(p, p.src.depth.url, p.src.depth.scale_m || 100, this.loaders)
        .catch((e) => console.warn('depth equirect failed, using runtime cube', p.id, e))
        .finally(() => { p.depthLoading = null; if (!p.depth) { p.src = { ...p.src, depth: null }; this._dirty = true; } });
      return null;
    }
    const rt = new THREE.WebGLCubeRenderTarget(this.cubeSize, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    const cam = new THREE.CubeCamera(0.05, 500, rt);
    cam.position.copy(p.position);
    cam.children.forEach((c) => c.layers.set(DEPTH_LAYER));
    cam.layers.set(DEPTH_LAYER);
    const r = this.renderer, s = this.scene;
    const prevBg = s.background, prevOverride = s.overrideMaterial, prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    const prevFog = s.fog;
    s.background = null; s.fog = null;
    this.distMat.uniforms.center.value.copy(p.position);
    s.overrideMaterial = this.distMat;
    r.setClearColor(0x000000, 0);
    s.updateMatrixWorld();
    cam.update(r, s);
    s.overrideMaterial = prevOverride; s.background = prevBg; s.fog = prevFog;
    r.setClearColor(prevClear, prevAlpha);
    p.depth = rt;
    p.depthSource = 'runtime';
    this.stats.depthCubesRendered++;
    return rt;
  }

  /** Optional precomputed depth (equirect PNG, RG16): converts it into the distance cube. */
  async depthFromEquirect(p, url, scale, loaders) {
    const tex = await loadEquirect(url, loaders, this.renderer, { linear: true, nearest: true });
    const rt = p.depth || new THREE.WebGLCubeRenderTarget(this.cubeSize, {
      type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const mat = new THREE.ShaderMaterial({ vertexShader: DIST_VERT, fragmentShader: DEPTH_EQ_FRAG, side: THREE.BackSide,
      uniforms: { depthTex: { value: tex }, rot: { value: p.rot }, scale: { value: scale }, center: { value: p.position },
        flipV: { value: tex.userData.flipV ? 1 : 0 } } });
    const sc = new THREE.Scene();
    const sph = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), mat);
    sph.position.copy(p.position);
    sph.layers.set(DEPTH_LAYER);
    sc.add(sph);
    const cam = new THREE.CubeCamera(0.05, 50, rt);
    cam.children.forEach((c) => c.layers.set(DEPTH_LAYER));
    cam.position.copy(p.position);
    sc.add(cam);
    cam.update(this.renderer, sc);
    tex.dispose(); mat.dispose(); sph.geometry.dispose();
    p.depth = rt;
    p.depthSource = 'equirect';
    this.stats.depthEquirectsLoaded = (this.stats.depthEquirectsLoaded || 0) + 1;
    this.rebind();
  }

  _evict() {
    // panos shown in the panorama mode (or about to be) are pinned and never evicted
    const pinned = this.pinned || new Set();
    const withTex = this.panos.filter((p) => p.tex && !this.active.includes(p) && !pinned.has(p)).sort((a, b) => a.lastUsed - b.lastUsed);
    const total = this.panos.filter((p) => p.tex).length;
    let extra = total - this.maxCacheTextures;
    for (const p of withTex) {
      if (extra-- <= 0) break;
      p.tex.dispose(); p.tex = null; p.texLevel = -1;
      if (p.depth) { p.depth.dispose(); p.depth = null; }
    }
  }

  /** Drop the depth cubes (geometry changed). runtimeOnly: only those rendered from the scene (the precomputed
   *  depth equirects do not depend on which hall nodes are shown). */
  invalidateDepth(runtimeOnly = false) {
    let n = 0;
    for (const p of this.panos) {
      if (!p.depth || (runtimeOnly && p.depthSource !== 'runtime')) continue;
      p.depth.dispose(); p.depth = null; n++;
    }
    if (n || !runtimeOnly) this._dirty = true;
  }
}

/** Equirect texture loader: .ktx2 via KTX2Loader, images via ImageBitmap (decoded off the main thread). */
export async function loadEquirect(url, loaders, renderer, opt = {}) {
  let tex;
  if (/\.ktx2(\?|$)/i.test(url)) {
    tex = await loaders.ktx2.loadAsync(url);
    tex.userData.flipV = true;   // KTX2 rows are stored top-down and not flipped on upload
  } else if (typeof createImageBitmap === 'function') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob, { imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    tex = new THREE.Texture(bmp);
    tex.flipY = false;
    tex.userData.flipV = false;
  } else {
    tex = await new THREE.TextureLoader().loadAsync(url);
    tex.userData.flipV = false;
  }
  tex.colorSpace = opt.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  if (opt.nearest) {
    tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  } else {
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }
  tex.needsUpdate = true;
  return tex;
}

/**
 * Sphere shown in panorama mode; uses the same uv convention as the projective shader.
 * `gain` (linear RGB, the pano's exposure gain used by the projection) is applied with weight 1 - gainMix, so a
 * cross-fade between the projected twin and the photo has no brightness jump; gainMix -> 1 shows the raw photo.
 * Change mask (v3, maskOn 1): an 8-bit equirect of the pano (manifest panos[].change_mask, rundgang/change_mask.py;
 * 1 = the photo shows the hall as it no longer is: the replaced tour-day setup, or today's station stands in front)
 * makes those photo pixels transparent (feathered edges), so the twin shows today's station there; maskOn 2 = whole
 * photo transparent (mask not loaded yet).
 * Blending is custom (= normal blending) so the alpha also works while the sphere is drawn as the opaque background.
 */
export function makePanoSphere() {
  const mat = new THREE.ShaderMaterial({
    name: 'PanoSphere',
    uniforms: { tex: { value: null }, rot: { value: new THREE.Matrix3() }, center: { value: new THREE.Vector3() },
      opacity: { value: 1 }, flipV: { value: 0 }, gain: { value: new THREE.Vector3(1, 1, 1) }, gainMix: { value: 1 },
      maskOn: { value: 0 }, maskTex: { value: null }, maskFlipV: { value: 0 } },
    vertexShader: DIST_VERT,
    fragmentShader: /* glsl */`
      uniform sampler2D tex; uniform mat3 rot; uniform vec3 center; uniform float opacity; uniform float flipV;
      uniform vec3 gain; uniform float gainMix;
      uniform float maskOn; uniform sampler2D maskTex; uniform float maskFlipV;
      varying vec3 vWp;
      ${PANO_UV_GLSL}
      void main() {
        vec3 dir = normalize(vWp - center);
        vec3 c = panoSample(tex, panoUv(rot, dir, flipV)).rgb * mix(gain, vec3(1.0), gainMix);
        float a = opacity;
        if (maskOn > 1.5) a = 0.0;
        else if (maskOn > 0.5) a *= 1.0 - texture(maskTex, panoUv(rot, dir, maskFlipV)).r;
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(40, 96, 48), mat);
  mesh.renderOrder = 1000;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}
