/**
 * Receipt Dragon geometry, derived from the brand master (brand/source/mark.py): the same 13 spine
 * control points, the same body-width profile and the same head paths, mapped from the 1024 grid
 * (orbit centre 512, radius 440) to a unit ring in 3D (x right, y up). Nothing here crosses r = 1.
 */
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BRAND } from "@/components/brand/paths";

const CX = 512;
const R = 440;
const D = 880;
const BODY_MAX = D / 9;
const BODY_MIN = D / 27;
const HEAD_ANGLE = (-20 * Math.PI) / 180;
const HEAD_ORIGIN: [number, number] = [582, 352];

const toUnit = (x: number, y: number): [number, number] => [(x - CX) / R, -(y - CX) / R];

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** mark.py body_width(u): u = 0 at the tail tip, 1 at the neck (grid units). */
export function bodyWidth(u: number): number {
  if (u < 0.09) return BODY_MIN * (u / 0.09) ** 0.85;
  const belly = BODY_MIN + (BODY_MAX - BODY_MIN) * smoothstep(0.09, 0.42, u);
  const neck = BODY_MAX - BODY_MAX * 0.26 * smoothstep(0.66, 0.97, u);
  return Math.min(belly, neck);
}

/** mark.py spine_points(): tail tip near the centre, out to the neck joint under the head. */
export function spinePoints(): THREE.Vector3[] {
  const hx = Math.cos(HEAD_ANGLE);
  const hy = Math.sin(HEAD_ANGLE);
  const neckIn: [number, number] = [HEAD_ORIGIN[0] + 34 * hx, HEAD_ORIGIN[1] + 34 * hy];
  const pts: Array<[number, number]> = [
    [386, 782],
    [452, 856],
    [586, 880],
    [704, 826],
    [730, 708],
    [650, 616],
    [506, 566],
    [360, 504],
    [316, 386],
    [382, 292],
    [490, 262],
    [566, 296],
    neckIn,
  ];
  return pts.map(([x, y], i) => {
    const [ux, uy] = toUnit(x, y);
    // A gentle depth wave gives the coil volume without leaving the ring plane.
    const t = i / (pts.length - 1);
    const z = 0.09 * Math.sin(t * Math.PI * 2.2) * (1 - t * 0.6);
    return new THREE.Vector3(ux, uy, z);
  });
}

export function spineCurve(): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(spinePoints(), false, "centripetal", 0.5);
}

export interface SpineFrame {
  p: THREE.Vector3;
  t: THREE.Vector3;
  n: THREE.Vector3; // in-plane normal (width direction)
  b: THREE.Vector3; // depth direction (towards the camera)
  r: number; // half body width, unit ring
}

/** Stable frames for a near-planar curve: normal = z x tangent, binormal = +z. */
export function spineFrame(curve: THREE.CatmullRomCurve3, u: number): SpineFrame {
  const p = curve.getPointAt(u);
  const t = curve.getTangentAt(u).normalize();
  const z = new THREE.Vector3(0, 0, 1);
  const n = new THREE.Vector3().crossVectors(z, t).normalize();
  const b = new THREE.Vector3().crossVectors(t, n).normalize();
  return { p, t, n, b, r: bodyWidth(u) / R / 2 };
}

/** Tapered tube with an elliptical (ribbon-like) cross-section, depth = DEPTH x width. */
export const DEPTH = 0.5;
export function bodyGeometry(curve: THREE.CatmullRomCurve3, segments = 240, radial = 24): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const f = spineFrame(curve, u);
    const r = Math.max(f.r, 0.0015);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const v = f.p.clone().addScaledVector(f.n, r * c).addScaledVector(f.b, r * DEPTH * s);
      pos.push(v.x, v.y, v.z);
      const nn = f.n.clone().multiplyScalar(c / 1).addScaledVector(f.b, s / DEPTH).normalize();
      nor.push(nn.x, nn.y, nn.z);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** The head group (outline with the even-odd eye, antlers, tine, whisker) extruded from the master paths. */
export function headGeometry(): THREE.BufferGeometry {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${BRAND.mark.head
    .map((p) => `<path fill-rule="evenodd" d="${p.d}"/>`)
    .join("")}</svg>`;
  const data = new SVGLoader().parse(svg);
  const geos: THREE.BufferGeometry[] = [];
  for (const path of data.paths) {
    const shapes = SVGLoader.createShapes(path);
    const g = new THREE.ExtrudeGeometry(shapes, {
      depth: 8,
      bevelEnabled: true,
      bevelThickness: 9,
      bevelSize: 4.5,
      bevelSegments: 4,
      curveSegments: 8,
    });
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false) ?? geos[0]!;
  // SVG grid -> unit ring. Flipping y and z together keeps the winding (a rotation, not a mirror).
  merged.translate(-CX, -CX, -4);
  merged.scale(1 / R, -1 / R, -1 / R);
  merged.computeVertexNormals();
  return merged;
}

/** Snout tip and pearl, in unit coordinates (mark.py HEAD_OUTLINE[13] and pearl_center()). */
export function snoutTip(): THREE.Vector3 {
  const s = 1.1;
  const [lx, ly] = [250, -14];
  const x = HEAD_ORIGIN[0] + s * (lx * Math.cos(HEAD_ANGLE) - ly * Math.sin(HEAD_ANGLE));
  const y = HEAD_ORIGIN[1] + s * (lx * Math.sin(HEAD_ANGLE) + ly * Math.cos(HEAD_ANGLE));
  const [ux, uy] = toUnit(x, y);
  return new THREE.Vector3(ux, uy, 0.02);
}

export const PEARL_ANGLE = (30 * Math.PI) / 180; // 2 o'clock, y up
export const PEARL_RADIUS = D / 12 / 2 / R;

export interface ScaleSlot {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  /** 0 = nearest the head (newest receipt), increasing towards the tail. */
  order: number;
}

/** Receipt slots: staggered rows of scales on the camera-facing half of the body, newest at the head. */
export function scaleSlots(curve: THREE.CatmullRomCurve3, rows = 74, perRow = 5): ScaleSlot[] {
  const slots: ScaleSlot[] = [];
  const u0 = 0.93;
  const u1 = 0.11;
  for (let row = 0; row < rows; row++) {
    const u = u0 - ((u0 - u1) * row) / (rows - 1);
    const f = spineFrame(curve, u);
    const stagger = row % 2 ? 0.5 : 0;
    const span = 2.1; // radians of the cross-section covered, centred on the camera-facing point
    for (let k = 0; k < perRow; k++) {
      const a = -span / 2 + (span * (k + 0.25 + stagger * 0.5)) / perRow;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // point on the ellipse (width along n, depth along b), camera-facing half
      const pos = f.p.clone().addScaledVector(f.n, f.r * s).addScaledVector(f.b, f.r * DEPTH * c * 1.02);
      const normal = f.n.clone().multiplyScalar(s / 1).addScaledVector(f.b, c / DEPTH).normalize();
      // orient: local +y = surface normal, local +z = towards the tail (overlap like scales)
      const back = f.t.clone().negate();
      const x = new THREE.Vector3().crossVectors(normal, back).normalize();
      const z = new THREE.Vector3().crossVectors(x, normal).normalize();
      const m = new THREE.Matrix4().makeBasis(x, normal, z);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      const tilt = new THREE.Quaternion().setFromAxisAngle(x, -0.32);
      q.premultiply(tilt);
      const size = Math.max(f.r * 0.42, 0.006);
      slots.push({ position: pos, quaternion: q, scale: new THREE.Vector3(size * 0.95, size * 0.32, size * 1.25), order: row * perRow + k });
    }
  }
  return slots;
}
