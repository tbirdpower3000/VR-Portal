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
    ok('every part is there', ['mirror', 'subdivide', 'store', 'qr', 'screen', 'lens', 'textPlane', 'drawText', 'OneEuro', 'med3', 'Motion', 'camera', 'lensChoice', 'hands', 'steady', 'glide', 'handGuard', 'lookGate', 'fileStore', 'recorder', 'sound'].every((k) => VRE[k]));
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
    const mo = new VRE.Motion(); let o = null; for (let i = 0; i < 40; i++) o = mo.step([0.5, 0.5], i * 33);
    ok('Motion: a still hand is not led and not fast', o.fast === 0 && near(o.lead[0], 0.5, 1e-6));
    const mv = new VRE.Motion(); let q = null; for (let i = 0; i < 40; i++) q = mv.step([0.2 + i * 0.02, 0.5], i * 33); // 0.6 pictures a second
    ok('Motion: a fast hand is led ahead of where it was last seen', q.fast > 0.9 && q.lead[0] > 0.2 + 39 * 0.02, q.fast.toFixed(2) + ' ' + q.lead[0].toFixed(3));
    const mj = new VRE.Motion(); let c = null; for (let i = 0; i < 60; i++) c = mj.step([0.5 + (i % 2 ? 0.006 : -0.006), 0.5], i * 33);
    ok('Motion: a jittery still hand asks for more smoothing', c.calm < 0.85, c.calm.toFixed(2));
    const rc = VRE.recorder(); rc.frame(0, 0, [0, 0, 0, 1], null, null); const idle = rc.frames;
    rc.start({ game: 'test' }); const pts = Array.from({ length: 21 }, (_, i) => ({ x: 0.5 + i * 0.001, y: 0.25, z: 0.01 }));
    rc.frame(performance.now(), 70, [0, 0.7071, 0, 0.7071], pts, pts, [0.6]); rc.frame(performance.now(), 70, [0, 0, 0, 1], null, null); rc.event(performance.now(), 'shot', { hits: 1 }); rc.stop(); rc.frame(performance.now(), 0, [0, 0, 0, 1], null, null);
    const J = JSON.parse(rc.json());
    ok('recorder: nothing kept before start or after stop', idle === 0 && J.f.length === 2);
    ok('recorder: a found hand is 7 + 42 + 63 + 1 + extras numbers, a lost one 7', J.f[0].length === 7 + 42 + 63 + 1 + 1 && J.f[1].length === 7, J.f[0].length + ',' + J.f[1].length);
    ok('recorder: values survive as whole numbers', J.f[0][1] === 70 && J.f[0][3] === 7071 && J.f[0][7] === 5000 && J.f[0][8] === 2500 && J.f[0][J.f[0].length - 1] === 600 && J.e[0][1] === 'shot' && J.meta.game === 'test' && J.meta.engine === VRE.version);
    const lg = VRE.lookGate({ max: 60, slowMax: 30 });
    ok('lookGate: a repeated time, an earlier time and a repeated picture are all turned away', lg(1000, 1) && !lg(1000, 2) && !lg(990, 2) && !lg(1020, 1));
    let n60 = 0, n30 = 0; const lg2 = VRE.lookGate(); for (let i = 1; i <= 120; i++) if (lg2(5000 + i * 16.67, i)) n60++; const lg3 = VRE.lookGate(); for (let i = 1; i <= 120; i++) if (lg3(5000 + i * 16.67, i, true)) n30++;
    ok('lookGate: 60 a second when the view keeps up, 30 when it is slow', n60 >= 118 && n30 >= 58 && n30 <= 62, n60 + ',' + n30);
    { const sf = VRE.steady(1, 20), gg = { x: 0.3, v: 0 }; let sd = 7, mxs = 0, pv = 0.3; const rn = () => ((sd = (sd * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
      for (let i = 0; i < 90; i++) { if (i % 2 === 0) sf.f(0.3 + rn() * 0.004 + (i === 40 ? 0.05 : 0), i * 16.67); const xx = VRE.glide(gg, sf.f ? gg.x + (0.3 - gg.x) : 0.3, 0.03, 1 / 60); if (i > 20) mxs = Math.max(mxs, Math.abs(xx - pv)); pv = xx; }
      const sf2 = VRE.steady(1, 20); let worst = 0, last = 0.3; for (let i = 0; i < 60; i++) { const y = sf2.f(0.3 + rn() * 0.004 + (i === 30 ? 0.05 : 0), i * 33.3); if (i > 10) worst = Math.max(worst, Math.abs(y - last)); last = y; }
      ok('steady: a trembling still hand with a 5% spike moves the cleaned value under 0.2% a sighting', worst < 0.002, (worst * 100).toFixed(3) + '%');
      const g1 = { x: 0, v: 0 }; let past = 0, top = 0, p1 = 0; for (let i = 0; i < 200; i++) { const xx = VRE.glide(g1, 1, 0.11, 1 / 60, 2.6); if (xx > 1 + 1e-9) past++; top = Math.max(top, (xx - p1) * 60); p1 = xx; }
      ok('glide: arrives, never passes the target, keeps under the top speed', Math.abs(g1.x - 1) < 1e-3 && past === 0 && top <= 2.6 + 1e-6, g1.x.toFixed(4) + ' ' + past + ' ' + top.toFixed(2));
      const hg = VRE.handGuard(); const seq = [hg.sighting(0, 0.5, 0.5, 0.1), hg.sighting(33, 0.51, 0.5, 0.1), hg.sighting(66, 0.9, 0.5, 0.1), hg.sighting(99, 0.52, 0.5, 0.1), hg.sighting(132, 0.9, 0.5, 0.1), hg.sighting(165, 0.9, 0.5, 0.1), hg.sighting(198, 0.9, 0.5, 0.1), hg.sighting(231, 0.91, 0.5, 0.1)];
      ok('handGuard: one false jump is refused, a hand that really moved is taken up afresh', seq.join() === 'again,ok,doubt,ok,doubt,doubt,again,ok', seq.join());
      const pp = [hg.pinch(true), hg.pinch(false), hg.pinch(true), hg.pinch(true), hg.pinch(false), hg.pinch(false)];
      ok('handGuard: a pinch, and its release, must be seen twice running', pp.join() === 'false,false,false,true,true,false', pp.join()); }
    const m = VRE.med3(); m.f(1); m.f(9); ok('median of three drops a one-frame spike', m.f(1) === 1);
    VRE.store.set('vrEngineTest', { a: 1 });
    ok('saved settings come back', VRE.store.get('vrEngineTest', null).a === 1 && VRE.store.get('vrEngineMissing', 7) === 7);
    try { localStorage.removeItem('vrEngineTest'); } catch (e) {}
    const t = VRE.textPlane(1, 0.3, 200, 60); VRE.drawText(t, ['Hello']);
    ok('a text sign is a mesh with a canvas', t.isMesh && t.userData.c.width === 200 && t.userData.last.includes('Hello'));
    return out;
  });
  // the file store: a first read downloads and keeps the file, a second is served from the store, keep() forgets the rest
  let asked = 0; page.on('request', (q) => { if (q.url().endsWith('/cell.json')) asked++; });
  const fsr = await page.evaluate(async () => {
    const f = VRE.fileStore('vr-engine-test'); await f.clear();
    const a = await (await f.get('../cell.json')).json(); await new Promise((r) => setTimeout(r, 300));
    const had = await f.has('../cell.json'); const b = await (await f.get('../cell.json')).json();
    await f.keep([]); const after = await f.has('../cell.json'); await f.clear();
    return { same: a.version === b.version && !!a.version, had, after };
  });
  r.push({ name: 'fileStore: a file is kept after its first read and served from the store after', pass: fsr.same && fsr.had, got: JSON.stringify(fsr) });
  r.push({ name: 'fileStore: keep() forgets files not on the list', pass: fsr.after === false, got: String(fsr.after) });
  fs.mkdirSync(OUT, { recursive: true });
  const shot = path.join(OUT, 'demo.png'); await page.waitForTimeout(400); await page.screenshot({ path: shot });
  let failed = 0;
  for (const c of r) { if (!c.pass) failed++; console.log((c.pass ? '  ok   ' : '  FAIL ') + c.name + (c.pass || c.got == null ? '' : '  (got ' + c.got + ')')); }
  if (errors.length) { failed++; console.log('  FAIL page errors: ' + errors.join(' | ')); }
  console.log(`${r.length - failed + (errors.length ? 1 : 0)} of ${r.length} checks passed. Screenshot: ${shot}`);
  await browser.close(); server.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
