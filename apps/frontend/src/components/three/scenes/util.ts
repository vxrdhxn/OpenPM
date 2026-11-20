import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  NormalBlending,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
} from 'three';

export const BRAND = { indigo: '#6366f1', violet: '#8b5cf6', fuchsia: '#d946ef', sky: '#0ea5e9', emerald: '#10b981' };

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

/** Draw into a fresh canvas and wrap it as an sRGB texture. */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface CardFace {
  title: string;
  priority: string;
  color: string;
  initials: string;
  avatar: [string, string];
}

/** The top face of a task card, drawn like the real board's cards: title, priority chip, avatar. */
export function cardFaceTexture(card: CardFace, dark: boolean, font: string) {
  return canvasTexture(512, 256, (ctx) => {
    roundRect(ctx, 4, 4, 504, 248, 36);
    ctx.fillStyle = dark ? '#1e293b' : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = dark ? '#334155' : '#e2e8f0';
    ctx.stroke();

    ctx.fillStyle = card.color;
    roundRect(ctx, 36, 34, 64, 12, 6);
    ctx.fill();

    ctx.fillStyle = dark ? '#f1f5f9' : '#0f172a';
    ctx.font = `700 40px ${font}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(card.title, 36, 104, 440);

    ctx.fillStyle = dark ? '#334155' : '#e2e8f0';
    roundRect(ctx, 36, 128, 300, 14, 7);
    ctx.fill();

    // Priority chip.
    ctx.font = `700 24px ${font}`;
    const label = card.priority.toUpperCase();
    const tw = ctx.measureText(label).width;
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = card.color;
    roundRect(ctx, 36, 172, tw + 32, 44, 12);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = card.color;
    ctx.fillText(label, 52, 203);

    // Avatar.
    const g = ctx.createLinearGradient(420, 160, 476, 216);
    g.addColorStop(0, card.avatar[0]);
    g.addColorStop(1, card.avatar[1]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(448, 194, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 22px ${font}`;
    ctx.textAlign = 'center';
    ctx.fillText(card.initials, 448, 202);
    ctx.textAlign = 'left';
  });
}

/** A soft round glow, for halos and contact shadows. */
export function glowTexture(color: string, falloff = 0.6) {
  return canvasTexture(256, 256, (ctx) => {
    const c = new Color(color);
    const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, `rgba(${rgb},1)`);
    g.addColorStop(falloff, `rgba(${rgb},0.25)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  });
}

export function glowSprite(color: string, size: number, opacity: number, additive = true) {
  const sprite = new Sprite(
    new SpriteMaterial({
      map: glowTexture(color),
      transparent: true,
      opacity,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    }),
  );
  sprite.scale.set(size, size, 1);
  return sprite;
}

/** A round avatar with initials, always facing the camera. */
export function avatarSprite(initials: string, from: string, to: string, font: string, size = 0.55) {
  const map = canvasTexture(128, 128, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 128, 128);
    g.addColorStop(0, from);
    g.addColorStop(1, to);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 44px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, 64, 67);
  });
  const sprite = new Sprite(new SpriteMaterial({ map, transparent: true, depthWrite: false }));
  sprite.scale.set(size, size, 1);
  return sprite;
}

/** Round, soft-edged points: a texture keeps them from rendering as squares. */
const dotTexture = () =>
  canvasTexture(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });

/** A cloud of colored points, from `place(i)` positions. */
export function pointCloud(
  count: number,
  place: (i: number) => [number, number, number],
  colors: string[],
  size: number,
  opacity: number,
  additive: boolean,
) {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new Color();
  for (let i = 0; i < count; i++) {
    pos.push(...place(i));
    c.set(colors[i % colors.length]);
    col.push(c.r, c.g, c.b);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  return new Points(
    geo,
    new PointsMaterial({
      size,
      map: dotTexture(),
      vertexColors: true,
      transparent: true,
      opacity,
      depthWrite: false,
      sizeAttenuation: true,
      blending: additive ? AdditiveBlending : NormalBlending,
    }),
  );
}

/** A random point in a spherical shell, for star fields. */
export function shellPoint(rMin: number, rMax: number): [number, number, number] {
  const u = Math.random() * 2 - 1;
  const th = Math.random() * Math.PI * 2;
  const r = rMin + Math.random() * (rMax - rMin);
  const s = Math.sqrt(1 - u * u);
  return [r * s * Math.cos(th), r * u, r * s * Math.sin(th)];
}
