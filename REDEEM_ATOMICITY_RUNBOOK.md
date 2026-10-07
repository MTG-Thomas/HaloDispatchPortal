# Redeem Atomicity Runbook — double-book race

Status: MITIGATION IN REVIEW ([PR #8](https://github.com/MTG-Thomas/HaloDispatchPortal/pull/8)).
The same-isolate race is closed; the cross-isolate KV race is explicitly
unresolved. The Durable Object claim below is a proposal, not approved work:
do not provision bindings, run migrations, or deploy it without the decision
in "Smallest decision required".

## What PR #8 does — and does NOT do

Does (same isolate): per-rid single-flight (`withRedeemLock`) serializes
confirms; the loser runs against the settled record and 409s without touching
Halo. Claim-first ordering stamps `claimId`+`claimedAt` before any Halo I/O.

Does (cross isolate): shrinks the race window from seconds (four Halo
round-trips between check and mark) to one KV round-trip; holder-only
finalize makes losers converge to 409 instead of clobbering ids.

Does NOT do: KV has no compare-and-swap, so two confirms on different
isolates within one KV round-trip can still both claim and both write Halo
appointments. Never describe PR #8 as globally atomic or fully solved.

## Reproduced failure (evidence)

`worker/__tests__/redeem-race.test.ts` gates overlapping appointment POSTs
behind a barrier so overlap is deterministic. Pre-fix results:

- Two overlapping single confirms → 2 Halo appointments (expected 1).
- Two overlapping series confirms → 4 Halo appointments (expected 2).

Both tests failed red pre-fix and pass post-fix.

## Durable Object proposal (the full fix)

One `BookingClaim` DO instance per rid (`idFromName(rid)`) as the single
serialization point, with transactional storage holding one of
`pending | booking(holder, exp) | booked(ids) | cancelled | expired`.

- Worker calls `claim()` before any Halo I/O and `finalize(ids)` after.
  The DO admits exactly one holder; losers get a deterministic conflict
  *before* any Halo write, on every isolate.
- Stale holders expire inside the DO (lazy expiry on access; no alarm
  needed): a claim older than the TTL is treated as absent.
- Cancel/extend/expiry-flip route through the DO too, so dispatcher
  actions serialize against in-flight redeems (closes the
  cancel-during-confirm orphan class as well).

Change surface (no record-shape or client changes):

- New `REDEEM_CLAIM` DO binding in `cloudflare.config.ts` + DO class
  (~150 lines) reusing the `kv.ts` transition semantics.
- `entry.ts` swaps `claimBookingForRedeem` / `markBooking*` calls to DO
  stubs; KV remains the record store of truth (reads, lists, audit).
- Tests gain a DO-backed fake for the claim seam; the barrier-based
  overlap tests in `redeem-race.test.ts` become cross-isolate proofs
  (two lock domains, one claim).

Why DO over D1: single-key serialization with no schema or migration;
D1 is heavier than the problem. Why not KV alone: no CAS primitive and
global eventual consistency — proven above by the repro.

Rollout notes: the DO starts empty; existing KV records need no
backfill because the claim is only consulted during an active redeem
(the DO reads current status from KV on first touch per rid, or treats
unknown + KV-pending as claimable — decide during implementation).
Rollback is binding removal + redeploy of the pre-DO Worker.

## Smallest decision required

1. Approve (or reject) provisioning the `BookingClaim` Durable Object
   and the `REDEEM_CLAIM` binding.
2. Merge order: land PR #8 first (ships same-isolate protection now,
   DO stacks on top), or hold #8 and ship one combined change.

## Forbidden without that decision

Adding/provisioning DO or D1 bindings, running migrations, merging or
deploying this work, calling live Halo writers, purging history.
