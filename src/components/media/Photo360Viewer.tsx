"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** Field-of-view limits for wheel zoom: wide enough to see a room, tight
 *  enough to read a label, and never so wide that the projection distorts. */
const MIN_FOV = 30;
const MAX_FOV = 90;

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
 */
export function Photo360Viewer({ imageUrl, label }: { imageUrl: string; label: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

    new THREE.TextureLoader().load(
      imageUrl,
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

        const render = () => {
          frameId = requestAnimationFrame(render);
          controls?.update();
          renderer?.render(scene, camera);
        };
        render();
        setStatus("ready");
      },
      undefined,
      () => {
        if (disposed) return;
        // TextureLoader's error carries no useful detail, so this says what
        // is actually knowable rather than inventing a cause.
        setErrorMessage("The panorama could not be downloaded. Its link may have expired — reload the page.");
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
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
      if (onWheel && renderer) renderer.domElement.removeEventListener("wheel", onWheel);
      controls?.dispose();
      geometry?.dispose();
      material?.dispose();
      texture?.dispose();
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
  }, [imageUrl]);

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
        <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs text-white">
          Drag to look around · scroll to zoom
        </p>
      )}
    </div>
  );
}
