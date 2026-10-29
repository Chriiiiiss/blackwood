import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Euler,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Mesh,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { createPreviewModel } from "../coffre/preview/createPreviewModel";
import { disposeModel } from "../coffre/preview/disposeModel";
import type { PreviewModel } from "../coffre/preview/model";
import type { PublicContribution } from "../coffre/requests";

type FloatingModel = {
  item: PublicContribution;
  model: PreviewModel;
  root: Group;
  width: number;
  height: number;
  seed: number;
  phase: number;
  lastRead: number;
};
type Focus = { id: string; startedAt: number; readingTime: number };
type Phase = "floating" | "arriving" | "reading" | "returning";
const residentLimit = 24;
const flightTime = 3000;
const foregroundZ = 12;
const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
function shuffled<T>(values: T[]) {
  for (let index = values.length - 1; index > 0; index--) {
    const next = Math.floor(Math.random() * (index + 1));
    [values[index], values[next]] = [values[next] as T, values[index] as T];
  }
  return values;
}
// Keep the actual models, with a bounded texture footprint for television GPUs.
function resizeTextures(model: PreviewModel) {
  const seen = new Set<CanvasTexture>();
  model.object.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      for (const texture of Object.values(material)) {
        if (!(texture instanceof CanvasTexture) || seen.has(texture)) continue;
        seen.add(texture);
        const image = texture.image;
        if (!(image instanceof HTMLCanvasElement)) continue;
        const ratio = Math.min(1, 1024 / Math.max(image.width, image.height));
        if (ratio === 1) continue;
        const smaller = document.createElement("canvas");
        smaller.width = Math.max(1, Math.round(image.width * ratio));
        smaller.height = Math.max(1, Math.round(image.height * ratio));
        const context = smaller.getContext("2d");
        if (!context) continue;
        context.drawImage(image, 0, 0, smaller.width, smaller.height);
        texture.image = smaller;
        texture.needsUpdate = true;
        image.width = image.height = 1;
      }
    }
  });
}
export function createTvScene(
  canvas: HTMLCanvasElement,
  onChange: (
    items: PublicContribution[],
    focused: PublicContribution | null,
  ) => void,
  onFailure: () => void,
  onPhotoFailure: () => void,
) {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.toneMapping = ACESFilmicToneMapping;
  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 20);
  scene.add(
    new AmbientLight(0xffffff, 1.2),
    new HemisphereLight(0xfff1de, 0x362144, 1.8),
  );
  const light = new DirectionalLight(0xfff3e2, 2.3);
  light.position.set(-3, 5, 12);
  scene.add(light);
  const dustGeometry = new BufferGeometry();
  dustGeometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      Array.from({ length: 96 * 3 }, (_, index) =>
        index % 3 === 2 ? -12 - Math.random() * 20 : (Math.random() - 0.5) * 70,
      ),
      3,
    ),
  );
  const dustMaterial = new PointsMaterial({
    color: new Color("#c8afea"),
    size: 0.035,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const dust = new Points(dustGeometry, dustMaterial);
  scene.add(dust);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const models = new Map<string, FloatingModel>();
  const pending = new Map<string, Promise<FloatingModel | null>>();
  const readingRotation = new Quaternion().setFromEuler(
    new Euler(-0.035, 0.07, -0.012),
  );
  const willowReadingRotation = new Quaternion().setFromEuler(
    new Euler(0.38, -0.14, -0.015),
  );
  let active = true,
    generation = 0,
    frame = 0,
    lastDraw = 0,
    serial = 0;
  let items: PublicContribution[] = [],
    queue: string[] = [];
  let focus: Focus | null = null;
  let phase: Phase = "floating";
  let nextAt = performance.now() + 6000;
  let selecting = false;
  let request = new AbortController();
  const born = performance.now();
  function notify() {
    const displayed = [...models.values()].map((entry) => entry.item);
    const focused =
      phase === "reading" && focus
        ? (models.get(focus.id)?.item ?? null)
        : null;
    canvas.dataset.items = displayed.map((item) => item.id).join(",");
    canvas.dataset.models = displayed.map((item) => item.frameId).join(",");
    canvas.dataset.focused = focus?.id ?? "";
    canvas.dataset.phase = phase;
    onChange(displayed, focused);
  }
  function remove(entry: FloatingModel) {
    scene.remove(entry.root);
    models.delete(entry.item.id);
    disposeModel(entry.model);
  }
  function dimensions() {
    if (!active) return;
    const width = Math.max(1, canvas.clientWidth),
      height = Math.max(1, canvas.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(
      Math.min(devicePixelRatio, 1.25, 1920 / Math.max(width, height)),
    );
    renderer.setSize(width, height, false);
  }
  async function make(item: PublicContribution, signal: AbortSignal) {
    let source: string | null = null;
    try {
      if (item.photoMediaId) {
        const response = await fetch(
          `/api/tv/coffre/media/${encodeURIComponent(item.photoMediaId)}/image`,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          },
        );
        if (!response.ok) {
          if (!signal.aborted) onPhotoFailure();
          throw new Error("TV photo unavailable");
        }
        source = URL.createObjectURL(await response.blob());
      }
      const model = await createPreviewModel(item.frameId, item.text, source);
      resizeTextures(model);
      return model;
    } finally {
      if (source) URL.revokeObjectURL(source);
    }
  }
  function load(item: PublicContribution): Promise<FloatingModel | null> {
    const existing = models.get(item.id);
    if (existing) return Promise.resolve(existing);
    const waiting = pending.get(item.id);
    if (waiting) return waiting;
    const version = generation,
      signal = request.signal;
    const job = make(item, signal)
      .then((model) => {
        if (!active || version !== generation || signal.aborted) {
          disposeModel(model);
          return null;
        }
        if (models.size >= residentLimit) {
          // Overflow enters one object at a time; the surrounding scene stays alive.
          const oldest = [...models.values()]
            .filter((entry) => entry.item.id !== focus?.id)
            .sort((a, b) => a.lastRead - b.lastRead)[0];
          if (oldest) remove(oldest);
        }
        const bounds = new Box3().setFromObject(model.object);
        const size = bounds.getSize(new Vector3());
        model.object.position.sub(bounds.getCenter(new Vector3()));
        const root = new Group();
        root.add(model.object);
        root.visible = false;
        scene.add(root);
        const seed = Math.random();
        const entry: FloatingModel = {
          item,
          model,
          root,
          width: size.x,
          height: size.y,
          seed,
          phase: serial++ * 2.399963 + seed * 6.28,
          lastRead: performance.now(),
        };
        models.set(item.id, entry);
        notify();
        return entry;
      })
      .catch(() => {
        if (active && version === generation && !signal.aborted) onFailure();
        return null;
      })
      .finally(() => {
        if (pending.get(item.id) === job) pending.delete(item.id);
      });
    pending.set(item.id, job);
    return job;
  }
  async function populate(version: number) {
    while (
      active &&
      version === generation &&
      models.size + pending.size < residentLimit
    ) {
      const next = items.find(
        (item) => !models.has(item.id) && !pending.has(item.id),
      );
      if (!next) return;
      await load(next);
    }
  }
  async function choose(now: number) {
    if (selecting || !items.length) return;
    selecting = true;
    const version = generation;
    if (!queue.length) queue = shuffled(items.map((item) => item.id));
    const id = queue.shift();
    const item = items.find((candidate) => candidate.id === id);
    const entry = item ? await load(item) : null;
    if (active && version === generation && entry) {
      entry.lastRead = performance.now();
      focus = {
        id: entry.item.id,
        startedAt: Math.max(now, performance.now()),
        readingTime: Math.max(
          10_000,
          Math.min(45_000, 7000 + [...(entry.item.text ?? "")].length * 75),
        ),
      };
      phase = "arriving";
      notify();
    }
    if (version === generation) selecting = false;
  }
  function draw(now: number) {
    if (!active) return;
    frame = requestAnimationFrame(draw);
    if (document.hidden || now - lastDraw < 33) return;
    lastDraw = now;
    const time = motion.matches ? 0 : (now - born) / 1000;
    let weight = 0;
    if (focus) {
      const age = now - focus.startedAt;
      const nextPhase: Phase =
        age < flightTime
          ? "arriving"
          : age < flightTime + focus.readingTime
            ? "reading"
            : "returning";
      weight =
        nextPhase === "arriving"
          ? ease(age / flightTime)
          : nextPhase === "reading"
            ? 1
            : 1 - ease((age - flightTime - focus.readingTime) / flightTime);
      if (motion.matches) weight = nextPhase === "returning" ? 0 : 1;
      if (age >= flightTime * 2 + focus.readingTime) {
        focus = null;
        phase = "floating";
        nextAt = now + 4500 + Math.random() * 4000;
        notify();
      } else if (phase !== nextPhase) {
        phase = nextPhase;
        notify();
      }
    } else if (items.length && now >= nextAt) void choose(now);
    for (const entry of models.values()) {
      const z =
        -6 - entry.seed * 22 + Math.sin(time * 0.12 + entry.phase) * 2.5;
      const height = 2 * Math.tan(Math.PI / 8) * (camera.position.z - z);
      const width = height * camera.aspect;
      const scale = (3.7 + entry.seed * 2.2) / entry.width;
      const x =
        Math.sin(time * (0.06 + entry.seed * 0.025) + entry.phase) *
        Math.max(0, width / 2 - entry.width * scale * 0.6);
      const y =
        Math.cos(time * (0.045 + entry.seed * 0.018) + entry.phase * 1.7) *
        Math.max(0, height / 2 - entry.height * scale * 0.6);
      const object = entry.root;
      object.visible = true;
      object.position.set(x, y, z);
      object.scale.setScalar(scale);
      object.rotation.set(
        0.3 + Math.sin(time * 0.15 + entry.phase) * 0.8,
        entry.phase + time * (0.06 + entry.seed * 0.08),
        Math.sin(time * 0.11 + entry.phase) * 0.45,
      );
      if (entry.item.id === focus?.id) {
        const frontHeight =
          2 * Math.tan(Math.PI / 8) * (camera.position.z - foregroundZ);
        const frontWidth = frontHeight * camera.aspect;
        const long = (entry.item.text?.length ?? 0) > 180;
        const portrait = camera.aspect < 1.25;
        const frontX = long && !portrait ? -frontWidth * 0.24 : 0;
        const frontY =
          long && portrait ? frontHeight * 0.2 : -frontHeight * 0.025;
        const frontScale = Math.min(
          (frontWidth * (long && !portrait ? 0.4 : 0.78)) / entry.width,
          (frontHeight * (long && portrait ? 0.32 : 0.65)) / entry.height,
        );
        const arc = Math.sin(weight * Math.PI);
        object.position.set(
          x + (frontX - x) * weight + arc * frontWidth * 0.06,
          y + (frontY - y) * weight + arc * frontHeight * 0.12,
          z + (foregroundZ - z) * weight,
        );
        object.scale.setScalar(scale + (frontScale - scale) * weight);
        object.quaternion.slerp(
          entry.item.frameId === "one-wish-willow"
            ? willowReadingRotation
            : readingRotation,
          weight,
        );
      }
    }
    dust.rotation.z = time * 0.003;
    renderer.render(scene, camera);
    canvas.dataset.renderer = "three";
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
      if (JSON.stringify(items) === JSON.stringify(next)) return;
      items = next;
      generation++;
      request.abort();
      request = new AbortController();
      pending.clear();
      selecting = false;
      // Preserve unchanged objects and trajectories; revoke changed/deleted content immediately.
      for (const entry of models.values()) {
        const nextItem = items.find((item) => item.id === entry.item.id);
        if (
          !nextItem ||
          JSON.stringify(nextItem) !== JSON.stringify(entry.item)
        )
          remove(entry);
      }
      if (focus && !models.has(focus.id)) {
        focus = null;
        phase = "floating";
        nextAt = performance.now() + 1000;
      }
      queue = shuffled(
        items.map((item) => item.id).filter((id) => id !== focus?.id),
      );
      notify();
      void populate(generation);
      void populate(generation);
    },
    dispose() {
      active = false;
      generation++;
      request.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", lost);
      for (const entry of models.values()) remove(entry);
      pending.clear();
      dustGeometry.dispose();
      dustMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
