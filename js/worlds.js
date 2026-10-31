// The worlds of Journey Beyond. Each builder returns
// { name, group (world content), follow (objects that travel with the viewer: sky, stars...),
//   fog, start: { pos, yaw }, drift (m/s), update(t, dt, env), anchor(t) for this world's light }.
import * as THREE from 'three';
import { skyDome, stars, drifters, glowSprite, glowTexture, fresnel, rng, COLORS } from './gfx.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ breath ---
export function breathWorld() {
  const group = new THREE.Group();
  const follow = [
    skyDome({ top: 0x04050d, horizon: 0x101a3c, bottom: 0x020309 }),
    stars({ count: 2400, seed: 11, size: 2.0 }),
  ];
  const dust = drifters({ count: 320, box: [-6, 6, -2.5, 3, -8, 4], color: 0x9fc4ff, size: 0.75, seed: 5, opacity: 0.5 });
  group.add(dust);
  return { name: 'breath', group, follow, fog: null, start: { pos: V3(0, 0, 0), yaw: 0 }, drift: V3(0, 0, 0), update() {} };
}

// -------------------------------------------------------------------- lift ---
export function liftWorld() {
  const group = new THREE.Group();
  const follow = [
    skyDome({ top: 0x050817, horizon: 0x172150, bottom: 0x070b1c }),
    stars({ count: 1600, seed: 21, size: 1.8, opacity: 0.8 }),
    drifters({ count: 240, box: [-3, 3, -3, 3, -4, 2], color: 0xbfe0ff, size: 0.7, seed: 9, rise: 0.4, span: 7, opacity: 0.7 }),
  ];
  // the resting body: lying on its back, head below the viewer, feet stretching ahead
  const body = new THREE.Group();
  const glow = fresnel(0xa8dcff, { power: 1.6, intensity: 1.25, base: 0.045 });
  const add = (geo, x, y, z, rx = Math.PI / 2, ry = 0) => {
    const m = new THREE.Mesh(geo, glow); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); body.add(m); return m;
  };
  add(new THREE.SphereGeometry(0.12, 24, 16), 0, 0, 0, 0);
  add(new THREE.CapsuleGeometry(0.17, 0.42, 6, 16), 0, 0, -0.42);
  add(new THREE.CapsuleGeometry(0.05, 0.55, 4, 10), 0.27, -0.02, -0.5, Math.PI / 2, 0.1);
  add(new THREE.CapsuleGeometry(0.05, 0.55, 4, 10), -0.27, -0.02, -0.5, Math.PI / 2, -0.1);
  add(new THREE.CapsuleGeometry(0.07, 0.78, 4, 12), 0.1, 0, -1.2);
  add(new THREE.CapsuleGeometry(0.07, 0.78, 4, 12), -0.1, 0, -1.2);
  body.position.set(0, -0.95, -0.1);
  group.add(body);
  const bed = new THREE.Mesh(new THREE.CircleGeometry(1.8, 48), new THREE.MeshBasicMaterial({
    map: glowTexture(), color: 0x3a6dff, transparent: true, opacity: 0.55, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  bed.rotation.x = -Math.PI / 2; bed.position.set(0, -1.12, -0.75);
  group.add(bed);
  // a faint cord of light from the body to the traveler
  const cordGeo = new THREE.BufferGeometry().setFromPoints([V3(0, 0, 0), V3(0, 1, 0)]);
  const cord = new THREE.Line(cordGeo, new THREE.LineBasicMaterial({
    color: 0xd8ecff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false,
  }));
  cord.frustumCulled = false;
  group.add(cord);
  const chest = V3(0, -0.85, -0.45);
  return {
    name: 'lift', group, follow, fog: null, start: { pos: V3(0, 0.45, 0.75), yaw: 0 }, drift: V3(0, 0, 0),
    update(t, dt, env) {
      const head = env.camWorld.clone().add(V3(0, -0.28, 0));
      const p = cord.geometry.attributes.position;
      p.setXYZ(0, chest.x, chest.y, chest.z); p.setXYZ(1, head.x, head.y, head.z); p.needsUpdate = true;
      cord.material.opacity = 0.42 * Math.max(0, 1 - env.rig.position.y / 5);
      body.children.forEach((m, i) => { m.scale.setScalar(1 + 0.02 * Math.sin(t * 1.4 + i)); });
    },
  };
}

// ------------------------------------------------------------------- ocean ---
const OCEAN_VS = /* glsl */`
  uniform float uTime;
  varying vec3 vWorld; varying vec3 vNormal;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float h = 0.0; vec2 grad = vec2(0.0);
    vec2 dirs[4]; dirs[0] = normalize(vec2(1.0, 0.3)); dirs[1] = normalize(vec2(-0.6, 1.0));
    dirs[2] = normalize(vec2(0.2, -1.0)); dirs[3] = normalize(vec2(-1.0, -0.4));
    float amps[4]; amps[0] = 0.16; amps[1] = 0.09; amps[2] = 0.05; amps[3] = 0.035;
    float lens[4]; lens[0] = 9.0; lens[1] = 5.3; lens[2] = 2.9; lens[3] = 1.7;
    for (int i = 0; i < 4; i++) {
      float k = 6.2831 / lens[i];
      float f = k * dot(dirs[i], wp.xz) + uTime * sqrt(9.8 * k) * 0.6;
      h += amps[i] * sin(f);
      grad += amps[i] * k * dirs[i] * cos(f);
    }
    wp.y += h;
    vNormal = normalize(vec3(-grad.x, 1.0, -grad.y));
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const OCEAN_FS = /* glsl */`
  uniform vec3 uDeep, uSky, uSunDir, uSunColor, uFog;
  uniform float uFogNear, uFogFar;
  varying vec3 vWorld; varying vec3 vNormal;
  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    vec3 R = reflect(-V, N);
    vec3 col = mix(uDeep, uSky, clamp(fres * 0.75 + 0.03, 0.0, 0.8));
    float s = max(dot(R, normalize(uSunDir)), 0.0);
    // the sun's golden path across the water
    vec3 toSun = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
    vec3 toPix = normalize(vec3(vWorld.x - cameraPosition.x, 0.0, vWorld.z - cameraPosition.z));
    float path = pow(max(dot(toSun, toPix), 0.0), 60.0);
    col += uSunColor * (pow(s, 220.0) * 3.0 + pow(s, 24.0) * 0.55 * (0.4 + path) + path * 0.18);
    float d = length(vWorld.xz - cameraPosition.xz);
    col = mix(col, uFog, smoothstep(uFogNear, uFogFar, d));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

export function oceanWorld() {
  const group = new THREE.Group();
  const sunDir = V3(0.0, 0.075, -1.0).normalize();
  const follow = [
    skyDome({ top: 0x22184a, horizon: 0xff8a48, bottom: 0xff9a5a, sunDir, sunColor: 0xffe2a8, sunPower: 1600, glowPower: 6, glow: 0.65 }),
    stars({ count: 500, seed: 31, size: 1.6, opacity: 0.55, minY: 0.35 }),
  ];
  const sun = glowSprite(0xffd8a0, 70, 0.9);
  sun.position.copy(sunDir).multiplyScalar(420);
  follow.push(sun);
  const mat = new THREE.ShaderMaterial({
    vertexShader: OCEAN_VS, fragmentShader: OCEAN_FS, toneMapped: false,
    uniforms: {
      uTime: { value: 0 }, uDeep: { value: new THREE.Color(0x07152f) }, uSky: { value: new THREE.Color(0x7a4a78) },
      uSunDir: { value: sunDir }, uSunColor: { value: new THREE.Color(0xffd9a0) }, uFog: { value: new THREE.Color(0xff9a60) },
      uFogNear: { value: 90 }, uFogFar: { value: 250 },
    },
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(480, 480, 200, 200), mat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.frustumCulled = false;
  group.add(ocean);
  return {
    name: 'ocean', group, follow, fog: null, start: { pos: V3(0, 2.4, 0), yaw: 0 }, drift: V3(0, 0, -0.9),
    update(t, dt, env) {
      mat.uniforms.uTime.value = t;
      ocean.position.x = Math.round(env.rig.position.x / 4) * 4;
      ocean.position.z = Math.round(env.rig.position.z / 4) * 4;
    },
    anchor: (rig) => (t) => rig.position.clone().add(V3(6.0, 0.6, -1.0)),
  };
}

// ------------------------------------------------------------------ forest ---
export function forestWorld() {
  const group = new THREE.Group();
  const follow = [
    skyDome({ top: 0x040815, horizon: 0x10304d, bottom: 0x050a12 }),
    stars({ count: 1800, seed: 41, size: 1.9, opacity: 0.85, minY: 0.2 }),
  ];
  const moonDir = V3(-0.35, 0.42, -0.84).normalize();
  const moon = glowSprite(0xdfe9ff, 46, 0.95); moon.position.copy(moonDir).multiplyScalar(400); follow.push(moon);
  const moonCore = glowSprite(0xffffff, 10, 1.0); moonCore.position.copy(moonDir).multiplyScalar(399); follow.push(moonCore);

  group.add(new THREE.HemisphereLight(0x6a8fd0, 0x0f2018, 1.25));
  const dl = new THREE.DirectionalLight(0xb4c8ff, 1.1); dl.position.copy(moonDir).multiplyScalar(50); group.add(dl);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: 0x0a1712 }));
  ground.rotation.x = -Math.PI / 2; group.add(ground);

  const r = rng(77), N = 190;
  const trunkG = new THREE.CylinderGeometry(0.16, 0.3, 1, 7); trunkG.translate(0, 0.5, 0);
  const coneG = new THREE.ConeGeometry(1, 1, 9); coneG.translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x24190f }), N);
  const lower = new THREE.InstancedMesh(coneG, new THREE.MeshLambertMaterial({ color: 0x14473d, emissive: 0x03120d }), N);
  const upper = new THREE.InstancedMesh(coneG, new THREE.MeshLambertMaterial({ color: 0x1a5a4b, emissive: 0x04160f }), N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const side = r() < 0.5 ? -1 : 1;
    const x = side * (2.6 + Math.pow(r(), 1.4) * 34);
    const z = 14 - r() * 190;
    const h = 7 + r() * 6, w = 1.6 + r() * 1.2;
    q.setFromAxisAngle(V3(0, 1, 0), r() * 6.28);
    trunks.setMatrixAt(i, m.compose(p.set(x, 0, z), q, s.set(1, h, 1)));
    lower.setMatrixAt(i, m.compose(p.set(x, h * 0.25, z), q, s.set(w, h * 0.55, w)));
    upper.setMatrixAt(i, m.compose(p.set(x, h * 0.55, z), q, s.set(w * 0.68, h * 0.5, w * 0.68)));
  }
  group.add(trunks, lower, upper);
  const flies = drifters({ count: 1300, box: [-12, 12, 0.3, 5.0, 8, -70], color: 0xd2ff7a, size: 2.1, seed: 13 });
  group.add(flies);
  return {
    name: 'forest', group, follow, fog: new THREE.FogExp2(0x0b1d30, 0.042), start: { pos: V3(0, 1.6, 0), yaw: 0 },
    drift: V3(0, 0, -0.7), update() {},
    anchor: (rig) => (t) => rig.position.clone().add(V3(-5.2 + Math.sin(t * 0.7) * 1.3, 0.4 + Math.sin(t * 1.4) * 0.5, -1.6 + Math.cos(t * 0.45) * 1.1)),
  };
}

// ------------------------------------------------------------------ aurora ---
const AURORA_VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const AURORA_FS = /* glsl */`
  uniform float uTime, uSeed; uniform vec3 uLow, uHigh;
  varying vec2 vUv;
  void main() {
    float x = vUv.x, y = vUv.y;
    float bands = 0.5 + 0.5 * sin(x * 46.0 + sin(x * 6.0 + uTime * 0.25 + uSeed) * 3.2 + uTime * 0.5);
    bands = pow(bands, 2.6);
    float curtain = smoothstep(0.0, 0.18, y) * (1.0 - smoothstep(0.45, 1.0, y));
    float flow = 0.55 + 0.45 * sin(x * 9.0 - uTime * 0.35 + y * 2.5 + uSeed);
    float edge = smoothstep(0.0, 0.12, x) * smoothstep(1.0, 0.88, x);
    vec3 col = mix(uLow, uHigh, smoothstep(0.2, 0.95, y));
    float a = curtain * (0.3 + 0.7 * bands) * flow * edge * 0.9;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

function ribbon(radius, y0, height, arc, centre, low, high, seed) {
  const g = new THREE.PlaneGeometry(1, 1, 90, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) + 0.5, v = pos.getY(i) + 0.5;
    const th = centre + (u - 0.5) * arc;
    const rr = radius + Math.sin(u * 9 + seed) * 9;
    pos.setXYZ(i, Math.sin(th) * rr, y0 + v * height + Math.sin(u * 5 + seed) * 6, -Math.cos(th) * rr);
  }
  g.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    vertexShader: AURORA_VS, fragmentShader: AURORA_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    uniforms: { uTime: { value: 0 }, uSeed: { value: seed }, uLow: { value: new THREE.Color(low) }, uHigh: { value: new THREE.Color(high) } },
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  return mesh;
}

function mountainRing(radius, hMin, hMax, seed, base, rock, snow) {
  const r = rng(seed), N = 260;
  const pos = [], col = [], idx = [];
  const cBase = new THREE.Color(base), cRock = new THREE.Color(rock), cSnow = new THREE.Color(snow);
  const f = [r() * 6, r() * 6, r() * 6, r() * 6];
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI * 2;
    let h = 0.5 + 0.28 * Math.sin(th * 3 + f[0]) + 0.18 * Math.sin(th * 7 + f[1]) + 0.12 * Math.sin(th * 17 + f[2])
      + 0.07 * Math.sin(th * 41 + f[3]);
    h += (r() - 0.5) * 0.16;
    h = hMin + (hMax - hMin) * Math.min(1, Math.max(0, h));
    const rr = radius + (r() - 0.5) * radius * 0.08;
    const x = Math.sin(th) * rr, z = -Math.cos(th) * rr;
    const ridge = h * (0.72 + r() * 0.08);
    pos.push(x, -2, z, x * 1.004, ridge, z * 1.004, x, h, z);
    col.push(cBase.r, cBase.g, cBase.b, cRock.r, cRock.g, cRock.b, cSnow.r, cSnow.g, cSnow.b);
    if (i < N) {
      const a = i * 3;
      idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false }));
  m.frustumCulled = false;
  return m;
}

export function auroraWorld() {
  const group = new THREE.Group();
  const follow = [
    skyDome({ top: 0x01030b, horizon: 0x0a1f33, bottom: 0x0b1626 }),
    stars({ count: 3000, seed: 51, size: 2.0, minY: 0.05 }),
  ];
  const ribbons = [
    ribbon(150, 38, 70, 2.4, 0.0, 0x2bff98, 0xff5fae, 1.3),
    ribbon(175, 52, 80, 2.0, -0.9, 0x29e6ff, 0xc56bff, 3.7),
    ribbon(140, 30, 60, 1.6, 1.2, 0x48ff8d, 0xff7ab8, 6.1),
    ribbon(185, 45, 75, 2.2, 2.9, 0x2bffb0, 0xff6fa0, 8.4),
  ];
  ribbons.forEach((rb) => follow.push(rb));
  // the traveler floats high: near peaks sit below eye level, the far range rises behind them
  const far = mountainRing(210, 40, 95, 61, 0x050b16, 0x1c2a42, 0x8ea6cc); far.position.y = -38;
  const near = mountainRing(95, 14, 46, 62, 0x02050b, 0x111b2c, 0x6c84aa); near.position.y = -44;
  follow.push(far, near);
  const snow = new THREE.Mesh(new THREE.CircleGeometry(400, 64), new THREE.MeshBasicMaterial({ color: 0x15243a, toneMapped: false }));
  snow.rotation.x = -Math.PI / 2; snow.position.y = -45;
  follow.push(snow);
  return {
    name: 'aurora', group, follow, fog: null, start: { pos: V3(0, 0, 0), yaw: 0 }, drift: V3(0, 0, -0.35),
    update(t) { ribbons.forEach((rb) => { rb.material.uniforms.uTime.value = t; }); },
    anchor: (rig) => (t) => rig.position.clone().add(V3(-3.0 + Math.sin(t * 0.5) * 0.6, 6.0 + Math.sin(t * 0.8) * 0.4, -5.5)),
  };
}

// ------------------------------------------------------------------- earth ---
const NOISE = /* glsl */`
  float hash31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x), mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x), mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }`;
const EARTH_VS = /* glsl */`
  varying vec3 vLocal; varying vec3 vN; varying vec3 vV;
  void main() {
    vLocal = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const EARTH_FS = /* glsl */`
  uniform float uBoost, uTime;
  varying vec3 vLocal; varying vec3 vN; varying vec3 vV;
  ${NOISE}
  void main() {
    vec3 p = normalize(vLocal);
    float land = smoothstep(0.47, 0.515, fbm(p * 1.7 + vec3(3.1, 1.7, 0.4)));
    float lat = asin(clamp(p.y, -1.0, 1.0));
    float lon = atan(p.z, p.x);
    vec2 g = vec2(lon, lat) * (60.0 / 3.14159);
    vec2 cell = fract(g) - 0.5;
    float dots = smoothstep(0.30, 0.12, length(cell));
    float glat = abs(fract(lat * (6.0 / 3.14159)) - 0.5);
    float glon = abs(fract(lon * (6.0 / 3.14159)) - 0.5);
    float grid = smoothstep(0.485, 0.5, max(glat, glon));
    float fres = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.3);
    vec3 ocean = vec3(0.01, 0.07, 0.24);
    vec3 col = ocean + vec3(0.25, 0.75, 1.0) * land * (0.25 + 1.1 * dots) + vec3(0.2, 0.55, 1.0) * grid * 0.35;
    col += vec3(0.25, 0.65, 1.0) * fres * 1.15;
    col *= 1.0 + uBoost;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;
const SHELL_FS = /* glsl */`
  uniform float uTime, uReveal;
  uniform vec3 uC0, uC1, uC2, uC3;
  varying vec3 vLocal; varying vec3 vN; varying vec3 vV;
  void main() {
    vec3 p = normalize(vLocal);
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
    float k = fract(p.y * 1.2 + atan(p.z, p.x) * 0.159 + uTime * 0.06);
    vec3 col = k < 0.25 ? mix(uC0, uC1, k * 4.0) : k < 0.5 ? mix(uC1, uC2, (k - 0.25) * 4.0) : k < 0.75 ? mix(uC2, uC3, (k - 0.5) * 4.0) : mix(uC3, uC0, (k - 0.75) * 4.0);
    float bands = 0.6 + 0.4 * sin(p.y * 22.0 + uTime * 1.3);
    float a = (fres * 0.95 + 0.06) * bands * uReveal;
    gl_FragColor = vec4(col * a, a);
    #include <colorspace_fragment>
  }`;

export function earthWorld() {
  const group = new THREE.Group();
  const follow = [
    skyDome({ top: 0x00010a, horizon: 0x030617, bottom: 0x00010a }),
    stars({ count: 4200, seed: 71, size: 2.1, minY: -1 }),
  ];
  [[0x6a3cff, -0.7, 0.3, -0.6], [0x1f6bff, 0.8, -0.2, -0.55], [0xff4fa6, 0.2, 0.55, 0.8]].forEach(([c, x, y, z]) => {
    const n = glowSprite(c, 260, 0.1); n.position.set(x, y, z).normalize().multiplyScalar(420); follow.push(n);
  });
  const centre = V3(0, -1.2, -17);
  const R = 6.2;
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), new THREE.ShaderMaterial({
    vertexShader: EARTH_VS, fragmentShader: EARTH_FS, toneMapped: false,
    uniforms: { uBoost: { value: 0 }, uTime: { value: 0 } },
  }));
  earth.position.copy(centre);
  earth.rotation.set(0.35, 0, 0.12);
  group.add(earth);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.1, 64, 48),
    fresnel(0x4fb4ff, { power: 3.2, intensity: 1.6, base: 0.0, side: THREE.BackSide }));
  atmo.position.copy(centre);
  group.add(atmo);
  const rings = [];
  [[R * 1.32, 0.35, 0.2], [R * 1.5, -0.6, 1.1], [R * 1.22, 1.1, -0.4]].forEach(([rr, rx, rz], i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.018, 6, 360), new THREE.MeshBasicMaterial({
      color: i === 1 ? 0xffffff : 0x7fd8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    }));
    ring.position.copy(centre); ring.rotation.set(rx, 0, rz);
    group.add(ring); rings.push(ring);
  });
  const shellMat = new THREE.ShaderMaterial({
    vertexShader: EARTH_VS, fragmentShader: SHELL_FS, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 }, uReveal: { value: 0 },
      uC0: { value: new THREE.Color(COLORS.truth) }, uC1: { value: new THREE.Color(COLORS.freedom) },
      uC2: { value: new THREE.Color(COLORS.love) }, uC3: { value: new THREE.Color(COLORS.sovereignty) },
    },
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(R * 1.28, 96, 64), shellMat);
  shell.position.copy(centre);
  group.add(shell);
  const state = { reveal: 0, revealTarget: 0, boost: 0 };
  const world = {
    name: 'earth', group, follow, fog: null, start: { pos: V3(0, 0, 0), yaw: 0 }, drift: V3(0, 0, -0.08),
    centre, R,
    update(t, dt) {
      earth.rotation.y = t * 0.05;
      earth.material.uniforms.uTime.value = t;
      rings.forEach((rg, i) => { rg.rotation.y = t * (0.05 + i * 0.03) * (i % 2 ? -1 : 1); });
      state.reveal += (state.revealTarget - state.reveal) * Math.min(1, dt * 0.6);
      shellMat.uniforms.uReveal.value = state.reveal;
      shellMat.uniforms.uTime.value = t;
      earth.material.uniforms.uBoost.value = state.reveal * 0.55;
    },
    anchor: () => (t) => centre.clone().add(V3(Math.cos(0.5 + Math.sin(t * 0.3) * 0.25) * (R + 1.4), 2.3, Math.sin(0.5 + Math.sin(t * 0.3) * 0.25) * (R + 1.4) * 0.6)),
    finaleTargets() {
      return [V3(-1, 1, 0.7), V3(1, 1, 0.7), V3(-1, -0.6, 0.8), V3(1, -0.6, 0.8)]
        .map((d) => centre.clone().addScaledVector(d.normalize(), R * 1.28));
    },
    reveal() { state.revealTarget = 1; },
  };
  return world;
}

export const BUILDERS = { breath: breathWorld, lift: liftWorld, ocean: oceanWorld, forest: forestWorld, aurora: auroraWorld, earth: earthWorld };
export { glowSprite, COLORS };
