# SPEC — ORCH-1058B [Collab "Notify the group" dead-end message: intrinsic system marker + participant·City/ST chips + tappable prefs button]

**Mode:** SPEC (contract only — no production code in this file)
**Date:** 2026-06-02
**Skill:** mingla-forensics (Claude)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1058-[collab-deck-empty-intersection-replay]/` on branch `ORCH-1058-collab-deck-empty-intersection-replay`
**Source investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1058B_NOTIFY_GROUP_SYSTEM_MESSAGE_PIPELINE.md` (committed `60e336b40`)
**Design predecessor:** `Mingla_Artifacts/specs/DESIGN_ORCH-1058_COLLAB_LOCATION_CHIPS.md`
**Merges with:** the 6 unmerged ORCH-1058 commits on this branch (copy matrix + allowlist + GPS-resolved City/ST resolver + deck chips). This SPEC converges with them into ONE PR to main.

---

## Layman summary

When a collab group's deck empties because everyone's in different cities, the app posts a "notify the group" message in the chat. Today that message can render as a plain text bubble from a person, with raw computer code (`[[open-prefs:location:…]]`) showing instead of a tappable button — because whether it renders as a special "system notice" depends on the *receiving* phone recognizing the *exact wording*, and the wording differs between app builds. This spec makes the message a system notice by an intrinsic, wording-independent marker (so it can never regress across builds), shows each participant's city as a chip inside the message (e.g. "Seth · Raleigh, NC", "Ava · Miami, FL"), and turns the prefs link into a real tappable button. Older app builds that don't understand the new format degrade to clean readable prose — never raw codes.

---

## §0 — Ingested context (Phase 0/1)

- **COMMS_LEDGER read on entry.** No `BLOCK`/`WARN`/`FYI` row is addressed to `mingla-forensics`, to `ORCH-1058`, or to `ALL` in a way that bears on collab chat rendering. The OPEN `ALL` WARNs (COMMS-0003 external-API doc citation, COMMS-0004 INTAKE numbering, COMMS-0012/0013/0015/0016 migration/pricing/deploy) do not touch this surface. COMMS-0003 is N/A here — this ORCH introduces **no external API** (no Stripe/OneSignal/Places/etc.); it is a Supabase-internal RPC + RLS + RN-render change. Nothing to ack; no new cross-ORCH discovery to write (scope is localized to collab chat presentation already owned by ORCH-1058).
- **Investigation is complete and PROVEN** (HIGH confidence): RC-1 (symptoms 1+3 = cross-build allowlist mismatch; system-ness is content-coupled), RC-2 (symptom 2 = chips were never built for the chat surface), CF-1 (copy↔allowlist are two hand-maintained mirrors that must ship together), HF-1 (AsyncStorage cache can flash a pre-fix `isSystem`).
- **Live DB facts verified this turn** (grounding the DB layer):
  - `public.messages.sender_id` is **nullable** (`is_nullable=YES`) — a null-sender row is schema-legal.
  - `public.messages.message_type` is `varchar` defaulting to `'text'` with **no CHECK constraint** — `'system'` is insertable without a constraint change.
  - There is **no generic metadata/jsonb column** for system payloads. `card_payload jsonb` exists but is card-specific; `mentions`/`card_tags` are `jsonb NOT NULL DEFAULT '[]'`.
  - **All three `messages` INSERT RLS policies require `sender_id = auth.uid()`** (`"Users can send messages…"`, `messages_brand_team_member_insert`) or a participant check (`messages_broadcast_only_enforcement` → `can_insert_message_into_conversation`). A direct client `INSERT` with `sender_id = NULL` **fails** every `WITH CHECK` — confirming the investigation's RLS note. A null-sender system row therefore MUST be inserted via a `SECURITY DEFINER` RPC.
  - **Precedent exists:** ORCH-0908's `rpc_admin_lock_and_schedule_card` (migration `20260629000000_orch_0908_combined_lock_schedule.sql`, `SECURITY DEFINER`) already inserts chat messages server-side, and ORCH-0908's design comments document the `sender_id = NULL` → system-message path ("Deleted user"). This spec follows that established pattern.
- **Render gate confirmed in code:** `messagingService.ts:1433` & `:1449` — `isSystem: message.sender_id === null || isCollabDeadEndBannerMessage(message.content)`. The `sender_id === null` short-circuit already forces `isSystem=true` independent of prose. The allowlist (`COLLAB_DEAD_END_BANNER_PATTERNS`, `:175-194`) is the fragile content-coupled half.

---

## §1 — The architectural decision (the crux) + justification

### Decision: **Option A — intrinsic `message_type:'system'` + structured `card_payload` JSON, inserted via a `SECURITY DEFINER` RPC.** 🔒 LOCKED

A collab dead-end banner is posted as a row with:
- `message_type = 'system'` (intrinsic, content-independent marker — the recognizer keys on this, never on prose), **and**
- a structured JSON payload in the existing `card_payload jsonb` column (no schema column add) carrying `{ kind:'collab_dead_end', reason, version, participants:[{id,name,label,locationKind,a11yLabel}], action:{type:'open-prefs'|'open-prefs-self'|'open-dismissed'|'compose-mention', section?, userId?, text?}, prose }` so the renderer builds chips + button **from data, not parsed prose**, and
- `sender_id = NULL` (true system row — also forces `isSystem=true` at `messagingService.ts:1433/:1449` even on builds that never learned `message_type:'system'`), inserted by a new `SECURITY DEFINER` RPC `rpc_post_collab_dead_end_banner(...)` that performs the participant-authorization check the RLS would otherwise enforce.

This is a **hybrid that takes the strongest half of each investigated option**: Option B's null-sender (which already short-circuits the gate and is the cheapest intrinsic marker) PLUS Option A's structured payload (which is what actually lets the renderer draw chips + a button from data). We adopt BOTH, behind ONE RPC.

### Why this over the alternatives (candidate options weighed + the non-chosen disproven):

1. **Pure prose-allowlist (status quo) — REJECTED.** Proven fragile across builds (RC-1). System-ness must not depend on the receiver recognizing future-changeable copy. Eliminated by the investigation.
2. **`message_type:'system'` ALONE, non-null sender — REJECTED as insufficient.** It decouples system-ness from prose for builds that learn the new type, BUT a build that predates `message_type:'system'` falls back to the prose allowlist (RC-1 reopens) AND a non-null sender still renders a sender name on the system branch is avoided only by the isSystem flag. Worse, it does not by itself satisfy the gate on old builds.
3. **Null-sender ALONE (Option B, no structured payload) — REJECTED as insufficient for the outcome.** Null-sender fixes RC-1 robustly (the `:1433` short-circuit is already shipped on main, so even OLD builds render a null-sender row as a system banner — this is the key backward-compat lever). But with only a prose string it cannot deliver chips (RC-2). The renderer would still parse prose.
4. **New dedicated `chat_metadata jsonb` column (Option A variant) — REJECTED on cost.** A new column needs its own migration + backfill-null default + every read path widened. `card_payload jsonb` already exists, already flows end-to-end through `enrichMessage` → `transformMessage` → `MessageBubble` (it's how ORCH-0667/0908 cards render), and is unused for `message_type='system'` rows. Reusing it is zero-schema-add and rides the proven card pipeline.

### Why the chosen hybrid wins all four lenses:
- **Robust across builds (RC-1):** `sender_id=NULL` makes EVERY build (including today's shipped main) render the row as a system banner via the already-shipped `:1433` short-circuit — no allowlist match required. This is the single most important property and the reason null-sender is non-negotiable in the design.
- **Chips from data (RC-2):** the `card_payload` JSON carries the ordered participant array with resolved labels, so the renderer maps data → `CollabLocationChips`, never parses prose.
- **Doesn't fight RLS:** the `SECURITY DEFINER` RPC is the sanctioned way to write a null-sender row; mirrors ORCH-0908.
- **Backward-compat degrade (never raw codes):** see §6.

---

## §2 — Scope / Non-goals / Assumptions

### In scope 🔒
1. New `SECURITY DEFINER` RPC to post a collab dead-end banner as a `sender_id=NULL`, `message_type='system'` row with a structured `card_payload` JSON payload (authorization check inside the RPC).
2. Rewrite of the poster `collabDeadEndBannerService.ts` to call the RPC with structured data instead of a direct `messages` insert of a prose string.
3. A new system-banner renderer branch in `MessageBubble.tsx` (and its data plumbing through `messagingService.enrichMessage`/`enrichMessageRealtime`, `ConnectionsPage.transformMessage`, `MessageInterface`) that, when the `card_payload` is a `collab_dead_end` payload, renders: a prose line + a participant·City/ST **chip row** (reusing `CollabLocationChips`) + a **tappable prefs button**.
4. Backward-compatible degrade for older builds (prose, never raw tokens).
5. Merge convergence with the 6 unmerged ORCH-1058 commits (copy matrix, GPS-resolved City/ST resolver, deck chips, allowlist) into one PR.
6. The previously-referenced-but-absent parity test (`orch-1058-banner-allowlist-parity.mjs`) becomes the regression suite in §10 (the comment at `messagingService.ts:171-172` references it but it does not yet exist on disk).

### Non-goals 🔒
- **The GPS implausible-jump debounce** (the flap that triggers the empty window) — explicitly a separate ORCH (predecessor Discovery #1). This spec is presentation-only.
- **The collab deck determinism/geometry contract** — untouched (presentation only; predecessor + no-diff proof).
- **Web / Business / Admin** — collab decks are consumer-app-only; no analog (see §3 Cross-Surface).
- **Other system-message producers** (ORCH-0908 lock/schedule cards) — out of scope; they keep their existing non-null `card`-type path. This spec only adds the `collab_dead_end` payload kind.
- **Migrating already-persisted OLD banner rows** (the ones in conversation `3ecffa59`) — they stay as-is; no backfill. Going forward only.

### Assumptions
- `card_payload jsonb` may carry a non-card object for `message_type='system'` rows without breaking existing card-render code, because the card path is gated on `message_type === 'card'` (verify at implement; see §3 Component layer). 🔒 implementor MUST confirm the card render branch does not fire for `message_type='system'`.
- The chat canvas is the dark glass surface (`MessageInterface` bg `rgba(12,14,18,1)`), so `glass.discover.chip` tokens (white-on-translucent) render legibly inside the system row (contrast verified §3.6).

---

## §2.5 — Cross-Surface Impact (MANDATORY)

| # | Surface | Covered? | Behavior / files / parity |
|---|---------|----------|---------------------------|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | ✅ COVERED | Full feature: intrinsic system row + chips + button. Files: `collabDeadEndBannerService.ts`, `messagingService.ts`, `MessageBubble.tsx`, `MessageInterface.tsx`, `ConnectionsPage.tsx`, new migration. Parity with Android is **automatic** (shared RN code) EXCEPT the Android opaque-glass fallback, already handled inside `CollabLocationChips` (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`). |
| 2 | **Consumer Android** (`app-mobile/` Android) | ✅ COVERED | Same shared code. Chip fill uses `g.chip.inactive.fallbackSolid` on Android per existing component. Separate success criterion SC-2-Android (chip opaque fallback renders, no taupe-ring). |
| 3 | **Buyer / anonymous Web** (`mingla-business/`) | ❌ NOT COVERED | Buyer-anon routes do not expose collab chat — no collab deck on web. |
| 4 | **Business iOS** (`mingla-business/`) | ❌ NOT COVERED | No collab-deck analog in business app. |
| 5 | **Business Android** (`mingla-business/`) | ❌ NOT COVERED | Same. |
| 6 | **Admin Web** (`mingla-admin/`) | ❌ NOT COVERED | Admin doesn't render collab chat. |
| 7 | **Business Web preview** | ❌ NOT COVERED | Same as 3/4. |

Parity across iOS/Android is shared-code automatic; the ONLY manual per-platform gate is the chip glass fallback (SC-2-iOS translucent / SC-2-Android opaque). Web is N/A throughout.

---

## §3 — Layer-by-layer contract

### 3.1 Database layer 🔒

**New migration** (name per safe-migration norms; pick the next free timestamp above the current remote max — implementor confirms via `mcp__supabase__list_migrations` before authoring; do NOT reuse a baseline-residue stamp):
`supabase/migrations/<NEXT_TIMESTAMP>_orch_1058b_post_collab_dead_end_banner.sql`

Contents:
1. `CREATE OR REPLACE FUNCTION public.rpc_post_collab_dead_end_banner(p_session_id uuid, p_reason text, p_payload jsonb) RETURNS uuid` — `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public, pg_temp`.
2. **Body contract:**
   - Resolve `v_uid := auth.uid()`; `IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'`.
   - Resolve the group conversation for `p_session_id` (reuse the same lookup `getOrCreateGroupConversationForSession` uses — `conversations.collab_session_id = p_session_id`, or the canonical mapping; implementor confirms the column from the existing service query).
   - **Authorization (replaces the RLS WITH CHECK the null-sender bypasses):** `IF NOT EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = v_conversation_id AND cp.user_id = v_uid) THEN RAISE EXCEPTION 'not a participant';`. This guarantees only an actual participant of that conversation can post the banner, exactly as the regular INSERT RLS would.
   - **Validate `p_reason`** against the known set (`intersection_empty`,`no_matching_candidates`,`no_unswiped_candidates`,`quorum_not_met`,`all_pools_exhausted`); RAISE on unknown.
   - **Validate `p_payload`** has `kind = 'collab_dead_end'` and a non-empty `participants` array; RAISE otherwise (defensive — server is the trust boundary for a `SECURITY DEFINER` insert).
   - `INSERT INTO public.messages (conversation_id, sender_id, content, message_type, card_payload) VALUES (v_conversation_id, NULL, p_payload->>'prose', 'system', p_payload) RETURNING id` — `content` carries the **degrade prose** (see §6) so old builds and notification previews have readable text; the structured object lives in `card_payload`.
   - Return the new message id.
3. `REVOKE ALL ON FUNCTION public.rpc_post_collab_dead_end_banner(uuid, text, jsonb) FROM public;` then `GRANT EXECUTE ... TO authenticated;`
4. `COMMENT ON FUNCTION` documenting ORCH-1058B intent + that it deliberately writes `sender_id=NULL` (system row) which the client gate at `messagingService.ts:1433` renders as a system banner regardless of app version.

**No schema column add. No CHECK-constraint change** (`message_type` has none; `'system'` is already used elsewhere per ORCH-0908/0898 system rows). **No RLS policy change** — the null-sender insert never goes through the table-level INSERT RLS because it is performed by a `SECURITY DEFINER` owner; READ RLS is unchanged and already lets every participant `SELECT` the row.

**Safe-migration adherence:** function-only `CREATE OR REPLACE` + `GRANT` — additive, idempotent, zero data mutation, no lock on `messages`. Reversible (drop function). Per memory `project_migration_history_drift_db_push_unsafe`: apply surgically via Management API + INSERT the version into `schema_migrations` if `db push` is unsafe at deploy time; the implementor/operator follows the documented apply path. Strict-grep backend allowlist: a new file under `supabase/migrations/` may trip the ORCH-0863 C7 `no-new-backend-files` gate (COMMS-0002) — the implementor MUST add the migration + the RPC to the relevant strict-grep allowlist in the SAME commit.

### 3.2 Service layer (poster) 🔒
**File:** `app-mobile/src/services/collabDeadEndBannerService.ts`

- `postCollabDeadEndBanner(input)` (currently `:51-85`): replace the direct `supabase.from('messages').insert({... sender_id: input.currentUserId, message_type:'text' ...})` with a call to the RPC:
  `supabase.rpc('rpc_post_collab_dead_end_banner', { p_session_id: input.sessionId, p_reason: input.reason, p_payload })`.
- The existing **debounce** (`orch_0945_banner_debounce` AsyncStorage key, `:52-61`) is **preserved unchanged** in front of the RPC call.
- The existing **error toast** (`:81-84` "Couldn't post to the chat. Tap to retry.") is preserved; map RPC errors (`not a participant`, `auth required`) to the same toast.
- New exported builder `buildCollabDeadEndBannerPayload(input): CollabDeadEndBannerPayload` that returns the **structured object** (replacing the role of `buildCollabDeadEndBannerContent` as the sole producer):
  - `kind: 'collab_dead_end'`
  - `reason: input.reason`
  - `version: 1` (payload schema version, for forward evolution)
  - `participants: { id, name, label, locationKind, a11yLabel }[]` — **built exactly like the deck side** (`SwipeableCards.tsx:1797-1808`): for each normalized participant, call `resolveParticipantLocationLabel({ prefs: participantPrefs[id], isSelf: id===currentUserId })` → `{ label, kind, a11yLabel }`, and set `a11yLabel: `${name}: ${resolved.a11yLabel}``. This reuses the SAME GPS-resolved City/ST + "Getting a fix…" rules already built (memory: GPS users show resolved City/ST; pending shows "Getting a fix…"). Order = participant order (stable, matches deck).
  - `action`: derived from the reason exactly as the current prose's token is (the single source of truth for the button target):
    - `intersection_empty` single-outlier → `{ type:'open-prefs', section:'travel', userId: outlierId }`
    - `intersection_empty` waiting → `{ type:'open-prefs', section:'location', userId: pendingId }`
    - `intersection_empty` different_cities → `{ type:'open-prefs', section:'location', userId: selfId }`
    - `intersection_empty` same_city_tight → `{ type:'open-prefs', section:'travel', userId: selfId }`
    - `no_matching_candidates` GPS-gap → `{ type:'open-prefs', section:'location', userId: firstPendingId }` (multi-token degrade prose lists all; the button targets the first pending, matching deck behavior)
    - `no_matching_candidates` no-categories → `{ type:'open-prefs-self', section:'categories' }`
    - `no_unswiped_candidates` → `{ type:'open-dismissed' }`
    - `quorum_not_met` → `{ type:'compose-mention', userId: firstPendingId, text:'can you tap accept' }`
    - `all_pools_exhausted` → `{ type:'open-prefs-self', section:'dates' }`
  - `prose: string` — the **degrade text** = the current `buildCollabDeadEndBannerContent(input)` output BUT **with the `[[…]]` token stripped** and replaced with nothing (see §6 for exact rule). `buildCollabDeadEndBannerContent` is **retained and reused** to compute this prose (so the matrix logic stays in one place), then the token is stripped before it goes into `content`/`prose`.
- **Type:** add `export type CollabDeadEndBannerPayload = { kind:'collab_dead_end'; reason: CollabDeadEndReason; version:1; participants: { id:string; name:string; label:string; locationKind: ParticipantLocationKind; a11yLabel:string }[]; action: CollabSystemAction; prose:string }` and `export type CollabSystemAction` mirroring the `CollabSystemToken` union in `MessageBubble.tsx:57-61` (share the type — see §3.4).
- **Error contract:** RPC throws → caught → warning toast; no silent failure (Constitution #3). Return `void` (unchanged signature).

### 3.3 Service layer (recognizer / enrich) 🔒
**File:** `app-mobile/src/services/messagingService.ts`

- `DirectMessage` (the `:140-152` interface) gains an optional `cardPayload?` already present? Confirm it already carries `card_payload`/`cardPayload`; if the system payload must reach the component, ensure `enrichMessage`/`enrichMessageRealtime` pass `card_payload` through (they spread `...message`, so the raw column flows; verify the field name the component reads).
- `enrichMessage` (`:1418-1435`) and `enrichMessageRealtime` (`:1442-1451`): the `isSystem` rule is **kept** (`message.sender_id === null || isCollabDeadEndBannerMessage(message.content)`). The null-sender clause now does the work for the new rows; the allowlist clause remains for backward-compat with any still-prose producer and for the (now-degrade) `content` text. **Add:** also treat `message.message_type === 'system'` as system (belt-and-suspenders: `isSystem: message.sender_id === null || message.message_type === 'system' || isCollabDeadEndBannerMessage(message.content)`). 🔒
- **The `COLLAB_DEAD_END_BANNER_PATTERNS` allowlist (`:175-194`) is RETAINED** (it gates the degrade prose path and any legacy rows). It is **no longer the sole system-ness mechanism** — it is now a fallback. The merge brings in the ORCH-1058 allowlist additions (different_cities/same_city_tight/waiting patterns) so a degrade-prose row from a matched build still parses its (now button-less) prose cleanly. The comment at `:167-174` is updated to state system-ness is primarily `sender_id=NULL`/`message_type='system'`, allowlist is the legacy/degrade fallback.

### 3.4 Component layer (renderer) 🔒
**File:** `app-mobile/src/components/chat/MessageBubble.tsx`

- Extend `MessageData` (`:13-33`) with `systemPayload?: CollabDeadEndBannerPayload` (typed, imported from the service) — populated by the data transform when `card_payload?.kind === 'collab_dead_end'`.
- Share the action type: export `CollabSystemAction = CollabSystemToken` (the existing union at `:57-61`) and import it in the service (§3.2) so poster and renderer agree by construction (kills CF-1's two-mirrors problem for the action).
- **System render branch (`:237-243`)** — when `message.isSystem`:
  - **If `message.systemPayload?.kind === 'collab_dead_end'`** → render a NEW `renderCollabDeadEndBanner(payload, onSystemTokenPress)` (replaces prose-parse for this case):
    1. **Prose line:** `<Text style={chatSystemRowStyles.text}>{payload.prose}</Text>` (centered, italic, gray — existing token).
    2. **Chip row:** `<CollabLocationChips chips={payload.participants.map(p => ({ id:p.id, label: `${p.name} · ${p.label}`, kind:p.locationKind, a11yLabel:p.a11yLabel }))} />`. **Reuse `CollabLocationChips` verbatim** (`app-mobile/src/components/collab/CollabLocationChips.tsx`) — import it into `MessageBubble.tsx` (today it is imported ONLY by `SwipeableCards.tsx`; this adds the second importer). The chip label format is `Name · City, ST` (e.g. "Seth · Raleigh, NC", "Ava · Miami, FL") per the operator requirement; the bullet `•` separates chips (component built-in). GPS → navigate glyph + resolved City/ST; pending → hourglass glyph + "Getting a fix…" (component + resolver built-in).
    3. **Tappable button:** a `<TouchableOpacity>` styled as a button (NOT the inline underlined link) wrapping `getSystemActionLabel(payload.action)` (reuse `getSystemTokenLabel`, `:547-552` — "Open location picks"/"Open travel picks"/etc.), `onPress={() => onSystemTokenPress?.(payload.action)}`, `accessibilityRole="link"`, `testID={`collab-system-token-${payload.action.type}`}`, `disabled={!onSystemTokenPress}`. **No raw `[[…]]` ever appears** because the renderer never parses prose for this branch.
  - **Else (no structured payload — legacy/degrade row)** → keep the EXISTING `renderSystemBannerContent(message.content, onSystemTokenPress)` (`:512`) which parses `[[…]]` tokens into buttons from prose. This is the path a NEW build takes when it receives an OLD prose-only row, and it already strips tokens correctly.
- **Card-branch guard (assumption check):** confirm the `message.type === 'card'` / `card_payload` render branch does NOT fire for `message_type==='system'` rows (the system branch returns early at `:237` before the bubble body, so it should not — implementor verifies the early-return precedes any card render).

**File:** `app-mobile/src/components/MessageInterface.tsx`
- `Message` interface (`:95-115`) gains `systemPayload?: CollabDeadEndBannerPayload`.
- Where `<MessageBubble … isSystem={item.message.isSystem}>` is rendered (`:1573`/`:1640`), pass `systemPayload={item.message.systemPayload}`.
- `handleSystemTokenPress` (`:398-437`) is **unchanged** — it already handles every `CollabSystemToken` variant (`open-prefs`, `open-prefs-self`, `open-dismissed`, `compose-mention`); the structured `action` IS a `CollabSystemToken`, so the existing handler routes it (open the prefs sheet focused on the section/participant, open the dismissed sheet, or compose a mention). This is why the button "just works."

**File:** `app-mobile/src/components/ConnectionsPage.tsx`
- `transformMessage` (`:1541-1564`, `DirectMessage → Message`) currently carries `isSystem: msg.isSystem`. **Add:** `systemPayload: (msg.card_payload && msg.card_payload.kind === 'collab_dead_end') ? msg.card_payload : undefined`. Every load path (cache-first `:1798`, server-refresh `:1808/1838`, realtime `:2274`, optimistic-replace) runs this transform, so the payload reaches every render.

### 3.5 Realtime
- No new channel. The existing `subscribeToConversation` `postgres_changes INSERT` (`:1334`) delivers the null-sender row; `enrichMessageRealtime` flags it system and carries `card_payload`; `transformMessage` maps `systemPayload`. **HF-1 mitigation:** because system-ness is now `sender_id=NULL`/`message_type='system'` (intrinsic, present in the cached row), the AsyncStorage cache-first render no longer depends on the local allowlist matching — the cached row already has the intrinsic marker, so it renders as a system banner immediately (HF-1 resolved as a side-effect of the decoupling).

### 3.6 Visual & UX contract (chips inside the message) 🔒 LOCKED unless noted 🎨

The chat canvas is the dark glass surface (`MessageInterface` bg `rgba(12,14,18,1)`), identical tonal context to the Discover screen the `glass.discover.chip` tokens were designed for — so the chips render legibly with **zero new visual system**.

- **Chip:** reuse `glass.discover.chip` exactly (height 36, radius 18, paddingHorizontal 14, iconLabelGap 6, labelFontSize 14, weight 500). iOS fill `rgba(255,255,255,0.08)` + border `rgba(255,255,255,0.14)` + label `rgba(255,255,255,0.85)`; Android opaque fallback `rgba(28,30,34,1)` (component-driven via `ANDROID_GLASS_USES_OPAQUE_FALLBACK`). **Contrast:** label `rgba(255,255,255,0.85)` on chip fill over `rgba(12,14,18,1)` → effective luminance ≈ white on near-black, ratio ≥ 12:1 (far exceeds 4.5:1). 🔒
- **Chip glyph by kind:** gps → `navigate-outline`, place → `location-outline`, pending → `hourglass-outline` (component built-in, color-independent for a11y). 🔒
- **Chip label text:** `Name · City, ST` — the ` · ` joins name and resolved label; the `•` bullet (component) separates chips. `numberOfLines={1}`, `maxWidth:160` (component). 🔒
- **Prose line:** existing `chatSystemRowStyles.text` — 12pt, `#9ca3af`, italic, centered. On the dark canvas `#9ca3af` (gray-400) ≈ 5.9:1 vs `rgba(12,14,18,1)` → passes ≥4.5:1. 🔒
- **Button:** distinct from the inline link. 🎨 OPEN within this LOCKED floor: implementor designs the button affordance (e.g. a pill using `glass.discover.chip.active` tokens or an outlined pill) — LOCKED requirements: min hit target 44×44 (use `hitSlop` if visually smaller), label from `getSystemTokenLabel` (sentence case, Mingla voice, e.g. "Open location picks"), text contrast ≥4.5:1, visible press feedback that does not shift layout, `accessibilityRole="link"`, `testID`. The primary `#eb7825` brand accent (current link color) is the LOCKED accent for the button text/border. NOT a raw underlined inline link — it must read as a tappable control.
- **Layout / spacing:** system row container `chatSystemRowStyles.row` (centered, paddingH 20, paddingV 10). Order top→bottom: prose line → chip row (`marginTop: spacing.sm` from component) → button (`marginTop: spacing.sm`). Centered. Respects existing chat safe-area (the row sits inside the message list which already insets). 🔒
- **No AI slop:** no gradients, no stock/AI imagery, no emoji icons, no decorative glows beyond the existing token set. Chips + button only. 🔒
- **References examined:** iMessage system rows (centered, chrome-less, tappable inline affordances), WhatsApp group "system" notices (centered gray), Partiful/Lu.ma RSVP-state chip rows, and Mingla's own Discover filter chips (the token donor). The pattern: centered system notice + legible identity chips + one clear action.

**Division of labor:** this functional + acceptance contract is complete for the chips (they reuse a fully-specified existing component). The ONLY open visual element is the button affordance, tagged 🎨 OPEN above with a locked floor. If the orchestrator wants a bespoke button visual beyond the floor, dispatch `mingla-designer` for the button token spec; otherwise the implementor builds to the locked floor. No other UI element is left undefined.

### 3.7 i18n
- The `prose` strings already route through the ORCH-1058 copy matrix (`buildCollabDeadEndBannerContent` + the `cards:collab.deadend.*` i18n keys used on the deck). The button label (`getSystemTokenLabel`) is currently hardcoded English; 🔵 OBSERVATION — out of scope to localize here (matches existing behavior), but flag for a future i18n pass. Chip name·label content is data, not translatable copy.

---

## §4 — Success criteria (observable, testable, unambiguous)

- **SC-1 (intrinsic system-ness, cross-build):** A banner posted by the new poster renders as a centered chrome-less system row on BOTH (a) a build with the new renderer AND (b) the current shipped main build — because the row is `sender_id=NULL` and `messagingService.ts:1433` short-circuits `isSystem=true` regardless of prose. Verifiable: insert a `sender_id=NULL, message_type='system'` row; assert `enrichMessage` returns `isSystem=true` with the allowlist DELETED.
- **SC-2-iOS:** On iOS, the message shows one chip per participant as `Name · City, ST` (e.g. "Seth · Raleigh, NC", "Ava · Miami, FL"), translucent glass fill, white label.
- **SC-2-Android:** On Android, the same chips render with the opaque fallback fill (`rgba(28,30,34,1)`), no taupe ring, no over-transparent blur.
- **SC-3 (GPS/pending rules):** A GPS participant with a resolved fix shows their City/ST chip; a GPS participant with no fix yet shows "Getting a fix…" with the hourglass glyph. (Reuses `resolveParticipantLocationLabel`.)
- **SC-4 (tappable button, no raw token):** The prefs affordance renders as a tappable button labeled e.g. "Open location picks"; tapping it fires `handleSystemTokenPress` and opens the prefs sheet focused on the right section/participant. The string `[[open-prefs` NEVER appears as visible text in any state.
- **SC-5 (backward-compat degrade):** An OLD shipped build receiving the new row renders a clean centered system notice with readable prose and NO raw `[[…]]` token (because `content` is the token-stripped degrade prose and the row is system via null-sender). A NEW build receiving an OLD prose row renders via `renderSystemBannerContent` with the token parsed into a button (existing path).
- **SC-6 (button target correctness):** For each reason, the button action matches the §3.2 action table (e.g. different_cities → open self location prefs; single-outlier → open the outlier's travel prefs).
- **SC-7 (authorization):** A user who is NOT a participant of the conversation cannot post a banner — `rpc_post_collab_dead_end_banner` raises `not a participant`.
- **SC-8 (debounce preserved):** Re-invoking within 5 min for the same session/reason still no-ops with the "Already flagged just now." toast.
- **SC-9 (no card-branch bleed):** A `message_type='system'` row with a `collab_dead_end` `card_payload` does NOT render the card-chip / CardPreview UI.
- **SC-10 (cache no-flash):** A banner row read cache-first renders as a system banner on first paint (no user-bubble flash), because the intrinsic marker is in the cached row (HF-1).

---

## §5 — Invariants

| ID | Invariant | Preservation | Verifying test |
|----|-----------|--------------|----------------|
| INV-1 (NEW) `I-COLLAB-SYSTEM-MSG-INTRINSIC` | A collab dead-end banner's system-ness MUST be derivable from intrinsic row fields (`sender_id IS NULL` OR `message_type='system'`), never from matching changeable prose. | Poster writes null-sender + `message_type='system'`; recognizer checks those first. | SC-1 (allowlist-deleted enrich test). |
| INV-2 (NEW) `I-COLLAB-SYSTEM-MSG-NO-TOKEN-LEAK` | The raw `[[…]]` token MUST NEVER render as visible text in any build, any state. | New build renders from payload (no parse); degrade `content` is token-stripped; old build sees stripped prose. | SC-4, SC-5. |
| INV-3 (NEW) `I-COLLAB-SYSTEM-MSG-CHIPS-FROM-DATA` | Participant chips MUST be built from the structured `participants` array, not parsed from prose. | Renderer maps `payload.participants` → `CollabLocationChips`. | SC-2, render test. |
| INV-4 `I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS` (existing, ORCH-0659/0660) | No recipient-relative fields (travelTime/distance) in `card_payload`. | The `collab_dead_end` payload carries only labels/names/ids/action — no distances. | grep + payload schema review. |
| INV-5 `messages` RLS (existing) | Only conversation participants can write/read messages. | RPC re-implements the participant check inside `SECURITY DEFINER`; READ RLS unchanged. | SC-7. |
| INV-6 (existing, memory) Collab deck determinism contract | Untouched — presentation only. | No geometry/freeze/aggregation code touched. | git diff = render+poster+RPC only. |

---

## §6 — Backward-compatibility degrade (exact rule) 🔒

The cross-build window is the whole point of RC-1. Define degrade precisely:

1. **The row is ALWAYS `sender_id=NULL`.** Today's shipped main already short-circuits `isSystem=true` for null sender (`messagingService.ts:1433`, confirmed unchanged vs main in the investigation's no-diff proof). Therefore **every existing build renders the new row as a centered system banner** — RC-1 is closed the moment the poster ships, even before every device updates the renderer.
2. **`content` (NOT NULL column) carries the degrade prose = the matrix string with the `[[…]]` token removed.** Exact strip rule: take `buildCollabDeadEndBannerContent(input)`, then `.replace(/\s*\[\[[^\]]*\]\]/g, '').replace(/\s+\n/g,'\n').trim()`. Result examples:
   - `You're in different cities — Miami, FL and Raleigh, NC. Pick one spot you'll all head to.`
   - `Waiting on Ava's location to land — the deck fills in automatically.`
   So an OLD build (which renders system rows via `renderSystemBannerContent` splitting on `SYSTEM_TOKEN_REGEX` — and finds NO token in the stripped content) shows clean prose, **no raw `[[…]]`, no button** (acceptable degrade — the user still understands and can open prefs manually).
3. **A NEW build prefers `card_payload`** (chips + button); it only falls back to parsing `content` when `card_payload?.kind !== 'collab_dead_end'` (i.e. a legacy prose-only row), where the existing token parser produces the button.
4. **Notification preview safety:** because `content` holds readable prose, push/in-app notification previews (which read `content`) show a sensible line, not raw tokens.

**Net:** new↔new = chips+button; new↔old(producer new) = clean prose system banner; new(producer old)→new(renderer) = parsed-token button via legacy path. No combination yields a user bubble or a raw token. This is why the merge to main (bringing the producer everywhere) plus null-sender fully resolves RC-1/CF-1 without waiting for universal renderer adoption.

---

## §7 — Merge convergence with existing ORCH-1058 work 🔒

The 6 unmerged commits (`7ccb931` deck chips + copy matrix + GPS guard, `d7886fb` City/ST correction, `1bb6c71` allowlist) ship in the SAME PR as this work. Specifically:
- `collabDeadEndBannerService.ts` — the §3.2 rewrite **builds on** the merged `buildCollabDeadEndBannerContent` matrix + `classifyIntersectionCase` + `resolveParticipantLocationLabel` (it reuses them to compute prose + chips). No revert of the matrix.
- `messagingService.ts` allowlist additions (`1bb6c71`) — **kept** as the legacy/degrade fallback (§3.3); the comment is updated to reposition them.
- `CollabLocationChips.tsx` + `formatLocationLabel.ts` resolver + `SwipeableCards.tsx` deck chips — **unchanged**; `CollabLocationChips` simply gains a second importer (`MessageBubble.tsx`).
- One converged PR → main resolves the cross-build mismatch for the deck-side copy too (both builds converge).

---

## §8 — Implementation order 🔒

1. **DB migration + RPC** (`rpc_post_collab_dead_end_banner`) + strict-grep allowlist update in the same commit. Apply per safe-migration norms; verify with `mcp__supabase__list_migrations`.
2. **Service types + payload builder** (`collabDeadEndBannerService.ts`): `CollabDeadEndBannerPayload`, `buildCollabDeadEndBannerPayload`, token-strip degrade prose, RPC call replacing the direct insert. Export `CollabSystemAction` alias from `MessageBubble.tsx`.
3. **Recognizer** (`messagingService.ts`): add `message_type==='system'` to `isSystem`; pass `card_payload` through; update allowlist comment.
4. **Data transform** (`ConnectionsPage.tsx`): map `systemPayload`.
5. **Renderer** (`MessageBubble.tsx`): `renderCollabDeadEndBanner` branch + import `CollabLocationChips` + button; `MessageInterface.tsx`: thread `systemPayload` prop.
6. **Regression tests** (§10).
7. **Live-fire** iOS + Android on the SAME new build (§11).

---

## §9 — Regression prevention 🔒

- **Structural:** system-ness now derives from intrinsic fields; the allowlist is demoted to a fallback. A future copy change can no longer break system-ness (INV-1).
- **Shared action type:** poster and renderer import the SAME `CollabSystemAction`/`CollabSystemToken` union — a divergence is a TypeScript error, not a runtime drift (kills CF-1 for the action).
- **Protective comments:** RPC comment + `messagingService.ts:167-174` comment rewrite explain WHY null-sender + `message_type='system'` are the markers and the allowlist is legacy.
- **CI:** the §10 parity/guard test (the file the existing comment already promises) becomes real and gates copy/payload changes.

---

## §10 — Regression test contract

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 (parity/guard) `app-mobile/__tests__/orch-1058b-system-banner.mjs` | Intrinsic recognition | `enrichMessage` on a `{sender_id:null, message_type:'system', content:'<prose>'}` row **with `COLLAB_DEAD_END_BANNER_PATTERNS` emptied to `[]`** | `isSystem === true` | Service |
| T-02 | Token never leaks | `buildCollabDeadEndBannerPayload` for each reason | `payload.prose` and `content` contain NO `[[` substring; `payload.action` is a valid `CollabSystemToken` | Service |
| T-03 | Chips from data | `collab_dead_end` payload with 2 participants | renderer (or a pure mapper unit) produces 2 `CollabLocationChip` objects with labels `Name · Label`, correct `kind` | Component |
| T-04 (cross-build degrade — the key one) | OLD allowlist × NEW content | Take the §6 stripped prose for `different_cities` and `waiting`; evaluate against a **deliberately-old allowlist snapshot** AND assert `renderSystemBannerContent(strippedProse)` yields ZERO token buttons and ZERO `[[` text | Component+Service |
| T-05 | Legacy prose row on new build | An OLD prose row WITH `[[open-prefs:location:<uuid>]]` + `card_payload=null` | renderer falls back to `renderSystemBannerContent`, token parsed into a button, no raw `[[` | Component |
| T-06 | Button target matrix | each reason | `payload.action` equals the §3.2 table value | Service |
| T-07 | Authorization | RPC called by a non-participant (mock/SQL) | raises `not a participant`; no row inserted | DB |
| T-08 | Card-branch no-bleed | `message_type='system'` + `collab_dead_end` payload | system branch returns; card/CardPreview not rendered | Component |
| T-09 | Debounce | two posts < 5 min, same session+reason | second no-ops + toast | Service |
| T-10 | Cache no-flash | cached null-sender row transformed | `isSystem===true` + `systemPayload` present on first transform | Service |

**Cross-build degrade case is explicitly T-04** — it evaluates the new producer's output against an older recognizer snapshot, the exact topology that produced Seth's symptom, and asserts no token leak + no user bubble.

---

## §11 — Platform / live-QA note (honest)

- **iOS + Android both covered** (shared RN code; only the chip glass fallback differs, component-handled).
- **Live QA REQUIRES BOTH devices on the SAME new build.** The entire RC-1 symptom was a cross-build artifact; testing a new dev build against a shipped device will still show the OLD device's behavior for any NOT-YET-merged renderer change. The honest QA protocol:
  1. After merge to main + new build on BOTH devices: post a `different_cities` banner → both see chips + button.
  2. To verify the DEGRADE path without a stale binary, simulate it in a unit test (T-04) — a true old-binary device is not required and per memory `feedback_testing_handoff_just_run_expo_start` should not be hand-assembled; the null-sender mechanism guarantees the system-row render on any build by construction (the `:1433` short-circuit is already on main).
  3. Android: confirm chip opaque fallback (SC-2-Android) on emulator or the reserved physical device.
- A two-phone frame-by-frame race is NOT needed for correctness (the investigation proved the mechanism from persisted rows); the live pass confirms the happy path renders as designed on each platform.

---

## §12 — 🔒 LOCKED vs 🎨 OPEN summary

**🔒 LOCKED:** the architectural decision (null-sender + `message_type='system'` + `card_payload` JSON via `SECURITY DEFINER` RPC); the RPC authorization check; payload schema; chip reuse of `CollabLocationChips` + `glass.discover.chip`; chip label format `Name · City, ST`; the GPS/pending resolver reuse; the degrade prose token-strip rule; shared `CollabSystemAction` type; all success criteria; all invariants; the test contract; no-AI-slop bans; no schema-column-add / no RLS-policy-change / no CHECK-constraint change.

**🎨 OPEN (implementor craft within the locked floor):** the exact button visual (pill shape, fill vs outline, press micro-feedback) within the locked constraints (44pt target, `#eb7825` accent, ≥4.5:1, non-shifting press, role=link, testID); micro-spacing between prose/chips/button within `spacing.sm`–`spacing.md`; whether `renderCollabDeadEndBanner` is an inline function or a small subcomponent file. If a bespoke button beyond the floor is wanted, route to `mingla-designer`.

---

## Discoveries for orchestrator

- The parity test referenced by the existing comment (`app-mobile/__tests__/orch-1058-banner-allowlist-parity.mjs`, cited at `messagingService.ts:171-172`) **does not exist on disk** — the comment promises a guard that was never committed. T-01/T-04 in §10 make it real. Flag: the allowlist landed with a comment referencing a non-existent test.
- **GPS implausible-jump debounce** remains a separate unfixed ORCH (predecessor Discovery #1) — the flap that triggers the empty window. Not in this spec's scope.
- This spec assumes `card_payload` may carry a non-card object for `message_type='system'` rows; implementor must confirm at IMPLEMENT that no existing reader unconditionally treats `card_payload` as a `CardPayload` (the early system-branch return at `MessageBubble.tsx:237` should prevent it, but verify all `card_payload` readers).
