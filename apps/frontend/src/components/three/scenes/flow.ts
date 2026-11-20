import {
  AmbientLight,
  BufferGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Line,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  QuadraticBezierCurve3,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { SceneContext, SceneHandle } from '../engine';
import { canvasTexture, clamp, easeInOut, easeOutBack, glowTexture, roundRect } from './util';

const CARD = { w: 1.5, h: 0.035, d: 1.0 };
const GAP = 0.075;
/** The three stations: To Do, In Progress, Done, on a gentle arc. */
const STATIONS = [
  { x: -3.1, z: 0.5, label: 'To do', cards: 6 },
  { x: 0, z: -0.45, label: 'In progress', cards: 4 },
  { x: 3.1, z: 0.5, label: 'Done', cards: 3 },
];
const CYCLE = 4.2;

function cardFace(n: number, dark: boolean, font: string, red = false) {
  const ink = dark ? '#ebebe8' : '#121214';
  return canvasTexture(384, 256, (c) => {
    roundRect(c, 2, 2, 380, 252, 26);
    c.fillStyle = dark ? '#1c1c20' : '#fbfbf9';
    c.fill();
    c.fillStyle = ink;
    c.globalAlpha = 0.8;
    c.font = `500 20px ${font}`;
    c.fillText(String(n).padStart(2, '0'), 26, 44);
    c.globalAlpha = 0.16;
    roundRect(c, 26, 110, 230, 12, 6);
    c.fill();
    roundRect(c, 26, 140, 160, 12, 6);
    c.fill();
    c.globalAlpha = 1;
    c.fillStyle = red ? '#ff4040' : ink;
    c.beginPath();
    c.arc(346, 214, 11, 0, Math.PI * 2);
    c.fill();
  });
}

function plinthLabel(i: number, label: string, dark: boolean, font: string) {
  return canvasTexture(512, 128, (c) => {
    c.fillStyle = dark ? '#ebebe8' : '#121214';
    c.font = `500 40px ${font}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(`${String(i + 1).padStart(2, '0')} · ${label}`, 256, 64);
  });
}

/**
 * The home page's centrepiece: work moving to done. Three ink plinths hold stacks of paper task
 * cards; cards lift off one stack and arc along dotted paths to the next. When a card lands in
 * Done, the red sphere above it pops and sends out a ripple. Paper, ink, one red.
 */
export function flowScene(ctx: SceneContext): SceneHandle {
  const { scene, camera, dark, font } = ctx;
  const ink = dark ? '#ebebe8' : '#121214';

  scene.add(new AmbientLight('#ffffff', dark ? 0.6 : 0.9));
  const key = new DirectionalLight('#fff7ef', dark ? 1.7 : 2.1);
  key.position.set(-4, 8, 6);
  scene.add(key);
  const glow = new PointLight('#ff4040', dark ? 16 : 9, 7);
  glow.position.set(3.1, 2.4, 1.4);
  scene.add(glow);

  const root = new Group();
  scene.add(root);

  const shadow = new Mesh(
    new PlaneGeometry(12, 7),
    new MeshBasicMaterial({ map: glowTexture('#000000', 0.35), transparent: true, opacity: dark ? 0.5 : 0.14, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.62;
  root.add(shadow);

  const paper = new MeshPhysicalMaterial({ color: dark ? '#26262b' : '#f4f4f2', roughness: 0.65, clearcoat: 0.25 });
  const cardGeo = new RoundedBoxGeometry(CARD.w, CARD.h, CARD.d, 3, 0.012);
  const faceGeo = new PlaneGeometry(CARD.w, CARD.d);

  const makeCard = (n: number, red = false) => {
    const g = new Group();
    const face = new Mesh(faceGeo, new MeshBasicMaterial({ map: cardFace(n, dark, font, red), transparent: true }));
    face.rotation.x = -Math.PI / 2;
    face.position.y = CARD.h / 2 + 0.002;
    g.add(new Mesh(cardGeo, paper), face);
    return g;
  };

  // Plinths, labels and their stacks.
  const tops: Vector3[] = [];
  let n = 1;
  STATIONS.forEach((st, i) => {
    const plinth = new Mesh(
      new CylinderGeometry(1.15, 1.2, 0.5, 64),
      new MeshStandardMaterial({ color: dark ? '#1c1c20' : '#121214', roughness: 0.4, metalness: 0.1 }),
    );
    plinth.position.set(st.x, -0.35, st.z);
    root.add(plinth);
    const rim = new Mesh(new RingGeometry(1.16, 1.19, 64), new MeshBasicMaterial({ color: i === 2 ? '#ff4040' : ink, transparent: true, opacity: i === 2 ? 0.9 : 0.25 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(st.x, -0.095, st.z);
    root.add(rim);
    const label = new Mesh(new PlaneGeometry(3, 0.75), new MeshBasicMaterial({ map: plinthLabel(i, st.label, dark, font), transparent: true, depthWrite: false }));
    label.rotation.x = -Math.PI / 2;
    label.position.set(st.x, -0.6, st.z + 1.75);
    root.add(label);

    const stack = new Group();
    stack.position.set(st.x, -0.08, st.z);
    for (let k = 0; k < st.cards; k++) {
      const card = makeCard(n++, i === 2 && k === st.cards - 1);
      card.position.y = k * GAP;
      card.rotation.y = (k % 2 ? 1 : -1) * 0.05 * ((k * 7) % 3);
      stack.add(card);
    }
    root.add(stack);
    tops.push(new Vector3(st.x, -0.08 + st.cards * GAP, st.z));
  });

  // The dotted routes between stations.
  const curves = [0, 1].map((i) => {
    const a = tops[i];
    const b = tops[i + 1];
    const mid = a.clone().lerp(b, 0.5);
    mid.y += 1.9;
    return new QuadraticBezierCurve3(a, mid, b);
  });
  curves.forEach((curve) => {
    const line = new Line(
      new BufferGeometry().setFromPoints(curve.getPoints(60)),
      new LineDashedMaterial({ color: ink, dashSize: 0.08, gapSize: 0.08, transparent: true, opacity: dark ? 0.45 : 0.5 }),
    );
    line.computeLineDistances();
    root.add(line);
  });

  // Two cards in flight, half a cycle apart.
  const movers = [makeCard(n++), makeCard(n++)];
  movers.forEach((m) => root.add(m));

  // Done's red sphere and the ripple it sends out when a card lands.
  const goal = new Mesh(
    new SphereGeometry(0.42, 48, 48),
    new MeshPhysicalMaterial({ color: '#ff4040', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 }),
  );
  root.add(goal);
  const ripple = new Mesh(new RingGeometry(0.9, 0.94, 64), new MeshBasicMaterial({ color: '#ff4040', transparent: true, opacity: 0, depthWrite: false }));
  ripple.rotation.x = -Math.PI / 2;
  ripple.position.set(STATIONS[2].x, tops[2].y + 0.01, STATIONS[2].z);
  root.add(ripple);

  return {
    fit(aspect) {
      const d = aspect < 1.5 ? clamp(10.5 * (1.5 / aspect), 10.5, 19) : 10.5;
      camera.position.set(0, 4.4, d);
      camera.lookAt(0, 0.1, 0);
    },
    update(t, pointer) {
      root.rotation.y = pointer.x * 0.3 + Math.sin(t * 0.2) * 0.08;
      root.rotation.x = pointer.y * 0.06;

      let landed = 1e9;
      movers.forEach((m, i) => {
        // Each mover: rest on its source stack, fly the route, settle, then start over.
        const phase = ((t + (i * CYCLE) / 2) % CYCLE) / CYCLE;
        const leg = i; // mover 0: To Do → In Progress; mover 1: In Progress → Done
        const fly = clamp((phase - 0.2) / 0.55, 0, 1);
        const k = easeInOut(fly);
        m.position.copy(curves[leg].getPoint(k));
        m.position.y += 0.02;
        // Mid-flight the card tips its face toward the viewer, so it reads as a card, not an edge.
        m.rotation.set(Math.sin(k * Math.PI) * 0.75, k * Math.PI * 0.5, Math.sin(k * Math.PI * 2) * 0.12);
        const appear = clamp(phase / 0.15, 0, 1);
        const vanish = clamp((phase - 0.9) / 0.1, 0, 1);
        m.scale.setScalar(Math.max(0.001, easeOutBack(appear) * (1 - vanish)));
        if (leg === 1 && fly >= 1) landed = Math.min(landed, (phase - 0.75) * CYCLE);
      });

      // The goal bobs, and pops when a card lands in Done.
      const pop = landed < 1e8 ? Math.max(0, 1 - landed / 0.6) : 0;
      goal.position.set(STATIONS[2].x, tops[2].y + 1.25 + Math.sin(t * 1.2) * 0.1, STATIONS[2].z);
      goal.scale.setScalar(1 + Math.sin(pop * Math.PI) * 0.25);
      const r = landed < 1e8 ? clamp(landed / 1.0, 0, 1) : 1;
      ripple.scale.setScalar(0.6 + r * 1.6);
      (ripple.material as MeshBasicMaterial).opacity = (1 - r) * 0.8;
    },
  };
}
