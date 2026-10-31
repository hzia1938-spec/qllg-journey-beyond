// A light to gather. States: hidden -> wait (floats, pulses, can be gazed/tapped) -> collect
// (flies to you) -> companion (orbits you for the rest of the journey) -> finale (joins the Earth).
import * as THREE from 'three';
import { glowSprite, glowTexture } from './gfx.js';

const V = new THREE.Vector3();
const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

export class Orb {
  constructor(name, color, note, slot = 0) {
    this.name = name;
    this.color = new THREE.Color(color);
    this.note = note;
    this.slot = slot;
    this.group = new THREE.Group();
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }));
    this.inner = glowSprite(color, 0.8, 1.0);
    this.outer = glowSprite(color, 2.4, 0.38);
    this.group.add(this.outer, this.inner, this.core);

    const n = 22, pos = new Float32Array(n * 3);
    this.sparkSeed = Array.from({ length: n }, (_, i) => [Math.random() * 6.28, 0.18 + Math.random() * 0.22, 0.6 + Math.random() * 1.2, (Math.random() - 0.5) * 0.25]);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({
      map: glowTexture(), color, size: 0.07, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    }));
    this.group.add(this.sparks);

    this.hit = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
    this.hit.userData.orb = this;
    this.group.add(this.hit);

    this.state = 'hidden';
    this.group.visible = false;
    this.gaze = 0;
    this.anchor = null;            // (t) => world position while waiting
    this.assist = 0;               // 0..1: drift toward the viewer's gaze after the hint
    this.assistFrom = null;
    this.phase = Math.random() * 10;
    this.anim = null;
    this.onCollected = null;
  }

  show(anchorFn) {
    this.anchor = anchorFn;
    this.state = 'wait';
    this.gaze = 0;
    this.assist = 0;
    this.group.visible = true;
    this.group.scale.setScalar(0.001);
    this.anim = { kind: 'appear', t: 0 };
  }

  collect(rig, camera, onDone) {
    if (this.state !== 'wait') return false;
    this.state = 'collect';
    rig.attach(this.group);
    this.anim = { kind: 'collect', t: 0, from: this.group.position.clone() };
    this.onCollected = onDone;
    return true;
  }

  toFinale(scene, target, delay = 0) {
    scene.attach(this.group);
    this.state = 'finale';
    this.anim = { kind: 'finale', t: -delay, from: this.group.position.clone(), to: target.clone(), s0: this.group.scale.x };
  }

  // the viewer's head position + a point in front of it, both in rig space
  headLocal(rig, camera, out) {
    camera.getWorldPosition(out);
    return rig.worldToLocal(out);
  }

  update(t, dt, rig, camera, camDir) {
    if (this.state === 'hidden') return;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + this.phase);
    const g = this.gaze;
    this.inner.scale.setScalar(0.75 + 0.12 * pulse + g * 0.55);
    this.outer.material.opacity = 0.28 + 0.12 * pulse + g * 0.35;
    // sparkles circling the core
    const arr = this.sparks.geometry.attributes.position.array;
    this.sparkSeed.forEach(([a0, r, sp, y], i) => {
      const a = a0 + t * sp;
      arr[i * 3] = Math.cos(a) * r; arr[i * 3 + 1] = y + Math.sin(t * sp + a0) * 0.06; arr[i * 3 + 2] = Math.sin(a) * r;
    });
    this.sparks.geometry.attributes.position.needsUpdate = true;

    if (this.anim && this.anim.kind === 'appear') {
      this.anim.t += dt / 1.6;
      this.group.scale.setScalar(Math.max(0.001, ease(Math.min(1, this.anim.t))));
      if (this.anim.t >= 1) this.anim = null;
    }

    if (this.state === 'wait') {
      const p = this.anchor(t);
      if (this.assist > 0 && camDir) {
        // ease the light into the centre of view so nobody gets stuck
        if (!this.assistFrom) this.assistFrom = p.clone();
        camera.getWorldPosition(V);
        const front = V.clone().addScaledVector(camDir, 4.0).add(new THREE.Vector3(0.35, 0.1, 0));
        p.lerp(front, ease(Math.min(1, this.assist)));
      }
      p.y += Math.sin(t * 0.9 + this.phase) * 0.12;
      this.group.position.copy(p);
    } else if (this.state === 'collect') {
      const a = this.anim;
      a.t += dt / 1.5;
      const head = this.headLocal(rig, camera, new THREE.Vector3());
      const fwd = camDir.clone().transformDirection(new THREE.Matrix4().copy(rig.matrixWorld).invert());
      const front = head.clone().addScaledVector(fwd, 0.85).add(new THREE.Vector3(0, -0.06, 0));
      const slot = this.slotPos(t, head);
      if (a.t < 0.55) {
        const u = ease(a.t / 0.55);
        this.group.position.lerpVectors(a.from, front, u);
        this.group.scale.setScalar(1 + 0.5 * Math.sin(u * Math.PI));
      } else {
        const u = ease(Math.min(1, (a.t - 0.55) / 0.45));
        this.group.position.lerpVectors(front, slot, u);
        this.group.scale.setScalar(1 - 0.76 * u);
      }
      if (a.t >= 1) {
        this.state = 'companion';
        this.anim = null;
        this.group.scale.setScalar(0.24);
        if (this.onCollected) { const f = this.onCollected; this.onCollected = null; f(); }
      }
    } else if (this.state === 'companion') {
      const head = this.headLocal(rig, camera, new THREE.Vector3());
      this.group.position.lerp(this.slotPos(t, head), Math.min(1, dt * 3));
    } else if (this.state === 'finale') {
      const a = this.anim;
      a.t += dt / 3.2;
      if (a.t > 0) {
        const u = ease(Math.min(1, a.t));
        this.group.position.lerpVectors(a.from, a.to, u);
        this.group.scale.setScalar(a.s0 + (2.2 - a.s0) * u);
      }
    }
  }

  slotPos(t, head) {
    const ang = this.slot * (Math.PI / 2) + t * 0.35;
    return new THREE.Vector3(head.x + Math.cos(ang) * 0.8, head.y - 0.62 + Math.sin(t * 1.3 + this.slot) * 0.03,
      head.z + Math.sin(ang) * 0.8);
  }
}
