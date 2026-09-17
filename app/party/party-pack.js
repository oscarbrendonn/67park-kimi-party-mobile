// 67 Park party pack. Adds an Eggy Party style feel on top of the island without touching its
// systems: springy jump and landing squash, punches and throws that reach other players, a
// jump pads, park bots that fly when punched, synthesized sounds, haptics and a settings panel.
// Every hook is guarded: a fault here disables the pack and never stops the game.
// Loaded after app/main.js. Config: window.__partyConfig = {runtime: "<runtime ?v>", carry: "<carry ?v>"}.
import * as THREE from 'three';
import { createPartyAudio } from './party-audio.js?v=audio-2';

const BASE = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const CFG = Object.assign({runtime: '', carry: ''}, (typeof window !== 'undefined' && window.__partyConfig) || {});
const VERSION = 'party-1';
const isTouch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const finite = v => Number.isFinite(v);
const log = (...a) => { try { console.log('[party]', ...a); } catch {} };
let disabled = false;
function guard(fn) {
  return function (...args) {
    if (disabled) return;
    try { return fn.apply(this, args); }
    catch (e) { disabled = true; log('disabled after error', e); try { (window.__candyErrors ||= []).push('party: ' + (e?.message || e)); } catch {} }
  };
}

// ---------- settings ----------
const SETTINGS_KEY = '67park-party';
const settings = Object.assign({sfx: 0.8, haptics: true, pads: true, juice: true}, (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; } })());
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} }
const gameMuted = () => { try { return localStorage.getItem('67park-muted') === '1'; } catch { return false; } };

// ---------- sound (synthesized, no files) ----------
const sfx = createPartyAudio({settings, saveSettings, gameMuted});
const buzz = pattern => { if (!settings.haptics || !isTouch) return; try { navigator.vibrate?.(pattern); } catch {} };

// ---------- world access ----------
const player = {body: null, visual: null, map: 'city'};
const world = () => window.__islandWorld || null;
const scene = () => window.__eggyScene || null;
const net = () => window.__eggyNet || null;
let stateApi = null, carryApi = null; // the game's own modules (same instances as main.js: exact same URLs)
const state = () => { try { return stateApi ? stateApi() : null; } catch { return null; } };
(async () => {
  try { stateApi = (await import(`${BASE}/app/claude-gorilla-runtime.js${CFG.runtime ? '?v=' + CFG.runtime : ''}`)).claudeGorillaState; }
  catch (e) { log('runtime import failed', e); }
  try { carryApi = await import(`${BASE}/app/park-carry.js${CFG.carry ? '?v=' + CFG.carry : ''}`); }
  catch (e) { log('carry import failed', e); }
})();
const groundAt = (x, z) => { const w = world(); let y = null; try { y = w?.ground?.(x, z); } catch {} return finite(y) ? y : null; };
const terrainAt = (x, z) => { const w = world(); let y = null; try { y = w?.terrainGround?.(x, z); } catch {} return finite(y) ? y : null; };
const isWater = (x, z) => { const w = world(); try { return !!w?.water?.(x, z); } catch { return false; } };
const isWallish = (x, z) => { const g = groundAt(x, z); if (g === null) return true; const t = terrainAt(x, z); return t !== null && g - t > 1.1; };
const heldId = () => { try { return carryApi?.carryPacket?.() || ''; } catch { return ''; } };

// ---------- springy scale (jump, land, hits) ----------
const spring = {v: 0, vel: 0, k: 190, c: 15};
function kick(amount) { spring.v += amount; }
function stepSpring(dt) { const a = -spring.k * spring.v - spring.c * spring.vel; spring.vel += a * dt; spring.v += spring.vel * dt; spring.v = clamp(spring.v, -0.42, 0.45); }
let prevPunchT = 0, wasEnabled = false, hitTumble = 0, tumbleDir = 0;
let previousHeld = '';

// ---------- hooks called by main.js ----------
window.__partyStep = guard((body, input, dt, map) => {
  player.body = body || null; player.map = map;
  dt = clamp(finite(dt) ? dt : 0, 0, 0.05);
  netHook.step();
  knockStep(dt);
  footsteps(state(), dt);
  const held = heldId();
  if (held && !previousHeld) sfx.play('grab');
  previousHeld = held;
  if (map !== 'city' || !world()) return;
  items.step(body, dt);
  remotePops.step(dt);
  botFlights.step();
});
window.__partyVisual = guard((group, dt) => {
  carryApi?.updateLocalCarryHands?.(group,dt);
  player.visual = group || null;
  dt = clamp(finite(dt) ? dt : 0, 0, 0.05);
  const st = state();
  if (!group) return;
  const punchStarted = st?.punchT > 0 && prevPunchT === 0;
  // Sound follows actions even when visual bounce or reduced-motion effects are off.
  if (st?.enabled && player.map === 'city') {
    if (st.jumped === 1) sfx.play('jump');
    else if (st.jumped === 2) sfx.play('double');
    if (st.landed) sfx.play('land', st.landed > 9);
    if (punchStarted) sfx.play('swing');
  }
  prevPunchT = st?.punchT || 0;
  if (!st || !st.enabled || player.map !== 'city' || !settings.juice || reducedMotion()) {
    if (wasEnabled) { group.scale.x = group.scale.z = 1; wasEnabled = false; }
    return;
  }
  wasEnabled = true;
  if (st.jumped === 1) { kick(0.16); buzz(8); }
  else if (st.jumped === 2) { kick(0.22); buzz([8, 30, 8]); }
  if (st.landed) { const hard = st.landed > 9; kick(-0.30 * clamp(st.landed / 10, 0.5, 1)); buzz(hard ? 22 : 10); }
  if (punchStarted) kick(0.07);
  if (st.punchImpact) { st.shake = Math.max(st.shake || 0, 0.22); hits.punch(); }
  stepSpring(dt);
  const vy = finite(st.verticalVelocity) ? st.verticalVelocity : 0;
  const air = st.grounded ? 0 : clamp(Math.abs(vy) / 11, 0, 1) * 0.11;
  const s = spring.v + air;
  group.scale.y = clamp(1 + s, 0.62, 1.4);
  group.scale.x = group.scale.z = clamp(1 - s * 0.55, 0.75, 1.25);
  if (hitTumble > 0) {
    hitTumble = Math.max(0, hitTumble - dt);
    const w = Math.sin((hitTumble / 0.7) * Math.PI);
    group.rotation.x += -0.55 * w * Math.cos(tumbleDir - group.rotation.y);
    group.rotation.z += 0.55 * w * Math.sin(tumbleDir - group.rotation.y);
  }
  dizzyStars.update(group, dt);
});

// ---------- hit channel: punches and throws reach other characters ----------
// Rides on the emote field of the position packet, which the server relays as a 40 char string.
// pk1h:<victim id prefix>:<nonce>:<angle deg>:<power>
const netHook = (() => {
  let ws = null, outgoing = null, until = 0; const seen = new Map();
  const listen = () => {
    const n = net(); const sock = n?.ws; if (!sock || sock === ws) return;
    ws = sock;
    sock.addEventListener('message', ev => {
      if (typeof ev.data !== 'string' || ev.data.indexOf('"pk1') < 0) return;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m?.t !== 's' || typeof m.e !== 'string' || !m.e.startsWith('pk1')) return;
      guard(hits.receive)(m);
    });
    if (!sock.__partySend) {
      sock.__partySend = true;
      const raw = sock.send.bind(sock);
      sock.send = data => {
        try {
          if (outgoing && typeof data === 'string' && data.startsWith('{"t":"s"')) {
            if (performance.now() > until) outgoing = null;
            else { const o = JSON.parse(data); o.e = outgoing; data = JSON.stringify(o); }
          }
        } catch {}
        return raw(data);
      };
    }
  };
  return {
    step() { listen(); },
    // Put a flag into the next position packets for `ms` milliseconds and push one packet now.
    flag(text, ms = 240) {
      outgoing = text; until = performance.now() + ms;
      const n = net(); if (!n?.ws || n.ws.readyState !== 1) return;
      try {
        const p = player.body?.translation?.(); const st = state();
        if (p) { n.lastSend = 0; n.sendState([+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], finite(st?.heading) ? st.heading : 0); }
      } catch {}
    },
    dedupe(key) { const now = performance.now(); for (const [k, t] of seen) if (now - t > 4000) seen.delete(k); if (seen.has(key)) return false; seen.set(key, now); return true; },
  };
})();
const shortId = id => String(id || '').replace(/-/g, '').slice(0, 8);
const dizzyStars = (() => {
  let sprite = null, life = 0;
  const make = () => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const star = (x, y, r, col) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fillStyle = col; g.fill(); g.lineWidth = 3; g.strokeStyle = '#ffffff'; g.stroke(); };
    star(30, 40, 16, '#ffd54a'); star(66, 26, 13, '#ff8fb8'); star(100, 44, 15, '#7fd6ff');
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({map: tex, transparent: true, depthWrite: false})); s.scale.set(1.3, 1.3, 1); s.name = 'PARTY_dizzy'; return s;
  };
  return {
    show(group, seconds = 1.1) { if (!group) return; if (!sprite) sprite = make(); if (sprite.parent !== group) group.add(sprite); life = seconds; sprite.visible = true; },
    update(group, dt) { if (!sprite || !sprite.visible) return; life -= dt; if (life <= 0) { sprite.visible = false; return; } const t = performance.now() / 1000; sprite.position.set(Math.sin(t * 6) * 0.25, 2.05 + Math.sin(t * 9) * 0.05, Math.cos(t * 6) * 0.25); sprite.material.rotation = t * 2.2; sprite.material.opacity = Math.min(1, life * 3); },
  };
})();
// Quick scale pop on another player's avatar so a hit reads instantly on the attacker's screen too.
const remotePops = (() => {
  const pops = new Map(); let cacheAt = 0; const roots = new Map();
  const refresh = () => {
    const now = performance.now(); if (now - cacheAt < 800) return; cacheAt = now; roots.clear();
    const s = scene(); if (!s) return;
    s.traverse(o => { const tag = o.userData?.claudeRemoteCharacter; if (tag?.id && !roots.has(tag.id)) { let g = o; for (let i = 0; i < 4 && g.parent && g.parent !== s && !(g.parent.position.x || g.parent.position.z); i++) g = g.parent; roots.set(tag.id, g); } });
  };
  return {
    pop(id) { refresh(); const g = roots.get(id); if (!g) return null; pops.set(id, {g, t: 0, sx: g.scale.x, sy: g.scale.y, sz: g.scale.z}); return g; },
    step(dt) { for (const [id, p] of pops) { p.t += dt; const k = p.t / 0.35; if (k >= 1 || !p.g.parent) { p.g.scale.set(p.sx, p.sy, p.sz); pops.delete(id); continue; } const w = Math.sin(k * Math.PI); p.g.scale.set(p.sx * (1 + 0.28 * w), p.sy * (1 - 0.22 * w), p.sz * (1 + 0.28 * w)); } },
  };
})();
// Footsteps: the park has no walking sounds for this character, so play soft pats by speed.
let stepPhase = 0, stepLeft = false;
function footsteps(st, dt) {
  if (!st?.enabled || !st.grounded) { stepPhase = 0; return; }
  const sp = finite(st.speed) ? Math.abs(st.speed) : 0;
  if (sp < 1.2) { stepPhase = 0; return; }
  const cadence = sp > 7 ? 4.6 : sp > 4 ? 3.6 : 2.6; // steps per second
  stepPhase += cadence * dt;
  if (stepPhase >= 1) { stepPhase -= 1; stepLeft = !stepLeft; sfx.play('step', stepLeft); }
}
let knockState = null;
function knockStep(dt) {
  const k = knockState; if (!k) return; const st = state(); if (!st?.enabled) { knockState = null; return; }
  k.t += dt;
  if (k.t > 1.6 || (k.t > 0.3 && st.grounded)) { knockState = null; return; }
  k.speed = Math.max(0, k.speed - (st.grounded ? 22 : 2.2) * dt);
  st.speed = k.speed; st.heading = k.ang; st.sprint = 0;
}
const hits = (() => {
  let nonce = 0, lastRemoteHit = 0;
  const remotesInFront = (p, heading, range, cone) => {
    const n = net(); const out = [];
    if (!n?.remotes) return out;
    for (const [id, r] of n.remotes) {
      const q = r.targetP || r.p; if (!q || id === n.id) continue;
      const dx = q[0] - p.x, dz = q[2] - p.z, d = Math.hypot(dx, dz);
      if (d > range || Math.abs(q[1] - p.y) > 1.8) continue;
      if (d > 0.35 && (dx * Math.sin(heading) + dz * Math.cos(heading)) / d < cone) continue;
      out.push({id, d, dx, dz, q});
    }
    return out.sort((a, b) => a.d - b.d);
  };
  const knock = (st, body, ang, power) => {
    // The runtime owns the body's velocity each frame and brakes hard, so the launch is re-applied
    // every frame (see knockStep) until the character lands again; the hop itself goes through the body.
    const speed = power === 3 ? 13 : 10.5, up = power === 3 ? 9 : 7.2;
    knockState = {speed, ang, t: 0};
    st.speed = speed; st.heading = ang; st.sprint = 0; st.grounded = false; st.hover = false; st.airT = 0; st.fallPeak = 0; st.jumpsLeft = 0;
    try { const lv = body.linvel?.() || {x: 0, y: 0, z: 0}; body.setLinvel({x: Math.sin(ang) * speed, y: Math.max(lv.y, up), z: Math.cos(ang) * speed}, true); } catch {}
    st.shake = Math.max(st.shake || 0, 0.35);
  };
  return {
    punch() {
      const st = state(); const body = player.body; const p = body?.translation?.();
      if (!st || !p) return;
      const targets = remotesInFront(p, st.heading, 2.2, 0.45);
      if (targets.length) {
        const v = targets[0];
        const ang = Math.round(((Math.atan2(v.dx, v.dz) * 180 / Math.PI) % 360 + 360) % 360);
        nonce = (nonce + 1) % 90;
        netHook.flag(`pk1h:${shortId(v.id)}:${nonce}:${ang}:2`);
        sfx.play('hit'); buzz(25); fxRing(v.q, '#ffd54a'); remotePops.pop(v.id);
        return;
      }
      const bots = botsInFront(p, st.heading, 3.2, 0.3); // wider than the player range: the game's own strike has already pushed the bot back this frame
      if (bots.length) { sfx.play('hit'); buzz(18); fxRing([bots[0].x, bots[0].y, bots[0].z], '#ffd54a'); botFlights.launch(bots[0], st.heading); st.shake = Math.max(st.shake || 0, 0.3); }
    },
    throwHeld() {
      const st = state(); const body = player.body; const id = heldId();
      if (!st || !body || !id || !carryApi?.toggleParkCarry) return false;
      if (!carryApi.toggleParkCarry()) return false; // release first so the carry packet is empty when the throw lands
      const ang = Math.round(((st.heading * 180 / Math.PI) % 360 + 360) % 360);
      nonce = (nonce + 1) % 90;
      netHook.flag(`pk1h:${shortId(id)}:${nonce}:${ang}:3`);
      sfx.play('throw'); buzz([10, 20, 30]); kick(0.12); remotePops.pop(id);
      return true;
    },
    selfTest(angDeg = 0, power = 2) { // test hook: apply a hit to ourselves without the network
      return hits.receive({t: 's', id: 'test', e: `pk1h:self:${Math.floor(Math.random() * 90)}:${angDeg}:${power}`}, true);
    },
    receive(m, force = false) {
      const n = net(); const parts = String(m.e).split(':');
      if (parts[0] !== 'pk1h') return;
      const [, target, nn, angS, powS] = parts;
      const mine = force || !!(n?.id && shortId(n.id) === target);
      if (!mine) { // someone else got hit: show a ring at them
        if (n?.remotes && netHook.dedupe('v:' + m.id + ':' + nn)) for (const [id, r] of n.remotes) if (shortId(id) === target) { const q = r.targetP || r.p; if (q) fxRing(q, '#ffd54a'); remotePops.pop(id); break; }
        return;
      }
      if (!netHook.dedupe(m.id + ':' + nn)) return;
      const body = player.body; const st = state(); if (!body || !st || !st.enabled) return;
      const now = performance.now(); if (now - lastRemoteHit < 350) return; lastRemoteHit = now;
      const ang = (+angS || 0) * Math.PI / 180, power = clamp(+powS || 2, 1, 3);
      knock(st, body, ang, power);
      kick(-0.2); hitTumble = 0.7; tumbleDir = ang;
      sfx.play('hit'); sfx.play('stars'); buzz([30, 40, 30]);
      dizzyStars.show(player.visual, 1.2);
      const t = body.translation?.(); if (t) fxRing([t.x, t.y, t.z], '#ff8fb8');
    },
  };
})();
// Ambient park bots fly when punched: the game's own hit controller does the recoil, this adds the
// launch on top by offsetting the bot root after the bots update has placed it each frame.
const botFlights = (() => {
  const flights = new Map(); let wrapped = null;
  const wrap = () => {
    const w = world(); const bots = w?.claudeParkBots; if (!bots || bots === wrapped || typeof bots.update !== 'function') return;
    wrapped = bots; const orig = bots.update.bind(bots);
    bots.update = (...a) => { const r = orig(...a); apply(); return r; };
  };
  const apply = () => {
    if (!flights.size) return;
    const now = performance.now() / 1000;
    for (const [root, f] of flights) {
      const t = now - f.start;
      if (t > f.fly + f.back || !root.parent) { flights.delete(root); continue; }
      let k, h, spin;
      if (t < f.fly) { const u = t / f.fly; k = u; h = 4 * f.height * u * (1 - u); spin = u * Math.PI * 2 * f.spins; }
      else { const u = (t - f.fly) / f.back; k = 1 - (u * u * (3 - 2 * u)); h = 0; spin = 0; }
      root.position.x += f.dx * f.dist * k; root.position.z += f.dz * f.dist * k; root.position.y += h;
      if (spin) { root.rotation.x += spin * f.dz; root.rotation.z -= spin * f.dx; }
    }
  };
  return {
    step() { wrap(); },
    launch(bot, heading) {
      if (!bot?.root) return false;
      const dx = Math.sin(heading), dz = Math.cos(heading); const p = bot.root.position; const g0 = groundAt(p.x, p.z) ?? p.y;
      let dist = 0;
      for (let step = 1; step <= 8; step++) { const d = step * 0.55, x = p.x + dx * d, z = p.z + dz * d; const g = groundAt(x, z); if (g === null || Math.abs(g - g0) > 1.2 || isWater(x, z)) break; dist = d; }
      if (dist < 1) return false;
      flights.set(bot.root, {start: performance.now() / 1000, fly: 0.85, back: 1.1, dist, dx, dz, height: 2.3, spins: 1});
      return true;
    },
  };
})();
function botsInFront(p, heading, range, cone) {
  const out = []; const root = scene()?.getObjectByName?.('CLAUDE_PARK_AMBIENT_BOTS'); if (!root) return out;
  for (const bot of root.children) {
    if (!bot.visible) continue; const q = bot.position;
    const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
    if (d > range || Math.abs(q.y - p.y) > 1.8) continue;
    if (d > 0.35 && (dx * Math.sin(heading) + dz * Math.cos(heading)) / d < cone) continue;
    out.push({d, x: q.x, y: q.y, z: q.z, root: bot});
  }
  return out.sort((a, b) => a.d - b.d);
}

// ---------- small ring burst effect ----------
const rings = [];
function fxRing(pos, color) {
  const s = scene(); if (!s || !pos) return;
  const x = Array.isArray(pos) ? pos[0] : pos.x, y = Array.isArray(pos) ? pos[1] : pos.y, z = Array.isArray(pos) ? pos[2] : pos.z;
  if (![x, y, z].every(finite)) return;
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 40), new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide}));
  mesh.name = 'PARTY_ring'; mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, (groundAt(x, z) ?? y) + 0.06, z);
  s.add(mesh); rings.push({mesh, t: 0});
}
function stepRings(dt) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]; r.t += dt; const k = r.t / 0.45;
    r.mesh.scale.setScalar(0.6 + k * 2.4); r.mesh.material.opacity = 0.85 * (1 - k);
    if (k >= 1) { r.mesh.removeFromParent(); r.mesh.geometry.dispose(); r.mesh.material.dispose(); rings.splice(i, 1); }
  }
}

// ---------- jump pads ----------
const items = (() => {
  let w = null, pads = [], padCooldown = 0, group = null;
  const padTexture = () => {
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    g.fillStyle = '#fff3d6'; g.beginPath(); g.arc(256, 256, 250, 0, Math.PI * 2); g.fill();
    g.save(); g.translate(256, 256); g.fillStyle = '#ff8fb8';
    for (let i = 0; i < 8; i++) { g.rotate(Math.PI / 4); g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 250, -Math.PI / 16, Math.PI / 16); g.closePath(); g.fill(); }
    g.restore();
    g.lineWidth = 22; g.strokeStyle = '#ffffff'; g.beginPath(); g.arc(256, 256, 236, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(256, 256, 150, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff5f9e'; g.beginPath(); g.moveTo(256, 116); g.lineTo(356, 236); g.lineTo(300, 236); g.lineTo(300, 380); g.lineTo(212, 380); g.lineTo(212, 236); g.lineTo(156, 236); g.closePath(); g.fill();
    g.lineWidth = 12; g.strokeStyle = '#ffffff'; g.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  };
  const starTexture = () => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    g.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 12 : 28; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } g.closePath();
    g.fillStyle = '#ffd54a'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#ffffff'; g.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  let starTex = null; const bursts = [];
  const burst = (x, y, z) => {
    if (!starTex) starTex = starTexture();
    for (let i = 0; i < 9; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: starTex, transparent: true, depthWrite: false}));
      const a = i / 9 * Math.PI * 2, r = 0.45 + Math.random() * 0.3; sp.scale.setScalar(0.32 + Math.random() * 0.2);
      sp.position.set(x + Math.cos(a) * 0.4, y + 0.3, z + Math.sin(a) * 0.4); sp.name = 'PARTY_star'; group.add(sp);
      bursts.push({sp, vx: Math.cos(a) * 2.2 * r, vy: 5 + Math.random() * 2.5, vz: Math.sin(a) * 2.2 * r, t: 0});
    }
  };
  const stepBursts = dt => {
    for (let i = bursts.length - 1; i >= 0; i--) { const b = bursts[i]; b.t += dt; b.vy -= 14 * dt; b.sp.position.x += b.vx * dt; b.sp.position.y += b.vy * dt; b.sp.position.z += b.vz * dt; b.sp.material.rotation += 4 * dt; b.sp.material.opacity = Math.max(0, 1 - b.t / 0.8); if (b.t > 0.8) { b.sp.removeFromParent(); b.sp.material.dispose(); bursts.splice(i, 1); } }
  };
  const makePad = (x, y, z, tex) => {
    const pad = new THREE.Group(); pad.name = 'PARTY_pad'; pad.position.set(x, y, z);
    const pink = new THREE.MeshStandardMaterial({color: '#ff7fb0', roughness: 0.55, metalness: 0});
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.38, 0.2, 48), pink); base.position.y = 0.1; base.castShadow = true; base.receiveShadow = true;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.07, 12, 48), new THREE.MeshStandardMaterial({color: '#ffffff', roughness: 0.5})); lip.rotation.x = Math.PI / 2; lip.position.y = 0.2;
    const springs = new THREE.Group(); const coil = new THREE.MeshStandardMaterial({color: '#e9eef5', roughness: 0.35, metalness: 0.25});
    for (let i = 0; i < 3; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.06, 10, 40), coil); ring.rotation.x = Math.PI / 2; ring.position.y = 0.06 + i * 0.09; springs.add(ring); }
    springs.position.y = 0.2;
    const top = new THREE.Group(); top.position.y = 0.44;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 0.98, 0.16, 48), [new THREE.MeshStandardMaterial({color: '#ff9fc4', roughness: 0.5}), new THREE.MeshStandardMaterial({map: tex, roughness: 0.45}), new THREE.MeshStandardMaterial({color: '#ff9fc4'})]);
    disc.castShadow = true; disc.receiveShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.06, 0.06, 12, 48), new THREE.MeshStandardMaterial({color: '#ffffff', roughness: 0.5})); rim.rotation.x = Math.PI / 2; rim.position.y = 0.08;
    top.add(disc, rim);
    const glow = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.75, 48), new THREE.MeshBasicMaterial({color: '#ffb3d1', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide})); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.03;
    pad.add(base, lip, springs, top, glow);
    return {group: pad, top, springs, glow, x, y, z, squash: 0, vel: 0, phase: Math.random() * 6};
  };
  const centerOf = name => { const o = scene()?.getObjectByName?.(name); if (!o) return null; const b = new THREE.Box3().setFromObject(o); if (b.isEmpty()) return null; const c = b.getCenter(new THREE.Vector3()); return {x: c.x, z: c.z}; };
  const validSpot = (x, z) => { const g = groundAt(x, z); if (g === null || isWater(x, z)) return false; const t = terrainAt(x, z); if (t !== null && Math.abs(g - t) > 0.5) return false; for (const [dx, dz] of [[1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3]]) { const gg = groundAt(x + dx, z + dz); if (gg === null || Math.abs(gg - g) > 0.35) return false; } return true; };
  const build = () => {
    const s = scene(); if (!s) return;
    group = new THREE.Group(); group.name = 'PARTY_items'; s.add(group);
    const spawn = Array.isArray(w.spawn) && w.spawn.length === 3 ? w.spawn : [167, 7, 120];
    const fountain = centerOf('67D_CENTER_FOUNTAIN_BASIN');
    const candidates = [
      {x: spawn[0] - 6, z: spawn[2] + 5}, {x: spawn[0] + 7, z: spawn[2] - 6},
      centerOf('67D_SKATEPARK_BASE'), centerOf('PLAZA83_WALKABLE_GROUND'), fountain && {x: fountain.x + 9, z: fountain.z},
    ].filter(Boolean);
    const tex = padTexture();
    for (const c of candidates) {
      let spot = null;
      for (const [dx, dz] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2], [3, 3], [-3, -3], [4, 0], [0, 4]]) if (validSpot(c.x + dx, c.z + dz)) { spot = {x: c.x + dx, z: c.z + dz}; break; }
      if (!spot || pads.some(p => Math.hypot(p.x - spot.x, p.z - spot.z) < 6)) continue;
      const y = groundAt(spot.x, spot.z);
      const pad = makePad(spot.x, y, spot.z, tex); group.add(pad.group); pads.push(pad);
    }
    log('pads', pads.length);
  };
  const stepPads = (body, dt) => {
    padCooldown = Math.max(0, padCooldown - dt);
    const t = body?.translation?.(); const lv = body?.linvel?.();
    const now = performance.now() / 1000;
    for (const pad of pads) {
      // squash is a damped spring around 0: negative = pressed down, positive = popped up
      const acc = -160 * pad.squash - 11 * pad.vel; pad.vel += acc * dt; pad.squash += pad.vel * dt;
      const bob = Math.sin(now * 2 + pad.phase) * 0.012;
      pad.top.position.y = 0.44 + bob + pad.squash * 0.35; pad.top.scale.y = clamp(1 + pad.squash * 0.9, 0.35, 1.5); pad.top.scale.x = pad.top.scale.z = clamp(1 - pad.squash * 0.35, 0.8, 1.2);
      pad.springs.scale.y = clamp(1 + pad.squash * 0.8, 0.3, 1.4);
      pad.glow.material.opacity = 0.22 + 0.16 * (0.5 + 0.5 * Math.sin(now * 3 + pad.phase)); pad.glow.rotation.z = now * 0.4;
      if (!t || !lv || padCooldown > 0) continue;
      const d = Math.hypot(t.x - pad.x, t.z - pad.z), dy = t.y - pad.y;
      if (d < 1.2 && dy > -0.3 && dy < 1.3 && lv.y <= 0.8) {
        const st = state(); if (!st?.enabled) continue;
        try { body.setLinvel({x: lv.x, y: 12.5, z: lv.z}, true); } catch { continue; }
        st.grounded = false; st.hover = false; st.airT = 0; st.jumpsLeft = 1; st.stretch = 1; st.fallPeak = 0; st.verticalVelocity = 12.5;
        pad.squash = -0.75; pad.vel = -6; padCooldown = 0.55; kick(0.28); sfx.play('pad'); buzz([15, 30, 25]);
        fxRing([pad.x, pad.y + 0.1, pad.z], '#ffffff'); burst(pad.x, pad.y + 0.4, pad.z);
      }
    }
  };
  return {
    step(body, dt) {
      const cur = world();
      if (cur !== w) { w = cur; pads = []; if (group) { group.removeFromParent(); group = null; } if (w?.ground && scene()) { try { build(); } catch (e) { log('build failed', e); } } }
      if (!group) return;
      for (const pad of pads) pad.group.visible = !!settings.pads;
      if (settings.pads) stepPads(body, dt);
      stepBursts(dt);
      stepRings(dt);
    },
    count() { return {pads: pads.length}; },
    debug() { return {pads: pads.map(p => ({x: p.x, y: p.y, z: p.z}))}; },
  };
})();

// ---------- controls: throw button (touch) and keyboard ----------
function installControls() {
  const throwNow = () => { sfx.ensure(); return guard(hits.throwHeld)() === true; };
  window.addEventListener('keydown', ev => {
    if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey || ev.code !== 'KeyT') return;
    if (ev.target?.closest?.('input,textarea,select,[contenteditable],[role="textbox"]')) return;
    if (throwNow()) { ev.preventDefault(); ev.stopImmediatePropagation(); }
  }, {capture: true});
  if (isTouch) {
    const btn = document.createElement('button');
    btn.id = 'party-throw'; btn.type = 'button'; btn.className = 'party-eggy party-eggy-blue'; btn.setAttribute('aria-label', 'Throw');
    btn.innerHTML = ICONS.throw + '<span>Throw</span>';
    btn.addEventListener('pointerdown', ev => { ev.preventDefault(); ev.stopPropagation(); throwNow(); });
    btn.hidden = true; document.body.append(btn);
    setInterval(() => { try { btn.hidden = !(heldId() && player.map === 'city'); } catch {} }, 200);
  }
  installEggyButtons();
}
// 67 Park icon set for the action buttons: glossy cartoon shapes with a plum outline, drawn once as
// inline SVG (no emoji, no bitmaps). Shared gradients live in one hidden <svg> in the document.
const OUT = '#3d2b4a';
const DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>'
  + '<linearGradient id="pg-w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe6f2"/></linearGradient>'
  + '<linearGradient id="pg-y" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe98a"/><stop offset="1" stop-color="#ffb42a"/></linearGradient>'
  + '<linearGradient id="pg-p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffbcd6"/><stop offset="1" stop-color="#ff6fa3"/></linearGradient>'
  + '<linearGradient id="pg-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe1ff"/><stop offset="1" stop-color="#5aa9ec"/></linearGradient>'
  + '<linearGradient id="pg-m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9f4e0"/><stop offset="1" stop-color="#5fcf9f"/></linearGradient>'
  + '</defs></svg>';
const svg = inner => `<svg class="party-icon" viewBox="0 0 64 64" aria-hidden="true">${inner}</svg>`;
const st = (extra = '') => `stroke="${OUT}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" ${extra}`;
const ICONS = {
  punch: svg(`<rect x="9" y="36" width="15" height="15" rx="5" fill="url(#pg-y)" ${st()}/>`
    + `<path d="M22 22c0-5 4-9 9-9h9c8 0 14 6 14 14v9c0 8-6 14-14 14H30c-5 0-8-3-8-8z" fill="url(#pg-w)" ${st()}/>`
    + `<path d="M33 14v11M42 14v11" fill="none" ${st('stroke-width="2.6"')}/>`
    + `<path d="M22 29c-5 0-8 3-8 7s3 7 8 7" fill="url(#pg-w)" ${st()}/>`
    + `<ellipse cx="41" cy="19" rx="6" ry="2.6" fill="#fff" opacity=".8"/>`
    + `<path d="M55 11l3-5M58 20l5-2M50 7l0-5" fill="none" ${st()}/>`),
  throw: svg(`<path d="M13 40c-3-4-1-9 3-9l9 4V23c0-3 5-3 5 0v10l3-1c3-1 6 1 6 4v6c0 7-5 12-12 12h-3c-4 0-7-2-9-5z" fill="url(#pg-w)" ${st()}/>`
    + `<ellipse cx="47" cy="17" rx="8" ry="10" fill="url(#pg-p)" ${st()}/>`
    + `<circle cx="44" cy="15" r="1.5" fill="${OUT}"/><circle cx="50" cy="15" r="1.5" fill="${OUT}"/><path d="M44 21c2 1.5 4 1.5 6 0" fill="none" ${st('stroke-width="2.2"')}/>`
    + `<ellipse cx="45" cy="10" rx="3" ry="1.6" fill="#fff" opacity=".8"/>`
    + `<path d="M28 12l6 2M26 20l5-1M33 6l4 4" fill="none" ${st('stroke-width="2.6"')}/>`),
  jump: svg(`<path d="M32 7l20 22H41v18H23V29H12z" fill="url(#pg-w)" ${st()}/>`
    + `<ellipse cx="30" cy="19" rx="5" ry="2.4" fill="#fff" opacity=".85"/>`
    + `<path d="M17 56h30" fill="none" ${st('stroke-width="4"')}/>`),
  sprint: svg(`<path d="M37 5L13 36h15l-5 23 25-33H34z" fill="url(#pg-y)" ${st()}/>`
    + `<ellipse cx="30" cy="16" rx="4" ry="2" fill="#fff" opacity=".8"/>`),
  interact: svg(`<rect x="18" y="11" width="7" height="24" rx="3.5" fill="url(#pg-w)" ${st()}/><rect x="27" y="7" width="7" height="28" rx="3.5" fill="url(#pg-w)" ${st()}/><rect x="36" y="9" width="7" height="26" rx="3.5" fill="url(#pg-w)" ${st()}/><rect x="45" y="15" width="7" height="20" rx="3.5" fill="url(#pg-w)" ${st()}/>`
    + `<path d="M18 30h34v8c0 10-7 18-17 18h-2c-6 0-10-3-12-8l-8-11c-2-3 2-7 6-4l-1 0z" fill="url(#pg-w)" ${st()}/>`
    + `<ellipse cx="34" cy="36" rx="8" ry="2.5" fill="#fff" opacity=".8"/>`),
  exit: svg(`<rect x="10" y="9" width="26" height="46" rx="4" fill="url(#pg-w)" ${st()}/><circle cx="30" cy="33" r="2.5" fill="${OUT}"/>`
    + `<path d="M36 32h19M49 24l8 8-8 8" fill="none" ${st('stroke-width="4"')}/>`),
  skate: svg(`<path d="M9 30c3-6 43-6 46 0l0 5c-3 6-43 6-46 0z" fill="url(#pg-b)" ${st()}/>`
    + `<circle cx="21" cy="46" r="5.5" fill="url(#pg-w)" ${st()}/><circle cx="43" cy="46" r="5.5" fill="url(#pg-w)" ${st()}/>`
    + `<path d="M21 40v-4M43 40v-4" fill="none" ${st('stroke-width="2.6"')}/><ellipse cx="24" cy="29" rx="8" ry="1.6" fill="#fff" opacity=".7"/>`),
  walk: svg(`<ellipse cx="23" cy="24" rx="7.5" ry="12" fill="url(#pg-w)" ${st()}/><circle cx="23" cy="42" r="4.5" fill="url(#pg-w)" ${st()}/>`
    + `<ellipse cx="42" cy="34" rx="7.5" ry="12" fill="url(#pg-w)" ${st()}/><circle cx="42" cy="52" r="4.5" fill="url(#pg-w)" ${st()}/>`),
  emote: svg(`<circle cx="32" cy="32" r="22" fill="url(#pg-y)" ${st()}/>`
    + `<circle cx="24" cy="27" r="3.2" fill="${OUT}"/><circle cx="40" cy="27" r="3.2" fill="${OUT}"/>`
    + `<path d="M21 38c6 7 16 7 22 0" fill="none" ${st('stroke-width="3.6"')}/><ellipse cx="24" cy="16" rx="6" ry="2.6" fill="#fff" opacity=".85"/>`),
  bag: svg(`<path d="M24 17v-4c0-5 16-5 16 0v4" fill="none" ${st()}/>`
    + `<rect x="15" y="17" width="34" height="38" rx="11" fill="url(#pg-b)" ${st()}/>`
    + `<path d="M15 30h34" fill="none" ${st('stroke-width="2.6"')}/><rect x="22" y="35" width="20" height="14" rx="5" fill="url(#pg-w)" ${st()}/><ellipse cx="26" cy="23" rx="6" ry="2.4" fill="#fff" opacity=".8"/>`),
};
const ICON_BY_LABEL = {EMOTE: 'emote', BAG: 'bag', SKATE: 'skate', WALK: 'walk', INTERACT: 'interact', EXIT: 'exit', SPRINT: 'sprint', JUMP: 'jump'};
function installEggyButtons() {
  if (!document.getElementById('party-defs')) { const d = document.createElement('div'); d.id = 'party-defs'; d.innerHTML = DEFS; document.body.prepend(d); }
  let dressed = null;
  const dress = () => { // the game's own Punch button: restyle in place, its click handlers stay
    const b = document.getElementById('preview-hit'); if (!b || b === dressed) return; dressed = b;
    b.style.cssText = 'position:fixed;right:20px;bottom:calc(280px + env(safe-area-inset-bottom));z-index:50;touch-action:manipulation;';
    b.classList.add('party-eggy', 'party-eggy-pink'); b.innerHTML = ICONS.punch + '<span>Punch</span>' + (isTouch ? '' : '<i class="party-key">F</i>');
  };
  const decorate = () => { // the park's round buttons: hide their line icon (CSS) and add the illustrated one, following label changes
    for (const el of document.querySelectorAll('.park-action')) {
      const label = (el.querySelector('span')?.textContent || el.getAttribute('aria-label') || '').trim().toUpperCase();
      const key = Object.keys(ICON_BY_LABEL).find(k => label.startsWith(k)); if (!key) continue;
      const icon = ICON_BY_LABEL[key]; if (el.dataset.partyIcon === icon) continue;
      el.querySelector('.party-icon')?.remove(); el.insertAdjacentHTML('beforeend', ICONS[icon]); el.dataset.partyIcon = icon;
    }
  };
  const tick = () => { try { dress(); decorate(); } catch {} };
  tick(); setInterval(tick, 400);
}

// ---------- settings panel ----------
function installSettings() {
  // Plain text pill in the top-right HUD column, under the online and friends pills (no icon).
  const gear = document.createElement('button');
  gear.id = 'party-settings-btn'; gear.type = 'button'; gear.textContent = 'Settings'; gear.setAttribute('aria-label', 'Party settings'); gear.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div'); panel.id = 'party-settings'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Party settings'); panel.hidden = true;
  const row = (label, control) => `<div class="party-row"><span>${label}</span>${control}</div>`;
  const toggle = (key, label) => row(label, `<button type="button" class="party-toggle" data-key="${key}" role="switch" aria-checked="${settings[key] ? 'true' : 'false'}" aria-label="${label}"><i></i></button>`);
  panel.innerHTML = `<div class="party-card"><div class="party-head"><strong>Party settings</strong><button type="button" class="party-close" aria-label="Close">&times;</button></div>
    ${row('Sound effects', `<input type="range" min="0" max="100" value="${Math.round(settings.sfx * 100)}" data-key="sfx" aria-label="Sound effects volume">`)}
    ${toggle('juice', 'Bouncy moves')}
    ${toggle('pads', 'Jump pads')}
    ${isTouch ? toggle('haptics', 'Vibration') : ''}
    <div class="party-hint">${isTouch ? 'Punch with the Punch button. Grab a player with Interact, then Throw.' : 'Punch: F. Grab a player: E. Throw them: T. Jump pads launch you high.'}</div>
    <div class="party-foot">67 Park party pack ${VERSION}</div></div>`;
  document.body.append(gear, panel);
  const open = v => { panel.hidden = !v; gear.setAttribute('aria-expanded', v ? 'true' : 'false'); sfx.play('click'); };
  gear.addEventListener('click', () => { sfx.ensure(); open(panel.hidden); });
  panel.querySelector('.party-close').addEventListener('click', () => open(false));
  panel.addEventListener('click', ev => { if (ev.target === panel) open(false); });
  const slider = panel.querySelector('input[data-key=sfx]');
  slider.addEventListener('input', ev => { sfx.ensure(); sfx.setVolume((+ev.target.value) / 100); });
  slider.addEventListener('change', () => sfx.play('jump'));
  for (const b of panel.querySelectorAll('.party-toggle')) b.addEventListener('click', () => { const k = b.dataset.key; settings[k] = !settings[k]; b.setAttribute('aria-checked', settings[k] ? 'true' : 'false'); saveSettings(); sfx.play('click'); });
  window.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !panel.hidden) open(false); });
}

try { installSettings(); installControls(); log('ready', VERSION, 'base', BASE, 'touch', isTouch); }
catch (e) { disabled = true; log('install failed', e); }
window.__party = {version: VERSION, settings, sfx, hits, netHook, botFlights, botsInFront, audio: () => sfx.state(),
  status: () => ({disabled, runtime: !!stateApi, carry: !!carryApi, spring: spring.v, map: player.map, ...items.count()}),
  debug: () => { const t = player.body?.translation?.(); const st = state(); return {...items.debug(), player: t ? {x: t.x, y: t.y, z: t.z} : null, state: st ? {grounded: st.grounded, speed: st.speed, vy: st.verticalVelocity, punchT: st.punchT, shake: st.shake, enabled: st.enabled} : null, id: net()?.id || null, remotes: net()?.remotes?.size ?? null}; }};
