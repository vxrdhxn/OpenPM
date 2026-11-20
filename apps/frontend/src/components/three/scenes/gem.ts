import {
  AmbientLight,
  DirectionalLight,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { SceneContext, SceneHandle } from '../engine';
import { BRAND, canvasTexture, clamp, glowSprite, pointCloud, roundRect, shellPoint } from './util';

/** A tiny task card for the orbits: a colored stripe and two text lines. */
function miniCard(color: string, dark: boolean) {
  const group = new Group();
  const body = new Mesh(
    new RoundedBoxGeometry(0.7, 0.44, 0.06, 3, 0.03),
    new MeshStandardMaterial({ color: dark ? '#1e293b' : '#ffffff', roughness: 0.4 }),
  );
  const face = new Mesh(
    new PlaneGeometry(0.7, 0.44),
    new MeshBasicMaterial({
      transparent: true,
      map: canvasTexture(256, 160, (c) => {
        roundRect(c, 2, 2, 252, 156, 22);
        c.fillStyle = dark ? '#1e293b' : '#ffffff';
        c.fill();
        c.fillStyle = color;
        roundRect(c, 22, 22, 56, 12, 6);
        c.fill();
        c.fillStyle = dark ? '#cbd5e1' : '#334155';
        roundRect(c, 22, 58, 190, 16, 8);
        c.fill();
        c.fillStyle = dark ? '#475569' : '#cbd5e1';
        roundRect(c, 22, 88, 130, 14, 7);
        c.fill();
        c.fillStyle = color;
        c.beginPath();
        c.arc(214, 122, 18, 0, Math.PI * 2);
        c.fill();
      }),
    }),
  );
  face.position.z = 0.031;
  group.add(body, face);
  return group;
}

/**
 * An iridescent gem wrapped in a wire shell, with task cards orbiting it on tilted rings.
 * On the brand gradient (`tone: 'brand'`) everything is drawn in light, glassy tones.
 */
export function gemScene(ctx: SceneContext): SceneHandle {
  const { scene, camera, dark, tone } = ctx;
  const onBrand = tone === 'brand';

  scene.add(new AmbientLight('#ffffff', 0.6));
  const key = new DirectionalLight('#ffffff', 2.2);
  key.position.set(3, 4, 5);
  scene.add(key);
  const l1 = new PointLight(BRAND.fuchsia, 40, 15);
  l1.position.set(-3, -1, 3);
  const l2 = new PointLight(BRAND.sky, 30, 15);
  l2.position.set(3, -2, 2);
  const l3 = new PointLight(BRAND.indigo, 30, 15);
  l3.position.set(0, 3, -3);
  scene.add(l1, l2, l3);

  const root = new Group();
  scene.add(root);

  const halo = glowSprite(onBrand ? '#ffffff' : BRAND.violet, 6.5, onBrand ? 0.35 : dark ? 0.45 : 0.3);
  halo.position.z = -1.5;
  root.add(halo);

  const gem = new Mesh(
    new IcosahedronGeometry(1.05, 0),
    new MeshPhysicalMaterial({
      color: onBrand ? '#ffffff' : '#c7d2fe',
      roughness: 0.12,
      metalness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      iridescence: 1,
      iridescenceIOR: 1.6,
      iridescenceThicknessRange: [200, 600],
      flatShading: true,
      emissive: BRAND.indigo,
      emissiveIntensity: onBrand ? 0.12 : 0.18,
    }),
  );
  root.add(gem);

  const lineColor = onBrand ? '#ffffff' : dark ? '#a5b4fc' : BRAND.indigo;
  const shell = new LineSegments(
    new EdgesGeometry(new IcosahedronGeometry(1.6, 1)),
    new LineBasicMaterial({ color: lineColor, transparent: true, opacity: onBrand ? 0.4 : 0.3 }),
  );
  root.add(shell);

  // A bright dot on each vertex of the shell (the geometry repeats shared vertices; keep each once).
  const shellGeo = new IcosahedronGeometry(1.6, 1);
  const shellPos = shellGeo.getAttribute('position');
  const seen = new Map<string, [number, number, number]>();
  for (let i = 0; i < shellPos.count; i++) {
    const p: [number, number, number] = [shellPos.getX(i), shellPos.getY(i), shellPos.getZ(i)];
    seen.set(p.map((v) => v.toFixed(3)).join(), p);
  }
  shellGeo.dispose();
  const vertices = [...seen.values()];
  const nodes = pointCloud(
    vertices.length,
    (i) => vertices[i],
    [onBrand ? '#ffffff' : BRAND.fuchsia],
    0.12,
    0.9,
    true,
  );
  shell.add(nodes);

  const ringColor = onBrand ? '#ffffff' : dark ? '#818cf8' : BRAND.violet;
  const cardColors = [BRAND.emerald, '#f97316', BRAND.sky, BRAND.fuchsia, '#ef4444', BRAND.indigo];
  const rings = [
    { r: 2.45, tilt: new Vector3(1.15, 0.2, 0.15), speed: 0.22, cards: 3 },
    { r: 3.0, tilt: new Vector3(1.4, -0.5, -0.4), speed: -0.15, cards: 3 },
  ].map((spec, ri) => {
    const pivot = new Group();
    pivot.rotation.set(spec.tilt.x, spec.tilt.y, spec.tilt.z);
    const ring = new Mesh(
      new TorusGeometry(spec.r, 0.008, 6, 160),
      new MeshBasicMaterial({ color: ringColor, transparent: true, opacity: onBrand ? 0.45 : 0.35 }),
    );
    pivot.add(ring);
    const spinner = new Group();
    pivot.add(spinner);
    const cards = Array.from({ length: spec.cards }, (_, i) => {
      const card = miniCard(cardColors[(ri * 3 + i) % cardColors.length], dark && !onBrand);
      const a = (i / spec.cards) * Math.PI * 2;
      card.position.set(Math.cos(a) * spec.r, Math.sin(a) * spec.r, 0);
      spinner.add(card);
      return card;
    });
    const moon = new Mesh(new SphereGeometry(0.07, 16, 16), new MeshBasicMaterial({ color: onBrand ? '#ffffff' : BRAND.fuchsia }));
    moon.position.set(Math.cos(1) * spec.r, Math.sin(1) * spec.r, 0);
    spinner.add(moon);
    root.add(pivot);
    return { pivot, spinner, cards, speed: spec.speed };
  });

  const stars = pointCloud(
    160,
    () => shellPoint(3.5, 8),
    onBrand ? ['#ffffff', '#fae8ff', '#e0e7ff'] : [BRAND.indigo, BRAND.violet, BRAND.fuchsia],
    0.06,
    onBrand ? 0.8 : 0.6,
    onBrand || dark,
  );
  scene.add(stars);

  return {
    fit(aspect) {
      const d = aspect < 1 ? clamp(9 / aspect, 9, 16) : 9;
      camera.position.set(0, 0.4, d);
      camera.lookAt(0, 0, 0);
    },
    update(t, pointer) {
      root.rotation.y = pointer.x * 0.3;
      root.rotation.x = pointer.y * 0.2;
      root.position.y = Math.sin(t * 0.9) * 0.12;
      gem.rotation.set(t * 0.25, t * 0.35, 0);
      shell.rotation.set(-t * 0.1, -t * 0.15, 0);
      rings.forEach(({ spinner, cards, speed }) => {
        spinner.rotation.z = t * speed;
        // Keep each card upright to the viewer as it travels round.
        cards.forEach((c) => (c.rotation.z = -spinner.rotation.z));
      });
      stars.rotation.y = t * 0.02;
    },
  };
}
