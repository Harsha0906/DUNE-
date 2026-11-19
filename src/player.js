import * as THREE from 'three';
import { createWanderer, createSkimmer } from './models.js';
import { heightAt, normalAt, isRock, PLAY_LIMIT } from './terrain.js';
import { clamp } from './noise.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpN = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

export class Player {
  constructor(scene, particles, audio) {
    this.mesh = createWanderer();
    scene.add(this.mesh);
    this.particles = particles;
    this.audio = audio;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.stats = { speed: 1, noise: 1 };
    this.reset(0, 0);
  }

  reset(x, z) {
    this.position.set(x, heightAt(x, z), z);
    this.velocity.set(0, 0, 0);
    this.facing = Math.PI;
    this.vy = 0;
    this.grounded = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.crouch = false;
    this.sprinting = false;
    this.sliding = false;
    this.phase = 0;
    this.noise = 0;
    this.landPulse = 0;
    this.stepAcc = 0;
    this.stepSide = 1;
    this.lean = 0;
    this.squash = 0;
    this.mesh.visible = true;
    this.mesh.rotation.set(0, 0, 0);
    this.distance = this.distance || 0;
  }

  get onRock() { return isRock(this.position.x, this.position.z); }

  update(dt, input, camYaw, enabled = true) {
    const mv = enabled ? input.move() : { x: 0, y: 0 };
    this.crouch = enabled && input.down('KeyC', 'ControlLeft');
    this.sprinting = enabled && input.down('ShiftLeft', 'ShiftRight') && !this.crouch && mv.y > 0.3;
    const fwd = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3().addScaledVector(fwd, mv.y).addScaledVector(right, mv.x);
    const wishLen = Math.min(1, wish.length());
    if (wishLen > 0) wish.normalize();

    let speed = (this.crouch ? 2.4 : this.sprinting ? 9.5 : 5.2) * this.stats.speed * wishLen;
    const n = normalAt(this.position.x, this.position.z, tmpN);
    const onRock = this.onRock;
    const uphill = -(n.x * wish.x + n.z * wish.z);
    if (!onRock) speed *= clamp(1 - uphill * 1.3, 0.55, 1.12);

    // steep loose sand gives way under you
    this.sliding = this.grounded && !onRock && n.y < 0.8;
    const target = wish.multiplyScalar(speed);
    if (this.sliding) {
      const k = (0.8 - n.y) * 40;
      target.x += n.x * k; target.z += n.z * k;
      if (Math.random() < dt * 30) this.puff(1);
    }
    const accel = this.grounded ? (speed > 0.1 ? 11 : 14) : 2.5;
    this.velocity.x += (target.x - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (target.z - this.velocity.z) * Math.min(1, accel * dt);

    // forgiving jumps: coyote time and a jump buffer
    this.coyote = this.grounded ? 0.14 : Math.max(0, this.coyote - dt);
    this.jumpBuffer = enabled && input.hit('Space') ? 0.15 : Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vy = 7; this.grounded = false; this.coyote = 0; this.jumpBuffer = 0;
      this.audio.jump(); this.squash = -0.15;
    }
    this.vy -= (this.vy > 0 && enabled && input.down('Space') ? 17 : 24) * dt;

    const nx = clamp(this.position.x + this.velocity.x * dt, -PLAY_LIMIT, PLAY_LIMIT);
    const nz = clamp(this.position.z + this.velocity.z * dt, -PLAY_LIMIT, PLAY_LIMIT);
    const hNow = heightAt(this.position.x, this.position.z);
    const hNext = heightAt(nx, nz);
    const step = Math.hypot(nx - this.position.x, nz - this.position.z);
    if (step > 0 && (hNext - hNow) / step > 1.6 && hNext > this.position.y + 0.4) {
      this.velocity.x *= -0.2; this.velocity.z *= -0.2;
    } else {
      this.distance += step;
      this.position.x = nx; this.position.z = nz;
    }
    this.position.y += this.vy * dt;
    const g = heightAt(this.position.x, this.position.z);
    if (this.position.y <= g) {
      if (!this.grounded) {
        const impact = -this.vy;
        if (impact > 5) {
          this.landPulse = 0.35; this.audio.footstep(false); this.puff(Math.min(14, impact));
          this.squash = Math.min(0.3, impact * 0.025);
          this.onLand?.(impact);
        }
      }
      this.position.y = g; this.vy = 0; this.grounded = true;
    } else if (this.position.y > g + 0.35) {
      this.grounded = false;
    } else if (this.grounded && this.vy <= 0) {
      this.position.y = g; this.vy = 0;
    }

    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    const prevFacing = this.facing;
    if (hs > 0.5 && !this.sliding) this.facing = lerpAngle(this.facing, Math.atan2(this.velocity.x, this.velocity.z), Math.min(1, dt * 12));
    const turnRate = Math.atan2(Math.sin(this.facing - prevFacing), Math.cos(this.facing - prevFacing)) / Math.max(dt, 1e-4);
    this.lean += (clamp(-turnRate * hs * 0.012, -0.3, 0.3) - this.lean) * Math.min(1, dt * 8);

    // vibration this frame
    this.landPulse = Math.max(0, this.landPulse - dt);
    let noise = 0;
    if (this.grounded && hs > 0.5) noise = this.crouch ? 0.08 : this.sprinting ? 0.62 : 0.3;
    if (this.sliding) noise = Math.max(noise, 0.4);
    if (this.landPulse > 0) noise = Math.max(noise, 0.55);
    this.noise = onRock ? 0 : noise * this.stats.noise;

    // footsteps + tracks
    if (this.grounded && hs > 0.5) {
      this.phase += dt * hs * 1.5;
      this.stepAcc += dt * hs;
      const stride = this.sprinting ? 1.25 : 0.85;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        this.stepSide *= -1;
        this.audio.footstep(this.crouch, onRock);
        if (!onRock) {
          this.puff(this.sprinting ? 3 : 1);
          this.onStep?.(this.position.x, this.position.z, this.facing, this.stepSide);
        }
      }
    } else {
      this.phase += (Math.round(this.phase / Math.PI) * Math.PI - this.phase) * Math.min(1, dt * 8);
    }
    this.animate(dt, hs);
  }

  puff(n) {
    for (let i = 0; i < n; i++) {
      this.particles.emit(this.position.x + (Math.random() - 0.5) * 0.4, this.position.y + 0.1, this.position.z + (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 2.5, 0.8 + Math.random() * 1.4, (Math.random() - 0.5) * 2.5,
        { life: 0.9, size: 0.5, gravity: -2, alpha: 0.5 });
    }
  }

  animate(dt, hs) {
    const u = this.mesh.userData;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.set(0, this.facing, 0);
    this.mesh.rotateZ(this.lean);
    const swing = Math.sin(this.phase) * Math.min(1, hs / 5) * (this.sprinting ? 0.95 : 0.6);
    u.legL.rotation.x = swing; u.legR.rotation.x = -swing;
    u.armL.rotation.x = -swing * 0.8; u.armR.rotation.x = swing * 0.8;
    const crouchAmt = this.crouch ? 1 : 0;
    this.squash += (0 - this.squash) * Math.min(1, dt * 10);
    u.body.scale.set(1 + this.squash * 0.5, 1 - this.squash, 1 + this.squash * 0.5);
    u.body.position.y += ((crouchAmt ? -0.35 : 0) + Math.abs(Math.sin(this.phase)) * 0.06 * Math.min(1, hs / 4) - u.body.position.y) * Math.min(1, dt * 10);
    u.body.rotation.x = (this.sprinting ? 0.28 : 0) + crouchAmt * 0.35 + (this.sliding ? -0.3 : 0);
    if (!this.grounded) { u.legL.rotation.x = -0.7; u.legR.rotation.x = 0.35; u.armL.rotation.x = u.armR.rotation.x = -0.8; }
    if (this.sliding) { u.armL.rotation.z = 0.9; u.armR.rotation.z = -0.9; } else { u.armL.rotation.z = u.armR.rotation.z = 0; }
    const t = performance.now() * 0.001;
    u.scarf.forEach((s, i) => {
      s.rotation.x = 0.25 + Math.sin(t * 6 + i) * 0.25 + Math.min(hs, 9) * 0.04;
      s.rotation.y = Math.sin(t * 4.3 + i * 0.7) * 0.3;
    });
    if (u.tail) u.tail.rotation.x = 0.1 + Math.min(hs, 9) * 0.06 + Math.abs(swing) * 0.15 + Math.sin(t * 3) * 0.04 + (this.grounded ? 0 : 0.5);
  }
}

export class Skimmer {
  constructor(scene, particles, audio) {
    this.mesh = createSkimmer();
    scene.add(this.mesh);
    this.particles = particles;
    this.audio = audio;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.stats = { noise: 1, speed: 1 };
    this.reset(8, 10, 0);
  }

  reset(x, z, yaw) {
    this.position.set(x, heightAt(x, z) + 1.0, z);
    this.velocity.set(0, 0, 0);
    this.vy = 0;
    this.yaw = yaw;
    this.driven = false;
    this.noise = 0;
    this.boosting = false;
    this.drifting = false;
    this.boostEnergy = 1;
    this.destroyed = false;
    this.grounded = true;
    this.airTime = 0;
    this.mesh.visible = true;
    this.hover = 0;
    this.steerSm = 0;
    this.quat.identity();
  }

  get speed() { return Math.hypot(this.velocity.x, this.velocity.z); }

  update(dt, input, enabled) {
    if (this.destroyed) return;
    const drive = this.driven && enabled;
    const mv = drive ? input.move() : { x: 0, y: 0 };
    const throttle = mv.y > 0 ? mv.y : mv.y * 0.6;
    this.steerSm += (-mv.x - this.steerSm) * Math.min(1, dt * 8);
    const steer = this.steerSm;
    this.drifting = drive && input.down('Space') && this.speed > 8;
    const wantBoost = drive && input.down('ShiftLeft', 'ShiftRight') && throttle > 0;
    this.boosting = wantBoost && this.boostEnergy > 0.02;
    this.boostEnergy = clamp(this.boostEnergy + (this.boosting ? -0.28 : 0.12) * dt, 0, 1);
    const maxSpeed = (this.boosting ? 46 : 31) * this.stats.speed;

    const sp = this.speed;
    const turn = (this.drifting ? 2.6 : 1.9) - Math.min(sp, 40) * 0.018;
    if (this.grounded || this.airTime < 0.25) this.yaw += steer * dt * turn * (throttle < 0 ? -1 : 1);
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    if (this.grounded) this.velocity.addScaledVector(fwd, throttle * (this.boosting ? 36 : 22) * dt);
    // grip: strong normally, loose while drifting so the tail swings out
    const lat = this.velocity.dot(right);
    const grip = this.grounded ? (this.drifting ? 0.9 : 3.2) : 0.15;
    this.velocity.addScaledVector(right, -lat * Math.min(1, dt * grip));
    this.velocity.multiplyScalar(Math.exp(-dt * (this.grounded ? (throttle ? 0.22 : 0.85) : 0.05)));
    if (this.speed > maxSpeed) this.velocity.multiplyScalar(1 - Math.min(1, dt * 2) * (1 - maxSpeed / this.speed));

    let nx = this.position.x + this.velocity.x * dt;
    let nz = this.position.z + this.velocity.z * dt;
    if (Math.abs(nx) > PLAY_LIMIT || Math.abs(nz) > PLAY_LIMIT) { this.velocity.multiplyScalar(-0.3); nx = clamp(nx, -PLAY_LIMIT, PLAY_LIMIT); nz = clamp(nz, -PLAY_LIMIT, PLAY_LIMIT); }
    const g1 = heightAt(nx, nz);
    const step = Math.hypot(nx - this.position.x, nz - this.position.z);
    if (step > 0 && g1 > this.position.y + 0.4 && (g1 - heightAt(this.position.x, this.position.z)) / step > 1.4) {
      if (sp > 12) { this.audio.hurt(); this.onCrash?.(sp); }
      this.velocity.multiplyScalar(-0.35);
    } else {
      this.position.x = nx; this.position.z = nz;
    }

    // hover spring vs. ballistic flight off dune crests
    const g = heightAt(this.position.x, this.position.z);
    this.hover += dt;
    const rest = g + 1.1 + Math.sin(this.hover * 3) * 0.06;
    const gap = this.position.y - rest;
    if (gap < 1.2) {
      const wasAir = !this.grounded;
      this.vy += (-gap * 60 - this.vy * 9) * dt;
      if (wasAir && this.airTime > 0.35) {
        const impact = Math.abs(this.vy) + this.airTime * 8;
        this.onLand?.(impact);
        this.audio.noiseBurst({ freq: 300, type: 'lowpass', vol: Math.min(0.5, impact * 0.03), dur: 0.4 });
        for (let i = 0; i < 24; i++) this.particles.emit(this.position.x + (Math.random() - 0.5) * 4, g + 0.2, this.position.z + (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 9, 2 + Math.random() * 4, (Math.random() - 0.5) * 9, { life: 1.4, size: 1.4, gravity: -6, alpha: 0.6 });
      }
      this.grounded = true; this.airTime = 0;
    } else {
      this.vy -= 26 * dt;
      this.grounded = false; this.airTime += dt;
    }
    this.position.y += this.vy * dt;
    if (this.position.y < g + 0.5) { this.position.y = g + 0.5; if (this.vy < 0) this.vy = 0; }

    // orient: ground normal when hovering, velocity pitch in the air, bank into turns
    const n = normalAt(this.position.x, this.position.z, tmpN);
    if (this.grounded) tmpQ.setFromUnitVectors(UP, n);
    else tmpQ.setFromAxisAngle(right, clamp(-this.vy * 0.03, -0.5, 0.5));
    const yawQ = new THREE.Quaternion().setFromAxisAngle(UP, this.yaw);
    const bankAmt = steer * Math.min(sp / 30, 1) * (this.drifting ? 0.55 : 0.38);
    const bank = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -bankAmt);
    const pitchUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -throttle * 0.05 * (this.boosting ? 2 : 1));
    const target = tmpQ.multiply(yawQ).multiply(bank).multiply(pitchUp);
    this.quat.slerp(target, Math.min(1, dt * 7));
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.quat);

    this.noise = this.driven ? (0.45 + Math.min(1, this.speed / 30) * 0.5 + (this.boosting ? 0.2 : 0)) * this.stats.noise : 0;
    if (!this.grounded || isRock(this.position.x, this.position.z)) this.noise *= this.grounded ? 0 : 0.3;

    if (this.driven && this.grounded && this.speed > 4) {
      const n2 = this.speed > 20 ? 4 : 1;
      for (let i = 0; i < n2; i++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const back = this.position.clone().addScaledVector(fwd, -2).addScaledVector(right, side * 1.3);
        back.y = g + 0.2;
        const spray = this.drifting ? 8 : 3;
        this.particles.emit(back.x, back.y, back.z,
          -fwd.x * 3 + right.x * side * spray * Math.random(), 1.5 + Math.random() * (this.drifting ? 5 : 2), -fwd.z * 3 + right.z * side * spray * Math.random(),
          { life: 1.4, size: this.drifting ? 1.6 : 1.1, gravity: -4, alpha: 0.5 });
      }
    }
  }
}
