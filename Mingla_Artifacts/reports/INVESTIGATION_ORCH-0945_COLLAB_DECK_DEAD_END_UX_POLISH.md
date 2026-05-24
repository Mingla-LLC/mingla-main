# INVESTIGATION — ORCH-0945 [Collab deck dead-end UX polish]

**Investigator:** Claude `mingla-forensics` (INVESTIGATE mode)
**Date:** 2026-05-23
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATE_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH.md`
**Mode:** Design/data-flow investigation (not bug reproduction — the dead-end UI works today; we're inventorying the polish surface)

---

## Symptom summary (the polish opportunity)

Today's collab deck dead-end state collapses 5 distinct server-returned reasons into 2 client messages, surfaces no participant names, surfaces no diagnostic detail, and offers a single "Shift preferences" CTA that opens YOUR prefs regardless of which participant actually needs to change something. The polish target: per-reason copy, full-first-name diagnostic detail, and a primary CTA that auto-posts a structured banner into the group chat. Operator-confirmed scope locked at INTAKE.

---

## Investigation manifest (files read, in trace order)

| File | Layer | Read for |
|---|---|---|
| [SwipeableCards.tsx:1883-1942](app-mobile/src/components/SwipeableCards.tsx#L1883-L1942) | Component | Current dead-end render branch — 2 message paths, 1 CTA |
| [discover-cards/index.ts:639-644](supabase/functions/discover-cards/index.ts#L639-L644) | Edge function | The 5 `PositionalDeadEndReason` values |
| [discover-cards/index.ts:741-774](supabase/functions/discover-cards/index.ts#L741-L774) | Edge function | `deadEnd()` response shape — what server actually returns |
| [discover-cards/index.ts:978-1042, 1090-1099, 1507-1509, 1546, 1628-1630](supabase/functions/discover-cards/index.ts) | Edge function | Per-reason trigger conditions |
| [deckService.ts:856-877](app-mobile/src/services/deckService.ts#L856-L877) | Service | Client-side parsing of dead-end response → THE DATA CHOKE POINT |
| [RecommendationsContext.tsx:803, 1915-1917](app-mobile/src/contexts/RecommendationsContext.tsx#L1915-L1917) | Context | Propagation of `curatedEmptyReason` → `collabDeckDeadEndReason` |
| [useBoardSession.ts:100-160](app-mobile/src/hooks/useBoardSession.ts#L100-L160) | Hook | Participant data shape — names, prefs (first_name, travel_mode, travel_time, location) |
| [MessageBubble.tsx:136-150, 318-328](app-mobile/src/components/discussion/MessageBubble.tsx#L136-L150) | Component | Existing system-message banner render — text-only, NULL sender |
| [migrations/20260505000000_baseline_squash_orch_0729.sql:8426-8438](supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L8426-L8438) | Schema | `messages.message_type` CHECK constraint — locks banner shape options |

---

## Five-layer cross-check

| Layer | Finding |
|---|---|
| **Docs** | `Mingla_Artifacts/PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` Contract 5 forbids backend changes in collab-sheet work. ORCH-0945 inherits that constraint. |
| **Schema** | `messages.message_type` CHECK constraint allows `'text' \| 'image' \| 'video' \| 'file' \| 'card'`. Existing system messages ride `'text'` + NULL `user_id`. No structured-banner type exists. |
| **Code** | Server returns 5 distinct reasons + `acceptedCount` + `pending_gps_user_ids` + `detail` string. Client drops everything except `reason`. UI uses `reason` to switch between 2 copy variants. |
| **Runtime** | Sim repro deferred — design/data-flow investigation, not bug repro. The dead-end UI renders correctly today; the issue is what it RENDERS, not whether it renders. |
| **Data** | `collaboration_sessions.participant_prefs` (JSONB keyed by user_id) carries `travel_mode`, `travel_constraint_value`, `custom_lat`, `custom_lng`, `custom_location`, `use_gps_location` per participant. `session_participants.profiles.first_name` carries names. Both reach client today via `useBoardSession`. |

No layer contradiction. Polish is greenfield client-side work; data needed for diagnostic copy already lives on the client.

---

## Findings

### 🔴 Root cause (the polish-blocking finding) — client drops 95% of dead-end response on the floor

**File + line:** [deckService.ts:856-877](app-mobile/src/services/deckService.ts#L856-L877)

**Exact code:**
```ts
const deadEndReason =
  data?.dead_end === true && typeof data?.reason === 'string'
    ? data.reason
    : undefined;
// ...
return {
  cards,
  deckMode: 'mixed',
  activePills: [],
  total: cards.length,
  hasMore: false,
  serverPath,
  curatedEmptyReason: deadEndReason as any,
};
```

**What it does:** Reads `data.reason` only. Discards `data.acceptedCount`, `data.pending_gps_user_ids`, `data.detail`, `data.position`, `data.current_position`, and the full `sourceBreakdown` block.

**What it should do:** Surface enough of the dead-end response for the UI to render diagnostic copy. Minimum: `reason`, `acceptedCount`, `pendingGpsUserIds`. Optionally: `detail` (server-side debug string, e.g. "No participant has any category or intent selected").

**Causal chain:** Server emits rich dead-end response → service parses reason only → context only exposes `collabDeckDeadEndReason` (one string) → component has no diagnostic data to render → UI falls back to generic abstract copy → user is stuck.

**Verification step:** Grep `RecommendationsContext.tsx` for `pending_gps_user_ids` or `acceptedCount` from the deck response — no matches. The data is server-side only.

---

### 🟠 Contributing factor — server response withholds per-participant reach circles

**File + line:** [discover-cards/index.ts:741-774](supabase/functions/discover-cards/index.ts#L741-L774)

**Exact code:** The `deadEnd()` helper returns `acceptedCount` and `pending_gps_user_ids` but NOT the `agg.circles` array (which contains per-participant `{ lat, lon, travel_mode, time_min, radius_m }`).

**What it does:** Tells the client WHO has accepted but NOT how big their reach is.

**What it should do for ORCH-0945:** Either include `circles` in the dead-end response, OR have the client compute reach diagnostics directly from `participant_prefs` (which it already has via `useBoardSession`).

**Causal chain:** For `intersection_empty` specifically ("Marcus walking 15min from Bushwick"), the client must know each participant's mode + time + location. The mode + time + lat/lng are already in `participant_prefs`. The location LABEL ("Bushwick") is the human-readable form of lat/lng — needs geocoding OR comes from `custom_location` text field.

**Verification step:** `useBoardSession.ts:155-159` shows `allPrefs` is exposed to the client with full participant_prefs payload. The client CAN compute diagnostic strings without a server-side change. **This means Contract 5 (no backend changes) is satisfiable.**

---

### 🟡 Hidden flaw — the banner schema CANNOT carry a deep-link

**File + line:** [migrations/20260505000000_baseline_squash_orch_0729.sql:8426-8438](supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L8426-L8438) + [MessageBubble.tsx:142-150](app-mobile/src/components/discussion/MessageBubble.tsx#L142-L150)

**Exact code:**
```sql
"message_type" character varying(20) DEFAULT 'text'::character varying,
CONSTRAINT "messages_message_type_check" CHECK (
  ("message_type")::"text" = ANY (ARRAY['text', 'image', 'video', 'file', 'card'])
)
```
```tsx
// MessageBubble.tsx — system-message branch
if (message.user_id === null || message.user_id === undefined) {
  return (
    <View style={systemRowStyles.systemMessageRow} ...>
      <Text style={systemRowStyles.systemMessageText} numberOfLines={3}>
        {message.content}
      </Text>
    </View>
  );
}
```

**What it does:** System messages today are `message_type='text'` + NULL sender + plain string content. Rendered as a centered muted row with no tap handler, no structured payload, no deep-link.

**What it should do for ORCH-0945:** To support a tappable "Tap to open Marcus's travel settings →" affordance inside the banner, EITHER:
- (A) Extend `MessageBubble` system-message branch to parse a magic-token pattern from plain text content (e.g. `[[open-travel:user_id]]`) and render an inline tap target. Plain-text fallback if the token isn't recognized. NO schema change. NO Contract 5 violation.
- (B) Add a new `message_type='system_banner'` + structured `banner_payload jsonb` column → schema migration → violates Contract 5.

**Causal chain:** Operator picked auto-post structured banner with deep-link. Without a schema change, option A (magic token in text content) is the only path. Workable but uglier than a structured payload.

**Recommendation for SPEC:** Option A. Tokenized text content with deep-link parsing in `MessageBubble`. Acceptable compromise — keeps Contract 5 intact, ships the UX.

---

### 🟡 Hidden flaw — `intersection_empty` is reachable via 2 different server paths with identical reason

**File + line:** [discover-cards/index.ts:1019-1026](supabase/functions/discover-cards/index.ts#L1019-L1026) + the aggregator that sets `agg.intersection_empty`

**What it does:** Server returns `reason: 'intersection_empty'` only when participant travel circles literally don't geographically overlap. Other "no candidates" scenarios (categories don't match, date windows misaligned per future hybrid INTERSECTION work) collapse to `no_matching_candidates` instead. **Today: clean separation.**

**What it should do for ORCH-0945:** Per-reason copy must distinguish geographic non-overlap from category/intent emptiness from quorum failure from pool exhaustion. The 5 reasons are crisp; the dispatch can rely on them.

**Causal chain:** None — this is a confirmation that the 5 reasons are real and disjoint, not collapsible.

**Verification step:** Reasons emit at distinct call sites (lines 978, 1011, 1020, 1036, 1090-1099, 1507-1509, 1628-1630). Each branch is reachable.

---

### 🔵 Observation — participant name + per-participant reach data is fully on client

| Diagnostic field | Source on client | Status |
|---|---|---|
| Full first name | `session.participants[i].profiles.first_name` via `useBoardSession.ts:112-120` | ✅ Available |
| Travel mode (walk/drive/transit) | `participantPrefs[user_id].travel_mode` via `useBoardSession.ts:154-159` | ✅ Available |
| Travel time (min) | `participantPrefs[user_id].travel_constraint_value` | ✅ Available |
| Custom location text | `participantPrefs[user_id].custom_location` | ✅ Available (text label) |
| Lat/lng | `participantPrefs[user_id].custom_lat/lng` | ✅ Available |
| `use_gps_location` flag | `participantPrefs[user_id].use_gps_location` | ✅ Available |
| Accepted count | `data.acceptedCount` from deadEnd response | ⚠ **Currently dropped at service layer** (Root cause finding above) |
| Pending GPS user IDs | `data.pending_gps_user_ids` | ⚠ **Currently dropped at service layer** |

**Implication:** All 5 reasons can render rich diagnostic copy after the service-layer fix (root cause finding). No data is unreachable.

---

### 🔵 Observation — debouncing dedupe for "Seth flagged this again" is greenfield

No existing debounce logic in the discussion service for system messages. The 5-minute collapse rule operator asked for is a new client-side concern, implementable in the banner-post helper without schema or RPC changes.

---

## Per-reason data matrix (the deliverable)

| Reason | Server trigger | What client knows TODAY | What polish needs | Blocker? |
|---|---|---|---|---|
| `intersection_empty` | `agg.intersection_empty === true` ([index.ts:1019](supabase/functions/discover-cards/index.ts#L1019)) | reason string only | Each participant's first_name + mode + travel_time + location label | No — all on client already, just needs to be pulled from `useBoardSession` |
| `no_matching_candidates` | (a) no GPS-bearing participants ([:1011](supabase/functions/discover-cards/index.ts#L1011)), (b) no categories AND no intents picked ([:1036](supabase/functions/discover-cards/index.ts#L1036)) | reason string only | Need to distinguish (a) vs (b). Server's `detail` string differs but is dropped. | **Minor** — surface `detail` through service layer OR have client recompute by inspecting `participant_prefs` (categories + intents) and `circles` (GPS coverage) |
| `no_unswiped_candidates` | After fallbackToCurated exhaustion ([:1090](supabase/functions/discover-cards/index.ts#L1090)) | reason string only | First name(s) of who swiped what. Currently the client has `session_swiped_cards` per-user — can compute. | No — derivable client-side |
| `quorum_not_met` | `acceptedCount < 2` ([:978](supabase/functions/discover-cards/index.ts#L978)) | reason string + acceptedCount IF service fix lands | "Waiting for X others to accept" — needs accepted count + invited count. Invited count is client-side via `session.participants.length`. | No after service fix |
| `all_pools_exhausted` | Genuinely no more candidates from any pool ([:1507](supabase/functions/discover-cards/index.ts#L1507) + [:1628](supabase/functions/discover-cards/index.ts#L1628)) | reason string only | Total cards seen this session, days remaining in date window, suggestion to widen dates. | No — derivable client-side via `sessionSwipedCards.length` |

---

## ORCH-0918 banner reuse assessment

**Verdict:** Reuse existing system-message infrastructure (NOT a new structured message type).

**Reasoning:**
- Existing system messages live at `message_type='text'` + NULL `user_id` + plain string content. Detected client-side in `MessageBubble.tsx:142`.
- Adding a new `message_type` value requires altering the CHECK constraint → schema migration → violates Contract 5.
- Plain-text content can carry diagnostic copy directly (e.g. "Seth flagged a reach problem. Marcus: walking 15min from Bushwick. Seth: driving 30min from DC. Priya: transit 30min from Williamsburg.").
- Deep-link affordance via inline magic-token (e.g. `[[open-travel:abc-123-def]]`) parsed by `MessageBubble` — additive client code, no schema change.

**Cost:** ~30 lines in `MessageBubble.tsx` to parse and render the magic-token link. ~50 lines in a new `collabDeadEndBannerService.ts` to compose + insert + debounce.

---

## Fix strategy (direction for SPEC — not a spec itself)

1. **Service-layer expansion:** Extend `deckService.collab-v2` return shape to surface `acceptedCount` + `pendingGpsUserIds` + `detail` alongside `curatedEmptyReason`. New type: `CollabDeadEndPayload`.
2. **Context propagation:** Add `collabDeadEndPayload` to `RecommendationsContext` alongside existing `collabDeckDeadEndReason`.
3. **Per-reason copy:** Replace the 2-branch ternary in `SwipeableCards.tsx:1888-1942` with a `renderDeadEnd(reason, payload, participants, participantPrefs)` helper that switches on all 5 reasons.
4. **Diagnostic strings:** Each participant row computed client-side from `useBoardSession.allParticipantPreferences` joined with `session.participants[].profiles.first_name`. No server change.
5. **Auto-post banner:** New helper `postCollabDeadEndBanner(sessionId, reason, payload)` inserts a system message into the session's discussion. Plain text content with magic-token deep-link.
6. **MessageBubble extension:** Parse magic tokens inside system-message text content; render as inline tap target. Falls back to plain text if token unrecognized.
7. **Debounce:** Client-side 5-minute window per (session, user, reason) tuple. Same banner from same user within window → no new insert OR short "re-flag" variant.
8. **Outline visual treatment:** Keep current dead-end card centered icon + title + subtitle pattern. Add a third row above "Shift preferences" CTA: "Notify the group" → auto-posts banner.

---

## Per-reason link-routing contract (added 2026-05-23 by operator clarification)

**Magic-token vocabulary:**

| Token | Behavior when tapped by current user |
|---|---|
| `[[open-prefs:travel:USER_ID]]` | If `USER_ID === current user` → opens own PreferencesSheet focused on travel section, editable. Else → opens read-only view of `USER_ID`'s travel section. |
| `[[open-prefs:location:USER_ID]]` | Same routing pattern, focused on location section. |
| `[[open-prefs:categories:USER_ID]]` | Same routing pattern, focused on categories section. |
| `[[open-prefs:dates:USER_ID]]` | Same routing pattern, focused on date-window section. |
| `[[open-prefs:self:SECTION]]` | Opens own PreferencesSheet focused on `SECTION` regardless of who taps. Used when no single participant owns the problem. |
| `[[open-dismissed]]` | Opens own dismissed-cards sheet (existing surface, no new prop needed). |
| `[[compose-mention:USER_ID:TEXT]]` | Opens chat composer pre-filled with `@USER_ID TEXT`. Used for quorum_not_met where pending participant has no settings yet. |

**Per-reason banner composition + token routing:**

| Reason | Outlier detection | Banner body (plain text + tokens) | Behavior summary |
|---|---|---|---|
| `intersection_empty` (1 outlier) | `circles` analysis on client: 1 participant's circle doesn't overlap with majority | `"Marcus is too far from the group.\nMarcus: walking 15min from Bushwick · Seth: driving 30min from DC · Priya: transit 30min from Williamsburg.\n[[open-prefs:travel:marcus-uid]]"` | Marcus tap → edits own travel. Others tap → read-only view of Marcus's travel. |
| `intersection_empty` (multi-outlier / nobody overlaps) | No single outlier — circles pairwise disjoint | `"No location overlap yet.\n[[open-prefs:location:seth-uid]] in DC · [[open-prefs:location:priya-uid]] in LA · [[open-prefs:location:marcus-uid]] in Queens.\nSomeone needs to widen travel or change location."` | Each name is its own token. Self → editable. Others → read-only. |
| `no_matching_candidates` — GPS gap | Server `detail` says "No GPS-bearing participants" OR client sees ≥1 participant with `use_gps_location !== true` AND no `custom_lat/lng` | `"Waiting for Marcus to share location.\n[[open-prefs:location:marcus-uid]]"` | Marcus → edits own location. Others → read-only "Waiting for Marcus's location" pane. |
| `no_matching_candidates` — no categories anywhere | All participants have empty `categories` AND empty `intents` arrays | `"Nobody has picked categories yet. [[open-prefs:self:categories]]"` | Everyone → opens own categories section, editable. |
| `no_unswiped_candidates` | Always group-wide | `"You've all seen everything for now. [[open-dismissed]]"` | Everyone → own dismissed-cards sheet. |
| `quorum_not_met` | Server returns `acceptedCount < 2`. Client computes `session.participants.filter(p => !p.has_accepted)` to identify pending. | `"Waiting for 1 more to accept. Pending: Tunde. [[compose-mention:tunde-uid:can you tap accept?]]"` | Tapper → composer pre-filled with @Tunde mention. **Exception to auto-post-then-deep-link pattern**: this reason posts the banner AND offers a composer pre-fill rather than a settings deep-link, because pending participant hasn't joined yet so has no settings surface. |
| `all_pools_exhausted` | Always group-wide | `"You've exhausted today's options. Try next weekend? [[open-prefs:self:dates]]"` | Everyone → opens own date-window section, editable. |

**Read-only view of another participant's prefs — new mode for PreferencesSheet:**

The "read-only view of Marcus's prefs" is a new capability `PreferencesSheet` does not have today. Required additions:

| Prop | Type | Purpose |
|---|---|---|
| `viewParticipantId?` | `string` | When provided, sheet loads that user's prefs from `session.participant_prefs[viewParticipantId]` instead of current user's. All edit controls hidden/disabled. Save button removed. Header text: "Marcus's picks (read-only)". |
| `initialFocusSection?` | `'travel' \| 'location' \| 'categories' \| 'dates'` | When provided, sheet scrolls to + visually highlights that section on mount. Used by all 7 token types. |

Both props are additive — default behavior unchanged when undefined.

**Privacy invariant:** the sheet in `viewParticipantId` mode must NEVER call `upsert_participant_prefs` with the viewed user's ID. New invariant `I-PROPOSED-PREFS-SHEET-READ-ONLY-NO-WRITE` enforces this at SPEC time.

**Multi-tap behavior:** if a banner has multiple inline tokens (e.g. `intersection_empty` multi-outlier with 3 name links), each is independently tappable. Tapping one token closes the chat thread briefly to mount the sheet, sheet's close handler returns to chat at the same scroll position.

---

## Regression prevention requirements

- **Test 1 (happy path per reason):** For each of the 5 reasons, render `SwipeableCards` dead-end with mock context and verify per-reason title + diagnostic string + 2-CTA layout.
- **Test 2 (auto-post mechanic):** Tapping primary CTA inserts exactly one system message into discussion; second tap within 5min inserts zero OR a short "re-flagged" variant.
- **Test 3 (deep-link parse):** `MessageBubble` system-message branch parses `[[open-travel:USER_ID]]` correctly; falls back to literal text on bad token.
- **Test 4 (Contract 5 invariant):** Strict-grep gate — no `messages.message_type` value other than the 5 allowed; no new column on `messages` table; no new migration touching discussion schema in this ORCH.
- **Fails-on-revert:** At least 1 test per the implementor-pattern with `[FAILS-ON-REVERT KEY]` marker (e.g. assert that `intersection_empty` renders "are too far apart" copy AND names at least one participant).

---

## Blast radius

| Surface | Affected? | Why |
|---|---|---|
| iOS consumer | ✅ Yes | Polish target |
| Android consumer | ✅ Yes | Polish target — parity automatic (shared `app-mobile/`) |
| Buyer/anon web | ❌ No | No collab decks on buyer web |
| Business iOS/Android/Web | ❌ No | Not a business surface |
| Admin web | ❌ No | No admin equivalent |
| Solo deck (Home) | ❌ No | Solo deck doesn't use `collabDeckDeadEndReason` — `isBoardSession` gate at [SwipeableCards.tsx:1886](app-mobile/src/components/SwipeableCards.tsx#L1886) |
| Group chat message bubble | ✅ Yes | `MessageBubble.tsx` system-message branch extended with token parser |
| Other system messages (round-start, etc.) | ⚠ Indirect | Token parser must fall back cleanly when token is absent — existing system messages unchanged |

---

## Invariant violations

None — the dead-end UI is design debt, not an invariant violation.

**New invariants to register at SPEC time:**
- `I-PROPOSED-DEAD-END-REASON-COVERAGE`: every value of `PositionalDeadEndReason` must have a dedicated render branch in `SwipeableCards` dead-end (no fall-through to generic copy).
- `I-PROPOSED-COLLAB-DEAD-END-PAYLOAD-PROPAGATED`: service layer must surface `acceptedCount` + `pendingGpsUserIds` from dead-end responses (regression guard against future "reason only" reversions).

---

## Discoveries for orchestrator

1. **Deep-link via magic token is a hack, not a clean banner type.** Worth a future ORCH ("extend message schema for structured system banners") that's allowed to amend Contract 5 in a scoped way. Out of scope for ORCH-0945 — current proposal works without it.
2. **`no_matching_candidates` has 2 distinct meanings** (no GPS vs no categories/intents). Server's `detail` string differentiates; if implementor doesn't surface `detail`, copy must distinguish via client-side inspection of participant_prefs.
3. **Banner debounce key (5-minute window per session+user+reason) is new infra.** Not used elsewhere in the codebase. If the same pattern is needed for other "flag the group" banners in the future, factor into a generic helper at IMPLEMENT time.
4. **Sim repro deferred.** Phase 0.A live-fire gate doesn't apply to this investigation because the dead-end UI renders correctly today — we're not investigating a runtime bug, we're inventorying a data-flow gap for a polish dispatch. Confidence ceiling on findings: `proven` for data-flow + schema findings (six-field evidence), `suspected` for any UX feel of the proposed copy (will need sim repro at TEST time).
5. **ORCH-0918 banner reuse path is clean** — no new infra needed, just an extension of the existing `MessageBubble` system-message branch.

---

## Confidence

**Confidence:** **High (proven)** for data-flow + schema findings — six-field evidence on the root cause (service-layer drops payload), schema CHECK constraint verbatim, every file:line cited and verified. **Medium (suspected)** for UX-effectiveness predictions of the proposed copy — only TEST mode on real sim with real participants will confirm whether the diagnostic strings actually unblock groups vs. confuse them.

**Ready for SPEC:** Yes.

---

## Next-handoff

NEXT HANDOFF — paste into Claude `mingla-forensics` (SPEC mode):

Write the SPEC for ORCH-0945 [Collab deck dead-end UX polish] consuming this investigation report at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH.md`. The polish is locked: per-reason copy for all 5 `PositionalDeadEndReason` values, full-first-name diagnostic detail, auto-post structured chat banner with magic-token deep-link, secondary "Shift preferences" CTA preserved, 5-minute debounce, no auto-suggest, no backend changes (Contract 5 of `Mingla_Artifacts/PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` holds), Cross-Surface Impact = iOS-consumer + Android-consumer only. Honor the 8 fix-strategy steps in the investigation §Fix Strategy verbatim — they're the implementor-actionable shape. Produce `Mingla_Artifacts/specs/SPEC_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH.md` with the standard SPEC template including Phase 2.5 Cross-Surface Impact, numbered success criteria SC-01..SC-N, test cases per reason, and the 2 new invariants (`I-PROPOSED-DEAD-END-REASON-COVERAGE` + `I-PROPOSED-COLLAB-DEAD-END-PAYLOAD-PROPAGATED`). The next dispatch after SPEC will be Codex `implementor-mingla` or Claude `mingla-implementor` for IMPLEMENT, then Claude `mingla-tester` for TEST, then orchestrator CLOSE.

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
