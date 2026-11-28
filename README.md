# VR Portal

The front door to tbirdpower3000's phone VR games, and the home of the **VR engine** they
share. Everything here is for a phone in a Google Cardboard viewer (the 2015 one), played
in the browser.

- **The portal:** <https://tbirdpower3000.github.io/VR-Portal/> lists the games.
- **The engine:** `v1/vr-engine.js`, one plain script with no build step.
- **A demo:** `examples/demo.html` shows the engine by itself: a room, the split view,
  the lens fitting.

## Why an engine

Skeet VR and Fruit Slicer VR were each one page, and about half of each page was the
same code, copied by hand. A camera fix, the lens fitting and the hand-finder fixes each
had to be made twice. That shared half now lives here once.

## What the engine holds

| Part | What it does |
|---|---|
| `VRE.mirror`, `VRE.subdivide` | The two rules of repetition: the two eyes are one thing mirrored; the picture is split into parts, each half the size of the one above |
| `VRE.store` | Saved settings and rounds, in this browser only |
| `VRE.qr()` | The QR code on a setup page |
| `VRE.screen()` | The drawing surface, with its resolution lowered while frames run slow |
| `VRE.lens()` | Fitting each eye's picture to the Cardboard's lenses, from Google's viewer profile |
| `VRE.textPlane`, `VRE.drawText` | Signs made of text, in the scene |
| `VRE.OneEuro`, `VRE.med3`, `VRE.Motion` | The filters that steady a hand, and the atlas's tracker for a moving one |
| `VRE.camera()`, `VRE.lensChoice()` | The rear camera: the player's choice of lens (Auto, Fisheye, Regular), 60 pictures a second, recovery when it gives no picture |
| `VRE.hands()` | The hand finder: graphics chip first, processor if not; looks at a part of the picture that follows the hand |
| `VRE.steady`, `VRE.glide`, `VRE.handGuard` | Steady, continuous hand control: cleaned sightings, movement that glides and never overshoots, false input refused |
| `VRE.lookGate()` | When to look for the hand: never a repeated time, at most 60 times a second, 30 when the view is slow |
| `VRE.fileStore()` | Large data files kept in the phone's own store after the first download |
| `VRE.recorder()` | Keeps what the hand finder saw during play (points, no picture), for tuning against a real hand |
| `VRE.sound()` | Tones and noise, placed left or right |

Still in each game, not yet shared: head tracking and the rotation-lock handling, the
hand-in-the-room aiming, the thumb trigger, and each game's own rules.

## v2: the spatial home

`v2/vr-engine.js` (2.2.0) adds look-and-pinch, floating windows, a home screen of icons and a see-through mode, at
phone-in-a-Cardboard quality. **Open it: [home.html](https://tbirdpower3000.github.io/VR-Portal/home.html).**
It is v1 (1.5.0) plus the parts below, so everything above is in it. The games stay on v1 until v2 has been tried on a
phone. None of v2 has been tried on a phone yet: its checks run in a desktop browser with a made-up camera and hand.

| Part | What it does | Try it |
|---|---|---|
| `VRE.head()` | Head tracking, the rotation-lock handling and recenter, taken out of Skeet VR by slicing its own text | [v2-head](https://tbirdpower3000.github.io/VR-Portal/examples/v2-head.html) |
| `VRE.pointer()`, `VRE.pinch()`, `VRE.angle()` | A ring where you aim; what it rests on lights up; a pinch picks it (locked when the pinch begins), pinch and turn drags, pinch and hold is "more" or, on empty space, recenter. No hand for 3 s: resting the ring for 1 s picks. The viewer's button picks too | [v2-pointer](https://tbirdpower3000.github.io/VR-Portal/examples/v2-pointer.html): nine discs from 1.5 to 8 degrees, with hits and misses counted per size |
| `VRE.windows()` | Frosted panels 1.5 m away with a bar (move), a dot (close) and a corner (size); buttons and sliders inside; at most four; where each was left is remembered | [v2-windows](https://tbirdpower3000.github.io/VR-Portal/examples/v2-windows.html) |
| `VRE.home()`, `VRE.readApps()` | Round icons from [`apps.json`](apps.json); a game opens as its own page with `?from=home`, a window app opens a window. A wrong entry is left out with a warning | [home](https://tbirdpower3000.github.io/VR-Portal/home.html) |
| `VRE.passthrough()`, `VRE.skyTexture()` | Your room through the rear camera behind everything, with a dial: room, room dimmed, or a sky in its place. The picture is the same video the hand finder reads; it is not opened twice | Surroundings, on the home screen |
| `VRE.sound()` | Sounds can be given a place in the room (HRTF), and stay there as the head turns | window sounds |
| `VRE.shell()` | Sets all of it up and runs it each picture in the right order, so a page is a few lines | every v2 page |

**2.1.0 (28 Nov 2026), from the first try on the phone.** The thin line between the two eyes now turns with the view: with rotation lock on it ran across both eyes, where it was no help in lining the phone up with the lenses. The home screen's round icons became tiles (a sign, a name, a line saying what it is), and a game's tile now opens a card with **Open** and **Not now**; before, picking an icon left for the game's page at once. A web page cannot be drawn inside the 3D view (a browser will not paint one page into another's picture), so opening a game still means going to its page; the game shows a link back.

**2.2.0 (28 Nov 2026): words that can be read.** Text in the viewer was hard to read. Words are now sized by angle like targets: text to be read is 1.75 degrees tall or more (46 pixels on a window), a name or a button's word 1.5 or more. Windows have a darker backing so white words stand clear of the room behind; tiles carry only a sign and a name, in large letters, and the line about an app moved to its card; pictures of words are kept sharp at a slant (anisotropic filtering). `wins.text()` wraps words to a window at the readable size. Skeet VR (v0.22) and Fruit Slicer VR (v0.17), opened from a card, now start in VR at once, with one press of the viewer's button only if the phone wants to be asked about motion again.

**Adding an app** is a line in `apps.json`: `{ "name", "icon", "kind": "page", "url" }` for a game or page, or
`"kind": "window", "app"` for a window the home page provides.

**What v2 cannot do, by the nature of a phone in a browser.** No eye tracking: the middle of your view stands in for
where you look. No sense of where you stand: windows stay put as your head turns but cannot stay behind as you walk.
The room in see-through is one flat picture in both eyes, not 3D, and is shown a little larger than life so that it
fills the view (the Status window says by how much). Sizes are set by angle: nothing to pick is under 3 degrees across.

**Choices made where the brief asked** (say if you want them changed): the home screen starts with Skeet VR, Fruit
Slicer VR, the Planetary Atlas and the hand-control training page; windows use the dark Atlas look; resting the ring
is allowed as a fallback when no hand is seen. Dragging follows your head, not your hand, so the arm never has to move.

## Using it

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://tbirdpower3000.github.io/VR-Portal/v1/vr-engine.js"></script>
```

**Versions are folders.** A game loads one fixed version (`v1`). A change that could alter
how a game behaves goes into a new folder (`v2`), and each game is moved over when it has
been tried, so a mistake here cannot break every game at once. Small, safe fixes may go
into `v1` itself; they are listed below.

## Layout

The repo follows the same six slots at every level: this README (purpose), `docs/` (how
it works, and the lab notebook), `v1/` (the code), `tests/` (checks), `examples/` (live
demo), `cell.json` (what it is, what it uses, and the pattern it declares).

## Checks

```bash
node tests/engine.test.cjs
```

Opens the demo in a headless browser and checks the engine's rules and numbers. GitHub
runs it on every push. It cannot stand in for a phone: the camera, the real hand finder,
the motion sensors and the lenses are not there.

## Versions

- **1.5.0** (27 Nov 2026): Steady, continuous hand control, proved in the atlas and copied unchanged: `VRE.steady` (spike removal plus One Euro), `VRE.glide` (smooth, never-overshooting movement toward a target, for cursors and for anything the hand orders about) and `VRE.handGuard` (refuses a sighting that jumps or changes size too much, and a pinch seen only once). The idea: the hand tells the software what to do; it does not hold what it moves.
- **1.4.0** (27 Nov 2026): Two pieces proved in the atlas. `VRE.lookGate()` says when to look for the hand: never with a repeated time (MediaPipe refuses every picture after one), at most 60 times a second, and 30 while the view is running slow, so hand finding no longer takes the time the picture needs. `VRE.fileStore(name)` keeps large data files in the browser's Cache Storage after the first download, so they reopen at once, offline, and need not be held in memory.
- **1.3.0** (26 Nov 2026): `VRE.recorder()`, which keeps what the hand finder saw during play (the hand's 21 points, where the head pointed, named game moments; no picture) so tracking changes can be tried against a real hand. `tests/hand-report.cjs FILE` prints what a recording says: looks a second, how often the hand was lost, how much a still hand shakes, jumps, and the range of the thumb reading.
- **1.2.0** (26 Nov 2026): `VRE.Motion`, the Planetary Modeling Atlas's tracker for a moving hand, copied from the atlas unchanged: it leads a fast hand by up to 60 ms to cancel the camera's delay, stops leading when the hand brakes, and asks for more smoothing while a nearly still hand jitters.
- **1.1.0** (26 Nov 2026): a choice of camera lens for the player, `VRE.lensChoice()`: Auto, Fisheye (the widest) or Regular, kept for every game. `VRE.camera()` takes it as `lens`; a game that does not pass one behaves as before.
- **1.0.1** (26 Nov 2026): the widest camera is no longer given up for good after one failure to give a picture. It is tried again next time, given four seconds, and only left alone after failing twice running; a success wipes the slate.
- **1.0.0** (26 Nov 2026): first version, taken out of Skeet VR v0.13. Used by Skeet VR from v0.14 and Fruit Slicer VR from v0.13. Adds `VRE.mirror`
  (the two eyes written once) and `VRE.subdivide` (the hand search's parts from one rule).

## Credits and licence

Built with Claude by tbirdpower3000 and contributors. Hand tracking by Google MediaPipe
Tasks (Apache-2.0); 3D by three.js (MIT). Lens figures from Google's Cardboard viewer
profile. Code released under the Apache-2.0 licence (see `LICENSE`).
