import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { ObjectMesh } from "../types";

interface Props {
  meshes: ObjectMesh[];
  style?: React.CSSProperties;
}

function MeshObject({ mesh }: { mesh: ObjectMesh }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(mesh.vertices);
    const indices = new Uint32Array(mesh.faces);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    return geo;
  }, [mesh]);

  return (
    <mesh geometry={geometry}>
      <meshPhongMaterial color="#b0bec5" side={THREE.DoubleSide} />
    </mesh>
  );
}

function EdgeLines({ mesh }: { mesh: ObjectMesh }) {
  const edges = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(mesh.vertices);
    const indices = new Uint32Array(mesh.faces);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return new THREE.EdgesGeometry(geo, 15);
  }, [mesh]);

  return (
    <lineSegments geometry={edges}>
      <lineBasicMaterial color="#546e7a" />
    </lineSegments>
  );
}

export default function MeshViewer({ meshes, style }: Props) {
  // Compute bounding box to center camera
  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const m of meshes) {
      for (let i = 0; i < m.vertices.length; i += 3) {
        minX = Math.min(minX, m.vertices[i]);
        maxX = Math.max(maxX, m.vertices[i]);
        minY = Math.min(minY, m.vertices[i + 1]);
        maxY = Math.max(maxY, m.vertices[i + 1]);
        minZ = Math.min(minZ, m.vertices[i + 2]);
        maxZ = Math.max(maxZ, m.vertices[i + 2]);
      }
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    return { center: [cx, cy, cz] as [number, number, number], size };
  }, [meshes]);

  return (
    <div style={style}>
      <Canvas
        camera={{
          position: [
            bounds.center[0] + bounds.size * 0.8,
            bounds.center[1] - bounds.size * 0.6,
            bounds.center[2] + bounds.size * 0.8,
          ],
          fov: 50,
          near: 0.1,
          far: bounds.size * 10,
        }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[1, 1, 1]} intensity={0.8} />
        <directionalLight position={[-1, -0.5, 0.5]} intensity={0.3} />
        <group position={[-bounds.center[0], -bounds.center[1], -bounds.center[2]]}>
          {meshes.map((m) => (
            <group key={m.object_id}>
              <MeshObject mesh={m} />
              <EdgeLines mesh={m} />
            </group>
          ))}
        </group>
        <OrbitControls />
      </Canvas>
    </div>
  );
}
