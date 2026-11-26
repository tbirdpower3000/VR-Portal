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
