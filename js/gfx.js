// Shared visual building blocks: sky domes, star fields, glow sprites, fresnel materials.
import * as THREE from 'three';

export const COLORS = {
  truth: 0xffd35c, freedom: 0x5cffa0, love: 0xff7aa8, sovereignty: 0xb98cff, guide: 0xcfe6ff,
};

// deterministic PRNG so every run builds the same worlds
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let _glow = null;
export function glowTexture() {
  if (_glow) return _glow;
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0.0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  _glow = new THREE.CanvasTexture(c);
  _glow.colorSpace = THREE.SRGBColorSpace;
  return _glow;
}

export function glowSprite(color, scale, opacity = 1) {
  const m = new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
  });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(scale);
  return s;
}

const SKY_VS = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const SKY_FS = /* glsl */`
  uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor;
  uniform float uSun, uSunPower, uGlowPower, uGlow;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.5))
                       : mix(uHorizon, uBottom, pow(clamp(-h, 0.0, 1.0), 0.45));
    if (uSun > 0.5) {
      float s = max(dot(d, normalize(uSunDir)), 0.0);
      col += uSunColor * (pow(s, uSunPower) * 1.6 + pow(s, uGlowPower) * uGlow);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

export function skyDome({ top, horizon, bottom, sunDir = null, sunColor = 0xffffff, sunPower = 900, glowPower = 8, glow = 0.5 }) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, toneMapped: false,
    uniforms: {
      uTop: { value: new THREE.Color(top) }, uHorizon: { value: new THREE.Color(horizon) },
      uBottom: { value: new THREE.Color(bottom) }, uSunDir: { value: sunDir ? sunDir.clone().normalize() : new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(sunColor) }, uSun: { value: sunDir ? 1 : 0 },
      uSunPower: { value: sunPower }, uGlowPower: { value: glowPower }, uGlow: { value: glow },
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(480, 48, 24), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

const STAR_VS = /* glsl */`
  attribute float aSize; attribute float aPhase;
  uniform float uTime; uniform float uPixel;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vA = 0.6 + 0.4 * sin(uTime * (0.8 + fract(aPhase) * 1.6) + aPhase * 6.2831);
    gl_PointSize = aSize * uPixel;
  }`;
const STAR_FS = /* glsl */`
  uniform vec3 uColor; uniform float uOpacity;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vA * uOpacity;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;

export function stars({ count = 2500, rMin = 300, rMax = 440, size = 2.2, color = 0xffffff, seed = 7, opacity = 1, minY = -0.15 }) {
  const r = rng(seed);
  const pos = new Float32Array(count * 3), sizes = new Float32Array(count), phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let v;
    do { v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1); } while (v.lengthSq() > 1 || v.lengthSq() < 0.01);
    v.normalize();
    if (v.y < minY) v.y = -v.y * 0.6 + 0.05;
    v.normalize().multiplyScalar(rMin + r() * (rMax - rMin));
    pos.set([v.x, v.y, v.z], i * 3);
    sizes[i] = size * (0.35 + Math.pow(r(), 3) * 1.6);
    phase[i] = r() * 10;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const m = new THREE.ShaderMaterial({
    vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uPixel: { value: 1 }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = -9;
  p.userData.tick = (t, pixel) => { m.uniforms.uTime.value = t; m.uniforms.uPixel.value = pixel; };
  return p;
}

// fireflies / dust / sparkles: points that drift and flicker, sized by distance
const FLY_VS = /* glsl */`
  attribute float aPhase;
  uniform float uTime, uPixel, uSize, uRise, uSpan;
  varying float vA;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.45 + aPhase * 3.1) * 0.7;
    p.y += sin(uTime * 0.6 + aPhase * 1.7) * 0.35;
    p.y += uRise > 0.0 ? mod(uTime * uRise + aPhase * 3.0, uSpan) - uSpan * 0.5 : 0.0;
    p.z += cos(uTime * 0.38 + aPhase * 2.3) * 0.7;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float flick = pow(0.5 + 0.5 * sin(uTime * (1.4 + fract(aPhase) * 2.2) + aPhase * 9.0), 2.0);
    vA = 0.25 + 0.75 * flick;
    gl_PointSize = clamp(uSize * uPixel * 28.0 / max(-mv.z, 0.5), 2.0, 48.0);
  }`;
const FLY_FS = /* glsl */`
  uniform vec3 uColor; uniform float uOpacity;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor * (0.6 + core), pow(core, 1.5) * vA * uOpacity);
    #include <colorspace_fragment>
  }`;

export function drifters({ count, box, color, size = 1.0, seed = 3, rise = 0, span = 6, opacity = 1 }) {
  const r = rng(seed);
  const [x0, x1, y0, y1, z0, z1] = box;
  const pos = new Float32Array(count * 3), phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([x0 + r() * (x1 - x0), y0 + r() * (y1 - y0), z0 + r() * (z1 - z0)], i * 3);
    phase[i] = r() * 10;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const m = new THREE.ShaderMaterial({
    vertexShader: FLY_VS, fragmentShader: FLY_FS, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: {
      uTime: { value: 0 }, uPixel: { value: 1 }, uSize: { value: size }, uRise: { value: rise },
      uSpan: { value: span }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity },
    },
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.userData.tick = (t, pixel) => { m.uniforms.uTime.value = t; m.uniforms.uPixel.value = pixel; };
  return p;
}

const FRES_VS = /* glsl */`
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const FRES_FS = /* glsl */`
  uniform vec3 uColor; uniform float uPower, uIntensity, uBase, uOpacity;
  varying vec3 vN; varying vec3 vV;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
    float k = (f * uIntensity + uBase) * uOpacity;
    gl_FragColor = vec4(uColor * k, k);
    #include <colorspace_fragment>
  }`;

export function fresnel(color, { power = 2.2, intensity = 1.4, base = 0.08, opacity = 1, side = THREE.FrontSide } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: FRES_VS, fragmentShader: FRES_FS, transparent: true, depthWrite: false, side,
    blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uPower: { value: power }, uIntensity: { value: intensity },
      uBase: { value: base }, uOpacity: { value: opacity },
    },
  });
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (m.map && m.map !== _glow) m.map.dispose();
      m.dispose();
    });
  });
}
