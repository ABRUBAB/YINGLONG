"use client";

/**
 * The Receipt Dragon (master plan 14.7). Three information layers, nothing decorative:
 *  1. spine from the brand master; scales = accountability receipts (newest at the head):
 *     chrome = confirmed, graphite = reverted or refused, grey = pending, dark = slot not yet written;
 *  2. orbit ring = the sealed mandate; its bright arc is the share of the budget still unspent;
 *  3. pearl on the ring = the agent's on-chain identity; it pulses once per confirmed anchor.
 * Actions travel as a light token from the head: T1 passes inside the ring to the payee, T2 stops at
 * the ring with a brass arc, T? stops at the centre, refusals arrive as shards that deflect off the
 * ring. Nothing animates without an event. Budgets: < 120k triangles, <= 8 draw calls.
 */
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { AdaptiveDpr, Environment, Lightformer, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { bodyGeometry, headGeometry, PEARL_ANGLE, PEARL_RADIUS, scaleSlots, snoutTip, spineCurve } from "./dragon-geometry";

export type ScaleState = "confirmed" | "reverted" | "pending" | "empty";
export type DragonEventKind = "t1" | "t2" | "ask" | "refusal" | "anchor";

export interface DragonEvent {
  kind: DragonEventKind;
  label: string;
}

export interface DragonProps {
  scales: ScaleState[];
  /** Share of the period budget still unspent, 0..1 (bright arc length). */
  remaining: number;
  events: DragonEvent[];
  /** Increment to replay the event sequence. */
  playKey: number;
  /** Poster capture: fixed frame, no events, drawing buffer kept for the screenshot. */
  poster?: boolean;
  motion: boolean;
  onFirstFrame?: () => void;
  onEvent?: (index: number) => void;
  onHover?: (receiptIndex: number | null, x: number, y: number) => void;
}

const COLOR: Record<ScaleState, THREE.Color> = {
  confirmed: new THREE.Color("#F4F6F9"),
  reverted: new THREE.Color("#596069"),
  pending: new THREE.Color("#7A828E"),
  empty: new THREE.Color("#14171C"),
};

const EVENT_MS = 1900;
const ringPoint = (deg: number, r = 1) => new THREE.Vector3(Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r, 0);

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

function Dragon({ scales, remaining, events, playKey, motion, onEvent, onHover }: Omit<DragonProps, "poster" | "onFirstFrame">) {
  const invalidate = useThree((s) => s.invalidate);
  const curve = useMemo(() => spineCurve(), []);
  const body = useMemo(() => bodyGeometry(curve), [curve]);
  const head = useMemo(() => headGeometry(), []);
  const slots = useMemo(() => scaleSlots(curve), [curve]);
  const scaleGeo = useMemo(() => new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.42), []);
  const scaleMesh = useRef<THREE.InstancedMesh>(null);
  const ringGeo = useMemo(() => {
    const g = new THREE.TorusGeometry(1, 0.0105, 10, 360);
    const colors: number[] = [];
    const pos = g.getAttribute("position");
    const bright = new THREE.Color("#E9EDF2");
    const ash = new THREE.Color("#3A4049");
    // Bright arc: from 12 o'clock, clockwise, length = remaining share.
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getY(i), pos.getX(i)); // -pi..pi, 0 at 3 o'clock, counter-clockwise
      let fromTop = (Math.PI / 2 - a) / (Math.PI * 2);
      fromTop = ((fromTop % 1) + 1) % 1; // 0 at 12 o'clock, increasing clockwise
      const c = fromTop <= remaining ? bright : ash;
      colors.push(c.r, c.g, c.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return g;
  }, [remaining]);

  const pearl = useRef<THREE.Mesh>(null);
  const token = useRef<THREE.Mesh>(null);
  const brass = useRef<THREE.Mesh>(null);
  const shards = useRef<THREE.InstancedMesh>(null);
  const shardState = useRef(
    Array.from({ length: 36 }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, rot: new THREE.Euler() })),
  );
  const play = useRef({ start: -1, index: -1 });
  const tmp = useMemo(() => new THREE.Object3D(), []);

  // Scale instances: newest receipts at the head.
  useEffect(() => {
    const mesh = scaleMesh.current;
    if (!mesh) return;
    slots.forEach((s, i) => {
      tmp.position.copy(s.position);
      tmp.quaternion.copy(s.quaternion);
      tmp.scale.copy(s.scale);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
      mesh.setColorAt(i, COLOR[scales[s.order] ?? "empty"]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [slots, scales, tmp, invalidate]);

  useEffect(() => {
    if (!motion || events.length === 0) return;
    play.current = { start: performance.now(), index: -1 };
    invalidate();
  }, [playKey, motion, events.length, invalidate]);

  const snout = useMemo(() => snoutTip(), []);
  const paths = useMemo(() => {
    const t1 = new THREE.QuadraticBezierCurve3(snout, new THREE.Vector3(0.15, 0.05, 0.12), ringPoint(-38, 1.22));
    const t2 = new THREE.QuadraticBezierCurve3(snout, new THREE.Vector3(0.35, -0.25, 0.1), ringPoint(-72, 0.975));
    const ask = new THREE.QuadraticBezierCurve3(snout, new THREE.Vector3(0.45, 0.2, 0.08), new THREE.Vector3(0, 0, 0.05));
    return { t1, t2, ask };
  }, [snout]);

  useFrame((_, delta) => {
    const p = play.current;
    const tok = token.current;
    const br = brass.current;
    const sh = shards.current;
    const pe = pearl.current;
    if (!tok || !br || !sh || !pe) return;
    let active = false;
    if (p.start >= 0) {
      const elapsed = performance.now() - p.start;
      const index = Math.floor(elapsed / EVENT_MS);
      const local = (elapsed % EVENT_MS) / EVENT_MS;
      if (index >= events.length) {
        p.start = -1;
        tok.visible = false;
        onEvent?.(-1);
      } else {
        active = true;
        if (index !== p.index) {
          p.index = index;
          onEvent?.(index);
          br.visible = false;
          if (events[index]!.kind === "refusal") {
            const hit = ringPoint(205, 1);
            shardState.current.forEach((s, k) => {
              const spread = (k / 36 - 0.5) * 0.9;
              s.p.copy(ringPoint(205 + spread * 40, 1.75 + (k % 5) * 0.06));
              s.p.z = ((k % 7) - 3) * 0.03;
              s.v.copy(hit).sub(s.p).normalize().multiplyScalar(1.1 + (k % 3) * 0.15);
              s.life = 1;
              s.rot.set(k, k * 0.7, k * 1.3);
            });
          }
        }
        const ev = events[index]!;
        const e = 1 - (1 - Math.min(1, local / 0.62)) ** 3; // ease-out over the first 62 percent
        tok.visible = ev.kind !== "refusal" && ev.kind !== "anchor";
        if (ev.kind === "t1") {
          tok.position.copy(paths.t1.getPoint(e));
          (tok.material as THREE.MeshBasicMaterial).opacity = local > 0.7 ? Math.max(0, 1 - (local - 0.7) / 0.3) : 1;
        } else if (ev.kind === "t2") {
          tok.position.copy(paths.t2.getPoint(e));
          (tok.material as THREE.MeshBasicMaterial).opacity = 1;
          br.visible = e >= 0.98;
        } else if (ev.kind === "ask") {
          tok.position.copy(paths.ask.getPoint(e));
          (tok.material as THREE.MeshBasicMaterial).opacity = 1;
        }
        if (ev.kind === "anchor") {
          const s = 1 + 0.35 * Math.sin(Math.min(1, local / 0.5) * Math.PI);
          pe.scale.setScalar(s);
        } else pe.scale.setScalar(1);
      }
    }
    // shards (CPU): fly in, deflect off the ring, fade
    let anyShard = false;
    shardState.current.forEach((s, k) => {
      if (s.life <= 0) {
        tmp.scale.setScalar(0);
      } else {
        anyShard = true;
        s.p.addScaledVector(s.v, Math.min(delta, 0.05));
        const r = Math.hypot(s.p.x, s.p.y);
        if (r < 1.03 && s.v.dot(s.p) < 0) {
          const n = new THREE.Vector3(s.p.x, s.p.y, 0).normalize();
          s.v.addScaledVector(n, -2 * s.v.dot(n)).multiplyScalar(0.45);
        }
        // Fade on wall-clock time so slow (software) renderers do not leave shards hanging.
        s.life -= delta * (r > 1.03 && s.v.dot(s.p) > 0 ? 1.4 : 0.35);
        s.rot.x += delta * 3;
        s.rot.y += delta * 2;
        tmp.position.copy(s.p);
        tmp.rotation.copy(s.rot);
        tmp.scale.setScalar(0.022 * Math.max(0, s.life));
      }
      tmp.updateMatrix();
      sh.setMatrixAt(k, tmp.matrix);
    });
    sh.instanceMatrix.needsUpdate = true;
    if (active || anyShard) invalidate();
  });

  const brassArc = useMemo(() => new THREE.TorusGeometry(1, 0.016, 8, 48, (16 * Math.PI) / 180), []);
  const shardGeo = useMemo(() => new THREE.TetrahedronGeometry(1, 0), []);

  return (
    <group rotation={[-0.2, 0.26, 0.02]}>
      <mesh geometry={body}>
        <meshPhysicalMaterial color="#D9DEE5" metalness={1} roughness={0.22} clearcoat={0.5} clearcoatRoughness={0.25} anisotropy={0.5} />
      </mesh>
      {/* The head is mostly flat: a little more roughness so it catches the studio instead of mirroring the dark room. */}
      <mesh geometry={head}>
        <meshPhysicalMaterial color="#CDD3DA" metalness={0.92} roughness={0.36} clearcoat={0.6} clearcoatRoughness={0.3} side={THREE.DoubleSide} />
      </mesh>
      <instancedMesh
        ref={scaleMesh}
        args={[scaleGeo, undefined, slots.length]}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const slot = e.instanceId !== undefined ? slots[e.instanceId] : undefined;
          onHover?.(slot ? slot.order : null, e.nativeEvent.clientX, e.nativeEvent.clientY);
        }}
        onPointerOut={() => onHover?.(null, 0, 0)}
      >
        <meshStandardMaterial metalness={1} roughness={0.35} />
      </instancedMesh>
      <mesh geometry={ringGeo}>
        <meshStandardMaterial vertexColors metalness={0.9} roughness={0.28} />
      </mesh>
      <mesh ref={pearl} position={[Math.cos(PEARL_ANGLE), Math.sin(PEARL_ANGLE), 0]}>
        <sphereGeometry args={[PEARL_RADIUS, 32, 16]} />
        <meshPhysicalMaterial color="#8FB4E0" metalness={0.55} roughness={0.2} clearcoat={1} />
      </mesh>
      <mesh ref={token} visible={false}>
        <sphereGeometry args={[0.021, 16, 8]} />
        <meshBasicMaterial color="#FFFFFF" transparent toneMapped={false} />
      </mesh>
      <mesh ref={brass} geometry={brassArc} rotation={[0, 0, ((-72 - 8) * Math.PI) / 180]} visible={false}>
        <meshBasicMaterial color="#D3B46B" toneMapped={false} />
      </mesh>
      <instancedMesh ref={shards} args={[shardGeo, undefined, 36]} frustumCulled={false}>
        <meshStandardMaterial color="#4A505A" metalness={0.6} roughness={0.5} />
      </instancedMesh>
    </group>
  );
}

export default function ReceiptDragon(props: DragonProps) {
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  return (
    <Canvas
      frameloop="demand"
      dpr={props.poster ? 2 : touch ? [1, 1.25] : [1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: Boolean(props.poster) }}
      camera={{ fov: 25, position: [0, -0.06, 5.25], near: 0.1, far: 40 }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
      aria-hidden="true"
      style={{ touchAction: "pan-y" }}
    >
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.4} position={[0, 4.5, 3]} rotation-x={Math.PI / 2.4} scale={[9, 2.4, 1]} />
        <Lightformer form="rect" intensity={1.3} position={[-5, 0.5, 2]} rotation-y={Math.PI / 2} scale={[7, 1.1, 1]} />
        <Lightformer form="rect" intensity={0.8} position={[5, -1, 1]} rotation-y={-Math.PI / 2} scale={[7, 0.7, 1]} />
        <Lightformer form="ring" intensity={1.1} position={[0, 0, -5]} scale={4} />
        {/* soft fill from behind the viewer so faces turned to the camera do not mirror pure black */}
        <Lightformer form="rect" intensity={1.6} position={[1.2, 1.2, 6]} scale={[7, 4, 1]} />
      </Environment>
      <Dragon {...props} />
      <FirstFrame onFirstFrame={props.onFirstFrame} />
      {!props.poster ? (
        <>
          <AdaptiveDpr pixelated={false} />
          <PerformanceMonitor />
        </>
      ) : null}
    </Canvas>
  );
}
