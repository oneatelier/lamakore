// Cinematic guardian hero: procedural Three.js scene, zero binary
// assets. Renderer floor is WebGL2; when the WebGPU API is present the
// scene upgrades to the WebGPU renderer (same graph, same motion).
// Tiers: 'a' (WebGPU) / 'b' (WebGL2) / 'c' (static poster, hero-loader).
import * as THREE from 'three';

const VOID = 0x0b0d10;
const BRASS = 0xc8a24a;
const BRASS_HI = 0xd9b463;
const GRID = 0x22272f;

interface Runner {
  setSize(w: number, h: number): void;
  setPixelRatio(r: number): void;
  setAnimationLoop(fn: ((time: number) => void) | null): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}

function hasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

async function makeRenderer(canvas: HTMLCanvasElement): Promise<{ renderer: Runner; tier: 'a' | 'b' }> {
  if (hasWebGPU()) {
    try {
      const webgpu = await import('three/webgpu');
      const w = new webgpu.WebGPURenderer({ canvas, antialias: true });
      await w.init();
      return { renderer: (w as unknown) as Runner, tier: 'a' };
    } catch {
      /* fall through to WebGL2 */
    }
  }
  const g = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  return { renderer: g, tier: 'b' };
}

export async function start(wrap: HTMLElement): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Guardian: rotating brass geometry over a dark grid');
  const stale = wrap.querySelector('img.hero-poster');
  if (stale) stale.remove();
  wrap.prepend(canvas);

  const { renderer, tier } = await makeRenderer(canvas);
  document.documentElement.dataset.heroTier = tier;
  window.__heroTier = tier;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(VOID, 0.05);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 1.6, 7.6);

  const guardian = new THREE.Group();
  scene.add(guardian);

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.15, 1),
    new THREE.MeshBasicMaterial({ color: BRASS, wireframe: true, transparent: true, opacity: 0.9 }),
  );
  guardian.add(core);

  const heart = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x12151a, metalness: 0.85, roughness: 0.35 }),
  );
  guardian.add(heart);

  const ringMat = new THREE.MeshBasicMaterial({ color: BRASS, transparent: true, opacity: 0.5 });
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.018, 12, 160), ringMat);
  ringA.rotation.x = Math.PI / 2.4;
  guardian.add(ringA);
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.014, 12, 160), ringMat.clone());
  ringB.material.opacity = 0.32;
  ringB.rotation.x = Math.PI / 1.7;
  ringB.rotation.y = Math.PI / 5;
  guardian.add(ringB);

  const moteCount = 700;
  const motes = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i += 1) {
    const r = 2.6 + Math.random() * 4.4;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    motes[i * 3] = r * Math.sin(ph) * Math.cos(th);
    motes[i * 3 + 1] = r * Math.cos(ph) * 0.6;
    motes[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motes, 3));
  const moteCloud = new THREE.Points(
    moteGeo,
    new THREE.PointsMaterial({ color: BRASS_HI, size: 0.022, transparent: true, opacity: 0.7 }),
  );
  scene.add(moteCloud);

  const grid = new THREE.GridHelper(30, 30, BRASS, GRID);
  grid.position.y = -2.2;
  const gridMat = grid.material as THREE.Material;
  gridMat.transparent = true;
  gridMat.opacity = 0.16;
  scene.add(grid);

  scene.add(new THREE.AmbientLight(0x8a93a1, 1.1));
  const key = new THREE.DirectionalLight(BRASS_HI, 2.0);
  key.position.set(2.5, 3.5, 4);
  scene.add(key);

  const mouse = { x: 0, y: 0 };
  window.addEventListener('pointermove', (ev) => {
    mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
    mouse.y = (ev.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  function resize(): void {
    const w = wrap.clientWidth || 1;
    const h = wrap.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);

  const dts: number[] = [];
  let last = -1;
  const clock = new THREE.Clock();
  const camBase = new THREE.Vector3(0, 1.6, 7.6);

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (last < 0) last = performance.now();
    const now = performance.now();
    dts.push(now - last);
    last = now;
    if (dts.length > 120) dts.shift();
    if (dts.length === 120) {
      const sorted = [...dts].sort((a, b) => a - b);
      window.__heroFps = Math.round(1000 / sorted[60]);
    }
    const t = clock.elapsedTime;
    guardian.rotation.y = t * 0.12;
    ringA.rotation.z = t * 0.2;
    ringB.rotation.z = -t * 0.14;
    const pulse = 1 + Math.sin(t * 1.4) * 0.04;
    heart.scale.setScalar(pulse);
    moteCloud.rotation.y = t * 0.02;
    camera.position.x += (camBase.x + mouse.x * 0.5 - camera.position.x) * 0.04;
    camera.position.y += (camBase.y - mouse.y * 0.3 - camera.position.y) * 0.04;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  });
}
