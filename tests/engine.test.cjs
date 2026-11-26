#!/usr/bin/env node
// Checks the VR engine by opening examples/demo.html in headless Chromium. Run from the repo root:
//   node tests/engine.test.cjs [--out DIR]
// Exits 1 if any check fails. Saves a screenshot of the demo (default: the system's temp folder).
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), { execSync } = require('child_process');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const outArg = process.argv.indexOf('--out'), OUT = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(os.tmpdir(), 'vr-engine-test');

// three.js r128 comes from cdnjs, which a sandbox may block; a copy from npm is served in its place
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

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/three.min.js', (r) => r.fulfill({ path: threeJs(), contentType: 'text/javascript' }));
  await page.goto(base + '/examples/demo.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__demo && window.__demo.lens.fov, null, { timeout: 15000 });
  const r = await page.evaluate(() => {
    const out = [], ok = (name, pass, got) => out.push({ name, pass: !!pass, got });
    const near = (a, b, tol) => Math.abs(a - b) <= (tol || 1e-6);
    ok('engine has a version', /^\d+\.\d+\.\d+$/.test(VRE.version), VRE.version);
    ok('every part is there', ['mirror', 'subdivide', 'store', 'qr', 'screen', 'lens', 'textPlane', 'drawText', 'OneEuro', 'med3', 'camera', 'hands', 'sound'].every((k) => VRE[k]));
    ok('mirror calls left then right', JSON.stringify(VRE.mirror((s) => s)) === '[-1,1]');
    ok('subdivide(0) is the whole picture', JSON.stringify(VRE.subdivide(0)) === '[{"s":1,"cx":0.5,"cy":0.5}]');
    const g = VRE.subdivide(1).map((c) => [c.cx, c.cy]);
    ok('subdivide(1): nine half-size parts, middle first, then below, sides, above', JSON.stringify(g) === '[[0.5,0.5],[0.5,0.75],[0.25,0.5],[0.75,0.5],[0.25,0.75],[0.75,0.75],[0.5,0.25],[0.25,0.25],[0.75,0.25]]', g.length);
    const g2 = VRE.subdivide(2);
    ok('subdivide(2): forty-nine quarter-size parts, all inside the picture', g2.length === 49 && g2.every((c) => c.s === 0.25 && c.cx - c.s / 2 >= -1e-9 && c.cx + c.s / 2 <= 1 + 1e-9 && c.cy - c.s / 2 >= -1e-9 && c.cy + c.s / 2 <= 1 + 1e-9), g2.length);
    // lens fitting, on an iPhone-sized screen (852 x 393 points)
    const L = __demo.lens, u = L.uniforms, wmm = innerWidth / (460 / 3 / 25.4);
    ok('lens centres are 63.9 mm apart', near((u.cR.value.x - u.cL.value.x) * wmm, 63.9, 0.01), ((u.cR.value.x - u.cL.value.x) * wmm).toFixed(2));
    ok('lens centres mirror about the middle of the screen', near(u.cL.value.x + u.cR.value.x, 1) && near(u.cL.value.y, u.cR.value.y));
    ok('lens centres are 32.2 mm above the bottom edge (35 mm less the bezel)', near(u.cL.value.y * (innerHeight / (460 / 3 / 25.4)), 32.2, 0.01));
    ok('the right eye sees what the left eye sees, mirrored', near(u.fL.value.x, u.fR.value.y) && near(u.fL.value.y, u.fR.value.x) && near(u.fL.value.z, u.fR.value.z) && near(u.fL.value.w, u.fR.value.w));
    ok('the two eyes are drawn with mirrored views', near(L.eyeL.projectionMatrix.elements[8] + L.eyeR.projectionMatrix.elements[8], 0) && near(L.eyeL.projectionMatrix.elements[0], L.eyeR.projectionMatrix.elements[0]));
    ok('no eye is drawn past 45 degrees from its lens', Math.max(L.fov.outer, L.fov.inner, L.fov.up, L.fov.down) <= 45 + 1e-6, JSON.stringify(L.fov));
    ok('distortion numbers are Google\'s', near(u.k.value.x, 0.33582564) && near(u.k.value.y, 0.55348791));
    // filters
    const f = new VRE.OneEuro(0.8, 3); let v = 0; for (let i = 0; i < 60; i++) v = f.f(1, i * 16);
    ok('One Euro filter holds a steady value', near(v, 1));
    const f2 = new VRE.OneEuro(0.8, 3); f2.f(0, 0); let w = 0; for (let i = 1; i < 120; i++) w = f2.f(1, i * 16);
    ok('One Euro filter follows a step', w > 0.95 && w <= 1.0001, w.toFixed(3));
    const m = VRE.med3(); m.f(1); m.f(9); ok('median of three drops a one-frame spike', m.f(1) === 1);
    VRE.store.set('vrEngineTest', { a: 1 });
    ok('saved settings come back', VRE.store.get('vrEngineTest', null).a === 1 && VRE.store.get('vrEngineMissing', 7) === 7);
    try { localStorage.removeItem('vrEngineTest'); } catch (e) {}
    const t = VRE.textPlane(1, 0.3, 200, 60); VRE.drawText(t, ['Hello']);
    ok('a text sign is a mesh with a canvas', t.isMesh && t.userData.c.width === 200 && t.userData.last.includes('Hello'));
    return out;
  });
  fs.mkdirSync(OUT, { recursive: true });
  const shot = path.join(OUT, 'demo.png'); await page.waitForTimeout(400); await page.screenshot({ path: shot });
  let failed = 0;
  for (const c of r) { if (!c.pass) failed++; console.log((c.pass ? '  ok   ' : '  FAIL ') + c.name + (c.pass || c.got == null ? '' : '  (got ' + c.got + ')')); }
  if (errors.length) { failed++; console.log('  FAIL page errors: ' + errors.join(' | ')); }
  console.log(`${r.length - failed + (errors.length ? 1 : 0)} of ${r.length} checks passed. Screenshot: ${shot}`);
  await browser.close(); server.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
