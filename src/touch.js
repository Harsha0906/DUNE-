// On-screen controls for phones and tablets, plus gamepad polling.
// Both feed the same Input object as the keyboard: analog axes and "virtual" keys.

export function setupTouch(input, root) {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (!coarse) return null;
  document.body.classList.add('touch');
  const el = document.createElement('div');
  el.id = 'touchUI';
  el.innerHTML = `
    <div id="stickZone"><div id="stickBase"><div id="stickKnob"></div></div></div>
    <div id="lookZone"></div>
    <div id="touchBtns">
      <button data-key="KeyE" class="tb big">Use</button>
      <button data-key="Space" class="tb">Jump</button>
      <button data-key="ShiftLeft" class="tb" data-toggle="1">Run</button>
      <button data-key="KeyC" class="tb" data-toggle="1">Sneak</button>
      <button data-key="KeyQ" class="tb">Stake</button>
      <button data-key="KeyF" class="tb">Board</button>
      <button data-key="KeyM" class="tb small">Map</button>
      <button data-key="Escape" class="tb small">Pause</button>
    </div>`;
  root.appendChild(el);

  // movement stick
  const zone = el.querySelector('#stickZone');
  const base = el.querySelector('#stickBase');
  const knob = el.querySelector('#stickKnob');
  let stickId = null, cx = 0, cy = 0;
  const R = 55;
  zone.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    stickId = t.identifier; cx = t.clientX; cy = t.clientY;
    base.style.left = `${cx - 70}px`; base.style.top = `${cy - 70}px`; base.classList.add('on');
    e.preventDefault();
  }, { passive: false });
  zone.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== stickId) continue;
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      input.analog.x = dx / R; input.analog.y = -dy / R;
    }
    e.preventDefault();
  }, { passive: false });
  const endStick = (e) => {
    for (const t of e.changedTouches) if (t.identifier === stickId) {
      stickId = null; input.analog.x = input.analog.y = 0;
      knob.style.transform = ''; base.classList.remove('on');
    }
  };
  zone.addEventListener('touchend', endStick);
  zone.addEventListener('touchcancel', endStick);

  // look by dragging the right side of the screen
  const look = el.querySelector('#lookZone');
  let lookId = null, lx = 0, ly = 0;
  look.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; lookId = t.identifier; lx = t.clientX; ly = t.clientY; e.preventDefault(); }, { passive: false });
  look.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId) continue;
      input.mouseDX += (t.clientX - lx) * 1.6; input.mouseDY += (t.clientY - ly) * 1.6;
      lx = t.clientX; ly = t.clientY;
    }
    e.preventDefault();
  }, { passive: false });
  look.addEventListener('touchend', () => { lookId = null; });

  // buttons: hold-style by default, toggles for run/sneak
  el.querySelectorAll('button.tb').forEach((b) => {
    const key = b.dataset.key;
    const toggle = !!b.dataset.toggle;
    b.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (key === 'Escape') { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })); return; }
      if (toggle) {
        const on = !input.virtual.has(key);
        on ? input.virtual.add(key) : input.virtual.delete(key);
        b.classList.toggle('on', on);
        return;
      }
      input.virtual.add(key); input.press(key); b.classList.add('on');
    }, { passive: false });
    const up = (e) => { e.preventDefault(); if (!toggle) { input.virtual.delete(key); b.classList.remove('on'); } };
    b.addEventListener('touchend', up, { passive: false });
    b.addEventListener('touchcancel', up, { passive: false });
  });
  return el;
}

// Standard-mapping gamepad: left stick move, right stick look, A jump/drift, X use,
// Y board, B sneak, RT sprint/boost, LB stake, Back map, Start pause.
const MAP = { 0: 'Space', 2: 'KeyE', 3: 'KeyF', 1: 'KeyC', 7: 'ShiftLeft', 4: 'KeyQ', 8: 'KeyM' };
const prev = {};
export function pollGamepad(input, onPause) {
  const pads = navigator.getGamepads?.() || [];
  const gp = [...pads].find((p) => p && p.connected);
  if (!gp) { if (input.padActive) { input.analog.x = input.analog.y = 0; input.lookX = input.lookY = 0; input.padActive = false; } return; }
  const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
  input.padActive = true;
  input.analog.x = dz(gp.axes[0] || 0);
  input.analog.y = -dz(gp.axes[1] || 0);
  input.lookX = dz(gp.axes[2] || 0);
  input.lookY = dz(gp.axes[3] || 0) * (input.invertY ? -1 : 1);
  for (const [i, key] of Object.entries(MAP)) {
    const b = gp.buttons[i];
    const down = !!b && (b.pressed || b.value > 0.5);
    if (down) { input.virtual.add(key); if (!prev[i]) input.press(key); } else if (prev[i]) input.virtual.delete(key);
    prev[i] = down;
  }
  const st = gp.buttons[9]?.pressed;
  if (st && !prev.start) onPause();
  prev.start = st;
}
