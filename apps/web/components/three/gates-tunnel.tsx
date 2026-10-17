"use client";

/**
 * Nine Gates: the 3D scene for the "nine checks" section. Every object is data:
 *  - nine chrome rings are the nine checks, in order, down a tunnel;
 *  - the coin is one payment request; scrolling moves it through the gates;
 *  - a gate lights white once the coin has crossed it; the gate that stopped the last real attack
 *    (GET /v1/challenge/attempts) turns to the refusal colour and the coin shatters against it;
 *  - the long lines are the walls of the tunnel and the specks are dust that gives depth.
 * Budgets: 1 InstancedMesh for ring ticks, 1 for shards, 9 ring meshes, 9 flash discs, 1 coin, 2
 * line and point sets. Frames are drawn only while the stage is on screen and the tab is visible;
 * nothing is allocated per frame. Bloom only on desktop pointers. DPR [1, 1.5] (1.25 on touch).
 * The poster fallback for browsers without WebGL2, Save-Data, low memory and reduced motion is the
 * flat rail that the section shows instead (landing/gates-stage.tsx).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { useTheme } from "@/components/preferences";
import { coinEndZ, coinZ, gateZ, GATES, shatter } from "./gates-math";

export interface GatesTunnelProps {
  /** Scroll progress 0..1, written by the section and read every frame. */
  progress: React.RefObject<number>;
  /** Gate index (0 to 8) that stopped the last attack, or -1 when none did. */
  stop: number;
  active: boolean;
  motion: boolean;
  pointer: React.RefObject<{ x: number; y: number }>;
  onFirstFrame?: () => void;
}

const PALETTE = {
  dark: { off: "#39404A", on: "#CBFF3C", stop: "#FF5A5F", wall: "#2B323B", dust: "#8A93A0", coin: "#DDE2E8", flash: "#E6FF7A", emissive: 0.9 },
  light: { off: "#8E9A93", on: "#2B3AE0", stop: "#B3262B", wall: "#C9C7BF", dust: "#6B6A63", coin: "#2B2A27", flash: "#5565FF", emissive: 0.0 },
};

const RING_R = 1.55;
const TICKS = 28;
const SHARDS = 40;
const WALLS = 14;
const DUST = 260;
const TAU = Math.PI * 2;
const ease = (t: number) => 1 - (1 - t) ** 3;

// deterministic pseudo-random so the scene is the same on every load
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

function useDocumentVisible(): boolean {
  const [v, setV] = useState(true);
  useEffect(() => {
    const on = () => setV(document.visibilityState === "visible");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return v;
}

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

function Scene({ progress, stop, motion, pointer }: Pick<GatesTunnelProps, "progress" | "stop" | "motion" | "pointer">) {
  const theme = useTheme();
  const pal = PALETTE[theme];
  const rings = useRef<THREE.Mesh[]>([]);
  const flashes = useRef<THREE.Mesh[]>([]);
  const coin = useRef<THREE.Group>(null);
  const coinMesh = useRef<THREE.Mesh>(null);
  const ticks = useRef<THREE.InstancedMesh>(null);
  const shards = useRef<THREE.InstancedMesh>(null);
  const z = useRef(coinZ(0, stop));
  const camX = useRef(0);
  const camY = useRef(0);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color() }), []);

  const colors = useMemo(() => ({ off: new THREE.Color(pal.off), on: new THREE.Color(pal.on), stop: new THREE.Color(pal.stop) }), [pal]);

  const ringGeo = useMemo(() => new THREE.TorusGeometry(RING_R, 0.034, 14, 120), []);
  const innerGeo = useMemo(() => new THREE.TorusGeometry(RING_R * 0.78, 0.01, 8, 96), []);
  const discGeo = useMemo(() => new THREE.CircleGeometry(RING_R * 0.98, 64), []);
  const tickGeo = useMemo(() => new THREE.BoxGeometry(0.018, 0.13, 0.018), []);
  const shardGeo = useMemo(() => new THREE.TetrahedronGeometry(0.1), []);
  const haloGeo = useMemo(() => new THREE.TorusGeometry(0.4, 0.012, 10, 64), []);
  const coinGeo = useMemo(() => new THREE.CylinderGeometry(0.27, 0.27, 0.06, 48), []);

  const walls = useMemo(() => {
    const pos: number[] = [];
    const zNear = 4;
    const zFar = gateZ(GATES - 1) - 9;
    for (let i = 0; i < WALLS; i++) {
      const a = (i / WALLS) * TAU;
      const x = Math.cos(a) * 2.5;
      const y = Math.sin(a) * 2.5;
      pos.push(x, y, zNear, x, y, zFar);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, []);

  const dust = useMemo(() => {
    const r = rng(7);
    const pos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      const a = r() * TAU;
      const d = 0.6 + r() * 2.2;
      pos[i * 3] = Math.cos(a) * d;
      pos[i * 3 + 1] = Math.sin(a) * d;
      pos[i * 3 + 2] = 3 - r() * (Math.abs(gateZ(GATES - 1)) + 11);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  const shardDirs = useMemo(() => {
    const r = rng(23);
    return Array.from({ length: SHARDS }, () => {
      const a = r() * TAU;
      const sp = 0.8 + r() * 1.8;
      return { dx: Math.cos(a) * sp, dy: Math.sin(a) * sp, dz: 0.6 + r() * 1.5, rx: r() * 6, ry: r() * 6 };
    });
  }, []);

  // ring ticks: placed once
  useEffect(() => {
    const mesh = ticks.current;
    if (!mesh) return;
    let k = 0;
    for (let g = 0; g < GATES; g++) {
      for (let t = 0; t < TICKS; t++) {
        const a = (t / TICKS) * TAU;
        const r = RING_R + 0.13;
        tmp.p.set(Math.cos(a) * r, Math.sin(a) * r, gateZ(g));
        tmp.e.set(0, 0, a + Math.PI / 2);
        tmp.q.setFromEuler(tmp.e);
        tmp.s.set(1, 0.6 + ((t * 7 + g * 3) % 5) * 0.18, 1);
        tmp.m.compose(tmp.p, tmp.q, tmp.s);
        mesh.setMatrixAt(k++, tmp.m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [tmp]);

  useFrame((state, dt) => {
    const p = progress.current ?? 0;
    const target = coinZ(p, stop);
    const k = motion ? 1 - Math.exp(-9 * Math.min(dt, 0.05)) : 1;
    z.current += (target - z.current) * k;
    const cz = z.current;
    const sh = shatter(p, stop);
    const atStop = stop >= 0 && cz <= coinEndZ(stop) + 0.04;

    // camera follows the coin from behind, with a little parallax from the pointer
    const px = pointer.current?.x ?? 0;
    const py = pointer.current?.y ?? 0;
    const tx = motion ? px * 0.35 : 0;
    const ty = motion ? -py * 0.2 : 0;
    camX.current += (tx - camX.current) * 0.08;
    camY.current += (ty - camY.current) * 0.08;
    // keep drawing only until everything has settled
    if (Math.abs(target - z.current) > 0.004 || Math.abs(tx - camX.current) > 0.004 || Math.abs(ty - camY.current) > 0.004) state.invalidate();
    const cam = state.camera;
    cam.position.set(camX.current, 0.42 + camY.current, cz + 5.4);
    cam.lookAt(camX.current * 0.3, 0, cz - 1.6);

    if (coin.current) {
      coin.current.position.set(0, 0, cz);
      coin.current.visible = sh < 0.2;
    }
    if (coinMesh.current) {
      coinMesh.current.rotation.set(Math.PI / 2, 0, 0);
      coinMesh.current.rotation.y = motion ? state.clock.elapsedTime * 2.2 : 0.6;
      (coinMesh.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5 + (atStop ? 0 : 0.3) * pal.emissive;
    }

    for (let i = 0; i < GATES; i++) {
      const ring = rings.current[i];
      const flash = flashes.current[i];
      if (!ring || !flash) continue;
      const zi = gateZ(i);
      const passed = cz < zi - 0.05;
      const isStop = i === stop && atStop;
      const mat = ring.material as THREE.MeshStandardMaterial;
      const to = isStop ? colors.stop : passed ? colors.on : colors.off;
      mat.color.lerp(to, 0.18);
      mat.emissive.copy(mat.color);
      mat.emissiveIntensity = (isStop ? 1.3 : passed ? 0.9 : 0.05) * (theme === "dark" ? 1 : 0.15);
      // the gate swells slightly as the coin comes near
      const near = Math.max(0, 1 - Math.abs(cz - zi) / 2.4);
      const s = 1 + near * 0.06;
      ring.scale.set(s, s, 1);
      // flash disc while the coin is crossing
      const fm = flash.material as THREE.MeshBasicMaterial;
      const cross = Math.max(0, 1 - Math.abs(cz - zi) / 0.9);
      fm.opacity = cross * (isStop ? 0.1 : 0.035);
      fm.color.set(isStop ? pal.stop : pal.flash);
    }

    // shards
    const sm = shards.current;
    if (sm) {
      const e = ease(sh);
      const zStop = stop >= 0 ? coinEndZ(stop) : 0;
      for (let i = 0; i < SHARDS; i++) {
        const d = shardDirs[i]!;
        const live = stop >= 0 && sh > 0 ? 1 : 0;
        tmp.p.set(d.dx * e * 1.4, d.dy * e * 1.4, zStop + d.dz * e * 0.8);
        tmp.e.set(d.rx * e * 3, d.ry * e * 3, 0);
        tmp.q.setFromEuler(tmp.e);
        const sc = live * Math.max(0, 1 - e * 0.85);
        tmp.s.set(sc, sc, sc);
        tmp.m.compose(tmp.p, tmp.q, tmp.s);
        sm.setMatrixAt(i, tmp.m);
      }
      sm.instanceMatrix.needsUpdate = true;
      (sm.material as THREE.MeshStandardMaterial).color.set(pal.stop);
    }
  });

  return (
    <>
      <fog attach="fog" args={[theme === "dark" ? "#0B0C0F" : "#F3F2EE", 7, 22]} />
      <ambientLight intensity={0.5} />
      <pointLight position={[0, 1.2, 2]} intensity={14} distance={12} />

      <lineSegments geometry={walls}>
        <lineBasicMaterial color={pal.wall} transparent opacity={0.5} />
      </lineSegments>
      <points geometry={dust}>
        <pointsMaterial color={pal.dust} size={0.022} sizeAttenuation transparent opacity={0.55} depthWrite={false} />
      </points>

      {Array.from({ length: GATES }, (_, i) => (
        <group key={i} position={[0, 0, gateZ(i)]}>
          <mesh ref={(m) => { if (m) rings.current[i] = m; }} geometry={ringGeo}>
            <meshStandardMaterial color={pal.off} metalness={theme === "dark" ? 0.9 : 0.15} roughness={theme === "dark" ? 0.22 : 0.55} />
          </mesh>
          <mesh geometry={innerGeo} rotation={[0, 0, i * 0.4]}>
            <meshBasicMaterial color={pal.off} transparent opacity={0.55} />
          </mesh>
          <mesh ref={(m) => { if (m) flashes.current[i] = m; }} geometry={discGeo} position={[0, 0, 0.01]}>
            <meshBasicMaterial color={pal.flash} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}

      <instancedMesh ref={ticks} args={[tickGeo, undefined, GATES * TICKS]} frustumCulled={false}>
        <meshBasicMaterial color={pal.wall} transparent opacity={0.9} />
      </instancedMesh>

      <group ref={coin}>
        <mesh ref={coinMesh} geometry={coinGeo}>
          <meshStandardMaterial color={pal.coin} metalness={theme === "dark" ? 1 : 0.3} roughness={theme === "dark" ? 0.18 : 0.4} emissive={pal.coin} emissiveIntensity={0.3} />
        </mesh>
        <mesh geometry={haloGeo}>
          <meshBasicMaterial color={pal.on} transparent opacity={0.85} />
        </mesh>
        <pointLight intensity={4} distance={4} color={pal.on} />
      </group>

      <instancedMesh ref={shards} args={[shardGeo, undefined, SHARDS]} frustumCulled={false}>
        <meshStandardMaterial color={pal.stop} metalness={0.4} roughness={0.35} emissive={pal.stop} emissiveIntensity={0.5} />
      </instancedMesh>
    </>
  );
}

/** Wakes the frame loop when the page scrolls or the pointer moves; otherwise the scene is idle and costs nothing. */
function Wake() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const wake = () => invalidate();
    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("pointermove", wake, { passive: true });
    window.addEventListener("resize", wake);
    wake();
    return () => {
      window.removeEventListener("scroll", wake);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("resize", wake);
    };
  }, [invalidate]);
  return null;
}

export default function GatesTunnel(props: GatesTunnelProps) {
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const visible = useDocumentVisible();
  const maxDpr = touch ? 1 : 1.25;
  const [dpr, setDpr] = useState(maxDpr);
  const live = props.active && visible;
  const theme = useTheme();
  return (
    <Canvas
      frameloop={live ? "demand" : "never"}
      dpr={dpr}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance", stencil: false }}
      camera={{ fov: 44, position: [0, 0.42, 7.6], near: 0.1, far: 60 }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = theme === "dark" ? 1.05 : 0.8;
      }}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0 }}
    >
      <Wake />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[0, 5, 1]} rotation-x={Math.PI / 2} scale={[10, 3, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[-5, 1, 1]} rotation-y={Math.PI / 2} scale={[8, 1.2, 1]} />
        <Lightformer form="rect" intensity={1} position={[5, 0.5, -1]} rotation-y={-Math.PI / 2} scale={[8, 0.8, 1]} />
        <Lightformer form="ring" intensity={1.1} position={[0, 2, -6]} scale={5} />
      </Environment>
      <Scene progress={props.progress} stop={props.stop} motion={props.motion} pointer={props.pointer} />
      <FirstFrame onFirstFrame={props.onFirstFrame} />
      <PerformanceMonitor bounds={(refresh) => (refresh > 90 ? [50, 90] : [45, 60])} flipflops={3} onDecline={() => setDpr(1)} onIncline={() => setDpr(maxDpr)} />
    </Canvas>
  );
}
