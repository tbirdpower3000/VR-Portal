// Reads a hand recording made by a game's "Record my hand" (VRE.recorder) and prints what it says about the tracking.
//   node tests/hand-report.cjs FILE.json
// Each look is [t, age, qx, qy, qz, qw, found, 21 x (x, y), 21 x (x, y, z), has3D, extras...]; positions are x 10,000.
const fs = require('fs');
const R = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const f = R.f, n = f.length, found = f.filter((r) => r[6]);
const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const pct = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const fx = (v, d = 2) => (v == null ? null : +v.toFixed(d));
const gaps = []; for (let i = 1; i < n; i++) gaps.push(f[i][0] - f[i - 1][0]);
// runs of lost looks
let runs = [], run = 0; for (const r of f) { if (!r[6]) run++; else if (run) { runs.push(run); run = 0; } } if (run) runs.push(run);
// the fingertip (point 8) and the palm's middle, in picture widths; movement from one look to the next
const tip = (r) => [r[7 + 16] / 1e4, r[8 + 16] / 1e4], palmW = (r) => Math.hypot(r[7 + 10] - r[7 + 34], r[8 + 10] - r[8 + 34]) / 1e4;
const steps = [], jumps = [], sizes = found.map(palmW);
for (let i = 1; i < n; i++) if (f[i][6] && f[i - 1][6]) { const a = tip(f[i - 1]), b = tip(f[i]), d = Math.hypot(b[0] - a[0], b[1] - a[1]), w = palmW(f[i]) || 1e-6; steps.push(d / w); if (d / w > 0.6) jumps.push(f[i][0]); }
// stillness: over each half second where the palm barely moved, how much the fingertip wandered (in palm widths)
const still = [];
for (let i = 0; i + 15 < n; i += 15) { const w = f.slice(i, i + 15); if (!w.every((r) => r[6])) continue; const xs = w.map((r) => tip(r)[0]), ys = w.map((r) => tip(r)[1]), pw = med(w.map(palmW)); const rx = Math.max(...xs) - Math.min(...xs), ry = Math.max(...ys) - Math.min(...ys); if (Math.hypot(rx, ry) / pw < 0.25) { const mx = xs.reduce((a, b) => a + b) / 15, my = ys.reduce((a, b) => a + b) / 15; still.push(Math.sqrt(xs.reduce((a, x, k) => a + (x - mx) ** 2 + (ys[k] - my) ** 2, 0) / 15) / pw); } }
// the thumb reading (first extra, x 1000; -1 means none)
const thumb = found.map((r) => r[113]).filter((v) => v != null && v >= 0).map((v) => v / 1000);
const ev = {}; for (const e of R.e) ev[e[1]] = (ev[e[1]] || 0) + 1;
const shots = R.e.filter((e) => e[1] === 'shot');
console.log(JSON.stringify({
  meta: R.meta, seconds: n ? fx((f[n - 1][0] - f[0][0]) / 1000, 1) : 0, looks: n,
  looksPerSecond: fx(1000 / (med(gaps) || 1), 1), slowLooks: gaps.filter((g) => g > 2.5 * (med(gaps) || 1)).length,
  pictureAgeMs: { usual: med(f.map((r) => r[1])), worst: pct(f.map((r) => r[1]), 0.95) },
  handLost: { share: fx(1 - found.length / (n || 1)), runs: runs.length, longestRun: runs.length ? Math.max(...runs) : 0 },
  with3D: fx(found.filter((r) => r[112]).length / (found.length || 1)),
  palmWidthOfPicture: { usual: fx(med(sizes), 3), smallest: fx(pct(sizes, 0.05), 3), largest: fx(pct(sizes, 0.95), 3) },
  fingertipStepInPalms: { usual: fx(med(steps), 3), fast: fx(pct(steps, 0.95), 3), jumps: jumps.length },
  stillHandShakeInPalms: { windows: still.length, usual: fx(med(still), 4), worst: fx(pct(still, 0.9), 4) },
  thumbReading: { n: thumb.length, low: fx(pct(thumb, 0.05)), middle: fx(med(thumb)), high: fx(pct(thumb, 0.95)) },
  events: ev, shots: { n: shots.length, hit: shots.filter((e) => e[2] && e[2].hits).length, byThumb: shots.filter((e) => e[2] && e[2].by === 'thumb').length },
}, null, 1));
