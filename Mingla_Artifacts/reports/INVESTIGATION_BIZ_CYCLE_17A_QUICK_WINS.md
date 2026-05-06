# INVESTIGATION — BIZ Cycle 17a (Quick Wins — Pre-SPEC Verification)

**Cycle:** 17a (BIZ — Refinement Pass mini-cycle 1)
**Mode:** INVESTIGATE — verification of pre-existing flags + 1 new founder-reported regression
**Generated:** 2026-05-04
**Confidence:** High overall — 5 of 6 items are root-cause-proven via direct code trace; 1 is operator-side (Item E) and provides instructions only

---

## 1. Layman summary

Six items investigated. Five have ✅ ready-for-SPEC verdicts; one (Item E — Supabase email template) is an operator dashboard check.

**Headline finding (Item A — missing `+` button):** Not a regression. Not "never shipped." It's a **right-slot replacement bug** — `events.tsx` swaps the entire TopBar right cluster (default `[search, bell]`) for a single `+` icon. Visible result: the events tab shows ONLY `+` (no search, no bell); other primary tabs show `[search, bell]` (no `+`). The user is correctly noting that the events tab feels broken. Severity **S2** (UX confusion, no flow blocked — search/bell exist on home tab; `+` is still tappable).

**Item B (toastWrap duplicate):** confirmed — `events.tsx` lines 711-719 vs 720-726, second clobbers first, removes `zIndex: 100` and `elevation: 12`. Toast risks rendering BEHIND other absolute-positioned children on this surface. ~30-second fix.

**Item C (brandMapping Brand type drift):** confirmed and **bigger than first thought** — three required fields on the UI `Brand` type (`kind`, `address`, `coverHue`) added during Cycle 7 FX2 are NEVER mapped from the DB row, and the `BrandRow` interface doesn't even include them. `mapBrandRowToUi` returns an object that fails to satisfy the `Brand` type. The code currently runs because the DB-backed paths probably aren't fully exercised yet (stub brands populate via STUB_BRANDS, real-DB paths are mostly B-cycle). Quick-win fix: defaults in mapper + matching BrandRow extension OR a new I-37 invariant that the UI Brand fields stay derived/optional.

**Item D (4 stale TRANSITIONAL markers):** mixed verdicts.
- `recurrenceRule.ts:9` and `:224` — **SUBTRACT (comment-update only)**: util IS still used (11 consumers); `[TRANSITIONAL]` tag is misleading.
- `BrandProfileView.tsx:286` — **PARTIAL SUBTRACT**: J-A12 reference is stale (J-A12 shipped Cycle 2); Tax & VAT row remains TRANSITIONAL.
- `BrandProfileView.tsx:62` and `:574` — **KEEP**: stub past-events still used because `liveEventStore` past-events derivation is a 17b concern.

**Item E (Supabase email template):** 5-step operator dashboard check — not code work.

**Item F (canManualCheckIn allowlist):** 5 hits confirmed all legitimate (migration code that strips the dropped field). Need 5 allowlist comments.

**Apple JWT (D-IMPL-46):** orchestrator's recommendation to CLOSE as already-mitigated stands — autorotate spec + scheduled remote agent + this investigation found nothing actionable.

**Ready-for-SPEC count:** 6 of 6 ✅. Operator review can proceed straight to SPEC authoring.

---

## 2. Item A — Missing `+` button on events page

### 2.1 Symptom

Operator-reported: "the + button, when you navigate to the events page is missing. + for adding events, and the notification, and search should be constant on the top bar at all times."

### 2.2 Root cause (proven, six-field evidence)

🔴 **Root Cause — events.tsx replaces the entire TopBar right-slot instead of composing with the default [search, bell] cluster**

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/app/(tabs)/events.tsx:393-403` |
| **Exact code** | `rightSlot={ canCreateEvent ? (<IconChrome icon="plus" .../>) : null }` |
| **What it does** | Passes EITHER a single `+` IconChrome (when `canCreateEvent === true`) OR `null` to TopBar's `rightSlot` prop. `null` triggers TopBar's nullish-coalescing fallback (`rightSlot ?? <DefaultRightSlot ...>`) which DOES render search + bell. |
| **What it should do** | When the events tab is active, the TopBar right cluster should render `[search, bell, +]` — search + bell are constant per founder feedback; `+` is the events-tab-specific addition. When `canCreateEvent === false` (operator's role lacks `event_manager` rank), only `[search, bell]` shows. |
| **Causal chain** | (1) Operator opens events tab → (2) `EventsTab` renders `<TopBar rightSlot={canCreateEvent ? <IconChrome plus /> : null} />` → (3) When the gate passes, ONLY `+` reaches the right slot, replacing the default `[search, bell]` cluster (TopBar.tsx:184 `rightSlot ?? <DefaultRightSlot/>`). When the gate fails, default `[search, bell]` shows but `+` is gone. → (4) User sees `+`-only on events tab; search and bell never co-exist with `+`. |
| **Verification step** | Read `mingla-business/src/components/ui/TopBar.tsx:184` — confirms `{rightSlot ?? <DefaultRightSlot ...>}` only falls back when `rightSlot` is nullish. Any non-null `rightSlot` (including the single `+`) replaces the default. |

### 2.3 Five-layer cross-check

| Layer | Finding |
|---|---|
| **Docs** | `TopBar.tsx:51-52` says `rightSlot` is "Right slot content. If undefined, renders default search + bell IconChromes." Defines the fallback contract clearly — but doesn't define a composition contract. |
| **Schema** | N/A — pure UI component |
| **Code** | `events.tsx:393-403` confirmed; `TopBar.tsx:184` confirmed; default `DefaultRightSlot` at lines 78-92 confirmed |
| **Runtime** | Cannot verify on device, but flow is deterministic from code |
| **Data** | Independent of data state |

### 2.4 Severity verdict — **S2 (UX, not flow-breaking)**

- Event creation is still reachable via the visible `+` (when permitted) and via the empty-state CTA at `events.tsx:472-481`
- Search + bell are reachable from home tab
- No security, data, or auth implication
- BUT: operator's mental model is "top bar always has [search, bell] + maybe extras" — current behavior breaks that contract on the busiest tab

### 2.5 Recommended fix shape (for SPEC author)

**Tactical 17a fix (~30 min, minimal scope):** Change `events.tsx:393-403` from a single-icon rightSlot to a composed cluster:

```tsx
rightSlot={
  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
    <IconChrome icon="search" size={36} accessibilityLabel="Search" />
    <IconChrome icon="bell" size={36} accessibilityLabel="Notifications" />
    {canCreateEvent ? (
      <IconChrome icon="plus" size={36} onPress={handleBuildEvent} accessibilityLabel="Build a new event" />
    ) : null}
  </View>
}
```

(Search and bell handlers remain unwired per the existing `[TRANSITIONAL]` marker on `TopBar.tsx:82-83` — that marker becomes the bridge into 17b's structural rework.)

**Why not refactor TopBar.tsx in 17a:** The structural fix is "TopBar always renders default cluster, pages can compose extras via `extraRightSlot` prop" — that's exactly what 17b "top-bar IA reset" is for (D-17-12). 17a should solve the events-tab user-visible symptom only; 17b solves the cross-surface structural issue.

### 2.6 Blast radius

- Solo path only — no collab equivalent
- Other primary surfaces (home, account, scanner) keep current behavior — 17b will revisit them
- 17b structural rework will refactor this 17a tactical fix; that's expected per sequential mini-cycle pattern

### 2.7 Invariant violations

None. Const #1 ("No dead taps") is preserved (the `+` still works); the "constant top bar" guarantee is implicit, not registered as an invariant.

**Recommendation for new invariant** (defer to 17b): **I-37 — TopBar default right-slot cluster `[search, bell]` MUST be visible on every primary tab surface; pages may ADD icons but MUST NOT replace the default cluster.**

### 2.8 Ready for SPEC: ✅

---

## 3. Item B — events.tsx duplicate `toastWrap`

### 3.1 Verification verdict — ✅ STILL PRESENT

Confirmed at `mingla-business/app/(tabs)/events.tsx:711-726`.

### 3.2 Exact diff

**Current (broken):**
```ts
toastWrap: {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: spacing.xl,
  paddingHorizontal: spacing.md,
  zIndex: 100,
  elevation: 12,
},
toastWrap: {                    // ← duplicate key, clobbers above
  position: "absolute",
  left: 0,
  right: 0,
  bottom: spacing.xl,
  paddingHorizontal: spacing.md,
},
```

**Target (fixed):**
```ts
toastWrap: {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: spacing.xl,
  paddingHorizontal: spacing.md,
  zIndex: 100,
  elevation: 12,
},
```

(Delete lines 720-726 — the second declaration. Keep the first which has full layering tokens.)

### 3.3 Severity escalation note

In the dispatch this was logged as S2 (tsc-error). Reading the actual code: it's a **silent style override** at runtime as well — TS2300 "Duplicate identifier 'toastWrap'" should fire under strict mode. If it ISN'T firing, that means: (a) the project's `tsconfig` doesn't enable the relevant check on object-literal duplicate keys, OR (b) the file isn't actually type-checked in CI. Either way, runtime behavior is wrong: the toast loses `zIndex: 100` + `elevation: 12`, meaning it can render BEHIND other absolute-positioned children (`Manage menu Sheet`, `BrandSwitcherSheet`, `ConfirmDialog`, etc.) on this surface.

**Recommendation:** treat as S2-tsc-error AND latent S3-runtime-bug. Fix in 17a SPEC.

### 3.4 Ready for SPEC: ✅

---

## 4. Item C — brandMapping Brand type drift

### 4.1 Verification verdict — ✅ STILL PRESENT and BIGGER THAN FLAGGED

The flagged "line 180" actually points to the END of the `mapBrandRowToUi` return statement. The drift is across THREE artifacts:

1. **UI `Brand` type** (`mingla-business/src/store/currentBrandStore.ts:229-273+`) — adds three required fields in Cycle 7 schema v10/v11:
   - `kind: "physical" | "popup"` (line 251) — REQUIRED, no `?`
   - `address: string | null` (line 262) — REQUIRED, but nullable
   - `coverHue: number` (line 272) — REQUIRED, no `?`

2. **`BrandRow` interface** (`mingla-business/src/services/brandMapping.ts:26-46`) — represents `public.brands` columns; **does NOT include any of the three Cycle 7 fields**.

3. **`mapBrandRowToUi` return** (`mingla-business/src/services/brandMapping.ts:180-198`) — returns `{ id, displayName, slug, photo, role, stats, currentLiveEvent, bio, tagline, contact, links, displayAttendeeCount }` — **omits `kind`, `address`, `coverHue` entirely**.

This means `mapBrandRowToUi`'s return value FAILS to satisfy the `Brand` type signature. TypeScript should flag with TS2741 "Property 'kind' is missing in type ... but required in type 'Brand'" (and same for `coverHue`).

### 4.2 Why the code currently "works"

- `mapBrandRowToUi` is the bridge from real DB rows → UI Brand. **Real-DB code paths are mostly B-cycle territory** — e.g., `BrandSwitcherSheet` create-brand flow that inserts into `public.brands` and reads it back. Most current UI consumers populate `Brand` from `STUB_BRANDS` in `brandList.ts`, which already has `kind` + `address` + `coverHue` fully populated.
- Whether tsc currently fails depends on `tsconfig.json` settings + which files actually exercise `mapBrandRowToUi`. **The function has been a ghost path** waiting for B-cycle.

### 4.3 Canonical-side decision

- **UI Brand is canonical for now** — Cycle 7 FX2 added the fields with operator approval; they're consumed in `BrandEditView`, `PublicBrandPage`, `BrandProfileView`, etc.
- **DB schema is BEHIND** — `brands` table doesn't have `kind`/`address`/`coverHue` columns yet. Adding them is B-cycle scope (real backend wiring).

### 4.4 Recommended fix shape (for SPEC author)

**Tactical 17a fix (~45 min):** Make `mapBrandRowToUi` provide safe defaults for the 3 UI-only fields without touching DB schema:

```ts
return {
  id: row.id,
  displayName: row.name,
  slug: row.slug,
  // Cycle 7 FX2 UI fields — DB schema doesn't carry these yet (B-cycle).
  // Default to: kind="popup" (safer — no fake address), address=null,
  // coverHue=25 (warm-orange, matches accent.warm scheme). When B-cycle
  // adds the columns, these defaults flip to row-derived values + the
  // BrandRow interface gains the three fields.
  kind: "popup",
  address: null,
  coverHue: 25,
  photo: row.profile_photo_url ?? undefined,
  // ... rest unchanged
};
```

**Add a `[TRANSITIONAL]` marker** on the three default lines with EXIT condition: "B-cycle adds `kind`/`address`/`cover_hue` columns to `brands` table → mapper reads from `row` and BrandRow interface is updated."

**Alternative (REJECTED):** Add columns to `brands` table now. Out of 17a scope — it's a B-cycle migration.

### 4.5 Ready for SPEC: ✅

---

## 5. Item D — Stale TRANSITIONAL marker verdicts

| File:line | Marker | EXIT condition status | Verdict |
|---|---|---|---|
| `recurrenceRule.ts:9` | "consumed by Cycle 9 publish edge fn" | Cycle 9 shipped + util IS used by 11 consumers (verified via grep: EditPublishedScreen, liveEventStore, draftEventStore, scheduleDateExpansion, eventDateDisplay, draftEventValidation, EventCreatorWizard, CreatorStep2When, liveEventAdapter, liveEventConverter, recurrenceRule itself) | **SUBTRACT marker (comment-only update)** — util stays; remove the `[TRANSITIONAL]` tag from the file header comment. Replace with: "Used by Cycle 4 wizard validators + Cycle 9 publish flow." |
| `recurrenceRule.ts:224` | "consumed by Cycle 9 publish edge function. Unused in Cycle 4" | Same as above | **SUBTRACT marker (comment-only update)** — both Cycle 4 wizard AND Cycle 9 publish use it now. Remove `[TRANSITIONAL]` and the "Unused in Cycle 4" claim. |
| `BrandProfileView.tsx:62` | "stub past-events list — replaced by real event fetch in Cycle 3 when event endpoints land" | Cycle 3 shipped wizard, but `liveEventStore` past-events derivation in this view is NOT shipped (still uses `STUB_PAST_EVENTS`); `liveEventStore` itself is still client-only (B-cycle for real persistence) — but past-events COULD be derived from existing `useLiveEventsForBrand` filtered to past status | **KEEP — still accurate**, but **flag for 17b consideration** as a cosmetic-data-fidelity fix (replace `STUB_PAST_EVENTS` with `useLiveEventsForBrand(brand.id).filter(deriveLiveStatus(e) === "past")` — same client-side data, no schema change, restores cycle-event derivation honesty). Out of 17a scope. |
| `BrandProfileView.tsx:286` | "remaining inert rows — exit when J-A12 (Finance reports) lands. Tax & VAT row stays TRANSITIONAL until §5.3.6" | J-A12 SHIPPED Cycle 2 (`onReports` callback exists, Operations row "Finance reports" wired in same component); Tax & VAT row IS still TRANSITIONAL | **PARTIAL SUBTRACT** — update marker to: "Tax & VAT row stays TRANSITIONAL until §5.3.6 settings cycle." (Drop the J-A12 reference; the row it described is already wired.) |
| `BrandProfileView.tsx:574` | "stub past-event rows — replaced by real fetch in Cycle 3" | Same situation as BrandProfileView.tsx:62 — sibling marker | **KEEP — still accurate** (same rationale as :62) |

**Net 17a action:** 3 markers updated (recurrenceRule.ts:9, :224, BrandProfileView.tsx:286), 2 kept (BrandProfileView.tsx:62, :574). Total ~10 minutes.

### 5.1 Ready for SPEC: ✅

---

## 6. Item E — Supabase email template operator instructions

### 6.1 Verdict — ⚠️ Operator-side check (no code change)

The Cycle 15 email-OTP flow uses `supabase.auth.signInWithOtp({ email })` (verified in `mingla-business/src/context/AuthContext.tsx`, the existing `signInWithEmail` callback). Supabase's `signInWithOtp` triggers the **Magic Link** email template by default, which includes both `{{ .ConfirmationURL }}` (the magic link) AND `{{ .Token }}` (the 6-digit code) — but the body PRESENTATION is template-customisable. Cycle 15 chose Option 2 (6-digit code paste-back), so the template MUST present the code prominently and either omit the URL or de-emphasise it.

### 6.2 5-step operator instructions (paste into 17a SPEC verbatim)

1. **Navigate** to Supabase Dashboard → Authentication → Email Templates → **Magic Link** (NOT "Confirm Signup" — that's a different template).

2. **Confirm body uses `{{ .Token }}`** prominently. Recommended verbatim body:
   ```
   Hi,

   Your Mingla Business sign-in code:

   {{ .Token }}

   Enter this 6-digit code in the app to sign in. The code expires in 60 minutes.

   If you didn't request this, ignore this email.

   — Mingla Business
   ```

3. **Confirm `{{ .ConfirmationURL }}` is NOT in the body.** If present, the user might tap the link instead of entering the code, and the link returns to a default Supabase confirmation page rather than the mobile app. Remove the entire URL block.

4. **Confirm subject line** says something like "Your Mingla Business sign-in code" (NOT "Sign in to Mingla").

5. **Test:** sign in with email-OTP from the Mingla Business mobile app (TestFlight or dev build). Verify (a) email arrives within 30s, (b) body shows the 6-digit code, (c) code is enterable in the app and verifies successfully, (d) no link in the email body.

### 6.3 If the template body is wrong

This is a **dashboard config change, no code work**. 17a SPEC includes the verbatim instructions; operator executes them in Supabase Dashboard during the 17a deploy window.

### 6.4 Ready for SPEC: ✅ (instructions only — no code work in 17a IMPL for this item)

---

## 7. Item F — `canManualCheckIn` allowlist

### 7.1 Verdict — ✅ All 5 hits legitimate (migration code)

| File | Line | Hit context | Legitimate? |
|---|---|---|---|
| `src/store/scannerInvitationsStore.ts` | 35 | File header comment: "Cycle 13b Q1 (SPEC §4.5 / DEC-093): `canManualCheckIn` field DROPPED from `ScannerPermissions`" | ✅ doc comment |
| `src/store/scannerInvitationsStore.ts` | 125 | Persist v1→v2 migration comment | ✅ migration doc |
| `src/store/scannerInvitationsStore.ts` | 134 | TypeScript shape for v1 (legacy) — `canManualCheckIn?: boolean;` defines what's being dropped | ✅ migration type |
| `src/store/scannerInvitationsStore.ts` | 142 | Destructured drop: `const { canManualCheckIn: _drop, ...restPerms } = e.permissions;` | ✅ migration logic |
| `src/components/scanners/InviteScannerSheet.tsx` | 17 | File header comment: "Cycle 13b Q1 (SPEC §4.6): `canManualCheckIn` toggle DROPPED" | ✅ doc comment |

### 7.2 Allowlist comment (recommended shape)

For each of the 5 lines, add an inline comment immediately above:

```
// orch-strict-grep-allow canManualCheckIn — Cycle 13b migration removes this field; reference is part of the strip logic, not active usage.
```

For the file headers (line 35 and InviteScannerSheet.tsx:17), add the allowlist comment as the FIRST line of the JSDoc block so the grep gate sees it before the matched line.

For the type definition at line 134 and the destructure at line 142, add the comment ABOVE the matched line.

### 7.3 Ready for SPEC: ✅

---

## 8. Five-layer cross-check (consolidated)

| Item | Docs | Schema | Code | Runtime | Data | Disagreement? |
|---|---|---|---|---|---|---|
| A | TopBar JSDoc says "If undefined, renders default" — clear | N/A | events.tsx replaces, doesn't compose | (cannot verify on-device but deterministic) | N/A | **Code disagrees with operator's mental model** — not with docs. Spec-shape change not code-bug. |
| B | No spec for duplicate keys | N/A | Duplicate confirmed | tsc warning may not fire; runtime loses zIndex | N/A | tsc layer disagrees with code |
| C | Cycle 7 FX2 spec says Brand has kind/address/coverHue | brands table doesn't have these columns | UI Brand type requires them; mapBrandRowToUi doesn't return them | Stub paths populate fields manually; DB-real paths would crash | STUB_BRANDS has fields; brands table doesn't | **3-layer drift: docs → schema → code** |
| D | Markers describe Cycle 9 / J-A12 as exit triggers | N/A | Cycle 9 + J-A12 both shipped | Code still works (markers just stale) | N/A | Doc-comment-vs-code drift |
| E | Cycle 15 SPEC: Option 2 = code paste-back | N/A (Supabase config) | AuthContext.signInWithOtp matches spec | Cannot verify without dashboard access | Email template body unknown | **Cannot verify without operator** |
| F | Cycle 13b DROPPED field per DEC-093 | N/A (no DB column) | Migration code legitimately strips | Migration runs once at v1→v2 hydrate | Persisted state v2 has no field | No disagreement — all layers aligned |

---

## 9. Blast radius (consolidated)

| Item | Surfaces affected | Solo/collab | Admin? | Cache impact |
|---|---|---|---|---|
| A | events tab only (other tabs already correct) | solo | no | none |
| B | events tab toast | solo | no | none |
| C | every code path that reads from `brands` table → UI (mostly B-cycle today) | both | no (admin uses different DB-row mapper) | future cache items must include the 3 fields |
| D | recurrence flows + brand profile past-events + Operations rows | solo | no | none |
| E | every email-OTP sign-in attempt | solo | no | none |
| F | strict-grep CI gate only | N/A | no | none |

---

## 10. Discoveries for orchestrator

1. **D-17-11 / Item A is more interesting than first reported.** Operator's "+ button is missing" report is technically true but the deeper structural issue is "rightSlot is replacement, not composition." The 17a tactical fix solves the user-visible symptom; the **17b structural fix** (D-17-12) needs to introduce a new TopBar API contract — recommended new prop `extraRightSlot: React.ReactNode` that gets COMBINED with the default cluster. Forensics for 17b should specifically design this prop contract.

2. **Item C reveals a latent ghost path.** `mapBrandRowToUi` has been broken at the type level since Cycle 7 FX2 shipped. Since real-DB brand creation isn't wired, no one's hit it. **When B-cycle wires real brand creation, this WILL break first** unless 17a fixes it. Strong argument for fixing in 17a even though no current consumer.

3. **`liveEventStore`-derived past-events.** BrandProfileView's `STUB_PAST_EVENTS` could be replaced with derived data from existing client-side `useLiveEventsForBrand(brand.id)` filtered to past status. No schema change. Pure data-fidelity polish. **Candidate for 17b** (visual + copy polish).

4. **Recommend new invariant I-37 (deferred to 17b).** "TopBar default right-slot cluster `[search, bell]` MUST be visible on every primary tab surface; pages may compose extra icons but MUST NOT replace the default." Codifies the operator's mental model so future surfaces don't repeat the events.tsx pattern.

5. **`canManualCheckIn` allowlist comment placement.** File-header comments are tricky for grep gates because they predate the matched token. Recommend the gate's grep config explicitly skip file-header JSDoc blocks (lines 1-N where N is the closing `*/`) instead of relying on per-line allowlist comments. Either approach works; the per-line is simpler if the gate is rg-based.

6. **Sentry env wiring (D-CYCLE16A-IMPL-3) — operator-side action.** Forensics confirms `mingla-business/.env` doesn't contain `EXPO_PUBLIC_SENTRY_DSN`. The DSN provided in the prior session is `https://ba27572315b964df6edce0a4eb31a60a@o4511136062701568.ingest.us.sentry.io/4511334517243904`. 17a SPEC should include a DSN-add step + EAS Secrets sync instructions. Pure config; no code work.

7. **`+` button gate-closed default (lower-severity edge case).** `useCurrentBrandRole` returns `rank=0` when (a) query is in-flight, OR (b) user isn't authenticated, OR (c) brand isn't found server-side AND not a stub brand. During brief query in-flight, `+` flickers off. Acceptable for now (sub-100ms typical), but if 17b adds skeleton states, this is a candidate for "show search+bell+disabled-+-with-spinner during in-flight" rather than nothing.

---

## 11. Confidence per area

| Area | Confidence | Why |
|---|---|---|
| Item A root cause | **High** | Direct code trace + TopBar fallback contract verified |
| Item A severity (S2) | **High** | All viable interpretations of the contract land in same severity bucket |
| Item B verification | **High** | Literal duplicate read directly |
| Item C drift scope | **High** | All 3 artifacts read directly; canonical-side decision well-grounded |
| Item D verdicts (recurrenceRule SUBTRACT) | **High** | 11-file consumer list verified |
| Item D verdicts (BrandProfileView KEEP) | **Medium** | Past-events derivation is technically possible from current `liveEventStore` — flagged for 17b. The KEEP verdict is about scope, not correctness. |
| Item E operator instructions | **Medium** | Cannot verify dashboard state from forensics; instructions are based on Supabase Auth template defaults + Cycle 15 spec intent |
| Item F allowlist hits | **High** | All 5 lines read directly |
| Apple JWT closure recommendation | **High** | Cross-references verified (autorotate spec, scheduled remote agent both exist) |

---

## 12. Cross-references

- Predecessor: `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17_REFINEMENT_PASS.md` (master inventory)
- Aggregate: `Mingla_Artifacts/reports/TEMP_CYCLE_17_BACKLOG_AGGREGATE.md` (101 rows)
- Dispatch: `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_17A_QUICK_WINS.md`
- Apple JWT belt+suspenders: `SPEC_APPLE_JWT_AUTOROTATE.md`, `INVESTIGATION_APPLE_JWT_AUTOROTATE.md`, scheduled remote agent (one-shot 2026-10-12)
- Memory rules consulted:
  - `feedback_layman_first` — layman summary leads
  - `feedback_no_summary_paragraph` — no closing prose
  - `feedback_implementor_uses_ui_ux_pro_max` — applies to Item A 17a tactical fix (visual UI change) — SPEC must mention
  - `feedback_orchestrator_never_executes` — orchestrator now drafts SPEC; operator dispatches IMPL
- INVARIANT_REGISTRY: I-32 (rank-mirror), I-36 (ROOT-ERROR-BOUNDARY); proposed I-37 (TopBar default cluster) — defer to 17b lock-in

---

**Ready for SPEC author:** all 6 items have ✅ verdicts. SPEC `SPEC_BIZ_CYCLE_17A_QUICK_WINS.md` can consolidate Items A, B, C, D, F as code work + Item E as operator-side dashboard instructions.

**No SPEC produced from this dispatch.** SPEC author runs after orchestrator REVIEW.
