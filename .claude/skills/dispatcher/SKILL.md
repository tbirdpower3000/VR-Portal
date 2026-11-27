---
name: dispatcher
description: Decide which bots and skills a task needs, call them without being asked, and hand out the work properly. Use at the start of any task in tbirdpower3000's projects that is more than a one-line change (a bug, a feature, a review, "make it better", anything touching VR, hand control, performance, world data or game design), and whenever the user asks which bot should handle something.
---

# Dispatcher

The user should not have to remember which bot does what. Read the request, pick the bots, call them, and report
what each found. Calling the right one unasked is the job; asking "shall I use the QC bot?" is not.

## 1. Sort the request (one line, to yourself)

| The request is about | Call | When |
|---|---|---|
| A bug, or "it's broken / it breaks when..." | **qc-bot** after your fix, before it goes live | Always for a fix the user reported twice, or one you cannot reproduce on a phone |
| Stutter, jitter, lag, memory, loading time, battery, "lighter", "faster" | **efficiency-bot** | Before changing anything: it measures first |
| Hand tracking: accuracy, steadiness, tiring, false inputs, new gestures | **hand-control-research-bot** for ideas; **qc-bot** for the result | Research when the known fixes are used up, not for every tweak |
| A game: fun, clarity, difficulty, practice steps, feedback | **game-design-bot** | Before building a new mechanic, and when the user says something was hard or confusing |
| A new feature, a spec in plain words, tests, tidy code | **builder-dev-bot** | Any feature bigger than a setting |
| Where code should live, shared engine, repeated code, new repo or module | **fractal-symmetry-design-bot** | When the same thing now exists in two places, or a new piece is being added to the engine |
| Maps and planetary data sources, licences | **planetary-maps-bot** | Before adding any data |
| Running or screenshotting a game | **run-skeet-game**, **run-vr-fruitslicer** | Every game change, before pushing |

More than one row usually applies. Typical chains:
- **Bug in VR:** reproduce → fix → qc-bot → tests → ship.
- **"It feels bad":** efficiency-bot (is it frame time?) → hand-control-research-bot or game-design-bot (is it the input or the design?) → fix → qc-bot.
- **New shared piece:** builder-dev-bot (spec, tests) → fractal-symmetry-design-bot (where it lives) → qc-bot.

## 2. Hand out the work properly

- **A bot is a method, not a person.** Loading its skill gives you its checklist; you still do the work. Use a
  separate agent only when independence matters (QC must not see your diagnosis) or the work is truly parallel.
- **Brief like a colleague who was not in the room:** the fault or goal in the user's words, the repo and branch,
  what is already ruled out, what to return, and what not to touch. One agent, one question.
- **Reviewers never edit.** Anything a reviewer finds, you fix and you verify.
- **Never run two agents on the same file.** Split by file or by question.
- **Do not delegate what three commands would answer.** Look yourself.
- **Keep the user's rules in every brief:** atlas changes wait on a branch for the user's "merge"; game and engine
  changes may go straight to main; every game change bumps its version and README; no pull requests unless asked.

## 3. Report

Say which bots were used and one line on what each found, in plain words. If a bot that should exist does not (the
QC bot once did not), say so, do the job the plain way, and offer to create it. If a bot's advice was not followed, say why.

## 4. Keep this list true

When a bot is added, renamed or retired, update the table. Bots that live in this repo (`.claude/skills/`):
game-design-bot, qc-bot, efficiency-bot, dispatcher. Bots on the user's account: builder-dev-bot,
fractal-symmetry-design-bot, hand-control-research-bot, planetary-maps-bot.

## Rules

Never mention defence or military agencies. Refer to the project as tbirdpower3000's.
