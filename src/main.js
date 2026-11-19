import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { DesertLensShader } from './postfx.js';
import { createScatter, Tracks, Wind } from './scenery.js';

import {
  createTerrainMesh, createMapCanvas, findRockSites, heightAt, isRock, rockMask,
  PLAY_LIMIT, BEACON_POS, terrainUniforms, normalAt,
} from './terrain.js';
import { Sky } from './sky.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { Player, Skimmer } from './player.js';
import { Creature } from './creature.js';
import { ParticlePool, StormField } from './particles.js';
import { HUD, bearing } from './hud.js';
import {
  createShard, createCondenser, createBeacon, createCache, createStake, createRibcage, createBoulder,
  createRuin, createWreck, createLift,
} from './models.js';
import { UPGRADES, TABLETS, CHAPTERS } from './story.js';
import { mulberry32, clamp, smoothstep } from './noise.js';

const GOAL = 20;
let MAX_STAKES = 4;
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- settings
const settings = { quality: 'high', sens: 1, vol: 0.8, music: true, invert: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('glasswind.settings') || '{}')); } catch { /* ignore */ }
const saveSettings = () => { try { localStorage.setItem('glasswind.settings', JSON.stringify(settings)); } catch { /* ignore */ } };

// ---------------------------------------------------------------- renderer
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 4000);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.5, 0.55, 0.82);
composer.addPass(bloom);
const lens = new ShaderPass(DesertLensShader);
composer.addPass(lens);
composer.addPass(new OutputPass());

function applyQuality() {
  const high = settings.quality === 'high';
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 2 : 1));
  bloom.enabled = high;
  resize();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- world
const audio = new Audio();
const input = new Input(canvas);
const sky = new Sky(scene);
const terrain = createTerrainMesh();
scene.add(terrain);
const particles = new ParticlePool(scene, 3500);
const storm = new StormField(scene, 2600);
const player = new Player(scene, particles, audio);
const skimmer = new Skimmer(scene, particles, audio);
const creature = new Creature(scene, particles, audio);
const hud = new HUD(createMapCanvas(256));

const rand = mulberry32(2026);
createScatter(scene, rand);
const tracks = new Tracks(scene, 700);
const wind = new Wind(particles, rand);
player.onStep = (x, z, yaw, side) => {
  const r = 0.14 * side;
  tracks.add(x + Math.cos(yaw) * r, z - Math.sin(yaw) * r, yaw, 0.22, 0.36, 45, clock.elapsedTime);
};
const place = (obj, x, z, dy = 0) => { obj.position.set(x, heightAt(x, z) + dy, z); scene.add(obj); return obj; };

// condensers: one at the start outpost, others on scattered mesas
const condenserSites = [[10, -8], ...findRockSites(8, 170, rand)];
const condensers = condenserSites.map(([x, z]) => {
  const m = place(createCondenser(), x, z, -0.2);
  return { mesh: m, pos: new THREE.Vector3(x, m.position.y, z), stakeCooldown: 0 };
});

const beacon = place(createBeacon(), BEACON_POS.x, BEACON_POS.y, -0.3);
const beaconPos = beacon.position.clone();

function randomSand(minDist = 60, tries = 400) {
  for (let i = 0; i < tries; i++) {
    const x = (rand() * 2 - 1) * (PLAY_LIMIT - 30), z = (rand() * 2 - 1) * (PLAY_LIMIT - 30);
    if (Math.hypot(x, z) < minDist) continue;
    if (rockMask(x, z) > 0.01 || rockMask(x + 6, z) > 0.01 || rockMask(x, z + 6) > 0.01) continue;
    return [x, z];
  }
  return [200, 200];
}

// sunglass shards
const shards = [];
for (let i = 0; i < 70; i++) {
  let pos;
  for (let k = 0; k < 30; k++) {
    pos = randomSand(i < 8 ? 45 : 70);
    // the first few are close to the outpost to teach the loop
    if (i < 8) { const a = rand() * Math.PI * 2, r = 70 + rand() * 90; pos = [Math.cos(a) * r, Math.sin(a) * r]; if (isRock(pos[0], pos[1])) continue; }
    if (shards.every((s) => Math.hypot(s.pos.x - pos[0], s.pos.z - pos[1]) > 30)) break;
  }
  const m = place(createShard(rand), pos[0], pos[1], -0.2);
  shards.push({ mesh: m, pos: m.position.clone(), taken: false, phase: rand() * 6 });
}

// supply caches
const caches = [];
for (let i = 0; i < 16; i++) {
  const [x, z] = randomSand(90);
  const m = place(createCache(), x, z, -0.1);
  m.rotation.y = rand() * 6;
  caches.push({ mesh: m, pos: m.position.clone(), taken: false });
}

// landmarks: ribcages of long-dead rays
for (let i = 0; i < 7; i++) {
  const [x, z] = randomSand(120);
  const r = place(createRibcage(rand), x, z, -1.6);
  r.rotation.y = rand() * Math.PI;
  r.rotation.z = (rand() - 0.5) * 0.3;
}
// boulders on the mesas
for (let i = 0, n = 0; i < 4000 && n < 170; i++) {
  const x = (rand() * 2 - 1) * PLAY_LIMIT, z = (rand() * 2 - 1) * PLAY_LIMIT;
  const m = rockMask(x, z);
  if (m < 0.6 || (m > 0.97 && rand() < 0.7)) continue; // gather mostly along the rim
  if (Math.hypot(x - 10, z + 8) < 12 || Math.hypot(x - BEACON_POS.x, z - BEACON_POS.y) < 12) continue;
  const b = place(createBoulder(rand, rand() < 0.5 ? '#7a4630' : '#5e3324'), x, z, 0);
  b.scale.multiplyScalar(1.2 + rand() * 3.2);
  n++;
}
// start outpost tent
{
  const tent = new THREE.Mesh(new THREE.ConeGeometry(3.2, 3, 4), new THREE.MeshStandardMaterial({ color: '#d9c39b', flatShading: true, roughness: 0.9 }));
  tent.castShadow = tent.receiveShadow = true;
  place(tent, -8, 6, 1.4).rotation.y = 0.4;
}

// ruins of the glass-singers: stone floors the ray cannot strike through
const ruins = [];
{
  const kinds = ['arch', 'dome', 'head', 'arch', 'dome'];
  for (let i = 0; i < TABLETS.length; i++) {
    let pos;
    for (let k = 0; k < 60; k++) {
      pos = randomSand(160);
      if (ruins.every((r) => Math.hypot(r.pos.x - pos[0], r.pos.z - pos[1]) > 260)) break;
    }
    const m = place(createRuin(rand, kinds[i]), pos[0], pos[1], -0.6);
    m.rotation.y = rand() * 6;
    const tp = m.userData.tablet.getWorldPosition(new THREE.Vector3());
    ruins.push({ mesh: m, pos: m.position.clone(), tabletPos: tp, read: false, idx: i });
  }
}
// the crashed skimmer that holds your power cell
const wreckPos = (() => {
  for (let i = 0; i < 400; i++) {
    const a = rand() * Math.PI * 2, r = 120 + rand() * 60;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (rockMask(x, z) < 0.01 && rockMask(x + 8, z) < 0.01 && rockMask(x, z + 8) < 0.01) return new THREE.Vector3(x, heightAt(x, z), z);
  }
  return new THREE.Vector3(130, heightAt(130, 0), 0);
})();
const wreck = place(createWreck(), wreckPos.x, wreckPos.z, -0.3);
const lift = createLift();
lift.visible = false;
scene.add(lift);
const isSafe = (x, z) => isRock(x, z) || ruins.some((r) => Math.hypot(r.pos.x - x, r.pos.z - z) < 9.5);

// planted thrum stakes
const stakes = [];

// ---------------------------------------------------------------- game state
const G = {
  mode: 'menu', // menu | play | pause | dead | won
  water: 100, health: 100, shards: 0, stakes: 2,
  time: 0, mounted: false,
  stormLevel: 0, stormActive: false, stormClock: 150, stormDur: 0, stormWarned: false,
  interact: null, holdProgress: 0, charged: false, extracting: false,
  shake: 0, hurtFlash: 0, thirstWarned: false, shelterHint: false, mapOpen: false,
  days: 0, lastTimeOfDay: 0,
  chapter: 0, maxWater: 100, upgrades: new Set(), cellFound: false, extractT: 0, tabletsRead: 0,
};

const cam = { yaw: Math.PI, pitch: 0.28, dist: 6.5, idle: 0, pos: new THREE.Vector3(), focus: new THREE.Vector3(), land: 0 };

function resetGame() {
  G.water = 100; G.health = 100; G.shards = 0; G.stakes = 2; G.time = 0;
  G.mounted = false; G.stormLevel = 0; G.stormActive = false; G.stormClock = 150; G.stormWarned = false;
  G.interact = null; G.holdProgress = 0; G.charged = false; G.extracting = false; G.thirstWarned = false; G.shelterHint = false;
  G.days = 0;
  G.chapter = -1; G.maxWater = 100; G.upgrades = new Set(); G.cellFound = false; G.extractT = 0; G.tabletsRead = 0;
  MAX_STAKES = 4;
  player.stats.noise = 1; skimmer.stats.noise = 1;
  for (const r of ruins) { r.read = false; r.mesh.userData.glyphM.emissiveIntensity = 1.6; }
  wreck.userData.cell.visible = true;
  lift.visible = false;
  player.reset(0, 0);
  skimmer.reset(14, 10, Math.PI * 0.75);
  creature.reset();
  sky.time = 0.31;
  for (const s of shards) { s.taken = false; s.mesh.visible = true; }
  for (const c of caches) { c.taken = false; c.mesh.visible = true; }
  for (const c of condensers) c.stakeCooldown = 0;
  for (const s of stakes) scene.remove(s.mesh);
  stakes.length = 0;
  setBeaconCharged(false);
  cam.yaw = Math.PI * 0.85; cam.pitch = 0.25;
  hud.clearToasts();
}

function setBeaconCharged(on) {
  G.charged = on;
  const u = beacon.userData;
  u.beamM.color.set(on ? '#7ff6ff' : '#ffb35c');
  u.coreM.color.set(on ? '#7ff6ff' : '#ffbf6b');
  u.coreM.emissive.set(on ? '#3fe0ff' : '#ff8a1f');
  u.beamM.opacity = on ? 0.4 : 0.22;
}

// ---------------------------------------------------------------- UI wiring
const screens = ['menu', 'howPanel', 'settingsPanel', 'pause', 'endScreen', 'loading', 'bench'];
let returnTo = 'menu';
function showScreen(id) { for (const s of screens) $(s).classList.toggle('hidden', s !== id); }
document.querySelectorAll('.goalN').forEach((e) => { e.textContent = GOAL; });
$('shardGoal').textContent = GOAL;

$('btnPlay').onclick = () => { audio.init(); audio.ui(); startGame(); };
$('btnHow').onclick = () => { audio.init(); audio.ui(); returnTo = 'menu'; showScreen('howPanel'); };
$('btnSettings').onclick = () => { audio.init(); audio.ui(); returnTo = 'menu'; showScreen('settingsPanel'); };
$('btnPauseHow').onclick = () => { audio.ui(); returnTo = 'pause'; showScreen('howPanel'); };
$('btnPauseSettings').onclick = () => { audio.ui(); returnTo = 'pause'; showScreen('settingsPanel'); };
document.querySelectorAll('.back').forEach((b) => { b.onclick = () => { audio.ui(); showScreen(returnTo); }; });
$('btnResume').onclick = () => resume();
$('btnQuit').onclick = () => { audio.ui(); toMenu(); };
$('btnRetry').onclick = () => { audio.ui(); startGame(); };
$('btnMenu').onclick = () => { audio.ui(); toMenu(); };
$('benchClose').onclick = () => closeBench();

$('setQuality').value = settings.quality;
$('setSens').value = settings.sens;
$('setVol').value = settings.vol;
$('setMusic').checked = settings.music;
$('setInvert').checked = settings.invert;
const applySettings = () => {
  input.sensitivity = settings.sens; input.invertY = settings.invert;
  audio.setVolume(settings.vol); audio.setMusic(settings.music);
  applyQuality();
};
$('setQuality').onchange = (e) => { settings.quality = e.target.value; saveSettings(); applySettings(); };
$('setSens').oninput = (e) => { settings.sens = +e.target.value; saveSettings(); applySettings(); };
$('setVol').oninput = (e) => { settings.vol = +e.target.value; saveSettings(); applySettings(); };
$('setMusic').onchange = (e) => { settings.music = e.target.checked; saveSettings(); applySettings(); };
$('setInvert').onchange = (e) => { settings.invert = e.target.checked; saveSettings(); applySettings(); };

canvas.addEventListener('click', () => { if (G.mode === 'play') input.lock(); });
input.onLockChange = (locked) => { if (!locked && G.mode === 'play' && !G.ignoreUnlock) pause(); };

function startGame() {
  resetGame();
  G.mode = 'play';
  showScreen(null);
  hud.show(true);
  input.lock();
  setChapter(0);
  setTimeout(() => G.mode === 'play' && hud.toast('Walk softly. Something under the sand listens for footsteps.', 'warn', 5500), 7000);
}
function setChapter(n) {
  if (G.chapter === n) return;
  G.chapter = n;
  const c = CHAPTERS[n];
  $('chapterNum').textContent = `CHAPTER ${['I', 'II', 'III', 'IV'][n]}`;
  $('chapterTitle').textContent = c.title;
  $('chapterText').textContent = c.intro;
  const card = $('chapterCard');
  card.classList.remove('show'); void card.offsetWidth; card.classList.add('show');
  audio.chapter?.();
}

function objectiveText() {
  switch (G.chapter) {
    case 0: return ['Drink at the outpost condenser', 'Hold E under the awning'];
    case 1: return ['Recover the power cell', 'From the crashed skimmer (white marker)'];
    case 2: return [`Gather sunglass: ${G.shards} / ${GOAL}`, `Echo tablets read: ${G.tabletsRead} / ${TABLETS.length} · Spend sunglass on gear at condensers`];
    case 3: if (!G.extracting && G.shards < GOAL) return [`Gather sunglass: ${G.shards} / ${GOAL}`, 'You spent some at the workbench'];
      return G.extracting ? [`Hold the beacon: ${Math.ceil(G.extractT)}s`, 'Stay close. The lift is coming.'] : ['Reach the beacon and call the lift', 'Follow the cyan light pillar'];
    default: return ['', ''];
  }
}

function openBench(c) {
  G.mode = 'bench';
  G.ignoreUnlock = true; input.unlock(); G.ignoreUnlock = false;
  renderBench();
  showScreen('bench');
}
function renderBench() {
  $('benchShards').textContent = G.shards;
  $('benchList').innerHTML = UPGRADES.map((u) => {
    const owned = G.upgrades.has(u.id);
    const can = !owned && G.shards >= u.cost;
    return `<button class="up ${owned ? 'owned' : ''}" data-id="${u.id}" ${can ? '' : 'disabled'}>
      <span class="upName">${u.name}</span><span class="upDesc">${u.desc}</span>
      <span class="upCost">${owned ? 'Equipped' : `◆ ${u.cost}`}</span></button>`;
  }).join('');
  $('benchList').querySelectorAll('button.up').forEach((b) => { b.onclick = () => buyUpgrade(b.dataset.id); });
}
function buyUpgrade(id) {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u || G.upgrades.has(id) || G.shards < u.cost) return;
  G.shards -= u.cost;
  G.upgrades.add(id);
  applyUpgrades();
  audio.pickup();
  renderBench();
}
function applyUpgrades() {
  const has = (id) => G.upgrades.has(id);
  G.maxWater = has('flasks') ? 150 : 100;
  player.stats.noise = has('wraps') ? 0.6 : 1;
  skimmer.stats.noise = has('baffles') ? 0.65 : 1;
  MAX_STAKES = has('satchel') ? 6 : 4;
  if (has('satchel') && !G.satchelGiven) { G.stakes = Math.min(MAX_STAKES, G.stakes + 2); G.satchelGiven = true; }
  if (G.shards < GOAL && G.charged) setBeaconCharged(false);
}
function closeBench() {
  audio.ui();
  G.mode = 'play';
  showScreen(null);
  input.lock();
}

function pause() {
  if (G.mode !== 'play') return;
  G.mode = 'pause';
  showScreen('pause');
}
function resume() {
  audio.ui();
  G.mode = 'play';
  showScreen(null);
  input.lock();
}
function toMenu() {
  G.mode = 'menu';
  G.ignoreUnlock = true; input.unlock(); G.ignoreUnlock = false;
  hud.show(false);
  $('bigMap').classList.add('hidden');
  showScreen('menu');
}
function endGame(won, title, text) {
  if (G.mode !== 'play') return;
  G.mode = won ? 'won' : 'dead';
  G.ignoreUnlock = true; input.unlock(); G.ignoreUnlock = false;
  won ? audio.win() : audio.lose();
  const mm = Math.floor(G.time / 60), ss = String(Math.floor(G.time % 60)).padStart(2, '0');
  $('endKicker').textContent = won ? 'EXPEDITION COMPLETE' : 'EXPEDITION FAILED';
  $('endTitle').textContent = title;
  $('endText').textContent = text;
  $('endStats').innerHTML = [
    [`${mm}:${ss}`, 'TIME'], [`${G.shards}`, 'SUNGLASS'], [`${(player.distance / 1000).toFixed(2)} km`, 'TRAVELLED'], [`${G.days}`, 'NIGHTS SURVIVED'],
  ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  setTimeout(() => { if (G.mode === 'won' || G.mode === 'dead') { hud.show(false); showScreen('endScreen'); } }, won ? 2200 : 1800);
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (G.mode === 'play' && !input.locked) pause();
    else if (G.mode === 'pause') resume();
    else if (G.mode === 'bench') closeBench();
  }
});

// ---------------------------------------------------------------- interactions
function nearestInteract() {
  const p = player.position;
  let best = null, bd = Infinity;
  const consider = (d, item) => { if (d < bd) { bd = d; best = item; } };
  if (G.mounted) return null;
  for (const s of shards) if (!s.taken) { const d = s.pos.distanceTo(p); if (d < 3.4) consider(d, { kind: 'shard', ref: s, label: 'Harvest sunglass', time: 1.3 }); }
  for (const c of caches) if (!c.taken) { const d = c.pos.distanceTo(p); if (d < 3) consider(d, { kind: 'cache', ref: c, label: 'Open supply cache', time: 0.8 }); }
  for (const c of condensers) { const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z); if (d < 5) consider(d + 2, { kind: 'condenser', ref: c, label: G.chapter >= 2 ? 'Drink and open workbench' : 'Drink from condenser', time: 1.0 }); }
  for (const r of ruins) if (!r.read) { const d = Math.hypot(r.tabletPos.x - p.x, r.tabletPos.z - p.z); if (d < 4) consider(d, { kind: 'tablet', ref: r, label: 'Read the echo tablet', time: 1.5 }); }
  if (!G.cellFound) { const d = Math.hypot(wreckPos.x - p.x, wreckPos.z - p.z); if (d < 5) consider(d, { kind: 'cell', label: 'Pull the power cell', time: 2 }); }
  const db = Math.hypot(beaconPos.x - p.x, beaconPos.z - p.z);
  if (db < 9 && !G.extracting) consider(db, G.shards >= GOAL ? { kind: 'beacon', label: 'Call the lift', time: 3 } : { kind: 'beaconLocked', label: `Beacon needs ${GOAL - G.shards} more sunglass`, time: Infinity });
  return best;
}

function completeInteract(it) {
  switch (it.kind) {
    case 'shard':
      it.ref.taken = true; it.ref.mesh.visible = false;
      G.shards++;
      audio.pickup();
      particles.burst(it.ref.pos.x, it.ref.pos.y + 1, it.ref.pos.z, 30, 3, { color: '#8fe9ff', life: 1.2, size: 0.5, gravity: -2, alpha: 1 });
      if (G.shards >= GOAL && !G.charged) {
        setBeaconCharged(true);
        if (G.chapter === 2) setChapter(3);
      } else if (G.shards < GOAL) hud.toast(`Sunglass ${G.shards} / ${GOAL}`, 'good', 1800);
      break;
    case 'cache':
      it.ref.taken = true; it.ref.mesh.visible = false;
      G.water = Math.min(G.maxWater, G.water + 40);
      G.health = Math.min(100, G.health + 15);
      audio.drink();
      if (G.stakes < MAX_STAKES && Math.random() < 0.6) { G.stakes++; hud.toast('Cache: water flask and a thrum stake', 'good'); } else hud.toast('Cache: water flask (+40 water)', 'good');
      break;
    case 'condenser':
      G.water = G.maxWater;
      audio.drink();
      if (G.stakes < 2 && it.ref.stakeCooldown <= 0) { G.stakes = 2; it.ref.stakeCooldown = 120; hud.toast('Water refilled. Restocked thrum stakes.', 'good'); } else hud.toast('Water refilled', 'good', 1800);
      if (G.chapter === 0) setChapter(1);
      else if (G.chapter >= 2) openBench(it.ref);
      break;
    case 'tablet': {
      const r = it.ref;
      r.read = true; G.tabletsRead++;
      r.mesh.userData.glyphM.emissiveIntensity = 0.2;
      audio.chapter?.();
      G.shards += 2;
      $('loreTitle').textContent = TABLETS[r.idx].title;
      $('loreText').textContent = TABLETS[r.idx].text;
      const lc = $('loreCard'); lc.classList.remove('show'); void lc.offsetWidth; lc.classList.add('show');
      hud.toast('The tablet held two shards of sunglass (+2)', 'good', 2500);
      if (G.shards >= GOAL && !G.charged) { setBeaconCharged(true); if (G.chapter === 2) setChapter(3); }
      break;
    }
    case 'cell':
      G.cellFound = true;
      wreck.userData.cell.visible = false;
      audio.pickup();
      hud.toast('Power cell recovered. Your skimmer will fly again (F to board).', 'good', 4500);
      setChapter(2);
      break;
    case 'beacon':
      setChapter(3);
      G.extracting = true;
      G.extractT = 45;
      G.stormActive = true; G.stormDur = 50;
      audio.alert();
      hud.toast('The beacon screams into the sky. Every ray for miles can hear it. Hold on!', 'warn', 6000);
      break;
  }
}

function plantStake() {
  if (G.mounted || G.stakes <= 0) { if (G.stakes <= 0) hud.toast('No thrum stakes left. Find caches or condensers.', '', 2200); return; }
  const fwd = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing));
  const x = player.position.x + fwd.x * 1.5, z = player.position.z + fwd.z * 1.5;
  if (isRock(x, z)) { hud.toast('Stakes only carry through sand.', '', 2000); return; }
  G.stakes--;
  const m = place(createStake(), x, z, -0.2);
  stakes.push({ mesh: m, position: new THREE.Vector3(x, m.position.y, z), life: 16, id: Math.random(), kind: 'stake' });
  audio.stake();
  hud.toast('Thrum stake planted. It will pound the sand for 16 seconds.', '', 2600);
}

function onBreach(point, display) {
  const p = G.mounted ? skimmer.position : player.position;
  const d = Math.hypot(p.x - point.x, p.z - point.y);
  if (display) {
    if (!G.sawDisplay) { G.sawDisplay = true; hud.toast('Far off, the Veil Ray leaps from the sand. It is the size of a cathedral.', 'warn', 5000); }
    G.shake = Math.max(G.shake, 0.25);
    return;
  }
  // a near miss plays out in slow motion
  if (d > 10.5 && d < 70) { G.slowmo = 1.1; audio.stinger?.(); }
}
function onStrike(point, radius) {
  const p = G.mounted ? skimmer.position : player.position;
  const d = Math.hypot(p.x - point.x, p.z - point.y);
  G.shake = Math.max(G.shake, clamp(1.6 - d / 70, 0.2, 1.6));
  if (d < radius && !isSafe(p.x, p.z)) {
    killPlayer();
    return;
  }
  if (!G.mounted && !skimmer.destroyed && Math.hypot(skimmer.position.x - point.x, skimmer.position.z - point.y) < radius) {
    skimmer.destroyed = true; skimmer.mesh.visible = false;
    hud.toast('The Veil Ray swallowed your skimmer!', 'warn', 4000);
  }
  for (let i = stakes.length - 1; i >= 0; i--) {
    const s = stakes[i];
    if (Math.hypot(s.position.x - point.x, s.position.z - point.y) < radius + 4) { scene.remove(s.mesh); stakes.splice(i, 1); }
  }
  if (d < 40) { G.hurtFlash = 0.6; hud.toast('Too close! Keep moving.', 'warn', 2000); }
}
function onSlam(x, z) {
  G.shake = Math.max(G.shake, 0.8);
  const p = G.mounted ? skimmer.position : player.position;
  if (Math.hypot(p.x - x, p.z - z) < 8 && !isSafe(p.x, p.z)) killPlayer();
}
function killPlayer() {
  player.mesh.visible = false;
  if (G.mounted) { skimmer.mesh.visible = false; skimmer.destroyed = true; }
  G.health = 0;
  endGame(false, 'Taken by the Veil Ray', 'It heard you long before you saw it. Walk softly, sneak near it, and keep to the rock.');
}

player.onLand = (v) => { cam.land = Math.min(0.5, v * 0.03); G.shake = Math.max(G.shake, Math.min(0.5, v * 0.03)); };
skimmer.onLand = (v) => { cam.land = Math.min(0.8, v * 0.05); G.shake = Math.max(G.shake, Math.min(0.9, v * 0.05)); };
skimmer.onCrash = (sp) => { G.health -= sp * 0.6; G.hurtFlash = 0.4; G.shake = 0.5; };

function toggleMount() {
  if (G.mounted) {
    G.mounted = false;
    skimmer.driven = false;
    const right = new THREE.Vector3(Math.cos(skimmer.yaw), 0, -Math.sin(skimmer.yaw));
    const x = skimmer.position.x + right.x * 2.6, z = skimmer.position.z + right.z * 2.6;
    player.reset(x, z);
    player.mesh.rotation.set(0, 0, 0);
    player.distance = G.savedDistance ?? player.distance;
    player.facing = skimmer.yaw;
    cam.dist = 7;
    audio.mount();
  } else if (!skimmer.destroyed && player.position.distanceTo(skimmer.position) < 4.5 && !G.cellFound) {
    hud.toast('The skimmer is dead. Its power cell was in the crashed skimmer.', '', 3000);
  } else if (!skimmer.destroyed && player.position.distanceTo(skimmer.position) < 4.5) {
    G.mounted = true;
    G.savedDistance = player.distance;
    skimmer.driven = true;
    cam.dist = 12;
    audio.mount();
    hud.toast('Skimmer: fast, but its engine sings through the sand.', 'warn', 3000);
  }
}

// ---------------------------------------------------------------- per-frame
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3();
const lookAt = new THREE.Vector3();

function updateCamera(dt, playing) {
  const m = input.consumeMouse();
  if (playing) {
    cam.yaw -= m.x + (input.lookX || 0) * dt * 2.6;
    cam.pitch = clamp(cam.pitch + m.y + (input.lookY || 0) * dt * 1.8, -0.35, 1.2);
    if (m.wheel) cam.dist = clamp(cam.dist + m.wheel * 0.8, 3.5, 18);
    if (Math.abs(m.x) + Math.abs(m.y) + Math.abs(input.lookX || 0) > 0.0001) cam.idle = 0; else cam.idle += dt;
    if (G.mounted && cam.idle > 1.0 && skimmer.speed > 5) {
      const d = Math.atan2(Math.sin(skimmer.yaw - cam.yaw), Math.cos(skimmer.yaw - cam.yaw));
      cam.yaw += d * Math.min(1, dt * 2.5);
    }
  }
  const focus = G.mounted ? skimmer.position : player.position;
  // over-the-shoulder framing on foot, centred on the skimmer
  const crouchDrop = !G.mounted && player.crouch ? 0.45 : 0;
  const shoulder = G.mounted ? 0 : 0.55;
  const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  cam.focus.lerp(tmpV.set(focus.x - rx * shoulder, focus.y + (G.mounted ? 2.3 : 1.65 - crouchDrop) - (cam.land || 0), focus.z - rz * shoulder), Math.min(1, dt * (G.mounted ? 9 : 14)));
  lookAt.copy(cam.focus);
  cam.land = Math.max(0, (cam.land || 0) - dt * 1.5);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const dist = cam.dist + (G.mounted ? skimmer.speed * 0.07 : player.sprinting ? 0.6 : 0);
  tmpV.set(-Math.sin(cam.yaw) * cp * dist, sp * dist, -Math.cos(cam.yaw) * cp * dist).add(lookAt);
  // keep the camera above the sand along the whole boom, not just at its end
  for (let k = 0.5; k <= 1.0; k += 0.25) {
    const bx = lookAt.x + (tmpV.x - lookAt.x) * k, bz = lookAt.z + (tmpV.z - lookAt.z) * k;
    const gy = heightAt(bx, bz) + 0.7;
    const by = lookAt.y + (tmpV.y - lookAt.y) * k;
    if (by < gy) tmpV.y += (gy - by) / k;
  }
  cam.pos.lerp(tmpV, Math.min(1, dt * 14));
  if (cam.pos.distanceTo(tmpV) > 30) cam.pos.copy(tmpV);
  camera.position.copy(cam.pos);
  camera.lookAt(lookAt);
  // trauma-based shake: smooth noise, squared falloff, a little roll
  const tr = Math.min(1, G.shake) ** 2;
  if (tr > 0) {
    const t = clock.elapsedTime * 22;
    const nx = Math.sin(t * 1.3) + Math.sin(t * 2.7 + 1), ny = Math.sin(t * 1.7 + 2) + Math.sin(t * 3.1), nr = Math.sin(t * 1.1 + 4);
    camera.position.x += nx * tr * 0.25; camera.position.y += ny * tr * 0.25;
    camera.rotateZ(nr * tr * 0.05);
  }
  const fovT = G.mounted ? 62 + Math.min(skimmer.speed, 45) * 0.18 + (skimmer.boosting ? 6 : 0) : player.sprinting ? 67 : 62;
  camera.fov += (fovT - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();
}

function menuCamera(dt) {
  const t = performance.now() * 0.00004;
  const r = 70;
  const x = Math.cos(t) * r, z = Math.sin(t) * r;
  camera.position.set(x, heightAt(x, z) + 22, z);
  camera.lookAt(0, heightAt(0, 0) + 6, 0);
  input.consumeMouse();
}

function updateWorld(dt, t) {
  // shards shimmer
  for (const s of shards) {
    if (s.taken) continue;
    if (Math.abs(s.pos.x - camera.position.x) > 400 || Math.abs(s.pos.z - camera.position.z) > 400) continue;
    s.mesh.rotation.y = t * 0.4 + s.phase;
    s.mesh.position.y = s.pos.y + Math.sin(t * 1.5 + s.phase) * 0.12;
  }
  for (const c of condensers) {
    c.mesh.userData.vanes.rotation.y = t * 0.6;
    if (c.stakeCooldown > 0) c.stakeCooldown -= dt;
  }
  const bu = beacon.userData;
  bu.core.rotation.y = t; bu.core.position.y = 6 + Math.sin(t * 2) * 0.4;
  bu.beamM.opacity = (G.charged ? 0.38 : 0.2) + Math.sin(t * 3) * 0.05;
}

function updateStorm(dt) {
  if (!G.stormActive) {
    G.stormClock -= dt;
    if (G.stormClock < 18 && !G.stormWarned) { G.stormWarned = true; hud.toast('A sandstorm rolls in from the west. It masks your noise but blinds you.', 'warn', 5000); }
    if (G.stormClock <= 0) { G.stormActive = true; G.stormDur = 45 + Math.random() * 25; }
  } else {
    G.stormDur -= dt;
    if (G.stormDur <= 0) { G.stormActive = false; G.stormClock = 150 + Math.random() * 120; G.stormWarned = false; hud.toast('The storm has passed.', '', 2500); }
  }
  G.stormLevel += ((G.stormActive ? 1 : 0) - G.stormLevel) * Math.min(1, dt * 0.18);
}

function updatePlay(dt) {
  G.time += dt;
  // day counting
  if (G.lastTimeOfDay > 0.8 && sky.time < 0.3) G.days++;
  G.lastTimeOfDay = sky.time;

  if (input.hit('KeyF')) toggleMount();
  if (input.hit('KeyQ')) plantStake();
  if (input.hit('KeyM')) { G.mapOpen = !G.mapOpen; $('bigMap').classList.toggle('hidden', !G.mapOpen); }

  if (G.mounted) {
    skimmer.update(dt, input, true);
    player.position.copy(skimmer.position);
    const u = player.mesh.userData;
    player.mesh.position.copy(skimmer.mesh.localToWorld(tmpV.set(0, 0.0, -0.7)));
    player.mesh.quaternion.copy(skimmer.mesh.quaternion);
    u.legL.rotation.x = u.legR.rotation.x = -1.3;
    u.armL.rotation.x = u.armR.rotation.x = -1.0;
    u.body.position.y = -0.35;
  } else {
    player.update(dt, input, cam.yaw, true);
    skimmer.update(dt, input, false);
  }
  // skimmer furrows in the sand
  if (!skimmer.destroyed && skimmer.grounded && skimmer.speed > 3) {
    G.furrow = (G.furrow || 0) + skimmer.speed * dt;
    if (G.furrow > 1.3) {
      G.furrow = 0;
      for (const sd of [-1, 1]) {
        const x = skimmer.position.x + Math.cos(skimmer.yaw) * 1.35 * sd, z = skimmer.position.z - Math.sin(skimmer.yaw) * 1.35 * sd;
        tracks.add(x, z, skimmer.yaw, 0.7, 1.8, 30, clock.elapsedTime);
      }
    }
  }

  // interactions
  const it = nearestInteract();
  if (!it || !G.interact || it.kind !== G.interact.kind || it.ref !== G.interact.ref) G.holdProgress = 0;
  G.interact = it;
  let harvesting = false;
  if (it && input.down('KeyE') && it.time < Infinity) {
    G.holdProgress += dt;
    if (it.kind === 'shard') { harvesting = true; if (Math.random() < dt * 8) audio.harvest(); }
    if (G.holdProgress >= it.time) { completeInteract(it); G.holdProgress = 0; G.interact = null; }
  } else G.holdProgress = 0;

  // vibration sources -> the creature
  const storm = G.stormLevel;
  const src = G.mounted ? skimmer : player;
  let noise = G.mounted ? skimmer.noise : player.noise;
  if (!G.mounted && isSafe(player.position.x, player.position.z)) noise = 0;
  if (harvesting && !player.onRock) noise = Math.max(noise, 0.45);
  G.noise = noise;
  if (noise > 0) {
    const vel = G.mounted ? skimmer.velocity : player.velocity;
    creature.hear({ position: src.position, velocity: vel, kind: 'player' }, src.position.x, src.position.z, noise, dt, storm, 1 - sky.sunUp);
  }
  for (let i = stakes.length - 1; i >= 0; i--) {
    const s = stakes[i];
    s.life -= dt;
    s.mesh.userData.head.position.y = 1.25 + Math.abs(Math.sin(G.time * 10)) * 0.25;
    if (Math.random() < dt * 6) particles.emit(s.position.x, s.position.y + 0.2, s.position.z, (Math.random() - 0.5) * 3, 2, (Math.random() - 0.5) * 3, { life: 0.8, size: 0.7, gravity: -6 });
    if (s.life <= 0) { scene.remove(s.mesh); stakes.splice(i, 1); continue; }
    creature.hear(s, s.position.x, s.position.z, 1.15, dt, storm, 1 - sky.sunUp);
  }

  creature.update(dt, { player: src.position, storm, night: 1 - sky.sunUp, onStrike, onSlam, onBreach });
  if (creature.heardFlash > 0.99) hud.toast(G.stakes >= 0 && stakes.length ? 'Something takes the bait...' : 'The sand trembles. It heard you.', 'warn', 3000);
  if (creature.state === 'warn' && creature.stateTime < 0.05) G.shake = Math.max(G.shake, 0.6);

  // survival
  const sheltered = !G.mounted && condensers.some((c) => Math.hypot(c.pos.x - player.position.x, c.pos.z - player.position.z) < 6);
  const cloak = G.upgrades.has('cloak');
  const drain = (0.28 + sky.heat * 0.42 + (player.sprinting && !G.mounted ? 0.3 : 0) + storm * (cloak ? 0.1 : 0.3)) * (G.mounted ? 0.75 : 1) * (sheltered ? 0.3 : 1);
  G.water = Math.max(0, G.water - drain * dt);
  if (G.water <= 0) {
    G.health -= 3 * dt;
    if (!G.thirstWarned) { G.thirstWarned = true; hud.toast('You are dehydrating! Find water now.', 'warn', 4000); }
  } else if (G.water > 25 && G.health < 100) G.health = Math.min(100, G.health + 0.9 * dt);
  if (G.water > 20) G.thirstWarned = false;
  if (storm > 0.6 && !sheltered && !G.mounted) {
    G.health -= (cloak ? 0.18 : 0.6) * dt;
    if (!G.shelterHint) { G.shelterHint = true; hud.toast('The storm flays your skin. Shelter under a condenser awning.', 'warn', 4000); }
  }
  // extraction countdown
  if (G.extracting) {
    const db = Math.hypot(beaconPos.x - player.position.x, beaconPos.z - player.position.z);
    const near = !G.mounted && db < 14;
    if (near) G.extractT -= dt;
    else if (!G.awayWarned) { G.awayWarned = true; hud.toast('Get back to the beacon! The lift will not land without you.', 'warn', 3000); }
    if (near) G.awayWarned = false;
    G.stormActive = true; G.stormDur = Math.max(G.stormDur, 5);
    // the ray circles the mesa, drawn by the beacon's song
    if (creature.state === 'roam' || creature.state === 'search') { creature.target.set(beaconPos.x + 60, beaconPos.z); creature.displayTimer = Math.min(creature.displayTimer, 12); }
    if (G.extractT < 12) {
      lift.visible = true;
      const k = Math.max(0, G.extractT / 12);
      lift.position.set(beaconPos.x + 4, beaconPos.y + 3 + k * 120, beaconPos.z + 4);
      lift.rotation.y += dt * 0.3;
      if (Math.random() < 0.5) particles.burst(beaconPos.x + 4, beaconPos.y + 0.5, beaconPos.z + 4, 4, 8, { life: 1.5, size: 2, gravity: -2, alpha: 0.5 });
    }
    if (G.extractT <= 0) {
      $('flash').style.opacity = 1;
      setTimeout(() => { $('flash').style.opacity = 0; }, 900);
      endGame(true, 'Lifted off Oshar', `You carried ${G.shards} shards of sunglass out of the singing sands and read ${G.tabletsRead} of ${TABLETS.length} echo tablets.`);
    }
  }
  if (G.health <= 0) {
    G.health = 0;
    endGame(false, G.water <= 0 ? 'The sun drank you dry' : 'Lost to the storm', 'Plan routes between condensers and travel at night when the sand is cool.');
  }
  G.shake = Math.max(0, G.shake - dt * 1.2);
  G.hurtFlash = Math.max(0, G.hurtFlash - dt);
}

function updateHUD() {
  const p = G.mounted ? skimmer.position : player.position;
  hud.style('waterFill', 'width', `${(G.water / G.maxWater * 100).toFixed(1)}%`);
  const [objA, objB] = objectiveText();
  hud.set('objMain', objA); hud.set('objSub', objB);
  hud.style('healthFill', 'width', `${G.health.toFixed(1)}%`);
  hud.set('waterNum', Math.ceil(G.water));
  hud.set('healthNum', Math.ceil(G.health));
  hud.toggle('vitals', 'low', G.water < 25);
  hud.style('noiseFill', 'width', `${Math.min(100, (G.noise || 0) * 90).toFixed(0)}%`);
  const nz = G.noise || 0;
  hud.set('noiseTag', nz === 0 ? (isRock(p.x, p.z) ? 'ROCK' : 'STILL') : nz < 0.15 ? 'SOFT' : nz < 0.4 ? 'STEPS' : nz < 0.7 ? 'LOUD' : 'ROARING');
  hud.set('shardCount', G.shards);
  hud.set('stakeCount', G.stakes);
  hud.set('clockText', sky.clock);
  hud.set('clockIcon', sky.isNight ? '☾' : '☀');
  hud.toggle('stormWarn', 'hidden', !(G.stormActive || (G.stormWarned && G.stormClock < 18)));
  hud.set('stormWarn', G.stormActive ? 'SANDSTORM' : 'STORM INCOMING');
  hud.style('stormVeil', 'opacity', (G.stormLevel * 0.35).toFixed(2));

  const danger = creature.danger();
  hud.style('vignette', 'opacity', (creature.state === 'warn' ? 0.6 : 0).toFixed(2));
  G.danger = creature.state === 'warn' ? 1 : creature.state === 'hunt' ? danger * 0.55 : 0;

  const heading = bearing(Math.sin(cam.yaw), Math.cos(cam.yaw));
  const marks = {
    beacon: { b: bearing(beaconPos.x - p.x, beaconPos.z - p.z), cls: 'bea', icon: '◆' },
    ...(G.chapter === 1 ? { wreck: { b: bearing(wreckPos.x - p.x, wreckPos.z - p.z), cls: 'obj', icon: '✦' } } : {}),
  };
  let best = null, bd = Infinity;
  for (const c of condensers) { const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z); if (d < bd && d > 8) { bd = d; best = c; } }
  if (best) marks.con = { b: bearing(best.pos.x - p.x, best.pos.z - p.z), cls: 'con', icon: '💧' };
  if (!G.mounted && !skimmer.destroyed) marks.ski = { b: bearing(skimmer.position.x - p.x, skimmer.position.z - p.z), cls: 'ski', icon: '▣' };
  const rayB = bearing(creature.pos.x - p.x, creature.pos.y - p.z);
  const hunting = (['hunt', 'warn'].includes(creature.state) && creature.distanceTo < 300) || (G.upgrades.has('sense') && creature.distanceTo < 500);
  if (hunting) marks.ray = { b: rayB, cls: 'ray', icon: '≋' };
  hud.compass(heading, marks);
  const rel = Math.atan2(Math.sin(rayB - heading), Math.cos(rayB - heading));
  hud.tremor(hunting, rel, creature.state === 'warn' ? 'RUN!' : `TREMORS ${Math.round(creature.distanceTo)}m`);

  // interaction prompt
  const it = G.interact;
  const nearSkimmer = !G.mounted && !skimmer.destroyed && player.position.distanceTo(skimmer.position) < 4.5;
  if (it) {
    hud.toggle('prompt', 'hidden', false);
    hud.set('promptKey', it.time === Infinity ? '!' : 'E');
    hud.set('promptText', it.label);
    hud.style('promptRingFill', 'width', `${clamp(G.holdProgress / it.time, 0, 1) * 100}%`);
    hud.toggle('promptRing', 'hidden', it.time === Infinity);
  } else if (nearSkimmer || G.mounted) {
    hud.toggle('prompt', 'hidden', G.mounted && skimmer.speed > 3);
    hud.set('promptKey', 'F');
    hud.set('promptText', G.mounted ? 'Leave skimmer' : 'Board skimmer');
    hud.toggle('promptRing', 'hidden', true);
  } else hud.toggle('prompt', 'hidden', true);

  hud.toggle('vehicleHud', 'hidden', !G.mounted);
  if (G.mounted) { hud.set('speedNum', Math.round(skimmer.speed * 3.6)); hud.toggle('boostTag', 'on', skimmer.boosting); hud.style('boostFill', 'width', `${(skimmer.boostEnergy * 100).toFixed(0)}%`); }

  const pois = [];
  for (const c of condensers) pois.push({ x: c.pos.x, z: c.pos.z, r: 4, color: '#45c4ff' });
  pois.push({ x: beaconPos.x, z: beaconPos.z, r: 6, color: G.charged ? '#7ff6ff' : '#ff9a3c' });
  for (const r of ruins) pois.push({ x: r.pos.x, z: r.pos.z, r: 4.5, color: r.read ? '#9c8a70' : '#f3e6c4', square: true });
  if (!G.cellFound) pois.push({ x: wreckPos.x, z: wreckPos.z, r: 4, color: '#ffffff' });
  if (!skimmer.destroyed && !G.mounted) pois.push({ x: skimmer.position.x, z: skimmer.position.z, r: 3.5, color: '#ffffff', square: true });
  for (const s of stakes) pois.push({ x: s.position.x, z: s.position.z, r: 3, color: '#ff9a3c' });
  for (const s of shards) if (!s.taken && Math.hypot(s.pos.x - p.x, s.pos.z - p.z) < 90) pois.push({ x: s.pos.x, z: s.pos.z, r: 2.5, color: '#8fe9ff' });
  if (hunting) pois.push({ x: creature.pos.x, z: creature.pos.y, ring: 14, color: '#ff5a3c' });
  hud.minimap(p.x, p.z, heading, pois);
  if (G.mapOpen) hud.bigmap(p.x, p.z, heading, pois);
}

let frames = 0;
function frame() {
  requestAnimationFrame(frame);
  const rawDt = Math.min(clock.getDelta(), 1 / 20);
  G.slowmo = Math.max(0, (G.slowmo || 0) - rawDt);
  const timeScale = G.slowmo > 0.3 ? 0.3 : 1 - 0.7 * (G.slowmo / 0.3);
  const dt = rawDt * timeScale;
  const t = clock.elapsedTime;
  const playing = G.mode === 'play';

  if (playing) updatePlay(dt);
  if (G.mode === 'menu') {
    creature.update(dt, { player: new THREE.Vector3(0, 0, 0), storm: 0, night: 0, onStrike: () => {}, onSlam: () => {} });
    menuCamera(dt);
  } else if (G.mode !== 'pause') {
    updateCamera(dt, playing);
  } else input.consumeMouse();

  if (G.mode !== 'pause') {
    if (playing) updateStorm(dt);
    sky.update(dt, camera.position, G.stormLevel);
    terrainUniforms.uTime.value = t;
    terrainUniforms.uSunUp.value = sky.sunUp;
    const lu = lens.uniforms;
    lu.uTime.value = t;
    lu.uHeat.value = sky.heat * sky.sunUp * (1 - G.stormLevel) * (settings.quality === 'high' ? 1 : 0.6);
    lu.uStorm.value = G.stormLevel;
    lu.uStormColor.value.copy(scene.fog.color);
    lu.uYaw.value = cam.yaw;
    lu.uPitch.value = -cam.pitch * 0.5;
    lu.uAspect.value = camera.aspect;
    lu.uDanger.value = playing ? (G.danger || 0) : 0;
    lu.uHurt.value = G.hurtFlash || 0;
    lu.uNight.value = 1 - sky.sunUp;
    particles.update(dt);
    storm.update(dt, camera.position, G.stormLevel, heightAt(camera.position.x, camera.position.z), scene.fog.color);
    updateWorld(dt, t);
    tracks.update(t);
    wind.update(dt, camera.position, G.stormLevel, t);
  }
  if (playing) updateHUD();

  audio.update({
    storm: G.stormLevel,
    speed: G.mounted ? skimmer.speed : Math.hypot(player.velocity.x, player.velocity.z),
    rumble: playing ? creature.rumble() : G.mode === 'menu' ? 0.05 : 0,
    engine: G.mounted && playing ? 1 : 0,
    engineSpeed: skimmer.speed,
    danger: playing ? creature.danger() : 0,
    paused: G.mode === 'pause',
  });

  composer.render();
  input.endFrame();
  if (++frames === 2) $('loading').classList.add('hidden');
}

applySettings();
showScreen('loading');
requestAnimationFrame(() => {
  showScreen('menu');
  $('loading').classList.remove('hidden');
  frame();
});

// expose for debugging / automated checks
window.__glasswind = { G, player, skimmer, creature, sky, startGame, camera, tracks, scene, terrainUniforms, ruins, wreckPos, condensers, beaconPos, nearestInteract, completeInteract };
