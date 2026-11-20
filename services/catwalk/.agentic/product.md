# Catwalk: product

Named after the surveillance catwalk above a casino floor, from where every hand can be reviewed.

## Problem
Players in regulated markets must be able to see what happened in each round they played: the stake,
the result, the balance afterwards. Today every studio builds its own history screen, in its own
style, with its own idea of what is shown, and operators cannot tell whether what a studio shows
matches what the wallet paid. Complaints ("the game said I won 50, I got 40") take days to settle.

## Users
- **Players**: open "My game history" in the operator's lobby or the History button in any game.
- **Operator support agents** (later slice): look up a round a player complains about.
- **On-call**: quarantined events and wallet mismatches.

## What a player can do (slice 1)
- See every round they played in the last 12 months, newest first, filtered by period.
- See totals for a period: rounds, staked, won, net, biggest win.
- Open a round: the reels as they landed, drawn by the game's own certified renderer, every winning
  line, and a check that the game's rules give the same win for those reel stops.
- See whether the wallet paid exactly that result (confirmed, mismatch, waiting).

## Rules
- A player only ever sees their own rounds at the operator they came from (row-level security).
- Nothing reaches history unless the studio's signature verifies with a key registered at Dealer.
- Recorded rounds and wallet settlements never change; mismatches are visible, not repaired silently.
- No names, emails or documents: only the pseudonymous player id.
- Self-excluded players can still review their history.

## Out of scope (slice 1)
Disputes workflow, support-agent search, exports (PDF/CSV), games other than slots.
