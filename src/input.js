export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.dragging = false;
    this.sensitivity = 1;
    this.invertY = false;

    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange?.(this.locked);
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2) this.dragging = true;
      if (e.button === 0) this.pressed.add('Mouse0');
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 2) this.dragging = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.wheel = (this.wheel || 0) + Math.sign(e.deltaY); }, { passive: true });
  }

  lock() { if (!this.locked) this.canvas.requestPointerLock?.()?.catch?.(() => {}); }
  unlock() { if (this.locked) document.exitPointerLock?.(); }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }

  consumeMouse() {
    const s = 0.0022 * this.sensitivity;
    const d = { x: this.mouseDX * s, y: this.mouseDY * s * (this.invertY ? -1 : 1), wheel: this.wheel || 0 };
    this.mouseDX = this.mouseDY = 0; this.wheel = 0;
    return d;
  }

  endFrame() { this.pressed.clear(); }
}
