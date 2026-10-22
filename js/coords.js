// Coordinate conventions of the ZeMA web twin. Pure functions on plain arrays (no three.js import) so that they
// can be unit-tested with `node --test` (web/tests/coords.test.mjs). Python twin: claude_v2s/rundgang/web_coords.py.
//
//  W    twin world frame: metres, right-handed, +z up, floor z = 0 (all JSON files: stations, poses, manifest).
//  GL   three.js / glTF frame: metres, right-handed, +y up (all .glb files are authored in GL).
//       p_GL = M_GL_W * p_W,  M_GL_W = [[1,0,0],[0,0,1],[0,-1,0]]   i.e. (x, y, z)_W -> (x, z, -y)_GL
//  CAM  panorama camera frame, "x_right_y_down_z_forward" (OpenCV): forward = yaw 0 = image centre column.
//       Pose JSON: R_W_cam (3x3, row-major nested arrays) and t_W (pano centre): d_W = R_W_cam * d_cam.
//  Equirect (3DVista): yaw deg, 0 = image centre, + = right (clockwise seen from above); pitch deg, + = up.
//       u = 0.5 + yaw/360 (0 = left edge), v = 0.5 - pitch/180 (0 = top edge).
//       three.js textures are flipY = true for images, so the GL texture coordinate is (u, 1 - v).

export const M_GL_W = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
export const M_W_GL = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];

const DEG = Math.PI / 180;

export function matVec(M, v) {
  return [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
  ];
}

export function matMul(A, B) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
  }
  return C;
}

export function transpose(A) {
  return [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]];
}

export function det3(A) {
  return A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
    - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
    + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
}

/** Point or direction W (z up) -> GL (y up). */
export function wToGl(p) { return [p[0], p[2], -p[1]]; }
/** Point or direction GL (y up) -> W (z up). */
export function glToW(p) { return [p[0], -p[2], p[1]]; }

/** Rotation R_W_x (frame x -> W) to R_GL_x. */
export function rotWToGl(R) { return matMul(M_GL_W, R); }

/** Heading (deg, CCW from +x_W seen from above) of a horizontal W direction. */
export function headingOfW(d) { return Math.atan2(d[1], d[0]) / DEG; }

/** Camera-frame unit ray (x right, y down, z forward) for 3DVista yaw/pitch in degrees. */
export function panoDirCam(yawDeg, pitchDeg) {
  const y = yawDeg * DEG, p = pitchDeg * DEG;
  return [Math.cos(p) * Math.sin(y), -Math.sin(p), Math.cos(p) * Math.cos(y)];
}

export function camDirToYawPitch(d) {
  const n = Math.hypot(d[0], d[1], d[2]);
  return [Math.atan2(d[0], d[2]) / DEG, Math.asin(Math.max(-1, Math.min(1, -d[1] / n))) / DEG];
}

export function yawPitchToUv(yawDeg, pitchDeg) { return [0.5 + yawDeg / 360, 0.5 - pitchDeg / 180]; }

/** Level pano: yaw 0 looks along W heading h (deg, CCW from +x). Same as web_coords.level_pano_rotation. */
export function levelPanoRotation(headingDeg) {
  const h = headingDeg * DEG;
  const fwd = [Math.cos(h), Math.sin(h), 0];
  const down = [0, 0, -1];
  const right = [down[1] * fwd[2] - down[2] * fwd[1], down[2] * fwd[0] - down[0] * fwd[2], down[0] * fwd[1] - down[1] * fwd[0]];
  return [[right[0], down[0], fwd[0]], [right[1], down[1], fwd[1]], [right[2], down[2], fwd[2]]];
}

/** Convert a rotation given in another camera convention to x_right_y_down_z_forward. */
export function toOpenCvCam(R, convention = 'x_right_y_down_z_forward') {
  const c = (convention || 'x_right_y_down_z_forward').toLowerCase();
  if (c.startsWith('x_right_y_down_z_forward') || c === 'opencv') return R;
  if (c.startsWith('x_right_y_up_z_forward')) return matMul(R, [[1, 0, 0], [0, -1, 0], [0, 0, 1]]);   // pano_tools.py (left-handed)
  if (c.startsWith('x_right_y_up_z_backward') || c === 'opengl') return matMul(R, [[1, 0, 0], [0, -1, 0], [0, 0, -1]]);
  throw new Error(`unknown camera convention ${convention}`);
}

/**
 * Pano pose (W, JSON) -> what the renderer needs, in GL:
 *   position: pano centre in GL, R_GL_cam: cam -> GL (row-major), R_cam_GL: GL -> cam (row-major).
 * pose = {R_W_cam, t_W} (+ optional cam_convention). Also accepts {yaw_offset_deg} added on top (for manual tuning).
 */
export function panoPoseToGl(pose, convention) {
  let R = toOpenCvCam(pose.R_W_cam, pose.cam_convention || convention);
  if (pose.yaw_offset_deg) {
    // extra rotation about the camera's own vertical axis (camera y is down, so + yaw = +rotation about y_cam)
    const a = pose.yaw_offset_deg * DEG;
    R = matMul(R, [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]]);
  }
  const R_GL_cam = rotWToGl(R);
  return { position: wToGl(pose.t_W), R_GL_cam, R_cam_GL: transpose(R_GL_cam) };
}

/** World (GL) direction -> equirect texture uv in GL convention (v up), for a pano with R_cam_GL. */
export function glDirToTexUv(R_cam_GL, dGl) {
  const dc = matVec(R_cam_GL, dGl);
  const [yaw, pitch] = camDirToYawPitch(dc);
  const [u, v] = yawPitchToUv(yaw, pitch);
  return [((u % 1) + 1) % 1, 1 - v];
}

/** Rotation about W z by yaw (deg) applied to a GL object: rotation about GL +y by the same angle. */
export function yawWToGlEulerY(yawDeg) { return yawDeg * DEG; }

/** Row-major 3x3 + translation -> column-major 4x4 array (three.js Matrix4.fromArray / .elements order). */
export function toMatrix4Elements(R, t = [0, 0, 0]) {
  return [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, t[0], t[1], t[2], 1];
}

/** Column-major 3x3 (three.js Matrix3.elements order) from row-major nested. */
export function toMatrix3Elements(R) {
  return [R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]];
}

/** Flat yaw (deg, 3DVista sense: + = clockwise from above) of a camera looking along GL direction d. */
export function viewYawFromGl(d) { return -headingOfW(glToW(d)); }
