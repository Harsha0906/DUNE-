import * as THREE from 'three';

const mats = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...opts }));
  return mats.get(key);
}

function mesh(geo, material, shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = shadow; m.receiveShadow = shadow;
  return m;
}

// ---------------- the wanderer ----------------
export function createWanderer() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const coat = mat('#2f6a70');        // teal long coat
  const coatDark = mat('#22494d');
  const cloth = mat('#e2cfa8');       // pale sand wraps
  const scarfM = mat('#d0482c');      // signature red scarf
  const leather = mat('#5a3b28');
  const dark = mat('#2a2522');
  const metal = mat('#9a978f', { metalness: 0.6, roughness: 0.4 });
  const brass = mat('#d29a45', { metalness: 0.7, roughness: 0.35 });
  const skin = mat('#a8714f');
  const gogM = new THREE.MeshStandardMaterial({ color: '#2ef2ff', emissive: '#18c8e0', emissiveIntensity: 1.6, flatShading: true });
  const add = (parent, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const o = mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); parent.add(o); return o;
  };

  // ---- torso: fitted coat, chest harness, belt with pouches
  add(body, new THREE.CylinderGeometry(0.27, 0.33, 0.62, 8), coat, 0, 1.25, 0);            // chest
  add(body, new THREE.CylinderGeometry(0.33, 0.3, 0.2, 8), coatDark, 0, 0.9, 0);            // waist
  add(body, new THREE.CylinderGeometry(0.3, 0.32, 0.1, 8), leather, 0, 0.98, 0);            // belt
  add(body, new THREE.BoxGeometry(0.12, 0.09, 0.04), brass, 0, 0.98, 0.31);                 // buckle
  for (const s of [-1, 1]) {
    add(body, new THREE.BoxGeometry(0.12, 0.14, 0.09), leather, 0.24 * s, 0.94, 0.2, 0, 0.5 * s, 0); // pouches
    // crossed harness straps
    add(body, new THREE.BoxGeometry(0.06, 0.7, 0.03), leather, 0.06 * s, 1.27, 0.27, 0, 0, 0.5 * s);
  }
  add(body, new THREE.CylinderGeometry(0.06, 0.06, 0.04, 8), brass, 0, 1.3, 0.3, Math.PI / 2, 0, 0); // harness clasp
  // coat skirt: front split flaps and a long back tail that swings
  for (const s of [-1, 1]) add(body, new THREE.BoxGeometry(0.26, 0.58, 0.05), coat, 0.15 * s, 0.56, 0.22, -0.08, 0, 0.06 * s);
  const tail = new THREE.Group(); tail.position.set(0, 0.86, -0.22); body.add(tail);
  add(tail, new THREE.BoxGeometry(0.56, 0.7, 0.05), coat, 0, -0.35, 0, 0.1, 0, 0);
  add(tail, new THREE.BoxGeometry(0.56, 0.06, 0.06), coatDark, 0, -0.69, 0.03, 0.1, 0, 0);

  // ---- head: hooded, masked, glowing goggles
  const head = new THREE.Group(); head.position.y = 1.78; body.add(head);
  add(head, new THREE.IcosahedronGeometry(0.2, 1), skin, 0, 0, 0.01);
  const hood = add(head, new THREE.IcosahedronGeometry(0.27, 1), cloth, 0, 0.06, -0.06); hood.scale.set(1.05, 1.05, 1.15);
  add(head, new THREE.ConeGeometry(0.14, 0.26, 6), cloth, 0, 0.12, -0.3, -1.9, 0, 0);       // hood point
  add(head, new THREE.TorusGeometry(0.19, 0.045, 6, 12, Math.PI * 1.3), cloth, 0, 0.02, 0.12, 0, 0, -0.08 + Math.PI * -0.15); // hood rim
  // face mask over nose and mouth
  const mask = add(head, new THREE.CylinderGeometry(0.17, 0.2, 0.17, 8, 1, false, -1.2, 2.4), scarfM, 0, -0.08, 0.02); mask.scale.z = 1.05;
  add(head, new THREE.BoxGeometry(0.22, 0.03, 0.03), dark, 0, -0.06, 0.19);                 // mask seam
  // goggles: brass rims, glowing lenses, strap
  add(head, new THREE.BoxGeometry(0.06, 0.05, 0.05), brass, 0, 0.05, 0.19);                 // bridge
  for (const s of [-1, 1]) {
    add(head, new THREE.CylinderGeometry(0.075, 0.075, 0.07, 10), brass, 0.09 * s, 0.05, 0.18, Math.PI / 2, 0, 0);
    add(head, new THREE.CylinderGeometry(0.058, 0.058, 0.02, 10), gogM, 0.09 * s, 0.05, 0.22, Math.PI / 2, 0, 0);
  }
  add(head, new THREE.TorusGeometry(0.205, 0.022, 4, 14), dark, 0, 0.05, 0, Math.PI / 2, 0, 0);

  // ---- scarf tail that streams in the wind
  add(body, new THREE.TorusGeometry(0.2, 0.07, 6, 10), scarfM, 0, 1.6, 0, Math.PI / 2, 0, 0); // scarf collar
  const scarf = new THREE.Group(); scarf.position.set(0.08, 1.6, -0.2); body.add(scarf);
  const segs = [];
  let parent = scarf;
  for (let i = 0; i < 5; i++) {
    const sg = new THREE.Group(); sg.position.z = i === 0 ? 0 : -0.2; parent.add(sg);
    const p = mesh(new THREE.BoxGeometry(0.17 - i * 0.02, 0.03, 0.22), scarfM); p.position.z = -0.1; sg.add(p);
    segs.push(sg); parent = sg;
  }

  // ---- backpack: frame, bedroll, twin glowing tanks, antenna light
  add(body, new THREE.BoxGeometry(0.44, 0.52, 0.2), leather, 0, 1.22, -0.36);
  add(body, new THREE.BoxGeometry(0.48, 0.05, 0.24), metal, 0, 1.49, -0.36);
  add(body, new THREE.BoxGeometry(0.48, 0.05, 0.24), metal, 0, 0.97, -0.36);
  add(body, new THREE.CylinderGeometry(0.1, 0.1, 0.58, 8), cloth, 0, 1.6, -0.36, 0, 0, Math.PI / 2); // bedroll
  for (const s of [-1, 1]) add(body, new THREE.CylinderGeometry(0.105, 0.105, 0.03, 8), leather, 0.2 * s, 1.6, -0.36, 0, 0, Math.PI / 2);
  const tankMat = new THREE.MeshStandardMaterial({ color: '#4fc3ff', emissive: '#1a6fa0', emissiveIntensity: 0.7, transparent: true, opacity: 0.88, roughness: 0.2 });
  for (const s of [-1, 1]) {
    add(body, new THREE.CylinderGeometry(0.09, 0.09, 0.46, 10), tankMat, 0.13 * s, 1.22, -0.5);
    add(body, new THREE.CylinderGeometry(0.095, 0.095, 0.05, 10), metal, 0.13 * s, 1.47, -0.5);
    add(body, new THREE.CylinderGeometry(0.095, 0.095, 0.05, 10), metal, 0.13 * s, 0.98, -0.5);
  }
  add(body, new THREE.CylinderGeometry(0.012, 0.012, 0.5, 4), metal, 0.18, 1.75, -0.42);
  add(body, new THREE.SphereGeometry(0.035, 6, 4), new THREE.MeshStandardMaterial({ color: '#ffb35c', emissive: '#ff8a1f', emissiveIntensity: 2 }), 0.18, 2.0, -0.42);

  // ---- limbs (hip and shoulder pivots drive the walk cycle)
  const limbs = {};
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(0.14 * s, 0.82, 0); body.add(hip);
    add(hip, new THREE.CylinderGeometry(0.1, 0.085, 0.42, 7), cloth, 0, -0.2, 0);          // thigh
    add(hip, new THREE.CylinderGeometry(0.095, 0.095, 0.1, 7), leather, 0, -0.43, 0.01);    // knee wrap
    add(hip, new THREE.CylinderGeometry(0.085, 0.075, 0.32, 7), cloth, 0, -0.62, 0);        // shin
    add(hip, new THREE.CylinderGeometry(0.1, 0.1, 0.22, 7), dark, 0, -0.7, 0);              // boot shaft
    add(hip, new THREE.BoxGeometry(0.17, 0.1, 0.3), dark, 0, -0.8, 0.06);                   // boot foot
    add(hip, new THREE.BoxGeometry(0.18, 0.03, 0.32), leather, 0, -0.85, 0.06);             // sole

    const sh = new THREE.Group(); sh.position.set(0.36 * s, 1.5, 0); body.add(sh);
    const pad = add(sh, new THREE.SphereGeometry(0.15, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), coatDark, 0.02 * s, 0.02, 0); pad.scale.set(1.1, 0.8, 1.1); // shoulder pad
    add(sh, new THREE.BoxGeometry(0.12, 0.02, 0.2), brass, 0.06 * s, 0.07, 0, 0, 0, -0.4 * s);
    add(sh, new THREE.CylinderGeometry(0.085, 0.075, 0.34, 7), coat, 0, -0.18, 0);           // upper arm
    add(sh, new THREE.CylinderGeometry(0.08, 0.08, 0.2, 7), cloth, 0, -0.42, 0);            // forearm wrap
    add(sh, new THREE.CylinderGeometry(0.085, 0.085, 0.07, 7), leather, 0, -0.5, 0);        // bracer
    add(sh, new THREE.BoxGeometry(0.11, 0.13, 0.11), leather, 0, -0.6, 0.01);               // glove
    limbs[s < 0 ? 'legL' : 'legR'] = hip;
    limbs[s < 0 ? 'armL' : 'armR'] = sh;
  }
  root.userData = { body, head, scarf: segs, tail, ...limbs };
  return root;
}

// ---------------- sand-skimmer ----------------
export function createSkimmer() {
  const root = new THREE.Group();
  const hullM = mat('#e6e1d3');
  const trim = mat('#c2452d');
  const dark = mat('#2b2a2e');
  const glowM = new THREE.MeshStandardMaterial({ color: '#7ff6ff', emissive: '#3fe0ff', emissiveIntensity: 2.2 });

  const hull = mesh(new THREE.CylinderGeometry(0.9, 1.1, 4.2, 6), hullM);
  hull.rotation.x = Math.PI / 2; hull.scale.set(1, 1, 0.42); hull.position.y = 0.2; root.add(hull);
  const nose = mesh(new THREE.ConeGeometry(0.9, 1.6, 6), hullM);
  nose.rotation.x = Math.PI / 2; nose.scale.set(1, 1, 0.42); nose.position.set(0, 0.2, 2.9); root.add(nose);
  const stripe = mesh(new THREE.BoxGeometry(0.25, 0.42, 5.2), trim); stripe.position.set(0, 0.32, 0.4); root.add(stripe);
  const seat = mesh(new THREE.BoxGeometry(0.7, 0.4, 1.2), dark); seat.position.set(0, 0.6, -0.6); root.add(seat);
  const screen = mesh(new THREE.BoxGeometry(1.0, 0.5, 0.08), new THREE.MeshStandardMaterial({ color: '#89d6ff', transparent: true, opacity: 0.45, roughness: 0.1 }));
  screen.position.set(0, 0.75, 0.6); screen.rotation.x = -0.6; root.add(screen);
  for (const s of [-1, 1]) {
    const pod = mesh(new THREE.CylinderGeometry(0.32, 0.38, 2.6, 6), hullM);
    pod.rotation.x = Math.PI / 2; pod.position.set(1.35 * s, 0.05, -0.3); root.add(pod);
    const fin = mesh(new THREE.BoxGeometry(0.06, 0.7, 1.0), trim); fin.position.set(1.35 * s, 0.5, -1.2); root.add(fin);
    const glow = mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 8), glowM, false); glow.position.set(1.35 * s, -0.33, -0.3); root.add(glow);
    const thr = mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.2, 8), glowM, false);
    thr.rotation.x = Math.PI / 2; thr.position.set(1.35 * s, 0.05, -1.65); root.add(thr);
  }
  const under = mesh(new THREE.BoxGeometry(1.2, 0.05, 3), glowM, false); under.position.y = -0.18; root.add(under);
  return root;
}

// ---------------- the Veil Ray (giant sand creature) ----------------
export function createVeilRay() {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const hideM = new THREE.MeshStandardMaterial({ color: '#5c463a', flatShading: true, roughness: 0.75, metalness: 0.15 });
  const bellyM = mat('#cdb48f');
  const spineM = new THREE.MeshStandardMaterial({ color: '#2a1f1c', emissive: '#ff6a10', emissiveIntensity: 0.25, flatShading: true });
  const markM = new THREE.MeshStandardMaterial({ color: '#ff9a3c', emissive: '#ff6a10', emissiveIntensity: 1.6, flatShading: true });
  const boneM = mat('#d9ccb0');

  // wing-body: a flattened, swept diamond made from a deformed sphere
  const g = new THREE.SphereGeometry(1, 16, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ax = Math.abs(x);
    x *= 24; z *= 13; y *= 3.2;
    z -= ax * ax * 9; // sweep the wings back
    y -= ax * ax * 3; // droop the wing tips
    if (y < 0) y *= 0.6;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  const wing = mesh(g, hideM); body.add(wing);
  const belly = mesh(g.clone(), bellyM); belly.scale.set(0.96, 0.7, 0.96); belly.position.y = -0.4; body.add(belly);

  // glowing markings
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const m = mesh(new THREE.BoxGeometry(2.4 - i * 0.3, 0.3, 0.5), markM, false);
      const x = s * (5 + i * 4);
      m.position.set(x, 2.3 - i * 0.55 - (i * i) * 0.05, -((x / 24) ** 2) * 9 - 1);
      m.rotation.y = s * 0.5;
      body.add(m);
    }
  }

  // head ridge, eyes, and the grinding maw underneath
  const crest = mesh(new THREE.ConeGeometry(3.4, 8, 5), hideM);
  crest.rotation.x = Math.PI / 2; crest.scale.set(1, 1, 0.4); crest.position.set(0, 1.2, 11); body.add(crest);
  const eyeM = new THREE.MeshStandardMaterial({ color: '#ffd36b', emissive: '#ffb300', emissiveIntensity: 3 });
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    const e = mesh(new THREE.OctahedronGeometry(0.42 - k * 0.08, 0), eyeM, false);
    e.position.set(s * (1.6 + k * 0.9), 1.6 - k * 0.15, 10 - k * 1.1); body.add(e);
  }
  const maw = mesh(new THREE.BoxGeometry(6, 0.8, 1.4), mat('#1a0f0d')); maw.position.set(0, -1.2, 9); body.add(maw);
  for (let i = -5; i <= 5; i++) {
    const tooth = mesh(new THREE.ConeGeometry(0.22, 0.9, 4), boneM, false);
    tooth.rotation.x = Math.PI; tooth.position.set(i * 0.5, -0.9, 9.6); body.add(tooth);
  }

  // dorsal spines: these cut through the sand while it swims below
  const spines = [];
  for (let i = 0; i < 7; i++) {
    const sp = mesh(new THREE.ConeGeometry(0.95 - i * 0.07, 5.6 - i * 0.4, 4), spineM);
    sp.position.set(0, 3.4, 6 - i * 3.3); sp.rotation.x = -0.45; body.add(sp); spines.push(sp);
  }
  // whip tail
  const tail = new THREE.Group(); tail.position.set(0, 0.5, -12); body.add(tail);
  const tailSegs = [];
  let parent = tail;
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Group(); s.position.z = i === 0 ? 0 : -3.2; parent.add(s);
    const c = mesh(new THREE.CylinderGeometry(0.55 - i * 0.08, 0.7 - i * 0.08, 3.4, 5), hideM);
    c.rotation.x = Math.PI / 2; c.position.z = -1.6; s.add(c);
    tailSegs.push(s); parent = s;
  }
  const barb = mesh(new THREE.ConeGeometry(0.5, 2.2, 4), markM); barb.rotation.x = -Math.PI / 2; barb.position.z = -4; parent.add(barb);

  root.userData = { body, spines, tailSegs, markM };
  return root;
}

// ---------------- props ----------------
export function createShard(rand) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({
    color: '#8fe9ff', emissive: '#29b6ff', emissiveIntensity: 1.7, roughness: 0.15, metalness: 0.1, flatShading: true,
    transparent: true, opacity: 0.92,
  });
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const c = mesh(new THREE.OctahedronGeometry(0.35 + rand() * 0.25, 0), m);
    c.scale.y = 2.2 + rand() * 1.4;
    c.position.set((rand() - 0.5) * 0.8, 0.4, (rand() - 0.5) * 0.8);
    c.rotation.set((rand() - 0.5) * 0.7, rand() * 3, (rand() - 0.5) * 0.7);
    g.add(c);
  }
  return g;
}

export function createCondenser() {
  const g = new THREE.Group();
  const metal = mat('#b8b2a4', { metalness: 0.4, roughness: 0.5 });
  const dark = mat('#3b3633');
  const cloth = mat('#d9c39b', { side: THREE.DoubleSide });
  const base = mesh(new THREE.CylinderGeometry(1.6, 2, 0.6, 8), dark); base.position.y = 0.3; g.add(base);
  const tank = mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 8), metal); tank.position.y = 1.7; g.add(tank);
  const water = mesh(new THREE.CylinderGeometry(1.12, 1.12, 0.5, 8), new THREE.MeshStandardMaterial({ color: '#45c4ff', emissive: '#1d7fbf', emissiveIntensity: 1.2 }), false);
  water.position.y = 1.4; g.add(water);
  const mast = mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 6), dark); mast.position.y = 5; g.add(mast);
  // mesh-net vanes that catch dew
  const vanes = new THREE.Group(); vanes.position.y = 7.2; g.add(vanes);
  for (let i = 0; i < 4; i++) {
    const v = mesh(new THREE.PlaneGeometry(0.6, 1.5), cloth); v.position.x = 0.4; const piv = new THREE.Group(); piv.rotation.y = (i * Math.PI) / 2; piv.add(v); vanes.add(piv);
  }
  // awning for shelter
  const awn = mesh(new THREE.ConeGeometry(4.2, 1.4, 8, 1, true), cloth); awn.position.y = 3.7; g.add(awn);
  for (let i = 0; i < 4; i++) {
    const pole = mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 5), dark);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4; pole.position.set(Math.cos(a) * 3.6, 1.6, Math.sin(a) * 3.6); g.add(pole);
  }
  const lamp = mesh(new THREE.OctahedronGeometry(0.28, 0), new THREE.MeshStandardMaterial({ color: '#7fdfff', emissive: '#3fcfff', emissiveIntensity: 3 }), false);
  lamp.position.y = 8.7; g.add(lamp);
  g.userData = { vanes, water };
  return g;
}

export function createBeacon() {
  const g = new THREE.Group();
  const stone = mat('#6f5a4b');
  const dark = mat('#2e2925');
  const ped = mesh(new THREE.CylinderGeometry(5, 6, 1.2, 8), dark); ped.position.y = 0.6; g.add(ped);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const pylon = mesh(new THREE.BoxGeometry(1, 11, 1.4), stone);
    pylon.position.set(Math.cos(a) * 3.4, 5.5, Math.sin(a) * 3.4); pylon.rotation.y = -a; pylon.rotation.z = 0.12; g.add(pylon);
  }
  const coreM = new THREE.MeshStandardMaterial({ color: '#ffbf6b', emissive: '#ff8a1f', emissiveIntensity: 2 });
  const core = mesh(new THREE.IcosahedronGeometry(1.2, 0), coreM, false); core.position.y = 6; g.add(core);
  const beamM = new THREE.MeshBasicMaterial({ color: '#ffb35c', transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.2, 400, 12, 1, true), beamM); beam.position.y = 200; g.add(beam);
  g.userData = { core, coreM, beam, beamM };
  return g;
}

export function createCache() {
  const g = new THREE.Group();
  const crate = mesh(new THREE.BoxGeometry(1.2, 0.7, 0.8), mat('#5a6b5f'));
  crate.position.y = 0.3; crate.rotation.z = 0.15; g.add(crate);
  const lid = mesh(new THREE.BoxGeometry(1.25, 0.12, 0.85), mat('#c2452d')); lid.position.y = 0.7; lid.rotation.z = 0.15; g.add(lid);
  const flask = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.5, 7), new THREE.MeshStandardMaterial({ color: '#4fc3ff', emissive: '#1a7fc0', emissiveIntensity: 1.4 }));
  flask.position.set(0.7, 0.25, 0.3); flask.rotation.z = 1.2; g.add(flask);
  return g;
}

export function createStake() {
  const g = new THREE.Group();
  const rod = mesh(new THREE.CylinderGeometry(0.08, 0.04, 1.6, 6), mat('#3b3633')); rod.position.y = 0.4; g.add(rod);
  const headM = new THREE.MeshStandardMaterial({ color: '#ff9a3c', emissive: '#ff6a10', emissiveIntensity: 2 });
  const head = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 8), headM); head.position.y = 1.25; g.add(head);
  g.userData = { head };
  return g;
}

export function createRibcage(rand) {
  const g = new THREE.Group();
  const bone = mat('#e3d6bb');
  const spineLen = 30;
  const spine = mesh(new THREE.CylinderGeometry(0.6, 0.4, spineLen, 6), bone);
  spine.rotation.x = Math.PI / 2; spine.position.y = 1; g.add(spine);
  for (let i = 0; i < 9; i++) {
    for (const s of [-1, 1]) {
      const rib = mesh(new THREE.TorusGeometry(6 - Math.abs(i - 4) * 0.5, 0.35, 5, 10, Math.PI * 0.6), bone);
      rib.position.set(0, 1, -spineLen / 2 + 3 + i * 3);
      rib.rotation.y = Math.PI / 2; rib.rotation.z = s > 0 ? 0.25 : Math.PI - 0.25;
      rib.rotation.x = (rand() - 0.5) * 0.2;
      g.add(rib);
    }
  }
  return g;
}

export function createBoulder(rand, color = '#7a4630') {
  const m = mesh(new THREE.DodecahedronGeometry(1, 0), mat(color));
  m.scale.set(0.8 + rand() * 0.5, 0.55 + rand() * 0.4, 0.8 + rand() * 0.5);
  m.rotation.set(rand() * 0.4, rand() * Math.PI, rand() * 0.4);
  return m;
}

// ---------------- ruins of the glass-singers ----------------
export function createRuin(rand, kind) {
  const g = new THREE.Group();
  const stone = mat('#b59a78');
  const stoneD = mat('#8c7356');
  const glyphM = new THREE.MeshStandardMaterial({ color: '#8fe9ff', emissive: '#29b6ff', emissiveIntensity: 1.6 });
  // a cracked stone floor: the safe ground
  const floor = mesh(new THREE.CylinderGeometry(9, 9.6, 1.2, 10), stoneD);
  floor.position.y = 0.2; g.add(floor);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    if (rand() < 0.3) continue;
    const h = 2 + rand() * 7;
    const col = mesh(new THREE.CylinderGeometry(0.55, 0.65, h, 7), stone);
    col.position.set(Math.cos(a) * 7.5, h / 2 + 0.6, Math.sin(a) * 7.5);
    col.rotation.z = (rand() - 0.5) * 0.15;
    g.add(col);
    if (h > 6 && rand() < 0.6) {
      const cap = mesh(new THREE.BoxGeometry(1.6, 0.5, 1.6), stoneD);
      cap.position.set(col.position.x, h + 0.85, col.position.z); g.add(cap);
    }
  }
  if (kind === 'arch' || kind === 'dome') {
    const arch = mesh(new THREE.TorusGeometry(5, 0.7, 6, 12, Math.PI), stone);
    arch.position.y = 0.6; arch.rotation.y = rand() * Math.PI; g.add(arch);
  }
  if (kind === 'dome') {
    const dome = mesh(new THREE.SphereGeometry(6, 10, 6, 0, Math.PI * 1.3, 0, Math.PI / 2), stone);
    dome.material = mat('#b59a78', { side: THREE.DoubleSide });
    dome.position.y = 0.4; dome.rotation.y = rand() * 6; g.add(dome);
  }
  // fallen colossal head of a glass-singer, half buried
  if (kind === 'head') {
    const head = mesh(new THREE.IcosahedronGeometry(4, 0), stone);
    head.scale.set(1, 1.25, 1); head.position.set(-3, 1.5, 3); head.rotation.set(0.6, 0.4, 1.2); g.add(head);
    const eye = mesh(new THREE.OctahedronGeometry(0.6, 0), glyphM, false); eye.position.set(-1.2, 3.2, 5.2); g.add(eye);
  }
  // the echo tablet
  const tablet = new THREE.Group();
  const slab = mesh(new THREE.BoxGeometry(2.2, 3.2, 0.5), stoneD); slab.position.y = 2.2; tablet.add(slab);
  const glyph = mesh(new THREE.TorusKnotGeometry(0.45, 0.08, 40, 5, 2, 3), glyphM, false); glyph.position.set(0, 2.4, 0.3); tablet.add(glyph);
  tablet.position.set(0, 0, -2);
  g.add(tablet);
  g.userData = { tablet, glyph, glyphM };
  return g;
}

export function createWreck() {
  const g = new THREE.Group();
  const s = createSkimmer();
  s.rotation.set(0.5, 0.8, 2.6);
  s.position.y = 0.4;
  s.traverse((o) => { if (o.material && o.material.emissive) { o.material = o.material.clone(); o.material.emissiveIntensity = 0; } });
  g.add(s);
  const crate = mesh(new THREE.BoxGeometry(1.4, 0.9, 1), mat('#5a6b5f')); crate.position.set(2.5, 0.3, 1); crate.rotation.y = 0.5; g.add(crate);
  const cellM = new THREE.MeshStandardMaterial({ color: '#7ff6ff', emissive: '#3fe0ff', emissiveIntensity: 2.5 });
  const cell = mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.8, 8), cellM, false);
  cell.position.set(2.5, 1.2, 1); cell.rotation.z = Math.PI / 2; g.add(cell);
  g.userData = { cell };
  return g;
}

export function createLift() {
  const g = new THREE.Group();
  const hull = mesh(new THREE.CylinderGeometry(3, 5, 4, 8), mat('#d8d2c4', { metalness: 0.4, roughness: 0.4 }));
  g.add(hull);
  const top = mesh(new THREE.ConeGeometry(3, 3, 8), mat('#c2452d')); top.position.y = 3.5; g.add(top);
  const glowM = new THREE.MeshStandardMaterial({ color: '#7ff6ff', emissive: '#3fe0ff', emissiveIntensity: 3 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const pod = mesh(new THREE.CylinderGeometry(0.8, 1, 2, 8), mat('#3b3633'));
    pod.position.set(Math.cos(a) * 5.5, -1, Math.sin(a) * 5.5); g.add(pod);
    const jet = mesh(new THREE.CylinderGeometry(0.7, 0.3, 0.4, 8), glowM, false);
    jet.position.set(Math.cos(a) * 5.5, -2.2, Math.sin(a) * 5.5); g.add(jet);
    const arm = mesh(new THREE.BoxGeometry(5, 0.4, 0.8), mat('#3b3633'));
    arm.position.set(Math.cos(a) * 3.5, -0.5, Math.sin(a) * 3.5); arm.rotation.y = -a; g.add(arm);
  }
  return g;
}
