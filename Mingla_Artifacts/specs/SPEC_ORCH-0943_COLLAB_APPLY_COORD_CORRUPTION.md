# SPEC — ORCH-0943 [Collab + solo Apply coord corruption — Apply text-without-coords + silent GPS overwrite]

**Date:** 2026-05-23
**Status:** SPEC READY for IMPLEMENT dispatch
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` at HEAD `16a671ea` (post-ORCH-0942 merge)
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0943_COLLAB_APPLY_COORD_CORRUPTION.md` (binding — Root Cause PROVEN with live-data corroboration)
**Severity:** S1-high (data integrity + ongoing silent corruption in production sessions; 2/4 participants in `daadd454-…` corrupted right now; 0/19 solo rows corrupted but solo Apply path has same UX gap)
**Recommended fix direction:** Direction A (server-side R3.8 guard) + Direction B1 (client-side UX auto-resolve guard) from the investigation's Fix Strategy section. NOT Direction B2 (picker UI restructure — reserved for chat-native sheet META-ORCH).

---

## §1 — Scope (ruthlessly specific)

### IN scope (the five things this SPEC ships)

1. **Fix A — Server-side R3.8 guard** at `app-mobile/src/contexts/RecommendationsContext.tsx:1438-1451`. Gate the GPS-sync upsert on `boardSessionResult.preferences?.use_gps_location === true`. When `use_gps_location` is false, do nothing — the user has explicitly set a custom location and the device GPS must not silently overwrite their coords.
2. **Fix B1 — Client-side UX auto-resolve guard** in `app-mobile/src/components/PreferencesSheet.tsx`'s `handleApplyPreferences` (line 804). When `useGpsLocation === false` AND `searchLocation.length > 0` AND `selectedCoords === null`, BEFORE firing any save: attempt one auto-resolve via the existing `geocodingService.autocomplete(searchLocation)` — pick the top suggestion, validate bounds, set `selectedCoords`. If resolution fails (no suggestions, network error, invalid bounds, timeout), block Apply with a toast `"Tap a suggestion to set your location."` and keep the sheet open. Apply on BOTH collab and solo branches (same code path serves both — Constitution #2 "one owner per truth" + the existing `// PARITY` comment at line 854).
3. **Fix C — Data backfill SQL**. Read-only audit first to enumerate ALL corrupted rows across ALL `collaboration_sessions.participant_prefs` (not just `daadd454-…`); then operator-gated single-statement UPDATE that restores coherent text+coords from the solo `preferences` baseline whenever solo is itself coherent and the session row drifted under `use_gps_location=false`. SPEC includes both the audit SQL and the write SQL verbatim; operator owns the actual `supabase db push`/SQL execution.
4. **Fix D — `useSessionManagement.ts:422` audit** (the third RPC caller from the investigation's Contributing finding). Confirm whether its payload includes `custom_location` whenever it touches `custom_lat`/`custom_lng`. If partial (touches coords without text), fold the same `use_gps_location === true` guard pattern into that call site. If full, document the verification and leave the call site alone.
5. **NEW invariant + strict-grep gate**: `I-PROPOSED-CUSTOM-COORDS-LOCKED-WHEN-CUSTOM-LOCATION-MODE` enforces "no client may upsert `custom_lat` or `custom_lng` for a participant whose `use_gps_location` is false unless `custom_location` text is in the same payload OR the upsert is structurally skipped at the call site." Strict-grep gate scaffolded at `.github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.mjs` enforces the pattern at every `upsert_participant_prefs` call site in `app-mobile/src/`.

### NON-goals (explicit OUT-of-scope)

1. **DO NOT propose Direction B (live_gps_* JSONB key split)** — reserved for the chat-native sheet META-ORCH per Contract 5 of `Mingla_Artifacts/PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md`. Backend untouched in this SPEC.
2. **DO NOT propose B2 picker-restructure** (replace free-text input with tap-to-open picker modal) — that's a UX redesign belonging to the chat-native sheet redesign.
3. **DO NOT modify `useBoardSession.ts:updatePreferences`** (lines 215-260). It already sends full payload via Apply — verified working. Do NOT add guards there.
4. **DO NOT modify `PreferencesSheet.tsx`'s solo branch logic beyond Fix B1**. Specifically: do NOT touch the solo branch's `selectedCoords` resolution, GPS toggle handlers, or autocomplete debounce — those are independent of the bug.
5. **DO NOT remove the existing `isFormComplete` form-validation gate** (line 1253). It stays as defense-in-depth even though it's been operator-confirmed unreliable. Fix B1 makes it irrelevant for correctness but the gate remains for visual feedback (button stays disabled until coords resolve).
6. **DO NOT modify `INVARIANT_REGISTRY.md` for ORCH-0918/META-ORCH-0929 entries** — only ADD the new ORCH-0943 invariant.
7. **DO NOT modify any existing strict-grep gate** — only ADD the new ORCH-0943 gate + register it in `.github/workflows/strict-grep-mingla-business.yml`.
8. **DO NOT touch `OnboardingFlow.tsx:1578`** — investigation flagged it as a latent vulnerability (text-without-coords partial save) but operator deferred it to a follow-up ORCH-0944 [Onboarding partial-coord vector]. NOT in scope here.
9. **DO NOT mutate session `daadd454-35a8-487d-ab25-bb595abc4635` via SQL** beyond the read-only audit. The backfill write is operator-gated and operator-executed.
10. **DO NOT run `supabase db push`** — no migrations, no edge functions.
11. **DO NOT publish EAS OTA** — that's an orchestrator CLOSE-time decision after tester PASS.
12. **DO NOT push, open PR, or merge** — implementor stops at the implementation report.

### Assumptions

- `useBoardSession` returns `preferences` containing `use_gps_location: boolean` (verified at hook line 50 + return shape at line 523-535). Fix A can read `boardSessionResult.preferences?.use_gps_location` at the R3.8 effect site since `boardSessionResult` is already in scope in `RecommendationsContext.tsx` (verified at line 1418).
- `geocodingService.autocomplete()` exists and is the same service used by `handleLocationInputChange` (line 573) and `handleSuggestionSelect` (line 607). It returns `AutocompleteSuggestion[]` with optional `location: {lat, lng}` and optional `placeId` for follow-up resolution via `getPlaceCoordinates(placeId)`. Fix B1 reuses both functions verbatim.
- `toastManager.warning()` is the established toast pattern in `PreferencesSheet.tsx` (e.g. line 555 already uses `toastManager.warning(...)` for category-min violations). Fix B1 reuses it.
- The solo `preferences` table is the canonical truth for `(custom_location, custom_lat, custom_lng)` coherence at the user-account level. The DB probe confirmed 19/19 rows coherent.
- The 2 corrupted collab session rows (`ac7f00ee`, `b17e3e15` in `daadd454-…`) plus any other rows surfaced by the audit SQL should be restored to their solo baseline. If operator disagrees per-row, the backfill SQL must be staged so operator can hand-edit the row list before executing.

---

## §2 — Cross-Surface Impact (MANDATORY, Phase 2.5)

| Surface | Covered? | User-visible behaviour required on this surface | File paths touched | Parity mechanism |
| --- | --- | --- | --- | --- |
| **Consumer iOS** (`app-mobile/` on iOS) | YES | Free-text typing in the location field auto-resolves to the top autocomplete suggestion on Apply OR blocks Apply with a toast. Background GPS-sync no longer overwrites coords when user has set a custom location. Existing typed-+-tapped Apply flow unchanged. | All Fix A/B1/D file paths | Automatic (shared RN/JS) |
| **Consumer Android** (`app-mobile/` on Android) | YES | Same as iOS — identical behaviour. | Same as iOS | Automatic (shared RN/JS) |
| **Buyer/anonymous Web** (`mingla-business/` checkout/event/brand routes) | NO | Buyer-anon routes don't expose collab or solo preferences UI. |
| **Business iOS** (`mingla-business/` on iOS) | NO | Business app has no consumer collab + solo prefs surface. |
| **Business Android** (`mingla-business/` on Android) | NO | Same. |
| **Admin Web** (`mingla-admin/`) | NO | Admin doesn't render consumer prefs UI. |
| **Business Web preview** (`mingla-business/` dev/web) | NO | No consumer prefs UI. |

Parity is automatic. No per-platform SC split required.

---

## §3 — Per-Layer Specification

### §3.1 — Component layer

#### §3.1.1 — `app-mobile/src/components/PreferencesSheet.tsx` (surgical edit, Fix B1)

**File path:** `app-mobile/src/components/PreferencesSheet.tsx`
**Operation:** add auto-resolve logic at the top of `handleApplyPreferences` (line 804); preserve all existing logic afterward; apply to BOTH the collab branch AND the solo branch — they share the same `handleApplyPreferences` callback.

**Exact edit pattern (illustrative — implementor writes the actual code, but the shape is binding):**

After line 806 (`isSavingRef.current = true;`) and BEFORE line 808 (`const customLocationValue = ...`), insert the auto-resolve guard:

```typescript
// ORCH-0943 Fix B1: Auto-resolve typed location text when user typed but didn't
// pick a suggestion. Eliminates the "text without coords" save vector that
// caused production session coord corruption (see investigation + DEC-NNN).
// Apply to both solo and collab paths — same handler serves both per the
// PARITY comment at line 854 + Constitution #2 (one owner per truth).
if (!useGpsLocation && searchLocation.trim().length > 0 && selectedCoords === null) {
  let resolved: { lat: number; lng: number } | null = null;
  try {
    const results = await geocodingService.autocomplete(searchLocation);
    if (results.length > 0) {
      const top = results[0];
      let coords = top.location ?? null;
      if (!coords && top.placeId) {
        coords = await geocodingService.getPlaceCoordinates(top.placeId);
      }
      if (coords && Math.abs(coords.lat) <= 90 && Math.abs(coords.lng) <= 180) {
        resolved = coords;
      }
    }
  } catch (err) {
    console.warn('[ORCH-0943] auto-resolve failed', err);
  }

  if (resolved) {
    // Optimistically update UI state so existing payload-construction code
    // at lines 837-838 + 861-862 picks up the resolved coords.
    setSelectedCoords(resolved);
    // Also update searchLocation to the canonical resolved text if the top
    // suggestion's full address differs from what the user typed. This
    // matches handleSuggestionSelect's behavior at line 600 (canonicalize
    // to suggestion.fullAddress || suggestion.displayName).
    const topResult = (await geocodingService.autocomplete(searchLocation))[0];
    if (topResult) {
      setSearchLocation(topResult.fullAddress || topResult.displayName);
    }
  } else {
    // Resolution failed — block Apply, surface toast, keep sheet open.
    isSavingRef.current = false;
    toastManager.warning(
      'Tap a suggestion to set your location.',
      3000,
    );
    return;
  }
}
```

**Notes for the implementor:**
- The second `geocodingService.autocomplete(searchLocation)` call inside the `if (resolved)` block is intentional to fetch the canonical text. If implementor finds a cleaner way (e.g. capture `top` outside the try-catch and re-use), do that — but DO NOT skip the text canonicalization since the deck aggregator's downstream logging benefits from coherent text.
- State updates via `setSelectedCoords` + `setSearchLocation` are React 18 batched; the existing handler logic below (lines 808-907) reads `selectedCoords` via the existing `selectedCoords?.lat ?? null` patterns, so the auto-resolved values WILL flow through the same code paths. Verify this by reading the actual values used at lines 837-838 (solo) + lines 861-862 (collab) — they reference `selectedCoords?.lat ?? null` directly, not a stale closure.
- **Important React caveat:** `setSelectedCoords` and `setSearchLocation` schedule updates; the subsequent code in the same callback reads the OLD values. This means the auto-resolved coords must ALSO be applied directly to the local variables that flow into the save payload. The implementor must either (a) restructure to capture resolved coords in a local variable and pass them into the payload construction explicitly, OR (b) refactor `handleApplyPreferences` so the save logic runs AFTER `selectedCoords` has settled (e.g. defer to next render with `useEffect`). Option (a) is simpler and is the binding choice. The illustrative code above shows state updates for UI visibility, but the implementor must ALSO thread the resolved `{lat, lng}` directly into the local `collabLat`/`collabLng` (line 861-862) and the solo payload (line 837-838).

**Concrete binding payload-flow requirement:**

The save payload sent to `updateBoardPreferences` (collab, line 903) and `PreferencesService.updateUserPreferences` (solo, called via the AppHandlers path around line 908+) MUST contain the auto-resolved `custom_lat`/`custom_lng` in the SAME callback execution. If the implementor relies on `selectedCoords` reading the previous state, the save will still ship null coords and the fix is broken. The verification command is T-02 below.

#### §3.1.2 — Form-validation gate preservation

`isFormComplete` (line 690) and the Apply button `disabled` (line 1253) MUST remain unchanged. Fix B1 turns the form-validation into pure visual feedback (button still disabled when text typed but no coords selected, showing the user they need to either pick a suggestion OR rely on auto-resolve at Apply). Removing or weakening the form gate is forbidden by §1 NON-goal 5.

If after Fix B1 the implementor observes that the Apply button being disabled prevents the auto-resolve path from running (because user can't tap a disabled button), this needs handling. Two options:

- (i) Enable Apply when `searchLocation.length > 0` even with `selectedCoords === null` (so user CAN tap Apply and trigger auto-resolve). This requires editing the `hasLocation` predicate at line 692.
- (ii) Leave the disabled-button state alone; auto-resolve only fires when `selectedCoords` is set normally (via tap-suggestion) — i.e., Fix B1 becomes a redundant safety net, not the primary path.

**Binding choice:** Option (i). Modify line 692 from:
```
const hasLocation = useGpsLocation || (searchLocation.length > 0 && selectedCoords !== null);
```
to:
```
const hasLocation = useGpsLocation || searchLocation.trim().length > 0;
```
This enables Apply when text is set (regardless of coords). Fix B1's auto-resolve then handles the missing-coords case. Same change at line 716 (duplicate of the same predicate).

**Why this is safe:** Fix B1 guarantees the save NEVER fires with null coords + non-empty text in non-GPS mode. It either auto-resolves successfully (save proceeds with resolved coords) or fails fast with toast (save blocked, sheet stays open). The disabled-by-form-gate was a UI lock; Fix B1 makes it a logical lock at the save handler.

### §3.2 — Context / effect layer

#### §3.2.1 — `app-mobile/src/contexts/RecommendationsContext.tsx:1438-1451` (Fix A)

**Operation:** Add a guard predicate that reads the participant's `use_gps_location` from session prefs and returns early when it's false.

**Exact edit (binding):**

Current code at lines 1438-1451:
```typescript
// ── ORCH-0446 R3.8: Update GPS on each collab session entry ──────────
useEffect(() => {
  if (!isCollaborationMode || !resolvedSessionId || !userLocation || !user?.id) return;

  // Atomic GPS update via RPC — deep merge preserves all other pref fields
  void Promise.resolve(supabase.rpc('upsert_participant_prefs', {
    p_session_id: resolvedSessionId,
    p_user_id: user.id,
    p_prefs: {
      custom_lat: userLocation.lat,
      custom_lng: userLocation.lng,
    },
  })).catch(() => { /* Non-blocking GPS update */ });
}, [isCollaborationMode, resolvedSessionId, userLocation?.lat, userLocation?.lng, user?.id]);
```

Required new shape:
```typescript
// ── ORCH-0446 R3.8 + ORCH-0943 Fix A: Update GPS on each collab session entry
// ONLY when this participant has use_gps_location=true. If they've explicitly
// set a custom location (use_gps_location=false), do not overwrite their coords
// with device GPS — that's Bug-3 root cause (DEC-NNN, investigation
// INVESTIGATION_ORCH-0943_COLLAB_APPLY_COORD_CORRUPTION.md).
useEffect(() => {
  if (!isCollaborationMode || !resolvedSessionId || !userLocation || !user?.id) return;

  // ORCH-0943 Fix A: Gate on participant's use_gps_location.
  // Read from useBoardSession's exposed preferences; if undefined (not loaded yet)
  // skip THIS firing — the effect will re-fire when boardSessionResult settles
  // because its preferences object is in the dependency array.
  const participantUseGps = boardSessionResult.preferences?.use_gps_location;
  if (participantUseGps !== true) return;

  // Atomic GPS update via RPC — deep merge preserves all other pref fields.
  // Only fires when participant is in GPS mode, so coords are the authoritative
  // location and overwriting them is the correct behavior.
  void Promise.resolve(supabase.rpc('upsert_participant_prefs', {
    p_session_id: resolvedSessionId,
    p_user_id: user.id,
    p_prefs: {
      custom_lat: userLocation.lat,
      custom_lng: userLocation.lng,
    },
  })).catch(() => { /* Non-blocking GPS update */ });
}, [
  isCollaborationMode,
  resolvedSessionId,
  userLocation?.lat,
  userLocation?.lng,
  user?.id,
  boardSessionResult.preferences?.use_gps_location, // ORCH-0943 Fix A dep
]);
```

**Verification:** `boardSessionResult.preferences` is the `BoardSessionPreferences` object returned by `useBoardSession` (verified at hook line 50 + return shape at lines 523-535). The `use_gps_location?: boolean` field is the current participant's setting in the session JSONB. If the participant just joined and prefs haven't loaded, `preferences?.use_gps_location` is `undefined` → guard returns early → effect re-fires once prefs load. No race.

**Why this preserves intent:** R3.8 was added to keep GPS-mode participants' coords fresh as they move. That intent is preserved — the effect still fires for `use_gps_location=true` users. Non-GPS users never wanted GPS overrides; they explicitly picked a custom location. The guard restores Constitution #2 ("one owner per truth" — coords are owned by Apply for non-GPS mode; coords are owned by R3.8 for GPS mode; no overlap).

### §3.3 — Hook / service audit layer (Fix D)

#### §3.3.1 — `app-mobile/src/hooks/useSessionManagement.ts:422` audit

**Operation:** Read the full call site at and around line 422. Determine the payload shape.

**Required investigation BEFORE writing the fix (implementor task):**
1. Open `app-mobile/src/hooks/useSessionManagement.ts`. Find the `supabase.rpc('upsert_participant_prefs', ...)` call at line 422.
2. Identify what's in the `p_prefs` object.
3. Classify: (a) FULL payload (sends both `custom_location` AND `custom_lat/lng` together), (b) NO-LOCATION (touches neither custom_location nor custom_lat/lng — irrelevant to bug), or (c) PARTIAL (sends one without the other).

**Action depending on classification:**
- Case (a): Document the verification in the IMPL report; no edit required.
- Case (b): Document; no edit required.
- Case (c): This is a third corruption vector. Apply the same guard pattern as Fix A — `if (use_gps_location !== true) return;` before firing the upsert, OR include `custom_location` in the payload alongside any `custom_lat`/`custom_lng`. Implementor picks based on the caller's intent (which the surrounding code will reveal).

### §3.4 — Data / backfill layer (Fix C)

#### §3.4.1 — Read-only audit SQL (binding — operator-runnable verbatim)

**Purpose:** Enumerate every corrupted row across the entire `collaboration_sessions.participant_prefs` JSONB before any write.

**SQL (operator runs read-only):**
```sql
-- ORCH-0943 Fix C audit: detect all corrupted participant prefs across all sessions
WITH session_prefs AS (
  SELECT
    cs.id AS session_id,
    cs.name AS session_name,
    user_key AS user_id_text,
    cs.participant_prefs -> user_key ->> 'custom_location' AS s_text,
    NULLIF(cs.participant_prefs -> user_key ->> 'custom_lat', '')::float8 AS s_lat,
    NULLIF(cs.participant_prefs -> user_key ->> 'custom_lng', '')::float8 AS s_lng,
    (cs.participant_prefs -> user_key ->> 'use_gps_location')::boolean AS s_use_gps
  FROM collaboration_sessions cs,
       jsonb_object_keys(cs.participant_prefs) AS user_key
  WHERE cs.participant_prefs IS NOT NULL
),
joined AS (
  SELECT
    sp.*,
    p.custom_location AS solo_text,
    p.custom_lat AS solo_lat,
    p.custom_lng AS solo_lng,
    p.use_gps_location AS solo_use_gps
  FROM session_prefs sp
  LEFT JOIN preferences p ON p.profile_id = sp.user_id_text::uuid
)
SELECT
  session_id,
  session_name,
  user_id_text,
  s_use_gps,
  s_text       AS session_text,
  s_lat        AS session_lat,
  s_lng        AS session_lng,
  solo_text,
  solo_lat,
  solo_lng,
  solo_use_gps,
  CASE
    WHEN s_use_gps IS NOT TRUE
     AND s_text IS NOT NULL AND TRIM(s_text) <> ''
     AND solo_text IS NOT NULL AND TRIM(solo_text) <> ''
     AND s_text <> solo_text
    THEN 'TEXT_DRIFTED_FROM_SOLO'
    WHEN s_use_gps IS NOT TRUE
     AND s_lat IS NOT NULL AND s_lng IS NOT NULL
     AND solo_lat IS NOT NULL AND solo_lng IS NOT NULL
     AND (ABS(s_lat - solo_lat) > 0.0001 OR ABS(s_lng - solo_lng) > 0.0001)
    THEN 'COORDS_DRIFTED_FROM_SOLO'
    WHEN s_use_gps IS NOT TRUE
     AND s_text IS NOT NULL AND TRIM(s_text) <> ''
     AND (s_lat IS NULL OR s_lng IS NULL)
    THEN 'TEXT_WITHOUT_COORDS'
    ELSE 'OK'
  END AS corruption_class
FROM joined
WHERE
  s_use_gps IS NOT TRUE
  AND (
    (s_text IS NOT NULL AND TRIM(s_text) <> '' AND solo_text IS NOT NULL AND s_text <> solo_text)
    OR (s_lat IS NOT NULL AND s_lng IS NOT NULL AND solo_lat IS NOT NULL AND solo_lng IS NOT NULL AND (ABS(s_lat - solo_lat) > 0.0001 OR ABS(s_lng - solo_lng) > 0.0001))
    OR (s_text IS NOT NULL AND TRIM(s_text) <> '' AND (s_lat IS NULL OR s_lng IS NULL))
  )
ORDER BY corruption_class, session_id;
```

Expected outcome: at minimum the 2 known rows (`ac7f00ee` and `b17e3e15` in `daadd454-…`) appear with `TEXT_DRIFTED_FROM_SOLO`. Likely more across other sessions.

#### §3.4.2 — Operator-gated backfill write SQL (binding — operator runs after reviewing audit output)

**Purpose:** Restore each corrupted row's session JSONB to the solo `preferences` baseline whenever solo is coherent.

**SQL (operator runs ONLY after reviewing the audit output and confirming the row list):**
```sql
-- ORCH-0943 Fix C backfill: restore session participant_prefs to solo baseline
-- for non-GPS-mode rows where solo is coherent. Run AFTER reviewing the audit
-- output above and confirming each session_id + user_id pair should be restored.
-- Operator may exclude rows from this UPDATE by adding WHERE clauses.
UPDATE collaboration_sessions cs
SET participant_prefs = jsonb_set(
  jsonb_set(
    jsonb_set(
      cs.participant_prefs,
      ARRAY[sp.user_id_text, 'custom_location'],
      to_jsonb(sp.solo_text),
      true
    ),
    ARRAY[sp.user_id_text, 'custom_lat'],
    to_jsonb(sp.solo_lat),
    true
  ),
  ARRAY[sp.user_id_text, 'custom_lng'],
  to_jsonb(sp.solo_lng),
  true
)
FROM (
  SELECT
    cs2.id AS session_id,
    user_key AS user_id_text,
    p.custom_location AS solo_text,
    p.custom_lat AS solo_lat,
    p.custom_lng AS solo_lng,
    (cs2.participant_prefs -> user_key ->> 'use_gps_location')::boolean AS s_use_gps
  FROM collaboration_sessions cs2,
       jsonb_object_keys(cs2.participant_prefs) AS user_key
  LEFT JOIN preferences p ON p.profile_id = user_key::uuid
  WHERE cs2.participant_prefs IS NOT NULL
    AND p.custom_location IS NOT NULL
    AND p.custom_lat IS NOT NULL
    AND p.custom_lng IS NOT NULL
    AND (cs2.participant_prefs -> user_key ->> 'use_gps_location')::boolean IS NOT TRUE
    AND (
      (cs2.participant_prefs -> user_key ->> 'custom_location') <> p.custom_location
      OR (cs2.participant_prefs -> user_key ->> 'custom_lat')::float8 <> p.custom_lat
      OR (cs2.participant_prefs -> user_key ->> 'custom_lng')::float8 <> p.custom_lng
    )
) sp
WHERE cs.id = sp.session_id;
```

**Operator note:** This SQL is binding-textually for the implementor to copy into the IMPL report. The operator executes it manually via the Supabase Management API (or `supabase db push` if they prefer migration-style — but per Mingla rules migrations are operator-owned, so this stays raw SQL).

### §3.5 — Strict-grep + invariant layer (Fix 5)

#### §3.5.1 — NEW invariant in `Mingla_Artifacts/INVARIANT_REGISTRY.md`

**Insertion position:** end of the file, after the most recent invariant entry (likely the META-ORCH-0929 invariants at lines 3706/3720/3734/3748).

**Exact text to insert (implementor writes verbatim):**
```markdown
### I-PROPOSED-CUSTOM-COORDS-LOCKED-WHEN-CUSTOM-LOCATION-MODE

**Statement:** No client may upsert `custom_lat` or `custom_lng` (in either solo `preferences` or session `collaboration_sessions.participant_prefs`) for a participant whose effective `use_gps_location` is `false`, UNLESS the same upsert payload also includes `custom_location` (full coherent save) OR the call site is structurally gated to skip the upsert when `use_gps_location !== true`.

**Why:** Partial upserts that touch only `custom_lat/custom_lng` while leaving `custom_location` untouched cause text-vs-coords divergence. The deck aggregator reads coords for the per-participant reachable-circle computation while the UI shows the text — divergence means the user thinks they're in one city but the aggregator places them elsewhere. Confirmed root cause of Bug-3 / ORCH-0943; live data evidence at investigation report. Source: `INVESTIGATION_ORCH-0943_COLLAB_APPLY_COORD_CORRUPTION.md`.

**Source:** SPEC `Mingla_Artifacts/specs/SPEC_ORCH-0943_COLLAB_APPLY_COORD_CORRUPTION.md` §3.5.1 + §5.2.

**Enforced by:** strict-grep gate `.github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.mjs` (scans `app-mobile/src/` for `upsert_participant_prefs` and `PreferencesService.updateUserPreferences` call sites; flags any payload containing `custom_lat` or `custom_lng` without `custom_location` UNLESS the call site has an explicit `use_gps_location === true` guard within 10 lines above the call).
```

#### §3.5.2 — NEW strict-grep gate

**File:** `.github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.mjs`
**File:** `.github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.test.mjs` (self-test)

The gate scans `app-mobile/src/` recursively. For every line matching `supabase.rpc('upsert_participant_prefs'` OR `PreferencesService.updateUserPreferences(`:
1. Capture the `p_prefs` object literal (multi-line, until matching `})`).
2. Determine: does the payload reference `custom_lat` or `custom_lng`?
3. If yes: does the same payload also reference `custom_location`? If yes → PASS this call site. If no → check the 10 lines above the call for a guard pattern matching `use_gps_location === true` OR `use_gps_location !== false` (literal). If guard present → PASS. If absent → FAIL with file:line.

**Self-test fixtures (the `.test.mjs` exercises):**
- POSITIVE: a call site like `useBoardSession.ts:215`'s full payload (`custom_lat` + `custom_lng` + `custom_location` all in payload) → PASS.
- POSITIVE: the post-fix R3.8 effect (partial payload with `custom_lat`+`custom_lng` BUT preceded by `if (participantUseGps !== true) return;`) → PASS.
- NEGATIVE: the pre-fix R3.8 effect (partial payload, no guard) → FAIL.
- NEGATIVE: a hypothetical partial payload with `custom_location` only (no lat/lng) → PASS (it's the inverse direction, not the bug-class).

**Workflow yml registration (binding):** Add a new job block to `.github/workflows/strict-grep-mingla-business.yml` mirroring the ORCH-0939/0931 pattern, plus add the registry-list comment entry near the top of the file. The implementor's surgical edit follows the existing pattern verbatim.

### §3.6 — Layers NOT touched

| Layer | Status |
| --- | --- |
| Database schema (tables, RLS) | NO CHANGE — only data backfill |
| Edge functions | NO CHANGE |
| Service layer | `PreferencesService.updateUserPreferences` UNTOUCHED (it's used by full-payload callers; per-call audit happens via Fix D and strict-grep gate, not by changing the service itself) |
| Hook layer | `useBoardSession.updatePreferences` UNTOUCHED (verified full payload) |
| Realtime | NO CHANGE |
| Memory files | NO CHANGE — no operator memory updates needed |
| WORLD_MAP / MASTER_BUG_LIST / etc. | Orchestrator owns these on CLOSE; SPEC doesn't direct them |
| EAS OTA | Operator decides at CLOSE — likely YES because UX behavior changes visibly |
| Vercel `[deploy]` tag | NO — mobile-only diff |

---

## §4 — Success Criteria

Each criterion is observable, testable, unambiguous.

| # | Criterion | Verification |
| --- | --- | --- |
| **SC-01** | `RecommendationsContext.tsx` R3.8 effect contains a guard reading `boardSessionResult.preferences?.use_gps_location` and returning early when it's not `true` | `grep -nE "participantUseGps|preferences\?.use_gps_location" app-mobile/src/contexts/RecommendationsContext.tsx` matches lines within the R3.8 effect block (lines ~1438-1465 post-fix) |
| **SC-02** | R3.8 effect's dependency array includes `boardSessionResult.preferences?.use_gps_location` | same file, manual read of the dep array |
| **SC-03** | `PreferencesSheet.tsx` `handleApplyPreferences` contains auto-resolve logic that calls `geocodingService.autocomplete(searchLocation)` when `!useGpsLocation && searchLocation.length > 0 && selectedCoords === null` | grep `geocodingService\.autocomplete\|tap a suggestion` in the file returns matches inside `handleApplyPreferences` body (lines ~804-907) |
| **SC-04** | `PreferencesSheet.tsx` line 692's `hasLocation` predicate drops the `&& selectedCoords !== null` clause (per binding choice in §3.1.2 option i) | `grep -n "hasLocation" app-mobile/src/components/PreferencesSheet.tsx` shows the new shape at both lines 692 + 716 |
| **SC-05** | When auto-resolve fails, the save handler calls `toastManager.warning("Tap a suggestion to set your location.", 3000)` and returns early without firing any save | source-trace + happy-path regression test T-04 below |
| **SC-06** | When auto-resolve succeeds, the resolved coords flow into BOTH the solo branch's save payload AND the collab branch's save payload via local variables (not stale closure state from setSelectedCoords) | adversarial regression test T-02 |
| **SC-07** | `useSessionManagement.ts:422` audit complete — IMPL report documents the payload classification (full/partial/no-location) and the action taken (no-op / guard added) | IMPL report includes the verbatim payload object + classification |
| **SC-08** | NEW invariant `I-PROPOSED-CUSTOM-COORDS-LOCKED-WHEN-CUSTOM-LOCATION-MODE` appears in `Mingla_Artifacts/INVARIANT_REGISTRY.md` | `grep "I-PROPOSED-CUSTOM-COORDS-LOCKED" Mingla_Artifacts/INVARIANT_REGISTRY.md` returns ≥1 line |
| **SC-09** | NEW strict-grep gate `.github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.mjs` exists and PASSES against the full post-fix codebase | `node .github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.mjs` exits 0 |
| **SC-10** | NEW strict-grep gate self-test exists and passes | `node --test .github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.test.mjs` exits 0 |
| **SC-11** | Workflow yml `strict-grep-mingla-business.yml` contains a job block for the new gate, mirroring the ORCH-0939/0931 pattern | grep `i-proposed-orch-0943-custom-coords-locked` in the workflow yml returns 2 lines (self-test + main run) |
| **SC-12** | Implementor writes the audit SQL (§3.4.1) verbatim into the IMPL report + provides backfill SQL (§3.4.2) verbatim for the operator to execute. NO migration push is part of this ORCH. | IMPL report contains both SQL blocks |
| **SC-13** | All existing strict-grep gates still PASS post-fix (ORCH-0939, ORCH-0931, ORCH-0942, META-ORCH-0929 + all prior gates) | implementor runs full strict-grep matrix locally; IMPL report shows green |
| **SC-14** | Scoped TypeScript check on the edited files produces zero new errors against `origin/main` baseline | `cd app-mobile && npx tsc --noEmit src/contexts/RecommendationsContext.tsx src/components/PreferencesSheet.tsx src/hooks/useSessionManagement.ts` |
| **SC-15** | Two regression tests committed per Step 0.5 mandate: implementor happy-path + tester adversarial (see §6) | both file paths exist + both passing run cited in IMPL/QA reports |
| **SC-16** | No file under `supabase/`, `mingla-business/`, `mingla-admin/`, `packages/` is modified | `git diff --name-only origin/main -- supabase/ mingla-business/ mingla-admin/ packages/` returns empty |
| **SC-17** | No memory file under `~/.claude/projects/.../memory/` is modified | git status check |
| **SC-18** | (Live verification — tester) Tester drives a non-GPS custom-location pick on iPro Max sim; immediately probes session JSONB via read-only SQL; coords remain coherent with text AFTER multiple GPS-update cycles | tester report includes Maestro flow + SQL snapshot |
| **SC-19** | (Live verification — tester) Tester types free text without picking, taps Apply; verifies auto-resolve fires (Metro log) OR fails-with-toast (screenshot) | tester report includes Metro log excerpt + screenshot |
| **SC-20** | (Live verification — tester) `daadd454-…` Testing stuff session post-backfill: SQL audit returns zero rows with corruption_class != 'OK' for the 4 known participants | tester report includes pre-backfill + post-backfill audit query output |

---

## §5 — Invariants

### §5.1 — Existing invariants this change must preserve

| Invariant | Description | How preserved |
| --- | --- | --- |
| `I-PROPOSED-META-0929-COLLAB-DECK-SINGLE-MOUNT` (line 3720) | Single collab deck mount | UNTOUCHED — no edits to `CollabDeckSheet.tsx` or its mount path |
| `I-PROPOSED-META-0929-HOME-IS-SOLO-ONLY` (line 3734) | HomePage cannot pass collab props to SwipeableCards | UNTOUCHED |
| `I-PROPOSED-META-0929-NO-GLOBAL-ACTIVE-SESSION` (line 3748) | No global active-session concept | UNTOUCHED |
| `I-PROPOSED-ORCH-0939-COLLAB-DECK-HAS-PER-SESSION-PROVIDER` | Per-session provider wrap on CollabDeckSheet | UNTOUCHED |
| `I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME` | Realtime no PK-filter | UNTOUCHED |
| Constitution rule #2 (one owner per truth) | No duplicate state authorities | RESTORED by Fix A — coords now have ONE owner per mode (Apply for non-GPS; R3.8 for GPS) |
| Contract 1 of `PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` | text matches coords | RESTORED by Fix B1 — auto-resolve enforces the invariant at the client save site |

### §5.2 — New invariants this change establishes

| Invariant | Description |
| --- | --- |
| `I-PROPOSED-CUSTOM-COORDS-LOCKED-WHEN-CUSTOM-LOCATION-MODE` | Per §3.5.1 above. Enforced by the new strict-grep gate. |

---

## §6 — Test Cases

Per Step 0.5 of the CLOSE protocol (ORCH-0840 [Regression-test enforcement + append-only CI]), TWO regression tests are mandatory:

### §6.1 — Implementor happy-path regression test

**File path:** `app-mobile/src/components/__tests__/orch-0943-prefs-apply-coord-coherence.test.tsx`

| Test | Scenario | Input | Expected | Layer |
| --- | --- | --- | --- | --- |
| **T-01** | Auto-resolve succeeds when typed text matches a known suggestion | Mock geocodingService.autocomplete returns `[{location: {lat: 40.7128, lng: -74.0060}, displayName: "New York", fullAddress: "New York, NY, USA"}]`; user types "New York"; selectedCoords=null; useGpsLocation=false; tap Apply | save payload contains custom_location="New York, NY, USA", custom_lat=40.7128, custom_lng=-74.0060; toast NOT shown; sheet closes (collab) / closes (solo) | Component |
| **T-02** | Auto-resolved coords flow into save payload despite React state batching | Same as T-01 + verify the local variable in handleApplyPreferences (not the React state) carries the resolved coords into the updateBoardPreferences call | save payload's `custom_lat` matches the geocoded value, NOT stale `selectedCoords?.lat` (which is null at the moment the payload is constructed) | Component (state-flow) |
| **T-03** | Auto-resolve fails (no suggestions) → toast + save blocked | Mock autocomplete returns `[]`; user types "asdjkfh"; selectedCoords=null; useGpsLocation=false; tap Apply | toastManager.warning called with "Tap a suggestion to set your location."; isSavingRef.current reset to false; updateBoardPreferences NOT called; sheet stays open | Component |
| **T-04** | Auto-resolve fails (network error) → toast + save blocked | Mock autocomplete throws; same other setup as T-03 | identical to T-03; console.warn called with the error | Component (error path) |
| **T-05** | R3.8 effect does NOT fire when use_gps_location=false | Mount RecommendationsContext with isCollaborationMode=true, resolvedSessionId valid, userLocation={lat,lng}, user.id valid, AND boardSessionResult.preferences.use_gps_location=false; spy on supabase.rpc | supabase.rpc('upsert_participant_prefs', ...) NOT called | Context (effect) |
| **T-06** | R3.8 effect DOES fire when use_gps_location=true | Same as T-05 but with use_gps_location=true | supabase.rpc called with the GPS coords in payload | Context (effect) |

**Fails-on-revert verification:** implementor reverts Fix A (removes the guard) and confirms T-05 fails (rpc IS called when it shouldn't be). Implementor reverts Fix B1 (removes the auto-resolve block) and confirms T-01/T-03 fail. Cited in IMPL report with commit hash for each revert.

### §6.2 — Tester adversarial regression test

**File path:** `app-mobile/scripts/ci/orch-0943-adversarial-check.mjs` (script-based, mirrors prior ORCH-0918/0928 pattern)

Adversarial angles (must attack DIFFERENT angles than implementor's happy-path):

| Test | Adversarial scenario | Expected guard |
| --- | --- | --- |
| **T-A01** | Race: user types "Brooklyn" + Apply fires WHILE autocomplete debounce is still pending (selectedCoords=null mid-flight) | Fix B1's auto-resolve catches it; either resolves to Brooklyn coords or fails with toast |
| **T-A02** | Boundary: user types EXACTLY 4 chars (the autocomplete-trigger threshold per line 569) and immediately taps Apply | Fix B1 still fires auto-resolve regardless of debounce timer state |
| **T-A03** | Bounds: mocked autocomplete returns a suggestion with `location: {lat: 91, lng: 0}` (invalid latitude > 90) | Bounds validation at line 610 pattern rejects; auto-resolve treats as failure → toast |
| **T-A04** | Empty whitespace: user types "    " (4 spaces); selectedCoords=null; Apply | Auto-resolve does NOT fire (trim().length === 0); existing form-validation handles |
| **T-A05** | GPS-toggle race: user has useGpsLocation=true, then toggles to false WITHOUT picking a suggestion, then Apply | Auto-resolve runs against searchLocation (which may be restored from savedCustomLocation per line 642); either resolves or fails-with-toast |
| **T-A06** | R3.8 partial-upsert attempt with use_gps_location=false mid-firing (e.g. user toggled GPS off after the effect's dep array captured true) | The current-render preferences.use_gps_location read is the freshest; guard works |
| **T-A07** | Strict-grep gate adversarial: add a hand-crafted file with `supabase.rpc('upsert_participant_prefs', { p_prefs: { custom_lat: 1, custom_lng: 2 } })` and NO `use_gps_location === true` guard above | Strict-grep gate FAILS that file with file:line citation |
| **T-A08** | Strict-grep gate adversarial: same hand-crafted call site BUT with a `use_gps_location === true` guard 8 lines above | Strict-grep gate PASSES (within 10-line window) |
| **T-A09** | Solo path: AppHandlers.tsx Apply path with `data.manualLocation` set + lat/lng not provided | (Out of scope for ORCH-0943 fix; flag as latent vulnerability for ORCH-0944; the adversarial test asserts that the strict-grep gate WOULD catch this pattern if exercised) |
| **T-A10** | Live DB probe (read-only): post-fix audit SQL returns 0 rows with `corruption_class != 'OK'` for `daadd454-…` (and any other sessions operator chose to backfill) | DB state post-backfill confirmed clean |

**Fails-on-revert:** tester reverts the strict-grep gate addition → T-A07 + T-A08 should both fail to even compile/run (script doesn't exist).

---

## §7 — Implementation Order

The implementor performs these steps in this exact order:

1. **Pre-flight:** `git checkout Seth`, `git pull --ff-only origin Seth`, `git status --short`. Abort if `app-mobile/src/contexts/RecommendationsContext.tsx`, `app-mobile/src/components/PreferencesSheet.tsx`, or `app-mobile/src/hooks/useSessionManagement.ts` is dirty (operator must clean first or authorize).

2. **Fix B1 — PreferencesSheet.tsx surgical edit:**
   - Add auto-resolve block at top of `handleApplyPreferences` per §3.1.1 binding pattern
   - Modify `hasLocation` predicate at line 692 + 716 per §3.1.2 option (i)
   - Thread resolved coords through local variables into payload construction (lines 837-838 solo + lines 861-862 collab) — verify with the test T-02

3. **Fix A — RecommendationsContext.tsx surgical edit:**
   - Add the `participantUseGps !== true` guard at the top of the R3.8 effect per §3.2.1 binding pattern
   - Add `boardSessionResult.preferences?.use_gps_location` to the dep array

4. **Fix D — useSessionManagement.ts audit + conditional edit per §3.3.1 classification.**

5. **Write the two regression tests** at the paths in §6.1 + §6.2 with the binding test cases. Run them. Run fails-on-revert verification.

6. **Fix 5 — strict-grep gate:**
   - Author `.github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.mjs` per §3.5.2 spec
   - Author self-test `.test.mjs` with binding positive/negative cases
   - Register the gate's job block in `.github/workflows/strict-grep-mingla-business.yml`
   - Add registry-list comment entry near the top of the workflow yml
   - Run both scripts locally — both must PASS against the post-fix codebase

7. **Fix 5 (continued) — invariant registry:**
   - Add `I-PROPOSED-CUSTOM-COORDS-LOCKED-WHEN-CUSTOM-LOCATION-MODE` block to `Mingla_Artifacts/INVARIANT_REGISTRY.md` per §3.5.1 exact text

8. **Fix C — backfill SQL** (implementor writes both blocks into the IMPL report verbatim from §3.4.1 + §3.4.2. Implementor does NOT execute the write SQL — operator does. Operator may run the read-only audit at any time.)

9. **Run full local check matrix:**
   - Scoped tsc on the 3 edited files + their dependency chain
   - The 6 implementor regression tests (T-01..T-06) — all PASS
   - The new strict-grep gate self-test
   - The new strict-grep gate against the live codebase
   - All existing strict-grep gates (ORCH-0939, ORCH-0931, ORCH-0942, META-ORCH-0929, etc.) — all PASS

10. **Write IMPL report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0943_COLLAB_APPLY_COORD_CORRUPTION.md` with: file-by-file old→new receipts, every SC-XX mapped to evidence, all T-XX results with exact commands and exit codes, fails-on-revert citations, the backfill SQL blocks verbatim, the useSessionManagement.ts:422 audit classification + action, and a "no out-of-scope files modified" declaration backed by `git status --short`.

11. **Stage scoped files:** `git add` only files within the SPEC §1 IN scope. Run `git status --short` to confirm. Do NOT stage `OnboardingFlow.tsx` (NON-goal 8) or any unrelated dirty work.

12. **Commit** with subject containing `[TEST-MOD-APPROVED ORCH-0943]` ONLY IF the implementor needed to modify any existing test file. If only new test files are added (the typical case), the `[TEST-MOD-APPROVED]` token is not required. The orchestrator will verify at CLOSE.

13. Return to orchestrator for REVIEW; do NOT push, open PR, or merge.

---

## §8 — Regression Prevention

1. **The new strict-grep gate** is the structural safeguard. Any future contributor who adds a `upsert_participant_prefs` or `PreferencesService.updateUserPreferences` call with partial coord payload (without `custom_location` in the same payload AND without an explicit `use_gps_location === true` guard within 10 lines) will FAIL CI immediately.

2. **The two regression tests** catch silent breakages: implementor happy-path proves the guard fires; tester adversarial proves the gate catches new violations + the live data stays clean.

3. **The invariant in INVARIANT_REGISTRY.md** documents the rule for future investigators / orchestrators reading the registry.

4. **Code comments in the fix sites** (per §3.1.1 + §3.2.1 binding patterns) cite ORCH-0943 + DEC-NNN so future maintainers understand WHY the guard exists.

5. **The backfill** ensures historical data is restored. Future writes are gated by the fix; historical corruption is gated by the SQL.

---

## §9 — Discoveries forwarded from Investigation

Per investigation §"Discoveries for Orchestrator":

1. `useSessionManagement.ts:422` — addressed by Fix D + SC-07.
2. Other sessions beyond `daadd454-…` likely have corruption — addressed by Fix C (system-wide audit) + SC-12 + T-A10.
3. R3.8 comment is misleading — addressed by the new comment in §3.2.1 binding code pattern.
4. Marcus's pending GPS — NOT corruption; explicitly documented as non-issue.
5. Chat-native sheet META-ORCH unblocked once ORCH-0943 ships — operator decides next dispatch.

Plus this SPEC's own discovery:
6. `OnboardingFlow.tsx:1578` latent vulnerability (text-without-coords partial save) — register as **ORCH-0944 [Onboarding partial-coord vector]** P3 follow-up. Out of scope here per NON-goal 8.

---

## §10 — Files Touched (consolidated)

| Operation | File | Bytes/Lines change |
| --- | --- | --- |
| EDIT | `app-mobile/src/contexts/RecommendationsContext.tsx` | +~15 lines (guard + dep + comment) |
| EDIT | `app-mobile/src/components/PreferencesSheet.tsx` | +~40 lines (auto-resolve block) + 2 lines modified (hasLocation predicate) |
| EDIT (conditional, per §3.3.1 classification) | `app-mobile/src/hooks/useSessionManagement.ts` | 0 or +~5 lines depending on payload classification |
| NEW | `app-mobile/src/components/__tests__/orch-0943-prefs-apply-coord-coherence.test.tsx` | T-01..T-06 |
| NEW | `app-mobile/scripts/ci/orch-0943-adversarial-check.mjs` | T-A01..T-A10 |
| NEW | `.github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.mjs` | gate script |
| NEW | `.github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.test.mjs` | gate self-test |
| EDIT | `.github/workflows/strict-grep-mingla-business.yml` | +~17 lines (job block + registry-list comment) |
| EDIT | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | +~15 lines (DEC + invariant) |
| NEW | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0943_COLLAB_APPLY_COORD_CORRUPTION.md` | implementor's report |

Total: 6 file edits, 4 new files. Plus the operator-executed backfill SQL (read-only audit + write UPDATE) which is OUT of git scope — runs via the Supabase Management API or equivalent.

Net diff approximately +120 lines product code + tests + gates + ~15 lines registry.

---

## §11 — Spec sign-off

This SPEC is bound by the verified-root-cause + live-data evidence in the investigation. The implementor MUST treat the investigation's classifications as load-bearing:

- The R3.8 effect is PROVEN ROOT CAUSE — Fix A addresses it directly.
- The Apply path's text-without-coord vulnerability is a STRUCTURAL flaw exposed by operator's direct UX observation — Fix B1 addresses it.
- The data corruption in `daadd454-…` is PROVEN via SQL probe — Fix C cleans it up.

If the implementor finds a contradiction between this SPEC and the actual filesystem state at the time of implementation (e.g. the R3.8 effect was moved, the geocodingService API changed, or useBoardSession's return shape no longer includes preferences.use_gps_location), STOP and report. Do NOT improvise.

---

## End of SPEC. Next phase: IMPLEMENT.
