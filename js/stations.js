// "Discover" mechanic: info points from stations.json that light up when near, open an info card, and count.
import * as THREE from 'three';
import { wToGl } from './coords.js';
import { pick, t } from './i18n.js';

const COL_NEW = new THREE.Color(0x2fb7c9);
const COL_DONE = new THREE.Color(0xf2b33d);
const GROUP_ORDER = ['robot', 'station', 'info'];

export class Stations {
  constructor(scene, baseUrl, storageKey) {
    this.scene = scene;
    this.baseUrl = baseUrl;
    this.storageKey = storageKey;
    this.list = [];
    this.groups = {};
    this.group = new THREE.Group();
    this.group.name = 'stations';
    scene.add(this.group);
    this.discovered = new Set(this._load());
    this.near = null;
    this.focus = null;   // the entry the player teleported to: stays the active one until its ring is left
    this.onDiscover = null;
    this.onChange = null;
    this.time = 0;
  }

  _load() {
    try { return JSON.parse(localStorage.getItem(this.storageKey) || '[]'); } catch (_) { return []; }
  }

  _save() {
    try { localStorage.setItem(this.storageKey, JSON.stringify([...this.discovered])); } catch (_) { /* private mode */ }
  }

  reset() { this.discovered.clear(); this._save(); this._recolor(); this.onChange && this.onChange(); }

  set(data) {
    const arr = Array.isArray(data) ? data : (data.stations || []);
    this.groups = (!Array.isArray(data) && data.groups) || {};
    const gem = new THREE.OctahedronGeometry(0.16, 0);
    const ringGeo = new THREE.RingGeometry(0.92, 1.0, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const beamGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 8, 1, true);
    let skipped = 0;
    for (const s of arr) {
      // Catalogue entries may not be placed yet (position_W null until the poses stage): skip them, don't crash.
      const pw = s.position_W;
      if (!s.id || !Array.isArray(pw) || pw.length !== 3 || !pw.every(Number.isFinite)) { skipped++; continue; }
      const p = new THREE.Vector3(...wToGl(pw));
      const g = new THREE.Group();
      g.name = 'station:' + s.id;
      const colNew = s.marker_color ? new THREE.Color(s.marker_color) : COL_NEW.clone();
      const mat = new THREE.MeshBasicMaterial({ color: colNew.clone(), transparent: true, opacity: 0.95, depthWrite: false });
      const gemMesh = new THREE.Mesh(gem, mat);
      gemMesh.position.copy(p).add(new THREE.Vector3(0, 0.6, 0));
      const floorY = (s.floor_z_W ?? 0);
      const ringMat = new THREE.MeshBasicMaterial({ color: colNew.clone(), transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(p.x, floorY + 0.02, p.z);
      const r = s.radius ?? 2.5;
      ring.scale.set(r, 1, r);
      const beamMat = new THREE.MeshBasicMaterial({ color: colNew.clone(), transparent: true, opacity: 0.25, depthWrite: false });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      const top = gemMesh.position.y;
      beam.scale.set(1, Math.max(top - floorY, 0.1), 1);
      beam.position.set(p.x, (top + floorY) / 2, p.z);
      g.add(gemMesh, ring, beam);
      g.renderOrder = 5;
      this.group.add(g);
      this.list.push({ ...s, group: s.group || 'station', pos: p, obj: g, gem: gemMesh, ring, beam, mats: [mat, ringMat, beamMat],
        radius: r, colNew });
    }
    if (skipped) console.warn(`stations: skipped ${skipped} entries without id or a numeric position_W [x, y, z]`);
    this._recolor();
  }

  _recolor() {
    for (const s of this.list) {
      const c = this.discovered.has(s.id) ? COL_DONE : s.colNew;
      s.mats.forEach((m) => m.color.copy(c));
    }
  }

  count() { return { found: this.list.filter((s) => this.discovered.has(s.id)).length, total: this.list.length }; }

  byId(id) { return this.list.find((s) => s.id === id) || null; }

  /** Mark as discovered (walking into the radius, or viewing the station's tour panorama). */
  discover(s) {
    if (!s || this.discovered.has(s.id)) return false;
    this.discovered.add(s.id);
    this._save();
    this._recolor();
    this.onDiscover && this.onDiscover(s);
    this.onChange && this.onChange();
    return true;
  }

  standPoint(s) {
    if (s.stand_W) return new THREE.Vector3(...wToGl(s.stand_W));
    // default: 1.5 m in front of the marker, toward the hall centre is unknown -> along -x
    const p = s.pos.clone();
    p.y = s.floor_z_W ?? 0;
    p.x -= Math.min(1.5, s.radius * 0.6);
    return p;
  }

  lookAtPoint(s) { return s.look_at_W ? new THREE.Vector3(...wToGl(s.look_at_W)) : s.pos.clone(); }

  /** After a teleport / checklist click: that entry is the one E opens while the player stays inside its ring. */
  setFocus(s) { this.focus = s || null; }

  update(dt, playerFeet, allowDiscover = true) {
    this.time += dt;
    let best = null, bestD = Infinity, focusInside = false;
    for (const s of this.list) {
      const dx = playerFeet.x - s.pos.x, dz = playerFeet.z - s.pos.z;
      const d = Math.hypot(dx, dz);
      const inside = d < s.radius;
      const pulse = inside ? 1 + 0.25 * Math.sin(this.time * 6) : 1;
      s.gem.rotation.y += dt * (inside ? 3 : 1);
      s.gem.position.y = s.pos.y + 0.6 + 0.06 * Math.sin(this.time * 2 + s.pos.x);
      s.gem.scale.setScalar(pulse * (inside ? 1.4 : 1));
      s.mats[1].opacity = inside ? 0.7 : 0.3;
      s.mats[2].opacity = inside ? 0.55 : 0.2;
      // overlapping rings: rank by distance relative to the ring radius (a small ring close by wins)
      if (inside && d / s.radius < bestD) { best = s; bestD = d / s.radius; }
      if (inside && s === this.focus) focusInside = true;
      if (inside && allowDiscover) this.discover(s);
    }
    if (this.focus && !focusInside) this.focus = null;
    this.near = this.focus || best;
    return this.near;
  }

  /** Fill the info panel DOM. */
  fillCard(s, el) {
    el.querySelector('#info-title').textContent = pick(s.title);
    const badges = el.querySelector('#info-badges');
    if (badges) {
      badges.textContent = '';
      const add = (txt, cls, title) => { const b = document.createElement('span'); b.className = 'badge ' + cls; b.textContent = txt; if (title) b.title = title; badges.appendChild(b); };
      add(this.discovered.has(s.id) ? '★ ' + t('found') : '○ ' + t('not_found'), this.discovered.has(s.id) ? 'gold' : 'dim');
      if (s.new) add(t('badge_new'), 'violet');
      if (s.approx) add('≈ ' + t('badge_approx'), 'dim', s.position_note || '');
      if (s.photo_only) add(t('badge_photo'), 'dim', t('photo_only'));
      if (s.description_generated) add(t('badge_text_twin'), 'dim', s.description_source || '');
    }
    const desc = el.querySelector('#info-desc');
    desc.textContent = '';
    for (const para of pick(s.description).split(/\n\n+/)) {
      const p = document.createElement('p'); p.textContent = para; desc.appendChild(p);
    }
    const media = el.querySelector('#info-media');
    media.textContent = '';
    for (const m of s.media || []) {
      const url = new URL(m.url, this.baseUrl).href;
      if (m.type === 'video') {
        const v = document.createElement('video'); v.src = url; v.controls = true; v.style.width = '100%'; media.appendChild(v);
      } else if (m.type === 'link') {
        const a = document.createElement('a'); a.href = url; a.textContent = pick(m.caption) || url; a.target = '_blank'; a.rel = 'noopener'; media.appendChild(a);
      } else {
        const img = document.createElement('img'); img.src = url; img.alt = pick(m.caption) || ''; img.loading = 'lazy'; media.appendChild(img);
      }
      if (m.caption && m.type !== 'link') { const c = document.createElement('div'); c.className = 'cap'; c.textContent = pick(m.caption); media.appendChild(c); }
    }
  }

  /** Checklist grouped by `group` (robot / station / info), with a progress bar; click = teleport. */
  fillList(ul, onPick, progressEl) {
    ul.textContent = '';
    const c = this.count();
    if (progressEl) {
      progressEl.querySelector('.bar > div').style.width = `${c.total ? (100 * c.found / c.total) : 0}%`;
      progressEl.querySelector('.txt').textContent = t('progress').replace('{n}', c.found).replace('{t}', c.total)
        + (c.found === c.total && c.total ? ' – ' + t('all_found') : '');
    }
    const groups = [...new Set([...GROUP_ORDER, ...this.list.map((s) => s.group)])];
    for (const g of groups) {
      const items = this.list.filter((s) => s.group === g);
      if (!items.length) continue;
      const h = document.createElement('li');
      h.className = 'group-h';
      const n = items.filter((s) => this.discovered.has(s.id)).length;
      h.textContent = `${pick(this.groups[g]) || g} · ${n}/${items.length}`;
      ul.appendChild(h);
      for (const s of items) {
        const li = document.createElement('li');
        li.dataset.id = s.id;
        const done = this.discovered.has(s.id);
        if (done) li.classList.add('done');
        const chk = document.createElement('span'); chk.className = 'chk'; chk.textContent = done ? '★' : '○';
        const name = document.createElement('span'); name.className = 'name'; name.textContent = pick(s.short) || pick(s.title);
        name.title = pick(s.title);
        li.append(chk, name);
        if (s.new) { const b = document.createElement('span'); b.className = 'badge violet'; b.textContent = t('badge_new'); li.appendChild(b); }
        if (s.approx) { const b = document.createElement('span'); b.className = 'badge dim'; b.textContent = '≈'; b.title = t('badge_approx'); li.appendChild(b); }
        if (s.photo_only) { const b = document.createElement('span'); b.className = 'badge dim'; b.textContent = t('badge_photo'); b.title = t('photo_only'); li.appendChild(b); }
        li.title = t('stations_hint');
        li.addEventListener('click', () => onPick(s));
        ul.appendChild(li);
      }
    }
  }
}
