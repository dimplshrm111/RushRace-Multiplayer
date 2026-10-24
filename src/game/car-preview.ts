"use client";

/**
 * Offscreen 3D previews of the garage cars. One small WebGL renderer renders
 * each (model, colour) combo once to a data URL; results are cached for the
 * session so the garage UI is instant after first load.
 */

import * as THREE from "three";
import { CAR_MODELS, getCarAssets, getCarMaterials, paintFor, type CarModelId } from "./cars";

const W = 460;
const H = 320;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
const cache = new Map<string, string>();

function ensureRenderer() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(W, H, false);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xffe9c9, 0xb98a5c, 1.15);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffd9a8, 2.0);
  key.position.set(6, 9, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xfff2d8, 0.9);
  rim.position.set(-7, 4, -4);
  scene.add(rim);

  camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 60);

  // soft ground blob (fake contact shadow)
  const cvs = document.createElement("canvas");
  cvs.width = 128;
  cvs.height = 128;
  const ctx = cvs.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    grad.addColorStop(0, "rgba(30,18,10,0.55)");
    grad.addColorStop(1, "rgba(30,18,10,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  const blobTex = new THREE.CanvasTexture(cvs);
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(7.4, 5.2),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.01;
  scene.add(blob);
}

function renderPreview(model: CarModelId, colorIdx: number): string {
  ensureRenderer();
  if (!renderer || !scene || !camera) return "";

  const paint = paintFor(model, colorIdx);
  const assets = getCarAssets(model, paint);
  const mats = getCarMaterials(model, paint, false);

  const car = new THREE.Group();
  for (const b of assets.bucketList) {
    const geo = assets.buckets[b];
    const mat = mats.mats[b];
    if (!geo || !mat) continue;
    car.add(new THREE.Mesh(geo, mat));
  }
  car.add(new THREE.Mesh(assets.brakeGeo, mats.brakeTemplate));
  for (const [x, z] of assets.wheelPos) {
    const wheel = new THREE.Mesh(assets.wheelTire, mats.mats.tire!);
    wheel.add(new THREE.Mesh(assets.wheelRim, mats.mats.rim!));
    wheel.position.set(x, assets.wheelRadius, z);
    car.add(wheel);
  }
  scene.add(car);

  // frame the car from a 3/4 front view
  const box = new THREE.Box3().setFromObject(car);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const dist = (maxDim / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.5;
  const dir = new THREE.Vector3(0.85, 0.42, 1).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.lookAt(center.x, center.y - maxDim * 0.04, center.z);

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");
  scene.remove(car);
  return url;
}

/** Resolve a preview image (data URL) for a car + colour, rendering on demand. */
export function getCarPreview(model: CarModelId, colorIdx: number): Promise<string> {
  const key = `${model}|${colorIdx}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    // render on the next frame so first paint of the UI isn't blocked
    requestAnimationFrame(() => {
      const url = renderPreview(model, colorIdx);
      cache.set(key, url);
      resolve(url);
    });
  });
}

/** Convenience: previews for every model in its default colour. */
export async function getDefaultCarPreviews(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const m of CAR_MODELS) {
    out[m.id] = await getCarPreview(m.id, 0);
  }
  return out;
}
