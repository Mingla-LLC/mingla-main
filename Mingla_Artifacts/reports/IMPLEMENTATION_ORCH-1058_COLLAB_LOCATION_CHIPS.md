# IMPLEMENTATION — ORCH-1058 [Collab deck location chips + smarter no-overlap feedback]

**Skill:** mingla-implementor (Claude)
**Date:** 2026-06-02
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1058-[collab-deck-empty-intersection-replay]/` on branch `ORCH-1058-collab-deck-empty-intersection-replay`
**Spec (authoritative):** `Mingla_Artifacts/specs/DESIGN_ORCH-1058_COLLAB_LOCATION_CHIPS.md` (cdc32ef87)
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1058_COLLAB_DECK_EMPTY_INTERSECTION_REPLAY.md`
**Commit:** `7ccb931647` (original code + test); report committed separately on the same branch. **CORRECTION 2026-06-02:** GPS-privacy reversal committed on top (see CORRECTION section).
**Status:** implemented, partially verified — logic verified by behavioral regression test; live empty-deck render needs an operator-assisted collab session (see Discoveries).

---

## CORRECTION 2026-06-02 — GPS privacy reversal (operator directive)

The operator REVERSED the GPS privacy decision. Originally a `use_gps_location === true` participant rendered "Sharing live location" / "Sharing your location" and NEVER their city (a privacy guard). That is now GONE. **A GPS participant renders their resolved location as "City, ST"** — the same `formatCityState` format as an explicit-location participant — so the group can SEE where everyone actually is and diagnose a geometry problem at a glance. During the investigated incident the flapping GPS now correctly shows "Washington, DC" then "Raleigh, NC" — that transparency is the whole point.

**What changed in this correction:**

- `formatLocationLabel.ts` `resolveParticipantLocationLabel()`: the GPS branch now formats the GPS user's resolved reverse-geocoded string via `formatCityState()` (kind stays `'gps'`). The resolved string is read from top-level `prefs.location` (verified against live `collaboration_sessions.participant_prefs` — GPS user `b17e3e15` held `location:"Raleigh, Wake County, North Carolina, United States"` while `custom_location` was null), with `prefs.custom_location` as a defensive fallback (new `pickGpsResolvedString` helper). GPS on but NO resolved string yet → degrades to a `'pending'` "Getting a fix…" label (never blank, never a stale city). `isSelf` no longer changes a GPS label (the city is the city for everyone).
- Removed the now-unused `GPS_PHRASE_SELF` / `GPS_PHRASE_OTHER` / `GPS_PHRASE_INLINE` constants and the exported `GPS_INLINE_PHRASE` (verified zero importers across `app-mobile/src`). Rewrote the §1 "load-bearing privacy guard" header + resolver doc-comments to describe the transparency behavior honestly.
- `collabDeadEndBannerService.ts`: updated the §3 banner comment + the `formatLocationLabel` delegating-fn comment (no logic change — it already delegates to the shared resolver, so it inherits the new behavior automatically).
- Regression gate `orch-1058-regression-check.mjs`: the A-block FLIPPED from "GPS user never yields a city" to A-01..A-05 — GPS user with a resolved `prefs.location` yields "Raleigh, NC"; a flapping fix to DC yields "Washington, DC"; `isSelf` GPS yields the same city; `custom_location` fallback yields "London, UK"; and a GPS user with no fix yet yields the pending "Getting a fix…" state. B + C blocks unchanged.

**Kept intact:** `formatCityState` + `US_STATE_NAME_TO_CODE`, the bullet chips (`CollabLocationChips`), and the 3-case empty-deck feedback (different-city / same-city-too-tight / waiting). No SQL / edge / migration / geo / freeze changes — presentation/copy only.

**Correction regression run:** `22/22 checks passed. ORCH-1058 regression check PASSED.` **Fails-on-revert: VERIFIED at commit `7ccb931647`** — restoring the old privacy-guard `formatLocationLabel.ts` from that commit produced `17/22 ... FAILED (5 failing)` (A-01..A-05), then restored → 22/22 green. `tsc --noEmit` shows zero errors on the three touched files (the 260 worktree-wide errors are pre-existing missing-react-types artifacts in sibling `packages/*`, unrelated to this change).

---

## REGRESSION FIX 2026-06-02 — "Notify the group" banner leaked raw `[[open-prefs:…]]` tokens

**Symptom (operator-reported):** the collab "Notify the group" chat message rendered raw codes/symbols — e.g. the literal `[[open-prefs:location:<uuid>]]` — instead of a tappable system banner.

**Root cause (orchestrator-confirmed, re-verified here):** a chat message renders as a parsed collab SYSTEM banner (tokens → tappable buttons) ONLY when `messagingService.isCollabDeadEndBannerMessage(content)` matches one of the `COLLAB_DEAD_END_BANNER_PATTERNS` allowlist regexes. That predicate feeds `isSystem` in `enrichMessage`/`enrichRealtimeMessage` (`messagingService.ts:1414`/`:1430`), which gates the `message.isSystem` render branch in `MessageBubble.tsx:237-243` (→ `renderSystemBannerContent`, which strips the token and renders a label). The banner is posted with `sender_id = currentUserId` (not null), so `isSystem` depends ENTIRELY on the allowlist match. The ORCH-1058 copy change rewrote the `intersection_empty` multi/2-person path in `buildCollabDeadEndBannerContent` into three new strings (waiting / different_cities / same_city_tight) WITHOUT updating the allowlist, so they failed the regex, fell back to plain-text rendering, and leaked the raw token. The stale `^No location overlap yet\.` pattern no longer matched any produced string.

**Fix:** rewrote the `COLLAB_DEAD_END_BANNER_PATTERNS` allowlist (`messagingService.ts:166-189`) so EVERY string `buildCollabDeadEndBannerContent` can emit is anchored + token-matched:
- KEPT: single-outlier (`is too far from the group … [[open-prefs:travel:UID]]`), `no_matching_candidates` GPS-gap (`Waiting for … to share location.` — still produced at `collabDeadEndBannerService.ts:138`), no-categories, no-unswiped, quorum, all-pools.
- REPLACED the dead `^No location overlap yet\.` pattern with the 3 NEW intersection strings:
  - `^Waiting on .+'s location to land — the deck fills in automatically\. \[\[open-prefs:location:UID\]\]$`
  - `^You're in different cities — .+\. Pick one spot you'll all head to\. \[\[open-prefs:location:UID\]\]$`
  - `^So close — you're in the same area but your travel ranges don't touch\. Bump travel time or distance\? \[\[open-prefs:travel:UID\]\]$`
- Labels (City/ST, "Getting a fix…") matched permissively (`.+`); the em dash `—`, apostrophes `'`, and `?` are escaped/literal; the structure + `[[…:UID]]` token are anchored. UID uses the existing `COLLAB_TOKEN_USER_ID = [a-zA-Z0-9_-]+` sub-pattern (matches hyphenated UUIDs).

**MessageBubble parse/strip — verified, no change needed.** `parseCollabSystemToken` (`MessageBubble.tsx:482`) already supports the `location` section (`VALID_PREF_SECTIONS` includes it) and the UID match class `[a-zA-Z0-9\-_,]+` covers hyphenated UUIDs. `renderSystemBannerContent` (`:512`) splits on `SYSTEM_TOKEN_REGEX`, replaces each token with a tappable label, and keeps surrounding prose (em dash + apostrophe render as plain `<Text>`). The parity test below proves no `[[` survives in visible text for any produced string. No edit to `MessageBubble.tsx` was required.

**Regression test (NEW):** `app-mobile/scripts/ci/orch-1058-banner-allowlist-parity.mjs` — runs the REAL `buildCollabDeadEndBannerContent` (transpiled from source, imports stubbed) across all 9 emittable scenarios (every reason + all 3 intersection cases, with a sample hyphenated UUID), and for each asserts: (1) the produced string matches the REAL `isCollabDeadEndBannerMessage` allowlist (extracted + evaluated from source), and (2) the REAL `parseCollabSystemToken` + `SYSTEM_TOKEN_REGEX` strip the token from visible text (no `[[`/`]]` remains). Plus a fails-on-revert anchor over the 3 literal new copy lines. Makes copy↔allowlist drift impossible to ship silently.
- **Run:** `37/37 checks passed. ORCH-1058 banner↔allowlist parity check PASSED.`
- **Fails-on-revert: VERIFIED** — `git stash` the `messagingService.ts` allowlist edit (baseline commit `d7886fb7a`) → `31/37 ... FAILED (6 failing)` (the 3 new intersection scenarios' allowlist checks + 3 fails-on-revert anchors). `git stash pop` → 37/37 green.
- **typecheck:** `tsc --noEmit` on app-mobile shows ZERO errors in `services/messagingService.ts`, `services/collabDeadEndBannerService.ts`, `chat/MessageBubble.tsx` (the 260 worktree-wide errors are pre-existing Deno-test/`packages/*` artifacts, unrelated).

**Scope:** presentation/parsing only — no SQL/edge/migration/geo/freeze. `formatCityState`/chips/3-case copy + GPS-resolved-City,ST behavior all intact. Metro stayed live on 8087 (pure runtime-data regex-array change → hot-reload-safe).

---

## Mission

Presentation + copy only. No SQL / edge / migration / web. Restyle the collab-deck `intersection_empty` empty state: (1) a GPS privacy guard so a live-GPS participant's city never leaks, (2) a `formatCityState()` "City, ST" formatter + new `US_STATE_NAME_TO_CODE` map, (3) a 3-case honest copy matrix (different cities / same-city-too-tight / waiting-on-GPS), (4) bullet-separated read-only chips built on the existing `glass.discover.chip` tokens. The SQL intersection math, the positional-freeze contract, and the GPS write path are untouched (correct per investigation / separate debounce ORCH).

## Comms ledger

Read on entry. No `BLOCK`/`WARN`/`FYI` row is addressed to `mingla-implementor` or `ORCH-1058`. The OPEN WARN rows (COMMS-0003/0004/0012/0013/0015/0016) concern external-API doc-citation, INTAKE numbering, migration-apply gaps, and pricing — none touch collab-deck geography or copy. No external API touched (no provider docs to cite). No new cross-ORCH discovery to write (localized collab-deck presentation change, no shared-contract blast).

---

## Old → New Receipts

### app-mobile/src/utils/formatLocationLabel.ts (NEW, ~290 lines)
**Before:** did not exist. No full-state-name→code map anywhere in the codebase.
**Now:** exports `formatCityState(raw)`, `expandCityStateForA11y(raw)`, `resolveParticipantLocationLabel({prefs,isSelf})` (the §1 precedence — CORRECTED 2026-06-02 so the GPS branch shows the resolved "City, ST" from `prefs.location`/`custom_location`, pending fallback when no fix; privacy phrases removed), and the new `US_STATE_NAME_TO_CODE` (50 states + DC). Re-homes `US_STATE_CODES` + `COUNTRY_NAME_TO_CODE` (moved out of CityPickerSheet) so picker + collab deck share one owner.
**Why:** spec §1 (GPS location label — now transparency, per operator reversal), §2 (City, ST formatting + the missing state-name map + fallbacks).

### app-mobile/src/components/discover/CityPickerSheet.tsx (~25 lines net removed)
**Before:** defined its own local `US_STATE_CODES` set + `COUNTRY_NAME_TO_CODE` record.
**Now:** imports both from `../../utils/formatLocationLabel`; `parseStateCountry` unchanged.
**Why:** spec §7 dedupe — one owner. No behavior change (same values, same `parseStateCountry`).

### app-mobile/src/services/collabDeadEndBannerService.ts (~90 lines added)
**Before:** `formatLocationLabel(prefs)` returned `custom_location` verbatim or "their location" — no GPS guard, leaking a reverse-geocoded GPS city. The `intersection_empty` multi branch printed one generic "No location overlap yet … Someone needs to widen travel or change location" with every raw location joined.
**Now:** (1) `formatLocationLabel` delegates to the privacy-aware resolver (GPS guard + `formatCityState`); (2) added `SAME_CITY_THRESHOLD_M = 60000` + `classifyIntersectionCase()` returning `'different_cities'|'same_city_tight'|'waiting'` + `pendingIds` (geometry uses raw coords; privacy governs only the display string); (3) rewrote the `intersection_empty` banner branch to the §3 three banner strings with `[[open-prefs:…]]` tokens. The 3+ single-outlier branch is unchanged.
**Why:** spec §1 + §3.

### app-mobile/src/components/collab/CollabLocationChips.tsx (NEW, ~140 lines)
**Before:** did not exist.
**Now:** read-only presentational chip row from `glass.discover.chip` tokens, `•` separator (bullet hidden from a11y tree), `numberOfLines={1}` + `maxWidth:160` truncation, Android opaque-glass fallback honored, per-chip `accessibilityLabel`. Bullet+chip grouped in a non-wrapping inner row so a bullet never orphans at a wrapped line start.
**Why:** spec §4 (mirror TripFilterChips, do not invent a visual system) + §8 (a11y).

### app-mobile/src/components/SwipeableCards.tsx (~95 lines added/changed)
**Before:** `getCollabDeadEndCopy()` `intersection_empty` multi branch returned `{title:'No location overlap yet', subtitle:<joined raw locations>}`; render printed a single subtitle `<Text>`.
**Now:** the multi branch calls `classifyIntersectionCase` and returns `{reason,title,guidance,chips,showReviewDismissed}` per case, building privacy-aware `CollabLocationChip[]` via `resolveParticipantLocationLabel` (settled + pending "getting a fix…" chips for the waiting case). Render: when `chips` present, mounts `<CollabLocationChips>` between title and a guidance `<Text>`; all other reasons keep the plain subtitle `<Text>`. Unused `formatLocationLabel` import removed; `t` + `user?.id` added to the `useCallback` deps. New `emptyDeckGuidance` style (marginTop 8).
**Why:** spec §3 + §4 wiring.

### app-mobile/src/i18n/locales/en/cards.json (9 keys added)
**Before:** dead-end copy was hardcoded inline.
**Now:** added `collab.deadend.{different_cities,same_city_tight,waiting}.*` title/guidance keys + `waiting.pending_chip` + `waiting.title_one/title_many` with interpolation.
**Why:** spec §7 — key the new strings (do not invent a new file; collab copy now lives in the existing cards namespace).

---

## Spec Traceability

| Requirement | Implemented | Evidence |
|---|---|---|
| R1 — GPS transparency (CORRECTED 2026-06-02): GPS user shows resolved "City, ST", pending fallback when no fix | `resolveParticipantLocationLabel` GPS branch reads `prefs.location` (fallback `custom_location`) → `formatCityState()`, kind `'gps'`; no resolved string → `'pending'` "Getting a fix…"; `formatLocationLabel` + banner + chips all route through it | Test A-01..A-05 PASS; fails-on-revert proven @ `7ccb931647` |
| R2 — `formatCityState` + `US_STATE_NAME_TO_CODE` + fallbacks | new util; all §2 worked vectors implemented | Test B vectors PASS (7 vectors + 4 fallbacks + map shape) |
| R3 — 3-case copy matrix routed via `SAME_CITY_THRESHOLD_M=60000` | `classifyIntersectionCase`; exact §3 strings in cards.json + banner | Test C-(a)/(b)/(c) + boundary PASS |
| R4 — bullet chips on `glass.discover.chip` tokens | `CollabLocationChips` mirrors `TripFilterChips` tokens; `•` separator; Android opaque fallback | Code review vs designSystem token block; tsc clean |

## Regression Test

- **Path:** `app-mobile/scripts/ci/orch-1058-regression-check.mjs`
- **Mechanism:** transpiles the REAL on-disk TS (`formatLocationLabel.ts` whole; the dependency-free `classifyIntersectionCase` + `haversineMeters` + `SAME_CITY_THRESHOLD_M` lifted from `collabDeadEndBannerService.ts`) via the `typescript` compiler API and exercises the actual logic — behavioral, bound to source, not a text scan.
- **Passing run (post-correction):** `22/22 checks passed. ORCH-1058 regression check PASSED.`
- **Fails-on-revert: VERIFIED at commit `7ccb931647`.** Restoring the old privacy-guard `formatLocationLabel.ts` from that commit produced `17/22 ... FAILED (5 failing)` (the flipped A-01..A-05 GPS-transparency checks). Restored → 22/22 green, working tree clean.

## Verification Matrix

| Criterion | How verified | Verdict |
|---|---|---|
| GPS user shows resolved "City, ST"; pending fallback when no fix (CORRECTED) | behavioral test A-01..A-05 + fails-on-revert | PASS |
| formatCityState vectors + fallbacks | behavioral test B (11 cases) | PASS |
| 3-case routing + 60km threshold | behavioral test C (6 cases) | PASS |
| Chips reuse glass.discover.chip tokens | source review vs `designSystem.ts:767-799` + mirror of `TripFilterChips` styles | PASS |
| Only §7 files touched | `git show --stat` = 7 files, all in §7 | PASS |
| Freeze/geo untouched | no edits to SQL/RPC/`detectIntersectionOutlier`/freeze code | PASS |
| typecheck clean on touched files | `tsc --noEmit` grep of touched files empty | PASS |
| Live empty-deck render (a)/(b)/(c) on device | requires a collab session with non-overlapping locations | UNVERIFIED — operator-assisted |
| **REGRESSION:** all 4 banner strings match the messagingService allowlist (render as parsed system banners, no raw token) | parity test scenarios → `isCollabDeadEndBannerMessage` = true for all 9 produced strings | PASS |
| **REGRESSION:** MessageBubble strips the token for every produced string | parity test → real `parseCollabSystemToken`/`SYSTEM_TOKEN_REGEX`, no `[[` in visible text | PASS |
| **REGRESSION:** parity test green + fails-on-revert | `37/37 PASSED`; stash messagingService fix → `31/37 FAILED (6)` → restore → 37/37 | PASS |

## Invariant / Constitution

- **GPS write path / `pg_aggregate_collab_prefs` geography / positional-freeze:** untouched. This is a display-string change only; `classifyIntersectionCase` reads raw coords for geometry, never gates the deck. (Post-correction the display string now SHOWS the GPS city — the geometry is still computed from raw coords independently.)
- **Android glass policy (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`):** chip honors the opaque fallback + `overflow:'hidden'` clip; no translucent Android fill reintroduced.
- **Constitution #2 (one owner per truth):** state/country tables centralized in the util; CityPickerSheet re-imports. PASS.
- **No silent failures / strict TS / no `any` escape hatch beyond the existing `prefs: any` shape already in the service:** PASS.

## Cross-Surface Impact (Step 3.5)

- **Consumer iOS / Android:** AFFECTED — shared RN code path (same component), parity automatic. Both honor the Android opaque-glass fallback.
- **Buyer/anon Web, Business iOS/Android, Admin Web, Business Web preview:** UNAFFECTED — collab decks are consumer app-mobile only; no equivalent flow elsewhere (investigation Q5).

## Discoveries for Orchestrator

- **Icon substitution (minor spec deviation):** spec §3/§4 named `locate-outline` (pending) and `resize-outline` (same-city case). Neither exists in `app-mobile/src/components/ui/Icon.tsx` ICON_MAP. Used the mapped `hourglass-outline` for the pending chip glyph. The case-level icons in the §3 matrix are not wired to a render slot (the empty-deck icon circle uses the existing fixed `filter-outline`/`earth-outline`); leaving the icon-circle glyph unchanged keeps scope tight. If product wants per-case icon-circle glyphs, that's a follow-up (would need ICON_MAP additions for `resize-outline`).
- **Live QA needed:** the empty-deck (a)/(b)/(c) render can only be exercised with a real collab session where participants' reachable circles don't overlap (e.g. one in DC, one in Raleigh, or same metro with tight travel ranges). Operator-assisted; orchestrator to batch.
- **GPS implausible-jump debounce remains a SEPARATE ORCH** (investigation Discovery #1) — out of scope; this ORCH only makes the empty window honest, it does not stop the flap.
- **Stale LOCKED test broken by the ORCH-1058 in-deck copy change (needs TEST-MOD-APPROVED decision):** `app-mobile/src/components/__tests__/orch-0945-dead-end-render.test.tsx` (committed on `main` at `c3358dcf3`, locked under the append-only CI gate) asserts the OLD in-deck `SwipeableCards.getCollabDeadEndCopy` copy — specifically T-02 `assert.match(helper, /No location overlap yet/)` and T-04 `/Pick some categories/` + `/Nobody has picked categories or intents yet/`. The ORCH-1058 copy rewrite (commit `7ccb93164`, the multi/2-person 3-case routing) removed the literal "No location overlap yet" branch, so this standalone node test now FAILS at T-02. **It is NOT a CI merge blocker** (it is a `require.main === module` node script, not wired into any `.github/workflows/*` job; the strict-grep gate `i-proposed-orch-0945-dead-end-reason-coverage.mjs` only checks that `case '<reason>'` branches exist, which the rewrite preserves — that gate still PASSES; the `tests-append-only.yml` gate does not RUN tests). I did NOT modify the locked test (per the implementor contract: changing an existing locked test "is itself a new ORCH — do NOT silently override"). Orchestrator decision needed: either (a) open a tiny TEST-MOD-APPROVED follow-up to repoint T-02/T-04 to the new copy, or (b) accept the stale standalone script as known-broken until the next collab-copy ORCH. The user-facing render is correct; this is test-asset staleness only.

## Deploy / Migration notes

None. No edge functions, no migrations, no DB. Mobile-only presentation + copy; rides the next app build (OTA deferred per memory — merged changes ride the build).
