/**
 * The three.js side of ThreeScene: one renderer per scene, sized to its container, paused while
 * offscreen or in a hidden tab, gently following the pointer, and fully disposed on unmount.
 * Loaded on demand (dynamic import), so three.js never lands in the main bundle.
 */
import { Clock, Material, Mesh, Object3D, PerspectiveCamera, Points, Scene, Texture, WebGLRenderer } from 'three';
import { sculptureScene } from './scenes/sculpture';
import { gemScene } from './scenes/gem';
import { planetScene } from './scenes/planet';
import { projectsScene } from './scenes/projects';
import { columnsScene } from './scenes/columns';

export type SceneName = 'sculpture' | 'gem' | 'planet' | 'projects' | 'columns';
/** `surface`: drawn over the page background. `brand`: drawn over the indigo-violet gradient. */
export type SceneTone = 'surface' | 'brand';

export interface SceneContext {
  scene: Scene;
  camera: PerspectiveCamera;
  dark: boolean;
  tone: SceneTone;
  /** The page's own font stack, so text drawn into textures matches the UI. */
  font: string;
  /** The scene's data at mount (scenes that show live data); later changes arrive via setData. */
  data: unknown;
  /** Reduced motion: one still frame, so data changes should land at once, not animate. */
  still: boolean;
}

export interface SceneHandle {
  /** Advance to time `t` (seconds). `pointer` is -1..1 on each axis, already smoothed. */
  update(t: number, pointer: { x: number; y: number }): void;
  /** Frame the scene for a new aspect ratio. */
  fit(aspect: number): void;
  /** New data from the page (optional: only data-driven scenes have it). */
  setData?(data: unknown): void;
}

export interface Mounted {
  dispose(): void;
  setData(data: unknown): void;
}

const SCENES: Record<SceneName, (ctx: SceneContext) => SceneHandle> = {
  sculpture: sculptureScene,
  gem: gemScene,
  planet: planetScene,
  projects: projectsScene,
  columns: columnsScene,
};

export function mount(
  el: HTMLElement,
  name: SceneName,
  opts: { tone: SceneTone; dark: boolean; still: boolean; data?: unknown; onReady: () => void },
): Mounted {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  el.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 1, 0.1, 100);
  const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  const handle = SCENES[name]({ scene, camera, dark: opts.dark, tone: opts.tone, font, data: opts.data, still: opts.still });

  const clock = new Clock();
  const pointer = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  let raf = 0;
  let onScreen = true;
  let ready = false;

  const render = (t: number) => {
    handle.update(t, pointer);
    renderer.render(scene, camera);
    if (!ready) {
      ready = true;
      opts.onReady();
    }
  };

  const resize = () => {
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    handle.fit(camera.aspect);
    camera.updateProjectionMatrix();
    if (opts.still) render(2.4);
  };

  const frame = () => {
    raf = requestAnimationFrame(frame);
    pointer.x += (target.x - pointer.x) * 0.05;
    pointer.y += (target.y - pointer.y) * 0.05;
    render(clock.getElapsedTime());
  };
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  // A paused clock keeps its time, so the animation resumes where it left off.
  const pausedAt = { t: 0 };
  const pause = () => {
    if (!raf) return;
    pausedAt.t = clock.getElapsedTime();
    stop();
  };
  const resume = () => {
    if (opts.still || raf || !onScreen || document.hidden) return;
    clock.start();
    clock.elapsedTime = pausedAt.t;
    raf = requestAnimationFrame(frame);
  };

  const onPointer = (e: PointerEvent) => {
    target.x = (e.clientX / window.innerWidth) * 2 - 1;
    target.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  const onVisibility = () => (document.hidden ? pause() : resume());

  const ro = new ResizeObserver(resize);
  ro.observe(el);
  const io = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen) resume();
    else pause();
  });
  io.observe(el);
  document.addEventListener('visibilitychange', onVisibility);
  if (!opts.still) window.addEventListener('pointermove', onPointer, { passive: true });

  resize();
  if (opts.still) render(2.4);
  else resume();

  const dispose = () => {
    stop();
    ro.disconnect();
    io.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pointermove', onPointer);
    disposeTree(scene);
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
  return {
    dispose,
    setData(data) {
      handle.setData?.(data);
      if (opts.still) render(2.4);
    },
  };
}

/** Free every geometry, material and texture in the scene: WebGL does not garbage-collect them. */
function disposeTree(root: Object3D) {
  const textures = new Set<Texture>();
  root.traverse((obj) => {
    if (obj instanceof Mesh || obj instanceof Points || 'geometry' in obj) {
      const o = obj as Mesh;
      o.geometry?.dispose?.();
      const mats: Material[] = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const value of Object.values(m)) if (value instanceof Texture) textures.add(value);
        m.dispose();
      }
    }
  });
  textures.forEach((t) => t.dispose());
}
