// The worlds of Journey Beyond. Each builder returns
// { name, group (world content), follow (objects that travel with the viewer: sky, stars...),
//   fog, start: { pos, yaw }, drift (m/s), update(t, dt, env), anchor(t) for this world's light }.
import * as THREE from 'three';
import { skyDome, stars, drifters, glowSprite, glowTexture, fresnel, rng, COLORS } from './gfx.js';
import { makeBody } from './body.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ breath ---
function circleLine(r, mat, segs = 160) {
  const pts = [];
  for (let i = 0; i <= segs; i++) { const a = (i / segs) * Math.PI * 2; pts.push(V3(Math.cos(a) * r, Math.sin(a) * r, 0)); }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
}

export function breathWorld() {
  const group = new THREE.Group();
  const follow = [
    skyDome({ top: 0x04050d, horizon: 0x101a3c, bottom: 0x020309 }),
    stars({ count: 2400, seed: 11, size: 2.0 }),
  ];
  // soft nebula colours far away
  [[0x3a2a9a, -0.5, 0.25, -0.8, 300, 0.2], [0x1d5bd0, 0.62, 0.1, -0.75, 260, 0.18], [0x7a2f8f, 0.12, 0.55, -0.6, 220, 0.14],
   [0x135a7a, -0.3, -0.25, -0.9, 240, 0.16], [0x5a2ab0, 0.85, 0.4, 0.2, 230, 0.12]].forEach(([c, x, y, z, sc, op]) => {
    const n = glowSprite(c, sc, op); n.position.set(x, y, z).normalize().multiplyScalar(420); follow.push(n);
  });
  const dust = drifters({ count: 320, box: [-6, 6, -2.5, 3, -8, 4], color: 0x9fc4ff, size: 0.75, seed: 5, opacity: 0.5 });
  group.add(dust);

  // the "seed of life" drawn in light behind the guiding light; it breathes with you
  const lineMat = (c, o) => new THREE.LineBasicMaterial({
    color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const inner = lineMat(0x9fd0ff, 0.3), outer = lineMat(0xffd98a, 0.26), faint = lineMat(0x9fd0ff, 0.12);
  const mandala = new THREE.Group();
  const R = 0.5;
  mandala.add(circleLine(R, inner));
  for (let k = 0; k < 6; k++) {
    const c = circleLine(R, inner);
    c.position.set(Math.cos((k * Math.PI) / 3) * R, Math.sin((k * Math.PI) / 3) * R, 0);
    mandala.add(c);
  }
  mandala.add(circleLine(R * 2, outer), circleLine(R * 2.12, faint), circleLine(R * 2.6, faint));
  for (let k = 0; k < 12; k++) {
    const dot = glowSprite(0xffe2a0, 0.09, 0.8);
    dot.position.set(Math.cos((k * Math.PI) / 6) * R * 2.12, Math.sin((k * Math.PI) / 6) * R * 2.12, 0);
    mandala.add(dot);
  }
  mandala.position.set(0, 0.05, -3.4);
  group.add(mandala);
  return {
    name: 'breath', group, follow, fog: null, start: { pos: V3(0, 0, 0), yaw: 0 }, drift: V3(0, 0, 0),
    update(t, dt, env) {
      const b = Math.min(1, Math.max(0, (env.breath - 0.6) / 0.4));
      mandala.rotation.z = t * 0.025;
      mandala.scale.setScalar(0.78 + 0.42 * b);
      inner.opacity = 0.18 + 0.22 * b;
      outer.opacity = 0.14 + 0.2 * b;
    },
  };
}

// -------------------------------------------------------------------- lift ---
export function liftWorld() {
  const group = new THREE.Group();
  const follow = [
    skyDome({ top: 0x060a1f, horizon: 0x1b2a66, bottom: 0x080d26 }),
    stars({ count: 1800, seed: 21, size: 1.9, opacity: 0.85 }),
    drifters({ count: 240, box: [-3, 3, -3, 3, -4, 2], color: 0xbfe0ff, size: 0.7, seed: 9, rise: 0.4, span: 7, opacity: 0.6 }),
  ];
  [[0x3b2aa8, -0.6, 0.35, -0.7], [0x1f5bd8, 0.7, 0.2, -0.65]].forEach(([c, x, y, z]) => {
    const n = glowSprite(c, 240, 0.12); n.position.set(x, y, z).normalize().multiplyScalar(420); follow.push(n);
  });

  // the resting body: lying on its back, head below the traveler, feet stretching ahead
  const body = makeBody();
  body.position.set(0, -0.95, -0.1);
  group.add(body);
  const heartWorld = body.userData.heartLocal.clone().add(body.position);
  const heartGlow = glowSprite(0xffc48a, 0.55, 0.55);
  heartGlow.position.copy(heartWorld).add(V3(0, 0.05, 0));
  group.add(heartGlow);

  // bed of light with slowly turning rings
  const bed = new THREE.Mesh(new THREE.CircleGeometry(1.9, 64), new THREE.MeshBasicMaterial({
    map: glowTexture(), color: 0x2f62ff, transparent: true, opacity: 0.6, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  bed.rotation.x = -Math.PI / 2; bed.position.set(0, -1.1, -0.85);
  group.add(bed);
  const rings = [];
  [[1.15, 0.006, 0.55], [1.42, 0.004, 0.35], [1.7, 0.003, 0.22]].forEach(([r, w, op], i) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - w, r + w, 160), new THREE.MeshBasicMaterial({
      color: i === 0 ? 0xcfe6ff : 0x7fb2ff, transparent: true, opacity: op, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(0, -1.095, -0.85);
    group.add(ring); rings.push(ring);
  });
  const ringDots = drifters({ count: 90, box: [-1.6, 1.6, -1.09, -1.08, -2.4, 0.7], color: 0x9fc8ff, size: 0.25, seed: 33, opacity: 0.5 });
  group.add(ringDots);

  // a soft, swaying cord of light from the heart to the traveler, with pulses rising along it
  const N = 48;
  const cordGeo = new THREE.BufferGeometry();
  cordGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const cord = new THREE.Line(cordGeo, new THREE.LineBasicMaterial({
    color: 0xd8ecff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false,
  }));
  cord.frustumCulled = false;
  group.add(cord);
  const pulses = [0, 0.33, 0.66].map(() => { const s = glowSprite(0xe8f4ff, 0.12, 0.9); group.add(s); return s; });
  const curve = new THREE.CatmullRomCurve3([V3(), V3(), V3(), V3()]);
  return {
    name: 'lift', group, follow, fog: null, start: { pos: V3(0, 0.45, 0.75), yaw: 0 }, drift: V3(0, 0, 0),
    update(t, dt, env) {
      const head = env.camWorld.clone().add(V3(0, -0.3, 0));
      const a = heartWorld, b = head;
      const sway = Math.sin(t * 0.8) * 0.08, sway2 = Math.cos(t * 0.6) * 0.06;
      curve.points[0].copy(a);
      curve.points[1].lerpVectors(a, b, 0.33).add(V3(sway, 0.05, sway2));
      curve.points[2].lerpVectors(a, b, 0.66).add(V3(-sway2, 0.0, sway));
      curve.points[3].copy(b);
      const arr = cordGeo.attributes.position.array, q = new THREE.Vector3();
      for (let i = 0; i < N; i++) { curve.getPoint(i / (N - 1), q); arr[i * 3] = q.x; arr[i * 3 + 1] = q.y; arr[i * 3 + 2] = q.z; }
      cordGeo.attributes.position.needsUpdate = true;
      const fadeUp = Math.max(0, 1 - (env.rig.position.y - 0.45) / 4.5);
      cord.material.opacity = 0.5 * fadeUp;
      pulses.forEach((s, i) => {
        const u = (t * 0.22 + i / 3) % 1;
        curve.getPoint(u, s.position);
        s.material.opacity = 0.9 * fadeUp * Math.sin(u * Math.PI);
      });
      rings.forEach((r, i) => { r.rotation.z = t * (0.04 + i * 0.02) * (i % 2 ? -1 : 1); });
      heartGlow.material.opacity = 0.4 + 0.2 * Math.sin(t * 2 * Math.PI * 0.9);
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
    skyDome({ top: 0x1c1440, horizon: 0xff8a48, bottom: 0xff9a5a, sunDir, sunColor: 0xffe2a8, sunPower: 1600, glowPower: 16, glow: 0.6 }),
    stars({ count: 500, seed: 31, size: 1.6, opacity: 0.55, minY: 0.35 }),
  ];
  const sun = glowSprite(0xffd8a0, 70, 0.9);
  sun.position.copy(sunDir).multiplyScalar(420);
  follow.push(sun);
  // soft sunset cloud banks low over the horizon
  const rc = rng(91);
  for (let i = 0; i < 9; i++) {
    const az = (rc() - 0.5) * 2.2, el = 0.04 + rc() * 0.12;
    const c = glowSprite([0xff9f7a, 0xffb48c, 0xc77aa6, 0xff8f6e][i % 4], 1, 0.28 + rc() * 0.3);
    c.scale.set(150 + rc() * 120, 22 + rc() * 22, 1);
    c.position.set(Math.sin(az), el, -Math.cos(az)).normalize().multiplyScalar(400);
    follow.push(c);
  }
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

  group.add(new THREE.HemisphereLight(0x5a7fc0, 0x0a140f, 0.8));
  const dl = new THREE.DirectionalLight(0xb4c8ff, 0.8); dl.position.copy(moonDir).multiplyScalar(50); group.add(dl);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: 0x060d0a }));
  ground.rotation.x = -Math.PI / 2; group.add(ground);

  const r = rng(77), N = 190;
  const trunkG = new THREE.CylinderGeometry(0.16, 0.3, 1, 7); trunkG.translate(0, 0.5, 0);
  const coneG = new THREE.ConeGeometry(1, 1, 10); coneG.translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x24190f }), N);
  // three tiers per pine, darker below and moonlit above
  const tierDefs = [[0x103a31, 0x020c09, 0.18, 0.46, 1.0], [0x15493d, 0x03100c, 0.38, 0.4, 0.74], [0x1c5c4c, 0x041510, 0.58, 0.36, 0.48]];
  const tiers = tierDefs.map(([c, e]) => new THREE.InstancedMesh(coneG, new THREE.MeshLambertMaterial({ color: c, emissive: e }), N));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const side = r() < 0.5 ? -1 : 1;
    const x = side * (2.6 + Math.pow(r(), 1.4) * 34);
    const z = 14 - r() * 190;
    const h = 7 + r() * 7, w = 1.5 + r() * 1.3;
    const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.08, r() * 6.28, (r() - 0.5) * 0.08));
    trunks.setMatrixAt(i, m.compose(p.set(x, 0, z), lean, s.set(1, h, 1)));
    tierDefs.forEach(([, , y, hh, ww], k) => {
      tiers[k].setMatrixAt(i, m.compose(p.set(x, h * y, z), lean, s.set(w * ww, h * hh, w * ww)));
    });
  }
  group.add(trunks, ...tiers);
  // glowing flowers and mushrooms on the forest floor
  const fr = rng(17), fn = 900, fpos = new Float32Array(fn * 3), fcol = new Float32Array(fn * 3);
  const palette = [new THREE.Color(0x4dffd8), new THREE.Color(0xb18cff), new THREE.Color(0xffe08a), new THREE.Color(0x7fc8ff)];
  let k = 0;
  while (k < fn) {
    const cx = (fr() < 0.5 ? -1 : 1) * (1.4 + fr() * 11), cz = 7 - fr() * 78, col = palette[Math.floor(fr() * palette.length)];
    const count = 6 + Math.floor(fr() * 12);
    for (let j = 0; j < count && k < fn; j++, k++) {
      const a = fr() * 6.28, d = Math.sqrt(fr()) * 0.7;
      fpos.set([cx + Math.cos(a) * d, 0.04 + fr() * 0.22, cz + Math.sin(a) * d], k * 3);
      fcol.set([col.r, col.g, col.b], k * 3);
    }
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  fg.setAttribute('color', new THREE.BufferAttribute(fcol, 3));
  group.add(new THREE.Points(fg, new THREE.PointsMaterial({
    map: glowTexture(), size: 0.22, vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false, sizeAttenuation: true, fog: false,
  })));
  // shafts of moonlight between the trees: brightest in the middle, fading at their edges and ends
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uColor: { value: new THREE.Color(0xa9c4ff) }, uOpacity: { value: 0.11 } },
    vertexShader: `varying float vY; varying float vFace;
      void main(){ vY = uv.y; vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 n = normalize(mat3(modelMatrix) * normal); vFace = abs(dot(n, normalize(cameraPosition - wp.xyz)));
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vY; varying float vFace;
      void main(){ float along = smoothstep(0.0, 0.35, vY) * (1.0 - smoothstep(0.75, 1.0, vY));
        float a = pow(vFace, 2.2) * along * uOpacity; gl_FragColor = vec4(uColor * a, a);
        #include <colorspace_fragment>
      }`,
  });
  const beamDir = moonDir.clone().negate();
  [[-3.5, -16, 2.2], [4.2, -27, 2.8], [-5.5, -41, 3.2], [3.0, -55, 2.6]].forEach(([bx, bz, br]) => {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(br * 0.55, br, 34, 32, 1, true), beamMat);
    beam.quaternion.setFromUnitVectors(V3(0, -1, 0), beamDir);
    beam.position.set(bx, 0, bz).addScaledVector(beamDir, -17);
    group.add(beam);
  });
  const flies = drifters({ count: 1300, box: [-12, 12, 0.3, 5.0, 8, -70], color: 0xd2ff7a, size: 2.1, seed: 13 });
  group.add(flies);
  // low moonlit mist drifting between the trees
  const rm = rng(55);
  for (let i = 0; i < 12; i++) {
    const mist = new THREE.Mesh(new THREE.CircleGeometry(9 + rm() * 6, 40), new THREE.MeshBasicMaterial({
      map: glowTexture(), color: 0x7f9ed6, transparent: true, opacity: 0.03 + rm() * 0.035, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    }));
    mist.rotation.x = -Math.PI / 2;
    mist.position.set((rm() - 0.5) * 18, 0.25 + rm() * 0.6, 6 - rm() * 70);
    group.add(mist);
  }
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
    float a = curtain * (0.3 + 0.7 * bands) * flow * edge * 0.62;
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

function valueNoise(seed) {
  const r = rng(seed), P = new Uint16Array(512), V = new Float32Array(256);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
  for (let i = 0; i < 256; i++) V[i] = r();
  const val = (ix, iz) => V[P[(ix & 255) + P[iz & 255]]];
  return (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = val(ix, iz) + (val(ix + 1, iz) - val(ix, iz)) * u;
    const b = val(ix, iz + 1) + (val(ix + 1, iz + 1) - val(ix, iz + 1)) * u;
    return a + (b - a) * v;
  };
}

// snow-capped mountains: ridged noise rising into a ring of high peaks around a quiet valley
function terrain(seed) {
  const n = valueNoise(seed);
  const ridged = (x, z) => { let s = 0, a = 0.55, f = 1; for (let o = 0; o < 5; o++) { const v = 1 - Math.abs(2 * n(x * f, z * f) - 1); s += v * v * a; a *= 0.5; f *= 2.1; } return s; };
  const fbm = (x, z) => { let s = 0, a = 0.5, f = 1; for (let o = 0; o < 4; o++) { s += n(x * f + 13.1, z * f + 7.7) * a; a *= 0.5; f *= 2.03; } return s; };
  const size = 780, seg = 200;
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const ring = Math.min(1, Math.max(0, (Math.hypot(x, z) - 55) / 250));
    pos.setY(i, ridged(x * 0.0085, z * 0.0085) * (7 + 112 * ring * ring) + fbm(x * 0.045, z * 0.045) * 2.2 - 6);
  }
  g.computeVertexNormals();
  const nrm = g.attributes.normal, col = new Float32Array(pos.count * 3);
  const rock = new THREE.Color(0x070b14), mid = new THREE.Color(0x1b2640), snow = new THREE.Color(0x8fa3cc), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const ny = nrm.getY(i), h = pos.getY(i);
    const flat = Math.min(1, Math.max(0, (ny - 0.62) / 0.25));
    const high = Math.min(1, Math.max(0, (h - 4) / 40));
    const sn = Math.min(1, flat * (0.25 + 0.8 * high) + high * 0.35);
    c.copy(rock).lerp(mid, Math.min(1, ny * 0.9)).lerp(snow, sn);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.frustumCulled = false;
  return mesh;
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
  group.add(terrain(62));
  group.add(new THREE.HemisphereLight(0x4a64a0, 0x05080f, 0.32));
  const moon = new THREE.DirectionalLight(0xb9c9ff, 0.8); moon.position.set(70, 90, -30); group.add(moon);
  const green = new THREE.DirectionalLight(0x46ffa6, 0.38); green.position.set(0, 70, -140); group.add(green);
  const rose = new THREE.DirectionalLight(0xff6fb6, 0.22); rose.position.set(-100, 60, -60); group.add(rose);
  return {
    name: 'aurora', group, follow, fog: new THREE.FogExp2(0x0a1828, 0.0028), start: { pos: V3(0, 16, 0), yaw: 0 },
    drift: V3(0, 0, -0.35),
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
