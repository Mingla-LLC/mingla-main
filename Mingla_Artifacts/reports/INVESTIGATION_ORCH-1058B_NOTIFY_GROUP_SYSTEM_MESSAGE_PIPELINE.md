# INVESTIGATION — ORCH-1058B [Collab "Notify the group" message renders as a user bubble, no chips, raw `[[open-prefs]]` token]

**Mode:** INVESTIGATE (no fixes — pipeline map + proven root cause only)
**Date:** 2026-06-02
**Skill:** mingla-forensics (Claude)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1058-[collab-deck-empty-intersection-replay]/` on branch `ORCH-1058-collab-deck-empty-intersection-replay`
**Predecessors:** `INVESTIGATION_ORCH-1058_COLLAB_DECK_EMPTY_INTERSECTION_REPLAY.md` (GPS-flap root cause), `IMPLEMENTATION_ORCH-1058_COLLAB_LOCATION_CHIPS.md` (the deck-chips + copy + allowlist patch under scrutiny here).
**Conversation under runtime examination:** `3ecffa59-017e-4c7b-8bd7-80927bf4d2b6` (collab group chat).

---

## TL;DR (layman)

The "Notify the group" chat message that says "you're in different cities, pick one spot" came out looking like a normal text message from a person, with the raw computer code `[[open-prefs:location:…]]` showing instead of a tappable "Open location picks" button. The prior fix (an allowlist patch) is actually *correct* — but it only lives on the un-merged ORCH-1058 work branch. The reason Seth still saw the broken version is a **cross-build mismatch**: Seth was watching the chat on his real phone, which runs the **shipped (main) app**, while the other tester ("Ava") ran the **new dev build on Metro:8087**. The new build posted the *new* copy string ("You're in different cities — …"), but Seth's shipped app only knows how to recognize the *old* copy string ("No location overlap yet…"). A chat message only renders as a special system banner (centered, no avatar, tokens turned into buttons) when its exact text matches a hard-coded allowlist of phrases. Seth's app didn't recognize the new phrase, so it fell back to "treat it as a plain user message" — which prints the raw `[[…]]` token. The DB proves it: Seth's own device posted the OLD phrase at 01:57, Ava's device posted the NEW phrase at 01:55 and 15:22, in the same conversation.

Two of the three symptoms are the same single bug (user-bubble + raw token = "this string isn't on my allowlist"). The third symptom (chips inside the message) is a **product expectation that was never built into the chat surface at all** — the location chips exist only on the empty-deck swiper screen, never inside a chat message; the chat banner is prose + token-buttons by design and has no chip-rendering code.

---

## Confidence

- **Symptom 1 (renders as a user bubble) + Symptom 3 (raw `[[open-prefs]]` token, parser not running): `root cause PROVEN`.** Backed by (a) the live DB rows showing the exact runtime strings from two different builds in one conversation, (b) a byte-level regex evaluation of those exact strings against BOTH the main allowlist and the worktree allowlist, (c) the full source trace of the gate `messages.sender_id !== null && isCollabDeadEndBannerMessage(content) → isSystem → MessageBubble system branch`, and (d) git proof that the new copy + new allowlist are 6 commits ahead of `main` and unmerged while the receiving device runs `main`.
- **Symptom 2 (no participant/city chips inside the message): `root cause PROVEN` (it was never built for the chat surface).** Backed by grep proving `CollabLocationChips` is imported ONLY by `SwipeableCards.tsx` and never by `MessageBubble.tsx`/`MessageInterface.tsx`, plus the full `renderSystemBannerContent` source showing the chat banner renderer emits only `<Text>` prose + `<TouchableOpacity>` token-buttons — there is no chip path.
- **Live two-phone race repro:** NOT performed frame-by-frame (a 2-participant cross-build collab race is not solo-reproducible on one sim, consistent with the predecessor investigation). It is **not needed** — the runtime DB rows ARE the live evidence, and the regex evaluation against the exact persisted strings is dispositive. Confidence is `proven` on the string→allowlist→isSystem mechanism, not inflated.

---

## Phase 0 — Context ingested

- Read `COMMS_LEDGER.md`. No `BLOCK`/`WARN`/`FYI` row is addressed to `mingla-forensics`, to `ORCH-1058`, or to `ALL` in a way that bears on collab chat rendering. The OPEN WARN rows (COMMS-0003/0004/0012/0013/0015/0016) concern external-API doc-citation, INTAKE numbering, migration-apply gaps, and pricing. Nothing to ack. No new cross-ORCH discovery to write (localized to collab chat presentation already owned by ORCH-1058).
- Read the predecessor ORCH-1058 investigation + implementation reports. The implementation report's "REGRESSION FIX 2026-06-02" section claims the allowlist drift was fixed and proven by a parity test. **That claim is true for a single consistent build, but it did not account for the cross-build test topology that produced Seth's symptom.** This investigation supersedes the implementation report's root-cause model for the reported symptom.
- Memory `feedback_collab_deck_lives_in_group_chat.md` + `feedback_collab_deck_determinism_contract.md` factored — collab banners post into the group conversation; the render contract is unchanged by ORCH-1058 (proven by the no-diff result below).

---

## The user's actual goal (outcome step-back)

Seth's job-to-be-done: when a collab deck goes empty because the group's locations don't overlap, **everyone in the chat should immediately understand WHY (who is where) and get a one-tap way to fix it (open the location/travel picker)** — without seeing raw machinery. The desired terminal state is a clean, centered system notice with the participants' cities legible and a tappable "Open location picks" affordance.

Where reality diverges, mapped end-to-end:
1. Deck empties (correct, per predecessor investigation — GPS flap / genuine non-overlap).
2. `postCollabDeadEndBanner` posts a banner string into the group conversation. **Divergence A:** the string is the *new* ORCH-1058 copy on the dev build, but the *old* copy on main; the two builds emit different phrases for the same situation.
3. The banner reaches each participant's chat. **Divergence B (the bug):** whether it renders as a system banner depends on the *receiving device's* allowlist recognizing the *sending device's* phrase. Cross-build, it doesn't.
4. Even on a matched build, **Divergence C:** the "who is where" is delivered as inline prose (e.g. "Miami, FL and Raleigh, NC"), not as the chip UI Seth expects — because chips were only ever built on the deck screen, never in the chat message.

Fixing only the allowlist (the prior patch) does NOT fully deliver the outcome: it resolves Divergence A/B only once both builds converge (i.e., after merge), and does nothing for Divergence C. The outcome lens therefore expands the real ask beyond "patch the allowlist."

---

## Investigation Manifest (every file / query, in trace order)

| # | Artifact | Why |
|---|----------|-----|
| 1 | `COMMS_LEDGER.md` | Mandatory entry scan |
| 2 | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1058_COLLAB_LOCATION_CHIPS.md` | The patch under scrutiny + its claimed root-cause model |
| 3 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1058_..._REPLAY.md` | Prior GPS-flap context + session topology |
| 4 | `app-mobile/src/services/collabDeadEndBannerService.ts` (full) | How the banner is POSTED (sender_id, message_type, copy strings) |
| 5 | `app-mobile/src/services/messagingService.ts` L166-198 | The `COLLAB_DEAD_END_BANNER_PATTERNS` allowlist + `isCollabDeadEndBannerMessage` |
| 6 | `app-mobile/src/services/messagingService.ts` L827-849, L1418-1451, L1310-1369 | `getMessages` → `enrichMessage` / `enrichMessageRealtime` (where `isSystem` is set) + realtime subscription |
| 7 | `app-mobile/src/components/chat/MessageBubble.tsx` L13-33, L75-135, L234-243, L482-545 | `MessageData.isSystem`, the system render branch, the token parser, `renderSystemBannerContent` |
| 8 | `app-mobile/src/components/MessageInterface.tsx` L95-115, L398-437, L1573-1670 | `Message` type, `handleSystemTokenPress`, `<MessageBubble isSystem={item.message.isSystem}>` |
| 9 | `app-mobile/src/components/ConnectionsPage.tsx` L1541-1564, L1800-1843, L2256-2357, L2378-2399 | `transformMessage` (DirectMessage→Message, preserves isSystem), server-fetch + realtime delivery, cache |
| 10 | `app-mobile/src/components/SwipeableCards.tsx` L84-88, L1751-1815 | Where `CollabLocationChips` actually render (the deck screen) |
| 11 | LIVE DB `messages` (conversation `3ecffa59`) | The exact persisted runtime strings + sender identities |
| 12 | `git show main:…`, `git diff main`, `git log -S`, `git merge-base` | Prove which code each build runs; render path is unchanged vs main; allowlist patch unmerged |
| 13 | Node regex harness (`/tmp/test_regex.mjs`, `test_main.mjs`, `test_cross.mjs`) | Byte-level evaluation of exact DB strings vs both allowlists |

---

## The render pipeline, mapped end-to-end (both directions)

### Forward: how a collab dead-end banner is POSTED

`app-mobile/src/services/collabDeadEndBannerService.ts` → `postCollabDeadEndBanner()`:

```ts
// L69-78
const content = buildCollabDeadEndBannerContent(input);
const { error } = await supabase
  .from('messages')
  .insert({
    conversation_id: conversation.id,
    sender_id: input.currentUserId,   // ← NON-NULL (attributed to the poster)
    content,
    message_type: 'text',             // ← plain 'text', NOT 'system'
  });
```

`buildCollabDeadEndBannerContent` (L87-156), `intersection_empty` multi/2-person branch (worktree code) emits one of:
- `Waiting on {Name}'s location to land — the deck fills in automatically. [[open-prefs:location:{id}]]`
- `You're in different cities — {LabelA} and {LabelB}. Pick one spot you'll all head to. [[open-prefs:location:{selfId}]]`
- `So close — you're in the same area but your travel ranges don't touch. Bump travel time or distance? [[open-prefs:travel:{selfId}]]`

The poster is **not null** and the type is **`text`** — by itself this would render as a normal user bubble. The ONLY thing that promotes it to a system banner is the content-allowlist match (next).

### Backward: how the chat decides system-vs-user and parses tokens

1. **`messages` row** → fetched by `messagingService.getMessages` (L827) or arrives via the realtime `postgres_changes` INSERT subscription (L1334).
2. **`enrichMessage` (L1418) / `enrichMessageRealtime` (L1442)** set the flag:
   ```ts
   isSystem: message.sender_id === null || isCollabDeadEndBannerMessage(message.content)
   ```
   Because the banner's `sender_id` is non-null, `isSystem` is `true` **iff** `isCollabDeadEndBannerMessage(content)` returns true — i.e. iff the content matches one of `COLLAB_DEAD_END_BANNER_PATTERNS` (L175-194). **This allowlist IS on the render path** for DB-posted rows (both fetch and realtime), disproving the "allowlist only used for locally-synthesized banners" hypothesis.
3. **`ConnectionsPage.transformMessage` (L1542)** maps `DirectMessage → Message`, carrying `isSystem: msg.isSystem` (L1561). Every load path (cache-first L1798, server-refresh L1808/1838, realtime L2274, optimistic-replace L2816) runs this transform.
4. **`MessageInterface` (L1573, L1640)** renders `<MessageBubble … isSystem={item.message.isSystem} onSystemTokenPress={handleSystemTokenPress}>`.
5. **`MessageBubble` (L237):** `if (message.isSystem) { return <View …>{renderSystemBannerContent(message.content, onSystemTokenPress)}</View>; }` — the centered, chrome-less system row.
6. **`renderSystemBannerContent` (L512):** splits on `SYSTEM_TOKEN_REGEX`, runs `parseCollabSystemToken` (L482) on each segment; a valid token becomes a `<TouchableOpacity>` with a label ("Open location picks"), surrounding prose stays `<Text>`. **The raw `[[…]]` is stripped only here.**
7. **If `isSystem` is false (L129-134):** `renderContentWithMentions` emits `<Text>{content}</Text>` verbatim — the `[[open-prefs:…]]` token is NOT stripped and **leaks as raw text inside a normal user bubble.** This is exactly symptoms 1 + 3.

**The exact condition for a tappable button + stripped token:** `messages.sender_id === null` OR `isCollabDeadEndBannerMessage(content) === true`, evaluated on the *receiving device's* copy of the allowlist. For these banners (`sender_id` non-null), it reduces entirely to the content-allowlist match.

---

## Five-Layer Cross-Check

| Layer | Finding |
|-------|---------|
| **Docs / intent** | Collab banners should render as system notices with tappable token-buttons (predecessor ORCH-0945 + memory `feedback_collab_deck_lives_in_group_chat`). Chips were spec'd for the *deck* empty state (DESIGN_ORCH-1058 §4), NOT for the chat message. |
| **Schema** | `messages.sender_id` is non-null for the banner; `message_type='text'`. There is no `'system'` message_type in use here — system-ness is a CLIENT-DERIVED flag, never persisted. |
| **Code** | Render path identical on main and worktree (git diff = empty for MessageBubble, MessageInterface isSystem, ConnectionsPage transform). The ONLY ORCH-1058 deltas are the copy strings (collabDeadEndBannerService) + the allowlist patterns (messagingService) + the deck chips. |
| **Runtime** | Conversation `3ecffa59` holds BOTH an OLD-copy banner (Seth `c727d491`, 01:57, main build) AND NEW-copy banners (Ava `b17e3e15`, 01:55 + 15:22, dev build). Two builds, one conversation. |
| **Data** | The persisted strings, evaluated byte-for-byte against each build's allowlist, prove the mismatch (table below). Apostrophe = ASCII `'` (0x27), dash = em-dash U+2014 — both handled by the worktree regex; the worktree regex matches the new string (true); the main regex does not (false). |

### The decisive regex evaluation (runtime strings × both allowlists)

| Persisted string (verbatim from DB) | Producing build | Matches **main** allowlist → isSystem | Matches **worktree** allowlist → isSystem |
|---|---|---|---|
| `No location overlap yet.\n[[open-prefs:location:…]] Miami… · [[open-prefs:location:…]] Raleigh…\nSomeone needs to widen travel or change location.` | main (Seth) | **true** (renders as banner) | n/a (worktree no longer emits this) |
| `You're in different cities — Miami, FL and Raleigh, NC. Pick one spot you'll all head to. [[open-prefs:location:b17e3e15-…]]` | worktree (Ava) | **false → USER BUBBLE + RAW TOKEN** | **true** (renders as banner) |

On Seth's main-build phone, Ava's new-copy banner fails the (old) allowlist → `isSystem=false` → user bubble + leaked token. **Symptoms 1 + 3, proven.**

---

## Findings (classified)

### 🔴 Root Cause RC-1 — Symptoms 1 + 3: cross-build allowlist mismatch (system-ness is content-coupled, and the copy↔allowlist pair was changed on an unmerged branch)

- **File + line:** `app-mobile/src/services/messagingService.ts:1433` and `:1449` — `isSystem: message.sender_id === null || isCollabDeadEndBannerMessage(message.content)`; gated by `COLLAB_DEAD_END_BANNER_PATTERNS` (`:175-194`). Posting site: `collabDeadEndBannerService.ts:71-77` (`sender_id` non-null, `message_type:'text'`).
- **Exact code (the gate):** `isSystem: message.sender_id === null || isCollabDeadEndBannerMessage(message.content)`.
- **What it does:** a DB-posted banner renders as a system message ONLY if its content matches the *receiving client's* hard-coded copy allowlist. Because `sender_id` is non-null, system-ness is 100% content-coupled.
- **What it should do (mechanism a fix must satisfy — not a fix here):** the post should carry an intrinsic, content-independent system marker that survives copy changes and cannot drift between builds — e.g. a true system sender (`sender_id = null`, which already short-circuits the gate to `isSystem=true` at `:1433`), or a persisted `message_type:'system'` / a structured metadata column the renderer keys on — so that whether a row is a system banner does not depend on the receiver's app version recognizing the exact prose.
- **Causal chain:** ORCH-1058 rewrote the `intersection_empty` copy AND the matching allowlist together on the worktree branch → that pair is 6 commits ahead of `main` and unmerged → Seth tested on his physical iPhone running the shipped (main) app while the other participant ran the worktree dev build on Metro:8087 → the dev build posted the new copy string → Seth's main app evaluated it against the OLD allowlist (which lacks the new patterns) → `isCollabDeadEndBannerMessage` returned false → `isSystem=false` → `MessageBubble` took the normal-bubble branch (`:250+`) → `renderContentWithMentions` printed the content verbatim (`:131`) → the `[[open-prefs:location:…]]` token leaked as raw text inside a user-attributed bubble.
- **Verification step:** `node /tmp/test_cross.mjs` (reproduced in this report): the verbatim DB string `You're in different cities — …` returns `false` against the main allowlist and `true` against the worktree allowlist. `git merge-base --is-ancestor` confirms the worktree allowlist/copy commits are not on main; `git diff main` confirms the render path files are byte-identical (so the gate logic itself is shipped and correct).
- **Candidate causes considered + disproven:**
  - *"Allowlist isn't on the render path for posted rows"* — DISPROVEN: `getMessages→enrichMessage` (`:841`) and the realtime subscription (`:1334→enrichMessageRealtime`) both call `isCollabDeadEndBannerMessage`; `transformMessage` carries the flag through. The allowlist IS consulted for DB-posted rows.
  - *"Runtime string mismatch within a single build (em-dash / apostrophe / `?` / variable City,ST break the anchored regex)"* — DISPROVEN for the worktree build: the verbatim DB string matches the worktree regex (`pattern 2 = true`, `/tmp/test_regex.mjs`). The apostrophe is ASCII `'`, the em-dash is U+2014, both accounted for. The mismatch is NOT intra-build; it is **cross-build** (new string × old allowlist).
  - *"MessageBubble token parser is broken"* — DISPROVEN: `parseCollabSystemToken`/`renderSystemBannerContent` handle the `location` section + hyphenated UUIDs correctly; the parser simply never runs because `isSystem` is false on the mismatched build.

### 🔴 Root Cause RC-2 — Symptom 2: location/city chips are not, and never were, part of the chat-message surface

- **File + line:** `app-mobile/src/components/SwipeableCards.tsx:84-88` (the ONLY importer of `CollabLocationChips`) vs `app-mobile/src/components/chat/MessageBubble.tsx:512-545` (`renderSystemBannerContent`, which emits only `<Text>` + `<TouchableOpacity>` token-buttons).
- **Exact code:** `renderSystemBannerContent` maps content segments to either a `<Text>` (prose) or a `<TouchableOpacity><Text>{label}</Text></TouchableOpacity>` (token-button). There is no chip component referenced anywhere in `MessageBubble.tsx`.
- **What it does:** the chat banner renders the "who is where" as inline prose baked into the copy string (e.g. "Miami, FL and Raleigh, NC"). The chip UI Seth expects (`Seth · Raleigh, NC` pills) renders only on the empty-DECK screen (`SwipeableCards`), a different surface the swiping participant sees — never inside a chat message.
- **What it should do (mechanism a fix must satisfy):** to put chips *inside the message*, the banner must carry structured participant/location data (not just a prose string) AND `renderSystemBannerContent` (or a new system-banner subcomponent) must gain a chip-rendering branch fed by that structured data. Today neither exists: the message is a flat string, and the renderer has no chip path. A fix would need (1) a structured payload alongside/within the message (e.g. an additional metadata column or an encoded token the parser expands into chips) and (2) a chip render branch in the system-banner renderer reusing `CollabLocationChips` / the `glass.discover.chip` tokens.
- **Causal chain:** the design (DESIGN_ORCH-1058 §4) scoped chips to the deck empty state; the chat banner was scoped to prose + token-buttons → the implementation built `CollabLocationChips` only into `SwipeableCards` → the chat message has no chip capability → Seth, viewing the chat message, sees prose, not chips.
- **Verification step:** `grep -rn "CollabLocationChips" src/components/chat src/components/MessageInterface.tsx` returns nothing; the only importer is `SwipeableCards.tsx`. `renderSystemBannerContent` source contains no chip reference.

### 🟠 Contributing Factor CF-1 — the copy string and its allowlist are two separate hand-maintained mirrors that must change together AND ship together

- `collabDeadEndBannerService.buildCollabDeadEndBannerContent` (the producer) and `messagingService.COLLAB_DEAD_END_BANNER_PATTERNS` (the recognizer) are independent literals. The implementor's parity test asserts they agree *within one build*, but nothing guarantees a producer on build N and a recognizer on build N-1 agree. Any future copy tweak re-opens the identical cross-build window during the test phase (one dev build + one shipped device is the standard 2-participant test topology per memory `feedback_tester_3sims_plus_operator_physical`).

### 🟡 Hidden Flaw HF-1 — AsyncStorage message cache can momentarily render a pre-fix `isSystem`

- `ConnectionsPage` renders cache-first (`:1798`) before the background refresh (`:1808`). A banner row cached while the local allowlist didn't match (isSystem=false) renders as a user bubble until the refresh re-transforms it. Self-heals on refresh, but is a transient flash on the SAME device after an allowlist change. Not the reported symptom (that is cross-build), but a related fragility of content-derived system-ness.

### 🔵 Observation OBS-1 — the prior implementation report's root-cause model is incomplete, not wrong

- IMPLEMENTATION_ORCH-1058 correctly identified the intra-build copy↔allowlist drift and fixed it with a parity test. That fix is sound and necessary. It simply did not account for (a) the cross-build test topology that produced Seth's actual symptom, nor (b) symptom 2 (chips in the message), which is out of that patch's scope entirely. This investigation supersedes the report's claim that the symptom is fully resolved.

---

## Blast Radius

- **Surfaces:** consumer app-mobile only (collab decks are consumer-only; predecessor Q5). No admin/business/web analog.
- **Other flows on the same gate:** every collab dead-end reason (`no_matching_candidates`, `no_unswiped_candidates`, `quorum_not_met`, `all_pools_exhausted`, single-outlier `is too far`) renders through the SAME `isCollabDeadEndBannerMessage` allowlist. Any copy change to ANY of these strings re-opens the same cross-build window. The single-outlier "is too far" string is unchanged between builds, which is why Seth's older banners rendered fine — only the *changed* intersection strings break cross-build.
- **Cache:** `getMessagesCacheKey` per-conversation AsyncStorage cache (HF-1).
- **Determinism contract:** untouched — this is presentation only; geometry/freeze unaffected (predecessor + no-diff proof).

---

## Fix Strategy (DIRECTION ONLY — no code, no spec here)

The reported outcome requires addressing all three divergences. A correct fix must satisfy these mechanisms (the SPEC phase will choose among them):

1. **Decouple system-ness from copy (RC-1 + CF-1).** Make a collab banner render as a system message via an intrinsic marker that cannot drift with prose or across builds. The cheapest path already wired: post with `sender_id = null` (the gate at `messagingService.ts:1433`/`:1449` already short-circuits `isSystem=true` for null senders — but verify RLS allows a null-sender insert; ORCH-0945 deliberately used a non-null sender "to satisfy live messages RLS" per the comment at `:1413-1415`, so this needs an RLS/SECURITY-DEFINER path). Alternatively persist `message_type:'system'` (schema change) or a structured metadata column the renderer keys on. Whichever is chosen, the recognizer must NOT depend on matching exact future-changeable prose.
2. **Ship the copy + allowlist together, and guard cross-version (CF-1).** Until system-ness is decoupled, any copy change MUST land on main before mixed-build testing, and ideally the recognizer should match the structural token shape (`[[open-prefs:…]]` present in a collab conversation) rather than the full anchored prose, so a new phrase from a newer build still parses on an older build.
3. **Decide the product surface for chips (RC-2).** If Seth wants the participant/city chips *inside the chat message* (not just on the deck screen), the banner must carry structured participant+location data and the system-banner renderer must gain a chip branch (reuse `CollabLocationChips` + `glass.discover.chip` tokens). If prose-in-message is acceptable, RC-2 is a no-op and only RC-1 needs fixing. This is a product decision for the orchestrator/Seth.

---

## Regression Prevention requirements (for the eventual SPEC/TEST)

- A test that posts a banner row with the CURRENT producer copy and asserts `isSystem=true` AND token-stripped, evaluated against BOTH the current allowlist AND a deliberately-older allowlist snapshot (to catch cross-version regressions), OR — if decoupled — asserts system-ness independent of copy.
- A migration/merge gate ensuring producer-copy changes and recognizer changes (and any new structured payload) land in the same PR to main.
- If chips-in-message is chosen: a render test asserting the structured payload yields chips, not raw prose, inside the system row.

## Discoveries for Orchestrator

- **The prior allowlist patch (`1bb6c71fd`) is correct but unmerged (6 commits ahead of main).** The reported symptom is NOT a regression of that patch; it is a cross-build artifact of testing a worktree dev build against a shipped device. Merging ORCH-1058 to main makes both builds agree and resolves symptoms 1+3 *for matched builds* — but does NOT decouple system-ness from copy (CF-1) and does NOT deliver chips-in-message (RC-2).
- **Symptom 2 (chips in the message) is a product-scope question, not a bug in the patch.** Chips were built for the deck screen by design. Decide whether the chat message should also render chips before SPEC.
- **RLS constraint on null-sender system messages:** ORCH-0945 chose non-null `sender_id` "to satisfy live messages RLS." Any RC-1 fix using `sender_id=null` must re-verify the `messages` INSERT RLS (likely needs a SECURITY DEFINER RPC to post a true system row). Flag for the SPEC's DB layer.
- **GPS implausible-jump debounce remains a separate ORCH** (predecessor Discovery #1) — the flap that triggers the empty window is still unfixed; this investigation is only about how the resulting banner renders.

## Confidence Level

**HIGH** — symptoms 1+3 root cause `PROVEN` (runtime DB strings × byte-level regex × full source trace × git merge-state); symptom 2 root cause `PROVEN` (grep + renderer source). Two-phone frame-by-frame race not needed because the persisted rows are the live evidence and the regex evaluation against them is dispositive.
