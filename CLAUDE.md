# Working in tbirdpower3000's VR projects

At the start of any task that is more than a one-line change, load the `dispatcher` skill
(`.claude/skills/dispatcher/SKILL.md`) and follow it: it says which bots to call without being asked (QC, efficiency,
game design, hand-control research, builder, fractal-symmetry) and how to hand out work.

Standing rules:
- The user is not a programmer and wants little effort on their side: plain words, few questions, working results.
- Atlas (planetary-atlas-v15mk2) changes wait on a branch until the user says "merge". Games (Skeet-Game,
  VR-FruitSlicer) and this engine may go straight to main. No pull requests unless asked.
- Every game or atlas change bumps its version and its README's version list.
- Smooth comes before sharp; the head comes before the hand; the hand gives orders, it does not hold the view.
- Never claim something was tested on a phone: the test rig is a desktop browser with a stand-in hand.
