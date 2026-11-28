# How the engine works, and the lab notebook

## The two rules

- **Around (symmetry).** A headset is one eye, mirrored. `VRE.mirror(fn)` calls `fn(-1)` for
  the left and `fn(+1)` for the right. The lens fitting works out one eye and gets the
  other from it: the lens centre sits the same distance the other side of the middle, and
  "towards the nose" and "towards the ear" change places.
- **Down (recursion).** `VRE.subdivide(depth)` splits the camera picture into overlapping
  parts, each half the size of the level above: depth 0 is the whole picture, depth 1 is
  nine half-size parts, depth 2 is forty-nine quarter-size parts. The hand finder looks at
  one part at a time, so a hand that is too small in the whole picture is big enough in a
  part. Depth 1 is in use. The parts come back in the order worth searching: middle, then
  below, then the sides, then above.

## Lens fitting, in short

Figures from Google's viewer profile for the 2015 Cardboard: lenses 63.9 mm apart, 39.3 mm
from the screen, centres 35 mm above the edge the phone rests on, stretch
`1 + k1 r² + k2 r⁴` with k1 = 0.33582564, k2 = 0.55348791. Each eye is drawn flat into an
off-screen picture about its own lens's axis, then put on the screen through the opposite
of the lens's stretch. The picture reaches 45° from the axis; Google's design field is 80°
across.

## Lab notebook

A failed experiment is a result. Newest first.

- **26 Nov 2026. Practice step, first form: too hard.** Three holds per disc (point, thumb up, drop), each needing the ring exactly on the disc; the player found it challenging. Likely cause: dropping the thumb jerks the hand off the disc at the moment it is judged. Now two steps, a wider zone round the disc, and a shot counts if the ring was near the disc at any moment in the last 0.7 s.
- **26 Nov 2026. A tracker jump, then smoothing: found by a stand-in hand.** A 15 degree jump in one camera picture left the crosshair overshooting by 8.7 degrees and unsettled for 0.4 s once the atlas's motion tracker was added. A jump faster than any hand now restarts the filters: 0.3 degrees, settled in one picture.
- **26 Nov 2026. Trigger from the angle between thumb and finger: failed.** Exact with a stand-in hand (90, 60, 45, 20 and 0 degrees all read correctly, even tilted), but the player found the first trigger better on a real hand. Likely cause: from behind, the pointing finger is nearly end-on, so its direction depends on the tracker's depth guess. Skeet v0.16 goes back to the gap between the thumb's tip and the base of the finger. Lesson: a stand-in hand has perfect depth; a measure that leans on depth must be tried on a phone before it replaces one that does not.
- **26 Nov 2026. Fruit Slicer VR moved onto the engine.** Each of its eight shared parts was compared with the code the engine was made from and found identical before the switch; its scenario checks pass unchanged.
- **26 Nov 2026. Engine taken out of Skeet VR.** Done by slicing Skeet's own text into the
  engine, so behaviour could not drift; all of Skeet's scenario checks pass on it
  unchanged.
- **26 Nov 2026. "Easy on the arm" on by default: failed.** With the crosshair where you
  look and the hand only nudging it, the player's report was that the hand "doesn't track".
  Now an option, off unless chosen.
- **26 Nov 2026. Always the widest camera: side effect found.** Through the ultra-wide lens
  a hand at arm's length is about a tenth of the picture's width, too small for the hand
  finder. Fixed by looking at half-size parts of the picture (now `VRE.subdivide`).
- **26 Nov 2026. Hand finder on the graphics chip only: failed on a phone** ("No hand
  tracker"). Now falls back to the processor.
- **23 Nov 2026. Field set where the phone pointed at the button press: failed.** The phone
  is often not yet in the viewer, so the game could be behind the player. Now set as play
  begins.
- **Not yet known:** whether iPhone Safari grants 60 pictures a second; whether the lens
  fitting looks right through a real viewer; how the thumb trigger reads a real thumb.

## 26 Nov 2026: recording a real hand (engine 1.3.0)

Every tracking change so far was tested against a made-up hand and then judged by feel on the phone. `VRE.recorder()` keeps the real thing: per look at the camera, the time, the picture's age, the head's direction and the hand's 21 points (picture and 3D), plus game moments. About 0.4 KB a look, so three minutes is roughly 2.5 MB. Skeet v0.19 has the tick box and Save / Copy buttons; its test driver takes `--record FILE` and `--replay FILE`, and the stand-in hand finder plays a recording back, turning the head with it. Limits of a replay: the clays are thrown afresh, so hits are not comparable, only steadiness, losses and the trigger; and the part-of-the-picture search can only be handed points that fall inside the part it asked for.

## 27 Nov 2026: smooth before sharp, and memory (engine 1.4.0)\n\nThe atlas stuttered in VR when the head turned. Causes found: the hand was looked for at every camera picture (60 a second since the camera was asked for 60), each look several milliseconds of the frame's own time; hidden name labels were still placed every frame; and nothing lowered sharpness when frames ran late. A separate fault, hands dying on a view change, came from two views calling the hand finder with one time stamp. Both lessons are now `VRE.lookGate`. Memory: every world visited stayed in memory whole, about 10 MB each (measured in Chrome: 84 MB after five worlds, 67 MB once only two are kept). Files now live in Cache Storage (`VRE.fileStore`) and are re-read from there. Gotcha: `cache.put(url, response.clone())` while the page reads the original stalled and never finished in headless Chrome; read the bytes first, then store a new Response made from them. Not done yet: splitting a world's file into one file per layer, which is the real fix for loading only what is needed.

## 27 Nov 2026: orders, not direct control (engine 1.5.0)

The atlas's VR jitter that was left after the frame-time fixes came from the hand: each raw sighting went straight to the cursor and, during a grab, straight to the camera. The cure has three layers: clean the sighting (`steady`), glide to it every picture (`glide`), and let gestures add to a wanted value that the view glides toward at a capped speed. Plus a guard against false input. Simulated hand, 30 sightings a second with 0.4% tremble and 5% spikes: still-hand shake down 25 times, speed changes while moving 5 times gentler, about 25 ms more delay (95 ms behind the true hand, 70 of it the camera). Tuning tried: One Euro cut-off 1.0 to 1.1, beta 7 to 40, glide 25 to 45 ms, lead 0 to 50 ms; beta 20 with 30 ms glide and 40 ms lead was the best trade. Skeet and Fruit Slicer still use their own aim smoothing (`OneEuro` + `Motion`); they are aim games where delay costs hits, so they were left alone.

## 28 Nov 2026: v2 step 1, the head moves into the engine

`v2/vr-engine.js` starts as v1 1.5.0 plus `VRE.head()`. The head code was not rewritten: a script cut Skeet VR v0.20's own text for the sensor reading, the rotation-lock quarter turn, the turn of the view, the drag fallback and the view's sizing, and changed only the four places that named Skeet's own things (its `resize`, its `headJump` flag, its `fire('tap')`, its `S` object). Skeet itself is untouched and stays on v1.

Found while testing: desktop Chromium now has `DeviceOrientationEvent.requestPermission` too, and headless it answers "denied". So "is there a question to ask" is no longer an iPhone-only test; the demo treats a refusal the same everywhere (plain message, dragging still works).

Kept from 23 Nov: straight ahead is set as play begins. The demo counts three seconds after Start, then recentres, so the phone is already in the viewer.

Platform facts checked for v2 (28 Nov): no WebXR on iPhone (Safari has it only on visionOS), so the engine keeps its own stereo, lens fitting and head tracking; the motion question must be asked straight from the Start press; `PannerNode` HRTF works on iOS Safari but is not the default.

Unknown until tried on the phone: whether the count of three is long enough to get the phone into the viewer; drift of straight ahead over a few minutes; whether rotation lock still comes out upright through `head.fit`.

Later (not in 2.0.0): eye tracking, room tracking or pinning windows to real surfaces, avatars, a keyboard, 3D photos and video, a WebXR path for Android Chrome.

## 28 Nov 2026: v2 steps 2 to 5, the spatial home (engine 2.0.0)

Built in one go on top of step 1: `VRE.pointer` (ring, hover, pinch, drag, hold, resting the ring), `VRE.windows`, `VRE.home` with `apps.json`, `VRE.passthrough`, placed sound, and `VRE.shell`, which runs them in one order every picture: head, hand, ring, the page's own work, drawing. 49 headless checks. Nothing tried on a phone.

Decisions, and why:
- **Dragging follows the head, not the hand.** Pinch a window's bar and turn your head. The hand only has to stay pinched, wherever it is, so the arm does not move at all. A hand-driven drag was not built.
- **The pick is locked when the pinch begins.** Checked by pinching on one disc, turning to another, and letting go: the first disc gets the pick.
- **A lost hand cancels.** If the hand disappears mid-pinch nothing is picked.
- **Controls before icons before panels.** Found by a failing check: with two windows overlapping, one window's panel took the ring from the other's resize corner. Targets now carry a rank.
- **Icons and windows take turns.** Found the same way: a window opened in front of the icon grid, and picking a button in it picked the icon behind. While a window is open the icons step aside and one Home icon, low down, brings them back.
- **The camera picture covers the view.** At true size (100 degrees across for the widest lens) a sideways picture is only about 68 degrees tall and left black bands above and below. It is enlarged just enough to reach 42 degrees up and down; the Status window shows the factor.
- **The pinch for picking** is thumb tip to index tip over hand size, on at 0.30, off at 0.48, seen twice running: the atlas's figures.
- **A start-up race:** the shell set "on" before "counting", so for a moment a page could see a running shell that was not counting. Order swapped.

Target sizes: the wall in `examples/v2-pointer.html` has discs of 1.5 to 8 degrees and keeps hits, misses and time per size (also saved as `vrV2PointerRuns`). The 3 degree floor is from other people's measurements; this is how to get our own.

Unknown until tried on the phone: whether head-aim with a low pinch is comfortable for the 7 degree icons; whether the pinch reads well with the hand low in the widest camera's picture; frame rate with the camera picture behind everything and the hand finder running; whether 100 degrees is the right figure for the iPhone's widest lens; whether iPhone Safari gives 60 camera pictures a second (the Status window shows what it gave).

## 28 Nov 2026: first try of the home screen on the phone (engine 2.1.0)

A screenshot from the iPhone, rotation lock on, phone on its side. What it showed:
- **It runs.** Camera picture behind, dimmed; the eight icons; both eyes; the view turned a quarter as it should be.
- **The line between the eyes was wrong.** It belonged to the page, not to the turned view, so it ran down the page through both eyes. It is now inside the view and turns with it. A check holds a made-up phone on its side and measures where the line lies. (The same fault was in `examples/v2-head.html`; fixed there too.)
- **Asked for: a better way to open pages, as tiles to interact with.** Icons are now tiles, and a page's tile opens a card (what it is, where it lives, Open / Not now). Not done, because a browser cannot do it: showing a live web page as a surface in the 3D view. The way to have a game run inside the home, with no page change, is to build it as an app on this engine; none is yet.

Still to learn from the phone: whether the room is the right way up through the viewer with rotation lock on (the picture is turned with the view, as Skeet's "see my room" does, but nobody has said yet that it looks right); pinch pick rates by target size (the pointer demo's table); pictures a second with the camera behind everything.
