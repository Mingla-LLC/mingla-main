# Product Direction — Collab Sessions Live in Group Chats

**Owner:** Seth (product) + orchestrator (process)
**Status:** Active direction, pre-SPEC
**Last updated:** 2026-05-23
**Triggering context:** META-ORCH-0929 [collab decks in group chat + Home solo-only] in-flight; investigation surfaced 3 separate bugs (realtime delivery, deck legibility, Apply coord corruption) that revealed the current collab sheet was built for solo and bolted into collab.

## What this doc is

A north-star for what the chat-native collab experience SHOULD be. Not a SPEC. Not a META-ORCH. A reference future SPECs cite when answering "how" — this doc answers "what" and "why."

Lives upstream of every future ORCH that touches collab session UI. SPECs that contradict the contracts below must either justify the deviation explicitly or open a separate ORCH to amend this doc.

## The shift

**From:** Collab sessions float across the app — pill bar on home page, deck modal in chat, prefs sheet anywhere. The sheet was inherited from solo, with collab-specific fields wedged in. Each participant edits their own settings in isolation; the deck is the only place where the merged result is visible.

**To:** Collab sessions live inside group chats. A session IS the chat — the chat is the conversation space, the deck is the planning artifact, and the prefs sheet is a transparent, real-time-synced shared workspace where every participant sees every other participant's contribution.

## Five contracts

These are the non-negotiable principles every future SPEC for the chat-native collab sheet must satisfy.

### Contract 1 — Every field in the sheet contributes to the deck

If a field is rendered in the prefs sheet, the server-side aggregator (`pg_aggregate_collab_prefs`) must read it AND the deck output must demonstrably change when the field changes. No display-only ghost fields.

**Today's violations (must die in redesign):**
- `custom_location` text field — stored alongside `custom_lat/lng` but disconnected from them. Bug-3 root cause. Either kill the text field entirely (geocode-on-pick-only) or enforce a runtime invariant that text matches coords.
- `location` (legacy field) — pure display, not aggregated.
- `travel_constraint_type` — always "time", never anything else. Stored as dead metadata.

**Verification gate:** every field in the sheet has a citation to the aggregator function line that reads it AND a test that proves the deck output changes when only that field changes.

### Contract 2 — Every participant's contribution is visible to every participant

The sheet shows every accepted participant's avatar + their current picks, not just yours. You see Priya picked brunch + walking 30min + DC. You see Marcus picked movies + driving 60min + DC. You see your own picks alongside theirs.

This makes the deck's output legible — when a card surfaces, you can tell WHY ("matched Priya's brunch + your romantic intent + everyone's DC reach"). It also surfaces alignment and friction inside the conversation, where the group can negotiate verbally and re-pick.

**UX implication:** the sheet has a "Your picks" section and a "Group" section showing other participants. Tapping another participant's chip opens a read-only view of their picks. No edit affordance for others' picks.

### Contract 3 — Per-participant vs session-wide is explicit

Today these are tangled. Categories are UNION'd across participants, but each person edits their own list, and the sheet doesn't visualize the union. The redesign separates them with clear UI affordances:

**Per-participant (each user has their own, all union'd at aggregator):**
- Categories, intents
- Travel mode, travel constraint value
- Custom location (lat/lng, the only authoritative location field)

**Session-wide (one value per session, decided by the group):**
- Date window
- Datetime preference
- Selected dates

Session-wide fields show "3 of 4 picked This Weekend" with a way to converge — either explicit voting, or "tap to switch your pick" with realtime sync.

### Contract 4 — Realtime is first-class, no Apply button

Every field is live-bound to realtime. When Marcus toggles "brunch" off, every other participant's sheet updates within a second. No Apply button — debounced auto-save with optimistic UI and a small "Marcus is editing…" presence indicator borrowed from the chat typing pattern.

This kills bug 3 as a side effect — there's no "Apply commits a mismatched payload" path because every change is atomic per-field with its own optimistic write.

**Technical contract:** every field tap → debounced 500ms → upsert_participant_prefs RPC with ONLY that field → realtime broadcasts to all participants → optimistic UI rolls back on RPC error.

### Contract 5 — Server-side deck logic is untouched

The backend authority stays. Don't touch:

- ORCH-0902 [deterministic deck rewrite] — hash-based aggregation, deck_version, deck_params_hash
- ORCH-0909 [positional shared deck] — everyone sees the same card at the same position
- ORCH-0906 [curated intent interleave] — single-intent curated mixing
- V_n contract — finish current version before transitioning to V_{n+1}
- Bouncer chain rules — `_shared/bouncerChainRules.ts`
- RLS policies + realtime publication

The redesign is purely the client-side workspace. The aggregator remains the canonical authority for what the deck shows.

## Settled — date aggregation is hybrid (operator decision 2026-05-23)

**Date preferences combine across participants by INTERSECTION-first, with a converge-and-discuss banner when intersection is empty.**

| Mode | Behavior |
|---|---|
| Intersection non-empty | Deck shows ONLY date windows every participant picked. Cards are guaranteed to be attendable by everyone. |
| Intersection empty | Deck enters a "no shared availability" empty state. UI banner names each participant's pick ("Marcus picked Today, you picked This Weekend") with a tap-to-converge affordance (re-pick your window OR post a question into the chat). |

**Why hybrid (not pure UNION or pure INTERSECTION):**

- Pure UNION (today's behavior) surfaces cards nobody can actually attend together — dishonest.
- Pure INTERSECTION dies silently when no one notices the windows don't overlap — opaque.
- Hybrid is honest about misalignment AND gives the chat conversation a natural unblock moment ("oh we can't all do today, what about Saturday?").

**Implementation notes for the eventual SPEC:**

- The aggregator currently UNIONs `date_windows` and `selected_dates` (see `supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql` and `20260701000000_orch_0909_positional_shared_deck.sql`). Switching to INTERSECTION is a server-side aggregator change — violates Contract 5's "untouched backend" boundary. Therefore: the SPEC that ships the chat-native sheet must include a scoped, surgical aggregator amendment AND a new `intersection_dates_empty` flag returned alongside the existing `intersection_empty` (geographic) flag.
- Client-side: the new empty state ("no shared availability") consumes the new flag and renders the converge-and-discuss banner. Distinct from the existing geographic "you are too far apart" state.
- Datetime preference (single time-of-day) currently aggregates as MIN across participants — keep that as-is; it's a different question from date-window overlap.

## Scope boundaries

### IN scope for the eventual chat-native sheet META-ORCH

- New `CollabPrefsSheet` component, chat-modal-mounted, distinct from solo `PreferencesSheet`
- Per-field debounced auto-save replacing Apply button
- Other-participant visibility (read-only chips)
- Hybrid date aggregation (or whatever product call lands above)
- Realtime field-level sync via existing `upsert_participant_prefs` + realtime channel
- Dead ghost-field removal (custom_location text, legacy location, travel_constraint_type)

### OUT of scope (separate work)

- Backend changes (per META-ORCH-0929 hard guards and Contract 5)
- Solo `PreferencesSheet` — stays as-is, used only in home solo deck
- Deck rendering, swiping, dismissed-sheet, save-card logic — unchanged
- Group chat shell, member management, invites — separate surface
- Bug 1 (realtime delivery), Bug 2 (legibility), Bug 3 (Apply coord corruption) — must close BEFORE this work starts

## Sequencing (mandatory order)

1. **META-ORCH-0929 [collab decks in chat + Home solo-only]** — lands first, removes home-page deck mount, ships ORCH-0926 [realtime scoped rebind] fold.
2. **Bug 1 verdict (post-tester pass on META-ORCH-0929)** — confirm realtime delivery works (Outcome A) or chase further (B/C).
3. **Bug 2 [chat-embedded deck legibility]** — ~10-line style fix, ship next.
4. **Bug 3 [collab Apply coord corruption]** — forensics on `PreferencesSheet.tsx` save path. Real data-loss bug; root cause needed before the sheet is redesigned.
5. **Chat-native sheet META-ORCH** — only after the three blockers close. Otherwise the redesign hides the bugs instead of fixing them.

Skipping or reordering this sequence is forbidden by default.

## Risks worth naming

**1. Per-participant visibility is a social shift.** Showing other people's picks live changes the dynamic. Could introduce peer pressure, debate fatigue, or accidental embarrassment ("Marcus saw I picked First Dates and didn't pick anything"). UX design needs to think about discoverability, edit affordances, and what gets posted into the chat conversation vs what stays in the sheet.

**2. Auto-save replacing Apply may surprise users.** Today there's a clear "I committed my changes" moment. Removing the Apply button removes that confirmation. Mitigation: subtle haptic + transient confirmation toast per field commit.

**3. Realtime field-level sync amplifies the current realtime bug if not fixed first.** If bug 1 isn't truly closed, the per-field debounce + realtime sync flow will be more broken than the current less-chatty Apply path. Bug 1 has to be PROVEN dead before this work starts.

**4. Backend invariants drift over time.** Contract 5 says don't touch the backend. But if a future change to the aggregator or RPC inadvertently breaks a field's contribution, the deck silently degrades. Mitigation: the per-field "this is read by the aggregator at line X" citation in Contract 1 becomes part of CI — a strict-grep gate that fails when a field is added to the sheet without an aggregator citation.

## Document ownership

- This direction doc is amendable by the operator at any time. Any amendment opens a META-ORCH if it touches scope or contracts.
- Future SPECs cite this doc. If a SPEC contradicts a contract, the SPEC must justify the deviation explicitly in its own §2 (Context) and update this doc in the same PR.
- The orchestrator owns the sequencing rule and rejects out-of-order work without operator override.

## Cross-references

- META-ORCH-0929 — `Mingla_Artifacts/specs/SPEC_META-ORCH-0929_COLLAB_DECKS_IN_GROUP_CHAT_HOME_SOLO_ONLY.md`
- META-ORCH-0929 investigation — `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0929_COLLAB_DECKS_IN_GROUP_CHAT_HOME_SOLO_ONLY.md`
- ORCH-0902 deterministic deck — `Mingla_Artifacts/INVARIANT_REGISTRY.md` § ORCH-0902
- ORCH-0909 positional shared deck — `supabase/migrations/20260701000000_orch_0909_positional_shared_deck.sql`
- Realtime fix attempt — `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0926_REALTIME_POSTGRES_CHANGES_NOT_DELIVERED.md` + `QA_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md` (note ORCH-ID collision with closed Stripe ORCH-0926; rename pass pending per operator direction)
- Collab determinism contract (live) — Claude memory `feedback_collab_deck_determinism_contract.md`
