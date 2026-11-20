import { BufferGeometry, Color, Float32BufferAttribute, Group, NormalBlending, AdditiveBlending, Points, PointsMaterial } from 'three';
import type { SceneContext, SceneHandle } from '../engine';
import { canvasTexture, clamp, easeInOut } from './util';

const N = 2600;
/** How long each shape holds, and how long the dots take to travel to the next one (seconds). */
const HOLD = 2.4;
const MOVE = 1.8;

type Shape = { pos: Float32Array; red: Float32Array };

/** A tiny seeded random, so the shapes are the same on every visit. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function shape(fill: (i: number, r: () => number) => [number, number, number, number]): Shape {
  const r = rng(7);
  const pos = new Float32Array(N * 3);
  const red = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const [x, y, z, isRed] = fill(i, r);
    pos.set([x, y, z], i * 3);
    red[i] = isRed;
  }
  return { pos, red };
}

/** Ideas: a loose, uneven cloud with a few red sparks. */
const cloud = () =>
  shape((i, r) => {
    const u = r() * 2 - 1;
    const th = r() * Math.PI * 2;
    const rad = 2.6 * Math.cbrt(r());
    const s = Math.sqrt(1 - u * u);
    return [rad * s * Math.cos(th) * 1.35, rad * u * 0.85, rad * s * Math.sin(th), r() < 0.03 ? 1 : 0];
  });

/** A plan: three columns of dotted task cards, one of them red (the one being worked on). */
const board = () => {
  const cards: [number, number, number][] = [];
  const cols = [-2.45, 0, 2.45];
  const counts = [3, 2, 2];
  cols.forEach((x, c) => {
    for (let k = 0; k < counts[c]; k++) cards.push([x, 1.15 - k * 1.05, c * 10 + k]);
  });
  return shape((i, r) => {
    // Every eighth dot draws a column header rule; the rest fill the cards.
    if (i % 8 === 0) {
      const x = cols[i % 3];
      return [x + (r() - 0.5) * 2.0, 1.95, (r() - 0.5) * 0.05, 0];
    }
    const [cx, cy, id] = cards[i % cards.length];
    const w = 2.0;
    const h = 0.82;
    const edge = r() < 0.45;
    let x: number;
    let y: number;
    if (edge) {
      // Outline.
      const t = r() * 2 * (w + h);
      if (t < w) [x, y] = [t - w / 2, h / 2];
      else if (t < w + h) [x, y] = [w / 2, h / 2 - (t - w)];
      else if (t < 2 * w + h) [x, y] = [w / 2 - (t - w - h), -h / 2];
      else [x, y] = [-w / 2, -h / 2 + (t - 2 * w - h)];
    } else {
      // Two text lines inside the card.
      const line = r() < 0.6 ? 0.12 : -0.12;
      x = -w / 2 + 0.18 + r() * (line > 0 ? 1.3 : 0.9);
      y = line;
    }
    return [cx + x, cy + y, (r() - 0.5) * 0.08, id === 10 ? 1 : 0];
  });
};

/** Done: a bold check mark inside a ring, all in red. */
const check = () => {
  const a: [number, number] = [-1.55, 0.05];
  const b: [number, number] = [-0.45, -1.05];
  const c: [number, number] = [1.75, 1.35];
  const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
  return shape((i, r) => {
    if (i % 3 === 0) {
      const th = r() * Math.PI * 2;
      const rad = 2.75 + (r() - 0.5) * 0.12;
      return [Math.cos(th) * rad, Math.sin(th) * rad, (r() - 0.5) * 0.1, 1];
    }
    const t = r() * (l1 + l2);
    const [p, q, k] = t < l1 ? [a, b, t / l1] : [b, c, (t - l1) / l2];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy);
    const off = (r() - 0.5) * 0.42;
    return [p[0] + dx * k - (dy / len) * off, p[1] + dy * k + (dx / len) * off, (r() - 0.5) * 0.25, 1];
  });
};

/**
 * The home page's centrepiece: one cloud of ink dots that keeps re-forming the way work does.
 * Loose ideas gather into a board of task cards, the board resolves into a red check mark, and
 * the check scatters back into ideas. The dots stream between shapes one after another, and they
 * part around the mouse. Paper, ink, one red.
 */
export function morphScene(ctx: SceneContext): SceneHandle {
  const { scene, camera, dark } = ctx;
  const shapes = [cloud(), board(), check()];
  const ink = new Color(dark ? '#ebebe8' : '#121214');
  const red = new Color('#ff4040');

  // Each dot sets off a little later than the one before it, so shapes pour rather than jump.
  const delay = new Float32Array(N);
  const r = rng(11);
  for (let i = 0; i < N; i++) delay[i] = r() * 0.45;

  const pos = new Float32Array(shapes[0].pos);
  const col = new Float32Array(N * 3);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  const dot = canvasTexture(64, 64, (c) => {
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(32, 32, 26, 0, Math.PI * 2);
    c.fill();
  });
  const points = new Points(
    geo,
    new PointsMaterial({
      size: 0.075,
      map: dot,
      vertexColors: true,
      transparent: true,
      alphaTest: 0.4,
      depthWrite: false,
      sizeAttenuation: true,
      blending: dark ? AdditiveBlending : NormalBlending,
    }),
  );
  const root = new Group();
  root.add(points);
  scene.add(root);

  const tmp = new Color();

  return {
    fit(aspect) {
      const d = aspect < 1.4 ? clamp(11 * (1.4 / aspect), 11, 19) : 11;
      camera.position.set(0, 0.6, d);
      camera.lookAt(0, 0, 0);
    },
    update(time, pointer) {
      const period = HOLD + MOVE;
      // With reduced motion there is one still frame: show the board, the most telling shape.
      const t = ctx.still ? period + 0.5 : time;
      const step = Math.floor(t / period);
      const from = shapes[step % shapes.length];
      const to = shapes[(step + 1) % shapes.length];
      const local = t - step * period - HOLD; // < 0 while holding
      // Where the mouse is, roughly, on the plane of the dots.
      const px = pointer.x * 5.2;
      const py = -pointer.y * 3.2;

      const position = geo.getAttribute('position') as Float32BufferAttribute;
      const color = geo.getAttribute('color') as Float32BufferAttribute;
      for (let i = 0; i < N; i++) {
        const k = local < 0 ? 0 : easeInOut(clamp((local / MOVE - delay[i]) / (1 - 0.45), 0, 1));
        const i3 = i * 3;
        let x = from.pos[i3] + (to.pos[i3] - from.pos[i3]) * k;
        let y = from.pos[i3 + 1] + (to.pos[i3 + 1] - from.pos[i3 + 1]) * k;
        let z = from.pos[i3 + 2] + (to.pos[i3 + 2] - from.pos[i3 + 2]) * k;
        // In flight, dots bow out of the plane; at rest they shimmer a little.
        const flight = Math.sin(k * Math.PI);
        z += flight * (0.8 + (i % 7) * 0.12);
        x += Math.sin(t * 0.9 + i) * 0.015;
        y += Math.cos(t * 0.8 + i * 1.3) * 0.015;
        // Part around the mouse.
        const dx = x - px;
        const dy = y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1.2) {
          const push = (1.2 - d2) * 0.35;
          x += dx * push;
          y += dy * push;
        }
        position.setXYZ(i, x, y, z);
        const redness = from.red[i] + (to.red[i] - from.red[i]) * k;
        tmp.copy(ink).lerp(red, redness);
        color.setXYZ(i, tmp.r, tmp.g, tmp.b);
      }
      position.needsUpdate = true;
      color.needsUpdate = true;

      root.rotation.y = Math.sin(t * 0.25) * 0.35 + pointer.x * 0.15;
      root.rotation.x = -0.08 + pointer.y * 0.08;
    },
  };
}
