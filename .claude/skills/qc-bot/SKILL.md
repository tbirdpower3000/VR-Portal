---
name: qc-bot
description: Run the QC bot: an independent check of a fix or change before it goes live (the atlas, the phone VR games, the shared engine). Finds the real cause, tries to break the fix, and checks a test would catch it coming back. Use when asked for QC, a quality check, a second opinion on a fix, or "have the QC bot look it over".
---

# QC Bot

The QC bot is the second pair of eyes. Its job is to disagree usefully: it is given the fault and the code, not the
author's conclusion, and it reports what it could prove.

## How to run it

1. **Start a fresh reviewer** (a new agent with no view of this conversation). Give it: the fault in the user's own
   words, the repo and branch, how the live version differs from the fix, and where the tests are. Do **not** give it
   your diagnosis as fact; say "an attempted fix exists" and ask for an independent check. It must not edit, commit or push.
2. **Ask for five things:**
   - the path the fault takes through the code, traced on the live version, with line numbers;
   - the root cause, reproduced if at all possible (a scratch page, the real library, a driver run), not only read;
   - a verdict on the fix: fixes / partly / no, and every path where the fault could still happen;
   - whether any test would catch it coming back;
   - what could not be verified (real phone, Safari, timing), stated plainly.
3. **Act on the report yourself.** Fix what it found, then prove the test is real: take the fix out, see the test
   fail; put it back, see it pass. A test that passes either way is not a test.
4. **Tell the user** in plain words: what was really wrong, what changed, how it was checked, what only their phone can confirm.

## What the reviewer checks, every time

- **Cause, not symptom.** A restart, retry or longer wait that hides a fault is a recovery, not a cure. Say which it is.
- **Marked evidence.** Each claim is marked *reproduced*, *read in the code*, or *inferred*.
- **Both directions and both starts.** A → B, B → A, and starting in B.
- **Fast and slow phones.** Faults that depend on timing are tried with the slow-phone shortcuts on and off.
- **Stand-ins that behave like the real thing.** If the stand-in hand finder is more forgiving than MediaPipe, the test is blind there.
- **Shared state.** Two views, loops or hands that touch the same variable in one frame.
- **Silent catches.** Any `catch` that swallows an error and carries on is a place a fault can hide.
- **Version and notes.** The version went up; the README says what changed and why.

## Lessons so far

- Atlas v15mk2.61: hands died going from a world to the Solar System map. Two views drawn during the fade both asked
  the hand finder to look with the same time; MediaPipe refuses everything after a repeated time, and a silent `catch`
  hid it. The first "fix" (restart the camera) was a recovery. The made-up camera hid the fault until its clock was
  made to move between readings.

## Rules

Never mention defence or military agencies. Refer to the project as tbirdpower3000's. The reviewer never edits a repo.
