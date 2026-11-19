import * as THREE from 'three';

/**
 * One full-screen pass for the desert "lens": heat shimmer over the horizon,
 * rolling volumetric-looking dust sheets during storms, a red danger pulse,
 * warm grading and vignette. Runs in linear HDR space before tone mapping.
 */
export const DesertLensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uHeat: { value: 0 },
    uStorm: { value: 0 },
    uStormColor: { value: new THREE.Color('#b9733f') },
    uYaw: { value: 0 },
    uPitch: { value: 0 },
    uAspect: { value: 1.6 },
    uDanger: { value: 0 },
    uHurt: { value: 0 },
    uNight: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uHeat, uStorm, uYaw, uPitch, uAspect, uDanger, uHurt, uNight;
    uniform vec3 uStormColor;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float s = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
      return s;
    }

    void main() {
      vec2 uv = vUv;
      // horizon line moves with camera pitch
      float horizon = 0.5 + uPitch * 0.75;
      float band = 1.0 - smoothstep(0.0, 0.14, abs(uv.y - horizon + 0.03));
      float hz = uHeat * band;
      uv.x += (sin(uv.y * 260.0 + uTime * 7.0) * 0.0011 + sin(uv.y * 97.0 - uTime * 4.3) * 0.0008) * hz;
      uv.y += sin(uv.x * 170.0 + uTime * 5.1) * 0.0007 * hz;

      // storm: warp the image and roll layered dust sheets across it
      vec2 sp = vec2(uv.x * uAspect - uYaw * 1.6, uv.y + uPitch);
      float w = fbm(sp * 3.0 + vec2(uTime * 1.3, 0.0));
      uv += (vec2(w, fbm(sp * 3.0 - 7.0)) - 0.5) * 0.012 * uStorm;
      vec4 col = texture2D(tDiffuse, uv);

      if (uStorm > 0.001) {
        float s1 = fbm(sp * vec2(1.4, 3.2) + vec2(uTime * 0.55, uTime * 0.04));
        float s2 = fbm(sp * vec2(3.5, 6.0) + vec2(uTime * 1.4, -uTime * 0.1));
        float s3 = fbm(sp * vec2(9.0, 14.0) + vec2(uTime * 3.2, 0.0));
        float dens = (0.25 + 0.55 * s1 + 0.3 * s2 + 0.12 * s3) * (0.75 + 0.35 * (1.0 - uv.y));
        dens = smoothstep(0.2, 1.05, dens) * uStorm;
        vec3 dust = uStormColor * (0.75 + 0.5 * s2);
        col.rgb = mix(col.rgb, dust, clamp(dens, 0.0, 0.93));
      }

      // grading: warm highlights, cool night shadows
      float l = dot(col.rgb, vec3(0.299, 0.587, 0.114));
      col.rgb = mix(col.rgb, col.rgb * vec3(1.06, 0.99, 0.9), (1.0 - uNight) * 0.6);
      col.rgb = mix(col.rgb, col.rgb * vec3(0.85, 0.95, 1.2) + vec3(0.0, 0.004, 0.012), uNight * (1.0 - smoothstep(0.0, 0.6, l)));

      // vignette, danger pulse and hurt flash
      vec2 c = vUv - 0.5; c.x *= uAspect * 0.6;
      float r = length(c);
      col.rgb *= mix(1.0, smoothstep(0.95, 0.25, r), 0.5);
      float pulse = uDanger * (0.6 + 0.4 * sin(uTime * 7.0));
      col.rgb = mix(col.rgb, vec3(0.45, 0.02, 0.0), smoothstep(0.35, 0.9, r) * clamp(pulse * 0.7 + uHurt, 0.0, 0.85));
      // film grain
      col.rgb += (hash(vUv * 900.0 + uTime) - 0.5) * 0.012;
      gl_FragColor = col;
    }`,
};
