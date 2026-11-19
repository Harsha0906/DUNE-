import * as THREE from 'three';

const vert = /* glsl */`
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
  varying float vAlpha; varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha; vColor = aColor;
  }`;
const frag = /* glsl */`
  varying float vAlpha; varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.1, d));
  }`;

/** Pooled CPU particles for sand sprays, dust puffs and sparkles. */
export class ParticlePool {
  constructor(scene, max = 3000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.c = new THREE.Color();
  }

  emit(x, y, z, vx, vy, vz, { life = 1.5, size = 1, color = '#e2b47c', gravity = -9, drag = 0.8, alpha = 0.8 } = {}) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = this.maxLife[i] = life;
    this.size[i] = size; this.grav[i] = gravity; this.drag[i] = drag;
    this.alpha[i] = alpha;
    this.c.set(color);
    this.color[i * 3] = this.c.r; this.color[i * 3 + 1] = this.c.g; this.color[i * 3 + 2] = this.c.b;
    this.baseAlpha ??= new Float32Array(this.max);
    this.baseAlpha[i] = alpha;
  }

  burst(x, y, z, n, speed, opts = {}) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      const up = (opts.up ?? 1) * speed * (0.5 + Math.random());
      this.emit(x, y, z, Math.cos(a) * s, up, Math.sin(a) * s, { ...opts, size: (opts.size ?? 1) * (0.6 + Math.random() * 0.8) });
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 2] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.baseAlpha[i] * Math.min(1, t * 2.5);
      this.size[i] *= 1 + dt * 0.35;
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = a.aColor.needsUpdate = true;
  }
}

/** Wind-blown sand streaks that wrap around the camera; intensity scales with the storm. */
export class StormField {
  constructor(scene, count = 2500) {
    this.count = count;
    this.box = 70;
    const pos = new Float32Array(count * 6);
    this.seed = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.seed[i * 3] = Math.random() * this.box;
      this.seed[i * 3 + 1] = Math.random() * 30;
      this.seed[i * 3 + 2] = Math.random() * this.box;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.LineBasicMaterial({ color: '#f1c48a', transparent: true, opacity: 0, depthWrite: false });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    this.offset = new THREE.Vector3();
    this.wind = new THREE.Vector3(1, 0, 0.35).normalize();
  }

  update(dt, center, intensity, groundY, color) {
    this.mat.opacity = intensity * 0.38;
    this.lines.visible = intensity > 0.01;
    if (!this.lines.visible) return;
    if (color) this.mat.color.copy(color).lerp(new THREE.Color('#ffe0b0'), 0.5);
    const speed = 30 + intensity * 40;
    this.offset.addScaledVector(this.wind, speed * dt);
    const p = this.lines.geometry.attributes.position.array;
    const B = this.box, hb = B / 2;
    const sl = 0.6 + intensity * 1.8;
    for (let i = 0; i < this.count; i++) {
      let x = (this.seed[i * 3] + this.offset.x - center.x) % B; if (x < 0) x += B;
      let z = (this.seed[i * 3 + 2] + this.offset.z - center.z) % B; if (z < 0) z += B;
      const wx = center.x + x - hb, wz = center.z + z - hb;
      const wy = groundY + this.seed[i * 3 + 1] - 5 + Math.sin(this.offset.x * 0.05 + i) * 1.2;
      p[i * 6] = wx; p[i * 6 + 1] = wy; p[i * 6 + 2] = wz;
      p[i * 6 + 3] = wx - this.wind.x * sl; p[i * 6 + 4] = wy; p[i * 6 + 5] = wz - this.wind.z * sl;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
