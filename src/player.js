import * as THREE from 'three';
import { createWanderer, createSkimmer } from './models.js';
import { heightAt, normalAt, isRock, PLAY_LIMIT } from './terrain.js';
import { clamp } from './noise.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpN = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();

export class Player {
  constructor(scene, particles, audio) {
    this.mesh = createWanderer();
    scene.add(this.mesh);
    this.particles = particles;
    this.audio = audio;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.reset(0, 0);
  }

  reset(x, z) {
    this.position.set(x, heightAt(x, z), z);
    this.velocity.set(0, 0, 0);
    this.facing = Math.PI;
    this.vy = 0;
    this.grounded = true;
    this.crouch = false;
    this.sprinting = false;
    this.phase = 0;
    this.noise = 0;
    this.landPulse = 0;
    this.stepAcc = 0;
    this.mesh.visible = true;
    this.distance = 0;
  }

  get onRock() { return isRock(this.position.x, this.position.z); }

  update(dt, input, camYaw, enabled = true) {
    const f = enabled ? (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0) : 0;
    const s = enabled ? (input.down('KeyD', 'ArrowRight') ? 1 : 0) - (input.down('KeyA', 'ArrowLeft') ? 1 : 0) : 0;
    this.crouch = enabled && input.down('KeyC', 'ControlLeft');
    this.sprinting = enabled && input.down('ShiftLeft', 'ShiftRight') && !this.crouch && f > 0;
    const moving = f !== 0 || s !== 0;

    const fwd = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(right, s);
    if (wish.lengthSq() > 0) wish.normalize();

    let speed = this.crouch ? 2.4 : this.sprinting ? 9.5 : 5.2;
    // loose sand is slow uphill
    const n = normalAt(this.position.x, this.position.z, tmpN);
    const uphill = -(n.x * wish.x + n.z * wish.z);
    if (!this.onRock) speed *= clamp(1 - uphill * 1.3, 0.55, 1.1);

    const target = wish.multiplyScalar(speed);
    const accel = this.grounded ? 12 : 3;
    this.velocity.x += (target.x - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (target.z - this.velocity.z) * Math.min(1, accel * dt);

    if (enabled && this.grounded && input.hit('Space')) {
      this.vy = 6.8; this.grounded = false; this.audio.jump();
    }
    this.vy -= 20 * dt;

    const nx = clamp(this.position.x + this.velocity.x * dt, -PLAY_LIMIT, PLAY_LIMIT);
    const nz = clamp(this.position.z + this.velocity.z * dt, -PLAY_LIMIT, PLAY_LIMIT);
    // block climbing sheer cliffs
    const hNow = heightAt(this.position.x, this.position.z);
    const hNext = heightAt(nx, nz);
    const step = Math.hypot(nx - this.position.x, nz - this.position.z);
    if (this.grounded && step > 0 && (hNext - hNow) / step > 1.6) {
      this.velocity.x *= -0.2; this.velocity.z *= -0.2;
    } else {
      this.distance += step;
      this.position.x = nx; this.position.z = nz;
    }
    this.position.y += this.vy * dt;
    const g = heightAt(this.position.x, this.position.z);
    if (this.position.y <= g) {
      if (!this.grounded && this.vy < -6) { this.landPulse = 0.35; this.audio.footstep(false); this.puff(6); }
      this.position.y = g; this.vy = 0; this.grounded = true;
    } else if (this.position.y > g + 0.3) {
      this.grounded = false;
    } else if (this.grounded) {
      this.position.y = g;
    }

    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    if (hs > 0.5) this.facing = lerpAngle(this.facing, Math.atan2(this.velocity.x, this.velocity.z), Math.min(1, dt * 10));

    // vibration this frame
    this.landPulse = Math.max(0, this.landPulse - dt);
    let noise = 0;
    if (this.grounded && hs > 0.5) noise = this.crouch ? 0.08 : this.sprinting ? 0.62 : 0.3;
    if (this.landPulse > 0) noise = Math.max(noise, 0.55);
    this.noise = this.onRock ? 0 : noise;

    // footsteps + animation
    if (this.grounded && hs > 0.5) {
      this.phase += dt * hs * 1.5;
      this.stepAcc += dt * hs;
      const stride = this.sprinting ? 2.4 : 1.6;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        this.audio.footstep(this.crouch);
        if (!this.onRock) this.puff(this.sprinting ? 4 : 1);
      }
    } else {
      this.phase += (Math.round(this.phase / Math.PI) * Math.PI - this.phase) * Math.min(1, dt * 8);
    }
    this.animate(dt, hs, moving);
  }

  puff(n) {
    for (let i = 0; i < n; i++) {
      this.particles.emit(this.position.x + (Math.random() - 0.5) * 0.4, this.position.y + 0.1, this.position.z + (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.2, (Math.random() - 0.5) * 2,
        { life: 0.9, size: 0.5, gravity: -2, alpha: 0.5 });
    }
  }

  animate(dt, hs, moving) {
    const u = this.mesh.userData;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.facing;
    const swing = Math.sin(this.phase) * Math.min(1, hs / 5) * (this.sprinting ? 0.9 : 0.6);
    u.legL.rotation.x = swing; u.legR.rotation.x = -swing;
    u.armL.rotation.x = -swing * 0.8; u.armR.rotation.x = swing * 0.8;
    const crouchAmt = this.crouch ? 1 : 0;
    u.body.position.y += ((crouchAmt ? -0.35 : 0) + Math.abs(Math.sin(this.phase)) * 0.05 * Math.min(1, hs / 4) - u.body.position.y) * Math.min(1, dt * 10);
    u.body.rotation.x = (this.sprinting ? 0.25 : 0) + crouchAmt * 0.35;
    if (!this.grounded) { u.legL.rotation.x = -0.6; u.legR.rotation.x = 0.3; }
    const t = performance.now() * 0.001;
    u.scarf.forEach((s, i) => {
      s.rotation.x = 0.25 + Math.sin(t * 6 + i) * 0.25 + Math.min(hs, 9) * 0.03;
      s.rotation.y = Math.sin(t * 4.3 + i * 0.7) * 0.3;
    });
  }
}

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
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
    this.reset(8, 10, 0);
  }

  reset(x, z, yaw) {
    this.position.set(x, heightAt(x, z) + 1.0, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.driven = false;
    this.noise = 0;
    this.boosting = false;
    this.destroyed = false;
    this.mesh.visible = true;
    this.hover = 0;
  }

  get speed() { return Math.hypot(this.velocity.x, this.velocity.z); }

  update(dt, input, enabled) {
    if (this.destroyed) return;
    const drive = this.driven && enabled;
    const throttle = drive ? (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 0.6 : 0) : 0;
    const steer = drive ? (input.down('KeyA', 'ArrowLeft') ? 1 : 0) - (input.down('KeyD', 'ArrowRight') ? 1 : 0) : 0;
    this.boosting = drive && input.down('ShiftLeft', 'ShiftRight') && throttle > 0;
    const maxSpeed = this.boosting ? 44 : 30;

    const sp = this.speed;
    this.yaw += steer * dt * (1.9 - Math.min(sp, 40) * 0.02);
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    this.velocity.addScaledVector(fwd, throttle * (this.boosting ? 34 : 22) * dt);
    // lateral grip + drag
    const lat = this.velocity.dot(right);
    this.velocity.addScaledVector(right, -lat * Math.min(1, dt * 3));
    this.velocity.multiplyScalar(Math.exp(-dt * (throttle ? 0.25 : 0.9)));
    if (this.speed > maxSpeed) this.velocity.multiplyScalar(maxSpeed / this.speed);

    let nx = this.position.x + this.velocity.x * dt;
    let nz = this.position.z + this.velocity.z * dt;
    if (Math.abs(nx) > PLAY_LIMIT || Math.abs(nz) > PLAY_LIMIT) { this.velocity.multiplyScalar(-0.3); nx = clamp(nx, -PLAY_LIMIT, PLAY_LIMIT); nz = clamp(nz, -PLAY_LIMIT, PLAY_LIMIT); }
    const g0 = heightAt(this.position.x, this.position.z);
    const g1 = heightAt(nx, nz);
    const step = Math.hypot(nx - this.position.x, nz - this.position.z);
    if (step > 0 && (g1 - g0) / step > 1.4) {
      // slammed into a cliff
      if (sp > 12) { this.audio.hurt(); this.onCrash?.(sp); }
      this.velocity.multiplyScalar(-0.35);
    } else {
      this.position.x = nx; this.position.z = nz;
    }
    const g = Math.max(heightAt(this.position.x, this.position.z),
      heightAt(this.position.x + fwd.x * 2.5, this.position.z + fwd.z * 2.5) - 0.3);
    this.hover += dt;
    const targetY = g + 1.1 + Math.sin(this.hover * 3) * 0.08;
    this.position.y += (targetY - this.position.y) * Math.min(1, dt * 10);
    if (this.position.y < g + 0.6) this.position.y = g + 0.6;

    // orient to the ground with a little bank into turns
    const n = normalAt(this.position.x, this.position.z, tmpN);
    tmpQ.setFromUnitVectors(UP, n);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(UP, this.yaw);
    const bank = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -steer * Math.min(sp / 30, 1) * 0.35);
    const target = tmpQ.multiply(yawQ).multiply(bank);
    this.quat.slerp(target, Math.min(1, dt * 6));
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.quat);

    this.noise = this.driven ? 0.45 + Math.min(1, this.speed / 30) * 0.5 + (this.boosting ? 0.2 : 0) : 0;
    if (isRock(this.position.x, this.position.z)) this.noise = 0;

    if (this.driven && this.speed > 4) {
      const n2 = this.speed > 20 ? 3 : 1;
      for (let i = 0; i < n2; i++) {
        const back = this.position.clone().addScaledVector(fwd, -2).add(new THREE.Vector3((Math.random() - 0.5) * 2.5, -0.9, (Math.random() - 0.5) * 2.5));
        this.particles.emit(back.x, back.y, back.z, -fwd.x * 3 + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 2, -fwd.z * 3 + (Math.random() - 0.5) * 3,
          { life: 1.4, size: 1.1, gravity: -3, alpha: 0.5 });
      }
    }
  }
}

export { tmpM };
