// First-person capsule controller with gravity and BVH collision (after the three-mesh-bvh characterMovement
// example, MIT). Positions are in GL (y up). `feet` is the floor contact point; the eye is feet + eyeHeight.
import * as THREE from 'three';

const _box = new THREE.Box3();
const _seg = new THREE.Line3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _tri = new THREE.Vector3();
const _cap = new THREE.Vector3();
const _mInv = new THREE.Matrix4();

export class Player {
  constructor(opts = {}) {
    this.eyeHeight = opts.eyeHeight ?? 1.6;
    this.radius = opts.radius ?? 0.28;
    this.height = opts.height ?? 1.75;            // capsule total height
    this.walkSpeed = opts.walkSpeed ?? 1.6;       // m/s (calm walk in a hall)
    this.runSpeed = opts.runSpeed ?? 4.0;
    this.gravity = opts.gravity ?? -9.81;
    this.jumpSpeed = opts.jumpSpeed ?? 3.2;
    this.feet = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.onGround = false;
    this.fly = false;
    this.yaw = 0;      // rotation about GL +y; 0 = looking along GL -z (= W +y)
    this.pitch = 0;
    this.colliders = [];
    this.lastSafe = new THREE.Vector3();
    this.lastSafeYaw = 0;
    this.respawns = 0;
    this.distanceWalked = 0;
    this.substeps = 5;
    this.minGroundNormalY = Math.cos(THREE.MathUtils.degToRad(opts.maxSlopeDeg ?? 50));
  }

  /** Capsule segment endpoints relative to the feet. */
  get segStart() { return this.height - this.radius; }   // top sphere centre
  get segEnd() { return this.radius; }                   // bottom sphere centre

  setPose(feetGl, yaw = this.yaw, pitch = 0) {
    this.feet.copy(feetGl);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw; this.pitch = pitch;
    this.lastSafe.copy(feetGl);
    this.lastSafeYaw = yaw;
  }

  /** Drop the feet onto the collider below (raycast) so teleports land on the floor. */
  snapToGround(maxUp = 2.0, maxDown = 20) {
    const ray = new THREE.Raycaster(_v1.copy(this.feet).add(new THREE.Vector3(0, maxUp, 0)), new THREE.Vector3(0, -1, 0), 0, maxUp + maxDown);
    ray.firstHitOnly = true;
    const hits = ray.intersectObjects(this.colliders, false);
    if (hits.length) { this.feet.y = hits[0].point.y + 0.01; return true; }
    return false;
  }

  applyLook(dx, dy) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -1.45, 1.45);
  }

  eye(target = new THREE.Vector3()) { return target.copy(this.feet).add(_v2.set(0, this.eyeHeight, 0)); }

  applyToCamera(camera) {
    this.eye(camera.position);
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  /** move: {x: strafe right, z: forward, run, jump, up(fly)} in [-1, 1]. */
  update(dt, move) {
    dt = Math.min(dt, 0.1);
    const speed = move.run ? this.runSpeed : this.walkSpeed;
    const fwd = _v1.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = _v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3().addScaledVector(fwd, move.z || 0).addScaledVector(right, move.x || 0);
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(speed);
    const before = this.feet.clone();
    if (this.fly) {
      const flyFwd = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      const v = new THREE.Vector3().addScaledVector(flyFwd, (move.z || 0) * speed * 2)
        .addScaledVector(right, (move.x || 0) * speed * 2).addScaledVector(new THREE.Vector3(0, 1, 0), (move.up || 0) * speed * 2);
      this.feet.addScaledVector(v, dt);
      this.velocity.set(0, 0, 0);
      return;
    }
    if (move.jump && this.onGround) { this.velocity.y = this.jumpSpeed; this.onGround = false; }
    const h = dt / this.substeps;
    for (let i = 0; i < this.substeps; i++) {
      this.velocity.y += this.gravity * h;
      this.velocity.y = Math.max(this.velocity.y, -30);
      this.feet.addScaledVector(this.velocity, h);
      this.feet.addScaledVector(wish, h);
      this._collide(h);
    }
    const moved = _v1.subVectors(this.feet, before); moved.y = 0;
    this.distanceWalked += moved.length();
    if (this.onGround) { this.lastSafe.copy(this.feet); this.lastSafeYaw = this.yaw; }
    if (this.feet.y < this.minY) this.respawn();
  }

  respawn() {
    this.feet.copy(this.lastSafe).add(new THREE.Vector3(0, 0.3, 0));
    this.velocity.set(0, 0, 0);
    this.respawns++;
    this.onRespawn && this.onRespawn();
  }

  _collide(h) {
    if (!this.colliders.length) { this.onGround = false; return; }
    const r = this.radius;
    const start = _v1.copy(this.feet); start.y += this.segStart;
    const end = _v2.copy(this.feet); end.y += this.segEnd;
    const origBottom = end.clone();
    for (const col of this.colliders) {
      const bvh = col.geometry.boundsTree;
      if (!bvh) continue;
      _mInv.copy(col.matrixWorld).invert();
      _seg.start.copy(start).applyMatrix4(_mInv);
      _seg.end.copy(end).applyMatrix4(_mInv);
      _box.makeEmpty(); _box.expandByPoint(_seg.start); _box.expandByPoint(_seg.end);
      _box.min.addScalar(-r); _box.max.addScalar(r);
      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(_box),
        intersectsTriangle: (tri) => {
          const d = tri.closestPointToSegment(_seg, _tri, _cap);
          if (d < r) {
            const depth = r - d;
            const dir = _cap.sub(_tri).normalize();
            // steep contact (slope > maxSlope, e.g. a slanted machine front or a step higher than ~11 cm):
            // push horizontally only, so the capsule cannot climb it
            if (dir.y > 0 && dir.y < this.minGroundNormalY) {
              dir.y = 0;
              if (dir.lengthSq() < 1e-12) return false;
              dir.normalize();
            }
            _seg.start.addScaledVector(dir, depth);
            _seg.end.addScaledVector(dir, depth);
          }
          return false;
        },
      });
      start.copy(_seg.start).applyMatrix4(col.matrixWorld);
      end.copy(_seg.end).applyMatrix4(col.matrixWorld);
    }
    const delta = end.sub(origBottom);
    const pushedUp = delta.y;
    this.onGround = pushedUp > Math.abs(h * this.velocity.y * 0.25);
    const off = Math.max(0, delta.length() - 1e-5);
    if (off > 0) {
      delta.normalize();
      this.feet.addScaledVector(delta, off);
      if (!this.onGround) this.velocity.addScaledVector(delta, -delta.dot(this.velocity));
    }
    if (this.onGround) this.velocity.set(0, 0, 0);
  }
}
