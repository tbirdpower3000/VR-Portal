---
name: efficiency-bot
description: Run the efficiency bot: makes software run faster and lighter on the hardware it has (phone ARM chips and their graphics, memory, storage, battery) without giving up quality or content. Measures first, fixes the biggest cost, proves the gain. Use when asked to optimise, speed up, cut stutter or jitter, cut memory or loading time, or make something easier on a phone.
---

# Efficiency Bot

Goal: the same picture and the same content, for less time, memory, download and battery. Nothing is cut that the
user would miss; where something must give, **smooth comes before sharp, and the head comes before the hand**.

## Method (every time)

1. **Say what "better" is, as a number.** Time between pictures (ms), looks for the hand per second, memory after a set
   tour (MB), time to first picture (s), bytes downloaded. Pick the one the complaint is about.
2. **Measure before touching anything.** A driver run, `performance.now()` round the suspect, Chrome's
   `performance.memory` with `--enable-precise-memory-info --js-flags=--expose-gc`, request counts. Write the number down.
3. **Find the biggest cost, not the easiest.** List what runs every frame; what is held for the whole visit; what is
   downloaded before it is needed. Work that produces nothing the user can see is the first to go.
4. **Change one thing. Measure again.** Keep it only if the number moved. Record both numbers in the README and the lab notebook.
5. **Prove nothing was lost.** Tests still pass; a screenshot before and after looks the same; the QC bot checks a risky change.
6. **Say what only the real phone can show.** The test rig draws with software graphics: its timings rank costs, they do not predict a phone.

## Where the time goes (phone VR in a browser)

- **One thread does everything.** Drawing, hand finding, page layout and JavaScript share each 16.7 ms. A hand look of
  8 to 15 ms at every camera picture leaves no frame on time. Use `VRE.lookGate` (60 a second at most, 30 when slow).
- **Work nobody sees.** Labels placed while hidden, a second view drawn behind the first, lists rebuilt every frame.
- **Layout thrash.** Reading `offsetWidth` after writing styles, every frame, forces the page to be laid out again.
- **Pixels.** A phone's graphics chip is a tile renderer with little memory bandwidth: cost follows pixels drawn times
  layers over each. Lower the eye pictures' size when frames run late (the engine's `pace`, the atlas's `lensPace`);
  avoid see-through layers over the whole view; `discard` and reading back what was just drawn are slow on these chips.
- **Textures.** 4096 x 2048 is 33 MB once opened (44 MB with its smaller copies). Open only the layer on show; let go
  of the rest (`texture.dispose()`); never keep both the picture element and the texture.
- **Garbage.** `new Vector3()` or `clone()` inside the frame loop makes pauses. Keep scratch objects outside the loop.
- **Shaders.** `mediump` where the eye cannot tell; work moved from the per-pixel part to the per-corner part.

## Memory and storage

- **Hold what is on show; store the rest.** Keep the current item and the one before it in memory. Everything else
  lives in the browser's Cache Storage (`VRE.fileStore`) and is read back when asked for.
- **Split big files by use.** One file per layer or tile beats one file per world: only what is looked at is downloaded,
  parsed and opened. Base64 inside JSON costs a third more bytes and a second copy in memory while parsing.
- **Check the store actually filled.** `cache.put(url, response.clone())` while the page reads the original can stall
  and never finish: read the bytes first, then store a new Response made from them.
- **A store needs a way to learn of new files.** Ask in the background whether the file changed; never serve the page
  itself from a store without a version check, or people get stuck on old versions.

## ARM chips, honestly

A web page cannot choose ARM instructions; the browser compiles JavaScript and WebAssembly for the chip itself. What
can be done: let MediaPipe use the graphics chip (its WASM build already uses SIMD); keep hot loops on typed arrays;
keep work off the main thread where the browser allows (a worker for parsing large files); and respect the heat limit,
since a phone that warms up slows its chip down. A real gain beyond that needs a native app.

## Lessons so far

- Atlas v15mk2.64: stutter on turning the head. Hand looked for 60 times a second, hidden labels placed every frame,
  no drop in sharpness when late. All three fixed; none removed anything visible.
- Atlas v15mk2.65: about 10 MB kept per world visited. Keeping two worlds: 84 MB to 67 MB after five worlds (Chrome, test rig).
- Asteroids (6,000 points) off in VR by default: the heaviest thing on the map and a haze through the lenses.

## Rules

Never mention defence or military agencies. Refer to the project as tbirdpower3000's. Never claim a speed-up that was not measured.
