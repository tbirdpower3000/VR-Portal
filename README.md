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
| `VRE.OneEuro`, `VRE.med3` | The filters that steady a hand |
| `VRE.camera()` | The rear camera: widest view, 60 pictures a second, recovery when it gives no picture |
| `VRE.hands()` | The hand finder: graphics chip first, processor if not; looks at a part of the picture that follows the hand |
| `VRE.sound()` | Tones and noise, placed left or right |

Still in each game, not yet shared: head tracking and the rotation-lock handling, the
hand-in-the-room aiming, the thumb trigger, and each game's own rules.

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

- **1.0.0** (26 Nov 2026): first version, taken out of Skeet VR v0.13. Adds `VRE.mirror`
  (the two eyes written once) and `VRE.subdivide` (the hand search's parts from one rule).

## Credits and licence

Built with Claude by tbirdpower3000 and contributors. Hand tracking by Google MediaPipe
Tasks (Apache-2.0); 3D by three.js (MIT). Lens figures from Google's Cardboard viewer
profile. Code released under the Apache-2.0 licence (see `LICENSE`).
