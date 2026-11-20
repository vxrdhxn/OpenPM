import {
  AmbientLight,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  RingGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { SceneContext, SceneHandle } from '../engine';
import { BRAND, canvasTexture, clamp, glowSprite, pointCloud, roundRect, shellPoint } from './util';

export interface ProjectTile {
  initial: string;
  name: string;
  from: string;
  to: string;
}

/** Shown when the organization has no projects yet. */
const PLACEHOLDERS: ProjectTile[] = [
  { initial: '+', name: 'Your first board', from: '#4f46e5', to: '#6d28d9' },
  { initial: '+', name: 'Launch plan', from: '#0e7490', to: '#1d4ed8' },
  { initial: '+', name: 'Roadmap', from: '#a21caf', to: '#7e22ce' },
  { initial: '+', name: 'Bugs', from: '#e11d48', to: '#be185d' },
];

const W = 1.6;
const H = 1.05;

function tileFace(p: ProjectTile, font: string) {
  return canvasTexture(512, 336, (c) => {
    roundRect(c, 0, 0, 512, 336, 44);
    c.save();
    c.clip();
    const g = c.createLinearGradient(0, 0, 512, 336);
    g.addColorStop(0, p.from);
    g.addColorStop(1, p.to);
    c.fillStyle = g;
    c.fillRect(0, 0, 512, 336);
    // Dots, like the project cards' header.
    c.fillStyle = 'rgba(255,255,255,0.14)';
    for (let x = 16; x < 512; x += 28) for (let y = 16; y < 150; y += 28) c.fillRect(x, y, 4, 4);
    c.fillStyle = 'rgba(255,255,255,0.16)';
    c.beginPath();
    c.arc(470, 30, 110, 0, Math.PI * 2);
    c.fill();
    c.restore();

    c.fillStyle = 'rgba(255,255,255,0.95)';
    roundRect(c, 36, 40, 112, 112, 30);
    c.fill();
    c.fillStyle = p.from;
    c.font = `800 68px ${font}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(p.initial, 92, 100);

    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#ffffff';
    c.font = `800 42px ${font}`;
    c.fillText(p.name, 36, 228, 440);
    c.fillStyle = 'rgba(255,255,255,0.45)';
    roundRect(c, 36, 260, 260, 14, 7);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.3)';
    roundRect(c, 36, 288, 170, 14, 7);
    c.fill();
  });
}

/** A slow carousel of the organization's own projects, as glossy 3D tiles in their own colors. */
export function projectsScene(ctx: SceneContext): SceneHandle {
  const { scene, camera, dark } = ctx;

  scene.add(new AmbientLight('#ffffff', dark ? 0.6 : 0.9));
  const key = new DirectionalLight('#ffffff', 1.6);
  key.position.set(2, 5, 6);
  scene.add(key);
  const glow = new PointLight(BRAND.fuchsia, 25, 12);
  glow.position.set(-3, -1, 2);
  scene.add(glow);

  const root = new Group();
  scene.add(root);
  const carousel = new Group();
  root.add(carousel);

  const halo = glowSprite(BRAND.violet, 7, dark ? 0.45 : 0.25);
  halo.position.set(0, 0.2, -2);
  root.add(halo);

  // A glowing ring the carousel turns above.
  const ring = new Mesh(
    new RingGeometry(2.3, 2.42, 96),
    new MeshBasicMaterial({ color: dark ? '#818cf8' : BRAND.violet, transparent: true, opacity: dark ? 0.5 : 0.35, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.95;
  root.add(ring);

  const sparks = pointCloud(
    120,
    () => shellPoint(3, 6.5),
    [BRAND.indigo, BRAND.violet, BRAND.fuchsia, BRAND.sky],
    0.06,
    dark ? 0.85 : 0.55,
    dark,
  );
  scene.add(sparks);

  let tiles: { group: Group; phase: number; angle: number }[] = [];
  let radius = 2.2;

  const build = (data: unknown) => {
    for (const t of tiles) {
      t.group.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose();
          const m = o.material as MeshBasicMaterial;
          m.map?.dispose();
          m.dispose();
        }
      });
      carousel.remove(t.group);
    }
    const items = (data as { items?: ProjectTile[] } | undefined)?.items ?? [];
    const list = (items.length ? items : PLACEHOLDERS).slice(0, 7);
    // At least four tiles, so the ring never looks empty.
    while (list.length < 4) list.push(list[list.length % Math.max(1, list.length)]);
    radius = clamp(list.length * 0.5, 2, 2.6);
    tiles = list.map((p, i) => {
      const group = new Group();
      const body = new Mesh(
        new RoundedBoxGeometry(W, H, 0.08, 4, 0.06),
        new MeshStandardMaterial({ color: p.to, roughness: 0.35, metalness: 0.1 }),
      );
      const face = new Mesh(new PlaneGeometry(W, H), new MeshBasicMaterial({ map: tileFace(p, ctx.font), transparent: true }));
      face.position.z = 0.041;
      group.add(body, face);
      carousel.add(group);
      return { group, phase: i * 1.3, angle: (i / list.length) * Math.PI * 2 };
    });
  };
  build(ctx.data);

  return {
    fit(aspect) {
      const d = aspect < 1.6 ? clamp(8.5 * (1.6 / aspect), 8.5, 15) : 8.5;
      camera.position.set(0, 1.5, d);
      camera.lookAt(0, -0.1, 0);
    },
    setData: build,
    update(t, pointer) {
      root.rotation.x = pointer.y * 0.08;
      carousel.rotation.y = t * 0.18 + pointer.x * 0.4;
      tiles.forEach(({ group, phase, angle }) => {
        group.position.set(Math.sin(angle) * radius, Math.sin(t * 0.9 + phase) * 0.12, Math.cos(angle) * radius);
        // Face outwards from the ring's center, so the front tile faces the viewer.
        group.rotation.set(0, angle, Math.sin(t * 0.6 + phase) * 0.04);
      });
      ring.rotation.z = t * 0.1;
      sparks.rotation.y = -t * 0.02;
    },
  };
}
