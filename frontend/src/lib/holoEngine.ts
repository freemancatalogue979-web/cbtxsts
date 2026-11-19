/**
 * 3D hologram models for Map Lab objective chips (minion, turret, lord, turtle, litho, buffs,
 * retribution), built from simple shapes with three.js and drawn as glowing, scan-lined holograms.
 *
 * One hidden WebGL renderer draws each model type once per frame and copies the picture into every
 * chip's own small 2D canvas, so fifty chips still cost one WebGL context. Loaded on demand
 * (dynamic import) only when hologram chips are on screen.
 */
import * as THREE from "three";
import type { MapChipPreset } from "./types";

const SIZE = 192;

const VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vY;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vY = world.y;
    vec4 mv = viewMatrix * world;
    vView = normalize(-mv.xyz);
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vY;
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 1.6);
    float scan = 0.72 + 0.28 * sin(vY * 70.0 - uTime * 5.0);
    float band = smoothstep(0.0, 0.08, fract(vY * 1.6 - uTime * 0.45)) * 0.35 + 0.65;
    float flicker = 0.93 + 0.07 * sin(uTime * 37.0) * sin(uTime * 11.0);
    float a = (0.16 + rim * 0.95) * scan * band * flicker * uOpacity;
    gl_FragColor = vec4(uColor * (0.55 + rim * 0.9), a);
  }
`;

type Part = { mesh: THREE.Object3D; spin?: number; bob?: number };
interface Model { root: THREE.Group; parts: Part[]; mats: THREE.ShaderMaterial[] }

function holoMat(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color("#7df9ff") }, uTime: { value: 0 }, uOpacity: { value: 1 } },
  });
}

/** Mesh plus crisp edge lines, both in hologram light. */
function holo(geometry: THREE.BufferGeometry, mats: THREE.ShaderMaterial[], edges = true): THREE.Group {
  const g = new THREE.Group();
  const mat = holoMat();
  mats.push(mat);
  g.add(new THREE.Mesh(geometry, mat));
  if (edges) {
    const lineMat = new THREE.LineBasicMaterial({ color: "#7df9ff", transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), lineMat));
  }
  return g;
}

function at<T extends THREE.Object3D>(obj: T, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s: number | [number, number, number] = 1): T {
  obj.position.set(x, y, z);
  obj.rotation.set(rx, ry, rz);
  if (Array.isArray(s)) obj.scale.set(...s); else obj.scale.setScalar(s);
  return obj;
}

const BUILD: Record<MapChipPreset, (mats: THREE.ShaderMaterial[]) => Part[]> = {
  minion: (m) => {
    const body = new THREE.Group();
    body.add(at(holo(new THREE.CapsuleGeometry(0.28, 0.42, 6, 14), m), 0, 0.72, 0));
    body.add(at(holo(new THREE.ConeGeometry(0.3, 0.38, 14), m), 0, 1.33, 0));          // helmet
    body.add(at(holo(new THREE.BoxGeometry(0.06, 0.5, 0.38), m), 0.36, 0.78, 0.05));     // shield
    body.add(at(holo(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 6), m), -0.36, 0.95, 0, 0, 0, 0.12)); // spear
    body.add(at(holo(new THREE.ConeGeometry(0.06, 0.18, 6), m), -0.44, 1.65, 0, 0, 0, 0.12));
    return [{ mesh: body, spin: 0.7, bob: 0.05 }];
  },
  turret: (m) => {
    const tower = new THREE.Group();
    tower.add(at(holo(new THREE.CylinderGeometry(0.55, 0.62, 0.22, 8), m), 0, 0.11, 0));
    tower.add(at(holo(new THREE.CylinderGeometry(0.24, 0.42, 1.25, 8), m), 0, 0.84, 0));
    tower.add(at(holo(new THREE.TorusGeometry(0.34, 0.05, 6, 16), m), 0, 1.5, 0, Math.PI / 2));
    tower.add(at(holo(new THREE.CylinderGeometry(0.3, 0.2, 0.2, 8), m), 0, 1.58, 0));
    const crystal = at(holo(new THREE.OctahedronGeometry(0.26), m), 0, 2.02, 0, 0, 0, 0, [1, 1.5, 1]);
    return [{ mesh: tower, spin: 0.35 }, { mesh: crystal, spin: 2.2, bob: 0.08 }];
  },
  lord: (m) => {
    const lord = new THREE.Group();
    lord.add(at(holo(new THREE.SphereGeometry(0.55, 14, 10), m), 0, 0.95, 0, 0, 0, 0, [1, 1.1, 0.85]));
    lord.add(at(holo(new THREE.SphereGeometry(0.3, 12, 9), m), 0, 1.72, 0.18));
    lord.add(at(holo(new THREE.ConeGeometry(0.08, 0.42, 6), m), 0.18, 2.02, 0.1, -0.35, 0, -0.5));
    lord.add(at(holo(new THREE.ConeGeometry(0.08, 0.42, 6), m), -0.18, 2.02, 0.1, -0.35, 0, 0.5));
    const wing = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.2, 0.55), new THREE.Vector2(1.05, -0.05), new THREE.Vector2(0.75, -0.25), new THREE.Vector2(0.45, -0.15)]);
    lord.add(at(holo(new THREE.ShapeGeometry(wing), m), 0.38, 1.25, -0.2, 0, -0.35, 0.12));
    lord.add(at(holo(new THREE.ShapeGeometry(wing), m), -0.38, 1.25, -0.2, 0, Math.PI + 0.35, 0.12));
    lord.add(at(holo(new THREE.CylinderGeometry(0.1, 0.13, 0.55, 8), m), 0.24, 0.3, 0));
    lord.add(at(holo(new THREE.CylinderGeometry(0.1, 0.13, 0.55, 8), m), -0.24, 0.3, 0));
    lord.add(at(holo(new THREE.ConeGeometry(0.12, 0.8, 6), m), 0, 0.65, -0.55, -1.1));
    return [{ mesh: lord, spin: 0.45, bob: 0.06 }];
  },
  turtle: (m) => {
    const turtle = new THREE.Group();
    turtle.add(at(holo(new THREE.SphereGeometry(0.72, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m), 0, 0.32, 0, 0, 0, 0, [1, 0.72, 1.12]));
    turtle.add(at(holo(new THREE.CylinderGeometry(0.74, 0.74, 0.12, 12), m), 0, 0.3, 0, 0, 0, 0, [1, 1, 1.12]));
    turtle.add(at(holo(new THREE.SphereGeometry(0.22, 10, 8), m), 0, 0.48, 0.92));
    for (const [x, z] of [[0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]) {
      turtle.add(at(holo(new THREE.CylinderGeometry(0.1, 0.12, 0.32, 8), m), x, 0.16, z));
    }
    turtle.add(at(holo(new THREE.ConeGeometry(0.08, 0.3, 6), m), 0, 0.3, -0.92, -Math.PI / 2));
    return [{ mesh: turtle, spin: 0.5, bob: 0.03 }];
  },
  litho: (m) => {
    const golem = new THREE.Group();
    golem.add(at(holo(new THREE.DodecahedronGeometry(0.42), m), 0, 0.85, 0));
    golem.add(at(holo(new THREE.IcosahedronGeometry(0.24), m), 0, 1.5, 0.05));
    golem.add(at(holo(new THREE.OctahedronGeometry(0.2), m), 0.58, 1.0, 0, 0, 0, 0, [1, 1.6, 1]));
    golem.add(at(holo(new THREE.OctahedronGeometry(0.2), m), -0.58, 1.0, 0, 0, 0, 0, [1, 1.6, 1]));
    golem.add(at(holo(new THREE.TetrahedronGeometry(0.22), m), 0.2, 0.28, 0));
    golem.add(at(holo(new THREE.TetrahedronGeometry(0.22), m), -0.2, 0.28, 0));
    const shard = at(holo(new THREE.OctahedronGeometry(0.11), m), 0, 1.95, 0, 0, 0, 0, [1, 2, 1]);
    return [{ mesh: golem, spin: 0.55, bob: 0.05 }, { mesh: shard, spin: 3, bob: 0.1 }];
  },
  retribution: (m) => {
    const ringA = at(holo(new THREE.TorusGeometry(0.55, 0.035, 6, 40), m), 0, 1.1, 0, Math.PI / 2.4);
    const ringB = at(holo(new THREE.TorusGeometry(0.4, 0.03, 6, 32), m), 0, 1.1, 0, -Math.PI / 3, 0.6);
    const core = new THREE.Group();
    core.add(at(holo(new THREE.ConeGeometry(0.14, 1.0, 4), m), 0, 1.25, 0, Math.PI));
    core.add(at(holo(new THREE.BoxGeometry(0.5, 0.06, 0.06), m), 0, 1.62, 0));
    core.add(at(holo(new THREE.OctahedronGeometry(0.1), m), 0, 1.78, 0));
    return [{ mesh: ringA, spin: 1.6 }, { mesh: ringB, spin: -2.1 }, { mesh: core, spin: 0.9, bob: 0.06 }];
  },
  "blue-buff": (m) => {
    const orb = at(holo(new THREE.IcosahedronGeometry(0.42, 1), m), 0, 1.15, 0);
    const ring = at(holo(new THREE.TorusGeometry(0.66, 0.03, 6, 40), m), 0, 1.15, 0, Math.PI / 2.2);
    const shards = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      shards.add(at(holo(new THREE.OctahedronGeometry(0.09), m), Math.cos(a) * 0.85, 1.15 + (i % 2 ? 0.18 : -0.18), Math.sin(a) * 0.85, 0, 0, 0, [1, 1.8, 1]));
    }
    return [{ mesh: orb, spin: 0.6, bob: 0.08 }, { mesh: ring, spin: 1.2 }, { mesh: shards, spin: -0.9 }];
  },
  "red-buff": (m) => {
    const core = new THREE.Group();
    core.add(at(holo(new THREE.IcosahedronGeometry(0.36, 0), m), 0, 1.15, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      core.add(at(holo(new THREE.ConeGeometry(0.08, 0.42, 5), m), Math.cos(a) * 0.48, 1.15, Math.sin(a) * 0.48, 0, -a, -Math.PI / 2));
    }
    const ring = at(holo(new THREE.TorusGeometry(0.72, 0.025, 6, 40), m), 0, 1.15, 0, Math.PI / 2);
    return [{ mesh: core, spin: 0.8, bob: 0.07 }, { mesh: ring, spin: -1.4 }];
  },
};

export const HOLO_KINDS = Object.keys(BUILD) as MapChipPreset[];

class Engine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private models = new Map<MapChipPreset, Model>();
  private targets = new Map<HTMLCanvasElement, { kind: MapChipPreset; color: string }>();
  private frame = 0;
  private t0 = performance.now();
  private still = false;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(SIZE, SIZE, false);
    this.renderer.setClearColor(0x000000, 0);
    this.camera.position.set(0, 1.85, 4.6);
    this.camera.lookAt(0, 0.95, 0);
  }

  private model(kind: MapChipPreset): Model {
    let model = this.models.get(kind);
    if (!model) {
      const mats: THREE.ShaderMaterial[] = [];
      const root = new THREE.Group();
      // The models stand free on the map: no base ring or light cone under them.
      const parts = BUILD[kind](mats);
      for (const p of parts) { p.mesh.userData.y0 = p.mesh.position.y; root.add(p.mesh); }
      model = { root, parts, mats };
      this.models.set(kind, model);
    }
    return model;
  }

  setStill(still: boolean) { this.still = still; this.kick(); }

  add(canvas: HTMLCanvasElement, kind: MapChipPreset, color: string) {
    this.targets.set(canvas, { kind, color });
    this.kick();
  }

  remove(canvas: HTMLCanvasElement) {
    this.targets.delete(canvas);
  }

  private kick() {
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  /** Draw one kind in one colour at time t into the shared canvas and return it. */
  render(kind: MapChipPreset, color: string, t: number): HTMLCanvasElement {
    const model = this.model(kind);
    const c = new THREE.Color(color);
    // Lift dark picks so the hologram always glows.
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, Math.min(1, hsl.s * 0.9 + 0.1), Math.max(0.62, hsl.l));
    for (const mat of model.mats) { mat.uniforms.uColor.value.copy(c); mat.uniforms.uTime.value = t; }
    model.root.traverse((o) => {
      const line = (o as THREE.LineSegments).isLineSegments ? (o as THREE.LineSegments).material as THREE.LineBasicMaterial : null;
      if (line) line.color.copy(c);
    });
    for (const p of model.parts) {
      if (p.spin) p.mesh.rotation.y = t * p.spin;
      if (p.bob) p.mesh.position.y = (p.mesh.userData.y0 as number) + Math.sin(t * 2.1) * p.bob;
    }
    this.scene.clear();
    this.scene.add(model.root);
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement;
  }

  private tick = () => {
    this.frame = 0;
    const t = this.still ? 0.8 : (performance.now() - this.t0) / 1000;
    const groups = new Map<string, HTMLCanvasElement[]>();
    for (const [canvas, v] of this.targets) {
      if (!canvas.isConnected) { this.targets.delete(canvas); continue; }
      const key = `${v.kind}|${v.color}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(canvas);
    }
    for (const [key, canvases] of groups) {
      const [kind, color] = key.split("|") as [MapChipPreset, string];
      const src = this.render(kind, color, t);
      for (const canvas of canvases) {
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
      }
    }
    if (this.targets.size && !this.still) this.kick();
  };
}

let engine: Engine | null | undefined;

/** The shared engine, or null when this device has no WebGL (chips then keep their portraits). */
export function holoEngine(): Engine | null {
  if (engine !== undefined) return engine;
  try {
    const probe = document.createElement("canvas");
    engine = probe.getContext("webgl2") || probe.getContext("webgl") ? new Engine() : null;
  } catch {
    engine = null;
  }
  return engine;
}

export function hasHoloModel(kind: string | undefined): kind is MapChipPreset {
  return !!kind && kind in BUILD;
}
