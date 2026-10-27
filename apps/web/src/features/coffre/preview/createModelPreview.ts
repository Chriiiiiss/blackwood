import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  type BufferGeometry,
  DirectionalLight,
  HemisphereLight,
  type Material,
  Mesh,
  PerspectiveCamera,
  Scene,
  Sphere,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { PreviewModel, PreviewModelFactory } from "./model";

function disposeModel(model: PreviewModel) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  model.object.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof Texture) textures.add(value);
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

/** One on-demand renderer, independent of the selected model; no demo/TV timeline. */
export function createModelPreview(
  canvas: HTMLCanvasElement,
  onState: (state: "ready" | "fallback") => void,
) {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = ACESFilmicToneMapping;
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1.3));
  scene.add(new HemisphereLight(0xfff0df, 0x3d284d, 1.5));
  const light = new DirectionalLight(0xfff2df, 2);
  light.position.set(-3, 5, 8);
  scene.add(light);
  const camera = new PerspectiveCamera(36, 1, 0.1, 150);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = false;
  let active = true;
  let generation = 0;
  let model: PreviewModel | null = null;
  let radius = 4;
  const draw = () => {
    if (
      !active ||
      !model ||
      document.hidden ||
      renderer.getContext().isContextLost()
    )
      return;
    renderer.render(scene, camera);
    canvas.dataset.renderer = "three";
    canvas.dataset.model = model.object.name;
    canvas.dataset.view = camera.position
      .toArray()
      .map((value) => value.toFixed(3))
      .join(",");
  };
  const reset = () => {
    if (!model) return;
    const direction = new Vector3(0.22, -0.15, 1).normalize();
    camera.position.copy(direction);
    camera.lookAt(0, 0, 0);
    const inverse = camera.quaternion.clone().invert();
    const bounds = new Box3().setFromObject(model.object);
    const vertical = Math.tan(Math.PI / 10);
    let distance = 0;
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const point = new Vector3(x, y, z).applyQuaternion(inverse);
          distance = Math.max(
            distance,
            point.z + Math.abs(point.x) / (vertical * camera.aspect),
            point.z + Math.abs(point.y) / vertical,
          );
        }
    distance *= 1.15;
    camera.position.copy(direction).multiplyScalar(distance);
    controls.target.set(0, 0, 0);
    controls.minDistance = radius * 1.3;
    controls.maxDistance = distance * 2.8;
    controls.update();
    draw();
  };
  const resize = () => {
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height || !active) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    reset();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  controls.addEventListener("change", draw);
  document.addEventListener("visibilitychange", draw);
  const lost = (event: Event) => {
    event.preventDefault();
    if (active) onState("fallback");
  };
  canvas.addEventListener("webglcontextlost", lost);
  resize();
  return {
    async replace(factory: PreviewModelFactory) {
      const current = ++generation;
      if (renderer.getContext().isContextLost()) {
        onState("fallback");
        return;
      }
      try {
        const next = await factory();
        if (!active || current !== generation) {
          disposeModel(next);
          return;
        }
        const bounds = new Box3().setFromObject(next.object);
        next.object.position.sub(bounds.getCenter(new Vector3()));
        const nextRadius = bounds.getBoundingSphere(new Sphere()).radius;
        const resetView =
          model?.object.name !== next.object.name ||
          Math.abs(nextRadius - radius) > 0.05;
        if (model) {
          scene.remove(model.object);
          disposeModel(model);
        }
        model = next;
        radius = nextRadius;
        scene.add(model.object);
        canvas.dataset.revision = String(current);
        if (resetView) reset();
        draw();
        onState("ready");
      } catch {
        if (active && current === generation) onState("fallback");
      }
    },
    turn(direction: number) {
      camera.position.applyAxisAngle(
        new Vector3(0, 1, 0),
        (direction * Math.PI) / 8,
      );
      controls.update();
      draw();
    },
    zoom(factor: number) {
      const distance = Math.max(
        controls.minDistance,
        Math.min(controls.maxDistance, camera.position.length() * factor),
      );
      camera.position.setLength(distance);
      controls.update();
      draw();
    },
    reset,
    dispose() {
      active = false;
      generation++;
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", lost);
      document.removeEventListener("visibilitychange", draw);
      controls.dispose();
      if (model) disposeModel(model);
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
