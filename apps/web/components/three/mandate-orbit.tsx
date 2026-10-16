"use client";

/**
 * Mandate Orbit: the landing hero's 3D scene (docs/DESIGN.md section 8). Every object is data:
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
 */
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { AdaptiveDpr, Environment, Lightformer, PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import type { OrbitSlot } from "@/lib/orbit-layout";
import { TRACKS } from "@/lib/orbit-layout";

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

const COLORS = {
  inside: new THREE.Color("#B9C1CB"),
  waiting: new THREE.Color("#D3B46B"),
  asked: new THREE.Color("#C9A95E"),
  refused: new THREE.Color("#69717D"),
};

const TAU = Math.PI * 2;
const ARRIVE_S = 1.05;
const STAGGER_S = 0.011;
const TURN_S = 180; // one revolution every three minutes
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const polar = (r: number, a: number, y = 0) => new THREE.Vector3(r * Math.cos(a), y, -r * Math.sin(a));

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

interface Shard {
  home: number;
  a: number;
  r: number;
  vr: number;
  spin: THREE.Euler;
  next: number;
}

function Orbit({ slots, remaining, ticks, motion, playKey, pointer, poster, onHover }: Omit<MandateOrbitProps, "active" | "onFirstFrame">) {
  const invalidate = useThree((s) => s.invalidate);
  const disc = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const coins = useRef<THREE.InstancedMesh>(null);
  const shards = useRef<THREE.InstancedMesh>(null);
  const pearl = useRef<THREE.Mesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const clock = useRef({ start: -1 });

  const inside = useMemo(() => slots.filter((s) => s.kind !== "refused"), [slots]);
  const outside = useMemo(() => slots.filter((s) => s.kind === "refused"), [slots]);
  const shardState = useRef<Shard[]>([]);
  useEffect(() => {
    shardState.current = outside.map((s, k) => ({
      home: s.r,
      a: s.a,
      r: poster || !motion ? s.r : 2.4 + (k % 5) * 0.12,
      vr: poster || !motion ? 0 : -1.6,
      spin: new THREE.Euler(k * 0.7, k * 1.3, k * 0.4),
      next: 3 + ((k * 2.618) % 9),
    }));
  }, [outside, motion, poster]);

  // Geometry
  const coinGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 0.2, 28, 1), []);
  const shardGeo = useMemo(() => new THREE.OctahedronGeometry(1, 0), []);
  const ringGeo = useMemo(() => {
    const g = new THREE.TorusGeometry(1, 0.0125, 12, 480);
    const pos = g.getAttribute("position");
    const bright = new THREE.Color("#F2F4F7");
    const ash = new THREE.Color("#3A4049");
    const colors: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getY(i), pos.getX(i));
      let fromTop = (Math.PI / 2 - a) / TAU;
      fromTop = ((fromTop % 1) + 1) % 1;
      const c = fromTop <= remaining ? bright : ash;
      colors.push(c.r, c.g, c.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return g;
  }, [remaining]);
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
        tmp.scale.setScalar(0);
      } else {
        const a = Math.PI / 2 - (i * 5.625 * Math.PI) / 180;
        const L = len * 0.85;
        tmp.position.copy(polar(1.045 + L / 2, a));
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
    inside.forEach((s, i) => m.setColorAt(i, COLORS[s.kind]));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    const sh = shards.current;
    if (sh) {
      outside.forEach((_, i) => sh.setColorAt(i, COLORS.refused));
      if (sh.instanceColor) sh.instanceColor.needsUpdate = true;
    }
    invalidate();
  }, [inside, outside, invalidate]);

  // Arrival replay
  useEffect(() => {
    clock.current.start = poster || !motion ? -1 : performance.now();
    invalidate();
  }, [playKey, motion, poster, slots, invalidate]);

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

    // Coins: travel from the agent at the centre to their slot, newest first.
    const elapsed = clock.current.start < 0 ? Infinity : (performance.now() - clock.current.start) / 1000;
    let arriving = false;
    inside.forEach((s, i) => {
      const p = Math.min(1, Math.max(0, (elapsed - i * STAGGER_S) / ARRIVE_S));
      if (p < 1) arriving = true;
      const e = easeOut(p);
      const target = polar(s.r, s.a, 0.012 + s.y);
      tmp.position.set(target.x * e, 0.05 * (1 - e) + target.y, target.z * e);
      const size = s.kind === "waiting" ? 0.04 : s.kind === "asked" ? 0.026 : 0.03;
      tmp.scale.setScalar(size * (0.45 + 0.55 * e));
      tmp.rotation.set(0, s.a, 0);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
    });
    m.instanceMatrix.needsUpdate = true;

    // Refusals: each keeps returning to the boundary and deflects off it (CPU, one InstancedMesh).
    const t = state.clock.elapsedTime;
    shardState.current.forEach((s, i) => {
      if (motion && !poster) {
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
        s.spin.x += dt * 0.9;
        s.spin.y += dt * 0.6;
      }
      tmp.position.copy(polar(s.r, s.a, 0.02 + ((i % 7) - 3) * 0.012));
      tmp.rotation.copy(s.spin);
      tmp.scale.setScalar(0.034 + (i % 3) * 0.006);
      tmp.updateMatrix();
      sh.setMatrixAt(i, tmp.matrix);
    });
    sh.instanceMatrix.needsUpdate = true;

    // Pearl: one pulse as the last receipt lands (the batch is bound to the identity).
    const pe = pearl.current;
    if (pe) {
      const landed = inside.length * STAGGER_S + ARRIVE_S;
      const k = elapsed - landed;
      pe.scale.setScalar(k > 0 && k < 0.7 ? 1 + 0.45 * Math.sin((k / 0.7) * Math.PI) : 1);
    }
    if (!motion && arriving) invalidate();
  });

  const hover = (list: OrbitSlot[]) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const s = e.instanceId !== undefined ? list[e.instanceId] : undefined;
    onHover?.(s ?? null, e.nativeEvent.clientX, e.nativeEvent.clientY);
  };

  return (
    <group ref={tilt}>
      <group rotation={[0.04, 0, 0]}>
        <group ref={disc}>
          {/* the mandate */}
          <mesh geometry={ringGeo} rotation={[-Math.PI / 2, 0, 0]}>
            <meshPhysicalMaterial vertexColors metalness={1} roughness={0.2} clearcoat={0.6} clearcoatRoughness={0.2} />
          </mesh>
          {/* authority tracks (T1, T2, T3) */}
          <lineSegments geometry={trackGeo}>
            <lineBasicMaterial color="#3A414B" transparent opacity={0.55} />
          </lineSegments>
          {/* Hash Ring ticks of the live delegation hash */}
          <instancedMesh ref={tickMesh} args={[tickGeo, undefined, 64]} frustumCulled={false}>
            <meshStandardMaterial color="#AEB6C1" metalness={1} roughness={0.3} />
          </instancedMesh>
          {/* the pearl: the agent's on-chain identity (2 o'clock) */}
          <mesh ref={pearl} position={polar(1, Math.PI / 6, 0)}>
            <sphereGeometry args={[0.046, 32, 16]} />
            <meshPhysicalMaterial color="#8FB4E0" metalness={0.5} roughness={0.18} clearcoat={1} />
          </mesh>
          {/* the agent at the centre */}
          <mesh position={[0, 0.03, 0]}>
            <sphereGeometry args={[0.05, 32, 16]} />
            <meshPhysicalMaterial color="#DDE2E8" metalness={1} roughness={0.16} clearcoat={0.8} />
          </mesh>
          {/* receipts the mandate allowed, waiting on a person, or asked */}
          <instancedMesh
            ref={coins}
            args={[coinGeo, undefined, Math.max(1, inside.length)]}
            frustumCulled={false}
            onPointerMove={hover(inside)}
            onPointerOut={() => onHover?.(null, 0, 0)}
          >
            <meshStandardMaterial metalness={1} roughness={0.34} />
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

export default function MandateOrbit(props: MandateOrbitProps) {
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const frameloop = !props.active ? "never" : props.motion && !props.poster ? "always" : "demand";
  return (
    <Canvas
      frameloop={frameloop}
      dpr={props.poster ? 2 : touch ? [1, 1.25] : [1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: Boolean(props.poster) }}
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
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.6} position={[0, 5, 1]} rotation-x={Math.PI / 2} scale={[10, 3, 1]} />
        <Lightformer form="rect" intensity={1.4} position={[-5, 1, 1]} rotation-y={Math.PI / 2} scale={[8, 1.2, 1]} />
        <Lightformer form="rect" intensity={0.9} position={[5, 0.5, -1]} rotation-y={-Math.PI / 2} scale={[8, 0.8, 1]} />
        <Lightformer form="ring" intensity={1.2} position={[0, 2, -6]} scale={5} />
        <Lightformer form="rect" intensity={1.2} position={[1, 1.5, 6]} scale={[8, 4, 1]} />
      </Environment>
      <Orbit {...props} />
      <FirstFrame onFirstFrame={props.onFirstFrame} />
      {!props.poster ? (
        <>
          <AdaptiveDpr pixelated={false} />
          <PerformanceMonitor />
        </>
      ) : null}
      {!props.poster && !touch ? (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur luminanceThreshold={0.92} luminanceSmoothing={0.08} intensity={0.55} radius={0.6} />
        </EffectComposer>
      ) : null}
    </Canvas>
  );
}
