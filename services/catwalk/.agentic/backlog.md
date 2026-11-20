# Catwalk: backlog

## Slice 1 (done)
A player plays Ember Anvil at Kestrel, opens History, sees the round with its wallet check, opens it,
and the game's replay renderer draws it and confirms the win from the reel stops.
Acceptance: signed rounds only; player B gets 404 on player A's round; tampered events quarantined;
both event orders give the same wallet check; keyset pagination is exact; RLS fails closed.

## Next
1. Support-agent view (staff OIDC, audited reads, operator-scoped RLS policy).
2. Mismatch alert: page on-call when a round stays `mismatch` or `pending` > 5 minutes.
3. Per-jurisdiction retention: archive partitions to cold storage before `drop_partitions_before`.
4. Table games: a generic outcome renderer contract (`replayEntrypoint` already generic).
5. Export a period as a signed PDF statement.
