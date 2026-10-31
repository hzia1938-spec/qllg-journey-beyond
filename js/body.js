// The resting body of light: a sculpted mesh (built by _source/body.py) drawn as a hologram with a
// clean silhouette, an inner flow of light from feet to head, and a warm glow at the heart.
import * as THREE from 'three';

let _geo = null;

export async function loadBody(url) {
  if (_geo) return _geo;
  const buf = await (await fetch(url)).arrayBuffer();
  const [nv, nt] = new Uint32Array(buf, 0, 2);
  let o = 8;
  const pos = new Float32Array(buf, o, nv * 3); o += nv * 12;
  const nrm8 = new Int8Array(buf, o, nv * 3); o += Math.ceil((nv * 3) / 4) * 4;
  const idx = new Uint16Array(buf, o, nt * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(nrm8, (v) => v / 127), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
  g.computeBoundingSphere();
  _geo = g;
  return g;
}

export function bodyGeometry() { return _geo; }

const VS = /* glsl */`
  varying vec3 vN; varying vec3 vV; varying vec3 vLocal;
  void main() {
    vLocal = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);   // same maths as the depth pass
  }`;
const FS = /* glsl */`
  uniform float uTime, uGlow;
  uniform vec3 uRim, uFill, uFlow, uHeart, uHeartPos;
  varying vec3 vN; varying vec3 vV; varying vec3 vLocal;
  void main() {
    float ndv = abs(dot(normalize(vN), normalize(vV)));
    float rim = pow(1.0 - ndv, 1.7);
    // light flowing up the body, feet to head
    float flow = pow(0.5 + 0.5 * sin(vLocal.z * 22.0 - uTime * 2.4), 8.0);
    float slow = 0.5 + 0.5 * sin(vLocal.z * 3.0 - uTime * 0.7);
    // warm heart glow, beating gently
    float beat = 0.75 + 0.25 * sin(uTime * 2.0 * 3.14159 * 0.9);
    float heart = exp(-dot(vLocal - uHeartPos, vLocal - uHeartPos) / 0.012) * beat;
    vec3 col = uFill * (0.16 + 0.1 * slow) + uRim * rim * 1.35 + uFlow * flow * (0.12 + 0.25 * rim) + uHeart * heart * 0.9;
    col *= uGlow;
    float a = clamp(0.12 + rim * 0.9 + flow * 0.15 + heart * 0.6, 0.0, 1.0);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

export function makeBody() {
  const geo = bodyGeometry();
  const group = new THREE.Group();
  // depth-only pass first, so only the front surface glows (no see-through seams)
  const depth = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,
  }));
  depth.renderOrder = 1;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
    depthFunc: THREE.LessEqualDepth, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: {
      uTime: { value: 0 }, uGlow: { value: 1 },
      uRim: { value: new THREE.Color(0xd6efff) }, uFill: { value: new THREE.Color(0x4a8cff) },
      uFlow: { value: new THREE.Color(0x9fd8ff) }, uHeart: { value: new THREE.Color(0xffc48a) },
      uHeartPos: { value: new THREE.Vector3(-0.02, 0.07, -0.36) },
    },
  });
  const glow = new THREE.Mesh(geo, mat);
  glow.renderOrder = 2;
  group.add(depth, glow);

  // sparkles drifting up off the skin
  const p = geo.attributes.position.array, n = 420;
  const sp = new Float32Array(n * 3), ph = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.floor(Math.random() * (p.length / 3)) * 3;
    sp.set([p[v], p[v + 1], p[v + 2]], i * 3);
    ph[i] = Math.random();
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  const smat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uPixel: { value: 1 }, uColor: { value: new THREE.Color(0xcfe9ff) } },
    vertexShader: `attribute float aPhase; uniform float uTime, uPixel; varying float vA;
      void main(){
        float u = fract(uTime * 0.16 + aPhase);
        vec3 q = position + vec3(sin(aPhase * 40.0 + uTime) * 0.03 * u, u * 0.9, cos(aPhase * 31.0 + uTime) * 0.03 * u);
        vec4 mv = modelViewMatrix * vec4(q, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.55, 1.0, u));
        gl_PointSize = clamp(uPixel * 9.0 / max(-mv.z, 0.4), 1.5, 14.0);
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float c = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(uColor, c * c * vA * 0.9);
        #include <colorspace_fragment>
      }`,
  });
  const sparks = new THREE.Points(sg, smat);
  sparks.frustumCulled = false;
  sparks.renderOrder = 3;
  group.add(sparks);

  group.userData.tick = (t, pixel) => {
    mat.uniforms.uTime.value = t;
    smat.uniforms.uTime.value = t;
    smat.uniforms.uPixel.value = pixel;
  };
  group.userData.heartLocal = mat.uniforms.uHeartPos.value.clone();
  return group;
}
