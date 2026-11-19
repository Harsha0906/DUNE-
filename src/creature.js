import * as THREE from 'three';
import { createVeilRay } from './models.js';
import { heightAt, isRock, PLAY_LIMIT } from './terrain.js';
import { clamp } from './noise.js';

/**
 * The Veil Ray: a vast ray that swims beneath the sand and hunts by vibration.
 *
 * roam    wanders, drifts toward the player's region, sometimes leaps far away
 * hunt    races to the loudest vibration it has heard
 * search  circles the last known spot in a widening spiral
 * lurk    goes silent and still near where you vanished, waiting for one more sound
 * warn    the sand boils and sinks into a funnel: run
 * breach  erupts, arcs through the air and slams back down
 * dive    sinks away and loses interest for a while
 */
export class Creature {
  constructor(scene, particles, audio) {
    this.scene = scene;
    this.mesh = createVeilRay();
    scene.add(this.mesh);
    this.particles = particles;
    this.audio = audio;
    this.ud = this.mesh.userData;
    this.hull = this.ud.body.children.filter((c) => !this.ud.spines.includes(c));

    // sinkhole funnel shown during the warning
    const funnelGeo = new THREE.ConeGeometry(11, 5, 24, 4, true);
    funnelGeo.rotateX(Math.PI);
    funnelGeo.translate(0, -2.5, 0);
    this.funnel = new THREE.Mesh(funnelGeo, new THREE.MeshStandardMaterial({ color: '#8a5a32', flatShading: true, roughness: 1, side: THREE.DoubleSide }));
    this.funnel.visible = false;
    scene.add(this.funnel);
    // shockwave ring at eruption
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color: '#ffe2b8', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    scene.add(this.ring);
    this.ringT = 99;
    // thrown rock debris
    this.debris = [];
    const dGeo = new THREE.DodecahedronGeometry(0.8, 0);
    const dMat = new THREE.MeshStandardMaterial({ color: '#6a4030', flatShading: true });
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(dGeo, dMat);
      m.castShadow = true; m.visible = false;
      scene.add(m);
      this.debris.push({ mesh: m, v: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }
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
    this.lastKnown = new THREE.Vector2();
    this.strike = new THREE.Vector2();
    this.breachDir = new THREE.Vector2(1, 0);
    this.cooldown = 0;
    this.wanderT = 0;
    this.time = 0;
    this.heardFlash = 0;
    this.struck = false;
    this.landed = false;
    this.display = false;
    this.displayTimer = 60 + Math.random() * 40;
    this.baited = 0;
    this.warnTime = 1.15;
    this.funnel.visible = false;
    for (const d of this.debris) { d.mesh.visible = false; d.life = 0; }
    this.setSubmerged(true);
  }

  setSubmerged(sub) {
    this.submerged = sub;
    for (const c of this.hull) c.visible = !sub;
  }

  /** Called every frame for every vibration source. level ~ 0..1.2 */
  hear(source, x, z, level, dt, storm, night = 0) {
    if (this.cooldown > 0 || this.state === 'breach' || this.state === 'warn' || this.state === 'dive') return;
    // once it has been fooled by stakes a few times it starts to doubt them
    if (source.kind === 'stake' && this.baited >= 2) level *= 0.55;
    const range = 320 * level * (1 - storm * 0.55) * (1 + night * 0.18);
    const d = Math.hypot(x - this.pos.x, z - this.pos.y);
    if (d > range) return;
    const strength = level * Math.sqrt(1 - d / range);
    this.interest = Math.min(1.5, this.interest + strength * dt * 2);
    const cur = this.source && this.sourceAge < 0.5 ? this.sourceStrength : 0;
    if (strength >= cur * 0.9 || this.source === source) {
      this.source = source; this.sourceStrength = strength; this.sourceAge = 0;
      const err = (d / 40) * (0.5 + storm * 2.2);
      this.target.set(x + (Math.random() - 0.5) * err, z + (Math.random() - 0.5) * err);
      this.lastKnown.set(x, z);
      this.sourceLevel = level;
    }
    if (this.state === 'lurk' && d < 45 && source.kind !== 'stake') {
      // ambush: it was waiting right here
      this.beginWarn(source, 0.75);
      return;
    }
    if ((this.state === 'roam' || this.state === 'search' || this.state === 'lurk') && this.interest > 0.35) {
      if (this.state === 'roam') { this.heardFlash = 1; this.audio.alert(); }
      this.setState('hunt');
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
    const look = 14;
    if (isRock(this.pos.x + sx * look, this.pos.y + sz * look)) {
      const left = !isRock(this.pos.x + Math.sin(this.heading + 0.9) * look, this.pos.y + Math.cos(this.heading + 0.9) * look);
      this.heading += (left ? 1 : -1) * 2.4 * dt;
      if (isRock(nx, nz)) return;
    }
    nx = clamp(nx, -PLAY_LIMIT, PLAY_LIMIT); nz = clamp(nz, -PLAY_LIMIT, PLAY_LIMIT);
    this.pos.set(nx, nz);
  }

  beginWarn(src, warnTime = 1.15) {
    const sp = src.position;
    const lead = src.velocity ? 0.45 : 0;
    this.strike.set(sp.x + (src.velocity?.x ?? 0) * lead, sp.z + (src.velocity?.z ?? 0) * lead);
    this.warnTime = warnTime;
    this.strikeKind = src.kind;
    this.setState('warn');
    this.audio.roar();
    this.funnel.visible = true;
    this.funnel.scale.set(0.2, 0.2, 0.2);
  }

  beginBreach(display = false) {
    this.setState('breach');
    this.display = display;
    this.struck = display; this.landed = false;
    const a = display ? this.heading : Math.random() * Math.PI * 2;
    this.breachDir.set(Math.sin(a), Math.cos(a));
    this.heading = a;
    this.setSubmerged(false);
    this.funnel.visible = false;
    if (display) this.strike.set(this.pos.x, this.pos.y);
  }

  /**
   * ctx: { player: Vector3, storm, night, onStrike(point, radius), onSlam(x,z), onBreach(point, display) }
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
          const toP = Math.atan2(p.x - this.pos.x, p.z - this.pos.y);
          this.wanderHeading = this._dist > 320 ? toP + (Math.random() - 0.5) * 1.2 : this.heading + (Math.random() - 0.5) * 2.4;
        }
        if (Math.abs(this.pos.x) > PLAY_LIMIT - 40 || Math.abs(this.pos.y) > PLAY_LIMIT - 40) this.wanderHeading = Math.atan2(-this.pos.x, -this.pos.y);
        this.steer(Math.sin(this.wanderHeading), Math.cos(this.wanderHeading), 0.5, dt);
        this.moveForward(dt);
        // now and then it leaps far away: a reminder of the scale of the thing
        this.displayTimer -= dt;
        if (this.displayTimer <= 0 && this._dist > 140 && this._dist < 420 && !isRock(this.pos.x, this.pos.y)) {
          this.displayTimer = 90 + Math.random() * 90;
          this.beginBreach(true);
          ctx.onBreach?.(this.strike, true);
          this.audio.breach(0.35);
        }
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
        if (src && this.sourceAge < 1.2 && d < 16 && !isRock(src.position.x, src.position.z)) {
          this.beginWarn(src);
          break;
        }
        // lost the trail: go and look for it
        if (this.sourceAge > 2.5 && d < 30) this.setState('search');
        else if (this.sourceAge > 9 || this.interest < 0.05) { this.setState('roam'); this.interest = 0; }
        break;
      }
      case 'search': {
        // widening spiral around the last place it heard something
        this.speed += (12 - this.speed) * dt;
        const r = 12 + this.stateTime * 2.5;
        const a = this.stateTime * 0.55;
        const tx = this.lastKnown.x + Math.cos(a) * r, tz = this.lastKnown.y + Math.sin(a) * r;
        this.steer(tx - this.pos.x, tz - this.pos.y, 1.4, dt);
        this.moveForward(dt);
        if (this.stateTime > 9) {
          // half the time it gives up; the other half it lies in wait
          if (Math.random() < 0.55) { this.setState('lurk'); this.pos.lerp(this.lastKnown, 0.6); } else { this.setState('roam'); this.interest = 0; }
        }
        break;
      }
      case 'lurk': {
        this.speed = 0;
        if (this.stateTime > 14) { this.setState('roam'); this.interest = 0; }
        break;
      }
      case 'warn': {
        this.speed = 0;
        this.pos.lerp(this.strike, Math.min(1, dt * 4));
        const k = this.stateTime / this.warnTime;
        const gy = heightAt(this.strike.x, this.strike.y);
        this.funnel.position.set(this.strike.x, gy + 0.1, this.strike.y);
        this.funnel.scale.set(0.3 + k * 0.9, 0.2 + k * 0.9, 0.3 + k * 0.9);
        this.funnel.rotation.y += dt * 3;
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 10;
          const x = this.strike.x + Math.cos(a) * r, z = this.strike.y + Math.sin(a) * r;
          // sand pours inward and up
          this.particles.emit(x, heightAt(x, z) + 0.2, z, -Math.cos(a) * 4 - Math.sin(a) * 3, 3 + Math.random() * 7 * k, -Math.sin(a) * 4 + Math.cos(a) * 3,
            { life: 1.1, size: 1.4 + k, gravity: -12, alpha: 0.7 });
        }
        if (this.stateTime > this.warnTime) {
          this.beginBreach(false);
          this.audio.breach(1);
          ctx.onBreach?.(this.strike, false);
        }
        break;
      }
      case 'breach': {
        const T = this.display ? 3.6 : 3.0;
        const t = this.stateTime / T;
        if (t > 0.04 && !this.erupted) {
          this.erupted = true;
          this.eruptFx(this.strike.x, this.strike.y, this.display ? 0.6 : 1);
        }
        if (!this.struck && t > 0.05) {
          this.struck = true;
          ctx.onStrike(this.strike, 10, this.strikeKind);
          if (this.strikeKind === 'stake') this.baited++;
        }
        // sand pours off the wings while airborne
        if (t > 0.1 && t < 0.8) {
          for (let i = 0; i < 4; i++) {
            const side = Math.random() < 0.5 ? -1 : 1;
            const v = new THREE.Vector3(side * (10 + Math.random() * 12), 0, -Math.random() * 10);
            this.mesh.localToWorld(v);
            this.particles.emit(v.x, v.y, v.z, (Math.random() - 0.5) * 2, -1, (Math.random() - 0.5) * 2, { life: 2.2, size: 1.6, gravity: -9, drag: 0.3, alpha: 0.65 });
          }
        }
        if (!this.landed && t > 0.86) {
          this.landed = true;
          const lx = this.strike.x + this.breachDir.x * 30, lz = this.strike.y + this.breachDir.y * 30;
          this.eruptFx(lx, lz, this.display ? 0.5 : 0.8);
          this.audio.noiseBurst({ freq: 150, type: 'lowpass', vol: this.display ? 0.25 : 0.6, dur: 1.6 });
          if (!this.display) ctx.onSlam?.(lx, lz);
        }
        if (t >= 1) {
          this.setState('dive');
          this.erupted = false;
          this.setSubmerged(true);
          this.cooldown = this.display ? 2 : 7;
          this.interest = 0; this.source = null;
          this.pos.set(this.strike.x + this.breachDir.x * 34, this.strike.y + this.breachDir.y * 34);
          this.heading = Math.atan2(this.breachDir.x, this.breachDir.y);
        }
        break;
      }
      case 'dive': {
        this.speed = 14;
        this.moveForward(dt);
        if (this.stateTime > (this.display ? 2 : 6)) this.setState('roam');
        break;
      }
    }

    if (this.state !== 'warn') this.funnel.visible = false;
    this.updateFx(dt);
    this.updateVisual(dt);
  }

  eruptFx(x, z, power) {
    const gy = heightAt(x, z);
    this.particles.burst(x, gy + 1, z, Math.round(280 * power), 20 * power, { life: 2.8, size: 3.4, gravity: -12, drag: 0.6, alpha: 0.9 });
    this.particles.burst(x, gy + 1, z, Math.round(90 * power), 9 * power, { life: 4.5, size: 8, gravity: -0.5, drag: 0.4, alpha: 0.4, color: '#c99a68' });
    this.ring.position.set(x, gy + 0.3, z);
    this.ringT = 0; this.ringPower = power;
    let n = Math.round(14 * power);
    for (const d of this.debris) {
      if (n <= 0) break;
      if (d.life > 0) continue;
      n--;
      d.life = 3 + Math.random() * 2;
      d.mesh.visible = true;
      d.mesh.scale.setScalar(0.4 + Math.random() * 1.4);
      d.mesh.position.set(x + (Math.random() - 0.5) * 6, gy + 1, z + (Math.random() - 0.5) * 6);
      const a = Math.random() * Math.PI * 2, s = 6 + Math.random() * 14;
      d.v.set(Math.cos(a) * s, 14 + Math.random() * 16, Math.sin(a) * s).multiplyScalar(power);
      d.spin.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    }
  }

  updateFx(dt) {
    if (this.ringT < 1.6) {
      this.ringT += dt;
      const k = this.ringT / 1.6;
      const s = 2 + k * 70 * this.ringPower;
      this.ring.scale.set(s, s, s);
      this.ring.material.opacity = (1 - k) * 0.55;
    } else this.ring.material.opacity = 0;
    for (const d of this.debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.v.y -= 26 * dt;
      d.mesh.position.addScaledVector(d.v, dt);
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt;
      const g = heightAt(d.mesh.position.x, d.mesh.position.z);
      if (d.mesh.position.y < g) {
        d.mesh.position.y = g;
        if (d.v.y < -4) this.particles.burst(d.mesh.position.x, g + 0.2, d.mesh.position.z, 6, 3, { life: 0.8, size: 1, gravity: -6 });
        d.v.multiplyScalar(0.3); d.v.y = Math.abs(d.v.y) * 0.3;
      }
      if (d.life <= 0) d.mesh.visible = false;
    }
  }

  updateVisual(dt) {
    const m = this.mesh;
    const ud = this.ud;
    if (this.state === 'breach') {
      const T = this.display ? 3.6 : 3.0;
      const t = Math.min(1, this.stateTime / T);
      const along = -6 + t * 36;
      const x = this.strike.x + this.breachDir.x * along;
      const z = this.strike.y + this.breachDir.y * along;
      const g = heightAt(x, z);
      const arc = Math.sin(Math.min(1, t * 1.08) * Math.PI);
      m.position.set(x, g - 8 + arc * (this.display ? 38 : 30), z);
      m.rotation.set(0, 0, 0);
      m.rotation.y = this.heading;
      m.rotateX(-(1.1 - t * 2.4));
      m.rotateZ(Math.sin(t * Math.PI) * 0.35);
      // slow, heavy wingbeats
      ud.body.scale.set(1 + Math.sin(t * 8) * 0.04, 1 + Math.sin(t * 8 + 1) * 0.1, 1);
      ud.markM.emissiveIntensity = 3.5;
    } else {
      const g = heightAt(this.pos.x, this.pos.y);
      const ahead = heightAt(this.pos.x + Math.sin(this.heading) * 8, this.pos.y + Math.cos(this.heading) * 8);
      // lurking: fully hidden; hunting: spines cut the surface
      const depth = this.state === 'lurk' ? 9 : this.state === 'dive' ? 5.5 + Math.min(this.stateTime, 2) : this.state === 'warn' ? 2.6 : this.state === 'hunt' ? 2.4 : 3.2;
      const cur = m.position.y - g;
      m.position.set(this.pos.x, g + (cur + (-depth - cur) * Math.min(1, dt * 3)), this.pos.y);
      m.rotation.set(0, 0, 0);
      m.rotation.y = this.heading;
      m.rotateX(-Math.atan2(ahead - g, 8));
      ud.body.scale.set(1, 1, 1);
      ud.markM.emissiveIntensity = 1.2 + Math.sin(this.time * 3) * 0.4;
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
    if (this.state === 'warn' || (this.state === 'breach' && !this.display)) return 1;
    if (this.state === 'hunt') return clamp(1 - this._dist / 260, 0.25, 1);
    if (this.state === 'search') return clamp(1 - this._dist / 200, 0.15, 0.6);
    return clamp(1 - this._dist / 200, 0, 0.3);
  }

  rumble() {
    const prox = clamp(1 - this._dist / 220, 0, 1);
    if (this.state === 'warn') return 1;
    if (this.state === 'breach') return this.display ? 0.3 : 0.7;
    if (this.state === 'lurk') return 0;
    return prox * (this.state === 'hunt' ? 0.8 : 0.35) * Math.min(1, this.speed / 10);
  }
}
