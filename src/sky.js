import * as THREE from 'three';
import { clamp, smoothstep, mulberry32 } from './noise.js';

// Key colours across the day. t: 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk.
const KEYS = [
  { t: 0.0, top: '#060716', hor: '#1a1838', fog: '#141429', sun: '#000000', amb: 0.12 },
  { t: 0.2, top: '#0d1030', hor: '#3a2a4a', fog: '#2b2238', sun: '#ff8c5a', amb: 0.18 },
  { t: 0.27, top: '#3a4f86', hor: '#ff9a5c', fog: '#d68a62', sun: '#ffb070', amb: 0.45 },
  { t: 0.38, top: '#4f8fd0', hor: '#f3d2a2', fog: '#e8c79a', sun: '#fff1d6', amb: 0.8 },
  { t: 0.5, top: '#3f86d4', hor: '#f6dcb0', fog: '#eed2a6', sun: '#ffffff', amb: 0.9 },
  { t: 0.62, top: '#4f8fd0', hor: '#f3d2a2', fog: '#e8c79a', sun: '#fff1d6', amb: 0.8 },
  { t: 0.73, top: '#4a3f7d', hor: '#ff7b47', fog: '#c96e4f', sun: '#ff9550', amb: 0.45 },
  { t: 0.8, top: '#121233', hor: '#4a2a48', fog: '#2a2036', sun: '#ff6a40', amb: 0.2 },
  { t: 1.0, top: '#060716', hor: '#1a1838', fog: '#141429', sun: '#000000', amb: 0.12 },
].map((k) => ({ ...k, top: new THREE.Color(k.top), hor: new THREE.Color(k.hor), fog: new THREE.Color(k.fog), sun: new THREE.Color(k.sun) }));

const STORM_FOG = new THREE.Color('#b9733f');
const STORM_SKY = new THREE.Color('#a8683a');

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.uniforms = {
      topColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color() },
      storm: { value: 0 },
      stormColor: { value: STORM_SKY.clone() },
    };
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 sunDir; uniform vec3 sunColor;
        uniform float storm; uniform vec3 stormColor;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 col = mix(horizonColor, topColor, pow(max(h, 0.0), 0.55));
          if (h < 0.0) col = horizonColor * (1.0 + h * 1.5);
          float d = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          col += sunColor * (pow(d, 900.0) * 3.0 + pow(d, 24.0) * 0.35 + pow(d, 4.0) * 0.12);
          col = mix(col, stormColor * (0.6 + 0.4 * length(sunColor) / 1.7), storm);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMat);
    this.dome.renderOrder = -10;
    this.group.add(this.dome);

    // stars
    const rand = mulberry32(7);
    const starPos = [];
    for (let i = 0; i < 1500; i++) {
      const u = rand() * 2 - 1, th = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const y = Math.abs(u);
      starPos.push(r * Math.cos(th) * 1400, y * 1400, r * Math.sin(th) * 1400);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.group.add(this.stars);

    // A huge ringed gas giant hanging over the horizon.
    const giant = new THREE.Group();
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(160, 32, 20),
      new THREE.MeshBasicMaterial({ color: '#7f9bb8', fog: false, transparent: true }),
    );
    const bands = new THREE.Mesh(
      new THREE.SphereGeometry(161, 32, 20),
      new THREE.ShaderMaterial({
        transparent: true, fog: false, depthWrite: false,
        uniforms: { light: { value: 1 } },
        vertexShader: 'varying vec3 vP; varying vec3 vN; void main(){ vP=position; vN=normal; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform float light; varying vec3 vP; varying vec3 vN;
          void main(){ float b = sin(vP.y*0.09)*0.5+0.5; float b2 = sin(vP.y*0.23+1.3)*0.5+0.5;
            vec3 c = mix(vec3(0.46,0.6,0.74), vec3(0.83,0.75,0.62), b*0.6+b2*0.2);
            float shade = clamp(dot(normalize(vN), normalize(vec3(-0.6,0.3,0.7)))*0.8+0.35,0.15,1.0);
            gl_FragColor = vec4(c*shade, 0.95*light);}`,
      }),
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(200, 330, 96, 1),
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide, transparent: true, fog: false, depthWrite: false,
        uniforms: { light: { value: 1 } },
        vertexShader: 'varying vec2 vUv; varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform float light; varying vec3 vP;
          void main(){ float r = length(vP.xy); float t=(r-200.0)/130.0;
            float a = (0.45+0.35*sin(t*40.0))*(0.6+0.4*sin(t*7.0)) * smoothstep(0.0,0.05,t)*smoothstep(1.0,0.9,t);
            gl_FragColor = vec4(vec3(0.92,0.85,0.72), a*0.7*light);}`,
      }),
    );
    ring.rotation.x = Math.PI / 2 - 0.35;
    ring.rotation.y = 0.25;
    giant.add(planet, bands, ring);
    giant.position.set(-700, 380, -900);
    giant.lookAt(0, 0, 0);
    this.giant = giant;
    this.giantMats = [planet.material, bands.material, ring.material];
    this.group.add(giant);

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.4;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0xc98a52, 0.6);
    scene.add(this.hemi);
    this.moonLight = new THREE.DirectionalLight(0x8fa8ff, 0.0);
    scene.add(this.moonLight);

    scene.fog = new THREE.FogExp2(0xe8c79a, 0.0018);
    this.fogColor = new THREE.Color();
    this.time = 0.33; // start in the morning
    this.dayLength = 420; // seconds per full cycle
    this.storm = 0;
  }

  sample(t) {
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    }
    const f = (t - a.t) / Math.max(1e-5, b.t - a.t);
    return { a, b, f };
  }

  get isNight() { return this.time < 0.22 || this.time > 0.78; }
  get heat() { // 0..1 how hot it is (drives water drain)
    return clamp(Math.sin((this.time - 0.25) * Math.PI * 2) * 0.5 + 0.5, 0, 1);
  }
  get clock() {
    const hours = (this.time * 24) % 24;
    const h = Math.floor(hours), m = Math.floor((hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  update(dt, focus, storm) {
    this.time = (this.time + dt / this.dayLength) % 1;
    this.storm = storm;
    this.group.position.copy(focus);
    const { a, b, f } = this.sample(this.time);
    const u = this.uniforms;
    u.topColor.value.copy(a.top).lerp(b.top, f);
    u.horizonColor.value.copy(a.hor).lerp(b.hor, f);
    u.sunColor.value.copy(a.sun).lerp(b.sun, f);
    u.storm.value = storm * 0.85;
    const amb = a.amb + (b.amb - a.amb) * f;

    const ang = (this.time - 0.25) * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.85, Math.sin(ang), 0.45).normalize();
    u.sunDir.value.copy(sunDir);

    const sunUp = smoothstep(-0.05, 0.12, sunDir.y);
    this.sun.position.copy(focus).addScaledVector(sunDir, 200);
    this.sun.target.position.copy(focus);
    this.sun.color.copy(u.sunColor.value).lerp(new THREE.Color(1, 1, 1), 0.2);
    this.sun.intensity = 2.6 * sunUp * (1 - storm * 0.7);
    this.sun.castShadow = sunUp > 0.05;

    this.moonLight.position.copy(focus).add(new THREE.Vector3(-0.4, 0.8, -0.5).multiplyScalar(200));
    this.moonLight.target.position.copy(focus);
    this.moonLight.intensity = (1 - sunUp) * 0.55;

    this.hemi.intensity = 0.35 + amb * 0.9;
    this.hemi.color.copy(u.topColor.value).lerp(new THREE.Color(1, 1, 1), 0.55);

    this.fogColor.copy(a.fog).lerp(b.fog, f).lerp(STORM_FOG, storm * 0.85);
    if (storm > 0) this.fogColor.multiplyScalar(0.55 + 0.45 * Math.max(sunUp, 0.3));
    this.scene.fog.color.copy(this.fogColor);
    this.scene.fog.density = 0.0016 + storm * 0.02;
    u.stormColor.value.copy(this.fogColor);

    this.starMat.opacity = (1 - smoothstep(-0.15, 0.1, sunDir.y)) * (1 - storm);
    const gl = (0.35 + 0.65 * (1 - sunUp * 0.5)) * (1 - storm);
    for (const m of this.giantMats) {
      if (m.uniforms) m.uniforms.light.value = gl; else m.opacity = gl;
    }
    this.sunDir = sunDir;
    this.sunUp = sunUp;
  }
}
