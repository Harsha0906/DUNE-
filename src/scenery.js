import * as THREE from 'three';
import { heightAt, normalAt, rockMask, isRock, PLAY_LIMIT } from './terrain.js';

const dummy = new THREE.Object3D();
const UP = new THREE.Vector3(0, 1, 0);
const tmpN = new THREE.Vector3();

/** Scattered dry shrubs, rim boulders' rubble and mesa pebbles, all instanced. */
export function createScatter(scene, rand) {
  // shrubs: squat flat-shaded blobs with a few dead twigs
  const shrubGeo = new THREE.IcosahedronGeometry(0.7, 0);
  shrubGeo.scale(1, 0.55, 1);
  const shrubMat = new THREE.MeshStandardMaterial({ color: '#8a8450', flatShading: true, roughness: 1 });
  const twigGeo = new THREE.ConeGeometry(0.06, 1.3, 4);
  twigGeo.translate(0, 0.65, 0);
  const twigMat = new THREE.MeshStandardMaterial({ color: '#6b5038', flatShading: true, roughness: 1 });
  const N = 900;
  const shrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, N);
  const twigs = new THREE.InstancedMesh(twigGeo, twigMat, N * 2);
  const col = new THREE.Color();
  let n = 0, t = 0;
  for (let i = 0; i < 30000 && n < N; i++) {
    const x = (rand() * 2 - 1) * PLAY_LIMIT, z = (rand() * 2 - 1) * PLAY_LIMIT;
    const m = rockMask(x, z);
    // shrubs cluster in the lee of mesas where a little moisture collects
    const want = m > 0.02 && m < 0.5 ? 0.6 : m < 0.02 ? 0.012 : 0;
    if (rand() > want) continue;
    const y = heightAt(x, z);
    const s = 0.5 + rand() * 1.1;
    dummy.position.set(x, y + 0.1 * s, z);
    dummy.rotation.set(0, rand() * 6.28, 0);
    dummy.scale.set(s, s * (0.7 + rand() * 0.6), s);
    dummy.updateMatrix();
    shrubs.setMatrixAt(n, dummy.matrix);
    col.setHSL(0.13 + rand() * 0.05, 0.25 + rand() * 0.2, 0.32 + rand() * 0.12);
    shrubs.setColorAt(n, col);
    for (let k = 0; k < 2; k++) {
      dummy.position.set(x + (rand() - 0.5) * s, y, z + (rand() - 0.5) * s);
      dummy.rotation.set((rand() - 0.5) * 1.2, rand() * 6.28, (rand() - 0.5) * 1.2);
      dummy.scale.setScalar(s * (0.6 + rand() * 0.6));
      dummy.updateMatrix();
      twigs.setMatrixAt(t++, dummy.matrix);
    }
    n++;
  }
  shrubs.count = n; twigs.count = t;
  shrubs.castShadow = true; shrubs.receiveShadow = true;
  scene.add(shrubs, twigs);

  // pebbles and rubble on the rock
  const pebGeo = new THREE.DodecahedronGeometry(0.35, 0);
  const pebMat = new THREE.MeshStandardMaterial({ color: '#7e4a33', flatShading: true, roughness: 0.95 });
  const P = 1400;
  const pebbles = new THREE.InstancedMesh(pebGeo, pebMat, P);
  let p = 0;
  for (let i = 0; i < 40000 && p < P; i++) {
    const x = (rand() * 2 - 1) * PLAY_LIMIT, z = (rand() * 2 - 1) * PLAY_LIMIT;
    const m = rockMask(x, z);
    if (m < 0.3) continue;
    const y = heightAt(x, z);
    const s = 0.4 + Math.pow(rand(), 3) * 3;
    dummy.position.set(x, y + 0.05, z);
    dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    dummy.scale.set(s, s * 0.6, s * (0.7 + rand() * 0.6));
    dummy.updateMatrix();
    pebbles.setMatrixAt(p, dummy.matrix);
    col.setHSL(0.04 + rand() * 0.03, 0.4, 0.22 + rand() * 0.15);
    pebbles.setColorAt(p, col);
    p++;
  }
  pebbles.count = p;
  pebbles.receiveShadow = true; pebbles.castShadow = true;
  scene.add(pebbles);
}

/** Footprints and skimmer furrows pressed into the sand; they fade as wind refills them. */
export class Tracks {
  constructor(scene, max = 600) {
    this.max = max;
    this.cursor = 0;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.birth = new Float32Array(max).fill(-1e4);
    this.life = new Float32Array(max).fill(1);
    geo.setAttribute('aBirth', new THREE.InstancedBufferAttribute(this.birth, 1));
    geo.setAttribute('aLife', new THREE.InstancedBufferAttribute(this.life, 1));
    this.uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color('#7a4a26') } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      vertexShader: /* glsl */`
        attribute float aBirth; attribute float aLife;
        uniform float uTime;
        varying float vA; varying vec2 vUv;
        void main() {
          vUv = uv;
          float age = (uTime - aBirth) / aLife;
          vA = clamp(1.0 - age, 0.0, 1.0);
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; varying float vA; varying vec2 vUv;
        void main() {
          vec2 c = vUv - 0.5;
          float d = length(c * vec2(1.0, 1.0));
          float a = smoothstep(0.5, 0.2, d) * vA * 0.42;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, dummy.matrix);
    scene.add(this.mesh);
  }

  add(x, z, yaw, w, l, life, time) {
    if (isRock(x, z)) return;
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    normalAt(x, z, tmpN);
    dummy.position.set(x, heightAt(x, z) + 0.04, z);
    dummy.quaternion.setFromUnitVectors(UP, tmpN);
    dummy.rotateY(yaw);
    dummy.scale.set(w, 1, l);
    dummy.updateMatrix();
    this.mesh.setMatrixAt(i, dummy.matrix);
    this.birth[i] = time; this.life[i] = life;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.aBirth.needsUpdate = true;
    this.mesh.geometry.attributes.aLife.needsUpdate = true;
  }

  update(time) { this.uniforms.uTime.value = time; }
}

/** Ambient life: sand blown off dune crests and roaming dust devils. */
export class Wind {
  constructor(particles, rand) {
    this.particles = particles;
    this.dir = new THREE.Vector2(1, 0.35).normalize();
    this.devils = Array.from({ length: 4 }, () => ({
      x: (rand() * 2 - 1) * 500, z: (rand() * 2 - 1) * 500, a: rand() * 6, life: 0,
    }));
  }

  update(dt, center, storm, t) {
    const P = this.particles;
    // spindrift: find crests near the player and stream sand off them
    const tries = 3 + Math.floor(storm * 6);
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 70;
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      if (isRock(x, z)) continue;
      const h = heightAt(x, z);
      const up = heightAt(x - this.dir.x * 3, z - this.dir.y * 3);
      const dn = heightAt(x + this.dir.x * 3, z + this.dir.y * 3);
      if (h - up > -0.1 && h - dn > 0.6) {
        const v = 4 + storm * 10 + Math.random() * 3;
        P.emit(x, h + 0.2, z, this.dir.x * v, 0.6 + Math.random(), this.dir.y * v,
          { life: 1.4 + Math.random(), size: 0.9 + storm, gravity: -0.6, drag: 0.4, alpha: 0.35, color: '#f1cf9c' });
      }
    }
    // dust devils wander and whirl
    for (const d of this.devils) {
      d.a += (Math.random() - 0.5) * dt;
      d.x += Math.cos(d.a) * 4 * dt + this.dir.x * 2 * dt;
      d.z += Math.sin(d.a) * 4 * dt + this.dir.y * 2 * dt;
      const dist = Math.hypot(d.x - center.x, d.z - center.z);
      if (dist > 320 || isRock(d.x, d.z)) {
        const a = Math.random() * Math.PI * 2, r = 120 + Math.random() * 150;
        d.x = center.x + Math.cos(a) * r; d.z = center.z + Math.sin(a) * r;
        continue;
      }
      if (dist > 220) continue;
      const g = heightAt(d.x, d.z);
      for (let k = 0; k < 2; k++) {
        const hgt = Math.random() * 14, ang = t * 6 + Math.random() * 6.28, rad = 0.6 + hgt * 0.25;
        P.emit(d.x + Math.cos(ang) * rad, g + hgt, d.z + Math.sin(ang) * rad,
          -Math.sin(ang) * 6, 2.5, Math.cos(ang) * 6,
          { life: 1.2, size: 1.2 + hgt * 0.12, gravity: 0, drag: 1.5, alpha: 0.28, color: '#e4b47d' });
      }
    }
  }
}
