import * as THREE from 'three';
import { createNoise2D, fbm, smoothstep, lerp, clamp } from './noise.js';

export const WORLD_SIZE = 1800;
export const HALF = WORLD_SIZE / 2;
export const PLAY_LIMIT = HALF - 60;
const SEG = 300;
const CELL = WORLD_SIZE / SEG;

const n1 = createNoise2D(11);
const n2 = createNoise2D(23);
const n3 = createNoise2D(37);
const n4 = createNoise2D(41);
const n5 = createNoise2D(59);
const n6 = createNoise2D(71);
const n7 = createNoise2D(83);

// Hand-placed landmarks that must be on rock.
export const START_POS = new THREE.Vector2(0, 0);
export const BEACON_POS = new THREE.Vector2(560, -500);

function mesaField(x, z) {
  let m = fbm(n6, x * 0.0032, z * 0.0032, 3) + 0.05;
  m += 0.75 * Math.exp(-((x - START_POS.x) ** 2 + (z - START_POS.y) ** 2) / (55 * 55));
  m += 0.75 * Math.exp(-((x - BEACON_POS.x) ** 2 + (z - BEACON_POS.y) ** 2) / (45 * 45));
  // keep the corridor around spawn open sand so the first minutes are about dunes
  const d = Math.hypot(x, z);
  m -= 0.35 * smoothstep(80, 60, d) * smoothstep(40, 62, d);
  return m;
}

/** 0 = open sand, 1 = solid rock. */
export function rockMask(x, z) {
  return smoothstep(0.34, 0.4, mesaField(x, z));
}

function sandHeight(x, z) {
  const swell = fbm(n1, x * 0.0025, z * 0.0025, 3) * 16;
  const theta = 0.6 + n2(x * 0.0012, z * 0.0012) * 0.55;
  const u = x * Math.cos(theta) + z * Math.sin(theta) + fbm(n3, x * 0.006, z * 0.006, 2) * 32;
  const lambda = 42;
  let t = u / lambda; t -= Math.floor(t);
  // gentle windward slope, sharp crest, steep lee face
  const p = t < 0.78 ? Math.pow(t / 0.78, 1.6) : Math.pow(1 - (t - 0.78) / 0.22, 2.2);
  const amp = 7.5 * (0.5 + 0.5 * (n4(x * 0.0035, z * 0.0035) * 0.5 + 0.5));
  const ripple = n5(x * 0.05, z * 0.05) * 0.35;
  return swell + p * amp + ripple;
}

/** Analytic height (used to build the mesh). */
export function analyticHeight(x, z) {
  const sand = sandHeight(x, z);
  const m = mesaField(x, z);
  const mask = smoothstep(0.34, 0.4, m);
  if (mask <= 0) return sand;
  // terraced mesa top with strata steps
  const raw = 20 + smoothstep(0.38, 0.6, m) * 10 + n7(x * 0.02, z * 0.02) * 1.6;
  const terr = Math.floor(raw / 3.5) * 3.5 + (raw % 3.5) * 0.25;
  return lerp(sand, Math.max(sand + 2, terr), mask);
}

// ---------- height grid (exactly matches rendered triangles) ----------
const GRID = SEG + 1;
const heights = new Float32Array(GRID * GRID);
const masks = new Float32Array(GRID * GRID);
for (let iz = 0; iz < GRID; iz++) {
  for (let ix = 0; ix < GRID; ix++) {
    const x = ix * CELL - HALF;
    const z = iz * CELL - HALF;
    heights[iz * GRID + ix] = analyticHeight(x, z);
    masks[iz * GRID + ix] = rockMask(x, z);
  }
}

function H(ix, iz) {
  ix = clamp(ix, 0, SEG); iz = clamp(iz, 0, SEG);
  return heights[iz * GRID + ix];
}

/** Height on the rendered surface. */
export function heightAt(x, z) {
  const gx = clamp((x + HALF) / CELL, 0, SEG - 0.0001);
  const gz = clamp((z + HALF) / CELL, 0, SEG - 0.0001);
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const fx = gx - ix, fz = gz - iz;
  const ha = H(ix, iz), hb = H(ix, iz + 1), hc = H(ix + 1, iz + 1), hd = H(ix + 1, iz);
  if (fx + fz <= 1) return ha + (hd - ha) * fx + (hb - ha) * fz;
  return hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
}

export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 1.0;
  const hl = heightAt(x - e, z), hr = heightAt(x + e, z);
  const hd = heightAt(x, z - e), hu = heightAt(x, z + e);
  return out.set(hl - hr, 2 * e, hd - hu).normalize();
}

export function isRock(x, z) {
  const gx = clamp(Math.round((x + HALF) / CELL), 0, SEG);
  const gz = clamp(Math.round((z + HALF) / CELL), 0, SEG);
  return masks[gz * GRID + gx] > 0.55;
}

export function createTerrainMesh() {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const sandLight = new THREE.Color('#f0c58a');
  const sandMid = new THREE.Color('#d9a066');
  const sandDark = new THREE.Color('#b27a48');
  const rockA = new THREE.Color('#8c4a32');
  const rockB = new THREE.Color('#5e3324');
  const rockTop = new THREE.Color('#a8673f');
  const c = new THREE.Color();
  const tmpN = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const ix = Math.round((x + HALF) / CELL), iz = Math.round((z + HALF) / CELL);
    const h = heights[iz * GRID + ix];
    pos.setY(i, h);
    const mask = masks[iz * GRID + ix];
    normalAt(x, z, tmpN);
    const slope = 1 - tmpN.y;
    // sand: lighter on crests/windward, darker on lee faces
    const shade = clamp(0.5 + (tmpN.x * 0.6 + tmpN.z * 0.8) * 0.9, 0, 1);
    c.copy(sandDark).lerp(sandMid, smoothstep(0.1, 0.5, shade)).lerp(sandLight, smoothstep(0.55, 0.95, shade));
    c.offsetHSL(0, 0, n5(x * 0.02, z * 0.02) * 0.025);
    if (mask > 0.02) {
      const strata = 0.5 + 0.5 * Math.sin(h * 1.7 + n7(x * 0.01, z * 0.01) * 2);
      const rc = new THREE.Color().copy(rockB).lerp(rockA, strata);
      if (slope < 0.12) rc.lerp(rockTop, 0.55 + 0.35 * n4(x * 0.03, z * 0.03));
      rc.offsetHSL(0, 0, n1(x * 0.08, z * 0.08) * 0.05 + n3(x * 0.012, z * 0.012) * 0.06);
      c.lerp(rc, smoothstep(0.1, 0.7, mask));
    }
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** Render a small top-down map image for the minimap. */
export function createMapCanvas(size = 256) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wx = (x / size) * WORLD_SIZE - HALF;
      const wz = (y / size) * WORLD_SIZE - HALF;
      const h = heightAt(wx, wz);
      const r = isRock(wx, wz);
      const hx = heightAt(wx + 3, wz) - h;
      const light = clamp(0.75 - hx * 0.12, 0.35, 1);
      const i = (y * size + x) * 4;
      if (r) { img.data[i] = 120 * light; img.data[i + 1] = 62 * light; img.data[i + 2] = 44 * light; }
      else { img.data[i] = 222 * light; img.data[i + 1] = 166 * light; img.data[i + 2] = 106 * light; }
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Find well-separated flat rock sites (for condensers etc). */
export function findRockSites(count, minSep, rand) {
  const sites = [];
  const cands = [];
  for (let z = -PLAY_LIMIT; z <= PLAY_LIMIT; z += 14) {
    for (let x = -PLAY_LIMIT; x <= PLAY_LIMIT; x += 14) {
      if (rockMask(x, z) > 0.98 && rockMask(x + 10, z) > 0.98 && rockMask(x - 10, z) > 0.98 &&
          rockMask(x, z + 10) > 0.98 && rockMask(x, z - 10) > 0.98) cands.push([x, z]);
    }
  }
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cands[i], cands[j]] = [cands[j], cands[i]];
  }
  const avoid = [[START_POS.x, START_POS.y], [BEACON_POS.x, BEACON_POS.y]];
  for (const [x, z] of cands) {
    if (sites.length >= count) break;
    if ([...avoid, ...sites].every(([ax, az]) => Math.hypot(ax - x, az - z) > minSep)) sites.push([x, z]);
  }
  return sites;
}
