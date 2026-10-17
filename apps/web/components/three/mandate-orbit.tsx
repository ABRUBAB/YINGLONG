"use client";

/**
 * Mandate Orbit: the landing hero's 3D scene. Every object is data:
 *  - the chrome ring is the sealed mandate; its bright arc is the share of this period's budget left;
 *  - 64 ticks outside the ring are the Hash Ring of the live delegation hash (one nibble per tick);
 *  - the steel pearl on the ring is the agent's on-chain identity; it pulses when the batch lands;
 *  - each coin is one accountability receipt from GET /v1/receipts, inside the ring on the track of
 *    the authority it needed (lib/orbit-layout.ts); brass coins on the ring wait on a person, brass
 *    coins at the centre are "Not sure, your call";
 *  - graphite shards outside the ring are refused or reverted attempts. They keep pressing on the
 *    boundary and deflect off it; none ever crosses.
 * Motion: the disc turns once every three minutes and refusals keep arriving (both stop under the
 * page's Pause motion control and reduced motion); on load every receipt travels from the agent at
 * the centre to its slot; the pointer tilts the instrument. Budgets: 9 draw calls, < 20k triangles.
 *
 * Frame budget (measured in the redesign report):
 *  - frames are drawn only while the stage is on screen, the tab is visible and motion is on
 *    (frameloop "always" then; otherwise "demand", and every data change calls invalidate());
 *  - nothing is allocated per frame; the coins' matrices are written only while they travel, after
 *    which the disc's own rotation moves them (one matrix per frame instead of 120);
 *  - one InstancedMesh (one draw call) per object family: coins, shards, ticks;
 *  - DPR [1, 1.5] desktop and [1, 1.25] touch, lowered by PerformanceMonitor when frames drop and
 *    raised again when they recover (the look never changes, only the pixel density); Bloom on
 *    desktop pointers;
 *  - the default framebuffer has no MSAA when the composer draws (the composer would discard it).
 * WebGPU: three 0.186's WebGPURenderer is not used. pmndrs postprocessing (the Bloom pass) and
 * drei's Environment cube render are WebGL-only, and its WebGL2 fallback is a different backend
 * from WebGLRenderer; WebGLRenderer on WebGL2 stays the one path every supported browser takes,
 * including mainland browsers without WebGPU.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Environment, Lightformer, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitSlot } from "@/lib/orbit-layout";
import { TRACKS } from "@/lib/orbit-layout";
import { useTheme } from "@/components/preferences";

export interface MandateOrbitProps {
  slots: OrbitSlot[];
  /** Share of the period budget still unspent, 0..1. */
  remaining: number;
  /** Tick lengths (ring units) from the live delegation hash, 64 entries, or null when no mandate is live. */
  ticks: number[] | null;
  motion: boolean;
  /** False while the stage is off-screen: no frames are drawn at all. */
  active: boolean;
  /** Increment to replay the arrival. */
  playKey: number;
  /** Pointer position over the hero, -1..1 on both axes (written by the hero, read every frame). */
  pointer: React.RefObject<{ x: number; y: number }>;
  poster?: boolean;
  onFirstFrame?: () => void;
  onHover?: (slot: OrbitSlot | null, x: number, y: number) => void;
}

/**
 * Scene colours per theme, matching the CSS tokens (scripts/tokens.mjs): jade = inside the rules, brass = waiting on
 * a person, seal = the pearl (the agent's on-chain identity), ash = refused. WebGL cannot read the OKLCH custom
 * properties, so the hex values are mirrored here; light uses ink on paper with less metal so nothing washes out.
 */
const PALETTES = {
  dark: {
    inside: new THREE.Color("#3DE35B"),
    waiting: new THREE.Color("#FFB84D"),
    asked: new THREE.Color("#F2A93B"),
    refused: new THREE.Color("#69717D"),
    ringOn: new THREE.Color("#F2F4F7"),
    ringOff: new THREE.Color("#3A4049"),
    track: "#3A414B",
    tick: "#AEB6C1",
    pearl: "#FF5A5F",
    agent: "#DDE2E8",
    metal: 1,
    rough: 0.16,
    coinMetal: 0.35,
  },
  light: {
    inside: new THREE.Color("#0F766E"),
    waiting: new THREE.Color("#7A5A10"),
    asked: new THREE.Color("#8A6A1E"),
    refused: new THREE.Color("#A3A199"),
    ringOn: new THREE.Color("#1D1C1A"),
    ringOff: new THREE.Color("#C3C1B9"),
    track: "#C3C1B9",
    tick: "#46453F",
    pearl: "#A62E1C",
    agent: "#2B2A27",
    metal: 0.55,
    rough: 0.35,
    coinMetal: 0.05,
  },
};

const TAU = Math.PI * 2;
const ARRIVE_S = 1.05;
const STAGGER_S = 0.011;
const TURN_S = 180; // one revolution every three minutes
const easeOut = (t: number) => 1 - (1 - t) ** 3;

function FirstFrame({ onFirstFrame }: { onFirstFrame?: () => void }) {
  const done = useRef(false);
  useFrame(() => {
    if (!done.current) {
      done.current = true;
      requestAnimationFrame(() => onFirstFrame?.());
    }
  });
  return null;
}

/**
 * Frames the instrument for whatever box the canvas gets: the tilted ring with its Hash Ring ticks is
 * projected to screen space at rest (no pointer tilt), then the camera's zoom scales its bounding
 * box to INSTRUMENT_WIDTH of the canvas width (or INSTRUMENT_HEIGHT of its height, whichever binds)
 * and a view offset centres it horizontally and vertically. The camera itself never moves, so the
 * perspective is the one the poster was drawn with, and a 16:10 poster shown with object-fit:
 * contain lines up with the canvas in any box narrower than 16:10.
 */
const INSTRUMENT_R = 1.21; // outer end of the longest Hash Ring tick, ring units
const INSTRUMENT_WIDTH = 0.94;
const INSTRUMENT_HEIGHT = 0.84;
const LOOK_AT = new THREE.Vector3(0, -0.06, 0);

function FitInstrument() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (width < 2 || height < 2) return;
    camera.aspect = width / height;
    camera.zoom = 1;
    camera.clearViewOffset();
    camera.lookAt(LOOK_AT);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    // The disc sits in a group tilted 0.04 rad about x (see <Orbit>).
    const tilt = new THREE.Matrix4().makeRotationX(0.04);
    const p = new THREE.Vector3();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * TAU;
      p.set(INSTRUMENT_R * Math.cos(a), 0, -INSTRUMENT_R * Math.sin(a)).applyMatrix4(tilt).project(camera);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    // NDC spans 2 units across the canvas.
    const zoom = Math.min((INSTRUMENT_WIDTH * 2) / (maxX - minX), (INSTRUMENT_HEIGHT * 2) / (maxY - minY));
    const cx = ((minX + maxX) / 2) * zoom; // centre after zooming, NDC
    const cy = ((minY + maxY) / 2) * zoom;
    camera.zoom = zoom;
    // Shift the view window onto the instrument's centre (offsets are in pixels of the full view).
    camera.setViewOffset(width, height, (cx * width) / 2, (-cy * height) / 2, width, height);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, width, height, invalidate]);
  return null;
}

/** Pauses the loop while the tab is hidden (some browsers keep rAF alive for visible iframes). */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

interface Shard {
  home: number;
  a: number;
  cos: number;
  sin: number;
  y: number;
  size: number;
  r: number;
  vr: number;
  rx: number;
  ry: number;
  rz: number;
  next: number;
}

function Orbit({ slots, remaining, ticks, motion, playKey, pointer, poster, onHover }: Omit<MandateOrbitProps, "active" | "onFirstFrame">) {
  const pal = PALETTES[useTheme()];
  const invalidate = useThree((s) => s.invalidate);
  const disc = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const coins = useRef<THREE.InstancedMesh>(null);
  const shards = useRef<THREE.InstancedMesh>(null);
  const pearl = useRef<THREE.Mesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const clock = useRef({ start: -1, settled: false });

  const inside = useMemo(() => slots.filter((s) => s.kind !== "refused"), [slots]);
  const outside = useMemo(() => slots.filter((s) => s.kind === "refused"), [slots]);

  // Coin targets, computed once per data change: x, y, z, size, angle per coin.
  const targets = useMemo(() => {
    const t = new Float32Array(inside.length * 5);
    inside.forEach((s, i) => {
      t[i * 5] = s.r * Math.cos(s.a);
      t[i * 5 + 1] = 0.012 + s.y;
      t[i * 5 + 2] = -s.r * Math.sin(s.a);
      t[i * 5 + 3] = s.kind === "waiting" ? 0.04 : s.kind === "asked" ? 0.026 : 0.03;
      t[i * 5 + 4] = s.a;
    });
    return t;
  }, [inside]);

  const shardState = useRef<Shard[]>([]);
  useEffect(() => {
    shardState.current = outside.map((s, k) => ({
      home: s.r,
      a: s.a,
      cos: Math.cos(s.a),
      sin: Math.sin(s.a),
      y: 0.02 + ((k % 7) - 3) * 0.012,
      size: 0.034 + (k % 3) * 0.006,
      r: poster || !motion ? s.r : 2.4 + (k % 5) * 0.12,
      vr: poster || !motion ? 0 : -1.6,
      rx: k * 0.7,
      ry: k * 1.3,
      rz: k * 0.4,
      next: 3 + ((k * 2.618) % 9),
    }));
    invalidate();
  }, [outside, motion, poster, invalidate]);

  // Geometry
  const coinGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 0.2, 28, 1), []);
  const shardGeo = useMemo(() => new THREE.OctahedronGeometry(1, 0), []);
  const ringGeo = useMemo(() => {
    const g = new THREE.TorusGeometry(1, 0.0125, 12, 480);
    const pos = g.getAttribute("position");
    const bright = pal.ringOn;
    const ash = pal.ringOff;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getY(i), pos.getX(i));
      let fromTop = (Math.PI / 2 - a) / TAU;
      fromTop = ((fromTop % 1) + 1) % 1;
      const c = fromTop <= remaining ? bright : ash;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, [remaining, pal]);
  const trackGeo = useMemo(() => {
    const pts: number[] = [];
    for (const t of ["t1", "t2", "t3"] as const) {
      const r = (TRACKS[t][0] + TRACKS[t][1]) / 2;
      for (let i = 0; i < 192; i++) {
        const a0 = (i / 192) * TAU;
        const a1 = ((i + 1) / 192) * TAU;
        pts.push(r * Math.cos(a0), 0, -r * Math.sin(a0), r * Math.cos(a1), 0, -r * Math.sin(a1));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  useEffect(() => () => [coinGeo, shardGeo, ringGeo, trackGeo].forEach((g) => g.dispose()), [coinGeo, shardGeo, ringGeo, trackGeo]);
  const tickMesh = useRef<THREE.InstancedMesh>(null);
  const tickGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

  // Hash Ring ticks: tick i at 12 o'clock + i * 5.625 degrees clockwise, length from its nibble.
  useEffect(() => {
    const m = tickMesh.current;
    if (!m) return;
    const list = ticks ?? [];
    for (let i = 0; i < 64; i++) {
      const len = list[i];
      if (len === undefined) {
        tmp.position.set(0, 0, 0);
        tmp.rotation.set(0, 0, 0);
        tmp.scale.setScalar(0);
      } else {
        const a = Math.PI / 2 - (i * 5.625 * Math.PI) / 180;
        const L = len * 0.85;
        const r = 1.045 + L / 2;
        tmp.position.set(r * Math.cos(a), 0, -r * Math.sin(a));
        tmp.rotation.set(0, a, 0);
        tmp.scale.set(L, 0.004, 0.0075);
      }
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [ticks, tmp, invalidate]);

  // Coin colours
  useEffect(() => {
    const m = coins.current;
    if (!m) return;
    inside.forEach((s, i) => m.setColorAt(i, pal[s.kind]));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    const sh = shards.current;
    if (sh) {
      outside.forEach((_, i) => sh.setColorAt(i, pal.refused));
      if (sh.instanceColor) sh.instanceColor.needsUpdate = true;
    }
    invalidate();
  }, [inside, outside, invalidate, pal]);

  // Arrival replay
  useEffect(() => {
    clock.current.start = poster || !motion ? -1 : performance.now();
    clock.current.settled = false;
    invalidate();
  }, [playKey, motion, poster, targets, invalidate]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const m = coins.current;
    const sh = shards.current;
    const tl = tilt.current;
    const d = disc.current;
    if (!m || !sh || !tl || !d) return;

    // Pointer tilt (spring-like damping), and the slow turn of the disc.
    const px = poster ? 0 : (pointer.current?.x ?? 0);
    const py = poster ? 0 : (pointer.current?.y ?? 0);
    tl.rotation.x = THREE.MathUtils.damp(tl.rotation.x, py * 0.14, 3.2, dt);
    tl.rotation.z = THREE.MathUtils.damp(tl.rotation.z, -px * 0.1, 3.2, dt);
    if (motion && !poster) d.rotation.y -= (TAU / TURN_S) * dt;

    // Coins: travel from the agent at the centre to their slot, newest first. Once every coin has
    // landed (and its final matrix is written), the instance buffer is left alone.
    const elapsed = clock.current.start < 0 ? Infinity : (performance.now() - clock.current.start) / 1000;
    let arriving = false;
    if (!clock.current.settled) {
      const n = inside.length;
      for (let i = 0; i < n; i++) {
        const p = Math.min(1, Math.max(0, (elapsed - i * STAGGER_S) / ARRIVE_S));
        if (p < 1) arriving = true;
        const e = easeOut(p);
        const o = i * 5;
        tmp.position.set(targets[o]! * e, 0.05 * (1 - e) + targets[o + 1]!, targets[o + 2]! * e);
        tmp.scale.setScalar(targets[o + 3]! * (0.45 + 0.55 * e));
        tmp.rotation.set(0, targets[o + 4]!, 0);
        tmp.updateMatrix();
        m.setMatrixAt(i, tmp.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
      if (!arriving) clock.current.settled = true;
    }

    // Refusals: each keeps returning to the boundary and deflects off it (CPU, one InstancedMesh).
    const t = state.clock.elapsedTime;
    const list = shardState.current;
    const moving = motion && !poster;
    for (let i = 0; i < list.length; i++) {
      const s = list[i]!;
      if (moving) {
        if (t > s.next) {
          s.vr = -0.9 - (i % 4) * 0.12; // a new attempt towards the ring
          s.next = t + 6 + ((i * 1.618) % 8);
        }
        s.vr += (s.home - s.r) * 1.6 * dt; // drift back to its place outside
        s.vr *= 1 - 0.9 * dt;
        s.r += s.vr * dt;
        if (s.r < 1.06 && s.vr < 0) {
          s.r = 1.06;
          s.vr = -s.vr * 0.55; // deflect: the boundary holds
        }
        s.rx += dt * 0.9;
        s.ry += dt * 0.6;
      }
      tmp.position.set(s.r * s.cos, s.y, -s.r * s.sin);
      tmp.rotation.set(s.rx, s.ry, s.rz);
      tmp.scale.setScalar(s.size);
      tmp.updateMatrix();
      sh.setMatrixAt(i, tmp.matrix);
    }
    sh.instanceMatrix.needsUpdate = true;

    // Pearl: one pulse as the last receipt lands (the batch is bound to the identity).
    const pe = pearl.current;
    if (pe) {
      const landed = inside.length * STAGGER_S + ARRIVE_S;
      const k = elapsed - landed;
      pe.scale.setScalar(k > 0 && k < 0.7 ? 1 + 0.45 * Math.sin((k / 0.7) * Math.PI) : 1);
      if (!motion && k > -ARRIVE_S && k < 0.7) arriving = true;
    }
    // On demand (motion off or poster): keep drawing only until the arrival and the tilt settle.
    if (!moving && (arriving || Math.abs(tl.rotation.x - py * 0.14) > 1e-4 || Math.abs(tl.rotation.z + px * 0.1) > 1e-4)) invalidate();
  });

  const hover = (list: OrbitSlot[]) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const s = e.instanceId !== undefined ? list[e.instanceId] : undefined;
    onHover?.(s ?? null, e.nativeEvent.clientX, e.nativeEvent.clientY);
  };

  const pearlPos = useMemo(() => new THREE.Vector3(Math.cos(Math.PI / 6), 0, -Math.sin(Math.PI / 6)), []);

  return (
    <group ref={tilt}>
      <group rotation={[0.04, 0, 0]}>
        <group ref={disc}>
          {/* the mandate */}
          <mesh geometry={ringGeo} rotation={[-Math.PI / 2, 0, 0]}>
            <meshPhysicalMaterial vertexColors metalness={pal.metal} roughness={pal.rough + 0.04} clearcoat={0.6} clearcoatRoughness={0.2} />
          </mesh>
          {/* authority tracks (T1, T2, T3) */}
          <lineSegments geometry={trackGeo}>
            <lineBasicMaterial color={pal.track} transparent opacity={0.55} />
          </lineSegments>
          {/* Hash Ring ticks of the live delegation hash */}
          <instancedMesh ref={tickMesh} args={[tickGeo, undefined, 64]} frustumCulled={false}>
            <meshStandardMaterial color={pal.tick} metalness={pal.metal} roughness={0.3} />
          </instancedMesh>
          {/* the pearl: the agent's on-chain identity (2 o'clock) */}
          <mesh ref={pearl} position={pearlPos}>
            <sphereGeometry args={[0.046, 32, 16]} />
            <meshStandardMaterial color={pal.pearl} emissive={pal.pearl} emissiveIntensity={0.35} metalness={0} roughness={0.38} />
          </mesh>
          {/* the agent at the centre */}
          <mesh position={[0, 0.03, 0]}>
            <sphereGeometry args={[0.05, 32, 16]} />
            <meshPhysicalMaterial color={pal.agent} metalness={pal.metal} roughness={pal.rough} clearcoat={0.8} />
          </mesh>
          {/* receipts the mandate allowed, waiting on a person, or asked */}
          <instancedMesh
            ref={coins}
            args={[coinGeo, undefined, Math.max(1, inside.length)]}
            frustumCulled={false}
            onPointerMove={hover(inside)}
            onPointerOut={() => onHover?.(null, 0, 0)}
          >
            <meshStandardMaterial metalness={pal.coinMetal} roughness={0.42} />
          </instancedMesh>
          {/* refused attempts, outside the boundary */}
          <instancedMesh
            ref={shards}
            args={[shardGeo, undefined, Math.max(1, outside.length)]}
            frustumCulled={false}
            onPointerMove={hover(outside)}
            onPointerOut={() => onHover?.(null, 0, 0)}
          >
            <meshStandardMaterial metalness={0.7} roughness={0.42} />
          </instancedMesh>
        </group>
      </group>
    </group>
  );
}

/** Asks for a frame at a fixed rate: the scene turns once in three minutes, so 30 fps looks the same as 60. */
function Ticker({ on, fps }: { on: boolean; fps: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => invalidate(), 1000 / fps);
    return () => window.clearInterval(id);
  }, [on, fps, invalidate]);
  return null;
}

export default function MandateOrbit(props: MandateOrbitProps) {
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const visible = useDocumentVisible();
  const maxDpr = props.poster ? 2 : touch ? 1 : 1.25;
  const [dpr, setDpr] = useState(maxDpr);
  const live = props.active && visible;
  // Frames on demand: a 30 fps timer while the stage is live and moving, nothing when it is not.
  const frameloop = !live ? "never" : "demand";
  const ticking = live && props.motion && !props.poster;
  return (
    <Canvas
      frameloop={frameloop}
      dpr={dpr}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: Boolean(props.poster), stencil: false }}
      camera={{ fov: 23, position: [0, 2.35, 4.15], near: 0.1, far: 40 }}
      onCreated={({ gl, camera }) => {
        gl.setClearColor(0x000000, 0);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        camera.lookAt(0, -0.06, 0);
      }}
      aria-hidden="true"
      style={{ touchAction: "pan-y" }}
    >
      <FitInstrument />
      <Ticker on={ticking} fps={30} />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.6} position={[0, 5, 1]} rotation-x={Math.PI / 2} scale={[10, 3, 1]} />
        <Lightformer form="rect" intensity={1.4} position={[-5, 1, 1]} rotation-y={Math.PI / 2} scale={[8, 1.2, 1]} />
        <Lightformer form="rect" intensity={0.9} position={[5, 0.5, -1]} rotation-y={-Math.PI / 2} scale={[8, 0.8, 1]} />
        <Lightformer form="ring" intensity={1.2} position={[0, 2, -6]} scale={5} />
        <Lightformer form="rect" intensity={1.2} position={[1, 1.5, 6]} scale={[8, 4, 1]} />
      </Environment>
      <Orbit {...props} />
      <FirstFrame onFirstFrame={props.onFirstFrame} />
      {!props.poster ? (
        <PerformanceMonitor
          bounds={(refresh) => (refresh > 90 ? [50, 90] : [45, 60])}
          flipflops={3}
          onChange={({ factor }) => setDpr(Math.round((1 + (maxDpr - 1) * factor) * 20) / 20)}
          onFallback={() => setDpr(1)}
        />
      ) : null}
    </Canvas>
  );
}
