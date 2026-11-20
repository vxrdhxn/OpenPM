import {
  AmbientLight,
  DirectionalLight,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  MeshBasicMaterial,
  PointLight,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { SceneContext, SceneHandle } from '../engine';
import { BRAND, cardFaceTexture, clamp, glowSprite, pointCloud, shellPoint } from './util';

/** The 404 scene: a faceted planet with a ring of dust, a moon, and one task card adrift in space. */
export function planetScene(ctx: SceneContext): SceneHandle {
  const { scene, camera, dark } = ctx;

  scene.add(new AmbientLight('#ffffff', dark ? 0.35 : 0.6));
  const sun = new DirectionalLight('#ffffff', 2.4);
  sun.position.set(-4, 3, 4);
  scene.add(sun);
  const glow = new PointLight(BRAND.fuchsia, 40, 12);
  glow.position.set(3, -2, 2);
  scene.add(glow);

  const root = new Group();
  scene.add(root);

  const halo = glowSprite(BRAND.violet, 6, dark ? 0.5 : 0.3);
  halo.position.z = -1;
  root.add(halo);

  const planet = new Mesh(
    new IcosahedronGeometry(1.15, 2),
    new MeshStandardMaterial({ color: BRAND.indigo, roughness: 0.6, flatShading: true, emissive: '#312e81', emissiveIntensity: 0.4 }),
  );
  root.add(planet);
  const grid = new LineSegments(
    new EdgesGeometry(new IcosahedronGeometry(1.32, 1)),
    new LineBasicMaterial({ color: '#c7d2fe', transparent: true, opacity: 0.22 }),
  );
  planet.add(grid);

  const ringPivot = new Group();
  ringPivot.rotation.set(1.2, 0.3, 0.2);
  root.add(ringPivot);
  const ring = pointCloud(
    600,
    () => {
      const a = Math.random() * Math.PI * 2;
      const r = 1.75 + Math.random() * 0.75;
      return [Math.cos(a) * r, Math.sin(a) * r, (Math.random() - 0.5) * 0.08];
    },
    [BRAND.violet, BRAND.fuchsia, '#a5b4fc', BRAND.sky],
    0.05,
    0.9,
    dark,
  );
  ringPivot.add(ring);

  const moonPivot = new Group();
  moonPivot.rotation.set(0.4, 0, -0.3);
  root.add(moonPivot);
  const moon = new Mesh(
    new IcosahedronGeometry(0.2, 1),
    new MeshStandardMaterial({ color: '#e0e7ff', roughness: 0.8, flatShading: true }),
  );
  moon.position.set(2.9, 0, 0);
  moonPivot.add(moon);

  // The lost card.
  const card = new Group();
  const body = new Mesh(
    new RoundedBoxGeometry(1.4, 0.7, 0.06, 3, 0.04),
    new MeshStandardMaterial({ color: dark ? '#1e293b' : '#ffffff', roughness: 0.5 }),
  );
  const face = new Mesh(
    new PlaneGeometry(1.4, 0.7),
    new MeshBasicMaterial({
      transparent: true,
      map: cardFaceTexture(
        { title: 'This page', priority: 'Lost', color: '#ef4444', initials: '?', avatar: [BRAND.indigo, BRAND.fuchsia] },
        dark,
        ctx.font,
      ),
    }),
  );
  face.position.z = 0.031;
  card.add(body, face);
  card.scale.setScalar(0.85);
  root.add(card);

  const stars = pointCloud(
    200,
    () => shellPoint(4, 9),
    dark ? ['#ffffff', '#c7d2fe', '#f5d0fe'] : [BRAND.indigo, BRAND.violet, BRAND.fuchsia],
    0.06,
    dark ? 0.9 : 0.5,
    dark,
  );
  scene.add(stars);

  return {
    fit(aspect) {
      const d = aspect < 1.2 ? clamp(10 / aspect, 10, 18) : 10;
      camera.position.set(0, 0.3, d);
      camera.lookAt(0, 0, 0);
    },
    update(t, pointer) {
      root.rotation.y = pointer.x * 0.25;
      root.rotation.x = pointer.y * 0.15;
      planet.rotation.y = t * 0.15;
      planet.rotation.x = 0.3;
      ring.rotation.z = t * 0.05;
      moonPivot.rotation.y = t * 0.4;
      card.position.set(2.4 + Math.sin(t * 0.3) * 0.3, 1.2 + Math.sin(t * 0.5) * 0.25, 0.8);
      card.rotation.set(Math.sin(t * 0.4) * 0.4, -0.5 + Math.sin(t * 0.25) * 0.5, -0.25 + t * 0.12);
      stars.rotation.y = t * 0.015;
    },
  };
}
