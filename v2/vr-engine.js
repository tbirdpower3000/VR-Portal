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
//   VRE.head()           which way the head is turned, from the phone's motion sensors (new in v2, taken out of Skeet VR)
//   VRE.angle() VRE.sizeAt()   sizes by angle: how much of the view a thing covers (new in v2)
//   VRE.pinch()          thumb to index, steady against one-off sightings (new in v2)
//   VRE.pointer()        look and pinch: a ring where you aim, hover, pick, drag, hold; resting the ring when no hand is seen (new in v2)
//   VRE.windows()        floating windows that can be moved, sized and closed, and remember where they were left (new in v2)
//   VRE.readApps() VRE.loadApps() VRE.home()   the home screen of icons, from apps.json (new in v2)
//   VRE.passthrough() VRE.skyTexture()   the room through the camera, blended with a scene (new in v2)
//   VRE.shell()          all of the above set up and run in the right order, for a page that is a few lines (new in v2)
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
  const VRE = { version: '2.1.0' };

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

  // ---------- the head ----------
  // Which way the head is turned, from the phone's motion sensors. Taken out of Skeet VR v0.20 by slicing its own text
  // (the sensor reading, the rotation-lock handling, the turn of the view, the drag that stands in on a desktop), so it
  // behaves as it did there. What it does:
  //   - the phone's sensors give its attitude; that is turned into the direction the viewer is looking;
  //   - with the phone's rotation lock on, the page stays upright when the phone goes sideways into the viewer; the
  //     sensors still show which way it was turned, and the whole view is drawn a quarter turn round to match;
  //   - "straight ahead" is wherever you are facing when recenter() is called. Call it as play BEGINS, not when Start is
  //     pressed: at the press the phone is still in the hand, not in the viewer (lab notebook, 23 Nov);
  //   - with no motion sensors (a desktop), dragging the picture looks around.
  // const head = VRE.head({ camera, el: renderer.domElement, onTurn, onTap });
  //   await head.ask()     from the Start button's own press, with nothing waited for before it: an iPhone only asks
  //                        the first time, and only then. Gives 'granted', 'refused' or 'none' (no sensors to ask).
  //   head.apply()         every picture: turns the camera
  //   head.recenter()      the way you face now becomes straight ahead
  //   head.fit(view, renderer)   sizes and turns the view for the phone as it is held; gives { w, h, ready }
  //   head.motion, head.rot, head.jumped (true for the one picture after straight ahead was set again)
  VRE.head = function (o_) {
    const camera = o_.camera, el = o_.el;
    const TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    let rot = 0;
    const devQ = new THREE.Quaternion(), yawQ = new THREE.Quaternion();
    const q1 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2), zee = new THREE.Vector3(0, 0, 1), eul = new THREE.Euler(), q0 = new THREE.Quaternion();
    let haveMotion = false, drag = { yaw: 0, pitch: 0 }, recentre = true, listening = false;
    const fwd = new THREE.Vector3(), upY = new THREE.Vector3(0, 1, 0);
    function onOrient(e) {
      if (e.alpha == null) return;
      haveMotion = true;
      eul.set(e.beta * D, e.alpha * D, -e.gamma * D, 'YXZ');
      devQ.setFromEuler(eul).multiply(q1);
      let o = (screen.orientation && screen.orientation.angle) != null ? screen.orientation.angle : window.orientation || 0;
      if (TOUCH && innerHeight > innerWidth) {
        // the page is upright: is the phone itself on its side? Its right-hand edge points up or down when it is.
        const ry = fwd.set(1, 0, 0).applyQuaternion(devQ).y, nr = ry > 0.6 ? 90 : ry < -0.6 ? -90 : Math.abs(ry) < 0.3 ? 0 : rot;
        if (nr !== rot) { rot = nr; if (o_.onTurn) o_.onTurn(rot); }
        o = rot;
      }
      devQ.multiply(q0.setFromAxisAngle(zee, -o * D));
    }
    function applyHead() {
      api.jumped = false;
      if (haveMotion) {
        if (recentre) {
          fwd.set(0, 0, -1).applyQuaternion(devQ);
          yawQ.setFromAxisAngle(upY, -Math.atan2(-fwd.x, -fwd.z));
          recentre = false; api.jumped = true;
        }
        camera.quaternion.copy(yawQ).multiply(devQ);
      } else if (drag.q) camera.quaternion.fromArray(drag.q).normalize(); // a replayed head, in tests
      else {
        eul.set(drag.pitch, drag.yaw, 0, 'YXZ');
        camera.quaternion.setFromEuler(eul);
      }
      camera.updateMatrixWorld(true);
    }
    let pd = null;
    el.addEventListener('pointerdown', (e) => { pd = [e.clientX, e.clientY, false]; });
    el.addEventListener('pointermove', (e) => {
      if (!pd || haveMotion) return;
      const dx = e.clientX - pd[0], dy = e.clientY - pd[1];
      if (Math.abs(dx) + Math.abs(dy) > 4) pd[2] = true;
      drag.yaw -= dx * 0.004; drag.pitch = Math.max(-1.2, Math.min(1.2, drag.pitch - dy * 0.004));
      pd[0] = e.clientX; pd[1] = e.clientY;
    });
    el.addEventListener('pointerup', () => {
      if (pd && !pd[2] && o_.onTap) o_.onTap(); // the viewer's button is a tap on the screen
      pd = null;
    });
    const api = {
      jumped: false,
      get motion() { return haveMotion; },
      get rot() { return rot; },
      get quaternion() { return camera.quaternion; },
      apply: applyHead,
      recenter() { recentre = true; drag.yaw = 0; drag.pitch = 0; },
      async ask() {
        let answer = 'none';
        // motion: iPhone asks once, and only from a button press
        try {
          if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
            const r = await DeviceOrientationEvent.requestPermission();
            answer = r === 'granted' ? 'granted' : 'refused';
          }
        } catch (e) { answer = 'refused'; }
        if (!listening) { window.addEventListener('deviceorientation', onOrient); listening = true; }
        return answer;
      },
      stop() { window.removeEventListener('deviceorientation', onOrient); listening = false; },
      // the view's size and turn for the phone as it is held now (the page's size, and the quarter turn if rotation lock is on)
      fit(view, renderer) {
        const pw = innerWidth, ph = innerHeight, pageLand = !TOUCH || pw > ph;
        if (pageLand) rot = 0;
        const turned = !pageLand && rot !== 0, w = turned ? ph : pw, h = turned ? pw : ph;
        const st = view.style;
        st.width = w + 'px'; st.height = h + 'px';
        st.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        return { w, h, ready: pageLand || turned, turned, rot };
      },
      test: { look(yawDeg, pitchDeg) { drag.yaw = yawDeg * D; drag.pitch = pitchDeg * D; drag.q = null; }, quat(q) { drag.q = q; } },
    };
    return api;
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
    // Where a sound comes from. `pan` is either a number (-1 hard left to 1 hard right), or a place in the room,
    // { x, y, z }: then the sound is put there in 3D (HRTF, which shapes it as your own ears would; the browser's default
    // is a plain left-right balance, so it is asked for by name) and stays there as your head turns, once listen() is
    // called every picture.
    function chain(pan, gain) {
      const g = ac.createGain();
      g.gain.value = gain;
      if (pan && typeof pan === 'object' && ac.createPanner) {
        const p = ac.createPanner();
        p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1.5; p.rolloffFactor = 0.5;
        if (p.positionX) { p.positionX.value = pan.x; p.positionY.value = pan.y; p.positionZ.value = pan.z; } else p.setPosition(pan.x, pan.y, pan.z);
        g.connect(p); p.connect(snd.out);
        snd.placed = (snd.placed || 0) + 1; snd.model = p.panningModel;
        return g;
      }
      if (typeof pan !== 'number') pan = 0;
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
    // the listener is the head: call every picture so that placed sounds stay where they are as the head turns
    const lf = new THREE.Vector3(), lu = new THREE.Vector3();
    function listen() {
      if (!ac || !ac.listener) return;
      const L = ac.listener;
      lf.set(0, 0, -1).applyQuaternion(camera.quaternion); lu.set(0, 1, 0).applyQuaternion(camera.quaternion);
      if (L.forwardX) { L.forwardX.value = lf.x; L.forwardY.value = lf.y; L.forwardZ.value = lf.z; L.upX.value = lu.x; L.upY.value = lu.y; L.upZ.value = lu.z; }
      else if (L.setOrientation) L.setOrientation(lf.x, lf.y, lf.z, lu.x, lu.y, lu.z);
    }
    return { snd, sndInit, panOf, tone, hiss, listen, wake() { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch (e) {} }, get ac() { return ac; } };
  };

  // =====================================================================================================================
  // v2: the spatial home. Look and pinch, floating windows, a home screen of icons, a see-through mode.
  // What a phone in a browser cannot do, and so what this does not try: it cannot see your eyes, so the middle of
  // your view stands in for where you are looking (a small ring marks it); and it cannot tell where you are standing,
  // only which way you are turned, so things stay put as your head turns but cannot hold their place as you walk.
  // =====================================================================================================================

  // ---------- sizes by angle ----------
  // In a viewer what matters is how much of your view a thing covers, not how many pixels: a target must cover at least
  // 3 degrees to be picked comfortably with the head. A thing w wide at distance d covers 2 atan(w / 2d).
  VRE.angle = (w, d) => (2 * Math.atan(w / (2 * d))) / D;   // degrees covered by a width w seen from d away
  VRE.sizeAt = (deg, d) => 2 * d * Math.tan((deg * D) / 2); // the width that covers deg degrees from d away
  VRE.MIN_TARGET_DEG = 3;

  // ---------- the pinch ----------
  // Thumb tip to index tip, measured against the hand's own size so it reads the same near and far. It closes below
  // `on` and opens above `off` (two levels, so it cannot flutter at one), and a change must be seen twice running, so a
  // single odd sighting neither pinches nor lets go. The hand can be anywhere the camera sees it, low by the waist too.
  VRE.pinch = function (opts) {
    const o = Object.assign({ on: 0.3, off: 0.48, twice: 2 }, opts || {});
    let pinch = false, n = 0, ratio = 1;
    const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
    return {
      get pinching() { return pinch; },
      get ratio() { return ratio; },
      // pts: the hand's 21 points (the 3D ones where there are any), or null when no hand is seen
      feed(pts) {
        if (!pts) { pinch = false; n = 0; return false; }
        ratio = d3(pts[4], pts[8]) / Math.max(1e-6, d3(pts[0], pts[9]));
        const says = pinch ? !(ratio > o.off) : ratio < o.on;
        if (says === pinch) n = 0;
        else if (++n >= o.twice) { pinch = says; n = 0; }
        return pinch;
      },
      reset() { pinch = false; n = 0; },
    };
  };

  // ---------- look and pinch ----------
  // The head aims, the hand acts. A ring in the middle of the view shows where you are aiming; whatever it rests on
  // lights up (hover), and a pinch picks it. The hand need not point at anything.
  //   - A target is a flat patch on an object: half-width hw and half-height hh in the object's own units, or round.
  //   - The target is LOCKED when the pinch begins: the pick goes to what was lit at that moment, wherever the head has
  //     drifted to by the time the fingers open (pinching nudges the head; the training page showed what that costs).
  //   - Pinch and let go: pick. Pinch and turn the head: drag (for targets that can be moved). Pinch and hold still:
  //     "more" for the target, or, on empty space for a second, straight ahead is set again.
  //   - No hand seen for three seconds: resting the ring on a target for a second picks it instead (the ring fills).
  //     A thing that can only be dragged is picked up that way and put down by holding the head still.
  //   - press() is the viewer's button or a tap on the screen: it picks what is lit.
  // const pointer = VRE.pointer({ camera, sound, onRecenter, onPick });
  //   const t = pointer.add({ object, hw, hh, round, on: { hover(bool), select(hit), hold(), dragStart(), drag(d), dragEnd() } })
  //   pointer.update(now, { pinch, seen })   every picture, after the head has been applied
  VRE.pointer = function (o) {
    const camera = o.camera;
    const HOLD_MS = 800, EMPTY_HOLD_MS = 1000, DRAG_DEG = 2.5, NO_HAND_MS = 3000, DWELL_MS = 1000, STICK = 1.15;
    const P = {
      targets: [], hover: null, hit: null, lock: null, lockHit: null, down: false, drag: false, held: false, t0: 0,
      mode: 'pinch', lastSeen: -1e9, dwellOn: null, dwellT: 0, spent: null, cool: 0, carry: null, fill: 0, seen: false,
      picks: 0, misses: 0,
    };
    const fwd = new THREE.Vector3(), f0 = new THREE.Vector3(), org = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), inv = new THREE.Matrix4();
    const yawOf = (v) => Math.atan2(v.x, -v.z), pitchOf = (v) => Math.asin(Math.max(-1, Math.min(1, v.y)));
    let yaw0 = 0, pitch0 = 0, stillSince = 0, stillRef = new THREE.Vector3();

    // the ring: one thing in the scene, seen by both eyes (the mirror rule does the rest). It sits at the distance of
    // whatever it rests on, so the two eyes agree about where it is.
    const ring = new THREE.Group();
    const mat = (c, op) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, depthTest: false, depthWrite: false });
    const outer = new THREE.Mesh(new THREE.RingGeometry(0.0075, 0.0105, 40), mat(0xe9eef5, 0.9));
    const fillM = new THREE.Mesh(new THREE.CircleGeometry(0.0075, 32), mat(0xffd88a, 0.95));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0016, 12), mat(0xe9eef5, 0.9));
    [outer, fillM, dot].forEach((m) => { m.renderOrder = 60; ring.add(m); });
    fillM.scale.setScalar(0.001);
    camera.add(ring);
    const REST = 1.5;
    ring.position.set(0, 0, -REST); ring.scale.setScalar(REST);

    const shown = (obj) => { for (let x = obj; x; x = x.parent) if (!x.visible) return false; return true; };
    function cast() {
      camera.getWorldPosition(org);
      camera.getWorldDirection(fwd);
      let best = null, bs = Infinity, bx = 0, by = 0, bp = -1;
      for (const t of P.targets) {
        if (t.off || !shown(t.object)) continue;
        inv.copy(t.object.matrixWorld).invert();
        a.copy(org).applyMatrix4(inv); b.copy(org).add(fwd).applyMatrix4(inv).sub(a);
        if (Math.abs(b.z) < 1e-9) continue;
        const s = -a.z / b.z;
        if (!(s > 0)) continue;
        const x = a.x + b.x * s, y = a.y + b.y * s, k = t === P.hover ? STICK : 1; // what is lit keeps the ring a little past its edge
        if (!(t.round ? Math.hypot(x, y) <= t.hw * k : Math.abs(x) <= t.hw * k && Math.abs(y) <= t.hh * k)) continue;
        // where two things lie one over the other, a control (a window's bar, dot or corner) comes before an icon, and an
        // icon before a window's panel; among equals, the nearer one, with what is already lit holding on a little
        const pri = t.pri || 0;
        if (pri > bp || (pri === bp && s < bs + (t === P.hover ? 0.02 : 0))) { best = t; bs = s; bx = x; by = y; bp = pri; }
      }
      return best ? { t: best, s: bs, x: bx, y: by } : null;
    }
    const tick = (f) => { if (o.sound && o.sound.snd.on && o.sound.ac) o.sound.tone('sine', f, f * 0.98, 0.05, 0.12, 0); };
    function setHover(h) {
      const t = h ? h.t : null;
      if (t !== P.hover) {
        if (P.hover && P.hover.on.hover) P.hover.on.hover(false);
        P.hover = t;
        if (t && t.on.hover) t.on.hover(true);
        if (t) tick(880);
        P.dwellOn = null; P.spent = null;
      }
      P.hit = h ? { x: h.x, y: h.y, s: h.s } : null;
      if (t && t.on.move) t.on.move(P.hit);
    }
    function pick(t, hit) {
      if (t) { P.picks++; tick(1320); if (t.on.select) t.on.select(hit || P.hit); } else P.misses++;
      if (o.onPick) o.onPick(t, hit);
    }
    const dragInfo = () => ({ dyaw: ((yawOf(fwd) - yaw0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI, dpitch: pitchOf(fwd) - pitch0, yaw: yawOf(fwd), pitch: pitchOf(fwd) });
    function begin() { f0.copy(fwd); yaw0 = yawOf(fwd); pitch0 = pitchOf(fwd); }

    const api = {
      state: P, ring,
      add(t) { t.on = t.on || {}; if (t.hh == null) t.hh = t.hw; P.targets.push(t); return t; },
      remove(t) { const i = P.targets.indexOf(t); if (i >= 0) P.targets.splice(i, 1); if (P.hover === t) setHover(null); if (P.lock === t) { P.lock = null; P.down = false; } if (P.carry === t) P.carry = null; },
      // how many degrees of the view a target covers (its smaller side), from where the camera is
      degOf(t) { t.object.getWorldPosition(a); camera.getWorldPosition(b); const s = new THREE.Vector3().setFromMatrixScale(t.object.matrixWorld).x; return VRE.angle(2 * Math.min(t.hw, t.hh) * s, a.distanceTo(b)); },
      press() { cast(); pick(P.hover, P.hit); },
      update(now, inp) {
        const pinch = !!(inp && inp.pinch), seen = !!(inp && inp.seen);
        if (seen) P.lastSeen = now;
        P.seen = seen;
        P.mode = o.allowDwell !== false && now - P.lastSeen > NO_HAND_MS ? 'dwell' : 'pinch';
        const h = cast();
        if (!P.down && !P.carry) setHover(h);
        else P.hit = h && h.t === (P.lock || P.carry) ? { x: h.x, y: h.y, s: h.s } : P.hit;
        P.fill = 0;
        if (pinch && !P.down) { // the pinch begins: what is lit now is what it is for
          P.down = true; P.lock = P.hover; P.lockHit = P.hit; P.drag = false; P.held = false; P.t0 = now; begin();
          if (P.carry) { if (P.carry.on.dragEnd) P.carry.on.dragEnd(); P.carry = null; }
        } else if (pinch && P.down) {
          const moved = fwd.angleTo(f0) / D, L = P.lock;
          if (!P.drag && L && L.on.drag && moved > DRAG_DEG) { P.drag = true; if (L.on.dragStart) L.on.dragStart(); }
          if (P.drag) L.on.drag(dragInfo());
          else if (!P.held && moved < DRAG_DEG) {
            const need = L ? HOLD_MS : EMPTY_HOLD_MS;
            P.fill = Math.min(1, (now - P.t0) / need);
            if (now - P.t0 >= need) { P.held = true; if (L) { if (L.on.hold) L.on.hold(); } else if (o.onRecenter) o.onRecenter(); }
          }
        } else if (!pinch && P.down) { // the fingers open (or the hand was lost, and then nothing is picked)
          P.down = false;
          if (P.drag) { if (P.lock.on.dragEnd) P.lock.on.dragEnd(); }
          else if (!P.held && seen) pick(P.lock, P.lockHit);
          P.lock = null; P.drag = false;
        } else if (P.mode === 'dwell') {
          if (P.carry) { // being carried by the head: put down when the head has been still for a second
            P.carry.on.drag(dragInfo());
            if (fwd.angleTo(stillRef) / D > 1.2) { stillRef.copy(fwd); stillSince = now; }
            P.fill = Math.min(1, (now - stillSince) / DWELL_MS);
            if (now - stillSince >= DWELL_MS) { if (P.carry.on.dragEnd) P.carry.on.dragEnd(); P.carry = null; P.cool = now + 1200; }
          } else if (P.hover && P.hover.dwell !== false && P.hover !== P.spent && now > P.cool) {
            if (P.dwellOn !== P.hover) { P.dwellOn = P.hover; P.dwellT = now; }
            P.fill = Math.min(1, (now - P.dwellT) / DWELL_MS);
            if (now - P.dwellT >= DWELL_MS) {
              const t = P.hover;
              P.spent = t; P.dwellOn = null; P.cool = now + 600; // the ring must leave and come back before it picks the same thing again
              if (t.on.drag && !t.on.select) { P.carry = t; begin(); stillRef.copy(fwd); stillSince = now; if (t.on.dragStart) t.on.dragStart(); }
              else pick(t, P.hit);
            }
          } else P.dwellOn = null;
        }
        // the ring: on the thing it rests on, gold while that thing is lit, filling as a hold or a rest runs
        const d = P.hit && (P.hover || P.lock || P.carry) ? Math.max(0.3, P.hit.s * 0.985) : REST;
        ring.position.z = -d; ring.scale.setScalar(d);
        const lit = !!(P.hover || P.lock || P.carry);
        outer.material.color.setHex(lit ? 0xffd88a : P.mode === 'dwell' ? 0x9fb0c6 : seen ? 0x7fc8ff : 0xe9eef5);
        outer.scale.setScalar(P.down ? 0.8 : 1);
        fillM.scale.setScalar(Math.max(0.001, P.fill));
      },
    };
    return api;
  };

  // ---------- floating windows ----------
  // A window is a flat panel of frosted glass about a metre and a half away, drawn from a canvas. Under it is a bar:
  // pinch the bar and turn your head, and the window goes with you, keeping its distance and turning to face you.
  // Beside the bar, a dot closes it and a corner makes it larger or smaller. Windows stay where they are put while your
  // head turns; they are never fixed to your head. (They cannot stay behind as you walk: the phone cannot tell.)
  // At most four are open; opening a fifth closes the one used longest ago. Where each was left is remembered.
  // const wins = VRE.windows({ scene, camera, pointer, sound, key: 'myLayout' });
  //   const w = wins.open({ id, title, w, h, draw(ctx, W, H, win), spots: [{ id, x, y, w, h, label, select(win), slide(frac, win) }] })
  //   w.redraw()  w.close()   wins.list   wins.layout()
  VRE.windows = function (o) {
    const R = o.R || 1.5, MAX = o.max || 4, key = o.key || 'vrWindows', scene = o.scene, camera = o.camera, pointer = o.pointer;
    const list = [], saved = store.get(key, {});
    const INK = '#e9eef5', GOLD = '#ffd88a', FONT = '"Instrument Sans", system-ui, sans-serif';
    const fwd = new THREE.Vector3();
    const rr = (x, a, b, w, h, r) => { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); };
    const save = () => { const out = {}; Object.keys(saved).forEach((k) => (out[k] = saved[k])); list.forEach((w) => (out[w.id] = { yaw: +(w.yaw / D).toFixed(1), pitch: +(w.pitch / D).toFixed(1), s: +w.s.toFixed(2), open: true })); Object.assign(saved, out); store.set(key, saved); };
    const glyph = (size, drawFn) => { // a small flat sign (the bar, the dot, the corner), drawn once
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d'); drawFn(x);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, depthWrite: false, opacity: 0.75 }));
      m.renderOrder = 31;
      return m;
    };
    function place(w) { // on a ball round you, R away, facing you
      w.g.position.set(Math.sin(w.yaw) * Math.cos(w.pitch) * R, Math.sin(w.pitch) * R, -Math.cos(w.yaw) * Math.cos(w.pitch) * R);
      w.g.lookAt(0, 0, 0);
      w.g.scale.setScalar(w.s);
      w.g.updateMatrixWorld(true);
    }
    function paint(w) {
      const { c, x } = w, W = c.width, H = c.height;
      x.clearRect(0, 0, W, H);
      rr(x, 3, 3, W - 6, H - 6, 34);
      const g = x.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(34,50,80,0.80)'); g.addColorStop(1, 'rgba(10,17,32,0.80)');
      x.fillStyle = g; x.fill();
      x.lineWidth = 3; x.strokeStyle = 'rgba(233,238,245,0.30)'; x.stroke();
      x.fillStyle = INK; x.font = '600 40px ' + FONT; x.textAlign = 'left'; x.textBaseline = 'middle';
      x.fillText(w.title, 34, 44);
      x.fillStyle = 'rgba(233,238,245,0.16)'; x.fillRect(28, 76, W - 56, 2);
      x.save(); x.translate(0, 84);
      if (w.spec.draw) w.spec.draw(x, W, H - 84, w);
      (w.spec.spots || []).forEach((sp) => { // the parts of the window that can be picked
        const hot = w.hot === sp;
        rr(x, sp.x, sp.y, sp.w, sp.h, Math.min(22, sp.h / 2));
        x.fillStyle = hot ? 'rgba(255,216,138,0.28)' : 'rgba(233,238,245,0.10)'; x.fill();
        x.lineWidth = hot ? 4 : 2; x.strokeStyle = hot ? GOLD : 'rgba(233,238,245,0.35)'; x.stroke();
        if (sp.slide) { // a slider: a track with a knob at its value
          const v = Math.max(0, Math.min(1, sp.value ? sp.value(w) : 0));
          x.fillStyle = 'rgba(127,200,255,0.55)'; rr(x, sp.x + 6, sp.y + sp.h / 2 - 5, (sp.w - 12) * v, 10, 5); x.fill();
          x.fillStyle = INK; x.beginPath(); x.arc(sp.x + 6 + (sp.w - 12) * v, sp.y + sp.h / 2, Math.min(18, sp.h / 2 - 4), 0, 7); x.fill();
        }
        if (sp.label) { x.fillStyle = INK; x.font = '500 34px ' + FONT; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(typeof sp.label === 'function' ? sp.label(w) : sp.label, sp.x + sp.w / 2, sp.y + sp.h / 2 + (sp.slide ? -sp.h / 2 - 26 : 1)); }
      });
      x.restore();
      w.tex.needsUpdate = true;
    }
    function spotAt(w, hit) { // the part of the window under the ring, from where the ring is on the panel
      if (!hit) return null;
      const px = (hit.x / w.w + 0.5) * w.c.width, py = (0.5 - hit.y / w.h) * w.c.height - 84;
      return (w.spec.spots || []).find((sp) => px >= sp.x && px <= sp.x + sp.w && py >= sp.y && py <= sp.y + sp.h) || null;
    }
    const frac = (w, sp, hit) => Math.max(0, Math.min(1, ((hit.x / w.w + 0.5) * w.c.width - sp.x - 6) / (sp.w - 12)));
    function close(w, quiet) {
      const i = list.indexOf(w);
      if (i < 0) return;
      list.splice(i, 1);
      w.targets.forEach((t) => pointer.remove(t));
      scene.remove(w.g);
      w.tex.dispose();
      saved[w.id] = Object.assign(saved[w.id] || {}, { yaw: +(w.yaw / D).toFixed(1), pitch: +(w.pitch / D).toFixed(1), s: +w.s.toFixed(2), open: false });
      store.set(key, saved);
      if (!quiet && w.spec.onClose) w.spec.onClose(w);
    }
    const api = {
      list, R, MAX,
      layout: () => store.get(key, {}),
      get: (id) => list.find((w) => w.id === id) || null,
      closeAll() { list.slice().forEach((w) => close(w, true)); },
      open(spec) {
        let w = api.get(spec.id);
        if (w) { w.used = performance.now(); return w; }
        if (list.length >= MAX) close(list.slice().sort((p, q) => p.used - q.used)[0]); // the one used longest ago makes room
        const ww = spec.w || 0.9, hh = spec.h || 0.6, PX = 1000;
        const c = document.createElement('canvas'); c.width = Math.round(ww * PX); c.height = Math.round(hh * PX);
        const tex = new THREE.CanvasTexture(c);
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(ww, hh), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
        panel.renderOrder = 30;
        const g = new THREE.Group();
        g.add(panel);
        w = { id: spec.id, title: spec.title || '', spec, w: ww, h: hh, c, x: c.getContext('2d'), tex, g, panel, targets: [], hot: null, used: performance.now(), yaw: 0, pitch: -8 * D, s: 1,
          redraw() { paint(w); }, close() { close(w); } };
        // where it opens: where it was left, or straight ahead of where you are looking now and a little below eye level
        const was = saved[spec.id];
        if (was && typeof was.yaw === 'number') { w.yaw = was.yaw * D; w.pitch = (was.pitch || 0) * D; w.s = Math.max(0.6, Math.min(1.8, was.s || 1)); }
        else {
          camera.getWorldDirection(fwd);
          w.yaw = Math.atan2(fwd.x, -fwd.z);
          const near = (y) => list.some((q) => Math.abs(((q.yaw - y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 24 * D);
          for (let k = 1; near(w.yaw) && k <= 6; k++) w.yaw += (k % 2 ? 1 : -1) * k * 38 * D; // not on top of another window
        }
        // the bar, the dot that closes, the corner that sizes
        const lit = (m) => (on) => { m.material.opacity = on ? 1 : 0.75; m.scale.setScalar(on ? 1.15 : 1); };
        const bar = glyph([0.34, 0.085], (x) => { x.fillStyle = INK; rr(x, 4, 52, 120, 24, 12); x.fill(); });
        bar.position.set(0, -hh / 2 - 0.075, 0);
        const dotM = glyph([0.07, 0.07], (x) => { x.fillStyle = INK; x.beginPath(); x.arc(64, 64, 40, 0, 7); x.fill(); x.strokeStyle = '#070b14'; x.lineWidth = 10; x.beginPath(); x.moveTo(46, 46); x.lineTo(82, 82); x.moveTo(82, 46); x.lineTo(46, 82); x.stroke(); });
        dotM.position.set(-0.27, -hh / 2 - 0.075, 0);
        const corner = glyph([0.09, 0.09], (x) => { x.strokeStyle = INK; x.lineWidth = 16; x.lineCap = 'round'; x.beginPath(); x.arc(40, 40, 62, 0.15, Math.PI / 2 - 0.15); x.stroke(); });
        corner.position.set(ww / 2 + 0.01, -hh / 2 - 0.01, 0);
        g.add(bar, dotM, corner);
        let y0 = 0, p0 = 0, s0 = 1;
        // the patches that can be picked are larger than what is drawn, so each covers 3 degrees or more
        w.targets.push(pointer.add({ object: bar, hw: 0.17, hh: 0.045, kind: 'bar', pri: 2, win: w, on: {
          hover: lit(bar), dragStart() { y0 = w.yaw; p0 = w.pitch; w.used = performance.now(); },
          drag(d) { w.yaw = y0 + d.dyaw; w.pitch = Math.max(-50 * D, Math.min(50 * D, p0 + d.dpitch)); place(w); }, dragEnd: save } }));
        w.targets.push(pointer.add({ object: dotM, hw: 0.045, round: true, kind: 'close', pri: 2, win: w, on: { hover: lit(dotM), select() { close(w); } } }));
        w.targets.push(pointer.add({ object: corner, hw: 0.05, hh: 0.05, kind: 'size', pri: 2, win: w, on: {
          hover: lit(corner), dragStart() { s0 = w.s; }, drag(d) { w.s = Math.max(0.6, Math.min(1.8, s0 * Math.exp((d.dyaw - d.dpitch) * 1.6))); place(w); }, dragEnd: save } }));
        w.targets.push(pointer.add({ object: panel, hw: ww / 2, hh: hh / 2, kind: 'panel', win: w, dwell: true, on: {
          hover(on) { if (!on && w.hot) { w.hot = null; paint(w); } },
          move(hit) { const sp = spotAt(w, hit); if (sp !== w.hot) { w.hot = sp; paint(w); } },
          select(hit) { const sp = spotAt(w, hit); w.used = performance.now(); if (!sp) return; if (sp.slide) sp.slide(frac(w, sp, hit), w); else if (sp.select) sp.select(w); paint(w); },
        } }));
        list.push(w);
        scene.add(g);
        place(w);
        paint(w);
        save();
        if (o.sound && o.sound.snd.on && o.sound.ac) o.sound.tone('sine', 520, 780, 0.12, 0.14, { x: w.g.position.x, y: w.g.position.y, z: w.g.position.z });
        return w;
      },
    };
    return api;
  };

  // ---------- the list of apps ----------
  // apps.json is a list of { name, icon, kind, url or app, color }: kind "page" opens a web page (a game), kind "window"
  // opens a window that the page itself provides, named by `app`. An entry that is not right is left out with a warning,
  // and the rest still load: adding an app never needs a change to the code.
  VRE.readApps = function (json) {
    const apps = [], skipped = [];
    (Array.isArray(json) ? json : json && Array.isArray(json.apps) ? json.apps : []).forEach((e, i) => {
      const why = !e || typeof e !== 'object' ? 'not an entry'
        : typeof e.name !== 'string' || !e.name.trim() ? 'no name'
        : e.kind !== 'page' && e.kind !== 'window' ? 'kind must be "page" or "window"'
        : e.kind === 'page' && (typeof e.url !== 'string' || !/^(https:\/\/|\.{0,2}\/|[\w-]+[\w./-]*(\?|#|$))/.test(e.url) || /^\s*javascript:/i.test(e.url)) ? 'a page needs a url (https, or a path on this site)'
        : e.kind === 'window' && (typeof e.app !== 'string' || !e.app) ? 'a window needs an app name'
        : '';
      if (why) { skipped.push({ index: i, name: e && e.name, why }); try { console.warn('apps.json: entry ' + i + ' left out (' + why + ')'); } catch (x) {} return; }
      apps.push({ about: typeof e.about === 'string' ? e.about.trim().slice(0, 90) : '', name: e.name.trim().slice(0, 24), icon: typeof e.icon === 'string' && e.icon ? [...e.icon].slice(0, 2).join('') : e.name.trim()[0].toUpperCase(), kind: e.kind, url: e.url, app: e.app, color: /^#[0-9a-f]{6}$/i.test(e.color || '') ? e.color : '#35507a' });
    });
    return { apps, skipped };
  };
  VRE.loadApps = async function (url) {
    try { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return VRE.readApps(await r.json()); }
    catch (e) { try { console.warn('apps.json could not be read: ' + (e && e.message)); } catch (x) {} return { apps: [], skipped: [], failed: true }; }
  };
  // the address a game is opened at from the home screen: it is told where it was opened from, so it can offer the way back
  VRE.fromHome = (url) => url + (url.includes('?') ? '&' : '?') + 'from=home';

  // ---------- the home screen ----------
  // Round icons on a gentle curve a metre and a half away, a little below eye level. Each covers about 7 degrees, with
  // 11 degrees from one to the next, so the ring cannot rest on two at once. Look at one and pinch: a game opens as its
  // own page; a window app opens a window.
  // const home = VRE.home({ scene, pointer, apps, onPage(url, app), onWindow(app) });   home.show(true / false)
  // With shape: 'tile' each app is a card in place of a round icon: its sign, its name and a line saying what it is,
  // 11 degrees wide and 7.5 tall, so there is something to read before choosing.
  VRE.home = function (o) {
    const TILE = o.shape === 'tile';
    const R = o.R || 1.5, PER_ROW = o.perRow || 4, STEP = (TILE ? 12.6 : 11) * D, ROW = (TILE ? 9.4 : 11.5) * D, TOP = (o.pitch != null ? o.pitch : -1) * D, ICON = VRE.sizeAt(7, R) / 2;
    const TW = VRE.sizeAt(11, R), TH = VRE.sizeAt(7.5, R);
    const card = (app) => {
      const c = document.createElement('canvas'); c.width = 440; c.height = 300;
      const x = c.getContext('2d'), rr = (a, b, w, h, r) => { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); };
      const g = x.createLinearGradient(0, 0, 0, 300);
      g.addColorStop(0, 'rgba(40,58,92,0.86)'); g.addColorStop(1, 'rgba(10,17,32,0.86)');
      rr(4, 4, 432, 292, 30); x.fillStyle = g; x.fill(); x.lineWidth = 4; x.strokeStyle = 'rgba(233,238,245,0.32)'; x.stroke();
      x.fillStyle = app.color; x.beginPath(); x.arc(78, 84, 56, 0, 7); x.fill();
      x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = (/[\u0000-\u00ff]/.test(app.icon[0]) ? '700 62px ' : '62px ') + 'system-ui, sans-serif'; x.fillText(app.icon, 78, 88);
      x.textAlign = 'left'; x.fillStyle = '#e9eef5'; x.font = '600 38px "Instrument Sans", system-ui, sans-serif';
      const words = app.name.split(' '); let l1 = '', l2 = '';
      words.forEach((wd) => { if (!l2 && x.measureText(l1 + ' ' + wd).width < 268) l1 = (l1 + ' ' + wd).trim(); else l2 = (l2 + ' ' + wd).trim(); });
      x.fillText(l1, 152, l2 ? 62 : 84); if (l2) x.fillText(l2, 152, 106);
      // what it is, on up to three short lines
      x.fillStyle = '#b8c6da'; x.font = '400 27px "Instrument Sans", system-ui, sans-serif';
      const ab = (app.about || (app.kind === 'page' ? 'Opens as its own page' : 'Opens a window')).split(' '); let line = '', y = 176;
      ab.forEach((wd) => { if (x.measureText(line + ' ' + wd).width > 392 && line) { if (y < 250) x.fillText(line, 26, y); y += 34; line = wd; } else line = (line + ' ' + wd).trim(); });
      if (y < 250 + 34) x.fillText(line, 26, y);
      return new THREE.CanvasTexture(c);
    };
    const g = new THREE.Group(), icons = [];
    o.scene.add(g);
    const disc = (app) => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const x = c.getContext('2d'), gr = x.createRadialGradient(96, 80, 20, 128, 128, 128);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.12, app.color); gr.addColorStop(1, '#0b1424');
      x.fillStyle = gr; x.beginPath(); x.arc(128, 128, 120, 0, 7); x.fill();
      x.lineWidth = 6; x.strokeStyle = 'rgba(233,238,245,0.55)'; x.stroke();
      x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = (/[\u0000-ÿ]/.test(app.icon[0]) ? '700 120px ' : '120px ') + 'system-ui, sans-serif';
      x.fillText(app.icon, 128, 136);
      return new THREE.CanvasTexture(c);
    };
    const rows = Math.ceil(o.apps.length / PER_ROW);
    o.apps.forEach((app, i) => {
      const r = Math.floor(i / PER_ROW), inRow = Math.min(PER_ROW, o.apps.length - r * PER_ROW), k = i - r * PER_ROW;
      const yaw = (k - (inRow - 1) / 2) * STEP, pitch = TOP - r * ROW + ((rows - 1) * ROW) / 2;
      const m = new THREE.Mesh(TILE ? new THREE.PlaneGeometry(TW, TH) : new THREE.CircleGeometry(ICON, 48), new THREE.MeshBasicMaterial({ map: TILE ? card(app) : disc(app), transparent: true, depthTest: false, depthWrite: false }));
      m.renderOrder = 25;
      const holder = new THREE.Group();
      holder.position.set(Math.sin(yaw) * Math.cos(pitch) * R, Math.sin(pitch) * R, -Math.cos(yaw) * Math.cos(pitch) * R);
      holder.lookAt(0, 0, 0);
      const label = VRE.textPlane(ICON * 3.2, ICON * 0.62, 384, 74);
      label.position.set(0, -ICON * 1.42, 0);
      VRE.drawText(label, [app.name], { bg: false });
      label.visible = !TILE; // a tile carries its own name
      holder.add(m, label);
      g.add(holder);
      const t = o.pointer.add({ object: m, hw: TILE ? TW / 2 : ICON * 1.08, hh: TILE ? TH / 2 : ICON * 1.08, round: !TILE, kind: 'icon', pri: 1, app, on: {
        hover(on) { m.scale.setScalar(on ? (TILE ? 1.08 : 1.16) : 1); m.material.color.setScalar(on || !TILE ? 1 : 0.82); label.material.opacity = on ? 1 : 0.8; },
        select() { if (app.kind === 'page') { if (o.onPage) o.onPage(VRE.fromHome(app.url), app); else location.assign(VRE.fromHome(app.url)); } else if (o.onWindow) o.onWindow(app); },
      } });
      label.material.opacity = 0.8;
      if (TILE) m.material.color.setScalar(0.82);
      icons.push({ app, mesh: m, holder, target: t, yaw, pitch });
    });
    return { group: g, icons, R, show(on) { g.visible = on; }, get shown() { return g.visible; } };
  };

  // ---------- a sky to stand in, drawn here ----------
  // One picture of a whole surrounding (twice as wide as tall, the way a world map wraps a globe): dusk above, a soft
  // glow along the horizon, stars, and dark ground. Made by this code, so there is nothing to download.
  VRE.skyTexture = function () {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#04070f'); g.addColorStop(0.38, '#0b1730'); g.addColorStop(0.5, '#2a3f6b'); g.addColorStop(0.505, '#0a1322'); g.addColorStop(1, '#05080f');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
    let s = 11; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 520; i++) { const y = Math.acos(rnd()) / Math.PI * 512 * 0.98, b = 0.35 + rnd() * 0.65; x.fillStyle = `rgba(${220 + (rnd() * 35) | 0},${225 + (rnd() * 30) | 0},255,${b})`; x.fillRect(rnd() * 1024, y, rnd() < 0.12 ? 2 : 1, rnd() < 0.12 ? 2 : 1); }
    x.strokeStyle = 'rgba(127,200,255,0.10)'; x.lineWidth = 1;
    for (let k = 1; k <= 6; k++) { const y = 256 + 256 * (1 - 1 / (1 + k * 0.5)) * 0.9; x.beginPath(); x.moveTo(0, y); x.lineTo(1024, y); x.stroke(); }
    const t = new THREE.CanvasTexture(c);
    return t;
  };

  // ---------- see-through ----------
  // The rear camera's picture behind everything, the same flat picture in both eyes: it shows the room, it does not
  // give it depth. One dial blends three things: the camera as it is (0), the camera dimmed so windows stand out (0.5),
  // and a whole surrounding scene in place of the room (1).
  // The picture is the very video that the hand finder already reads, sent to the graphics chip once a picture; it is
  // never opened or decoded a second time. It is laid out by angle (the camera's view across, in degrees), so a thing
  // straight ahead in the room is straight ahead in the viewer. The widest camera sees more than the eye does through
  // the lenses, so only the middle of its picture ends up in view.
  // const pass = VRE.passthrough({ camera, scene, vid, across: 100 });   pass.set(0..1)   pass.update()  each picture
  VRE.passthrough = function (o) {
    const FAR = 90, camera = o.camera;
    const tex = new THREE.VideoTexture(o.vid);
    tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, depthTest: false, depthWrite: false }));
    plane.renderOrder = -20; plane.position.z = -FAR; plane.frustumCulled = false;
    camera.add(plane);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 24), new THREE.MeshBasicMaterial({ map: o.sky || VRE.skyTexture(), side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false }));
    sky.renderOrder = -10; sky.frustumCulled = false; sky.scale.x = -1; // seen from inside, so flipped to read the right way round
    o.scene.add(sky);
    const P = { value: 0, across: o.across || 100, w: 0, h: 0, turn: 0, live: false };
    const api = {
      plane, sky, state: P,
      get value() { return P.value; },
      // 0 the room as the camera sees it, 0.5 the room dimmed, 1 the scene in its place
      set(v) {
        P.value = v = Math.max(0, Math.min(1, v));
        const b = v <= 0.5 ? 1 - v * 1.3 : 0.35 * (1 - (v - 0.5) * 2);
        plane.material.color.setScalar(Math.max(0, b));
        sky.material.opacity = v <= 0.5 ? 0 : (v - 0.5) * 2;
        sky.visible = v > 0.5;
        plane.visible = P.live && v < 1;
        if (!P.live) { sky.visible = true; sky.material.opacity = 1; } // no camera: the scene is all there is
      },
      // the camera's view across, in degrees (the widest lens is about 100, the ordinary one about 68), and whether the
      // picture is turned a quarter with the phone (rotation lock)
      update(turnDeg) {
        const vw = o.vid.videoWidth, vh = o.vid.videoHeight, live = !!(vw && vh && o.vid.readyState >= 2);
        if (live !== P.live) { P.live = live; api.set(P.value); }
        if (!live || (vw === P.w && vh === P.h && (turnDeg || 0) === P.turn)) return;
        P.w = vw; P.h = vh; P.turn = turnDeg || 0;
        // True size first: the picture as wide as the camera's own view. But the eye sees about 42 degrees up and down
        // through the lens, more than a sideways camera picture is tall, and bands of black above and below spoil it
        // more than a little enlargement does. So it is enlarged just enough to cover the view (P.zoom says by how much;
        // 1 is true size). Turned a quarter with the phone, width and height swap roles.
        const trueW = 2 * FAR * Math.tan((P.across * D) / 2), cover = 2 * FAR * Math.tan(42 * D), turned = Math.abs(P.turn) === 90;
        const tall = (trueW * vh) / vw, need = Math.max(cover / (turned ? trueW : tall), cover / (turned ? tall : trueW), 1);
        P.zoom = need;
        plane.scale.set(trueW * need, tall * need, 1);
        plane.rotation.z = P.turn * D;
      },
      dispose() { camera.remove(plane); o.scene.remove(sky); tex.dispose(); },
    };
    api.set(o.value != null ? o.value : 0);
    return api;
  };

  // ---------- the shell: everything a spatial page needs, in one call ----------
  // Makes the drawing surface, the two eyes and the lens fitting, the head, the sound, the ring and (if asked) the
  // camera and the hand finder, and runs them every picture in the right order: the head first, then the hand, then the
  // ring, then the page's own work, then the drawing. A page built on it is a few lines: what is in the room.
  // const sh = VRE.shell({ hands: true, onFrame(now, dt, sh), onStart(sh), onExit(sh) });
  //   sh.start()   from the Start button's own press (the phone only asks about motion then)
  //   sh.scene, sh.camera, sh.head, sh.pointer, sh.sound, sh.vid, sh.hand { seen, pinch }, sh.info, sh.say(text)
  VRE.shell = function (o) {
    o = o || {};
    const $ = (id) => document.getElementById(id);
    const TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0, Q = new URLSearchParams(location.search);
    const STEREO = Q.has('stereo') ? Q.get('stereo') !== '0' : TOUCH;
    const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
    if (!$('vreStyle')) {
      const st = document.createElement('style'); st.id = 'vreStyle';
      st.textContent = '#vreVr{position:fixed;inset:0;background:#000;overflow:hidden;z-index:50}#vreView{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}#vreView canvas{display:block;width:100%;height:100%}' +
        '#vreMid{position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;background:rgba(255,255,255,.35);pointer-events:none;z-index:1}#vreBtns{position:absolute;left:50%;bottom:6px;transform:translateX(-50%);display:flex;gap:8px;z-index:3}' +
        '#vreBtns button{font:500 15px system-ui,sans-serif;color:#e9eef5;background:rgba(233,238,245,.14);border:0;border-radius:10px;padding:8px 14px}' +
        '#vreTurn{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;background:rgba(7,11,20,.92);color:#e9eef5;font:1.1rem system-ui,sans-serif;z-index:2}#vreVr [hidden]{display:none!important}#vreVid{position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none}';
      document.head.appendChild(st);
    }
    const root = document.createElement('div'); root.id = 'vreVr'; root.hidden = true;
    root.innerHTML = '<div id="vreView"><div id="vreMid"></div></div><div id="vreTurn" hidden>📱↻ Turn the phone sideways and put it in the viewer.</div><div id="vreBtns"><button id="vreRecenter">Recenter</button><button id="vreExit">Exit</button></div><video id="vreVid" playsinline muted></video>';
    (o.mount || document.body).appendChild(root);
    // the lens fitting reads its switch and size from the page; a page without them gets them, hidden, set from what was saved
    ['lensOn', 'lensSize', 'lensSizeO'].forEach((id) => { if (!$(id)) { const e = document.createElement(id === 'lensSizeO' ? 'output' : 'input'); e.id = id; if (id === 'lensOn') { e.type = 'checkbox'; e.checked = true; } if (id === 'lensSize') { e.type = 'range'; e.min = 80; e.max = 125; e.value = 100; } e.hidden = true; root.appendChild(e); } });

    const S = { on: false, ready: true, w: 1, h: 1, counting: false, count: 0, hands: false, why: '', stream: null };
    const { renderer, perf, pace } = VRE.screen(() => S.on);
    renderer.autoClear = false;
    // The line between the two eyes is part of the view, not of the page: with the phone's rotation lock on the view is
    // drawn a quarter turn round, and the line has to turn with it to stay between the lenses (it did not, at first:
    // it ran across both eyes, seen on the phone on 28 Nov).
    $('vreView').appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(78, 1, 0.05, 300);
    scene.add(camera);
    const stereo = new THREE.StereoCamera();
    stereo.eyeSep = 0.064;
    const { lens, lensRender } = VRE.lens({ renderer, scene, camera, stereo });
    const sound = VRE.sound(camera);
    const vid = $('vreVid'), info = {};
    const hand = { seen: false, pinch: false, looks: 0, found: 0, t: 0 };
    const pinch = VRE.pinch(), gate = VRE.lookGate({ max: 30, slowMax: 20 }), guard = VRE.handGuard();
    let hands = null, cam = null, wake = null, last = 0;
    const head = VRE.head({ camera, el: renderer.domElement, onTurn: layout, onTap: () => { if (S.on) pointer.press(); } });
    const pointer = VRE.pointer({ camera, sound, allowDwell: o.dwell !== false, onRecenter: () => { head.recenter(); note('Straight ahead set', 1200); }, onPick: (t, hit) => o.onPick && o.onPick(t, hit, sh) });
    // a line of words in front of you for a moment (the count before straight ahead is set, "straight ahead set")
    const noteM = VRE.textPlane(1.1, 0.26, 880, 208);
    noteM.position.set(0, -0.32, -1.45); noteM.renderOrder = 70; noteM.visible = false;
    camera.add(noteM);
    let noteUntil = 0;
    function note(text, ms) { VRE.drawText(noteM, Array.isArray(text) ? text : [text]); noteM.visible = true; noteUntil = performance.now() + (ms || 1500); }
    function layout() {
      const f = head.fit($('vreView'), renderer);
      S.w = f.w; S.h = f.h; S.ready = f.ready; S.turned = f.turned; S.rot = f.rot;
      $('vreTurn').hidden = !(S.on && !S.ready);
      $('vreMid').hidden = !STEREO || !S.ready;
    }
    addEventListener('resize', () => S.on && layout());
    // one look for the hand: at most 30 a second, never with a repeated time, fewer when the view runs slow
    function lookForHand(now) {
      if (!hands || !hands.lm || vid.readyState < 2 || !gate(now, vid.currentTime, perf.ft > 22)) return;
      let res = null;
      try { res = hands.lm.detectForVideo(hands.roiSource(), now); hands.handSys.fails = 0; }
      catch (e) { if (++hands.handSys.fails >= 20) hands.handSwap(e); return; }
      hand.looks++;
      const lm = res && res.landmarks && res.landmarks[0];
      hands.roiAfter(lm);
      if (!lm) { hand.seen = false; hand.pinch = pinch.feed(null); return; }
      const how = guard.sighting(now, lm[8].x, lm[8].y, Math.hypot(lm[5].x - lm[17].x, lm[5].y - lm[17].y));
      if (how === 'doubt') return; // a sighting that jumped: not believed, the hand is where it was
      hand.found++; hand.seen = true; hand.t = now;
      hand.pinch = pinch.feed((res.worldLandmarks && res.worldLandmarks[0]) || lm);
    }
    function frame(now) {
      if (!S.on) return;
      requestAnimationFrame(frame);
      const gap = now - last; last = now;
      pace(now, gap);
      if (S.counting && now >= S.count) { S.counting = false; head.recenter(); noteM.visible = false; if (o.onReady) o.onReady(sh); }
      head.apply();
      if (S.hands) { lookForHand(now); if (hand.seen && now - hand.t > 500) { hand.seen = false; hand.pinch = pinch.feed(null); } }
      if (S.counting) VRE.drawText(noteM, ['Put the phone in the viewer', 'Starting in ' + Math.max(1, Math.ceil((S.count - now) / 1000))]);
      else { pointer.update(now, { pinch: hand.pinch, seen: hand.seen }); if (noteM.visible && now > noteUntil) noteM.visible = false; }
      if (sound.listen) sound.listen();
      if (o.onFrame) o.onFrame(now, Math.min(0.1, gap / 1000), sh);
      const w = S.w, h = S.h;
      renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h); renderer.clear();
      if (!STEREO) renderer.render(scene, camera);
      else if (lens.on) lensRender(w, h);
      else {
        stereo.aspect = 0.5; stereo.update(camera); renderer.setScissorTest(true);
        renderer.setScissor(0, 0, w / 2, h); renderer.setViewport(0, 0, w / 2, h); renderer.render(scene, stereo.cameraL);
        renderer.setScissor(w / 2, 0, w / 2, h); renderer.setViewport(w / 2, 0, w / 2, h); renderer.render(scene, stereo.cameraR);
      }
    }
    const say = (t) => { if (o.status) o.status.textContent = t || ''; };
    const sh = {
      renderer, scene, camera, stereo, lens, head, sound, pointer, vid, hand, info, perf, pace, S, STEREO, TOUCH, note, say, root,
      get hands() { return hands; },
      // Start. The sound is woken and the motion question asked at once, from the press itself; the camera comes after.
      async start() {
        if (S.on) return;
        sound.wake(); sound.sndInit();
        const answer = await head.ask();
        S.motion = answer;
        say(answer === 'refused' ? 'Motion was not allowed, so the view cannot follow your head. You can drag the picture to look around. To be asked again, reload the page.' : '');
        S.hands = false; S.why = '';
        const yes = (v) => (typeof v === 'function' ? !!v() : !!v), wantHands = yes(o.hands), wantCam = yes(o.camera); // asked at Start, so a tick box on the page counts
        if (wantHands || wantCam) {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) S.why = 'This browser gives no camera here';
          else {
            cam = cam || VRE.camera({ vid, plainKey: o.plainKey || 'vrHomePlainCam', info, lens: o.camLens || (() => 'auto') });
            try { S.stream = await cam.startCamera(); } catch (e) { S.why = 'The camera was not allowed or did not open'; }
          }
          if (S.stream && wantHands) {
            hands = hands || VRE.hands({ vid, MP });
            try { if (!hands.lm) await hands.loadHands(); S.hands = true; } catch (e) { S.why = 'The hand finder could not be loaded'; }
          }
          if (S.why && answer !== 'refused') say(S.why + '. Rest the ring on a thing for a second to pick it, or press the viewer\'s button.');
        }
        root.hidden = false;
        // straight ahead is set as the count ends, with the phone already in the viewer, not when Start was pressed
        S.counting = true; S.count = performance.now() + (o.countMs != null ? o.countMs : 3000) + 400;
        S.on = true;
        layout();
        try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch (e) {}
        noteM.visible = true; head.recenter(); pinch.reset(); guard.reset(); gate.reset();
        if (o.onStart) o.onStart(sh);
        last = performance.now();
        requestAnimationFrame(frame);
      },
      stop() {
        if (!S.on) return;
        S.on = false;
        head.stop();
        root.hidden = true;
        if (S.stream) { S.stream.getTracks().forEach((t) => t.stop()); S.stream = null; vid.srcObject = null; }
        try { if (wake) wake.release(); } catch (e) {}
        wake = null;
        if (o.onExit) o.onExit(sh);
      },
    };
    $('vreRecenter').onclick = () => head.recenter();
    $('vreExit').onclick = () => sh.stop();
    return sh;
  };

  window.VRE = VRE;
})();
