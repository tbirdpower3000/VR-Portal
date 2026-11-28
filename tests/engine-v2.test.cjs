#!/usr/bin/env node
// Checks engine v2 (the parts added on top of v1) by opening its example pages in headless Chromium. From the repo root:
//   node tests/engine-v2.test.cjs [--out DIR]
// Exits 1 if any check fails. These cannot stand in for a phone: the motion sensors here are made-up events.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), { execSync } = require('child_process');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const outArg = process.argv.indexOf('--out'), OUT = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(os.tmpdir(), 'vr-engine-test');
function threeJs() {
  const dir = path.join(os.tmpdir(), 'vr-run-three'), file = path.join(dir, 'package/build/three.min.js');
  if (!fs.existsSync(file)) { fs.mkdirSync(dir, { recursive: true }); execSync('npm pack three@0.128.0 --silent && tar xzf three-0.128.0.tgz', { cwd: dir, stdio: 'ignore' }); }
  return file;
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const results = []; const ok = (name, pass, got) => { results.push({ name, pass: !!pass, got }); console.log((pass ? '  ok   ' : '  FAIL ') + name + (pass || got == null ? '' : '  (got ' + got + ')')); };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }); // a made-up camera, allowed without asking
  const open = async (init) => {
    const page = await browser.newPage({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2 });
    page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message));
    await page.route('**/three.min.js', (r) => r.fulfill({ path: threeJs(), contentType: 'text/javascript' }));
    if (init) await page.addInitScript(init);
    await page.goto(base + '/examples/v2-head.html?stereo=1', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__v2, null, { timeout: 15000 });
    return page;
  };
  // where the camera looks, in degrees: yaw to the right of straight ahead, pitch above the horizon
  const looking = (page) => page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(window.__v2.camera.quaternion); res({ yaw: Math.atan2(f.x, -f.z) * 57.2958, pitch: Math.asin(f.y) * 57.2958, jumped: window.__v2.head.jumped, motion: window.__v2.head.motion }); }))));
  const sensor = (page, alpha, beta, gamma) => page.evaluate(([a, b, g]) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: a, beta: b, gamma: g })), [alpha, beta, gamma]);
  const near = (x, y, tol) => Math.abs(x - y) <= (tol || 1);

  // ---- the parts of v1 are all still there, and the head is added ----
  // (this browser has the iPhone-style question and answers no to it; taken away here to stand for a browser that never asks)
  let page = await open('try { delete DeviceOrientationEvent.requestPermission; } catch (e) {}');
  const parts = await page.evaluate(() => ({ v: VRE.version, missing: ['mirror', 'subdivide', 'store', 'qr', 'screen', 'lens', 'textPlane', 'drawText', 'OneEuro', 'med3', 'Motion', 'camera', 'lensChoice', 'hands', 'steady', 'glide', 'handGuard', 'lookGate', 'fileStore', 'recorder', 'sound', 'head'].filter((k) => !VRE[k]) }));
  ok('v2 holds every part of v1, and the head', parts.v.startsWith('2.') && !parts.missing.length, parts.v + ' missing: ' + parts.missing.join(','));

  // ---- no motion sensors (a desktop): Start works, dragging looks around ----
  await page.click('#go');
  await page.waitForFunction(() => window.__v2.S.on);
  ok('Start shows the room; with nothing to ask, no message', (await page.isVisible('#vr')) && (await page.textContent('#status')) === '');
  await page.evaluate(() => window.__v2.head.test.look(30, -10));
  let L = await looking(page);
  ok('without sensors the view is turned by dragging', near(Math.abs(L.yaw), 30) && near(Math.abs(L.pitch), 10) && !L.motion, JSON.stringify(L));

  // ---- motion sensors: a phone held upright, then turned ----
  await sensor(page, 0, 90, 0); // upright, screen toward you
  await page.evaluate(() => window.__v2.head.recenter());
  L = await looking(page);
  ok('recenter: the way the phone faces becomes straight ahead', near(L.yaw, 0) && near(L.pitch, 0) && L.motion, JSON.stringify(L));
  await sensor(page, 40, 90, 0); // turned 40 degrees to the left (the compass angle grows anticlockwise)
  L = await looking(page);
  ok('turning the phone 40 degrees left turns the view 40 degrees left; the room stays put', near(L.yaw, -40) && near(L.pitch, 0), JSON.stringify(L));
  await sensor(page, 40, 60, 0); // tipped 30 degrees forward
  L = await looking(page);
  ok('tipping it 30 degrees turns the view 30 degrees down or up, not sideways', near(Math.abs(L.pitch), 30) && near(L.yaw, -40), JSON.stringify(L));
  await sensor(page, 40, 90, 0);
  const j = await page.evaluate(() => new Promise((res) => { const h = window.__v2.head; h.recenter(); const seen = []; let n = 0; const tick = () => { seen.push(h.jumped); if (++n < 4) requestAnimationFrame(tick); else res(seen); }; requestAnimationFrame(tick); }));
  L = await looking(page);
  ok('recenter again: facing 40 degrees left is now straight ahead', near(L.yaw, 0), JSON.stringify(L));
  ok('"jumped" is true for one picture after straight ahead is set again, then false', j.filter(Boolean).length === 1 && j[j.length - 1] === false, j.join());
  await page.mouse.click(300, 150); // the viewer's button is a tap on the screen: here it recentres
  await sensor(page, 100, 90, 0);
  L = await looking(page);
  ok('a tap recentres, and later turns are measured from there', near(L.yaw, -60), JSON.stringify(L));
  const fit = await page.evaluate(() => window.__v2.head.fit(document.getElementById('view'), window.__v2.camera && document.querySelector('#view canvas') ? { setSize() {} } : null));
  ok('fit: a page held sideways is ready and not turned', fit.ready && !fit.turned && fit.w === 852 && fit.h === 393, JSON.stringify(fit));
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(3300); // past the count of three
  const shot = path.join(OUT, 'v2-head.png'); await page.screenshot({ path: shot });
  await page.click('#exit');
  ok('Exit goes back to the start page and says what was used', (await page.isVisible('#setup')) && /motion sensors were used/.test(await page.textContent('#status')), await page.textContent('#status'));
  ok('no errors on the page', page.errors.length === 0, page.errors.join(' | '));
  await page.close();

  // ---- an iPhone: the question is asked from the Start press; a refusal gets a plain message ----
  for (const [answer, want] of [['denied', /Motion was not allowed/], ['granted', /^$/]]) {
    page = await open(`window.__asked = 0; DeviceOrientationEvent.requestPermission = async () => { window.__asked++; return '${answer}'; };`);
    await page.click('#go');
    await page.waitForFunction(() => window.__v2.S.on);
    const asked = await page.evaluate(() => window.__asked), text = await page.textContent('#status');
    ok(`the phone is asked once on Start; "${answer}" ${answer === 'denied' ? 'shows the plain message and the room still opens' : 'shows no message'}`, asked === 1 && want.test(text) && (await page.isVisible('#vr')), asked + ' "' + text.slice(0, 50) + '"');
    await page.close();
  }


  // =================== steps 2 to 5: look and pinch, windows, the home screen, see-through, 3D sound ===================
  const openAt = async (file, init) => {
    const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, permissions: ['camera'] });
    const page = await ctx.newPage();
    page.errors = []; page.warns = []; page.on('pageerror', (e) => page.errors.push(e.message)); page.on('console', (m) => m.type() === 'warning' && page.warns.push(m.text()));
    await page.route('**/three.min.js', (r) => r.fulfill({ path: threeJs(), contentType: 'text/javascript' }));
    await page.route('**/vision_bundle.mjs*', (r) => r.fulfill({ path: path.join(__dirname, 'fake-hands-v2.mjs'), contentType: 'text/javascript' }));
    await page.addInitScript(() => { try { delete DeviceOrientationEvent.requestPermission; } catch (e) {} window.__fake = { on: true, pinch: false }; window.__gum = 0; if (navigator.mediaDevices) { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = (c) => { window.__gum++; return g(c); }; } });
    if (init) await page.addInitScript(init);
    await page.goto(base + file, { waitUntil: 'load' });
    return page;
  };
  const start = async (page, hook) => { await page.waitForFunction((h) => document.getElementById('go') && window.VRE, hook); await page.click('#go'); await page.waitForFunction((h) => window[h] && window[h].sh.S.on && !window[h].sh.S.counting, hook, { timeout: 20000 }); await page.waitForTimeout(400); };
  // turn the head to look straight at an object (or a point on it, in its own units)
  const lookAt = (page, hook, pathJs, lx, ly) => page.evaluate(([h, pjs, lx, ly]) => new Promise((res) => { const K = window[h], o = new Function('K', 'return ' + pjs)(K); o.updateWorldMatrix(true, false); const p = new THREE.Vector3(lx || 0, ly || 0, 0).applyMatrix4(o.matrixWorld).normalize(); K.sh.head.test.look(-Math.atan2(p.x, -p.z) * 57.29578, Math.asin(p.y) * 57.29578); requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res))); }), [hook, pathJs, lx, ly]);
  const lookDir = (page, hook, yaw, pitch) => page.evaluate(([h, y, p]) => new Promise((res) => { window[h].sh.head.test.look(-y, p); requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res))); }), [hook, yaw, pitch]);
  const pinch = async (page, on, ms) => { await page.evaluate((v) => (window.__fake.pinch = v), on); await page.waitForTimeout(ms || 260); };
  const fromFlag = (await fs.promises.readFile(path.join(ROOT, 'apps.json'), 'utf8'));

  // ---- sizes by angle, the mirror rule, 3D sound, the apps list (no room needed) ----
  let pg = await openAt('/examples/v2-pointer.html?stereo=1');
  await start(pg, '__v2p');
  const pure = await pg.evaluate((appsText) => {
    const sh = window.__v2p.sh, out = {};
    out.a1 = VRE.angle(1, 1); out.a3 = VRE.angle(1, 3); out.back = VRE.angle(VRE.sizeAt(3, 1.5), 1.5);
    // the ring is one thing in the scene; each eye sees it from its own side, and the two views are mirror images
    sh.head.test.look(0, 0); sh.head.apply(); sh.stereo.aspect = 0.5; sh.stereo.update(sh.camera);
    const p = new THREE.Vector3(); sh.pointer.ring.getWorldPosition(p);
    const [l, r] = VRE.mirror((side) => p.clone().applyMatrix4((side < 0 ? sh.stereo.cameraL : sh.stereo.cameraR).matrixWorld.clone().invert()));
    out.mirror = [l.x + r.x, l.y - r.y, l.z - r.z, l.x];
    out.degs = window.__v2p.discs.map((d) => { d.mesh.scale.setScalar(1); d.mesh.updateMatrixWorld(true); return [d.deg, +sh.pointer.degOf(d.target).toFixed(2)]; }); // (a lit disc is drawn a little larger: measured unlit)
    sh.sound.tone('sine', 440, 440, 0.05, 0.05, { x: 1, y: 0, z: -1.5 }); out.placed = sh.sound.snd.placed; out.model = sh.sound.snd.model;
    const warn = console.warn; let warned = 0; console.warn = () => warned++;
    const bad = VRE.readApps([{ name: 'Good', kind: 'page', url: 'https://example.org/x' }, { name: 'No kind' }, { kind: 'page', url: 'x.html' }, { name: 'Script', kind: 'page', url: 'javascript:alert(1)' }, null, { name: 'Win', kind: 'window', app: 'w' }, { name: 'Win without app', kind: 'window' }]);
    console.warn = warn;
    out.apps = [bad.apps.length, bad.skipped.length, warned, bad.apps.map((a) => a.name).join()];
    out.real = VRE.readApps(JSON.parse(appsText)); out.real = [out.real.apps.length, out.real.skipped.length];
    out.home = VRE.fromHome('https://example.org/a') + ' ' + VRE.fromHome('b.html?x=1');
    return out;
  }, fromFlag);
  ok('angle: a thing 1 wide covers 53.13 degrees from 1 away and 18.92 from 3 away', near(pure.a1, 53.13, 0.01) && near(pure.a3, 18.92, 0.01) && near(pure.back, 3, 1e-9), pure.a1.toFixed(2) + ' ' + pure.a3.toFixed(2));
  ok('mirror: the ring is seen by the two eyes as exact mirror images', Math.abs(pure.mirror[0]) < 1e-9 && Math.abs(pure.mirror[1]) < 1e-9 && Math.abs(pure.mirror[2]) < 1e-9 && Math.abs(pure.mirror[3]) > 0.01, pure.mirror.map((v) => v.toExponential(1)).join(' '));
  ok('each disc on the wall covers the angle it claims', pure.degs.every(([want, got]) => near(want, got, 0.02)), JSON.stringify(pure.degs));
  ok('3D sound: a sound given a place in the room is placed with HRTF', pure.placed === 1 && pure.model === 'HRTF', pure.placed + ' ' + pure.model);
  ok('apps list: good entries load, bad ones are left out with a warning each, nothing crashes', pure.apps[0] === 2 && pure.apps[1] === 5 && pure.apps[2] === 5 && pure.apps[3] === 'Good,Win', JSON.stringify(pure.apps));
  ok('apps.json in the repo: every entry is good', pure.real[0] === 8 && pure.real[1] === 0, JSON.stringify(pure.real));
  ok('a game opened from home is told so', pure.home === 'https://example.org/a?from=home b.html?x=1&from=home', pure.home);

  // ---- look and pinch ----
  const st = () => pg.evaluate(() => { const K = window.__v2p, P = K.sh.pointer.state; return { goal: K.goal.deg, hover: P.hover ? P.hover.deg : null, down: P.down, mode: P.mode, seen: K.sh.hand.seen, T: JSON.parse(JSON.stringify(K.T)), fill: P.fill }; });
  await pg.waitForFunction(() => window.__v2p.sh.hand.seen, null, { timeout: 8000 });
  let s0 = await st();
  await lookAt(pg, '__v2p', 'K.goal.mesh');
  let s1 = await st();
  ok('hover: the disc under the ring is lit before any pinch', s1.hover === s0.goal && !s1.down, JSON.stringify({ goal: s0.goal, hover: s1.hover }));
  await pinch(pg, true);
  const down = (await st()).down;
  await lookAt(pg, '__v2p', 'K.discs.find((d) => d !== K.goal).mesh'); // the head drifts onto another disc while the fingers are closed
  await pinch(pg, false);
  let s2 = await st();
  ok('the pick is locked when the pinch begins: it goes to what was lit then, not to where the head ended up', down && s2.T[s0.goal].hit === 1 && Object.values(s2.T).reduce((a, v) => a + v.miss, 0) === 0, JSON.stringify(s2.T[s0.goal]));
  await lookDir(pg, '__v2p', 60, 40); await pinch(pg, true, 200); await pinch(pg, false);
  let s3 = await st();
  ok('a pinch on nothing is counted as a miss, against the size being aimed for', s3.T[s3.goal].miss === 1, JSON.stringify(s3.T[s3.goal]));
  await lookAt(pg, '__v2p', 'K.goal.mesh'); await pg.mouse.click(400, 150);
  let s4 = await st();
  ok('the viewer\'s button (a tap) picks what is lit', s4.T[s3.goal].hit === 1, JSON.stringify(s4.T[s3.goal]));
  await lookDir(pg, '__v2p', 70, 45); await pinch(pg, true, 1300);
  const fwdAfter = await pg.evaluate(() => { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(window.__v2p.sh.camera.quaternion); return [f.x, f.y, f.z]; });
  await pinch(pg, false);
  ok('pinch and hold on empty space for a second sets straight ahead again', near(fwdAfter[0], 0, 0.02) && near(fwdAfter[2], -1, 0.02), fwdAfter.map((v) => v.toFixed(2)).join());
  await pg.evaluate(() => (window.__fake.on = false));
  await lookDir(pg, '__v2p', 60, 40); await pg.waitForTimeout(3400);
  const gBefore = (await st()).goal;
  await lookAt(pg, '__v2p', 'K.goal.mesh'); await pg.waitForTimeout(600);
  const mid = await st();
  await pg.waitForTimeout(700);
  let s5 = await st();
  ok('no hand for three seconds: resting the ring on a disc for a second picks it, and the ring fills meanwhile', mid.mode === 'dwell' && mid.fill > 0.3 && mid.fill < 1 && s5.T[gBefore].hit >= 1, JSON.stringify({ mode: mid.mode, fill: +mid.fill.toFixed(2), hit: s5.T[gBefore].hit }));
  const looks = await pg.evaluate(() => { const a = window.__looks || []; let dup = 0, fast = 0; for (let i = 1; i < a.length; i++) { if (a[i] <= a[i - 1]) dup++; if (a[i] - a[i - 1] < 30) fast++; } return [a.length, dup, fast]; });
  ok('the hand is looked for at most 30 times a second and never with a repeated time', looks[0] > 20 && looks[1] === 0 && looks[2] === 0, looks.join());
  await pg.screenshot({ path: path.join(OUT, 'v2-pointer.png') });
  ok('look and pinch: no errors on the page', pg.errors.length === 0, pg.errors.join(' | '));
  await pg.context().close();

  // ---- floating windows ----
  pg = await openAt('/examples/v2-windows.html?stereo=1');
  await start(pg, '__v2w');
  const W = () => pg.evaluate(() => { const K = window.__v2w; return { n: K.wins.list.length, ids: K.wins.list.map((w) => w.id).join(), notes: (() => { const w = K.wins.get('notes'); return w ? { yaw: w.yaw * 57.29578, pitch: w.pitch * 57.29578, s: w.s, dist: w.g.position.length(), facing: new THREE.Vector3(0, 0, 1).applyQuaternion(w.g.quaternion).dot(w.g.position.clone().normalize()) } : null; })(), count: K.count, level: K.level, saved: K.wins.layout() }; });
  let w0 = await W();
  ok('two windows open, a metre and a half away, a little below eye level, not on top of each other', w0.n === 2 && near(w0.notes.dist, 1.5, 0.01) && w0.notes.pitch < 0 && w0.saved.notes && w0.saved.clock && Math.abs(w0.saved.notes.yaw - w0.saved.clock.yaw) > 24, JSON.stringify(w0.saved));
  await lookDir(pg, '__v2w', 50, 20);
  const stay = await W();
  ok('windows stay where they are while the head turns', near(stay.notes.yaw, w0.notes.yaw, 1e-6), stay.notes.yaw.toFixed(2));
  await lookAt(pg, '__v2w', "K.wins.get('notes').targets[0].object"); await pinch(pg, true);
  const y0 = await pg.evaluate(() => { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(window.__v2w.sh.camera.quaternion); return [Math.atan2(f.x, -f.z) * 57.29578, Math.asin(f.y) * 57.29578]; });
  await lookDir(pg, '__v2w', y0[0] + 25, y0[1] + 10); await pg.waitForTimeout(200); await pinch(pg, false);
  let w1 = await W();
  ok('pinch the bar and turn the head: the window goes with you, keeps its distance and faces you', near(w1.notes.yaw - w0.notes.yaw, 25, 1.5) && near(w1.notes.pitch - w0.notes.pitch, 10, 1.5) && near(w1.notes.dist, 1.5, 0.01) && w1.notes.facing < -0.999, JSON.stringify(w1.notes));
  ok('where it was left is saved', near(w1.saved.notes.yaw, w1.notes.yaw, 0.1), JSON.stringify(w1.saved.notes));
  await lookAt(pg, '__v2w', "K.wins.get('notes').targets[2].object"); await pinch(pg, true);
  const y1 = await pg.evaluate(() => { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(window.__v2w.sh.camera.quaternion); return [Math.atan2(f.x, -f.z) * 57.29578, Math.asin(f.y) * 57.29578]; });
  await lookDir(pg, '__v2w', y1[0] + 12, y1[1]); await pg.waitForTimeout(200); await pinch(pg, false);
  let w2 = await W();
  ok('pinch the corner and turn right: the window grows', w2.notes.s > 1.2 && w2.notes.s <= 1.8, w2.notes.s.toFixed(2));
  await lookAt(pg, '__v2w', "K.wins.get('clock').panel", (60 + 180) / 1000 - 0.45, 0.3 - (84 + 200 + 55) / 1000); await pinch(pg, true); await pinch(pg, false);
  await lookAt(pg, '__v2w', "K.wins.get('clock').panel", (470 + 6 + 0.75 * 358) / 1000 - 0.45, 0.3 - (84 + 230 + 35) / 1000); await pinch(pg, true); await pinch(pg, false);
  let w3 = await W();
  ok('inside a window: the button is picked, and the slider is set where it is picked', w3.count === 1 && near(w3.level, 0.75, 0.03), w3.count + ' ' + w3.level.toFixed(3));
  await lookAt(pg, '__v2w', "K.wins.get('notes').targets[1].object"); await pinch(pg, true); await pinch(pg, false);
  let w4 = await W();
  ok('the dot closes a window, and that is remembered', w4.n === 1 && w4.ids === 'clock' && w4.saved.notes.open === false, w4.ids);
  await lookAt(pg, '__v2w', 'K.dock.icons[0].mesh'); await pinch(pg, true); await pinch(pg, false);
  let w5 = await W();
  ok('its icon opens it again where it was left', w5.n === 2 && !!w5.notes && near(w5.notes.yaw, w1.notes.yaw, 0.2) && near(w5.notes.s, w2.notes.s, 0.02), JSON.stringify(w5.notes) + ' ' + w5.ids);
  const five = await pg.evaluate(() => { const K = window.__v2w; ['a', 'b', 'c'].forEach((id) => K.wins.open({ id, title: id, w: 0.5, h: 0.3 })); return K.wins.list.map((w) => w.id).join(); });
  ok('at most four windows: a fifth closes the one used longest ago', five.split(',').length === 4 && five.endsWith('a,b,c'), five);
  await pg.screenshot({ path: path.join(OUT, 'v2-windows.png') });
  ok('windows: no errors on the page', pg.errors.length === 0, pg.errors.join(' | '));
  // a fresh visit: the windows come back where they were left
  const pg2 = await pg.context().newPage();
  await pg2.route('**/three.min.js', (r) => r.fulfill({ path: threeJs(), contentType: 'text/javascript' }));
  await pg2.route('**/vision_bundle.mjs*', (r) => r.fulfill({ path: path.join(__dirname, 'fake-hands-v2.mjs'), contentType: 'text/javascript' }));
  await pg2.addInitScript(() => { try { delete DeviceOrientationEvent.requestPermission; } catch (e) {} window.__fake = { on: true, pinch: false }; });
  await pg2.goto(base + '/examples/v2-windows.html?stereo=1', { waitUntil: 'load' });
  await start(pg2, '__v2w');
  const again = await pg2.evaluate(() => { const w = window.__v2w.wins.get('notes'); return w ? [w.yaw * 57.29578, w.s] : [NaN, NaN, window.__v2w.wins.list.map((q) => q.id).join()]; });
  ok('on the next visit the layout is read back from the store', near(again[0], w1.notes.yaw, 0.2) && near(again[1], w2.notes.s, 0.02), again.map((v) => v.toFixed(2)).join());
  await pg.context().close();

  // ---- the home screen, see-through and pacing ----
  pg = await openAt('/home.html?stereo=1');
  const asked = []; pg.on('request', (q) => { if (/Skeet-Game/.test(q.url())) asked.push(q.url()); });
  await pg.route('**/Skeet-Game/**', (r) => r.fulfill({ body: '<title>stand-in for the game</title>', contentType: 'text/html' }));
  await pg.route('**/v1/vr-engine.js', (r) => r.fulfill({ path: path.join(ROOT, 'v1/vr-engine.js'), contentType: 'text/javascript' }));
  await start(pg, '__home');
  const H = () => pg.evaluate(() => { const K = window.__home; return { icons: K.home.icons.length, names: K.home.icons.map((i) => i.app.name).join(), wins: K.wins.list.map((w) => w.id).join(), v: K.pass.value, live: K.pass.state.live, plane: K.pass.plane.visible, sky: K.pass.sky.visible, skyOp: K.pass.sky.material.opacity, bright: K.pass.plane.material.color.r, across: K.home.icons.map((i) => +K.sh.pointer.degOf(i.target).toFixed(1)), gap: Math.abs(K.home.icons[0].yaw - K.home.icons[1].yaw) * 57.29578 }; });
  await pg.waitForFunction(() => window.__home.pass.state.live, null, { timeout: 8000 });
  let h0 = await H();
  ok('home: the tiles come from apps.json, each well over 3 degrees across (10.5 by 15), three to a row, 16.2 degrees apart', h0.icons === 8 && h0.across.every((d) => d >= 10.4) && near(h0.gap, 16.2, 0.01), h0.names + ' ' + h0.across[0] + ' ' + h0.gap.toFixed(1));
  ok('see-through starts as the room dimmed: the camera picture is shown darker, the sky is not', h0.live && h0.plane && !h0.sky && near(h0.v, 0.5, 1e-9) && h0.bright < 0.5 && h0.bright > 0.2, JSON.stringify({ v: h0.v, bright: +h0.bright.toFixed(2) }));
  await lookAt(pg, '__home', "K.home.icons.find((i) => i.app.app === 'surroundings').mesh"); await pinch(pg, true); await pinch(pg, false);
  let h1 = await H();
  const aside = await pg.evaluate(() => [window.__home.home.shown, window.__home.dock.shown]);
  ok('picking a window icon opens its window, and the icons step aside for it', h1.wins === 'surroundings' && aside[0] === false && aside[1] === true, h1.wins + ' ' + aside.join());
  await lookAt(pg, '__home', "K.wins.get('surroundings').panel", (600 + 125) / 1000 - 0.45, 0.25 - (84 + 80 + 45) / 1000); await pinch(pg, true); await pinch(pg, false);
  let h2 = await H();
  ok('"Sky" swaps the room for the scene: the camera picture is hidden, the sky fully shown', near(h2.v, 1, 1e-9) && !h2.plane && h2.sky && near(h2.skyOp, 1, 1e-9), JSON.stringify(h2));
  await lookAt(pg, '__home', "K.wins.get('surroundings').panel", (40 + 125) / 1000 - 0.45, 0.25 - (84 + 80 + 45) / 1000); await pinch(pg, true); await pinch(pg, false);
  let h3 = await H();
  ok('"My room" shows the camera picture at full brightness', near(h3.v, 0, 1e-9) && h3.plane && !h3.sky && near(h3.bright, 1, 1e-9), JSON.stringify({ v: h3.v, bright: h3.bright }));
  const paced = await pg.evaluate(() => { const sh = window.__home.sh, before = sh.perf.pr; let t = performance.now(); for (let i = 0; i < 400; i++) { t += 40; sh.pace(t, 40); } return [before, sh.perf.pr]; });
  ok('with see-through on, slow pictures still lower the sharpness, but never under the floor that keeps words readable', paced[1] <= paced[0] && paced[1] >= Math.min(2.5, paced[0]), paced.join(' -> '));
  await pg.screenshot({ path: path.join(OUT, 'v2-home-window.png') });
  await lookAt(pg, '__home', 'K.dock.icons[0].mesh'); await pinch(pg, true); await pinch(pg, false);
  const back = await pg.evaluate(() => [window.__home.wins.list.length, window.__home.home.shown, window.__home.dock.shown]);
  ok('the Home icon closes the windows and brings the icons back', back[0] === 0 && back[1] === true && back[2] === false, back.join());
  await pg.screenshot({ path: path.join(OUT, 'v2-home.png') });
  const type = await pg.evaluate(() => { const K = window.__home, seen = []; const x = document.createElement('canvas').getContext('2d'); const real = x.constructor.prototype.fillText; x.constructor.prototype.fillText = function (s) { const m = /(\d+)px/.exec(this.font); if (m && String(s).trim().length > 2) seen.push(+m[1]); return real.apply(this, arguments); };
    const w = K.APPS.status(); w.redraw(); const a = K.APPS.about(); a.redraw(); x.constructor.prototype.fillText = real;
    const px = Math.min(...seen), deg = VRE.angle(px / 1000, 1.5); K.wins.closeAll(); return [px, +deg.toFixed(2), VRE.TEXT_DEG]; });
  ok('words in a window are over two degrees tall (60 pixels is 2.3 degrees at this distance)', type[0] >= 54 && type[1] >= 2.0, type.join(' '));
  const sharpness = await pg.evaluate(() => { const sh = window.__home.sh; return [sh.perf.min, sh.perf.max, window.devicePixelRatio]; });
  ok('the home screen is drawn at the screen\'s full sharpness (up to 3) and never under 2.5, or the screen\'s own if that is less', sharpness[1] === Math.min(3, sharpness[2]) && sharpness[0] === Math.min(2.5, sharpness[1]), sharpness.join(' '));
  ok('home: no errors on the page', pg.errors.length === 0, pg.errors.join(' | '));
  await lookAt(pg, '__home', "K.home.icons.find((i) => i.app.name === 'Skeet VR').mesh"); await pinch(pg, true); await pinch(pg, false);
  await pg.waitForTimeout(500);
  const card = await pg.evaluate(() => [window.__home.wins.list.map((w) => w.id).join(), window.__home.home.shown, location.pathname]);
  ok('picking a game\'s tile opens its card first; nothing is left yet', card[0] === 'card' && card[1] === false && /home\.html$/.test(card[2]) && asked.length === 0, card.join(' '));
  await lookAt(pg, '__home', "K.wins.get('card').panel", (520 + 210) / 1000 - 0.5, 0.28 - (84 + 330 + 55) / 1000); await pinch(pg, true); await pinch(pg, false);
  await pg.waitForTimeout(400);
  const notNow = await pg.evaluate(() => [window.__home.wins.list.length, window.__home.home.shown]);
  ok('"Not now" closes the card and the tiles come back', notNow[0] === 0 && notNow[1] === true && asked.length === 0, notNow.join());
  await lookAt(pg, '__home', "K.home.icons.find((i) => i.app.name === 'Skeet VR').mesh"); await pinch(pg, true); await pinch(pg, false);
  await lookAt(pg, '__home', "K.wins.get('card').panel", (60 + 210) / 1000 - 0.5, 0.28 - (84 + 330 + 55) / 1000); await pinch(pg, true); await pinch(pg, false);
  await pg.waitForTimeout(1200);
  ok('"Open" asks for the game\'s page, saying it came from home', asked.some((u) => /Skeet-Game\/\?from=home$/.test(u)), asked.join(' '));
  // ---- a game run inside the home screen: one page, one camera, nothing asked twice ----
  {
    await pg.evaluate(() => { if (window.VRE_HOST) window.VRE_HOST.back(); }); // (the stand-in opened by the check above is sent away first)
    const before = await pg.evaluate(() => ({ gum: window.__gum, tracks: window.__home.sh.S.stream.getVideoTracks()[0].readyState }));
    await pg.evaluate(() => { window.__shown = 0; window.__back = 0; window.__home.sh.play('tests/fixtures/hosted.html?from=home', { onShown() { window.__shown++; }, onBack() { window.__back++; } }); });
    const early = await pg.evaluate(() => { const S = window.__home.sh.S; return { paused: !!S.paused, opacity: S.game.frame.style.opacity }; });
    await pg.waitForFunction(() => { const g = window.__home.sh.S.game; return g && g.shown; }, null, { timeout: 15000 });
    await pg.evaluate(() => { for (let i = 0; i < 5; i++) window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 10 + i, beta: 90, gamma: 0 })); });
    const during = await pg.evaluate(() => { const S = window.__home.sh.S, w = S.game.frame.contentWindow, T = w.__game; return { hosted: T.hosted, gumInGame: w.__gum, gumHome: window.__gum, sameStream: T.streamIsHosts, sameAudio: T.audioIsHosts, orient: T.orient, paused: S.paused, opacity: S.game.frame.style.opacity, shown: window.__shown, err: T.err || '', cam: T.info.cam === window.__home.sh.info.cam }; });
    ok('a game opened from home runs inside the same page; the home keeps drawing until the game says it is running', early.paused === false && early.opacity === '0' && during.hosted && during.paused === true && during.opacity === '1' && during.shown === 1, JSON.stringify({ early, during }));
    ok('the camera is lent, not opened again: the game never asks for it, and gets the very same picture', during.gumInGame === 0 && during.gumHome === before.gum && during.sameStream && during.cam && !during.err, JSON.stringify(during));
    ok('the sound is the home\'s own (already awake), and the motion sensors are passed on to the game', during.sameAudio && during.orient >= 5, during.sameAudio + ' ' + during.orient);
    await pg.frameLocator('iframe').locator('#leave').click();
    await pg.waitForTimeout(300);
    const after = await pg.evaluate(() => { const S = window.__home.sh.S; return { game: !!S.game, frames: document.querySelectorAll('iframe').length, paused: !!S.paused, track: S.stream.getVideoTracks()[0].readyState, back: window.__back, host: !!window.VRE_HOST, tiles: window.__home.home.shown }; });
    ok('the game\'s Exit comes back to the home screen: the frame is gone, the home is drawing again, the camera is still open', !after.game && after.frames === 0 && !after.paused && after.track === 'live' && after.back === 1 && !after.host, JSON.stringify(after));
    const far = await pg.evaluate(() => [window.__home.sh.canHost('../Skeet-Game/'), window.__home.sh.canHost('https://example.org/game/')]);
    ok('only a page of this same site is run inside; any other is opened the ordinary way', far[0] === true && far[1] === false, far.join());
  }
  await pg.context().close();

  // ---- rotation lock: an upright page with the phone on its side. The line between the eyes must turn with the view ----
  {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, permissions: ['camera'] }); // an iPhone 15 Pro's screen
    const pt = await ctx.newPage(); const perr = []; pt.on('pageerror', (e) => perr.push(e.message));
    await pt.route('**/three.min.js', (r) => r.fulfill({ path: threeJs(), contentType: 'text/javascript' }));
    await pt.route('**/vision_bundle.mjs*', (r) => r.fulfill({ path: path.join(__dirname, 'fake-hands-v2.mjs'), contentType: 'text/javascript' }));
    await pt.addInitScript(() => { try { delete DeviceOrientationEvent.requestPermission; } catch (e) {} window.__fake = { on: false }; });
    await pt.goto(base + '/home.html', { waitUntil: 'load' });
    await pt.waitForFunction(() => window.__home); await pt.click('#go'); await pt.waitForFunction(() => window.__home.sh.S.on);
    // the phone lying on its side: its right-hand edge points up
    await pt.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 0, gamma: -90 })));
    await pt.waitForTimeout(300);
    const box = await pt.evaluate(() => { const m = document.getElementById('vreMid').getBoundingClientRect(), v = document.getElementById('vreView').getBoundingClientRect(), S = window.__home.sh.S; return { turned: S.turned, rot: S.rot, mw: m.width, mh: m.height, my: m.top + m.height / 2, vy: v.top + v.height / 2, vw: v.width, vh: v.height }; });
    ok('rotation lock: the view is turned a quarter, and the line between the eyes turns with it (across the page, at its middle)', box.turned && Math.abs(box.rot) === 90 && box.mw > 300 && box.mh < 4 && near(box.my, 426, 2) && near(box.vw, 393, 1) && near(box.vh, 852, 1), JSON.stringify(box));
    fs.mkdirSync(OUT, { recursive: true }); await pt.waitForTimeout(3600); await pt.screenshot({ path: path.join(OUT, 'v2-home-turned.png') });
    const sharp = await pt.evaluate(() => { const sh = window.__home.sh, L = sh.lens; return { pr: sh.perf.pr, eye: [L.ew, L.eh], perDeg: +(L.ew / (2 * Math.atan(1) * 57.29578) * 1).toFixed(1) }; });
    // at the middle of the view: points of screen to the unit of tangent (237 on this phone) times the sharpness, per degree
    const perDegree = 237 * sharp.pr * Math.PI / 180;
    ok('on a phone screen of 3 pixels a point the home is drawn at 3 and never under 2.5 (this slow test machine drops it to the floor): 10 to 12 pixels to a degree, so 2.3 degree words are 24 to 28 pixels tall', sharp.pr >= 2.5 && sharp.pr <= 3 && sharp.eye[0] > 1100 && perDegree * 2.3 > 23, JSON.stringify(sharp) + ' ' + perDegree.toFixed(1));
    ok('rotation lock: no errors on the page', perr.length === 0, perr.join(' | '));
    await ctx.close();
  }

  let failed = 0;
  for (const c of results) if (!c.pass) failed++;
  console.log(`${results.length - failed} of ${results.length} checks passed. Screenshot: ${shot}`);
  await browser.close(); server.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
