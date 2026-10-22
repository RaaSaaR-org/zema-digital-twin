// Top-down minimap. The background is rendered once from the hall geometry with an orthographic camera that
// looks straight down from `clipHeight` (so the roof is cut away), or taken from manifest.minimap.image.
import * as THREE from 'three';
import { glToW } from './coords.js';

export class Minimap {
  constructor(canvas, bigCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.big = bigCanvas;
    this.bigCtx = bigCanvas.getContext('2d');
    this.bg = null;            // canvas with the top-down image
    this.boundsW = null;       // {min:[x,y], max:[x,y]} in W
    this.zoom = 0.5;           // small map: metres per pixel scale factor relative to fit
    this.follow = true;
  }

  /** Render the top-down image from `scene` (only layer `layer`). bounds in W. */
  renderBackground(renderer, scene, boundsW, clipHeight = 2.6, pxPerM = 16, layer = 0, floorZ = -0.5) {
    const [x0, y0] = boundsW.min, [x1, y1] = boundsW.max;
    const wM = x1 - x0, hM = y1 - y0;
    const maxPx = Math.min(renderer.capabilities.maxTextureSize, 2048);
    const s = Math.min(pxPerM, maxPx / Math.max(wM, hM));
    const W = Math.max(64, Math.round(wM * s)), H = Math.max(64, Math.round(hM * s));
    // GL: W x -> x, W y -> -z. Camera above, looking down -y, image up = W +y = GL -z.
    const cam = new THREE.OrthographicCamera(x0, x1, y1, y0, 0.0, clipHeight - floorZ);
    cam.position.set(0, clipHeight, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, clipHeight - 1, 0);
    cam.layers.set(layer);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    // no MSAA: reading back multisampled targets returns zeros on some ANGLE/GL drivers (headless NVIDIA)
    const rt = new THREE.WebGLRenderTarget(W, H);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const prevBg = scene.background, prevFog = scene.fog;
    scene.background = new THREE.Color(0x0b0e13); scene.fog = null;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    const px = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    renderer.setRenderTarget(null);
    scene.background = prevBg; scene.fog = prevFog;
    rt.dispose();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {   // flip rows (GL origin bottom-left)
      img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    }
    ctx.putImageData(img, 0, 0);
    this.bg = c;
    this.boundsW = { min: [x0, y0], max: [x1, y1] };
    return { width: W, height: H };
  }

  async loadImage(url, boundsW) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    this.bg = c; this.boundsW = boundsW;
  }

  /** W (x, y) -> background pixel. */
  toPx(xW, yW) {
    const b = this.boundsW;
    return [(xW - b.min[0]) / (b.max[0] - b.min[0]) * this.bg.width, (b.max[1] - yW) / (b.max[1] - b.min[1]) * this.bg.height];
  }

  fromPx(px, py) {
    const b = this.boundsW;
    return [b.min[0] + px / this.bg.width * (b.max[0] - b.min[0]), b.max[1] - py / this.bg.height * (b.max[1] - b.min[1])];
  }

  _draw(ctx, cw, ch, view, state) {
    ctx.fillStyle = '#2c343e'; ctx.fillRect(0, 0, cw, ch);
    if (!this.bg) return;
    // view: {cx, cy (bg px), scale (screen px per bg px)}
    const { cx, cy, scale } = view;
    const tx = (x) => (x - cx) * scale + cw / 2, ty = (y) => (y - cy) * scale + ch / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bg, tx(0), ty(0), this.bg.width * scale, this.bg.height * scale);
    // panos
    for (const p of state.panos || []) {
      const w = glToW([p.position.x, p.position.y, p.position.z]);
      const [x, y] = this.toPx(w[0], w[1]);
      const act = p === state.activePano;
      ctx.beginPath(); ctx.arc(tx(x), ty(y), act ? 4.5 : 3.2, 0, Math.PI * 2);
      if (p.src && p.src.photo_only) {   // unregistered pano: position only approximate
        ctx.strokeStyle = act ? '#1b2027' : 'rgba(27,32,39,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
      } else {
        ctx.fillStyle = act ? '#1b2027' : 'rgba(27,32,39,0.55)'; ctx.fill();
      }
    }
    // stations
    for (const s of state.stations || []) {
      const [x, y] = this.toPx(s.position_W[0], s.position_W[1]);
      const done = state.discovered.has(s.id);
      ctx.fillStyle = done ? '#f2b33d' : (s.marker_color || '#2fb7c9');
      ctx.strokeStyle = '#000';
      ctx.beginPath();
      const X = tx(x), Y = ty(y), r = s === state.near ? 7 : 5;
      ctx.moveTo(X, Y - r); ctx.lineTo(X + r, Y); ctx.lineTo(X, Y + r); ctx.lineTo(X - r, Y); ctx.closePath();
      ctx.fill(); ctx.stroke();
      if (state.labels) {
        ctx.font = '600 12px system-ui';
        const lab = state.labelOf(s);
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.strokeText(lab, X + 8, Y + 4);
        ctx.fillStyle = '#10151c'; ctx.fillText(lab, X + 8, Y + 4);
      }
    }
    // robot (Unitree G1)
    if (state.robotW) {
      const [x, y] = this.toPx(state.robotW[0], state.robotW[1]);
      const X = tx(x), Y = ty(y);
      ctx.fillStyle = '#c48cff'; ctx.strokeStyle = '#2a1840'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(X, Y, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2a1840'; ctx.font = '700 8px system-ui'; ctx.textAlign = 'center'; ctx.fillText('G1', X, Y + 3); ctx.textAlign = 'start';
    }
    // player arrow (heading: W yaw)
    const [px, py] = this.toPx(state.playerW[0], state.playerW[1]);
    const X = tx(px), Y = ty(py);
    // the arrow is drawn pointing up (canvas -y = W +y = heading 90 deg); canvas rotation is clockwise-positive
    ctx.save(); ctx.translate(X, Y); ctx.rotate(Math.PI / 2 - state.headingW);
    ctx.fillStyle = 'rgba(47,183,201,0.18)';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 34, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff5a5a'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5.5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5.5, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  draw(state) {
    if (!this.bg) return;
    const [px, py] = this.toPx(state.playerW[0], state.playerW[1]);
    const cw = this.canvas.width, ch = this.canvas.height;
    const scale = 2.2 * this.zoom * (cw / 220) * (16 / Math.max(1, this.bg.width / (this.boundsW.max[0] - this.boundsW.min[0])));
    this._view = { cx: px, cy: py, scale };
    this._draw(this.ctx, cw, ch, this._view, state);
  }

  drawBig(state) {
    if (!this.bg) return;
    const c = this.big;
    const maxW = Math.floor(window.innerWidth * 0.94), maxH = Math.floor(window.innerHeight * 0.84);
    const scale = Math.min(maxW / this.bg.width, maxH / this.bg.height);
    c.width = Math.round(this.bg.width * scale); c.height = Math.round(this.bg.height * scale);
    this._bigView = { cx: this.bg.width / 2, cy: this.bg.height / 2, scale };
    this._draw(this.bigCtx, c.width, c.height, this._bigView, { ...state, labels: true });
  }

  /** Screen click on a map -> W (x, y). */
  pickW(canvas, ev, big) {
    const v = big ? this._bigView : this._view;
    if (!v) return null;
    const r = canvas.getBoundingClientRect();
    const sx = (ev.clientX - r.left) * canvas.width / r.width, sy = (ev.clientY - r.top) * canvas.height / r.height;
    const bx = (sx - canvas.width / 2) / v.scale + v.cx, by = (sy - canvas.height / 2) / v.scale + v.cy;
    return this.fromPx(bx, by);
  }
}
