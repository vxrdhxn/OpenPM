import {
  AmbientLight,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { SceneContext, SceneHandle } from '../engine';
import {
  BRAND,
  avatarSprite,
  canvasTexture,
  cardFaceTexture,
  clamp,
  easeInOut,
  easeOutBack,
  glowSprite,
  glowTexture,
  pointCloud,
  shellPoint,
  type CardFace,
} from './util';

const COL_X = [-2.55, 0, 2.55];
const SLOT_Z = [-1.0, 0.25, 1.5];
const CARD = { w: 2.05, h: 0.09, d: 1.02 };

const COLUMNS = [
  { title: 'To Do', accent: '#94a3b8' },
  { title: 'In Progress', accent: '#3b82f6' },
  { title: 'Done', accent: '#10b981' },
];

const P = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#0ea5e9',
  low: '#64748b',
};

const STATIC_CARDS: (CardFace & { col: number; slot: number })[] = [
  { col: 0, slot: 0, title: 'Write launch post', priority: 'High', color: P.high, initials: 'JD', avatar: ['#e11d48', '#be185d'] },
  { col: 0, slot: 1, title: 'Research pricing', priority: 'Low', color: P.low, initials: 'AK', avatar: ['#0e7490', '#1d4ed8'] },
  { col: 1, slot: 0, title: 'Design onboarding', priority: 'Urgent', color: P.urgent, initials: 'SM', avatar: ['#4f46e5', '#6d28d9'] },
  { col: 1, slot: 1, title: 'Rate-limit dashboard', priority: 'Medium', color: P.medium, initials: 'RP', avatar: ['#0f766e', '#047857'] },
  { col: 2, slot: 0, title: 'Ship v0.1.0', priority: 'High', color: P.high, initials: 'LW', avatar: ['#b45309', '#c2410c'] },
  { col: 2, slot: 1, title: 'Set up CI', priority: 'Medium', color: P.medium, initials: 'AK', avatar: ['#0e7490', '#1d4ed8'] },
];

const MOVER: CardFace = { title: 'Fix sign-in bug', priority: 'Urgent', color: P.urgent, initials: 'You', avatar: ['#6366f1', '#d946ef'] };

/** One loop of the moving card: rest in To Do, drag to In Progress, rest, drag to Done, celebrate, reset. */
const CYCLE = 10;
const KEYS = { move1: [1.6, 3.0], move2: [5.0, 6.4], vanish: [8.8, 9.4], appear: [9.4, 10] } as const;

function cardMesh(face: CardFace, ctx: SceneContext) {
  const group = new Group();
  const body = new Mesh(
    new RoundedBoxGeometry(CARD.w, CARD.h, CARD.d, 4, 0.04),
    new MeshStandardMaterial({ color: ctx.dark ? '#1e293b' : '#ffffff', roughness: 0.55 }),
  );
  const top = new Mesh(
    new PlaneGeometry(CARD.w, CARD.d),
    new MeshBasicMaterial({ map: cardFaceTexture(face, ctx.dark, ctx.font), transparent: true }),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = CARD.h / 2 + 0.002;
  group.add(body, top);
  return group;
}

function columnHeader(title: string, accent: string, count: number, ctx: SceneContext) {
  const map = canvasTexture(512, 96, (c) => {
    c.fillStyle = accent;
    c.beginPath();
    c.arc(26, 48, 11, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = ctx.dark ? '#e2e8f0' : '#1e293b';
    c.font = `800 38px ${ctx.font}`;
    c.textBaseline = 'middle';
    c.fillText(title, 52, 50);
    const w = c.measureText(title).width;
    c.fillStyle = ctx.dark ? '#334155' : '#ffffff';
    c.beginPath();
    c.arc(52 + w + 34, 48, 22, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = ctx.dark ? '#cbd5e1' : '#475569';
    c.font = `700 26px ${ctx.font}`;
    c.textAlign = 'center';
    c.fillText(String(count), 52 + w + 34, 50);
  });
  const mesh = new Mesh(new PlaneGeometry(2.2, 0.41), new MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/** A mouse cursor, drawn once, that drags the moving card. */
function cursorSprite() {
  const map = canvasTexture(128, 128, (c) => {
    c.translate(30, 18);
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, 74);
    c.lineTo(20, 56);
    c.lineTo(34, 88);
    c.lineTo(48, 82);
    c.lineTo(34, 51);
    c.lineTo(60, 51);
    c.closePath();
    c.fillStyle = '#0f172a';
    c.fill();
    c.lineWidth = 6;
    c.strokeStyle = '#ffffff';
    c.stroke();
  });
  const s = new Sprite(new SpriteMaterial({ map, transparent: true, depthTest: false }));
  s.scale.set(0.5, 0.5, 1);
  s.center.set(0.23, 0.86);
  s.renderOrder = 10;
  return s;
}

export function kanbanScene(ctx: SceneContext): SceneHandle {
  const { scene, camera, dark } = ctx;

  scene.add(new AmbientLight('#ffffff', dark ? 0.55 : 0.9));
  scene.add(new HemisphereLight('#e0e7ff', dark ? '#0f172a' : '#f5d0fe', 0.6));
  const sun = new DirectionalLight('#ffffff', dark ? 1.1 : 1.5);
  sun.position.set(-4, 8, 5);
  scene.add(sun);
  const rim1 = new PointLight(BRAND.indigo, 30, 20);
  rim1.position.set(-5, 2, -3);
  const rim2 = new PointLight(BRAND.fuchsia, 24, 20);
  rim2.position.set(5, 1.5, 3);
  scene.add(rim1, rim2);

  const board = new Group();
  scene.add(board);

  // Contact shadow under the whole board.
  const shadow = new Mesh(
    new PlaneGeometry(10, 7.5),
    new MeshBasicMaterial({ map: glowTexture(dark ? '#000000' : '#4338ca', 0.4), transparent: true, opacity: dark ? 0.55 : 0.16, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.45;
  board.add(shadow);

  COLUMNS.forEach((col, i) => {
    const slab = new Mesh(
      new RoundedBoxGeometry(2.4, 0.16, 4.7, 5, 0.08),
      new MeshPhysicalMaterial({
        color: dark ? '#111a2e' : '#eef2ff',
        roughness: 0.35,
        clearcoat: 0.8,
        clearcoatRoughness: 0.3,
        transparent: true,
        opacity: dark ? 0.92 : 0.88,
      }),
    );
    slab.position.set(COL_X[i], -0.13, 0.15);
    board.add(slab);

    const bar = new Mesh(
      new RoundedBoxGeometry(2.4, 0.05, 0.12, 2, 0.025),
      new MeshStandardMaterial({ color: col.accent, emissive: col.accent, emissiveIntensity: 0.35 }),
    );
    bar.position.set(COL_X[i], -0.04, -2.14);
    board.add(bar);

    const count = STATIC_CARDS.filter((c) => c.col === i).length + (i === 0 ? 1 : 0);
    const header = columnHeader(col.title, col.accent, count, ctx);
    header.position.set(COL_X[i], 0.0, -1.78);
    board.add(header);
  });

  const statics = STATIC_CARDS.map((c, i) => {
    const m = cardMesh(c, ctx);
    m.position.set(COL_X[c.col], 0.05, SLOT_Z[c.slot]);
    board.add(m);
    return { mesh: m, phase: i * 1.7 };
  });

  // The card that moves itself across the board, its drop-target glow and the cursor dragging it.
  const mover = cardMesh(MOVER, ctx);
  board.add(mover);
  const moverShadow = new Mesh(
    new PlaneGeometry(2.6, 1.5),
    new MeshBasicMaterial({ map: glowTexture(dark ? '#000000' : '#312e81', 0.35), transparent: true, opacity: 0, depthWrite: false }),
  );
  moverShadow.rotation.x = -Math.PI / 2;
  board.add(moverShadow);
  const target = new Mesh(
    new PlaneGeometry(2.2, 1.15),
    new MeshBasicMaterial({ map: glowTexture(BRAND.indigo, 0.55), transparent: true, opacity: 0, depthWrite: false }),
  );
  target.rotation.x = -Math.PI / 2;
  target.position.y = 0.0;
  board.add(target);
  const cursor = cursorSprite();
  board.add(cursor);

  // Confetti when the card lands in Done.
  const burst = pointCloud(
    70,
    () => [0, 0, 0],
    [BRAND.indigo, BRAND.fuchsia, BRAND.emerald, '#f59e0b', BRAND.sky],
    0.13,
    1,
    false,
  );
  const burstDirs = Array.from({ length: 70 }, () => {
    const [x, y, z] = shellPoint(0.6, 1);
    return new Vector3(x * 2.2, Math.abs(y) * 2.6 + 0.6, z * 2.2);
  });
  burst.position.set(COL_X[2], 0.2, SLOT_Z[2]);
  board.add(burst);

  // Teammates hovering over the board.
  const avatars = [
    { s: avatarSprite('SM', '#4f46e5', '#6d28d9', ctx.font), x: -1.4, z: -0.6, y: 1.25 },
    { s: avatarSprite('JD', '#e11d48', '#be185d', ctx.font), x: 1.2, z: 0.6, y: 1.5 },
    { s: avatarSprite('LW', '#b45309', '#c2410c', ctx.font), x: 3.3, z: -1.2, y: 1.1 },
  ];
  avatars.forEach((a) => board.add(a.s));

  const halo = glowSprite(BRAND.violet, 11, dark ? 0.35 : 0.22);
  halo.position.set(0, -0.6, -2.2);
  scene.add(halo);

  const dust = pointCloud(
    220,
    () => shellPoint(5.5, 11),
    [BRAND.indigo, BRAND.violet, BRAND.fuchsia, BRAND.sky],
    0.07,
    dark ? 0.85 : 0.6,
    dark,
  );
  scene.add(dust);

  const base = new Vector3(0, 5.9, 8.6);
  const lookAt = new Vector3(0, -0.35, 0.2);
  const from = new Vector3();
  const to = new Vector3();

  const slot = (col: number) => new Vector3(COL_X[col], 0.05, SLOT_Z[2]);
  const progress = (t: number, [a, b]: readonly [number, number]) => clamp((t - a) / (b - a), 0, 1);

  return {
    fit(aspect) {
      const f = aspect < 1.5 ? clamp(1.5 / aspect, 1, 2.3) : 1;
      camera.position.copy(base).multiplyScalar(f);
      camera.lookAt(lookAt);
    },
    update(t, pointer) {
      board.rotation.y = -0.32 + pointer.x * 0.14 + Math.sin(t * 0.25) * 0.04;
      board.rotation.x = pointer.y * 0.05;
      board.position.y = Math.sin(t * 0.8) * 0.06;

      statics.forEach(({ mesh, phase }) => {
        mesh.position.y = 0.05 + Math.max(0, Math.sin(t * 0.9 + phase)) * 0.035;
      });
      avatars.forEach((a, i) => {
        a.s.position.set(a.x + Math.sin(t * 0.6 + i) * 0.15, a.y + Math.sin(t * 1.1 + i * 2) * 0.12, a.z);
      });
      dust.rotation.y = t * 0.03;

      // The moving card.
      const c = t % CYCLE;
      const m1 = progress(c, KEYS.move1);
      const m2 = progress(c, KEYS.move2);
      const dragging = (m1 > 0 && m1 < 1) || (m2 > 0 && m2 < 1);
      const leg = m2 > 0 ? 1 : 0;
      const k = easeInOut(leg ? m2 : m1);
      from.copy(slot(leg));
      to.copy(slot(leg + 1));
      mover.position.lerpVectors(from, to, k);
      const lift = Math.sin(k * Math.PI);
      mover.position.y += lift * 0.75;
      mover.rotation.z = dragging ? -Math.sin(k * Math.PI * 2) * 0.08 : 0;
      mover.rotation.x = dragging ? -lift * 0.12 : 0;

      const appear = progress(c, KEYS.appear);
      const vanish = progress(c, KEYS.vanish);
      const scale = c >= KEYS.appear[0] ? easeOutBack(appear) : 1 - easeInOut(vanish);
      mover.scale.setScalar(Math.max(0.001, scale));
      if (c >= KEYS.appear[0]) mover.position.copy(slot(0));

      moverShadow.position.set(mover.position.x, 0.0, mover.position.z + 0.05);
      moverShadow.scale.setScalar(1 + lift * 0.4);
      (moverShadow.material as MeshBasicMaterial).opacity = lift * (dark ? 0.6 : 0.3);

      target.position.set(to.x, 0.005, to.z);
      (target.material as MeshBasicMaterial).opacity = dragging ? Math.min(1, lift * 2) * 0.55 : 0;

      cursor.position.set(mover.position.x + 0.55, mover.position.y + 0.18, mover.position.z + 0.15);
      const cursorShown = dragging ? 1 : clamp(1 - Math.min(Math.abs(c - KEYS.move1[0]), Math.abs(c - KEYS.move2[0]), Math.abs(c - KEYS.move1[1]), Math.abs(c - KEYS.move2[1])) * 2.5, 0, 1);
      (cursor.material as SpriteMaterial).opacity = cursorShown;

      // Confetti after landing in Done.
      const b = clamp((c - KEYS.move2[1]) / 1.6, 0, 1);
      const pos = burst.geometry.getAttribute('position');
      for (let i = 0; i < burstDirs.length; i++) {
        const d = burstDirs[i];
        pos.setXYZ(i, d.x * b * 0.9, d.y * b - 2.4 * b * b, d.z * b * 0.9);
      }
      pos.needsUpdate = true;
      (burst.material as PointsMaterial).opacity = b > 0 && b < 1 ? 1 - b * b : 0;
    },
  };
}
