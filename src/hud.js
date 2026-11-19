import { WORLD_SIZE, HALF } from './terrain.js';

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Compass bearing: 0 = north (-z), clockwise, east = +x. */
export const bearing = (dx, dz) => Math.atan2(dx, -dz);

export class HUD {
  constructor(mapCanvas) {
    this.el = $('hud');
    this.mapCanvas = mapCanvas;
    this.mini = $('minimap').getContext('2d');
    this.big = $('bigMapCanvas').getContext('2d');
    this.strip = $('compassStrip');
    this.toastsEl = $('toasts');
    this.cache = {};
    // static compass marks
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    this.compassMarks = [];
    for (let d = 0; d < 360; d += 15) {
      const m = document.createElement('div');
      m.className = 'cmark' + (labels[d] ? '' : ' minor');
      m.textContent = labels[d] ?? '·';
      this.strip.appendChild(m);
      this.compassMarks.push({ el: m, b: (d / 180) * Math.PI });
    }
    this.dynMarks = {};
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  set(id, value) {
    if (this.cache[id] === value) return;
    this.cache[id] = value;
    $(id).textContent = value;
  }

  style(id, prop, value) {
    const k = id + prop;
    if (this.cache[k] === value) return;
    this.cache[k] = value;
    $(id).style[prop] = value;
  }

  toggle(id, cls, on) {
    const k = id + cls;
    if (this.cache[k] === on) return;
    this.cache[k] = on;
    $(id).classList.toggle(cls, on);
  }

  toast(text, kind = '', ms = 3800) {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = text;
    this.toastsEl.appendChild(t);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 700);
  }

  clearToasts() { this.toastsEl.innerHTML = ''; }

  compass(heading, marks) {
    const place = (el, b) => {
      const rel = wrap(b - heading);
      const vis = Math.abs(rel) < Math.PI / 2;
      el.style.display = vis ? '' : 'none';
      if (vis) el.style.left = `${50 + (rel / (Math.PI / 2)) * 50}%`;
    };
    for (const m of this.compassMarks) place(m.el, m.b);
    for (const key of Object.keys(this.dynMarks)) if (!marks[key]) { this.dynMarks[key].remove(); delete this.dynMarks[key]; }
    for (const [key, m] of Object.entries(marks)) {
      let el = this.dynMarks[key];
      if (!el) { el = document.createElement('div'); el.className = 'cmark ' + m.cls; el.textContent = m.icon; this.strip.appendChild(el); this.dynMarks[key] = el; }
      place(el, m.b);
    }
  }

  tremor(show, rel, text) {
    this.toggle('tremor', 'hidden', !show);
    if (show) {
      this.style('tremor', 'transform', `translate(-50%, -50%) rotate(${rel.toFixed(2)}rad)`);
      this.style('tremorText', 'transform', `translateX(-50%) rotate(${(-rel).toFixed(2)}rad)`);
      this.set('tremorText', text);
    }
  }

  drawMap(ctx, size, cx, cz, heading, span, pois, rotate) {
    const scale = size / span; // px per metre
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    if (rotate) { ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, TAU); ctx.clip(); }
    ctx.fillStyle = '#5e3a24'; ctx.fillRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    if (rotate) ctx.rotate(-heading);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cz);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mapCanvas, -HALF, -HALF, WORLD_SIZE, WORLD_SIZE);
    const s = 1 / scale;
    for (const p of pois) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      if (p.ring) {
        ctx.strokeStyle = p.color; ctx.lineWidth = 2 * s;
        ctx.arc(p.x, p.z, p.ring, 0, TAU); ctx.stroke();
        continue;
      }
      if (p.square) ctx.rect(p.x - p.r * s, p.z - p.r * s, p.r * 2 * s, p.r * 2 * s);
      else ctx.arc(p.x, p.z, p.r * s, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    if (!rotate) return;
    // player arrow
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#2a1206'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  minimap(cx, cz, heading, pois) { this.drawMap(this.mini, 180, cx, cz, heading, 420, pois, true); }
  bigmap(cx, cz, heading, pois) { this.drawMap(this.big, 560, 0, 0, heading, WORLD_SIZE, pois, false); this.bigOffset(cx, cz, heading); }

  bigOffset(cx, cz, heading) {
    // redraw arrow at player location on the full map
    const ctx = this.big, size = 560;
    const px = ((cx + HALF) / WORLD_SIZE) * size, pz = ((cz + HALF) / WORLD_SIZE) * size;
    ctx.save();
    ctx.translate(px, pz); ctx.rotate(heading);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#2a1206'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
