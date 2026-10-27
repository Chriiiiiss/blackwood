import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  HemisphereLight,
  OrthographicCamera,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { createPreviewModel } from "../coffre/preview/createPreviewModel";
import { disposeModel } from "../coffre/preview/disposeModel";
import type { PreviewModel } from "../coffre/preview/model";
import type { PublicContribution } from "../coffre/requests";

type FloatingModel = {
  id: string;
  model: PreviewModel;
  width: number;
  height: number;
  baseX: number;
  baseY: number;
  seed: number;
};
export function createTvScene(
  canvas: HTMLCanvasElement,
  onBatch: (items: PublicContribution[]) => void,
  onFailure: () => void,
  onPhotoFailure: () => void,
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
  const camera = new OrthographicCamera(-10, 10, 5, -5, 0.1, 100);
  camera.position.set(0, 0, 25);
  scene.add(
    new AmbientLight(0xffffff, 1.2),
    new HemisphereLight(0xfff1de, 0x362144, 1.8),
  );
  const light = new DirectionalLight(0xfff3e2, 2.3);
  light.position.set(-3, 5, 12);
  scene.add(light);
  const dustGeometry = new BufferGeometry();
  const particles = Array.from({ length: 100 * 3 }, (_, index) =>
    index % 3 === 2 ? -4 : (Math.random() - 0.5) * 28,
  );
  dustGeometry.setAttribute(
    "position",
    new Float32BufferAttribute(particles, 3),
  );
  const dustMaterial = new PointsMaterial({
    color: new Color("#c8afea"),
    size: 0.025,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const dust = new Points(dustGeometry, dustMaterial);
  scene.add(dust);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let active = true,
    generation = 0,
    cursor = 0,
    frame = 0,
    lastDraw = 0;
  let items: PublicContribution[] = [],
    visible: FloatingModel[] = [],
    visibleItems: PublicContribution[] = [];
  let nextAt = 0,
    loading = false,
    request = new AbortController();
  const clear = () => {
    for (const entry of visible) {
      scene.remove(entry.model.object);
      disposeModel(entry.model);
    }
    visible = [];
    visibleItems = [];
    canvas.dataset.items = "";
  };
  function dimensions() {
    const aspect = Math.max(
      0.3,
      canvas.clientWidth / Math.max(1, canvas.clientHeight),
    );
    camera.left = -5 * aspect;
    camera.right = 5 * aspect;
    camera.top = 5;
    camera.bottom = -5;
    camera.updateProjectionMatrix();
    renderer.setSize(
      Math.max(1, canvas.clientWidth),
      Math.max(1, canvas.clientHeight),
      false,
    );
    const long = visibleItems.some((item) => (item.text?.length ?? 0) > 180);
    const columns = visible.length;
    const width = camera.right - camera.left;
    visible.forEach((entry, index) => {
      const slot = width / Math.max(1, columns);
      const maximumWidth =
        long && aspect >= 1.25 ? width * 0.44 : Math.min(9.5, slot * 0.84);
      const maximumHeight = long && aspect < 1.25 ? 4.4 : 7.1;
      entry.model.object.scale.setScalar(
        Math.min(maximumWidth / entry.width, maximumHeight / entry.height),
      );
      entry.baseX =
        long && aspect >= 1.25
          ? -width * 0.25
          : (index - (columns - 1) / 2) * slot;
      entry.baseY =
        long && aspect < 1.25
          ? 2
          : columns > 1
            ? index % 2
              ? -0.5
              : 0.5
            : 0.2;
    });
  }
  async function make(item: PublicContribution, signal: AbortSignal) {
    let source: string | null = null;
    try {
      if (item.photoMediaId) {
        const response = await fetch(
          `/api/tv/coffre/media/${encodeURIComponent(item.photoMediaId)}/image`,
          { credentials: "same-origin", cache: "no-store", signal },
        );
        if (!response.ok) {
          onPhotoFailure();
          throw new Error("TV photo unavailable");
        }
        source = URL.createObjectURL(await response.blob());
      }
      return await createPreviewModel(item.frameId, item.text, source);
    } finally {
      if (source) URL.revokeObjectURL(source);
    }
  }
  async function replace() {
    if (!active || loading || !items.length) return;
    loading = true;
    const version = ++generation;
    request.abort();
    request = new AbortController();
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const candidates = Array.from(
      { length: Math.min(3, items.length) },
      (_, index) => items[(cursor + index) % items.length],
    );
    const count =
      aspect < 1.25 ||
      candidates.some((item) => (item?.text?.length ?? 0) > 180)
        ? 1
        : Math.min(3, items.length);
    const batch = Array.from(
      { length: count },
      (_, index) => items[(cursor + index) % items.length],
    ).filter((item): item is PublicContribution => !!item);
    const signal = request.signal;
    const settled = await Promise.allSettled(
      batch.map((item) => make(item, signal)),
    );
    if (!active || version !== generation || signal.aborted) {
      settled.forEach((result) => {
        if (result.status === "fulfilled") disposeModel(result.value);
      });
      if (version === generation) loading = false;
      return;
    }
    if (settled.some((result) => result.status === "rejected")) {
      settled.forEach((result) => {
        if (result.status === "fulfilled") disposeModel(result.value);
      });
      loading = false;
      onFailure();
      return;
    }
    clear();
    visibleItems = batch;
    settled.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const model = result.value;
      const bounds = new Box3().setFromObject(model.object);
      const size = bounds.getSize(new Vector3());
      model.object.position.sub(bounds.getCenter(new Vector3()));
      scene.add(model.object);
      visible.push({
        id: batch[index]?.id ?? "",
        model,
        width: size.x,
        height: size.y,
        baseX: 0,
        baseY: 0,
        seed: index * 2.1 + 0.4,
      });
    });
    cursor = (cursor + batch.length) % items.length;
    nextAt =
      performance.now() +
      Math.max(
        20,
        Math.min(
          60,
          12 +
            Math.max(...batch.map((item) => [...(item.text ?? "")].length)) /
              12,
        ),
      ) *
        1000;
    loading = false;
    dimensions();
    onBatch(batch);
    canvas.dataset.items = batch.map((item) => item.id).join(",");
    canvas.dataset.models = batch.map((item) => item.frameId).join(",");
    canvas.dataset.revision = String(version);
  }
  function draw(now: number) {
    if (!active) return;
    frame = requestAnimationFrame(draw);
    if (document.hidden || now - lastDraw < 33) return;
    lastDraw = now;
    const time = motion.matches ? 0 : now / 1000;
    for (const entry of visible) {
      const object = entry.model.object;
      object.position.set(
        entry.baseX + Math.sin(time * 0.17 + entry.seed) * 0.13,
        entry.baseY + Math.sin(time * 0.29 + entry.seed) * 0.22,
        0,
      );
      object.rotation.set(
        (object.name === "one-wish-willow" ? 0.27 : -0.02) +
          Math.sin(time * 0.19 + entry.seed) * 0.055,
        Math.sin(time * 0.23 + entry.seed) * 0.14,
        Math.sin(time * 0.13 + entry.seed) * 0.045,
      );
    }
    dust.rotation.z = time * 0.004;
    renderer.render(scene, camera);
    canvas.dataset.renderer = "three";
    if (items.length && now >= nextAt && !loading) void replace();
  }
  const observer = new ResizeObserver(dimensions);
  observer.observe(canvas);
  const lost = (event: Event) => {
    event.preventDefault();
    if (active) onFailure();
  };
  canvas.addEventListener("webglcontextlost", lost);
  dimensions();
  frame = requestAnimationFrame(draw);
  return {
    setItems(next: PublicContribution[]) {
      const changed = JSON.stringify(items) !== JSON.stringify(next);
      items = next;
      if (!changed) return;
      generation++;
      request.abort();
      loading = false;
      // Removed or changed content must leave GPU memory before loading replacement models.
      clear();
      cursor = 0;
      nextAt = 0;
      onBatch([]);
      if (items.length) void replace();
    },
    dispose() {
      active = false;
      generation++;
      request.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", lost);
      clear();
      dustGeometry.dispose();
      dustMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
