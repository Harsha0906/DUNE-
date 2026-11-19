import * as THREE from 'three';
import { createVeilRay } from './models.js';
import { heightAt, isRock, PLAY_LIMIT } from './terrain.js';
import { clamp } from './noise.js';

const tmp = new THREE.Vector3();

/**
 * The Veil Ray: a vast ray that swims beneath the sand and hunts by vibration.
 * States: roam -> hunt -> warn -> breach -> dive -> roam
 */
export class Creature {
  constructor(scene, particles, audio) {
    this.mesh = createVeilRay();
    this.mesh.scale.setScalar(1);
    scene.add(this.mesh);
    this.particles = particles;
    this.audio = audio;
    this.ud = this.mesh.userData;
    this.hull = this.ud.body.children.filter((c) => !this.ud.spines.includes(c));
    this.reset();
  }

  reset() {
    this.pos = new THREE.Vector2(-420, 320);
    this.heading = 0.3;
    this.speed = 10;
    this.state = 'roam';
    this.stateTime = 0;
    this.interest = 0;
    this.source = null;
    this.sourceAge = 99;
    this.target = new THREE.Vector2();
    this.strike = new THREE.Vector2();
    this.breachDir = new THREE.Vector2(1, 0);
    this.cooldown = 0;
    this.wanderT = 0;
    this.time = 0;
    this.heardFlash = 0;
    this.struck = false;
    this.landed = false;
    this.setSubmerged(true);
  }

  setSubmerged(sub) {
    this.submerged = sub;
    for (const c of this.hull) c.visible = !sub;
  }

  /** Called every frame for every vibration source. level ~ 0..1.2 */
  hear(source, x, z, level, dt, storm) {
    if (this.cooldown > 0 || this.state === 'breach' || this.state === 'warn') return;
    const range = 320 * level * (1 - storm * 0.55);
    const d = Math.hypot(x - this.pos.x, z - this.pos.y);
    if (d > range) return;
    const strength = level * Math.sqrt(1 - d / range);
    this.interest = Math.min(1.5, this.interest + strength * dt * 2);
    const cur = this.source && this.sourceAge < 0.5 ? this.sourceStrength : 0;
    if (strength >= cur * 0.9 || this.source === source) {
      this.source = source; this.sourceStrength = strength; this.sourceAge = 0;
      const err = (d / 40) * (0.5 + storm * 2.2);
      this.target.set(x + (Math.random() - 0.5) * err, z + (Math.random() - 0.5) * err);
      this.sourceLevel = level;
    }
    if (this.state === 'roam' && this.interest > 0.35) {
      this.setState('hunt');
      this.heardFlash = 1;
      this.audio.alert();
    }
  }

  setState(s) { this.state = s; this.stateTime = 0; }

  get distanceTo() { return this._dist ?? 999; }

  steer(dx, dz, rate, dt) {
    const want = Math.atan2(dx, dz);
    let diff = want - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.heading += clamp(diff, -rate * dt, rate * dt);
  }

  moveForward(dt) {
    const sx = Math.sin(this.heading), sz = Math.cos(this.heading);
    let nx = this.pos.x + sx * this.speed * dt, nz = this.pos.y + sz * this.speed * dt;
    // cannot swim through rock: slide around it
    const look = 14;
    if (isRock(this.pos.x + sx * look, this.pos.y + sz * look)) {
      const left = !isRock(this.pos.x + Math.sin(this.heading + 0.9) * look, this.pos.y + Math.cos(this.heading + 0.9) * look);
      this.heading += (left ? 1 : -1) * 2.4 * dt;
      if (isRock(nx, nz)) return;
    }
    nx = clamp(nx, -PLAY_LIMIT, PLAY_LIMIT); nz = clamp(nz, -PLAY_LIMIT, PLAY_LIMIT);
    this.pos.set(nx, nz);
  }

  /**
   * ctx: { player: Vector3, playerOnRock, storm, onStrike(point, radius), sources }
   */
  update(dt, ctx) {
    this.time += dt;
    this.stateTime += dt;
    this.sourceAge += dt;
    this.heardFlash = Math.max(0, this.heardFlash - dt);
    if (this.cooldown > 0) this.cooldown -= dt;
    this.interest = Math.max(0, this.interest - dt * 0.06);
    const p = ctx.player;
    this._dist = Math.hypot(p.x - this.pos.x, p.z - this.pos.y);

    switch (this.state) {
      case 'roam': {
        this.speed += (10 - this.speed) * dt;
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = 4 + Math.random() * 6;
          // drift loosely toward the player's region so the world never feels empty
          const toP = Math.atan2(p.x - this.pos.x, p.z - this.pos.y);
          this.wanderHeading = this._dist > 350 ? toP + (Math.random() - 0.5) * 1.2 : this.heading + (Math.random() - 0.5) * 2.4;
        }
        if (Math.abs(this.pos.x) > PLAY_LIMIT - 40 || Math.abs(this.pos.y) > PLAY_LIMIT - 40) this.wanderHeading = Math.atan2(-this.pos.x, -this.pos.y);
        this.steer(Math.sin(this.wanderHeading), Math.cos(this.wanderHeading), 0.5, dt);
        this.moveForward(dt);
        break;
      }
      case 'hunt': {
        const fast = this.sourceLevel > 0.9 ? 27 : 19;
        this.speed += (fast - this.speed) * dt * 0.8;
        const dx = this.target.x - this.pos.x, dz = this.target.y - this.pos.y;
        const d = Math.hypot(dx, dz);
        this.steer(dx, dz, 1.6, dt);
        this.moveForward(dt);
        const src = this.source;
        if (src && this.sourceAge < 1.2 && d < 16) {
          const sp = src.position;
          if (!isRock(sp.x, sp.z)) {
            const lead = src.velocity ? 0.45 : 0;
            this.strike.set(sp.x + (src.velocity?.x ?? 0) * lead, sp.z + (src.velocity?.z ?? 0) * lead);
            this.setState('warn');
            this.audio.roar();
            break;
          }
        }
        if (this.sourceAge > 9 || this.interest < 0.05) { this.setState('roam'); this.interest = 0; }
        break;
      }
      case 'warn': {
        // slide beneath the strike point; the ground boils
        this.speed = 0;
        this.pos.lerp(this.strike, Math.min(1, dt * 4));
        if (Math.random() < 0.9) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * 9;
          const x = this.strike.x + Math.cos(a) * r, z = this.strike.y + Math.sin(a) * r;
          this.particles.emit(x, heightAt(x, z), z, (Math.random() - 0.5) * 2, 5 + Math.random() * 6, (Math.random() - 0.5) * 2, { life: 1.1, size: 1.6, gravity: -14 });
        }
        if (this.stateTime > 1.15) {
          this.setState('breach');
          this.struck = false; this.landed = false;
          const a = Math.random() * Math.PI * 2;
          this.breachDir.set(Math.sin(a), Math.cos(a));
          this.heading = a;
          this.setSubmerged(false);
          this.audio.breach();
        }
        break;
      }
      case 'breach': {
        const T = 3.0;
        const t = this.stateTime / T;
        if (!this.struck && t > 0.05) {
          this.struck = true;
          const gy = heightAt(this.strike.x, this.strike.y);
          this.particles.burst(this.strike.x, gy + 1, this.strike.y, 260, 18, { life: 2.6, size: 3.2, gravity: -12, drag: 0.6, alpha: 0.9 });
          this.particles.burst(this.strike.x, gy + 1, this.strike.y, 80, 8, { life: 4, size: 7, gravity: -1, drag: 0.4, alpha: 0.45, color: '#c99a68' });
          ctx.onStrike(this.strike, 10);
        }
        if (!this.landed && t > 0.86) {
          this.landed = true;
          const lx = this.strike.x + this.breachDir.x * 30, lz = this.strike.y + this.breachDir.y * 30;
          this.particles.burst(lx, heightAt(lx, lz) + 1, lz, 200, 16, { life: 2.2, size: 3.5, gravity: -12, drag: 0.6 });
          this.audio.noiseBurst({ freq: 150, type: 'lowpass', vol: 0.6, dur: 1.6 });
          ctx.onSlam?.(lx, lz);
        }
        if (t >= 1) {
          this.setState('dive');
          this.setSubmerged(true);
          this.cooldown = 7;
          this.interest = 0; this.source = null;
          this.pos.set(this.strike.x + this.breachDir.x * 34, this.strike.y + this.breachDir.y * 34);
          this.heading = Math.atan2(this.breachDir.x, this.breachDir.y);
        }
        break;
      }
      case 'dive': {
        this.speed = 14;
        this.moveForward(dt);
        if (this.stateTime > 6) this.setState('roam');
        break;
      }
    }

    this.updateVisual(dt);
  }

  updateVisual(dt) {
    const m = this.mesh;
    const ud = this.ud;
    if (this.state === 'breach') {
      const t = Math.min(1, this.stateTime / 3.0);
      const along = -6 + t * 36;
      const x = this.strike.x + this.breachDir.x * along;
      const z = this.strike.y + this.breachDir.y * along;
      const g = heightAt(x, z);
      const arc = Math.sin(Math.min(1, t * 1.08) * Math.PI);
      m.position.set(x, g - 8 + arc * 30, z);
      m.rotation.set(0, 0, 0);
      m.rotation.y = this.heading;
      // nose up as it erupts, then rolls over and dives
      m.rotateX(-(1.1 - t * 2.4));
      m.rotateZ(Math.sin(t * Math.PI) * 0.35);
      // wings flap
      ud.body.scale.set(1, 1 + Math.sin(t * 9) * 0.06, 1);
      ud.markM.emissiveIntensity = 3;
    } else {
      const g = heightAt(this.pos.x, this.pos.y);
      const ahead = heightAt(this.pos.x + Math.sin(this.heading) * 8, this.pos.y + Math.cos(this.heading) * 8);
      const depth = this.state === 'dive' ? 5.5 + Math.min(this.stateTime, 2) : this.state === 'warn' ? 2.6 : this.state === 'hunt' ? 2.4 : 3.2;
      m.position.set(this.pos.x, g - depth, this.pos.y);
      m.rotation.set(0, 0, 0);
      m.rotation.y = this.heading;
      m.rotateX(-Math.atan2(ahead - g, 8));
      ud.markM.emissiveIntensity = 1.2 + Math.sin(this.time * 3) * 0.4;
      // sand wake off the spines
      if (this.speed > 2) {
        const n = this.speed > 15 ? 3 : 1;
        for (let k = 0; k < n; k++) {
          const off = -Math.random() * 18;
          const x = this.pos.x + Math.sin(this.heading) * off, z = this.pos.y + Math.cos(this.heading) * off;
          const side = (Math.random() - 0.5) * 2;
          this.particles.emit(x + Math.cos(this.heading) * side, heightAt(x, z) + 0.3, z - Math.sin(this.heading) * side,
            Math.cos(this.heading) * side * 3, 2 + Math.random() * 3, -Math.sin(this.heading) * side * 3,
            { life: 1.2, size: 1.2 + this.speed * 0.05, gravity: -8, alpha: 0.7 });
        }
      }
    }
    ud.tailSegs.forEach((s, i) => { s.rotation.y = Math.sin(this.time * 2.2 - i * 0.6) * 0.18; s.rotation.x = Math.sin(this.time * 1.5 - i * 0.5) * 0.05; });
  }

  /** 0..1 how threatening the creature currently is to the player. */
  danger() {
    if (this.state === 'warn' || this.state === 'breach') return 1;
    if (this.state === 'hunt') return clamp(1 - this._dist / 260, 0.25, 1);
    return clamp(1 - this._dist / 200, 0, 0.4);
  }

  rumble() {
    const prox = clamp(1 - this._dist / 220, 0, 1);
    if (this.state === 'warn') return 1;
    if (this.state === 'breach') return 0.7;
    return prox * (this.state === 'hunt' ? 0.8 : 0.35) * Math.min(1, this.speed / 10);
  }
}
