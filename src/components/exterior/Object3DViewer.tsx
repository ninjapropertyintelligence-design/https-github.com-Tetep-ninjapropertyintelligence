"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * In-browser preview for MESH_3D / POINT_CLOUD drone outputs (Phase 2 next
 * workstream: "point cloud / mesh 3D viewer"). Only formats this can parse
 * *correctly* are rendered — everything else gets an honest "not supported
 * yet, download it" message rather than a hand-rolled parser that might
 * silently produce garbage geometry:
 *  - Mesh: .glb/.gltf (GLTFLoader), .obj (OBJLoader), .fbx (FBXLoader),
 *    .ply-with-faces (PLYLoader).
 *  - Point cloud: .ply-without-faces (PLYLoader), .xyz (parsed here — a
 *    trivial whitespace-delimited text format, safe to hand-roll).
 *  - NOT supported: .las/.laz (LiDAR binary formats needing a real
 *    decoder — LAZ is compressed and .las's binary header layout isn't
 *    safe to hand-roll from memory) and DSM/DTM GeoTIFF rasters (a
 *    different kind of data — elevation heightmaps, not 3D geometry).
 *
 * NOTE: single-file uploads only (this app's data model is one file per
 * DroneOutput) — a .obj referencing an external .mtl/texture, or a .gltf
 * referencing external .bin/textures, will render untextured. .glb is
 * self-contained and unaffected.
 */

const VIEWABLE_EXTENSIONS = new Set(["glb", "gltf", "obj", "ply", "fbx", "xyz"]);

export function isViewableIn3D(storageKey: string): boolean {
  return VIEWABLE_EXTENSIONS.has(extensionOf(storageKey));
}

function extensionOf(storageKey: string): string {
  const match = storageKey.match(/\.[a-zA-Z0-9]+$/);
  return match ? match[0].slice(1).toLowerCase() : "";
}

type ParsedResult = { kind: "mesh"; object: THREE.Object3D } | { kind: "points"; geometry: THREE.BufferGeometry };

async function parseXyz(buffer: ArrayBuffer): Promise<THREE.BufferGeometry> {
  const text = new TextDecoder().decode(buffer);
  const positions: number[] = [];
  const colors: number[] = [];
  let hasColor = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/[\s,]+/).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) continue;
    positions.push(parts[0], parts[1], parts[2]);
    if (parts.length >= 6 && !parts.slice(3, 6).some((n) => Number.isNaN(n))) {
      hasColor = true;
      const [r, g, b] = parts.slice(3, 6);
      const scale = r > 1 || g > 1 || b > 1 ? 1 / 255 : 1;
      colors.push(r * scale, g * scale, b * scale);
    }
  }
  if (positions.length === 0) throw new Error("No point records found in this .xyz file");
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (hasColor && colors.length === positions.length) {
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  }
  return geometry;
}

async function loadGeometry(url: string, ext: string): Promise<ParsedResult> {
  switch (ext) {
    case "xyz": {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to download file (HTTP ${res.status})`);
      return { kind: "points", geometry: await parseXyz(await res.arrayBuffer()) };
    }
    case "ply": {
      const { PLYLoader } = await import("three/examples/jsm/loaders/PLYLoader.js");
      const geometry = await new PLYLoader().loadAsync(url);
      const hasFaces = !!geometry.index && geometry.index.count > 0;
      if (hasFaces) {
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x9aa5b1 }));
        return { kind: "mesh", object: mesh };
      }
      return { kind: "points", geometry };
    }
    case "obj": {
      const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
      return { kind: "mesh", object: await new OBJLoader().loadAsync(url) };
    }
    case "glb":
    case "gltf": {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const gltf = await new GLTFLoader().loadAsync(url);
      return { kind: "mesh", object: gltf.scene };
    }
    case "fbx": {
      const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
      return { kind: "mesh", object: await new FBXLoader().loadAsync(url) };
    }
    default:
      throw new Error(`In-browser preview isn't available for ".${ext}" files yet — use the download link to view it in desktop software.`);
  }
}

export function Object3DViewer({ downloadUrl, storageKey }: { downloadUrl: string; storageKey: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const ext = extensionOf(storageKey);
    const container = containerRef.current;
    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let frameId = 0;

    async function run() {
      if (!container) return;
      try {
        const parsed = await loadGeometry(downloadUrl, ext);
        if (disposed || !container) return;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x14181f);

        let object3d: THREE.Object3D;
        if (parsed.kind === "points") {
          const hasColor = !!parsed.geometry.getAttribute("color");
          const pointsMaterial = new THREE.PointsMaterial({
            // Fixed pixel size (not attenuated by distance) — real drone
            // point clouds range from meter-scale to hundred-meter-scale,
            // so a size derived from world-space bounding-box dimensions
            // renders invisibly small for some datasets and enormous for
            // others. A constant on-screen size is legible at any scale.
            size: 3,
            sizeAttenuation: false,
            vertexColors: hasColor,
            color: hasColor ? 0xffffff : 0x6ea8fe,
          });
          object3d = new THREE.Points(parsed.geometry, pointsMaterial);
        } else {
          object3d = parsed.object;
        }
        scene.add(object3d);

        const box = new THREE.Box3().setFromObject(object3d);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        object3d.position.sub(center);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;

        const width = container.clientWidth || 480;
        const height = 420;
        const camera = new THREE.PerspectiveCamera(50, width / height, maxDim / 1000, maxDim * 100);
        camera.position.set(maxDim, maxDim * 0.8, maxDim);
        camera.lookAt(0, 0, 0);

        scene.add(new THREE.HemisphereLight(0xffffff, 0x22262e, 1.4));
        const directional = new THREE.DirectionalLight(0xffffff, 0.7);
        directional.position.set(1, 1, 1);
        scene.add(directional);

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.innerHTML = "";
        container.appendChild(renderer.domElement);

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.update();

        const handleResize = () => {
          if (!container || !renderer) return;
          const w = container.clientWidth || 480;
          camera.aspect = w / height;
          camera.updateProjectionMatrix();
          renderer.setSize(w, height);
        };
        window.addEventListener("resize", handleResize);

        const animate = () => {
          frameId = requestAnimationFrame(animate);
          controls?.update();
          renderer?.render(scene, camera);
        };
        animate();
        setStatus("ready");

        return () => window.removeEventListener("resize", handleResize);
      } catch (err) {
        if (!disposed) {
          setStatus("error");
          setErrorMessage(err instanceof Error ? err.message : "Failed to load 3D file");
        }
      }
    }
    const cleanupPromise = run();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      controls?.dispose();
      renderer?.dispose();
      if (container) container.innerHTML = "";
      cleanupPromise.then((cleanup) => cleanup?.());
    };
  }, [downloadUrl, storageKey]);

  return (
    <div className="mt-2 space-y-2">
      {status === "loading" ? <p className="text-sm text-muted">Loading 3D preview…</p> : null}
      {status === "error" ? <p className="text-sm text-muted">{errorMessage}</p> : null}
      <div
        ref={containerRef}
        className="overflow-hidden rounded-lg border border-border"
        style={{ height: 420, display: status === "ready" ? "block" : "none" }}
      />
      {status === "ready" ? <p className="text-xs text-muted">Drag to orbit, scroll to zoom.</p> : null}
    </div>
  );
}
