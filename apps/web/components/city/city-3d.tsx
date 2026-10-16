"use client";

/**
 * Agent City in 3D (master plan 14.7): two rail planes with a visible seam, chrome discs with
 * passport rings (solid = attested, dashed = self-registered, none = user account), size =
 * reputation; payments travel as light points along their edge (white settled, brass awaiting,
 * graphite stopped at the refusing ring); each anchor batch sends one pulse across the seam each way.
 * Six draw calls; labels are HTML.
 */
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CityGraph } from "@/lib/api/view";
import { layoutCity, RAIL_BOUNDS, type PlacedNode } from "./layout";

const EDGE_COLOR = { settled: new THREE.Color("#E7E9EC"), awaiting: new THREE.Color("#D3B46B"), reverted: new THREE.Color("#5C6470") };

function dashedRing(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 10;
  for (let i = 0; i < n; i++) {
    const g = new THREE.TorusGeometry(1, 0.035, 6, 8, (Math.PI * 2) / n / 1.8);
    g.rotateZ((i * Math.PI * 2) / n);
    parts.push(g);
  }
  const m = mergeGeometries(parts, false)!;
  m.rotateX(-Math.PI / 2);
  return m;
}

export interface ProjectedLabel {
  id: string;
  label: string;
  x: number;
  y: number;
  muted: boolean;
}

function Scene({ graph, playKey, motion, onProject }: { graph: CityGraph; playKey: number; motion: boolean; onProject?: (labels: ProjectedLabel[]) => void }) {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const nodes = useMemo(() => layoutCity(graph), [graph]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const discs = useRef<THREE.InstancedMesh>(null);
  const rings = useRef<THREE.InstancedMesh>(null);
  const dashed = useRef<THREE.InstancedMesh>(null);
  const points = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const start = useRef(-1);

  const attested = nodes.filter((n) => n.passport === "attested");
  const selfReg = nodes.filter((n) => n.passport === "self-registered");

  const planes = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (const rail of ["hk", "fisco"] as const) {
      const b = RAIL_BOUNDS[rail];
      const g = new THREE.BoxGeometry(b.x1 - b.x0, 0.06, RAIL_BOUNDS.z1 - RAIL_BOUNDS.z0 + 0.6);
      g.translate((b.x0 + b.x1) / 2, -0.03, 0);
      parts.push(g);
    }
    return mergeGeometries(parts, false)!;
  }, []);

  const edges = useMemo(() => {
    const pos: number[] = [];
    const col: number[] = [];
    for (const e of graph.edges) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) continue;
      const t = e.state === "reverted" ? 0.78 : 1;
      pos.push(a.x, 0.05, a.z, a.x + (b.x - a.x) * t, 0.05, a.z + (b.z - a.z) * t);
      const c = EDGE_COLOR[e.state];
      const k = e.state === "awaiting" ? 1 : 0.6;
      col.push(c.r * k, c.g * k, c.b * k, c.r * k, c.g * k, c.b * k);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [graph.edges, byId]);

  const travellers = useMemo(() => {
    const list: Array<{ a: THREE.Vector3; b: THREE.Vector3; color: THREE.Color; stop: number; delay: number }> = [];
    graph.edges.forEach((e, i) => {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) return;
      list.push({ a: new THREE.Vector3(a.x, 0.12, a.z), b: new THREE.Vector3(b.x, 0.12, b.z), color: EDGE_COLOR[e.state], stop: e.state === "reverted" ? 0.78 : e.state === "awaiting" ? 0.92 : 1, delay: i * 0.18 });
    });
    const base = nodes.find((n) => n.id.includes("base") || (n.kind === "anchor" && n.z < 0));
    const fisco = nodes.find((n) => n.id.includes("fisco") || (n.kind === "anchor" && n.z > 0));
    if (base && fisco && graph.anchors.length) {
      const steel = new THREE.Color("#86AEDD");
      const d = graph.edges.length * 0.18 + 0.4;
      list.push({ a: new THREE.Vector3(base.x, 0.3, base.z), b: new THREE.Vector3(fisco.x, 0.3, fisco.z), color: steel, stop: 1, delay: d });
      list.push({ a: new THREE.Vector3(fisco.x, 0.3, fisco.z), b: new THREE.Vector3(base.x, 0.3, base.z), color: steel, stop: 1, delay: d + 0.9 });
    }
    return list;
  }, [graph, byId, nodes]);

  useEffect(() => {
    const d = discs.current;
    if (d) {
      nodes.forEach((n, i) => {
        tmp.position.set(n.x, n.kind === "anchor" || n.kind === "regulator" ? 0.16 : 0.05, n.z);
        tmp.rotation.set(0, 0, 0);
        const h = n.kind === "anchor" || n.kind === "regulator" ? 0.32 : 0.08;
        tmp.scale.set(n.size, h, n.size);
        tmp.updateMatrix();
        d.setMatrixAt(i, tmp.matrix);
        d.setColorAt(i, new THREE.Color(n.kind === "rogue" ? "#4A505A" : n.kind === "anchor" || n.kind === "regulator" ? "#9AB6DA" : "#E9EDF2"));
      });
      d.instanceMatrix.needsUpdate = true;
      if (d.instanceColor) d.instanceColor.needsUpdate = true;
    }
    const place = (mesh: THREE.InstancedMesh | null, list: PlacedNode[]) => {
      if (!mesh) return;
      list.forEach((n, i) => {
        tmp.position.set(n.x, 0.06, n.z);
        tmp.rotation.set(Math.PI / 2, 0, 0);
        tmp.scale.setScalar(n.size + 0.1);
        tmp.updateMatrix();
        mesh.setMatrixAt(i, tmp.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    place(rings.current, attested);
    if (dashed.current) {
      selfReg.forEach((n, i) => {
        tmp.position.set(n.x, 0.06, n.z);
        tmp.rotation.set(0, 0, 0);
        tmp.scale.setScalar(n.size + 0.1);
        tmp.updateMatrix();
        dashed.current!.setMatrixAt(i, tmp.matrix);
      });
      dashed.current.instanceMatrix.needsUpdate = true;
    }
    invalidate();
  }, [nodes, attested, selfReg, tmp, invalidate]);

  useEffect(() => {
    if (!motion) return;
    start.current = performance.now();
    invalidate();
  }, [playKey, motion, invalidate]);

  useFrame(() => {
    const p = points.current;
    if (!p) return;
    const t = start.current < 0 ? -1 : (performance.now() - start.current) / 1000;
    const total = travellers.reduce((m, tr) => Math.max(m, tr.delay), 0) + 1.7;
    const active = t >= 0 && t < total;
    travellers.forEach((tr, i) => {
      const local = t < 0 ? -1 : (t - tr.delay) / 1.1;
      if (local < 0 || local > 1.6) {
        tmp.scale.setScalar(0);
      } else {
        const k = Math.min(1, local) * tr.stop;
        tmp.position.lerpVectors(tr.a, tr.b, 1 - (1 - k) ** 3);
        tmp.scale.setScalar(local > 1 ? 0.07 * Math.max(0, 1 - (local - 1) / 0.6) : 0.07);
      }
      tmp.rotation.set(0, 0, 0);
      tmp.updateMatrix();
      p.setMatrixAt(i, tmp.matrix);
      p.setColorAt(i, tr.color);
    });
    p.instanceMatrix.needsUpdate = true;
    if (p.instanceColor) p.instanceColor.needsUpdate = true;
    if (active) invalidate();
    else start.current = -1;
  });

  // Labels are HTML outside the canvas: project each node once per resize (the camera never moves).
  useEffect(() => {
    if (!onProject) return;
    camera.updateMatrixWorld();
    const v = new THREE.Vector3();
    onProject(
      nodes.map((n) => {
        v.set(n.x, 0.05, n.z + n.size + 0.24).project(camera);
        return { id: n.id, label: n.label, x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height, muted: n.kind === "rogue" };
      }),
    );
  }, [camera, size.width, size.height, nodes, onProject]);

  const ringGeo = useMemo(() => new THREE.TorusGeometry(1, 0.03, 6, 48), []);
  const dashGeo = useMemo(() => dashedRing(), []);
  return (
    <group>
      <mesh geometry={planes}>
        <meshStandardMaterial color="#1A1E24" metalness={0.2} roughness={0.85} />
      </mesh>
      <instancedMesh ref={discs} args={[undefined, undefined, nodes.length]}>
        <cylinderGeometry args={[1, 1, 1, 40]} />
        <meshStandardMaterial metalness={0.55} roughness={0.32} />
      </instancedMesh>
      <instancedMesh ref={rings} args={[ringGeo, undefined, Math.max(1, attested.length)]}>
        <meshStandardMaterial color="#B3BAC4" metalness={0.8} roughness={0.35} />
      </instancedMesh>
      <instancedMesh ref={dashed} args={[dashGeo, undefined, Math.max(1, selfReg.length)]} visible={selfReg.length > 0}>
        <meshStandardMaterial color="#5C6470" metalness={0.5} roughness={0.5} />
      </instancedMesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial vertexColors transparent opacity={0.9} />
      </lineSegments>
      <instancedMesh ref={points} args={[undefined, undefined, Math.max(1, travellers.length)]} frustumCulled={false}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

export default function City3D({
  graph,
  playKey,
  motion,
  onFirstFrame,
  onProject,
}: {
  graph: CityGraph;
  playKey: number;
  motion: boolean;
  onFirstFrame?: () => void;
  onProject?: (labels: ProjectedLabel[]) => void;
}) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      camera={{ fov: 27, position: [0, 11.2, 6.4], near: 0.1, far: 60 }}
      onCreated={({ camera, gl }) => {
        camera.lookAt(0, 0, 0.3);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        requestAnimationFrame(() => onFirstFrame?.());
      }}
      aria-hidden="true"
    >
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2} position={[0, 6, 2]} rotation-x={Math.PI / 2} scale={[12, 4, 1]} />
        <Lightformer form="rect" intensity={1} position={[-6, 2, 4]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} />
        <Lightformer form="rect" intensity={0.8} position={[0, 2, 9]} scale={[10, 3, 1]} />
      </Environment>
      <Scene graph={graph} playKey={playKey} motion={motion} onProject={onProject} />
    </Canvas>
  );
}
