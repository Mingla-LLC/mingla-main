# IMPLEMENTATION — ORCH-1058B [Collab "Notify the group" dead-end system message: intrinsic marker + participant·City/ST chips + tappable prefs button]

**Skill:** mingla-implementor (Claude, parity mirror)
**Date:** 2026-06-02
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1058-[collab-deck-empty-intersection-replay]/` on branch `ORCH-1058-collab-deck-empty-intersection-replay`
**Spec (authoritative):** `Mingla_Artifacts/specs/SPEC_ORCH-1058B_NOTIFY_GROUP_SYSTEM_MESSAGE.md` (`480334af4`)
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1058B_NOTIFY_GROUP_SYSTEM_MESSAGE_PIPELINE.md` (`60e336b40`)
**Status:** implemented and verified (tests green + fails-on-revert proven + tsc/lint clean). Live two-device QA pending (REQUIRES both devices on the SAME new build — see §Platform).
**Converged with:** the 6 unmerged ORCH-1058 commits on this branch (copy matrix, GPS-resolved City/ST resolver, deck chips, allowlist). ONE PR to main.

---

## Comms ledger (read on entry)

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`. No `BLOCK`/`WARN`/`FYI` row is addressed to `mingla-implementor`, to `ORCH-1058`, or to `ALL` in a way that bears on collab chat rendering. COMMS-0002 (ORCH-0863 C7 `no-new-backend-files` gate blocks backend PRs) is the only relevant `ALL` WARN — factored: the new migration is added to the ORCH-0863 strict-grep allowlist **in the same commit** (§Layer 1). COMMS-0003 (external-API doc citation) is N/A — this ORCH introduces no external API (Supabase-internal RPC + RN render only). No new cross-ORCH discovery to write (scope localized to collab chat presentation already owned by ORCH-1058).

---

## Layman summary

When a collab group's deck empties because everyone's in different cities, the app posts a "notify the group" message in the chat. Before this change that message could render as a plain bubble from a person with raw computer code (`[[open-prefs:…]]`) showing instead of a button — because whether it rendered as a "system notice" depended on the receiving phone recognizing the exact wording, which drifted across app builds. Now the message is a true system notice by an intrinsic marker (it can never regress across builds), shows each participant's city as a chip ("Seth · Raleigh, NC", "Ava · Miami, FL"), and turns the prefs link into a real tappable button. Older app builds that don't understand the new format degrade to clean readable prose — never raw codes.

---

## Cross-surface impact (Step 3.5)

| # | Surface | Affected? | What / files / parity |
|---|---------|-----------|-----------------------|
| 1 | Consumer iOS | ✅ | Full feature. Files below. Parity with Android automatic (shared RN). |
| 2 | Consumer Android | ✅ | Same shared code; chip opaque-glass fallback handled inside `CollabLocationChips` (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`). |
| 3 | Buyer/anon Web | ❌ | No collab chat on web. |
| 4 | Business iOS | ❌ | No collab-deck analog. |
| 5 | Business Android | ❌ | Same. |
| 6 | Admin Web | ❌ | Admin doesn't render collab chat. |
| 7 | Business Web preview | ❌ | Same as 3/4. |

Parity across iOS/Android is shared-code automatic; the only per-platform gate is the chip glass fallback (already component-handled). No manual parity drift to flag.

---

## Implementation order (SPEC §8)

Built exactly in §8 order: (1) migration + RPC + strict-grep allowlist → (2) service types + payload builder + RPC call → (3) recognizer → (4) data transform → (5) renderer + prop threading → (6) regression tests + workflow wiring.

---

## Old → New receipts

### `supabase/migrations/20260826000000_orch_1058b_post_collab_dead_end_banner.sql` (NEW)
**Before:** no such RPC; the banner was inserted by a direct client `messages` INSERT with `sender_id = currentUserId, message_type = 'text'`.
**Now:** `CREATE OR REPLACE FUNCTION public.rpc_post_collab_dead_end_banner(p_session_id uuid, p_reason text, p_payload jsonb) RETURNS uuid`, `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public, pg_temp`. Body: (1) `auth.uid()` required; (2) resolves the session conversation via the SAME lookup the service used (`conversations WHERE session_id = p_session_id AND linked_entity_type = 'session'` — verified identical to ORCH-0908's precedent at migration `20260629000000:184-188`); (3) **participant authorization** — `RAISE EXCEPTION 'not a participant'` unless `auth.uid()` is in `conversation_participants` for that conversation (this replaces the WITH CHECK the null-sender insert bypasses); (4) validates `p_reason` against the 5-reason set; (5) validates `p_payload.kind = 'collab_dead_end'` + non-empty `participants` array; (6) `INSERT INTO public.messages (conversation_id, sender_id, content, message_type, card_payload) VALUES (…, NULL, p_payload->>'prose', 'system', p_payload) RETURNING id`. `REVOKE ALL … FROM public` + `GRANT EXECUTE … TO authenticated`. `COMMENT ON FUNCTION` documents intent.
**Why:** SPEC §3.1 / SC-1 / SC-7 / INV-1 / INV-5. Null-sender + `message_type='system'` are the intrinsic markers; `SECURITY DEFINER` is the sanctioned way to write a null-sender row past the messages INSERT RLS.
**Lines:** ~135 (incl. doc comment).
**Safe-migration:** additive `CREATE OR REPLACE` + `GRANT` only. No schema column add, no RLS policy change, no CHECK change. Idempotent, reversible (DROP FUNCTION), zero data mutation, no lock on `messages`.

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (MODIFIED)
**Before:** C7 `no-new-backend-files` gate's `ALLOWLIST` had no entry for the ORCH-1058B migration.
**Now:** new `ORCH_1058B_BACKEND_ALLOWLIST = ["supabase/migrations/20260826000000_orch_1058b_post_collab_dead_end_banner.sql"]` spread into `ALLOWLIST`.
**Why:** COMMS-0002 — the new migration would trip C7. Added in the SAME commit. Verified: running the gate against the staged diff reports `OK [C7: no-new-backend-files]`.
**Lines:** +9.

### `app-mobile/src/services/collabDeadEndBannerService.ts` (MODIFIED)
**Before:** `postCollabDeadEndBanner` did a direct `supabase.from('messages').insert({sender_id: currentUserId, content, message_type:'text'})` after a client-side `getOrCreateGroupConversationForSession` lookup; only `buildCollabDeadEndBannerContent` (prose with inline `[[…]]` tokens) existed.
**Now:** `postCollabDeadEndBanner` builds the structured payload and calls `supabase.rpc('rpc_post_collab_dead_end_banner', { p_session_id, p_reason, p_payload })`. The client conversation lookup is removed (server resolves it). Existing 5-min debounce (`orch_0945_banner_debounce` AsyncStorage key) and error toast are preserved unchanged; signature stays `Promise<void>`. New exports: `CollabDeadEndBannerPayload` type, `buildCollabDeadEndBannerPayload(input)` (chips from `resolveParticipantLocationLabel` exactly like the deck, action from §3.2 table, prose = token-stripped `buildCollabDeadEndBannerContent`), `buildCollabDeadEndBannerAction(input)` (single-source action derivation), `stripCollabSystemTokens(content)` (`.replace(/\s*\[\[[^\]]*\]\]/g,'').replace(/\s+\n/g,'\n').trim()` per §6). `buildCollabDeadEndBannerContent` is RETAINED + reused (matrix stays in one place). Imports `CollabSystemAction` (type) from MessageBubble + `ParticipantLocationKind` from the resolver.
**Why:** SPEC §3.2 / SC-4 / SC-6 / INV-2. The poster now emits a true system row with structured data + token-stripped degrade prose.
**Lines:** ~+150, -20.

### `app-mobile/src/services/messagingService.ts` (MODIFIED)
**Before:** `isSystem: message.sender_id === null || isCollabDeadEndBannerMessage(message.content)` (both enrich paths). `DirectMessage.message_type` union lacked `'system'`. Allowlist comment positioned the prose patterns as the system-ness mechanism.
**Now:** `isSystem: message.sender_id === null || message.message_type === 'system' || isCollabDeadEndBannerMessage(message.content)` (belt-and-suspenders intrinsic markers first). `DirectMessage.message_type` widened to include `'system'`. Allowlist comment rewritten to state system-ness is PRIMARILY intrinsic and the allowlist is now the LEGACY/DEGRADE FALLBACK. `card_payload` already flows through both enrich paths via `...message`.
**Why:** SPEC §3.3 / SC-1 / SC-10 / INV-1. Decouples system-ness from changeable prose.
**Lines:** ~+12, -10 (mostly comment).

### `app-mobile/src/services/connectionsService.ts` (MODIFIED)
**Before:** `Message.type` union lacked `'system'`; no `systemPayload`.
**Now:** `Message.type` widened to `… | 'system'`; added `systemPayload?: any` (typed loosely to avoid a circular import, matching the existing `cardPayload?: any` precedent in the same interface).
**Why:** the transform now sets `type: msg.message_type` (which can be `'system'`) and surfaces `systemPayload`.
**Lines:** +3.

### `app-mobile/src/components/ConnectionsPage.tsx` (MODIFIED)
**Before:** `transformMessage` carried `isSystem` but no `systemPayload`.
**Now:** `systemPayload: msg.card_payload && (msg.card_payload as {kind?:string}).kind === 'collab_dead_end' ? (msg.card_payload as CollabDeadEndBannerPayload) : undefined`. Imports the payload type (type-only). Every load path (cache-first, server-refresh, realtime, optimistic) runs this single transform, so the payload reaches every render.
**Why:** SPEC §3.4 / SC-2 / SC-10. Maps the structured payload to the renderer.
**Lines:** +9 (incl. import).

### `app-mobile/src/components/MessageInterface.tsx` (MODIFIED)
**Before:** local `Message` interface lacked `'system'` type + `systemPayload`; both `<MessageBubble>` render sites passed `isSystem` but not `systemPayload`.
**Now:** `Message.type` widened to `… | 'system'`; added `systemPayload?: CollabDeadEndBannerPayload` (imported type-only); both render sites pass `systemPayload={item.message.systemPayload}`. `handleSystemTokenPress` is UNCHANGED — it already routes every `CollabSystemToken` variant, and the structured `action` IS one, so the button "just works."
**Why:** SPEC §3.4. Threads the payload to the renderer.
**Lines:** +5.

### `app-mobile/src/components/chat/MessageBubble.tsx` (MODIFIED)
**Before:** the `message.isSystem` branch always rendered `renderSystemBannerContent(message.content, …)` (prose-token parser). No `systemPayload`, no chip import, no button.
**Now:** added `export type CollabSystemAction = CollabSystemToken` (shared with the poster — kills CF-1 for the action). `MessageData` gains `systemPayload?: CollabDeadEndBannerPayload`. The system branch: if `systemPayload?.kind === 'collab_dead_end'` → `renderCollabDeadEndBanner(payload, onSystemTokenPress)` (prose line + `<CollabLocationChips chips={participants.map(p => ({id, label: `${p.name} · ${p.label}`, kind: p.locationKind, a11yLabel: p.a11yLabel}))} />` + a real `<TouchableOpacity>` button labeled by `getSystemTokenLabel(payload.action)`, `accessibilityRole="link"`, `testID`, `hitSlop`, `activeOpacity` press feedback, `#eb7825` outlined pill); ELSE the existing `renderSystemBannerContent` (legacy/degrade prose path). NO prose parsed in the structured branch → raw `[[…]]` can never render. Imports `CollabLocationChips` (second importer; was SwipeableCards-only) + `CollabDeadEndBannerPayload` (type-only). New styles: `systemPayloadRow`, `systemPayloadContent`, `bannerButton`, `bannerButtonLabel`.
**Why:** SPEC §3.4 / §3.6 / SC-2 / SC-4 / SC-9 / INV-2 / INV-3. Renders chips + button from data.
**Lines:** ~+70.

### `app-mobile/scripts/ci/orch-1058b-system-banner-check.mjs` (NEW)
**Now:** the §10 regression suite (36 checks): T-01 intrinsic recognition with the allowlist EMPTIED (evaluates the REAL `isSystem` expression extracted from messagingService source against a forced-empty allowlist), T-02 token-never-leaks in `payload.prose` (all 9 reasons), T-03 chips-from-data (one chip per participant, `Name · Label`, valid kind, name-led a11y), **T-04 cross-build degrade** (new producer's token-stripped prose × an explicitly-OLD allowlist snapshot + the REAL MessageBubble token parser → ZERO buttons + ZERO `[[`), T-05 legacy prose row (token present) → exactly one button, T-06 button-target matrix (all 9 reasons against §3.2), plus a `stripCollabSystemTokens` unit. Uses the same `evalTsModule` transpile harness as the existing `orch-1058-banner-allowlist-parity.mjs`.
**Why:** SPEC §10 + the MANDATORY regression-test gate.
**Lines:** ~330.

### `.github/workflows/strict-grep-mingla-business.yml` (MODIFIED)
**Before:** the ORCH-1058 parity test (`orch-1058-banner-allowlist-parity.mjs`, shipped in the 6 commits) and the new ORCH-1058B test were not wired into CI.
**Now:** new job `orch-1058-collab-system-banner` that `npm install --no-save typescript` (the transpile harness dep) then runs BOTH `orch-1058-banner-allowlist-parity.mjs` AND `orch-1058b-system-banner-check.mjs`. Static literal `run:` strings only — no `${{ github.event.* }}` interpolation, no injection surface.
**Why:** SPEC §9 — "the §10 parity/guard test … becomes real and gates copy/payload changes."
**Lines:** +16.

---

## Spec traceability (success criteria)

| SC | Criterion | Verification | Verdict |
|----|-----------|--------------|---------|
| SC-1 | Intrinsic system-ness cross-build | T-01/T-01c: REAL `isSystem` expr returns true for null-sender / `message_type='system'` with allowlist EMPTIED. | PASS |
| SC-2-iOS | Chip per participant `Name · City, ST`, translucent glass | T-03 (chip count + `Name · Label`); chip reuses `glass.discover.chip` iOS fill. Visual confirmed by component reuse; on-device pending live QA. | PASS (unit) / live-QA pending |
| SC-2-Android | Opaque fallback fill, no taupe ring | `CollabLocationChips` drives `g.chip.inactive.fallbackSolid` via `ANDROID_GLASS_USES_OPAQUE_FALLBACK`. | PASS (mechanism) / live-QA pending |
| SC-3 | GPS resolved City/ST; pending → "Getting a fix…" | Chips built from `resolveParticipantLocationLabel` (kind gps/place/pending). | PASS |
| SC-4 | Tappable button, no raw token | T-02 (no `[[` in prose) + structured branch never parses prose; button via `getSystemTokenLabel` + `handleSystemTokenPress`. | PASS |
| SC-5 | Backward-compat degrade | T-04: token-stripped prose × OLD recognizer + REAL parser → no token, no button. | PASS |
| SC-6 | Button target correctness per reason | T-06 (all 9 reasons `deepEqual` §3.2 table). | PASS |
| SC-7 | Authorization | RPC `RAISE EXCEPTION 'not a participant'`; remote probe confirmed `conversation_participants(conversation_id,user_id)` shape. Live RPC call post-`db push`. | PASS (code) / runtime-pending |
| SC-8 | Debounce preserved | Debounce block unchanged in `postCollabDeadEndBanner`. | PASS (code) |
| SC-9 | No card-branch bleed | System branch returns early at MessageBubble top (before the `type==='card'` body). | PASS (code) |
| SC-10 | Cache no-flash | Intrinsic marker (null-sender) is in the cached row; transform sets `systemPayload`. | PASS (mechanism) |

---

## Invariant verification

| ID | Preserved? | Evidence |
|----|-----------|----------|
| INV-1 `I-COLLAB-SYSTEM-MSG-INTRINSIC` | Y | Poster writes null-sender + `message_type='system'`; recognizer checks intrinsic first (T-01). |
| INV-2 `I-COLLAB-SYSTEM-MSG-NO-TOKEN-LEAK` | Y | T-02 + T-04 + T-05; structured branch never parses prose. |
| INV-3 `I-COLLAB-SYSTEM-MSG-CHIPS-FROM-DATA` | Y | `renderCollabDeadEndBanner` maps `payload.participants` → chips (T-03). |
| INV-4 `I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS` | Y | `collab_dead_end` payload carries only labels/names/ids/action/prose — no distances/travelTime. |
| INV-5 `messages` RLS | Y | RPC re-implements the participant check inside SECURITY DEFINER; READ RLS unchanged. |
| INV-6 Collab deck determinism | Y | No geometry/freeze/aggregation code touched; diff = render+poster+RPC+tests only. |

---

## Regression test

- **Test:** `app-mobile/scripts/ci/orch-1058b-system-banner-check.mjs` (36 checks) + the converged existing `app-mobile/scripts/ci/orch-1058-banner-allowlist-parity.mjs` (37 checks). Both wired into CI job `orch-1058-collab-system-banner`.
- **Passing run:** `ORCH-1058B system-banner: 36/36 checks passed.` and `ORCH-1058 parity: 37/37 checks passed.`
- **Fails-on-revert verified** (the fix is committed at the branch HEAD after these proofs; reverts were temporary, restored):
  - Removed the `message_type==='system'` + null-sender clauses from `messagingService.enrichMessage` → **T-01 + T-01c FAIL** (2 failing). Restored → PASS.
  - Replaced `stripCollabSystemTokens` body with `return content;` (no-op) → **T-02 (×9) + T-04 (×4) + strip unit FAIL** (14 failing). Restored → PASS.
- Both files ship in the SAME PR as the fix (staged in the closing diff).

---

## Verification gates (/goal)

1. Every SC implemented + demonstrated — see traceability table (unit-level PASS for all; SC-2 on-device + SC-7 runtime are live-QA/post-push, mechanism proven).
2. Regression test green + fails-on-revert at branch HEAD — proven above.
3. `tsc --noEmit` — 260 errors **both with and without** my changes (pre-existing repo baseline); **zero** in any touched file. Lint (`eslint`) — **0 errors**, only pre-existing repo-wide warnings (`array-type` on untouched `mentions?` lines, unused vars I didn't author). Output captured in session.
4. Constitution — see below.
5. Edge functions — N/A (no edge function touched; the only backend artifact is a migration the operator applies).

---

## Constitutional compliance (scan)

- #2 single owner: matrix prose stays in `buildCollabDeadEndBannerContent`; action shares ONE `CollabSystemAction` type across poster+renderer. PASS.
- #3 no silent failure: RPC errors map to the existing warning toast; RPC `RAISE`s on auth/shape violations. PASS.
- #9 no recipient-relative fields: payload carries labels/ids/action only (INV-4). PASS.
- #12 no `any` escape hatch in new logic: payload is fully typed; `systemPayload?: any` in `connectionsService.Message` mirrors the existing `cardPayload?: any` precedent (loose-typed to avoid circular import; narrowed to `CollabDeadEndBannerPayload` at the MessageInterface/MessageBubble boundary). PASS.
- All others N/A to this diff.

---

## Parity check

Solo/collab: this is collab-only (solo Home has no dead-end banner). iOS/Android: shared RN code; chip glass fallback component-handled. No parity gap.

## Cache safety

No query keys changed. `card_payload` already flowed end-to-end. The intrinsic null-sender marker is in the persisted/cached row, so cache-first render flags system on first paint (SC-10).

## Regression surface (for tester)

1. ORCH-0908 lock/schedule card messages (also system rows) — must still render as cards, NOT hit the `collab_dead_end` branch (guarded by `systemPayload?.kind` check).
2. ORCH-0899 "Plan another outing" null-sender announcements — must still render as plain system prose (no `systemPayload` → legacy path).
3. Legacy persisted prose banners in conversation `3ecffa59` — render via the legacy token parser (T-05).
4. The debounce + error-toast path on the poster.
5. Realtime delivery of the null-sender row (enrichMessageRealtime + transform).

---

## Migrations awaiting `supabase db push`

**File:** `supabase/migrations/20260826000000_orch_1058b_post_collab_dead_end_banner.sql`
**Next-migration-timestamp note:** remote head (via `mcp__supabase__list_migrations`) = `20260825000000`; sibling-worktree max = `20260825000000` (`meta_orch_1059_sub_b`). Chosen `20260826000000` is strictly greater than both — monotonic, no collision. No remote-only versions exist above the local tree.

**Apply command (operator, after merge or from the linked checkout):**
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1058-[collab-deck-empty-intersection-replay]" && /Users/sethogieva/bin/supabase db push --linked
```
If this worktree is not linked (it currently reports "Cannot find project ref"), run the push from the linked anchor `~/Desktop/mingla-main` after the PR merges, or `supabase link` the worktree first. Per memory `project_migration_history_drift_db_push_unsafe`, if `db push` is unsafe at deploy time, apply surgically via the Management API and INSERT the version `20260826000000` into `schema_migrations`. The migration is function-only `CREATE OR REPLACE` + `GRANT` (idempotent, re-runnable safely).

**Remote probe (parity rule 9b):** read-only `execute_sql` confirmed `messages.sender_id` nullable, `message_type` varchar (no CHECK), `card_payload` jsonb nullable, `content` NOT NULL; `conversations(session_id, linked_entity_type)` present (no `collab_session_id`); `conversation_participants(conversation_id, user_id)` present; no existing `rpc_post_collab_dead_end_banner` (clean CREATE). The RPC's pre-flight `RAISE`s are caller-input guards, not data-shape assumptions against existing rows, so no production-row abort risk.

---

## Platform / live-QA note (honest)

iOS + Android both covered (shared RN). **Live QA REQUIRES BOTH devices on the SAME new build** — the entire RC-1 symptom was a cross-build artifact; testing a new dev build against a shipped device shows the OLD device's behavior for not-yet-merged renderer changes. Protocol: after merge + new build on BOTH devices, post a `different_cities` banner → both see chips + button; the degrade path is proven by unit T-04 (a true stale binary is not hand-assembled per memory `feedback_testing_handoff_just_run_expo_start`; null-sender guarantees the system-row render on any build via the already-on-main `:1433` short-circuit). Android: confirm chip opaque fallback on emulator or the reserved physical device.

---

## Discoveries for orchestrator

- **Pre-existing tsc baseline:** `app-mobile` has 260 `tsc --noEmit` errors on `main`/this branch independent of ORCH-1058B (e.g. `ConnectionsPage.tsx:194` GroupEventMeta Map type mismatch). My changes add zero. Not in scope to fix; flag for a future typecheck-cleanup ORCH.
- **The 6 ORCH-1058 commits already shipped `orch-1058-banner-allowlist-parity.mjs`** in `app-mobile/scripts/ci/` — the SPEC §10 / Discoveries note said it "does not exist on disk," which was true at SPEC time (`60e336b40`) but the parity test was committed in `7ccb931`+. It is real now; this ORCH wires it (plus the new 1058B test) into CI.
- **GPS implausible-jump debounce** (the flap that triggers the empty window) remains a separate unfixed ORCH (predecessor Discovery #1) — presentation-only here.
- **CI wiring gap:** before this change, the existing ORCH-1058 parity test was a standalone script not gated by any workflow. Now wired. Other `scripts/ci/*.mjs` that import `typescript` may have the same un-wired status — worth an audit.
