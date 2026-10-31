// Journey Beyond: QLLG Game 1. A seated, guided journey; works in VR headsets (WebXR),
// phones and computers. Test switches: ?shot=ocean (one world, no UI), ?test&speed=8&auto
// (silent fast run-through), ?emulate (WebXR emulator for desktop testing).
import * as THREE from 'three';
import { AudioEngine } from './audio.js';
import { Orb } from './orb.js';
import { BUILDERS } from './worlds.js';
import { COLORS, disposeTree } from './gfx.js';
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
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 1200);
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --------------------------------------------------------------- HUD (camera) ---
const fade = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), new THREE.MeshBasicMaterial({
  color: 0x000000, transparent: true, opacity: 1, side: THREE.BackSide, depthTest: false, depthWrite: false,
  toneMapped: false, fog: false,
}));
fade.renderOrder = 10000;
camera.add(fade);
let fadeAnim = null;
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

// captions: DOM on screens, a floating panel in VR
const capEl = document.getElementById('caption');
const capCanvas = document.createElement('canvas');
capCanvas.width = 1024; capCanvas.height = 256;
const capTex = new THREE.CanvasTexture(capCanvas);
capTex.colorSpace = THREE.SRGBColorSpace;
const capPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshBasicMaterial({
  map: capTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
}));
capPanel.position.set(0, -0.42, -1.4);
capPanel.rotation.x = 0.22;
capPanel.renderOrder = 9999;
capPanel.visible = false;
camera.add(capPanel);
let capUntil = 0;

function drawPanel(text, title) {
  const g = capCanvas.getContext('2d');
  g.clearRect(0, 0, 1024, 256);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const size = title ? 54 : 42;
  g.font = `700 ${size}px Futura, "Avenir Next", "Century Gothic", sans-serif`;
  const words = text.split(' '), lines = [];
  let cur = '';
  for (const w of words) {
    const tryLine = cur ? cur + ' ' + w : w;
    if (g.measureText(tryLine).width > 960 && cur) { lines.push(cur); cur = w; } else cur = tryLine;
  }
  if (cur) lines.push(cur);
  const lh = size * 1.22, y0 = 128 - ((lines.length - 1) * lh) / 2;
  const bw = Math.min(1000, Math.max(...lines.map((l) => g.measureText(l).width)) + 70);
  const bh = lines.length * lh + 34;
  g.fillStyle = 'rgba(4, 8, 20, 0.55)';
  g.beginPath();
  g.roundRect(512 - bw / 2, 128 - bh / 2, bw, bh, 26);
  g.fill();
  g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 14;
  lines.forEach((l, i) => {
    g.fillStyle = title && i === lines.length - 1 ? '#ffcc4d' : '#ffffff';
    g.fillText(l, 512, y0 + i * lh);
  });
  capTex.needsUpdate = true;
}

function showCaption(text, seconds) {
  capEl.textContent = text;
  capEl.classList.add('on');
  drawPanel(text);
  capUntil = T + seconds / SPEED + 0.5;
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
  if (down && !down.moved) {
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
});

// VR controllers: point and press the trigger (or pinch) to gather a light
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
    const ray = new THREE.Raycaster();
    tmpM.identity().extractRotation(c.matrixWorld);
    ray.ray.origin.setFromMatrixPosition(c.matrixWorld);
    ray.ray.direction.set(0, 0, -1).applyMatrix4(tmpM);
    tryGather(ray);
  });
  rig.add(c);
}

// ------------------------------------------------------------------- state ---
const audio = new AudioEngine();
const env = { rig, camera, camWorld: new THREE.Vector3(), camDir: new THREE.Vector3() };
const ORBS = {
  truth: new Orb('truth', COLORS.truth, 523.25, 0),
  freedom: new Orb('freedom', COLORS.freedom, 587.33, 1),
  love: new Orb('love', COLORS.love, 659.25, 2),
  sovereignty: new Orb('sovereignty', COLORS.sovereignty, 783.99, 3),
};
const guide = new Orb('guide', COLORS.guide, 392.0, 0);
Object.values(ORBS).concat(guide).forEach((o) => scene.add(o.group));
const found = [];
let world = null, tickers = [], T = 0, active = null, seekT0 = 0, hintDone = false, hintAt = 0, hintId = null;
let breath = null, lift = null;
const hintEl = document.getElementById('hint');
const foundEl = document.getElementById('found');

function setWorld(name) {
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
  if (!SHOT && !TEST) audio.setWorld(name);
  log('world', name);
}

// --------------------------------------------------------------- gathering ---
function tryGather(ray) {
  if (!active || active.state !== 'wait') return;
  if (ray.intersectObject(active.hit, false).length) gather(active);
}

function gather(orb) {
  const ok = orb.collect(rig, camera, () => {
    found.push(orb);
    foundEl.children[found.length - 1]?.classList.add('lit');
    const done = orb.onGathered;
    orb.onGathered = null;
    done && done();
  });
  if (!ok) return;
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
const wait = (s) => new Promise((r) => setTimeout(r, (s * 1000) / SPEED));

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
  foundEl.hidden = false;
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
  capEl.classList.remove('on');
  foundEl.hidden = true;
  hintEl.style.opacity = 0;
  if (renderer.xr.isPresenting) {
    drawPanel('Thank you for traveling · QLLG.org', true);
    capPanel.position.set(0, 0, -1.4); capPanel.rotation.x = 0;
    capPanel.visible = true; capUntil = Infinity;
    setTimeout(() => renderer.xr.getSession()?.end(), 7000);
  }
  document.getElementById('end').classList.remove('hidden');
}

// -------------------------------------------------------------------- loop ---
let lastFrame = null;
renderer.setAnimationLoop((time) => {
  const dt = lastFrame === null ? 1 / 60 : Math.min(0.05, Math.max(0, (time - lastFrame) / 1000));
  lastFrame = time;
  T += dt;
  const xr = renderer.xr.isPresenting;
  if (!xr) {
    if (lookTarget !== null && T - lastInteract > 2.5) pitch += (lookTarget - pitch) * Math.min(1, dt * 0.9);
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
  if (world) {
    if (!SHOT) rig.position.addScaledVector(world.drift, dt);
    world.update(T, dt, env);
  }
  const px = xr ? 1.2 : renderer.getPixelRatio();
  tickers.forEach((f) => f(T, px));

  // breathing light
  if (guide.state !== 'hidden') {
    guide.update(T, dt, rig, camera, env.camDir);
    if (!guide.anim) {
      let s = 0.85;
      if (breath) {
        const e = T - breath.t0;
        s = e < breath.inhale ? 0.6 + 0.4 * Math.sin((e / breath.inhale) * Math.PI / 2)
          : 1.0 - 0.4 * Math.sin(Math.min(1, (e - breath.inhale) / breath.exhale) * Math.PI / 2);
      }
      guide.group.scale.setScalar(s * 1.35);
    }
  }
  Object.values(ORBS).forEach((o) => o.update(T, dt, rig, camera, env.camDir));

  // gaze: rest your eyes on the light
  let hovering = false;
  if (active && active.state === 'wait') {
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
  } else {
    reticle.material.uniforms.uProg.value = 0;
  }
  const retTarget = active ? (hovering ? 0.95 : 0.55) : 0;
  const ra = reticle.material.uniforms.uAlpha;
  ra.value += (retTarget - ra.value) * Math.min(1, dt * 6);

  if (fadeAnim) {
    fadeAnim.t += dt;
    const u = Math.min(1, fadeAnim.t / fadeAnim.d);
    fade.material.opacity = fadeAnim.from + (fadeAnim.to - fadeAnim.from) * u;
    if (u >= 1) { const r = fadeAnim.resolve; fadeAnim = null; r(); }
  }
  fade.visible = fade.material.opacity > 0.002;
  if (T > capUntil) capEl.classList.remove('on');
  capPanel.visible = xr && T < capUntil;

  renderer.render(scene, camera);
});

// ------------------------------------------------------------------ start up ---
const btnPlay = document.getElementById('btn-play');
const btnVR = document.getElementById('btn-vr');
const progressEl = document.getElementById('progress');
let started = false;

function begin() {
  if (started) return;
  started = true;
  audio.resume();
  document.getElementById('title').classList.add('hidden');
  journey().catch((e) => { console.error(e); log('error', e.message); });
}

async function boot() {
  await loadBody('./assets/body.bin');
  if (SHOT) {
    document.getElementById('title').classList.add('hidden');
    fade.material.opacity = 0;
    setWorld(SHOT);
    yaw = THREE.MathUtils.degToRad(Number(Q.get('yaw') || 0));
    pitch = THREE.MathUtils.degToRad(Number(Q.get('pitch') || 0));
    const orbName = { ocean: 'truth', forest: 'freedom', aurora: 'love', earth: 'sovereignty' }[SHOT];
    if (orbName && world.anchor) { ORBS[orbName].show(world.anchor(rig)); active = ORBS[orbName]; }
    if (SHOT === 'breath') showGuide(false);
    if (Q.has('finale') && SHOT === 'earth') {
      Object.values(ORBS).forEach((o, i) => { o.state = 'companion'; o.group.visible = true; o.group.scale.setScalar(0.38); });
      const tg = world.finaleTargets();
      Object.values(ORBS).forEach((o, i) => o.toFinale(scene, tg[i], 0));
      world.reveal();
    }
    return;
  }
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
    await audio.load('./audio', (p) => { progressEl.textContent = `Preparing the journey… ${Math.round(p * 100)}%`; });
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
    begin();
  } catch (e) {
    console.error(e);
    progressEl.textContent = 'Could not start VR on this device. Use “Begin the journey” instead.';
  }
});
document.getElementById('btn-again').addEventListener('click', () => location.reload());

window.JB = { scene, rig, camera, renderer, ORBS, audio, setWorld: (n) => setWorld(n), get world() { return world; } };
boot();
