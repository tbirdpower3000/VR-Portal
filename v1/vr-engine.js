// VR engine for tbirdpower3000's phone VR games (Google Cardboard, 2015).
// The parts every game shares, taken out of Skeet VR and Fruit Slicer VR, where the same code used to be kept twice:
//   VRE.mirror / VRE.subdivide   the two rules of repetition: the two eyes, and the picture split into parts
//   VRE.store            saved settings and rounds (this browser only)
//   VRE.qr()             the QR code on a setup page
//   VRE.screen()         the drawing surface, with its resolution lowered while frames run slow
//   VRE.lens()           fitting each eye's picture to the viewer's lenses
//   VRE.textPlane / VRE.drawText   signs made of text, in the scene
//   VRE.OneEuro / VRE.med3         the filters that steady a hand
//   VRE.Motion           the atlas's tracker for a moving hand: lead on fast moves, more smoothing on a jittery still one
//   VRE.camera()         opening the rear camera (the player's choice of lens, 60 pictures a second, recovery)
//   VRE.lensChoice()     the Auto / Fisheye / Regular choice on a setup page
//   VRE.hands()          the hand finder (graphics chip first, processor if not; looking at part of the picture)
//   VRE.steady() VRE.glide() VRE.handGuard()   steady, continuous hand control: cleaned sightings, gliding movement, false input refused
//   VRE.lookGate()       when to look for the hand: never a repeated time, at most so many times a second, fewer when the view is slow
//   VRE.fileStore()      large data files kept in the phone's own store after the first download
//   VRE.recorder()       keeps what the hand finder saw during play (points, no picture), for tuning against a real hand
//   VRE.sound()          tones and noise, placed left or right
// It is a plain script with no build step. three.js must be loaded before it. Each game loads this file from the
// folder v1. Additions that leave existing parts working as they did (1.1, 1.2, ...) are made here in place and reach
// every game on its next load; a change that would break a game goes in a new folder (v2) that games move to one by one.
(function () {
  'use strict';
  if (!window.THREE) { console.error('vr-engine: three.js must be loaded first'); return; }
  const $ = (id) => document.getElementById(id);
  const D = Math.PI / 180;
  const VRE = { version: '1.6.0' };

  // ---------- running inside the VR Portal home ----------
  // The home screen can run a game inside itself, in a frame that fills the screen, so that going into a game is not a
  // change of page: nothing is asked again and the view never drops out. The home page leaves a note for the game
  // (window.VRE_HOST on the page that holds the frame): its open camera, its sound, a way to say "I am running" and a
  // way back. A game finds it here. On its own page there is no host and everything works as it always did.
  Object.defineProperty(VRE, 'host', { get() { try { return window.parent !== window && window.parent.VRE_HOST ? window.parent.VRE_HOST : null; } catch (e) { return null; } } });

  // ---------- the two rules of repetition ----------
  // Around: a headset is the same thing twice, mirrored. Work for the left (-1) and the right (+1) is written once.
  VRE.mirror = function (fn) { return [-1, 1].map((side) => fn(side)); };
  // Down: the picture split into overlapping parts, each half the size of the one above, to a given depth. Depth 0 is
  // the whole picture; depth 1 is nine half-size parts (a three-by-three grid, each overlapping its neighbours by
  // half); depth 2 is quarter-size parts, and so on. The parts come back in the order worth looking in when searching
  // for a hand: the middle first, then below it, then the sides, then above.
  VRE.subdivide = function (depth) {
    if (!(depth > 0)) return [{ s: 1, cx: 0.5, cy: 0.5 }];
    const s = Math.pow(0.5, depth), cells = [];
    for (let cy = s / 2; cy <= 1 - s / 2 + 1e-9; cy += s / 2) for (let cx = s / 2; cx <= 1 - s / 2 + 1e-9; cx += s / 2) cells.push({ s, cx, cy });
    const cost = (c) => { const dx = c.cx - 0.5, dy = c.cy - 0.5; return (dy > 0 ? 4 * dy : 16 * -dy) + 8 * Math.abs(dx) + (dx > 0 ? 0.1 : 0); };
    return cells.sort((a, b) => cost(a) - cost(b));
  };

  // ---------- saved settings ----------
  const store = (VRE.store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  });

  // ---------- the QR code on a setup page ----------
  // needs <div id="qr"> and <p id="qrUrl"> on the page, and vendor/qrcode-generator.js beside it
  VRE.qr = function () {
    // a QR code for this page's own address (without any ?options), so it can be opened on the phone by scanning the screen
    (function () {
      const url = location.origin + location.pathname;
      $('qrUrl').textContent = url;
      const sc = document.createElement('script');
      sc.src = 'vendor/qrcode-generator.js'; // qrcode-generator 1.4.4, Kazuhiko Arase, MIT licence
      sc.onload = () => {
        try {
          const q = qrcode(0, 'M');
          q.addData(url);
          q.make();
          $('qr').innerHTML = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
        } catch (e) { $('qr').hidden = true; }
      };
      sc.onerror = () => { $('qr').hidden = true; };
      document.head.appendChild(sc);
    })();
  };

  // ---------- the drawing surface ----------
  // playing(): whether a round is being played now, so the frame rate saved with a round is the round's own
  VRE.screen = function (playing) {
    const PR_MAX = Math.min(devicePixelRatio || 1, 2);
    const renderer = new THREE.WebGLRenderer({ antialias: (devicePixelRatio || 1) < 2, powerPreference: 'high-performance' });
    renderer.setPixelRatio(PR_MAX);
    const perf = { pr: PR_MAX, ft: 16.7, hold: 0, upAfter: 0, n: 0, sum: 0 };
    function pace(now, gap) {
      if (!(gap > 0 && gap < 500)) return;
      perf.ft += (gap - perf.ft) * 0.05;
      if (playing()) { perf.n++; perf.sum += gap; }
      if (now < perf.hold) return;
      let pr = perf.pr;
      if (perf.ft > 21 && pr > 1) { pr = Math.max(1, pr - 0.25); perf.upAfter = now + 10000; }
      else if (perf.ft < 17.5 && pr < PR_MAX && now > perf.upAfter) pr = Math.min(PR_MAX, pr + 0.25);
      if (pr !== perf.pr) { perf.pr = pr; renderer.setPixelRatio(pr); perf.hold = now + 1500; perf.ft = 16.7; }
    }
    return { renderer, perf, pace, PR_MAX };
  };

  // ---------- fitting the picture to the viewer's lenses ----------
  // needs the setup page's controls: <input id="lensOn">, <input id="lensSize">, <output id="lensSizeO">
  VRE.lens = function ({ renderer, scene, camera, stereo }) {
    // The viewer is the Google Cardboard of 2015 (I/O 2015, "version 2"), with the figures from Google's own viewer profile:
    // lenses 63.9 mm apart, 39.3 mm from the screen, their centres 35 mm above the edge the phone rests on, and a
    // pincushion stretch of 1 + k1 r^2 + k2 r^4 (r measured from the lens's centre, in screen-to-lens distances).
    // Each eye's picture is drawn flat into an off-screen picture, with its middle on the lens's own axis and at the size
    // that makes angles true, and then put on the screen through the opposite of the lens's stretch, so the lens undoes
    // it. Google's design figures for this lens are a round field 80 degrees across, the eye 18 mm behind it, and the
    // screen seen as if 0.67 m away. So the picture is drawn out to 45 degrees from the lens's axis and fades to black
    // from 41, just past the designed field; drawing no wider keeps it sharp and quick.
    const VIEWER = { lensSep: 63.9, toScreen: 39.3, baseline: 35, k1: 0.33582564, k2: 0.55348791, maxDeg: 45 };
    const PT_PER_MM = 460 / 3 / 25.4; // an iPhone's screen: 460 pixels to the inch, three pixels to the point
    const BEZEL_MM = 2.8;             // from the phone's edge to where its screen begins
    const lens = Object.assign({ on: true, size: 100 }, store.get('vrLens', {}), { rt: null, key: '', eyeL: new THREE.PerspectiveCamera(), eyeR: new THREE.PerspectiveCamera() });
    $('lensOn').checked = !!lens.on; $('lensSize').value = lens.size; $('lensSizeO').textContent = lens.size + '%';
    const lensSave = () => { lens.on = $('lensOn').checked; lens.size = +$('lensSize').value; $('lensSizeO').textContent = lens.size + '%'; lens.key = ''; store.set('vrLens', { on: lens.on, size: lens.size }); };
    $('lensOn').onchange = lensSave; $('lensSize').oninput = lensSave;
    const lensStretch = (r) => r * (1 + VIEWER.k1 * r * r + VIEWER.k2 * r * r * r * r);
    const lensMat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { map: { value: null }, size: { value: new THREE.Vector2() }, cL: { value: new THREE.Vector2() }, cR: { value: new THREE.Vector2() }, fL: { value: new THREE.Vector4() }, fR: { value: new THREE.Vector4() }, k: { value: new THREE.Vector2(VIEWER.k1, VIEWER.k2) }, rmax: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: [
        'precision highp float;',
        'uniform sampler2D map; uniform vec2 size, cL, cR, k; uniform vec4 fL, fR; uniform float rmax; varying vec2 vUv;',
        'void main() {',
        '  bool right = vUv.x > 0.5;',
        '  vec2 c = right ? cR : cL; vec4 f = right ? fR : fL;',
        '  vec2 p = (vUv - c) * size;',                       // this spot on the screen, from the lens centre, in screen-to-lens distances
        '  float r2 = dot(p, p);',
        '  vec2 v = p * (1.0 + k.x * r2 + k.y * r2 * r2);',   // where the lens makes that spot appear: the direction to show there
        '  vec2 t = vec2((v.x + f.x) / (f.x + f.y), (v.y + f.z) / (f.z + f.w));',
        '  float shade = 1.0 - smoothstep(rmax * 0.87, rmax, length(v));',
        '  if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);',
        '  else gl_FragColor = vec4(texture2D(map, vec2((t.x + (right ? 1.0 : 0.0)) * 0.5, t.y)).rgb * shade, 1.0);',
        '}',
      ].join('\n'),
    });
    const lensScene = new THREE.Scene(), lensCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const lensQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lensMat);
    lensQuad.frustumCulled = false;
    lensScene.add(lensQuad);
    const lensM = new THREE.Matrix4();
    // works out, for this screen, how far each eye can see each way and where the lens centres fall; remade when the
    // screen, the picture size or the drawing resolution changes
    function lensFit(w, h) {
      const pr = renderer.getPixelRatio(), key = [w, h, pr, lens.size].join();
      if (key === lens.key) return;
      lens.key = key;
      const mm = PT_PER_MM * (lens.size / 100), wmm = w / mm, hmm = h / mm, d = VIEWER.toScreen, cap = Math.tan(VIEWER.maxDeg * D);
      const see = (dist) => Math.min(cap, lensStretch(Math.max(0, dist) / d)); // how far out the eye sees through the lens, as a tangent
      const below = Math.min(hmm * 0.7, Math.max(hmm * 0.3, VIEWER.baseline - BEZEL_MM)); // the lens centre above the picture's lower edge
      const outer = see((wmm - VIEWER.lensSep) / 2), inner = see(VIEWER.lensSep / 2), down = see(below), up = see(hmm - below);
      const u = lensMat.uniforms;
      u.size.value.set(wmm / d, hmm / d);
      u.rmax.value = cap;
      lens.fov = { outer: Math.atan(outer) / D, inner: Math.atan(inner) / D, up: Math.atan(up) / D, down: Math.atan(down) / D };
      // One eye is worked out and the other is its mirror image: the lens centre sits the same distance the other side
      // of the middle, and "towards the nose" and "towards the ear" change places.
      const n = camera.near, f = camera.far;
      VRE.mirror((side) => {
        const eye = side < 0 ? { c: u.cL, f: u.fL, cam: lens.eyeL } : { c: u.cR, f: u.fR, cam: lens.eyeR };
        const lft = side < 0 ? outer : inner, rgt = side < 0 ? inner : outer;
        eye.c.value.set(0.5 + (side * VIEWER.lensSep) / 2 / wmm, below / hmm);
        eye.f.value.set(lft, rgt, down, up);
        eye.cam.projectionMatrix.makePerspective(-lft * n, rgt * n, up * n, -down * n, n, f);
        eye.cam.projectionMatrixInverse.copy(eye.cam.projectionMatrix).invert();
        eye.cam.matrixAutoUpdate = false;
      });
      // the off-screen picture: as sharp at its middle as the screen is there, held to a size a phone draws comfortably
      const perTan = d * mm * pr, k = Math.min(1, 1500 / ((outer + inner) * perTan), 1500 / ((up + down) * perTan));
      const ew = Math.max(64, Math.round((outer + inner) * perTan * k)), eh = Math.max(64, Math.round((up + down) * perTan * k));
      if (lens.rt) lens.rt.dispose();
      lens.rt = new THREE.WebGLRenderTarget(ew * 2, eh, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
      lens.ew = ew; lens.eh = eh;
      u.map.value = lens.rt.texture;
    }
    function lensRender(w, h) {
      lensFit(w, h);
      const rt = lens.rt, half = stereo.eyeSep / 2;
      [[lens.eyeL, -half, 0], [lens.eyeR, half, lens.ew]].forEach(([cam, dx, x]) => {
        cam.matrix.copy(camera.matrixWorld).multiply(lensM.makeTranslation(dx, 0, 0));
        cam.matrixWorld.copy(cam.matrix);
        cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
        rt.viewport.set(x, 0, lens.ew, lens.eh); rt.scissor.set(x, 0, lens.ew, lens.eh); rt.scissorTest = true;
        renderer.setRenderTarget(rt);
        renderer.clear();
        renderer.render(scene, cam);
      });
      renderer.setRenderTarget(null);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
      renderer.render(lensScene, lensCam);
    }
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 0.7);
    sun.position.set(1, 3, 2);
    scene.add(sun);
    lens.uniforms = lensMat.uniforms; // for checks
    return { lens, lensFit, lensRender, VIEWER };
  };

  // ---------- signs made of text ----------
  VRE.textPlane = function (w, h, cw, ch) {
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
    m.renderOrder = 20;
    m.userData = { c, x: c.getContext('2d'), tex, last: '' };
    return m;
  }
  VRE.drawText = function (m, lines, opt) {
    const key = JSON.stringify(lines) + (opt && opt.ring != null ? opt.ring.toFixed(2) : '');
    if (key === m.userData.last) return;
    m.userData.last = key;
    const { c, x, tex } = m.userData;
    x.clearRect(0, 0, c.width, c.height);
    if (!opt || opt.bg !== false) {
      x.fillStyle = 'rgba(7,11,20,0.72)';
      const r = 26;
      x.beginPath(); x.moveTo(r, 0); x.arcTo(c.width, 0, c.width, c.height, r); x.arcTo(c.width, c.height, 0, c.height, r); x.arcTo(0, c.height, 0, 0, r); x.arcTo(0, 0, c.width, 0, r); x.fill();
    }
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const n = lines.length;
    lines.forEach((ln, i) => {
      const big = i === 0;
      x.font = `${big ? 700 : 500} ${big ? Math.min(64, c.height / (n + 0.6)) : Math.min(40, c.height / (n + 1.6))}px system-ui, sans-serif`;
      x.fillStyle = big ? '#ffd88a' : '#e9eef5';
      x.fillText(ln, c.width / 2, (c.height * (i + 0.5 + (big ? 0 : 0.15))) / n);
    });
    if (opt && opt.ring != null) {
      x.strokeStyle = '#ffd88a'; x.lineWidth = 8;
      x.beginPath(); x.arc(c.width - 50, 50, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * opt.ring); x.stroke();
    }
    tex.needsUpdate = true;
  }

  // ---------- filters ----------
  VRE.OneEuro = class OneEuro {
    constructor(minCut, beta) { this.minCut = minCut; this.beta = beta; this.reset(); }
    reset() { this.x = null; this.dx = 0; this.t = null; }
    a(c, dt) { const r = 2 * Math.PI * c * dt; return r / (r + 1); }
    f(v, t) {
      if (this.x === null) { this.x = v; this.t = t; return v; }
      const dt = Math.max(1e-3, (t - this.t) / 1000);
      this.t = t;
      this.dx += this.a(1, dt) * ((v - this.x) / dt - this.dx);
      this.x += this.a(this.minCut + this.beta * Math.abs(this.dx), dt) * (v - this.x);
      return this.x;
    }
  }
  VRE.med3 = () => { const q = []; return { f(v) { q.push(v); if (q.length > 3) q.shift(); return q.length < 3 ? v : [...q].sort((a, b) => a - b)[1]; }, reset() { q.length = 0; } }; };

  // ---------- following a moving hand ----------
  // Taken from the Planetary Modeling Atlas's hand control, where it was tuned against alternatives. It is fed a point
  // in "camera pictures" (0..1 across) each time the hand is seen, and gives back: lead, the point led ahead of a fast
  // hand to cancel the camera's delay; fast, 0..1, how far to trust that lead over the smoothed point; and calm, 1 down
  // to 0.4, a factor for the smoothing filter's cutoff that turns the smoothing up while a nearly still hand jitters.
  // ---- fast and accelerating moves: an alpha-beta-gamma tracker (position, velocity and acceleration, predicted then
  // corrected each frame) runs beside the smoothing. When the hand moves fast it takes over, leading the hand by up to
  // 60 ms to cancel the camera's delay, and it stops leading the moment the hand decelerates, so a fast stop doesn't
  // overshoot. Its gains rise with acceleration, so a sudden start is followed at once. A first-order high-pass filter
  // (4 Hz) on the raw position picks out the quick, jittery part of the motion; while the hand is nearly still, a strong
  // high-pass signal turns the smoothing up.
  VRE.Motion = class Motion {
    constructor() {
      this.reset();
    }
    reset() {
      this.p = null;
      this.v = [0, 0];
      this.a = [0, 0];
      this.t = null;
      this.hp = [0, 0];
      this.z0 = null;
      this.speed = 0;
      this.fast = 0;
      this.hpMag = 0;
      this.vl = [0, 0];
    }
    step(z, t) {
      if (!this.p) {
        this.p = [z[0], z[1]];
        this.z0 = [z[0], z[1]];
        this.t = t;
        return { lead: [z[0], z[1]], fast: 0, calm: 1 };
      }
      const dt = Math.max(1e-3, Math.min(0.1, (t - this.t) / 1000));
      this.t = t;
      // high-pass: y[n] = k (y[n-1] + x[n] − x[n-1]), k = RC / (RC + dt), cutoff 4 Hz
      const rc = 1 / (2 * Math.PI * 4),
        k = rc / (rc + dt);
      for (let i = 0; i < 2; i++) this.hp[i] = k * (this.hp[i] + z[i] - this.z0[i]);
      this.z0 = [z[0], z[1]];
      this.hpMag += (Math.hypot(this.hp[0], this.hp[1]) - this.hpMag) * 0.2;
      // alpha-beta-gamma: alpha from 0.5 (smooth) to 0.9 (follow) with acceleration; beta and gamma from the standard relations
      const acc = Math.hypot(this.a[0], this.a[1]),
        alpha = 0.5 + 0.4 * Math.min(1, acc / 25),
        beta = 2 * (2 - alpha) - 4 * Math.sqrt(1 - alpha),
        gamma = (beta * beta) / (2 * alpha);
      for (let i = 0; i < 2; i++) {
        const pp = this.p[i] + this.v[i] * dt + 0.5 * this.a[i] * dt * dt,
          vp = this.v[i] + this.a[i] * dt,
          r = z[i] - pp;
        this.p[i] = pp + alpha * r;
        this.v[i] = vp + (beta * r) / dt;
        this.a[i] = this.a[i] * 0.9 + (2 * gamma * r) / (dt * dt);
      }
      // the velocity averaged over about 0.15 s: a tremor's back-and-forth cancels out, a real move doesn't, so a shaky but
      // still hand never counts as fast
      const kv = 1 - Math.exp(-dt / 0.08); // speed averaged over 80 ms (was 150): the lead starts sooner
      for (let i = 0; i < 2; i++) this.vl[i] += (this.v[i] - this.vl[i]) * kv;
      this.speed = Math.hypot(this.vl[0], this.vl[1]); // in camera pictures per second
      const s = Math.max(0, Math.min(1, (this.speed - 0.15) / 0.35)); // the lead fades in from ordinary reaching speeds (was from 0.6)
      this.fast = s * s * (3 - 2 * s);
      const braking = this.vl[0] * this.a[0] + this.vl[1] * this.a[1] < 0,
        lead = braking ? 0 : 0.06 * this.fast;
      // while nearly still, strong high-pass energy (jitter) asks for more smoothing: 1 = none needed, down to 0.4
      const calm = this.speed < 0.3 ? Math.max(0.4, Math.min(1, 1 - (this.hpMag - 0.002) / 0.008)) : 1;
      return { lead: [this.p[0] + this.vl[0] * lead, this.p[1] + this.vl[1] * lead], fast: this.fast, calm };
    }
  }

  // ---------- the rear camera ----------
  // vid: the page's <video>; plainKey: the name under which "leave this phone on the ordinary camera" is remembered;
  // info: an object that is given .cam (the camera's name), .camFps (pictures a second it settled on), .camLens (the lens
  // asked for) and .camWide (whether the widest camera was found and used)
  // lens: a function giving the player's choice of lens: 'auto' (the widest, unless it has failed twice on this phone),
  // 'wide' (always try the widest, the fisheye view) or 'regular' (the ordinary rear camera, not zoomed out)
  VRE.LENSES = ['auto', 'wide', 'regular'];
  // the choice of lens on a setup page: radio buttons named "camLens" with those three values, kept for every game
  VRE.lensChoice = function () {
    const radios = [...document.querySelectorAll('input[name=camLens]')], saved = store.get('vrCamLens', 'auto');
    radios.forEach((r) => { r.checked = r.value === (VRE.LENSES.includes(saved) ? saved : 'auto'); r.onchange = () => store.set('vrCamLens', r.value); });
    return () => { const r = radios.find((x) => x.checked); return r && VRE.LENSES.includes(r.value) ? r.value : 'auto'; };
  };
  VRE.camera = function ({ vid, plainKey, info, lens }) {
    // One rear camera is opened: the widest one when the fisheye lens is chosen (or Auto has not seen it fail). The phone lists its rear cameras by name once the
    // camera is allowed. A separate ultra-wide (0.5x) camera is taken first; failing that, a combined camera ("Triple",
    // "Dual Wide") that can zoom out to the ultra-wide lens; failing that, the ordinary one. Whichever opens is then zoomed
    // out as far as it goes, and a candidate is kept only if it really is a rear camera.
    const camSize = { width: { ideal: 1280 }, height: { ideal: 720 } };
    // The camera is asked for 60 pictures a second where it can give them: the hand is then seen twice as often, so the
    // blade or crosshair is fresher and a fast hand moves less between sightings. It is a wish, not a demand, so a camera
    // that only does 30 still opens; and if a phone refuses the request outright, it is asked again without it.
    const openCam = (how) =>
      navigator.mediaDevices.getUserMedia({ audio: false, video: Object.assign({}, how, camSize, { frameRate: { ideal: 60 } }) })
        .catch(() => navigator.mediaDevices.getUserMedia({ audio: false, video: Object.assign({}, how, camSize) }));
    const stopCam = (st) => st.getTracks().forEach((t) => t.stop());
    async function zoomOut(track) {
      try {
        const z = track.getCapabilities && track.getCapabilities().zoom;
        if (z && z.min != null && track.getSettings().zoom > z.min) await track.applyConstraints({ advanced: [{ zoom: z.min }] });
      } catch (e) {}
    }
    async function startCamera() {
      // inside the home screen the camera is already open there, and is handed over as it is: nothing is asked for
      // again, and the picture does not stop and start
      const host = VRE.host;
      if (host && host.stream && host.stream.active) {
        vid.srcObject = host.stream;
        const pl = vid.play();
        if (pl && pl.catch) pl.catch(() => {});
        Object.assign(info, host.info || {});
        for (let i = 0; i < 60 && vid.readyState < 2; i++) await new Promise((r) => setTimeout(r, 50));
        return host.stream;
      }
      let st = await openCam({ facingMode: { ideal: 'environment' } });
      let track = st.getVideoTracks()[0], switched = false;
      // The widest camera is tried unless it has failed to give a picture twice running on this phone. One failure is
      // not held against it (a phone can be slow to start a camera once), and a success wipes the slate.
      const fails = +store.get(plainKey, 0) || 0; // an earlier version saved true here after one failure; that counts as one
      const want = lens ? lens() : 'auto', tryWide = want === 'wide' || (want === 'auto' && fails < 2);
      info.camLens = want;
      info.camWide = want === 'regular' ? 'not asked for' : tryWide ? 'tried' : 'given up after two failures';
      if (want === 'regular' && /ultra/i.test(track.label || '')) {
        // the phone handed over its fisheye camera by itself: look for an ordinary rear one instead
        try {
          const plain = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'videoinput' && d.deviceId && /back|rear|environment/i.test(d.label) && !/ultra|front|selfie|tele/i.test(d.label));
          if (plain) { stopCam(st); st = await openCam({ deviceId: { exact: plain.deviceId } }); track = st.getVideoTracks()[0]; }
        } catch (e) {}
      }
      if (tryWide) try {
        const front = /front|selfie|facetime|user/i, cur = track.getSettings ? track.getSettings().deviceId : null;
        const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId && !front.test(d.label));
        const rank = (d) => (/ultra/i.test(d.label) ? 0 : /triple/i.test(d.label) ? 1 : /dual.*wide|wide.*dual/i.test(d.label) ? 2 : 9);
        const wider = cams.filter((d) => rank(d) < 9 && rank(d) < rank({ label: track.label || '' })).sort((x, y) => rank(x) - rank(y));
        for (const d of wider) {
          if (d.deviceId === cur) break;
          stopCam(st);
          let got = null;
          try { got = await openCam({ deviceId: { exact: d.deviceId } }); } catch (e) {}
          const facing = got && got.getVideoTracks()[0].getSettings ? got.getVideoTracks()[0].getSettings().facingMode : null;
          if (got && facing !== 'user') { st = got; track = st.getVideoTracks()[0]; switched = true; break; }
          if (got) stopCam(got);
          st = await openCam({ facingMode: { ideal: 'environment' } });
          track = st.getVideoTracks()[0];
        }
      } catch (e) {}
      if (track.readyState === 'ended') { st = await openCam({ facingMode: { ideal: 'environment' } }); track = st.getVideoTracks()[0]; }
      if (want !== 'regular') await zoomOut(track); // the ordinary lens is left at its own view
      // The video is started without waiting on it: a camera that opens but never gives a picture would otherwise hold
      // the game at the setup page for good. A wider camera that gives no picture within four seconds is given up for
      // this time: the ordinary camera is opened in its place, and the failure is counted.
      const pictures = async (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (vid.readyState >= 2 && vid.videoWidth > 0) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
      const show = () => { vid.srcObject = st; const pl = vid.play(); if (pl && pl.catch) pl.catch(() => {}); };
      show();
      if (switched && !(await pictures(4000))) {
        store.set(plainKey, fails + 1);
        info.camWide = 'gave no picture';
        switched = false;
        stopCam(st);
        st = await openCam({ facingMode: { ideal: 'environment' } });
        track = st.getVideoTracks()[0];
        show();
      }
      if (!(await pictures(3000))) { stopCam(st); throw new Error('The camera gave no picture'); }
      if (switched) { store.set(plainKey, 0); info.camWide = 'in use'; }
      info.cam = track.label || '';
      info.camFps = (track.getSettings && Math.round(track.getSettings().frameRate || 0)) || 0; // what the camera settled on
      return st;
    }
    return { startCamera, stopCam };
  };

  // ---------- the hand finder ----------
  // vid: the page's <video>; MP: the address of MediaPipe Tasks Vision
  VRE.hands = function ({ vid, MP }) {
    let landmarker = null;
    // The hand finder. It is tried on the phone's graphics chip first, which is quickest. If that cannot be set up, or it
    // is set up but then fails on picture after picture, the same hand finder is made on the ordinary processor instead:
    // slower, but it runs everywhere. What went wrong is kept, to be shown on the setup page and saved with the round.
    const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
    const handSys = { on: '', err: '', make: null, fails: 0, swapping: false };
    const errText = (e) => String((e && (e.message || e.name)) || e || 'unknown').slice(0, 120);
    async function loadHands() {
      handSys.err = '';
      let mod;
      try { mod = await import(MP + '/vision_bundle.mjs'); }
      catch (e) { await new Promise((r) => setTimeout(r, 600)); mod = await import(MP + '/vision_bundle.mjs?again=1'); } // one more try at fetching it
      const fs = await mod.FilesetResolver.forVisionTasks(MP + '/wasm');
      handSys.make = (delegate) => mod.HandLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate },
        runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      try { landmarker = await handSys.make('GPU'); handSys.on = 'GPU'; }
      catch (e) { handSys.err = 'graphics chip: ' + errText(e); landmarker = await handSys.make('CPU'); handSys.on = 'CPU'; }
      handSys.fails = 0;
    }
    // Looking for the hand in part of the picture. Through the widest camera a hand at arm's length is only about a
    // tenth of the picture's width, and the hand finder, which first shrinks the picture to a small square, cannot make
    // out a hand that small. So it is given a part of the picture half as wide and half as tall, in which the hand looks
    // twice the size. That part follows the hand. While no hand is found, the part steps round the picture (the middle
    // first, then below, the sides and above, then the whole picture for a hand held close), three looks at each place.
    const ROI_GRID = VRE.subdivide(1).map((c) => [c.cx, c.cy]); // the places to look, from one rule (see VRE.subdivide)
    const roi = { s: 0.5, cx: 0.5, cy: 0.5, sUsed: 1, lUsed: 0, tUsed: 0, lost: 0, k: 0, found: 0, moves: 0, cv: document.createElement('canvas') };
    roi.x = roi.cv.getContext('2d');
    function roiSource() {
      const vw = vid.videoWidth, vh = vid.videoHeight;
      if (roi.s >= 1 || !vw || !vh) { roi.sUsed = 1; roi.lUsed = roi.tUsed = 0; return vid; }
      const s = roi.s, l = Math.max(0, Math.min(1 - s, roi.cx - s / 2)), t = Math.max(0, Math.min(1 - s, roi.cy - s / 2)), w = 640, h = Math.max(2, Math.round((640 * vh) / vw));
      if (roi.cv.width !== w || roi.cv.height !== h) { roi.cv.width = w; roi.cv.height = h; }
      roi.x.drawImage(vid, l * vw, t * vh, s * vw, s * vh, 0, 0, w, h);
      roi.sUsed = s; roi.lUsed = l; roi.tUsed = t;
      return roi.cv;
    }
    // after a look: put the hand's points back into whole-picture terms, and decide where to look next
    function roiAfter(lm) {
      if (lm) {
        let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
        for (const q of lm) { if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y; }
        const s = roi.sUsed, l = roi.lUsed, t = roi.tUsed, size = Math.max(x1 - x0, y1 - y0);
        for (const q of lm) { q.x = l + q.x * s; q.y = t + q.y * s; }
        const mx = l + ((x0 + x1) / 2) * s, my = t + ((y0 + y1) / 2) * s;
        roi.lost = 0; roi.found++;
        if (s < 1 && size > 0.7) roi.s = 1;                                                        // held close: the whole picture
        else if (s >= 1 && size < 0.22) { roi.s = 0.5; roi.cx = mx; roi.cy = my; roi.moves++; }    // small: look closer, round the hand
        else if (s < 1 && (x0 < 0.12 || x1 > 0.88 || y0 < 0.12 || y1 > 0.88)) { roi.cx = mx; roi.cy = my; roi.moves++; } // nearing the edge of the part: move the part
      } else if (++roi.lost >= 3) {
        roi.lost = 0; roi.k = (roi.k + 1) % (ROI_GRID.length + 1);
        if (roi.k === ROI_GRID.length) roi.s = 1; else { roi.s = 0.5; roi.cx = ROI_GRID[roi.k][0]; roi.cy = ROI_GRID[roi.k][1]; }
      }
    }
    // the graphics-chip hand finder has failed on twenty pictures running: change to the processor one
    async function handSwap(e) {
      if (handSys.swapping || handSys.on !== 'GPU' || !handSys.make) return;
      handSys.swapping = true;
      handSys.err = 'graphics chip, while running: ' + errText(e);
      try { const next = await handSys.make('CPU'); try { landmarker.close(); } catch (x) {} landmarker = next; handSys.on = 'CPU'; handSys.fails = 0; }
      catch (x) { handSys.err += '; processor: ' + errText(x); }
      handSys.swapping = false;
    }
    return { handSys, errText, loadHands, handSwap, roi, roiSource, roiAfter, get lm() { return landmarker; } };
  };

  // ---------- steady, continuous hand control ----------
  // The hand tells the software what to do; it does not hold the thing it moves. Three pieces, proved in the atlas
  // (v15mk2.66) and copied from it unchanged:
  //   VRE.steady(minCut, beta)   cleans each sighting: the middle of the last three (drops a one-sighting spike), then a
  //                              One Euro filter. f(value, now) gives the cleaned value; .speed how fast it is moving.
  //   VRE.glide(s, to, tau, dt, top)   moves s.x toward `to` every picture, smoothly and never past it; s is { x, v }.
  //                              Use it for a cursor (tau about 0.03 s) and for anything the hand orders about: add the
  //                              hand's movement to a wanted value and glide the real thing there (tau about 0.11 s).
  //   VRE.handGuard(opts)        refuses false input: a sighting that jumps or changes size too much, a pinch seen once.
  VRE.steady = function (minCut, beta) {
    let x = null, dx = 0, t = 0, a1 = 0, a2 = 0, n = 0;
    const al = (c, dt) => { const r = 2 * Math.PI * c * dt; return r / (r + 1); };
    return {
      get speed() { return dx; },
      reset() { x = null; n = 0; },
      f(v, now) {
        const m = n < 2 ? v : Math.max(Math.min(a1, a2), Math.min(Math.max(a1, a2), v)); // the middle of the last three
        a1 = a2; a2 = v; n++;
        if (x === null || now - t > 250) { x = m; dx = 0; t = now; return x; }
        const dt = Math.max(0.001, (now - t) / 1000);
        t = now;
        dx += ((m - x) / dt - dx) * al(1, dt);
        x += (m - x) * al(minCut + beta * Math.abs(dx), dt);
        return x;
      },
    };
  };
  VRE.glide = function (s, to, tau, dt, top) {
    const w = 2 / Math.max(1e-4, tau), k = w * dt, e = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
    let ch = s.x - to;
    if (top) { const lim = top * tau; ch = Math.max(-lim, Math.min(lim, ch)); to = s.x - ch; }
    const tmp = (s.v + w * ch) * dt;
    s.v = (s.v - w * tmp) * e;
    let out = to + (ch + tmp) * e;
    if ((to - s.x > 0) === (out > to)) { out = to; s.v = 0; } // would pass it: stop on it
    return (s.x = out);
  };
  // const guard = VRE.handGuard();  each sighting:
  //   const how = guard.sighting(now, u, v, palmWidth);   'ok' use it · 'doubt' do not use it (the hand is where it was)
  //                                                        · 'again' the hand has really moved or was just found: start afresh
  //   const pinching = guard.pinch(closedNow);            true/false, changed only when seen twice running
  VRE.handGuard = function (opts) {
    const o = Object.assign({ palms: 2.5, floor: 0.12, grow: 1.6, shrink: 0.55, patience: 2, pinchTwice: 2, gap: 200 }, opts || {});
    let lu = 0, lv = 0, ls = 0, lt = -1e9, doubt = 0, pinch = false, pn = 0;
    return {
      refused: 0,
      sighting(now, u, v, size) {
        const ds = now - lt;
        if (!(ds > 0 && ds < o.gap) || !(ls > 0)) { lu = u; lv = v; ls = size; lt = now; doubt = 0; return 'again'; }
        const far = Math.hypot(u - lu, v - lv) > Math.max(o.floor, o.palms * ls) * Math.max(1, ds / 33), odd = size > ls * o.grow || size < ls * o.shrink;
        if (far || odd) {
          if (++doubt <= o.patience) { this.refused++; lt = now; return 'doubt'; }
          lu = u; lv = v; ls = size; lt = now; doubt = 0; return 'again';
        }
        doubt = 0; lu = u; lv = v; ls += (size - ls) * 0.4; lt = now;
        return 'ok';
      },
      pinch(closed) {
        if (closed === pinch) pn = 0;
        else if (++pn >= o.pinchTwice) { pinch = closed; pn = 0; }
        return pinch;
      },
      reset() { lt = -1e9; doubt = 0; pinch = false; pn = 0; },
    };
  };

  // ---------- when to look for the hand ----------
  // Looking for the hand takes several milliseconds of the same time the picture is drawn in, and a picture that
  // arrives late when the head turns is what makes VR hard to bear. So the head comes first. The gate says whether
  // to look now:
  //   - never with a time that is not later than the last one (after a repeated time MediaPipe refuses every later
  //     picture; two views drawn in one frame did exactly this in the atlas);
  //   - never twice for the same camera picture;
  //   - at most `max` times a second (default 60), and at most `slowMax` (default 30) while the view is running slow.
  //   const gate = VRE.lookGate({ max: 60, slowMax: 30 });   if (gate(now, vid.currentTime, viewIsSlow)) detect...
  VRE.lookGate = function (opts) {
    const o = Object.assign({ max: 60, slowMax: 30 }, opts || {});
    let lastNow = -Infinity, lastPic = -1;
    const gate = (now, picTime, slow) => {
      if (!(now > lastNow) || picTime === lastPic) return false;
      if (now - lastNow < 1000 / (slow ? o.slowMax : o.max) - 2) return false; // 2 ms of give, so 60 a second passes at 60
      lastNow = now; lastPic = picTime; gate.looks++;
      return true;
    };
    gate.looks = 0;
    gate.reset = () => { lastNow = -Infinity; lastPic = -1; };
    return gate;
  };

  // ---------- the phone's own store of downloaded files ----------
  // For large data files (a world's maps, a level). The first time a file is asked for it is downloaded and kept in the
  // browser's Cache Storage; after that it is read from there: at once, without the network, and without the page
  // holding it in memory between uses. Each time a stored file is read, the site is asked in the background whether
  // it has changed; a newer file replaces the stored one and is used from the next read. Where the store is not
  // allowed (private browsing, a page opened from a file), it simply downloads as usual.
  //   const files = VRE.fileStore('my-game-v1');   const r = await files.get('data/level1.json');   const d = await r.json();
  //   files.keep(['a.json', 'b.json'])  forgets every stored file not in the list;  files.clear()  forgets them all
  VRE.fileStore = function (name) {
    const can = () => typeof caches !== 'undefined' && /^https?:$/.test(location.protocol);
    const tag = (r) => r.headers.get('etag') || r.headers.get('last-modified');
    const abs = (u) => new URL(u, location.href).href;
    return {
      async get(url) {
        if (!can()) return fetch(url);
        try {
          const store = await caches.open(name), hit = await store.match(url);
          if (hit) {
            fetch(url, { cache: 'no-cache' }).then((r) => { if (r.ok && tag(r) !== tag(hit)) return store.put(url, r); }).catch(() => {});
            return hit;
          }
          const r = await fetch(url);
          if (!r.ok) return r;
          // read whole first, then stored: storing a copy while the page reads the original can stall
          const buf = await r.arrayBuffer(), head = { 'content-type': r.headers.get('content-type') || 'application/octet-stream' };
          ['etag', 'last-modified'].forEach((h) => r.headers.get(h) && (head[h] = r.headers.get(h)));
          store.put(url, new Response(buf, { headers: head })).catch(() => {});
          return new Response(buf, { headers: head });
        } catch (e) { return fetch(url); }
      },
      async has(url) { try { return can() && !!(await (await caches.open(name)).match(url)); } catch (e) { return false; } },
      async keep(urls) { try { if (!can()) return; const want = urls.map(abs), store = await caches.open(name); for (const k of await store.keys()) if (!want.includes(k.url)) await store.delete(k); } catch (e) {} },
      async clear() { try { if (can()) await caches.delete(name); } catch (e) {} },
    };
  };

  // ---------- recording a hand, for tuning ----------
  // Keeps what the hand finder saw during play, so that changes to the tracking can be tried against a real hand and
  // not only a stand-in. For every look at the camera picture it keeps: the time, how old the picture was, where the
  // head pointed when it was taken, and, if a hand was found, its 21 points in the picture and in 3D. It also keeps
  // named moments of the game (a throw, a shot). There is no picture in it. It stays in the page until the player
  // saves or copies it, and is gone on reload. Numbers are whole numbers to keep the file small: times in
  // milliseconds; positions and directions times 10,000.
  //   rec.start(meta)                       begin, with facts about this run (game, version, camera)
  //   rec.frame(t, age, quat, lm, world, x) one look: quat is the head's [x, y, z, w]; lm and world may be null
  //   rec.event(t, name, data)              a named moment
  //   rec.stop()  rec.json()  rec.save(name)  rec.copy()  rec.size()
  VRE.recorder = function () {
    const R = { on: false, t0: 0, meta: null, f: [], e: [], MAX: 6000 }; // 6000 looks is over three minutes
    const i4 = (v) => Math.round(v * 10000);
    const rec = {
      get on() { return R.on; },
      get frames() { return R.f.length; },
      start(meta) { R.on = true; R.t0 = performance.now(); R.meta = Object.assign({ engine: VRE.version, when: new Date().toISOString() }, meta || {}); R.f = []; R.e = []; },
      stop() { R.on = false; },
      frame(t, age, quat, lm, world, extra) {
        if (!R.on || R.f.length >= R.MAX) return;
        const row = [Math.round(t - R.t0), Math.round(age || 0), i4(quat[0]), i4(quat[1]), i4(quat[2]), i4(quat[3]), lm ? 1 : 0];
        if (lm) {
          for (let i = 0; i < 21; i++) row.push(i4(lm[i].x), i4(lm[i].y));
          for (let i = 0; i < 21; i++) { const w = world && world[i]; row.push(w ? i4(w.x) : 0, w ? i4(w.y) : 0, w ? i4(w.z) : 0); }
          row.push(world ? 1 : 0);
        }
        if (extra) for (const v of extra) row.push(Math.round(v * 1000));
        R.f.push(row);
      },
      event(t, name, data) { if (R.on && R.e.length < 2000) R.e.push([Math.round(t - R.t0), name, data == null ? null : data]); },
      size() { return R.f.length ? rec.json().length : 0; },
      json() { return JSON.stringify({ v: 1, what: 'vr-hand-recording', meta: R.meta, f: R.f, e: R.e }); },
      async copy() { await navigator.clipboard.writeText(rec.json()); },
      // hands the recording to the phone as a file: the share sheet where there is one (Save to Files, AirDrop), else a download
      async save(name) {
        const file = new File([rec.json()], name || 'hand-recording.json', { type: 'application/json' });
        try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: file.name }); return 'shared'; } } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
        const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
        return 'downloaded';
      },
    };
    return rec;
  };

  // ---------- sound ----------
  // Every sound is made from tones and filtered noise, so there are no sound files to download. Sounds are placed left
  // or right to match where things are. wake() must be called from a button press, which is when a browser allows sound.
  VRE.sound = function (camera) {
    let ac = null;
    const snd = { on: true, out: null, noise: null, meter: null, n: {} };
    function sndInit() {
      if (snd.out || !ac) return;
      const comp = ac.createDynamicsCompressor();
      snd.out = ac.createGain();
      snd.out.gain.value = 0.7;
      snd.meter = ac.createAnalyser();
      snd.out.connect(comp); comp.connect(snd.meter); snd.meter.connect(ac.destination);
      snd.noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = snd.noise.getChannelData(0);
      for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
    }
    // where a sound sits: -1 hard left to 1 hard right, from the direction of a point in the room
    const panTmp = new THREE.Vector3(), panQ = new THREE.Quaternion();
    const panOf = (pos) => Math.max(-1, Math.min(1, panTmp.copy(pos).applyQuaternion(panQ.copy(camera.quaternion).invert()).normalize().x * 1.6));
    function chain(pan, gain) {
      const g = ac.createGain();
      g.gain.value = gain;
      if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan || 0; g.connect(p); p.connect(snd.out); } else g.connect(snd.out);
      return g;
    }
    function tone(type, f0, f1, dur, gain, pan, delay) {
      const t = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = chain(pan, 1);
      o.type = type;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); o.start(t); o.stop(t + dur + 0.02);
    }
    function hiss(kind, f0, f1, q, dur, gain, pan, delay) {
      const t = ac.currentTime + (delay || 0), src = ac.createBufferSource(), flt = ac.createBiquadFilter(), g = chain(pan, 1);
      src.buffer = snd.noise; src.loop = true;
      flt.type = kind; flt.Q.value = q;
      flt.frequency.setValueAtTime(f0, t); flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(flt); flt.connect(g); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
    }
    return { snd, sndInit, panOf, tone, hiss, wake() { try { ac = ac || (VRE.host && VRE.host.audio) || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch (e) {} } /* inside the home screen its sound is used: it is already awake, where a new one would stay silent until a press */, get ac() { return ac; } };
  };

  window.VRE = VRE;
})();
