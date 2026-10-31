// Journey Beyond: QLLG Game 1. A seated, guided journey; works in VR headsets (WebXR),
// phones and computers. Test switches: ?shot=ocean (one world, no UI), ?test&speed=8&auto
// (silent fast run-through), ?emulate (WebXR emulator for desktop testing), ?nobloom.
import * as THREE from 'three';
import { EffectComposer } from '../lib/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../lib/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../lib/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../lib/addons/postprocessing/OutputPass.js';
import { AudioEngine } from './audio.js';
import { Orb } from './orb.js';
import { BUILDERS } from './worlds.js';
import { COLORS, disposeTree, glowTexture } from './gfx.js';
import { loadBody } from './body.js';

const Q = new URLSearchParams(location.search);
const SHOT = Q.get('shot');
const TEST = Q.has('test');
const AUTO = Q.has('auto');
const SPEED = Number(Q.get('speed') || 1);
const EMULATE = Q.has('emulate');
const log = (...a) => console.log('[journey]', ...a);

// ------------------------------------------------------------------ renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;     // colours are authored directly; the glow pass adds the bloom
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 1200);
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

// glow (bloom) for phones and computers; VR headsets render directly
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.55, 0.55);
composer.addPass(bloom);
composer.addPass(new OutputPass());
let bloomOn = !Q.has('nobloom');
const BLOOM = {   // strength, radius, threshold per world
  breath: [0.95, 0.6, 0.5], lift: [0.9, 0.6, 0.45], ocean: [0.32, 0.45, 0.92], forest: [0.95, 0.6, 0.55],
  aurora: [0.42, 0.5, 0.78], earth: [0.9, 0.55, 0.55],
};

addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// --------------------------------------------------------------- HUD (camera) ---
function hudSphere(radius, order) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false,
    toneMapped: false, fog: false,
  }));
  m.renderOrder = order;
  camera.add(m);
  return m;
}
const fade = hudSphere(0.25, 10000);
fade.material.opacity = 1;
const flash = hudSphere(0.24, 9997);
let fadeAnim = null, flashT0 = -99, flashPeak = 0;
function fadeTo(color, opacity, seconds) {
  return new Promise((resolve) => {
    fade.material.color.set(color);
    fadeAnim = { from: fade.material.opacity, to: opacity, t: 0, d: Math.max(0.01, seconds / SPEED), resolve };
  });
}

const reticle = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.075), new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  uniforms: { uProg: { value: 0 }, uAlpha: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform float uProg, uAlpha; varying vec2 vUv;
    void main(){
      vec2 d = vUv - 0.5; float r = length(d) * 2.0;
      float a01 = fract(0.25 - atan(d.y, d.x) / 6.28318);
      float ring = smoothstep(0.62, 0.68, r) * (1.0 - smoothstep(0.9, 0.96, r));
      float dotm = 1.0 - smoothstep(0.14, 0.22, r);
      float a = dotm * 0.8 + max(ring * step(a01, uProg), ring * 0.2);
      gl_FragColor = vec4(vec3(1.0), a * uAlpha);
    }`,
}));
reticle.position.set(0, 0, -1.2);
reticle.renderOrder = 9998;
camera.add(reticle);

// text panels for VR (captions below, words and pause notice above)
function textPanel(w, h, x, y, z, tilt) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  }));
  mesh.position.set(x, y, z);
  mesh.rotation.x = tilt;
  mesh.renderOrder = 9999;
  mesh.visible = false;
  camera.add(mesh);
  return { mesh, c, tex };
}
const capPanel = textPanel(1.2, 0.3, 0, -0.42, -1.4, 0.22);
const wordPanel = textPanel(1.4, 0.35, 0, 0.16, -1.6, -0.05);
const capEl = document.getElementById('caption');
const wordEl = document.getElementById('word');
let capUntil = 0, wordUntil = 0;

function drawPanel(panel, text, { color = '#ffffff', size = 42, backing = true, tracking = 0 } = {}) {
  const g = panel.c.getContext('2d');
  g.clearRect(0, 0, 1024, 256);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${size}px Futura, "Avenir Next", "Century Gothic", sans-serif`;
  if ('letterSpacing' in g) g.letterSpacing = `${tracking}px`;
  const words = text.split(' '), lines = [];
  let cur = '';
  for (const w of words) {
    const tryLine = cur ? cur + ' ' + w : w;
    if (g.measureText(tryLine).width > 960 && cur) { lines.push(cur); cur = w; } else cur = tryLine;
  }
  if (cur) lines.push(cur);
  const lh = size * 1.22, y0 = 128 - ((lines.length - 1) * lh) / 2;
  if (backing) {
    const bw = Math.min(1000, Math.max(...lines.map((l) => g.measureText(l).width)) + 70);
    const bh = lines.length * lh + 34;
    g.fillStyle = 'rgba(4, 8, 20, 0.55)';
    g.beginPath();
    g.roundRect(512 - bw / 2, 128 - bh / 2, bw, bh, 26);
    g.fill();
  }
  g.shadowColor = backing ? 'rgba(0,0,0,0.9)' : color;
  g.shadowBlur = backing ? 14 : 30;
  g.fillStyle = color;
  lines.forEach((l, i) => g.fillText(l, 512, y0 + i * lh));
  panel.tex.needsUpdate = true;
}

function showCaption(text, seconds) {
  capEl.textContent = text;
  capEl.classList.add('on');
  drawPanel(capPanel, text);
  capUntil = T + seconds / SPEED + 0.5;
}

function showWord(text, color, seconds = 2.6) {
  const css = '#' + new THREE.Color(color).getHexString();
  wordEl.textContent = text;
  wordEl.style.color = css;
  wordEl.style.textShadow = `0 0 28px ${css}, 0 2px 16px rgba(0,0,0,.55), 0 0 3px rgba(0,0,0,.7)`;
  wordEl.classList.remove('on');
  void wordEl.offsetWidth;
  wordEl.classList.add('on');
  drawPanel(wordPanel, text, { color: css, size: 92, backing: false, tracking: 18 });
  wordUntil = T + seconds;
}

// ------------------------------------------------------------------- input ---
let yaw = 0, pitch = 0, lookTarget = null, lastInteract = -99;
let down = null;
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, id: e.pointerId };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!down || e.pointerId !== down.id) return;
  const dx = e.clientX - down.lx, dy = e.clientY - down.ly;
  down.lx = e.clientX; down.ly = e.clientY;
  if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 8) down.moved = true;
  const k = e.pointerType === 'touch' ? 0.0055 : 0.0042;
  yaw += dx * k;
  pitch = THREE.MathUtils.clamp(pitch + dy * k, -1.35, 1.35);
  lastInteract = T;
  hintEl.style.opacity = 0;
});
canvas.addEventListener('pointerup', (e) => {
  if (down && !down.moved && !paused) {
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    tryGather(ray);
  }
  down = null;
});
addEventListener('keydown', (e) => {
  const step = 0.08;
  if (e.key === 'ArrowLeft') yaw += step;
  if (e.key === 'ArrowRight') yaw -= step;
  if (e.key === 'ArrowUp') pitch = Math.min(1.35, pitch + step);
  if (e.key === 'ArrowDown') pitch = Math.max(-1.35, pitch - step);
  if (e.key.startsWith('Arrow')) lastInteract = T;
  if (e.key === ' ' || e.key.toLowerCase() === 'p') { e.preventDefault(); setPaused(!paused); }
  if (e.key === 'Escape') setPaused(true);
});

// VR controllers: point and pull the trigger (or pinch) to gather a light; squeeze the grip to pause
const tmpM = new THREE.Matrix4();
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, toneMapped: false }));
  line.scale.z = 3;
  line.visible = false;
  c.add(line);
  c.addEventListener('connected', (ev) => { line.visible = ev.data && ev.data.targetRayMode === 'tracked-pointer'; });
  c.addEventListener('disconnected', () => { line.visible = false; });
  c.addEventListener('selectstart', () => {
    if (paused) { setPaused(false); return; }
    const ray = new THREE.Raycaster();
    tmpM.identity().extractRotation(c.matrixWorld);
    ray.ray.origin.setFromMatrixPosition(c.matrixWorld);
    ray.ray.direction.set(0, 0, -1).applyMatrix4(tmpM);
    tryGather(ray);
  });
  c.addEventListener('squeezestart', () => setPaused(!paused));
  rig.add(c);
}

// ------------------------------------------------------------------- state ---
const audio = new AudioEngine();
const env = { rig, camera, camWorld: new THREE.Vector3(), camDir: new THREE.Vector3(), breath: 0.85 };
const ORBS = {
  truth: new Orb('truth', COLORS.truth, 523.25, 0),
  freedom: new Orb('freedom', COLORS.freedom, 587.33, 1),
  love: new Orb('love', COLORS.love, 659.25, 2),
  sovereignty: new Orb('sovereignty', COLORS.sovereignty, 783.99, 3),
};
const NAMES = { truth: 'TRUTH', freedom: 'FREEDOM', love: 'LOVE', sovereignty: 'SOVEREIGNTY' };
const guide = new Orb('guide', COLORS.guide, 392.0, 0);
Object.values(ORBS).concat(guide).forEach((o) => scene.add(o.group));
const found = [];
let world = null, tickers = [], T = 0, active = null, seekT0 = 0, hintDone = false, hintAt = 0, hintId = null;
let breath = null, lift = null, titleMode = false, started = false, finished = false;
let paused = false, autoPaused = false;
const timers = [], bursts = [];
const hintEl = document.getElementById('hint');
const foundEl = document.getElementById('found');
const pauseBtn = document.getElementById('btn-pause');
const pauseEl = document.getElementById('paused');

function setWorld(name, quiet = false) {
  if (world) {
    scene.remove(world.group);
    world.follow.forEach((o) => rig.remove(o));
    disposeTree(world.group);
    world.follow.forEach(disposeTree);
  }
  world = BUILDERS[name]();
  scene.add(world.group);
  world.follow.forEach((o) => rig.add(o));
  scene.fog = world.fog;
  rig.position.copy(world.start.pos);
  rig.rotation.set(0, world.start.yaw, 0);
  if (!renderer.xr.isPresenting) { yaw = 0; pitch = 0; }
  tickers = [];
  [world.group, ...world.follow].forEach((root) => root.traverse((o) => { if (o.userData.tick) tickers.push(o.userData.tick); }));
  const [s, r, th] = BLOOM[name] || [0.85, 0.55, 0.55];
  bloom.strength = s; bloom.radius = r; bloom.threshold = th;
  if (!quiet && !SHOT && !TEST) audio.setWorld(name);
  log('world', name);
}

// ------------------------------------------------------------------- pause ---
function setPaused(p, auto = false) {
  if (!started || finished || p === paused) return;
  paused = p;
  autoPaused = p && auto;
  if (!TEST) { if (p) audio.ctx.suspend(); else audio.ctx.resume(); }
  pauseBtn.classList.toggle('is-paused', p);
  pauseBtn.setAttribute('aria-label', p ? 'Resume' : 'Pause');
  pauseEl.classList.toggle('hidden', !p || renderer.xr.isPresenting);
  if (p && renderer.xr.isPresenting) {
    drawPanel(wordPanel, 'Paused · squeeze or pull the trigger to continue', { size: 44 });
    wordUntil = Infinity;
  } else if (!p) {
    wordUntil = Math.min(wordUntil, T);
  }
  log(p ? 'paused' : 'resumed');
}
pauseBtn.addEventListener('click', () => setPaused(!paused));
document.getElementById('btn-resume').addEventListener('click', () => setPaused(false));
document.getElementById('btn-restart').addEventListener('click', () => location.reload());
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true, true); });

// --------------------------------------------------------------- gathering ---
function tryGather(ray) {
  if (!active || active.state !== 'wait' || paused) return;
  if (ray.intersectObject(active.hit, false).length) gather(active);
}

const BURST_VS = /* glsl */`
  attribute vec3 aDir; uniform float uAge, uPixel; varying float vA;
  void main() {
    vec3 p = position + aDir * (1.0 - exp(-uAge * 2.6));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vA = clamp(1.0 - uAge / 1.8, 0.0, 1.0);
    gl_PointSize = clamp(uPixel * 26.0 / max(-mv.z, 0.4), 2.0, 40.0);
  }`;
const BURST_FS = /* glsl */`
  uniform vec3 uColor; varying float vA;
  void main() { float d = length(gl_PointCoord - 0.5); float c = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor * (0.7 + c), c * c * vA);
    #include <colorspace_fragment>
  }`;
function spawnBurst(pos, color) {
  const n = 170, p = new Float32Array(n * 3), d = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize()
      .multiplyScalar(0.5 + Math.random() * 1.6);
    p.set([pos.x, pos.y, pos.z], i * 3);
    d.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aDir', new THREE.BufferAttribute(d, 3));
  const m = new THREE.ShaderMaterial({
    vertexShader: BURST_VS, fragmentShader: BURST_FS, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uAge: { value: 0 }, uPixel: { value: 1 }, uColor: { value: new THREE.Color(color) } },
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  scene.add(pts);
  bursts.push({ pts, born: T });
}

function gather(orb) {
  const at = orb.group.getWorldPosition(new THREE.Vector3());
  const ok = orb.collect(rig, camera, () => {
    found.push(orb);
    foundEl.children[found.length - 1]?.classList.add('lit');
    const done = orb.onGathered;
    orb.onGathered = null;
    done && done();
  });
  if (!ok) return;
  spawnBurst(at, orb.color);
  flash.material.color.copy(orb.color);
  flashT0 = T; flashPeak = 0.32;
  showWord(NAMES[orb.name] || orb.name.toUpperCase(), orb.color);
  if (!TEST) audio.gather(orb.note);
  active = null;
  hintEl.style.opacity = 0;
  log('gathered', orb.name);
}

function seek(orb, anchorFn, hint) {
  return new Promise((resolve) => {
    orb.show(anchorFn);
    orb.onGathered = resolve;
    active = orb;
    seekT0 = T; hintDone = false; hintId = hint;
    if (!renderer.xr.isPresenting && T - lastInteract > 30) {
      hintEl.textContent = 'Drag to look around · look at the light, or tap it';
      hintEl.style.opacity = 1;
    }
  });
}

// ------------------------------------------------------------------ helpers ---
// waits run on game time, so pausing freezes the whole journey
const wait = (s) => new Promise((r) => timers.push({ at: T + s / SPEED, r }));

async function say(id) {
  const line = audio.lines[id];
  if (!line) return;
  if (TEST) { showCaption(line.text, line.dur); await wait(line.dur); return; }
  await audio.say(id, (text, dur) => showCaption(text, dur));
}

async function breatheCycle(inhale, exhale, words) {
  breath = { t0: T, inhale: inhale / SPEED, exhale: exhale / SPEED };
  if (!TEST) audio.breath(inhale, exhale);
  if (words) {
    say('breath_in');
    await wait(inhale);
    say('breath_out');
    await wait(exhale);
  } else {
    await wait(inhale + exhale);
  }
}

function startLift(seconds, height) {
  lift = { t0: T, d: seconds / SPEED, y0: rig.position.y, y1: rig.position.y + height };
}

function showGuide(warm) {
  guide.state = 'hidden';
  guide.show(() => new THREE.Vector3(0, 0.05, -2.1).applyMatrix4(rig.matrixWorld));
  guide.inner.material.color.set(warm ? 0xffe6b8 : COLORS.guide);
  guide.outer.material.color.set(warm ? 0xffd08a : COLORS.guide);
}

function hideGuide() { guide.state = 'hidden'; guide.group.visible = false; }

function companionsHome() {
  found.forEach((o) => {
    rig.attach(o.group);
    o.state = 'companion';
    o.anim = null;
    o.group.scale.setScalar(0.24);
  });
}

// ----------------------------------------------------------------- journey ---
async function journey() {
  log('start');
  if (fade.material.opacity < 0.99) await fadeTo(0x000000, 1, 1.4);
  titleMode = false;
  foundEl.hidden = false;
  pauseBtn.hidden = false;
  setWorld('breath');
  showGuide(false);
  await fadeTo(0x000000, 0, 3);
  await say('intro_1'); await wait(0.7);
  await say('intro_2'); await wait(0.9);
  await say('intro_3'); await wait(0.4);
  await breatheCycle(4, 6, true);
  await breatheCycle(4, 6, true);
  await breatheCycle(4, 6, false);
  breath = null;
  await say('intro_4'); await wait(1.2);

  await fadeTo(0x000000, 1, 1.6);
  hideGuide();
  setWorld('lift');
  lookTarget = -0.62;
  await fadeTo(0x000000, 0, 2.2);
  await say('lift_1'); await wait(0.6);
  await say('lift_2'); await wait(0.4);
  startLift(16, 4.2);
  lookTarget = 0;
  await say('lift_3'); await wait(1.4);
  lookTarget = -0.5;
  await say('lift_4'); await wait(0.8);
  lookTarget = 0;
  await say('lift_5'); await wait(0.6);

  await fadeTo(0xffffff, 1, 2.0);
  setWorld('ocean');
  lookTarget = null;
  await fadeTo(0xffffff, 0, 2.5);
  await say('ocean_1'); await wait(0.6);
  const pTruth = seek(ORBS.truth, world.anchor(rig), 'ocean_hint');
  await say('ocean_2');
  await pTruth;
  await say('ocean_got'); await wait(1.2);

  await fadeTo(0x000000, 1, 1.8);
  setWorld('forest');
  companionsHome();
  await fadeTo(0x000000, 0, 2.4);
  await say('forest_1'); await wait(0.6);
  const pFree = seek(ORBS.freedom, world.anchor(rig), 'forest_hint');
  await say('forest_2');
  await pFree;
  await say('forest_got'); await wait(1.2);

  await fadeTo(0x000000, 1, 1.8);
  setWorld('aurora');
  companionsHome();
  await fadeTo(0x000000, 0, 2.6);
  await say('aurora_1'); await wait(0.6);
  const pLove = seek(ORBS.love, world.anchor(rig), 'aurora_hint');
  await say('aurora_2');
  await pLove;
  await say('aurora_got'); await wait(1.2);

  await fadeTo(0xffffff, 1, 2.0);
  setWorld('earth');
  companionsHome();
  await fadeTo(0xffffff, 0, 3.0);
  await say('earth_1'); await wait(0.8);
  const pSov = seek(ORBS.sovereignty, world.anchor(rig), 'earth_hint');
  await say('earth_2');
  await pSov;
  await say('earth_got'); await wait(0.8);

  // the four lights join around the Earth
  const targets = world.finaleTargets();
  found.forEach((o, i) => o.toFinale(scene, targets[i], i * 0.35));
  if (!TEST) { audio.chord([523.25, 587.33, 659.25, 783.99]); audio.brighten(8); }
  const finaleSay = say('finale_1');
  await wait(2.4);
  world.reveal();
  bloom.strength = 1.15;
  await finaleSay; await wait(1.0);
  await say('finale_2'); await wait(2.5);

  await fadeTo(0xffffff, 1, 2.6);
  setWorld('breath');
  companionsHome();
  showGuide(true);
  await fadeTo(0xffffff, 0, 3.0);
  await say('return_1'); await wait(1.0);
  await say('return_2'); await wait(1.4);
  await say('return_3'); await wait(1.0);
  await breatheCycle(4, 6, false);
  breath = null;
  await say('return_4'); await wait(2.0);
  await say('return_5'); await wait(1.0);
  if (!TEST) audio.fadeOutAll(4);
  await fadeTo(0x000000, 1, 3.5);
  log('done');
  finish();
}

function finish() {
  finished = true;
  capEl.classList.remove('on');
  foundEl.hidden = true;
  pauseBtn.hidden = true;
  hintEl.style.opacity = 0;
  if (renderer.xr.isPresenting) {
    drawPanel(capPanel, 'Thank you for traveling · QLLG.org', { color: '#ffcc4d', size: 54 });
    capPanel.mesh.position.set(0, 0, -1.4); capPanel.mesh.rotation.x = 0;
    capUntil = Infinity;
    setTimeout(() => renderer.xr.getSession()?.end(), 7000);
  }
  document.getElementById('end').classList.remove('hidden');
}

// -------------------------------------------------------------------- loop ---
let lastFrame = null, perfFrames = 0, perfSum = 0;
renderer.setAnimationLoop((time) => {
  const real = lastFrame === null ? 1 / 60 : Math.min(0.05, Math.max(0, (time - lastFrame) / 1000));
  lastFrame = time;
  const dt = paused ? 0 : real;
  T += dt;
  const xr = renderer.xr.isPresenting;

  // automatic quality: if a phone can't keep up, drop the glow and render at 1x
  if (started && !xr && bloomOn && !paused && perfFrames < 180) {
    perfFrames++; perfSum += real;
    if (perfFrames === 180 && perfSum / 180 > 0.03) {
      bloomOn = false;
      renderer.setPixelRatio(1);
      log('quality: glow off for this device');
    }
  }
  for (let i = timers.length - 1; i >= 0; i--) {
    if (T >= timers[i].at) { const { r } = timers[i]; timers.splice(i, 1); r(); }
  }
  if (!xr) {
    if (titleMode) { yaw = Math.sin(T * 0.05) * 0.16; pitch = 0.4; }
    else if (lookTarget !== null && T - lastInteract > 2.5) pitch += (lookTarget - pitch) * Math.min(1, dt * 0.9);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }
  if (lift) {
    const u = Math.min(1, (T - lift.t0) / lift.d);
    rig.position.y = lift.y0 + (lift.y1 - lift.y0) * (u * u * (3 - 2 * u));
    if (u >= 1) lift = null;
  }
  rig.updateMatrixWorld(true);
  camera.getWorldPosition(env.camWorld);
  camera.getWorldDirection(env.camDir);

  // breathing light (and the breath world's pattern breathes with it)
  let s = 0.85;
  if (breath) {
    const e = T - breath.t0;
    s = e < breath.inhale ? 0.6 + 0.4 * Math.sin((e / breath.inhale) * Math.PI / 2)
      : 1.0 - 0.4 * Math.sin(Math.min(1, (e - breath.inhale) / breath.exhale) * Math.PI / 2);
  }
  env.breath = s;
  if (world) {
    if (!SHOT && !titleMode) rig.position.addScaledVector(world.drift, dt);
    world.update(T, dt, env);
  }
  const px = xr ? 1.2 : renderer.getPixelRatio();
  tickers.forEach((f) => f(T, px));
  if (guide.state !== 'hidden') {
    guide.update(T, dt, rig, camera, env.camDir);
    if (!guide.anim) guide.group.scale.setScalar(s * 1.35);
  }
  Object.values(ORBS).forEach((o) => o.update(T, dt, rig, camera, env.camDir));
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i], age = T - b.born;
    b.pts.material.uniforms.uAge.value = age;
    b.pts.material.uniforms.uPixel.value = px;
    if (age > 1.9) { scene.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose(); bursts.splice(i, 1); }
  }

  // gaze: rest your eyes on the light
  let hovering = false;
  if (active && active.state === 'wait' && !paused) {
    const ray = new THREE.Raycaster(env.camWorld, env.camDir);
    hovering = ray.intersectObject(active.hit, false).length > 0;
    active.gaze = hovering ? Math.min(1, active.gaze + dt / 1.1) : Math.max(0, active.gaze - dt * 1.6);
    reticle.material.uniforms.uProg.value = active.gaze;
    if (active.gaze >= 1) gather(active);
    else if (AUTO && T - seekT0 > 2.0 / SPEED) gather(active);
    else if (!hintDone && T - seekT0 > 16 / SPEED && !audio.speaking) {
      hintDone = true; hintAt = T;
      say(hintId);
    } else if (hintDone && active) {
      active.assist = Math.min(1, (T - hintAt) / (7 / SPEED));
    }
  } else if (!active) {
    reticle.material.uniforms.uProg.value = 0;
  }
  const retTarget = active ? (hovering ? 0.95 : 0.55) : 0;
  const ra = reticle.material.uniforms.uAlpha;
  ra.value += (retTarget - ra.value) * Math.min(1, real * 6);

  if (fadeAnim) {
    fadeAnim.t += dt;
    const u = Math.min(1, fadeAnim.t / fadeAnim.d);
    fade.material.opacity = fadeAnim.from + (fadeAnim.to - fadeAnim.from) * u;
    if (u >= 1) { const r = fadeAnim.resolve; fadeAnim = null; r(); }
  }
  fade.visible = fade.material.opacity > 0.002;
  flash.material.opacity = Math.max(0, flashPeak * (1 - (T - flashT0) / 0.9));
  flash.visible = flash.material.opacity > 0.002;
  if (T > capUntil) capEl.classList.remove('on');
  if (T > wordUntil) wordEl.classList.remove('on');
  capPanel.mesh.visible = xr && T < capUntil;
  wordPanel.mesh.visible = xr && T < wordUntil;

  if (xr || !bloomOn) renderer.render(scene, camera);
  else composer.render();
});

// ------------------------------------------------------------------ start up ---
const btnPlay = document.getElementById('btn-play');
const btnVR = document.getElementById('btn-vr');
const progressEl = document.getElementById('progress');

function begin() {
  if (started) return;
  started = true;
  audio.resume();
  document.getElementById('title').classList.add('hidden');
  journey().catch((e) => { console.error(e); log('error', e.message); });
}

async function boot() {
  const V = window.JB_BUILD || '0';
  await loadBody(`./assets/body.bin?v=${V}`);
  if (SHOT) {
    document.getElementById('title').classList.add('hidden');
    fade.material.opacity = 0;
    setWorld(SHOT);
    yaw = THREE.MathUtils.degToRad(Number(Q.get('yaw') || 0));
    pitch = THREE.MathUtils.degToRad(Number(Q.get('pitch') || 0));
    const orbName = { ocean: 'truth', forest: 'freedom', aurora: 'love', earth: 'sovereignty' }[SHOT];
    if (orbName && world.anchor && !Q.has('finale')) { ORBS[orbName].show(world.anchor(rig)); active = ORBS[orbName]; }
    if (SHOT === 'breath') { showGuide(false); breath = { t0: 0, inhale: 4, exhale: 6 }; }
    if (Q.has('finale') && SHOT === 'earth') {
      Object.values(ORBS).forEach((o) => { o.state = 'companion'; o.group.visible = true; o.group.scale.setScalar(0.38); });
      const tg = world.finaleTargets();
      Object.values(ORBS).forEach((o, i) => o.toFinale(scene, tg[i], 0));
      world.reveal();
      bloom.strength = 1.15;
    }
    return;
  }
  // the living title screen: the Earth turning slowly behind the title
  titleMode = true;
  setWorld('earth', true);
  rig.position.set(0, 2.5, 13);          // further back, so the Earth rises from the bottom of the screen
  fade.material.opacity = 0;
  if (EMULATE) {
    const { XRDevice, metaQuest3 } = await import('../lib/iwer.module.min.js');
    const dev = new XRDevice(metaQuest3);
    dev.installRuntime({ forceInstall: true });
    window.__xrDevice = dev;
  }
  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-vr').then((ok) => { btnVR.hidden = !ok; }).catch(() => {});
  }
  try {
    await audio.load('./audio', V, (p) => { progressEl.textContent = `Preparing the journey… ${Math.round(p * 100)}%`; });
  } catch (e) {
    console.error(e);
  }
  progressEl.textContent = '';
  btnPlay.disabled = false;
  btnPlay.textContent = 'Begin the journey';
  if (TEST && !EMULATE) begin();
}

btnPlay.addEventListener('click', begin);
btnVR.addEventListener('click', async () => {
  try {
    audio.resume();
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    await renderer.xr.setSession(session);
    session.addEventListener('visibilitychange', () => {
      if (session.visibilityState !== 'visible') setPaused(true, true);
      else if (autoPaused) setPaused(false);
    });
    begin();
  } catch (e) {
    console.error(e);
    progressEl.textContent = 'Could not start VR on this device. Use “Begin the journey” instead.';
  }
});
document.getElementById('btn-again').addEventListener('click', () => location.reload());

window.JB = {
  scene, rig, camera, renderer, composer, ORBS, audio, bloom, setWorld: (n) => setWorld(n), setPaused,
  get world() { return world; }, get paused() { return paused; }, get T() { return T; },
};
boot();
