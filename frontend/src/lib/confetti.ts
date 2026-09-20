/**
 * Dependency-free canvas confetti, tuned for the arena palette.
 * A single overlay canvas is created on demand and removed when the last
 * particle dies, so it costs nothing when idle.
 */

const BRAND_COLORS = ['#f43f5e', '#a855f7', '#3b82f6', '#fbbf24', '#34d399', '#ffffff'];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  spin: number;
  shape: 'rect' | 'circle' | 'coin';
  gravity: number;
  drag: number;
  life: number;
  maxLife: number;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let frame = 0;
let dpr = 1;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function ensureCanvas(): boolean {
  if (typeof document === 'undefined') return false;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }
  return Boolean(ctx);
}

function resize(): void {
  if (!canvas) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
}

function loop(): void {
  const context = ctx;
  if (!context || !canvas) return;
  context.clearRect(0, 0, canvas.width, canvas.height);

  particles = particles.filter((particle) => {
    particle.life += 1;
    particle.vy += particle.gravity;
    particle.vx *= particle.drag;
    particle.vy *= particle.drag;
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.rotation += particle.spin;

    const fade = Math.max(0, 1 - particle.life / particle.maxLife);
    context.save();
    context.globalAlpha = fade;
    context.translate(particle.x * dpr, particle.y * dpr);
    context.rotate(particle.rotation);
    context.fillStyle = particle.color;

    const size = particle.size * dpr;
    if (particle.shape === 'circle') {
      context.beginPath();
      context.arc(0, 0, size / 2, 0, Math.PI * 2);
      context.fill();
    } else if (particle.shape === 'coin') {
      context.beginPath();
      context.ellipse(0, 0, size / 2, size / 2.6, 0, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = fade * 0.55;
      context.strokeStyle = '#05060f';
      context.lineWidth = 1.2 * dpr;
      context.stroke();
    } else {
      context.fillRect(-size / 2, -size / 3, size, size / 1.6);
    }
    context.restore();

    return particle.life < particle.maxLife && particle.y < window.innerHeight + 120;
  });

  if (particles.length) {
    frame = requestAnimationFrame(loop);
  } else {
    frame = 0;
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    canvas = null;
    ctx = null;
  }
}

export interface BurstOptions {
  count?: number;
  x?: number;
  y?: number;
  spread?: number;
  power?: number;
  colors?: string[];
  shape?: Particle['shape'] | 'mixed';
  duration?: number;
}

export function burst(options: BurstOptions = {}): void {
  if (prefersReducedMotion()) return;
  if (!ensureCanvas()) return;

  const {
    count = 90,
    x = window.innerWidth / 2,
    y = window.innerHeight * 0.35,
    spread = Math.PI * 2,
    power = 9,
    colors = BRAND_COLORS,
    shape = 'mixed',
    duration = 150,
  } = options;

  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * spread - spread / 2 - Math.PI / 2;
    const speed = power * (0.35 + Math.random() * 0.9);
    const picked = shape === 'mixed' ? (['rect', 'circle', 'coin'] as const)[Math.floor(Math.random() * 3)] : shape;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 9,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.34,
      shape: picked,
      gravity: 0.2 + Math.random() * 0.14,
      drag: 0.988,
      life: 0,
      maxLife: duration + Math.random() * 60,
    });
  }

  if (!frame) frame = requestAnimationFrame(loop);
}

/** Twin side cannons — used for exam passes and duel victories. */
export function celebrate(options: {big?: boolean} = {}): void {
  if (prefersReducedMotion()) return;
  const {big = false} = options;
  const height = window.innerHeight;
  burst({x: 20, y: height * 0.72, spread: Math.PI * 0.75, power: 13, count: big ? 70 : 42});
  burst({x: window.innerWidth - 20, y: height * 0.72, spread: Math.PI * 0.75, power: 13, count: big ? 70 : 42});
  if (big) {
    burst({x: window.innerWidth / 2, y: height * 0.22, spread: Math.PI * 2, power: 11, count: 130});
  }
}

/** Gold coin shower for prize claims and coin rewards. */
export function coinRain(count = 60): void {
  if (prefersReducedMotion()) return;
  if (!ensureCanvas()) return;
  for (let i = 0; i < count; i += 1) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: -30 - Math.random() * 220,
      vx: (Math.random() - 0.5) * 1.6,
      vy: 2 + Math.random() * 3.4,
      size: 9 + Math.random() * 9,
      color: ['#fbbf24', '#fde68a', '#f59e0b'][Math.floor(Math.random() * 3)],
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.2,
      shape: 'coin',
      gravity: 0.14,
      drag: 0.996,
      life: 0,
      maxLife: 260,
    });
  }
  if (!frame) frame = requestAnimationFrame(loop);
}

/** Short celebratory puff anchored to an element (badge unlock, level up). */
export function burstFromElement(element: HTMLElement | null, options: BurstOptions = {}): void {
  if (!element) {
    burst(options);
    return;
  }
  const rect = element.getBoundingClientRect();
  burst({...options, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2});
}
