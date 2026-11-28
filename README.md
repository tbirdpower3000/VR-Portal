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

## v2, in the making: the "spatial home"

`v2/vr-engine.js` is a new version being built step by step: look and pinch, floating windows, a home screen of app
icons and a see-through mode, at phone-in-a-Cardboard quality. The games stay on v1 until v2 has been tried on a phone.
It starts as a copy of v1 (1.5.0), so everything above is in it.

| Step | What it adds | Try it | State |
|---|---|---|---|
| 1 | `VRE.head()`: head tracking, the rotation-lock handling and recenter, taken out of Skeet VR by slicing its own text | [examples/v2-head.html](https://tbirdpower3000.github.io/VR-Portal/examples/v2-head.html) | built; headless checks pass; not yet tried on a phone |
| 2 | `VRE.pointer()`: reticle, hover, pinch, dwell | | to do |
| 3 | `VRE.window()`: floating windows | | to do |
| 4 | `VRE.home()` and `apps.json` | | to do |
| 5 | `VRE.passthrough()` and 3D sound | | to do |

What v2 cannot do, by the nature of a phone in a browser: no eye tracking (the head's direction stands in for the
eyes), and no tracking of where you are in the room (windows will turn with your head but cannot hold their place as
you walk).

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
