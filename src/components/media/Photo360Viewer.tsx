"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PanoramaLink } from "@/lib/media/panorama-navigation";

/** Field-of-view limits for wheel zoom: wide enough to see a room, tight
 *  enough to read a label, and never so wide that the projection distorts. */
const MIN_FOV = 30;
const MAX_FOV = 90;

/** How far out and down the walking arrows sit, inside the 500-unit sphere. */
const ARROW_DISTANCE = 14;
const ARROW_DROP = -9;

/**
 * Loads the panorama at full resolution. A panorama too big for one response
 * arrives as horizontal strips, which are drawn one under the other onto a
 * canvas to rebuild the original image pixel for pixel. Only a device whose
 * GPU cannot hold a texture that large gets it scaled to the most it can.
 */
async function loadPanorama(urls: string[]): Promise<THREE.Texture> {
  const strips = await Promise.all(
    urls.map(
      (url) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.decoding = "async";
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error(url));
          img.src = url;
        }),
    ),
  );
  const width = strips[0].naturalWidth;
  const height = strips.reduce((sum, img) => sum + img.naturalHeight, 0);
  const gl = document.createElement("canvas").getContext("webgl");
  const maxSize = (gl?.getParameter(gl.MAX_TEXTURE_SIZE) as number | undefined) ?? 4096;
  const scale = Math.min(1, maxSize / width, maxSize / height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  let top = 0;
  for (const img of strips) {
    const h = img.naturalHeight * scale;
    context.drawImage(img, 0, top, canvas.width, h);
    top += h;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

/**
 * The horizontal direction, in scene space, of a compass bearing seen from a
 * panorama whose image centre faces `heading`. With the sphere flipped on X,
 * the image centre lands on -X and turning right (clockwise) runs towards -Z.
 */
function directionFor(bearing: number, heading: number): THREE.Vector3 {
  const phi = Math.PI + ((bearing - heading) * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi));
}

/** The compass bearing the camera is looking along, the inverse of directionFor. */
function bearingOf(camera: THREE.Camera, target: THREE.Vector3, heading: number): number {
  const look = target.clone().sub(camera.position);
  const phi = Math.atan2(look.z, look.x);
  const bearing = heading + ((phi - Math.PI) * 180) / Math.PI;
  return ((bearing % 360) + 360) % 360;
}

/**
 * A chevron lying flat on the ground, pointing along `dir`, over an invisible
 * disc that takes the clicks: the chevron alone is too thin to hit reliably.
 */
function makeArrow(dir: THREE.Vector3): { arrow: THREE.Group; target: THREE.Mesh } {
  const shape = new THREE.Shape();
  shape.moveTo(0, 1.6);
  shape.lineTo(1.6, -0.4);
  shape.lineTo(0.9, -0.4);
  shape.lineTo(0, 0.7);
  shape.lineTo(-0.9, -0.4);
  shape.lineTo(-1.6, -0.4);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  // Lay it flat: the shape's +Y becomes the scene's -Z ("forward").
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const chevron = new THREE.Mesh(geometry, material);
  chevron.renderOrder = 10;
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, side: THREE.DoubleSide }),
  );
  const arrow = new THREE.Group();
  arrow.add(disc, chevron);
  arrow.position.copy(dir.clone().multiplyScalar(ARROW_DISTANCE)).setY(ARROW_DROP);
  arrow.rotation.y = Math.atan2(-dir.x, -dir.z);
  return { arrow, target: disc };
}

function disposeArrow(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    (mesh.material as THREE.Material | undefined)?.dispose();
  });
}

export interface Photo360ViewerProps {
  imageUrls: string[];
  label: string;
  /** Compass direction of the image's centre. Without one, no arrows can be placed. */
  heading?: number | null;
  /** Other panoramas to walk to; drawn as arrows on the ground. */
  links?: PanoramaLink[];
  onNavigate?: (id: string, bearing: number) => void;
  /** Which way to face on arrival, e.g. the direction just walked. */
  initialBearing?: number | null;
  onPrev?: () => void;
  onNext?: () => void;
  /** Offered when given: records that the current view faces north. */
  onSetNorth?: (heading: number) => void;
}

/**
 * Equirectangular 360 photo viewer.
 *
 * The technique: map the panorama onto a sphere and put the camera at its
 * centre, with the sphere scaled by -1 on X so its inside faces the viewer.
 * Without that flip the image renders mirrored — readable enough to look
 * right at a glance and wrong in every sign on the wall.
 *
 * Panning is disabled: the camera sits at the centre of the sphere, and
 * moving it off-centre would warp the projection into something that is no
 * longer a faithful view from where the photo was taken. Zoom changes the
 * field of view instead of the camera's position, for the same reason.
 *
 * When neighbouring panoramas are known, arrows on the ground point at them,
 * Street View style; clicking one walks there.
 */
export function Photo360Viewer({
  imageUrls,
  label,
  heading = null,
  links = [],
  onNavigate,
  initialBearing = null,
  onPrev,
  onNext,
  onSetNorth,
}: Photo360ViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sceneRef = useRef<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; renderer: THREE.WebGLRenderer } | null>(null);
  const arrowsRef = useRef<THREE.Group | null>(null);
  const linksRef = useRef<{ mesh: THREE.Object3D; link: PanoramaLink }[]>([]);
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => {
    onNavigateRef.current = onNavigate;
  }, [onNavigate]);
  // Read once per panorama, when it loads: arriving facing the way you walked.
  // Declared before the loading effect so it runs first.
  const arrival = useRef({ heading, initialBearing });
  useEffect(() => {
    arrival.current = { heading, initialBearing };
  }, [heading, initialBearing]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let frameId = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let texture: THREE.Texture | null = null;
    let geometry: THREE.SphereGeometry | null = null;
    let material: THREE.MeshBasicMaterial | null = null;
    let onWheel: ((event: WheelEvent) => void) | null = null;
    let onPointerDown: ((event: PointerEvent) => void) | null = null;
    let onPointerUp: ((event: PointerEvent) => void) | null = null;
    let onPointerMove: ((event: PointerEvent) => void) | null = null;

    setStatus("loading");
    setErrorMessage(null);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      1000,
    );
    // Not exactly the centre: OrbitControls needs a non-zero distance between
    // the camera and its target to have an orientation at all.
    camera.position.set(0, 0, 0.1);
    const { heading: arrivalHeading, initialBearing: arrivalBearing } = arrival.current;
    if (arrivalHeading !== null && arrivalBearing !== null) {
      camera.position.copy(directionFor(arrivalBearing, arrivalHeading).multiplyScalar(-0.1));
    }

    const arrows = new THREE.Group();
    scene.add(arrows);
    arrowsRef.current = arrows;

    loadPanorama(imageUrls).then(
      (loaded) => {
        if (disposed) {
          loaded.dispose();
          return;
        }
        texture = loaded;
        texture.colorSpace = THREE.SRGBColorSpace;

        geometry = new THREE.SphereGeometry(500, 60, 40);
        geometry.scale(-1, 1, 1);
        material = new THREE.MeshBasicMaterial({ map: texture });
        scene.add(new THREE.Mesh(geometry, material));

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(container.clientWidth, container.clientHeight);
        container.appendChild(renderer.domElement);

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enablePan = false;
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        // Inverted, because dragging inside a sphere moves the world the
        // opposite way from dragging an object in front of you: without this
        // the view slides away from the direction of the drag.
        controls.rotateSpeed = -0.4;
        // OrbitControls zooms by moving the camera, which inside a sphere
        // would just walk it towards the wall. Zoom is done by field of view
        // instead, below — the same thing a real lens does.
        controls.enableZoom = false;
        controls.target.set(0, 0, 0);
        controls.update();

        onWheel = (event: WheelEvent) => {
          event.preventDefault();
          camera.fov = Math.min(MAX_FOV, Math.max(MIN_FOV, camera.fov + event.deltaY * 0.05));
          camera.updateProjectionMatrix();
        };
        renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

        // A click on an arrow walks; a drag that happens to end on one looks
        // around, as it would anywhere else.
        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        const hit = (event: PointerEvent) => {
          const rect = renderer!.domElement.getBoundingClientRect();
          pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
          raycaster.setFromCamera(pointer, camera);
          const meshes = linksRef.current.map((l) => l.mesh);
          const first = raycaster.intersectObjects(meshes, false)[0];
          return first ? linksRef.current.find((l) => l.mesh === first.object) ?? null : null;
        };
        let downAt: { x: number; y: number } | null = null;
        onPointerDown = (event) => {
          downAt = { x: event.clientX, y: event.clientY };
        };
        onPointerUp = (event) => {
          if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 6) return;
          const target = hit(event);
          if (target) onNavigateRef.current?.(target.link.id, target.link.bearing);
        };
        onPointerMove = (event) => {
          if (event.buttons) return;
          renderer!.domElement.style.cursor = hit(event) ? "pointer" : "grab";
        };
        renderer.domElement.addEventListener("pointerdown", onPointerDown);
        renderer.domElement.addEventListener("pointerup", onPointerUp);
        renderer.domElement.addEventListener("pointermove", onPointerMove);

        sceneRef.current = { scene, camera, controls, renderer };

        const render = () => {
          frameId = requestAnimationFrame(render);
          controls?.update();
          renderer?.render(scene, camera);
        };
        render();
        setStatus("ready");
      },
      () => {
        if (disposed) return;
        setErrorMessage("The panorama could not be downloaded. Reload the page to try again.");
        setStatus("error");
      },
    );

    function onResize() {
      if (!renderer || !container) return;
      camera.aspect = container.clientWidth / Math.max(container.clientHeight, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    }
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      sceneRef.current = null;
      arrowsRef.current = null;
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
      if (renderer) {
        if (onWheel) renderer.domElement.removeEventListener("wheel", onWheel);
        if (onPointerDown) renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        if (onPointerUp) renderer.domElement.removeEventListener("pointerup", onPointerUp);
        if (onPointerMove) renderer.domElement.removeEventListener("pointermove", onPointerMove);
      }
      controls?.dispose();
      geometry?.dispose();
      material?.dispose();
      texture?.dispose();
      for (const child of arrows.children) disposeArrow(child);
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
    // The URLs are the identity of the panorama; joined so a new array with
    // the same contents does not reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrls.join("|")]);

  // Arrows are redrawn when the neighbours or the heading change, without
  // reloading the image.
  const linksKey = links.map((l) => `${l.id}:${l.bearing.toFixed(1)}`).join("|");
  useEffect(() => {
    const group = arrowsRef.current;
    if (!group || status !== "ready") return;
    for (const child of [...group.children]) {
      group.remove(child);
      disposeArrow(child);
    }
    linksRef.current = [];
    if (heading === null) return;
    for (const link of links) {
      const { arrow, target } = makeArrow(directionFor(link.bearing, heading));
      group.add(arrow);
      linksRef.current.push({ mesh: target, link });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, heading, linksKey]);

  function setNorth() {
    const current = sceneRef.current;
    if (!current || !onSetNorth) return;
    // Whatever heading the image has now, the view in front of the person is
    // north: so the image's centre faces minus that view's offset.
    const facing = bearingOf(current.camera, current.controls.target, heading ?? 0);
    onSetNorth((((heading ?? 0) - facing) % 360 + 360) % 360);
  }

  const button =
    "pointer-events-auto grid h-12 w-9 place-items-center rounded-full bg-white/80 text-lg text-zinc-800 shadow hover:bg-white";

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-shell">
      <div ref={containerRef} className="h-full w-full" aria-label={`360° panorama: ${label}`} role="img" />
      {status !== "ready" ? (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <p className="max-w-sm text-sm text-shell-muted">
            {status === "loading" ? "Loading panorama…" : errorMessage}
          </p>
        </div>
      ) : (
        <>
          {onPrev ? (
            <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
              <button type="button" onClick={onPrev} className={button} aria-label="Previous panorama">
                ‹
              </button>
            </div>
          ) : null}
          {onNext ? (
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
              <button type="button" onClick={onNext} className={button} aria-label="Next panorama">
                ›
              </button>
            </div>
          ) : null}
          {onSetNorth ? (
            <button
              type="button"
              onClick={setNorth}
              title="Turn to face north, then press this so the arrows point the right way"
              className="absolute right-3 top-3 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-zinc-800 shadow hover:bg-white"
            >
              This view faces north
            </button>
          ) : null}
          <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs text-white">
            Drag to look around · scroll to zoom{links.length > 0 && heading !== null ? " · click an arrow to walk" : ""}
          </p>
        </>
      )}
    </div>
  );
}
