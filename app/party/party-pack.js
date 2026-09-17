// 67 Park party pack. Adds an Eggy Party style feel on top of the island without touching its
// systems: springy jump and landing squash, punches and throws that reach other players, a
// jump pads, park bots that fly when punched, synthesized sounds, haptics and a settings panel.
// Every hook is guarded: a fault here disables the pack and never stops the game.
// Loaded after app/main.js. Config: window.__partyConfig = {runtime: "<runtime ?v>", carry: "<carry ?v>"}.
import * as THREE from 'three';

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
const sfx = (() => {
  let ctx = null, master = null, noise = null;
  const ensure = () => {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = settings.sfx; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, () => ensure(), {passive: true, capture: true});
  const can = () => ctx && ctx.state === 'running' && !gameMuted() && settings.sfx > 0.001;
  const env = (node, t, peak, a, h, r) => { const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.setValueAtTime(Math.max(0.0002, peak), t + a + h); g.gain.exponentialRampToValueAtTime(0.0001, t + a + h + r); node.connect(g); g.connect(master); return g; };
  const tone = (type, f0, f1, dur, peak, a = 0.005, r = 0.08, detune = 0) => { const t = ctx.currentTime; const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur); o.detune.value = detune; env(o, t, peak, a, Math.max(0, dur - a), r); o.start(t); o.stop(t + dur + r + 0.02); };
  const burst = (type, freq, q, dur, peak, a = 0.002, r = 0.06) => { const t = ctx.currentTime; const s = ctx.createBufferSource(); s.buffer = noise; s.playbackRate.value = 0.8 + Math.random() * 0.4; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; s.connect(f); env(f, t, peak, a, Math.max(0, dur - a), r); s.start(t); s.stop(t + dur + r + 0.02); };
  const recipes = {
    jump: () => { tone('sine', 320, 720, 0.13, 0.22, 0.006, 0.09); tone('triangle', 160, 420, 0.1, 0.08, 0.004, 0.06); },
    double: () => { tone('sine', 480, 980, 0.14, 0.2, 0.005, 0.1); tone('sine', 720, 1400, 0.12, 0.1, 0.02, 0.1, 8); },
    land: hard => { burst('lowpass', hard ? 420 : 320, 0.8, hard ? 0.09 : 0.06, hard ? 0.35 : 0.18); tone('sine', hard ? 110 : 90, 45, 0.09, hard ? 0.28 : 0.14, 0.003, 0.08); },
    pad: () => { tone('triangle', 220, 1100, 0.22, 0.26, 0.006, 0.16); tone('sine', 440, 1650, 0.2, 0.12, 0.03, 0.14); burst('bandpass', 1800, 1.2, 0.05, 0.08); },
    swing: () => { burst('bandpass', 900, 0.9, 0.11, 0.16, 0.01, 0.05); },
    hit: () => { burst('lowpass', 500, 0.7, 0.07, 0.4); tone('square', 180, 70, 0.08, 0.22, 0.002, 0.06); tone('sine', 900, 300, 0.05, 0.1, 0.001, 0.03); },
    grab: () => { tone('sine', 520, 260, 0.09, 0.2, 0.003, 0.05); burst('highpass', 2500, 0.8, 0.03, 0.08); },
    throw: () => { burst('bandpass', 700, 0.8, 0.16, 0.2, 0.01, 0.08); tone('triangle', 400, 900, 0.14, 0.09, 0.01, 0.08); },
    click: () => { tone('sine', 900, 700, 0.03, 0.12, 0.002, 0.03); },
    stars: () => { for (let i = 0; i < 3; i++) setTimeout(() => can() && tone('sine', 1200 + i * 220, 1500 + i * 200, 0.08, 0.06, 0.005, 0.1), i * 90); },
  };
  return {
    ensure,
    play(name, arg) { if (!can() || !recipes[name]) return; try { recipes[name](arg); } catch {} },
    setVolume(v) { settings.sfx = clamp(v, 0, 1); if (master && ctx) master.gain.setTargetAtTime(settings.sfx, ctx.currentTime, 0.03); saveSettings(); },
  };
})();
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

// ---------- hooks called by main.js ----------
window.__partyStep = guard((body, input, dt, map) => {
  player.body = body || null; player.map = map;
  dt = clamp(finite(dt) ? dt : 0, 0, 0.05);
  netHook.step();
  knockStep(dt);
  if (map !== 'city' || !world()) return;
  items.step(body, dt);
  remotePops.step(dt);
  botFlights.step();
});
window.__partyVisual = guard((group, dt) => {
  player.visual = group || null;
  dt = clamp(finite(dt) ? dt : 0, 0, 0.05);
  const st = state();
  if (!group) return;
  if (!st || !st.enabled || player.map !== 'city' || !settings.juice || reducedMotion()) {
    if (wasEnabled) { group.scale.x = group.scale.z = 1; wasEnabled = false; }
    return;
  }
  wasEnabled = true;
  if (st.jumped === 1) { kick(0.16); sfx.play('jump'); buzz(8); }
  else if (st.jumped === 2) { kick(0.22); sfx.play('double'); buzz([8, 30, 8]); }
  if (st.landed) { const hard = st.landed > 9; kick(-0.30 * clamp(st.landed / 10, 0.5, 1)); sfx.play('land', hard); buzz(hard ? 22 : 10); }
  if (st.punchT > 0 && prevPunchT === 0) { kick(0.07); sfx.play('swing'); }
  if (st.punchImpact) { st.shake = Math.max(st.shake || 0, 0.22); hits.punch(); }
  prevPunchT = st.punchT || 0;
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
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#ffd6e6'; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 14; g.beginPath(); g.arc(128, 128, 96, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ff6fa3'; g.beginPath(); g.moveTo(128, 46); g.lineTo(186, 116); g.lineTo(150, 116); g.lineTo(150, 196); g.lineTo(106, 196); g.lineTo(106, 116); g.lineTo(70, 116); g.closePath(); g.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
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
      const pad = new THREE.Group(); pad.name = 'PARTY_pad'; pad.position.set(spot.x, y, spot.z);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.16, 40), new THREE.MeshStandardMaterial({color: '#ff9fc4', roughness: 0.6, metalness: 0}));
      base.position.y = 0.08; base.castShadow = true; base.receiveShadow = true;
      const top = new THREE.Mesh(new THREE.CircleGeometry(1.05, 40), new THREE.MeshStandardMaterial({map: tex, roughness: 0.5}));
      top.rotation.x = -Math.PI / 2; top.position.y = 0.165;
      pad.add(base, top); group.add(pad);
      pads.push({group: pad, x: spot.x, y, z: spot.z, squash: 0, phase: Math.random() * 6});
    }
    log('pads', pads.length);
  };
  const stepPads = (body, dt) => {
    padCooldown = Math.max(0, padCooldown - dt);
    const t = body?.translation?.(); const lv = body?.linvel?.();
    const now = performance.now() / 1000;
    for (const pad of pads) {
      pad.squash = Math.max(0, pad.squash - dt * 3.2);
      pad.group.position.y = pad.y + Math.sin(now * 2 + pad.phase) * 0.02;
      pad.group.scale.y = 1 - pad.squash * 0.55; pad.group.scale.x = pad.group.scale.z = 1 + pad.squash * 0.25;
      if (!t || !lv || padCooldown > 0) continue;
      const d = Math.hypot(t.x - pad.x, t.z - pad.z), dy = t.y - pad.y;
      if (d < 1.2 && dy > -0.3 && dy < 1.3 && lv.y <= 0.8) {
        const st = state(); if (!st?.enabled) continue;
        try { body.setLinvel({x: lv.x, y: 12.5, z: lv.z}, true); } catch { continue; }
        st.grounded = false; st.hover = false; st.airT = 0; st.jumpsLeft = 1; st.stretch = 1; st.fallPeak = 0; st.verticalVelocity = 12.5;
        pad.squash = 1; padCooldown = 0.55; kick(0.28); sfx.play('pad'); buzz([15, 30, 25]);
        fxRing([pad.x, pad.y + 0.1, pad.z], '#ffffff');
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
  if (!isTouch) return;
  const btn = document.createElement('button');
  btn.id = 'party-throw'; btn.type = 'button'; btn.className = 'party-btn'; btn.setAttribute('aria-label', 'Throw');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14c3-6 8-8 14-8"/><path d="M14 4l4 2-2 4"/><circle cx="6" cy="17" r="2.2"/><path d="M10 20l2-4"/></svg><span>Throw</span>';
  btn.addEventListener('pointerdown', ev => { ev.preventDefault(); ev.stopPropagation(); throwNow(); });
  btn.hidden = true; document.body.append(btn);
  setInterval(() => { try { btn.hidden = !(heldId() && player.map === 'city'); } catch {} }, 200);
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
window.__party = {version: VERSION, settings, sfx, hits, netHook, botFlights, botsInFront,
  status: () => ({disabled, runtime: !!stateApi, carry: !!carryApi, spring: spring.v, map: player.map, ...items.count()}),
  debug: () => { const t = player.body?.translation?.(); const st = state(); return {...items.debug(), player: t ? {x: t.x, y: t.y, z: t.z} : null, state: st ? {grounded: st.grounded, speed: st.speed, vy: st.verticalVelocity, punchT: st.punchT, shake: st.shake, enabled: st.enabled} : null, id: net()?.id || null, remotes: net()?.remotes?.size ?? null}; }};
