// Keyboard, mouse (PointerLock, with drag-to-look fallback) and touch (virtual joystick + swipe look).
export class Input {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.keys = new Set();
    this.look = { dx: 0, dy: 0 };
    this.sensitivity = opts.sensitivity ?? 1.0;
    this.invertY = false;
    this.enabled = true;
    this.handlers = {};           // key -> callback (single-press actions)
    this.joy = { x: 0, y: 0, active: false };
    this.dragging = false;
    this.locked = false;
    this.virtual = { x: 0, z: 0, run: false, up: 0 };   // for scripted tests
    this._bind();
  }

  on(code, fn) { (this.handlers[code] ||= []).push(fn); }

  _bind() {
    const c = this.canvas;
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (!e.repeat && this.handlers[e.code]) { this.handlers[e.code].forEach((f) => f(e)); }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    c.addEventListener('click', () => {
      if (this.enabled && !this.locked && !this.isTouch && c.requestPointerLock && this.allowLock) {
        try { const p = c.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* not allowed */ }
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      this.onLockChange && this.onLockChange(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked || this.dragging) this._addLook(e.movementX, e.movementY);
    });
    c.addEventListener('mousedown', (e) => { if (!this.locked && e.button === 0) this.dragging = true; });
    window.addEventListener('mouseup', () => { this.dragging = false; });

    // touch: left half = joystick (also the visible joystick element), right half = look
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    const joyEl = document.getElementById('joystick');
    const knob = document.getElementById('joy-knob');
    if (this.isTouch && joyEl) joyEl.hidden = false;
    const touches = new Map();
    c.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        const kind = t.clientX < window.innerWidth * 0.4 ? 'move' : 'look';
        touches.set(t.identifier, { kind, x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY });
      }
      e.preventDefault();
    }, { passive: false });
    c.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        const s = touches.get(t.identifier);
        if (!s) continue;
        if (s.kind === 'look') this._addLook((t.clientX - s.x) * 2.2, (t.clientY - s.y) * 2.2);
        else this._setJoy((t.clientX - s.x0) / 55, (t.clientY - s.y0) / 55, knob);
        s.x = t.clientX; s.y = t.clientY;
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        const s = touches.get(t.identifier);
        if (s && s.kind === 'move') this._setJoy(0, 0, knob);
        touches.delete(t.identifier);
      }
    };
    c.addEventListener('touchend', end);
    c.addEventListener('touchcancel', end);
    if (joyEl) {
      let jid = null, cx = 0, cy = 0;
      joyEl.addEventListener('pointerdown', (e) => {
        jid = e.pointerId; const r = joyEl.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
        joyEl.setPointerCapture(e.pointerId);
        this._setJoy((e.clientX - cx) / 55, (e.clientY - cy) / 55, knob);
      });
      joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === jid) this._setJoy((e.clientX - cx) / 55, (e.clientY - cy) / 55, knob); });
      const up = (e) => { if (e.pointerId === jid) { jid = null; this._setJoy(0, 0, knob); } };
      joyEl.addEventListener('pointerup', up);
      joyEl.addEventListener('pointercancel', up);
    }
  }

  _setJoy(x, y, knob) {
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    this.joy.x = x; this.joy.y = y; this.joy.active = l > 0.05;
    if (knob) knob.style.transform = `translate(${x * 40}px, ${y * 40}px)`;
  }

  _addLook(dx, dy) {
    const k = 0.0022 * this.sensitivity;
    this.look.dx += dx * k;
    this.look.dy += dy * k * (this.invertY ? -1 : 1);
  }

  consumeLook() { const l = { ...this.look }; this.look.dx = 0; this.look.dy = 0; return l; }

  move() {
    if (!this.enabled) return { x: 0, z: 0, run: false, jump: false, up: 0 };
    const k = this.keys;
    let x = 0, z = 0, up = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) z += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyQ')) up -= 1;
    if (k.has('Space')) up += 1;
    if (this.joy.active) { x += this.joy.x; z -= this.joy.y; }
    x += this.virtual.x; z += this.virtual.z; up += this.virtual.up;
    return { x, z, up, run: k.has('ShiftLeft') || k.has('ShiftRight') || this.virtual.run, jump: k.has('Space') };
  }
}
