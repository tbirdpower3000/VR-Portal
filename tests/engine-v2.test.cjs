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
const results = []; const ok = (name, pass, got) => results.push({ name, pass: !!pass, got });

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
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

  let failed = 0;
  for (const c of results) { if (!c.pass) failed++; console.log((c.pass ? '  ok   ' : '  FAIL ') + c.name + (c.pass || c.got == null ? '' : '  (got ' + c.got + ')')); }
  console.log(`${results.length - failed} of ${results.length} checks passed. Screenshot: ${shot}`);
  await browser.close(); server.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
