import {
  AmbientLight,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { SceneContext, SceneHandle } from '../engine';
import { canvasTexture, clamp, glowTexture, roundRect } from './util';

const SHEETS = 9;
const W = 2.7;
const D = 1.75;

/** A sheet's top face: plain paper with its number; the top sheet also carries the red mark. */
function sheetFace(i: number, top: boolean, dark: boolean, font: string) {
  const ink = dark ? '#ebebe8' : '#121214';
  return canvasTexture(540, 350, (c) => {
    roundRect(c, 2, 2, 536, 346, 30);
    c.fillStyle = dark ? '#1c1c20' : '#fbfbf9';
    c.fill();
    c.globalAlpha = 0.85;
    c.fillStyle = ink;
    c.font = `500 22px ${font}`;
    c.fillText(String(i + 1).padStart(2, '0'), 34, 52);
    if (top) {
      c.fillStyle = '#ff4040';
      c.beginPath();
      c.arc(490, 52, 13, 0, Math.PI * 2);
      c.fill();
    }
  });
}

/**
 * The home page's centrepiece: a stack of paper task sheets fanned into a slow spiral, a glossy red
 * sphere resting above it, and a thin ink ring with a red dot in orbit. Paper, ink, one red.
 */
export function sculptureScene(ctx: SceneContext): SceneHandle {
  const { scene, camera, dark, font } = ctx;

  scene.add(new AmbientLight('#ffffff', dark ? 0.55 : 0.85));
  const key = new DirectionalLight('#fff7ef', dark ? 1.8 : 2.2);
  key.position.set(-4, 7, 5);
  scene.add(key);
  const fill = new DirectionalLight('#ffffff', 0.6);
  fill.position.set(5, 2, -3);
  scene.add(fill);
  const warm = new PointLight('#ff4040', dark ? 14 : 8, 8);
  warm.position.set(1.5, 2.2, 1.5);
  scene.add(warm);

  const root = new Group();
  root.rotation.x = 0.08;
  scene.add(root);

  const shadow = new Mesh(
    new PlaneGeometry(7, 7),
    new MeshBasicMaterial({ map: glowTexture('#000000', 0.35), transparent: true, opacity: dark ? 0.55 : 0.18, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.25;
  root.add(shadow);

  const stack = new Group();
  stack.position.y = -1.05;
  root.add(stack);
  const sheets = Array.from({ length: SHEETS }, (_, i) => {
    const sheet = new Group();
    const body = new Mesh(
      new RoundedBoxGeometry(W, 0.035, D, 3, 0.015),
      new MeshPhysicalMaterial({ color: dark ? '#26262b' : '#f4f4f2', roughness: 0.65, clearcoat: 0.25 }),
    );
    const face = new Mesh(
      new PlaneGeometry(W, D),
      new MeshBasicMaterial({ map: sheetFace(SHEETS - 1 - i, i === SHEETS - 1, dark, font), transparent: true }),
    );
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.019;
    sheet.add(body, face);
    sheet.position.y = i * 0.13;
    stack.add(sheet);
    return sheet;
  });

  const sphere = new Mesh(
    new SphereGeometry(0.62, 64, 64),
    new MeshPhysicalMaterial({ color: '#ff4040', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.4, sheenColor: '#ffb3b3' }),
  );
  root.add(sphere);
  const sphereShadow = new Mesh(
    new PlaneGeometry(2, 2),
    new MeshBasicMaterial({ map: glowTexture(dark ? '#000000' : '#5a0d0d', 0.3), transparent: true, opacity: 0.35, depthWrite: false }),
  );
  sphereShadow.rotation.x = -Math.PI / 2;
  root.add(sphereShadow);

  const orbit = new Group();
  orbit.rotation.set(1.18, 0.2, -0.32);
  root.add(orbit);
  const ink = dark ? '#ebebe8' : '#121214';
  orbit.add(new Mesh(new TorusGeometry(2.55, 0.012, 8, 220), new MeshBasicMaterial({ color: ink, transparent: true, opacity: dark ? 0.55 : 0.75 })));
  const satellite = new Mesh(new SphereGeometry(0.09, 24, 24), new MeshBasicMaterial({ color: '#ff4040' }));
  orbit.add(satellite);
  const outer = new Mesh(new TorusGeometry(3.1, 0.006, 6, 220), new MeshBasicMaterial({ color: ink, transparent: true, opacity: 0.25 }));
  outer.rotation.set(1.45, -0.35, 0.2);
  root.add(outer);

  return {
    fit(aspect) {
      const d = aspect < 1.25 ? clamp(10.5 * (1.25 / aspect), 10.5, 17) : 10.5;
      camera.position.set(0, 2.4, d);
      camera.lookAt(0, -0.2, 0);
    },
    update(t, pointer) {
      root.rotation.y = -0.4 + pointer.x * 0.35 + t * 0.06;
      root.rotation.x = 0.08 + pointer.y * 0.08;
      // The fan breathes: each sheet turns a little further than the one below it.
      const fan = 0.16 + Math.sin(t * 0.5) * 0.06;
      sheets.forEach((s, i) => {
        s.rotation.y = i * fan;
        s.position.y = i * (0.13 + Math.sin(t * 0.5) * 0.015);
      });
      const top = stack.position.y + (SHEETS - 1) * 0.13 + 0.95;
      sphere.position.y = top + Math.sin(t * 1.1) * 0.12;
      sphere.rotation.y = t * 0.4;
      sphereShadow.position.y = stack.position.y + (SHEETS - 1) * (0.13 + Math.sin(t * 0.5) * 0.015) + 0.03;
      sphereShadow.scale.setScalar(1 - Math.sin(t * 1.1) * 0.12);
      const a = t * 0.55;
      satellite.position.set(Math.cos(a) * 2.55, Math.sin(a) * 2.55, 0);
      outer.rotation.z = -t * 0.04;
    },
  };
}
