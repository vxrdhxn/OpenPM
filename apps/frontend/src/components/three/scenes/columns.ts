import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PointLight,
  Sprite,
  SpriteMaterial,
  type CanvasTexture,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { SceneContext, SceneHandle } from '../engine';
import { BRAND, canvasTexture, easeOutBack, glowSprite } from './util';

/** The board's columns, in order, with the same accent colors as the column headers. */
const COLORS = ['#94a3b8', '#3b82f6', '#f59e0b', '#10b981'];
const MAX_H = 2.1;
const GAP = 1.05;

function countTexture(n: number, color: string, dark: boolean, font: string): CanvasTexture {
  return canvasTexture(128, 128, (c) => {
    c.fillStyle = dark ? '#1e293b' : '#ffffff';
    c.beginPath();
    c.arc(64, 64, 54, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = 8;
    c.strokeStyle = color;
    c.stroke();
    c.fillStyle = dark ? '#f1f5f9' : '#0f172a';
    c.font = `800 ${n > 99 ? 36 : 50}px ${font}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(n), 64, 68);
  });
}

/**
 * A small 3D bar chart of the board: one glossy bar per column, as tall as its share of the tasks,
 * with the count floating above. Bars grow and shrink as cards move between columns.
 */
export function columnsScene(ctx: SceneContext): SceneHandle {
  const { scene, camera, dark, font } = ctx;

  scene.add(new AmbientLight('#ffffff', dark ? 0.7 : 1));
  const key = new DirectionalLight('#ffffff', 1.8);
  key.position.set(-3, 6, 5);
  scene.add(key);
  const rim = new PointLight(BRAND.fuchsia, 18, 10);
  rim.position.set(3, 1, -2);
  scene.add(rim);

  const root = new Group();
  scene.add(root);

  const halo = glowSprite(BRAND.violet, 5, dark ? 0.4 : 0.2);
  halo.position.set(0, 0.6, -1.6);
  root.add(halo);

  const base = new Mesh(
    new RoundedBoxGeometry(GAP * 4 + 0.3, 0.14, 1.3, 4, 0.06),
    new MeshPhysicalMaterial({ color: dark ? '#1e293b' : '#eef2ff', roughness: 0.3, clearcoat: 0.8 }),
  );
  base.position.y = -0.07;
  root.add(base);

  // A unit-height box with its base at y=0, so scaling y grows it upwards.
  const unit = new BoxGeometry(0.62, 1, 0.62);
  unit.translate(0, 0.5, 0);

  const bars = COLORS.map((color, i) => {
    const mesh = new Mesh(
      unit,
      new MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.15, emissive: color, emissiveIntensity: dark ? 0.25 : 0.12 }),
    );
    mesh.position.x = (i - 1.5) * GAP;
    root.add(mesh);
    const label = new Sprite(new SpriteMaterial({ transparent: true, depthWrite: false }));
    label.scale.set(0.55, 0.55, 1);
    label.position.x = mesh.position.x;
    root.add(label);
    return { mesh, label, color, count: -1, from: 0.08, to: 0.08, changedAt: -10 };
  });

  let clock = 0;
  const setData = (data: unknown) => {
    const counts = ((data as { counts?: number[] } | undefined)?.counts ?? [0, 0, 0, 0]).slice(0, 4);
    const max = Math.max(1, ...counts);
    bars.forEach((b, i) => {
      const n = counts[i] ?? 0;
      if (n === b.count) return;
      const mat = b.label.material as SpriteMaterial;
      mat.map?.dispose();
      mat.map = countTexture(n, b.color, dark, font);
      mat.needsUpdate = true;
      b.from = b.mesh.scale.y;
      b.to = 0.08 + (n / max) * MAX_H;
      b.count = n;
      b.changedAt = ctx.still ? -10 : clock;
    });
  };
  setData(ctx.data);

  return {
    fit(aspect) {
      const d = aspect < 2 ? 5.6 * (2 / aspect) : 5.6;
      camera.position.set(0, 2.6, d);
      camera.lookAt(0, 0.8, 0);
    },
    setData,
    update(t, pointer) {
      clock = t;
      root.rotation.y = -0.35 + pointer.x * 0.2 + Math.sin(t * 0.3) * 0.08;
      root.position.y = Math.sin(t * 0.8) * 0.04;
      bars.forEach((b, i) => {
        const k = Math.min(1, (t - b.changedAt) / 0.9);
        const h = b.from + (b.to - b.from) * easeOutBack(Math.max(0, k));
        b.mesh.scale.y = Math.max(0.05, h);
        b.label.position.y = b.mesh.scale.y + 0.42 + Math.sin(t * 1.4 + i) * 0.05;
      });
    },
  };
}
