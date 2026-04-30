# Implementation Report — Cycle 2 · J-A8 Polish · Social URL Fields

> **Initiative:** Mingla Business Frontend Journey Build (DEC-071 frontend-first)
> **Cycle:** ORCH-BIZ-CYCLE-2-J-A8-POLISH-URL-FIX
> **Codebase:** `mingla-business/`
> **Predecessor:** J-A8 polish implementor PASS (uncommitted; founder smoke flagged URL semantics)
> **Implementor turn:** 2026-04-29
> **Dispatch:** `Mingla_Artifacts/prompts/IMPLEMENTOR_BIZ_CYCLE_2_J_A8_POLISH_URL_FIX.md`
> **Status:** implemented and verified (code-trace + tsc clean)

---

## 1. Summary

Converted 7 social link fields + the website field from handle/bare-slug semantics to **full HTTPS URL** semantics. Founder requirement: the public profile (Cycle 3+) will render social chips as clickable links via `Linking.openURL`, so storing full URLs verbatim eliminates per-platform URL reconstruction logic.

**2 files modified, 0 schema change, 0 persist version bump, 0 logic change.** Pure copy + stub-data update.

Friendly placeholders: every link Input now reads "Paste your {Platform} link here" — consistent action-oriented copy across all 8 link fields.

---

## 2. Old → New Receipts

### `mingla-business/src/components/brand/BrandEditView.tsx` (MODIFIED)

**What it did before:** 8 social Input placeholders used handle/slug examples ("@yourbrand", "yourbrand.com", "yourbrand"). Accessibility labels were platform names ("Instagram", "TikTok", etc.).

**What it does now:** all 8 link fields use friendly action-oriented copy:

| Field | Placeholder | accessibilityLabel |
|---|---|---|
| website | "Paste your website link here" | "Website link" |
| instagram | "Paste your Instagram link here" | "Instagram link" |
| tiktok | "Paste your TikTok link here" | "TikTok link" |
| x | "Paste your X link here" | "X (Twitter) link" |
| facebook | "Paste your Facebook link here" | "Facebook link" |
| youtube | "Paste your YouTube link here" | "YouTube link" |
| linkedin | "Paste your LinkedIn link here" | "LinkedIn link" |
| threads | "Paste your Threads link here" | "Threads link" |

No prop other than `placeholder` + `accessibilityLabel` changed. `value`, `onChangeText`, `variant`, `leadingIcon`, `clearable` all identical to J-A8 polish baseline.

**Why:** founder explicit requirement — "These socials will be rendered as links. The @ is not necessary. This should be fields for links for the various profiles."

**Lines:** 16 changed (2 per field × 8 fields). Net 0 (no add/remove).

### `mingla-business/src/store/brandList.ts` (MODIFIED)

**What it did before:** 4 STUB_BRANDS' `links.*` social fields used handle/bare-slug values:
- `website: "lonelymoth.events"` (bare domain, no protocol)
- `instagram: "@lonely.moth.events"` (handle)
- `tiktok: "@lonelymoth"` (handle)
- `facebook: "lonelymothldn"` (bare slug)
- `linkedin: "lonely-moth"` (bare slug)
- etc.

**What it does now:** every populated `links.*` field across all 4 stubs is a full HTTPS URL:

**Lonely Moth** (8 platforms, full coverage):
- `website: "https://lonelymoth.events"`
- `instagram: "https://instagram.com/lonely.moth.events"`
- `tiktok: "https://tiktok.com/@lonelymoth"`
- `x: "https://x.com/lonelymothldn"`
- `facebook: "https://facebook.com/lonelymothldn"`
- `youtube: "https://youtube.com/@lonelymoth"`
- `linkedin: "https://linkedin.com/company/lonely-moth"`
- `threads: "https://threads.net/@lonely.moth.events"`

**The Long Lunch** (3 platforms):
- `website: "https://thelonglunch.co.uk"`
- `instagram: "https://instagram.com/thelonglunch"`
- `tiktok: "https://tiktok.com/@thelonglunch"`

**Sunday Languor** (6 platforms):
- `website: "https://sundaylanguor.com"`
- `instagram: "https://instagram.com/sundaylanguor"`
- `tiktok: "https://tiktok.com/@sundaylanguor"`
- `x: "https://x.com/sundaylanguor"`
- `youtube: "https://youtube.com/@sundaylanguor"`
- `threads: "https://threads.net/@sundaylanguor"`

**Hidden Rooms** (2 platforms):
- `website: "https://hidden-rooms.co.uk"`
- `instagram: "https://instagram.com/hidden.rooms"`

Header comment extended with: "Cycle 2 J-A8 polish URL fix: social fields now store full HTTPS URLs (not @-handles or bare slugs) so the public profile (Cycle 3+) can call `Linking.openURL` directly with zero per-platform URL reconstruction."

Other fields (displayName, slug, role, stats, currentLiveEvent, bio, tagline, contact, displayAttendeeCount, custom) unchanged.

**Why:** stub data must mirror the URL semantics the production data will carry; founder's smoke + visual confirmation depend on the chips opening real URLs in Cycle 3+.

**Lines:** 18 string replacements + 4 lines of header comment. Net +4.

---

## 3. Spec Traceability — AC verification matrix

| AC | Criterion | Status | Code-trace evidence |
|---|---|---|---|
| 1 | All 7 social Inputs + website Input show "Paste your {X} link here" placeholder | ✅ PASS | grep verified all 8 placeholders in BrandEditView.tsx |
| 2 | Accessibility labels updated to "{Platform} link" format | ✅ PASS | grep verified all 8 a11y labels |
| 3 | All 4 STUB_BRANDS' populated social fields are full HTTPS URLs | ✅ PASS | grep verified `https://` prefix on every populated `links.*` field across all 4 stubs |
| 4 | tsc clean, no schema change, no persist version bump | ✅ PASS | `npx tsc --noEmit` exits 0; persist v5 unchanged; BrandLinks interface unchanged |

**Summary:** 4/4 ACs PASS at code-trace level. Founder smoke is a quick visual confirmation (5 lines of §6).

---

## 4. Invariant Verification

| ID | Status | Evidence |
|---|---|---|
| I-1 | ✅ Preserved | `designSystem.ts` not touched |
| I-3 | ✅ Preserved | No platform-specific code changed |
| I-4 | ✅ Preserved | No `app-mobile/` references |
| I-6 | ✅ Preserved | tsc strict clean |
| I-7 | ✅ Preserved | No new TRANSITIONAL markers; D-IMPL-A7-5 social-tap TRANSITIONAL preserved (`handleOpenLink` Toast unchanged) |
| I-9 | ✅ Preserved | No animation timings touched |
| I-12 | ✅ Preserved | Host-bg cascade unchanged |
| DEC-071 | ✅ Preserved | Frontend-first; no backend code |
| DEC-079 | ✅ Preserved | No kit primitive changes |
| DEC-082 | ✅ Preserved | Icon set unchanged |

---

## 5. Constitutional Compliance

| # | Principle | Compliance |
|---|---|---|
| 1 | No dead taps | ✅ — no interaction surface changed |
| 2 | One owner per truth | ✅ — Brand schema unchanged |
| 3 | No silent failures | ✅ — no error path touched |
| 7 | Label temporary fixes | ✅ — no new TRANSITIONAL markers; existing markers preserved |
| 8 | Subtract before adding | ✅ — old handle copy replaced with new URL copy in-place |
| 9 | No fabricated data | ✅ — stub URLs are clearly stub (point to plausible-but-not-real handles); production builds gate seeding via `__DEV__` |
| 12 | Validate at the right time | ✅ — no validation added (frontend-first; user can save any string) |

Other principles (4, 5, 6, 10, 11, 13, 14) untouched by this change.

---

## 6. TRANSITIONAL marker grep

**No new TRANSITIONAL markers added.** Existing markers untouched:
- `handleOpenLink` Toast in BrandProfileView.tsx (D-IMPL-A7-5) PRESERVED — chips still fire Toast until Cycle 3+ wires `Linking.openURL`
- Photo upload TRANSITIONAL in BrandEditView.tsx untouched
- Simulated-async-save delay TRANSITIONAL in BrandEditView.tsx untouched

---

## 7. Cache Safety

**No cache impact.**
- No schema change → no persist version bump
- BrandLinks interface unchanged → existing v5 persisted state hydrates without modification
- Existing user-created brands with handle-format values (e.g., "@yourbrand") will still hydrate as plain strings; their chips on the profile will still render with the platform icon, but tapping won't yet open anything (D-IMPL-A7-5 deferred). When Cycle 3+ adds `Linking.openURL`, those legacy handle values won't open as URLs — but that's expected: founder will need to re-paste full URLs into existing brand records, OR Cycle 3+ can add a one-time migration that prepends `https://platform.com/` to existing handle values. Recommend deferring to founder discretion at Cycle 3+ launch (D-IMPL-A8P-URL-1 below).

---

## 8. Parity Check (mobile + web)

No platform-specific code changed. Behavior identical across iOS / Android / web.

---

## 9. Regression Surface (3-5 features most likely to break)

1. **Brand profile socialsRow rendering** — chips render based on `field.length > 0` guard; URLs are non-empty strings so all chips that were rendering before still render. **Low.**
2. **BrandSwitcherSheet phone variant** — untouched by this change. **None.**
3. **J-A8 BrandEditView Save state machine** — `isDirty` JSON.stringify check still works for string field changes. **Low.**
4. **Existing user-created brands with handle-format values** — will hydrate fine; chips render; tap fires existing TRANSITIONAL Toast. **Low.**
5. **Cycle 1 Home tab** — no `links.*` consumption. **None.**

---

## 10. Discoveries for Orchestrator

| ID | Description | Severity | Action |
|---|---|---|---|
| D-IMPL-A8P-URL-1 | Existing user-created brands persisted before this fix may have handle-format values (e.g., "@yourbrand"). Those won't open as URLs when Cycle 3+ wires `Linking.openURL`. Two options at Cycle 3+ launch: (a) one-time `__DEV__` migration that prepends `https://platform.com/` to detected handle-format values per-platform; (b) prompt the founder to re-paste full URLs in their brand edit form. (b) is simpler and avoids risky string heuristics. Currently only impacts dev-test data — production has no users yet (Cycle 0a/0b/1/2 pre-MVP). | Info | Track for Cycle 3+ launch decision |

**No new high-severity issues.** All 4 ACs PASS. Tiny copy + stub-data update with no logic risk.

---

## 11. Transition Items

None added. Existing transitionals from prior cycles all preserved verbatim:
- `handleOpenLink` Toast (D-IMPL-A7-5) — Cycle 3+ wires Linking.openURL
- Photo upload Toast — exit when photo pipeline lands
- Simulated-async-save delay — exit when B1 backend lands
- Persist key `...currentBrand.v5` — exit at B1

---

## 12. Founder smoke instructions

```
1. Account → Wipe brands → Seed 4 stub brands. Open Lonely Moth → Edit.
2. Scroll to Social Links section. Verify Instagram input shows
   "https://instagram.com/lonely.moth.events" (full URL, no @ prefix).
3. Wipe brands again. Open the empty Edit screen. Each link field shows
   friendly placeholder: "Paste your Instagram link here", "Paste your
   TikTok link here", etc. — including website ("Paste your website
   link here").
4. Type any URL into one field. Save. Reopen Edit. URL persists.
5. (Future Cycle 3+) When public profile ships and chips become
   clickable, Linking.openURL on the field value will work verbatim.
```

If anything looks off, report which field + which platform.

---

## 13. Working method actually followed

1. ✅ Pre-flight reads — dispatch + spec + recent BrandEditView/brandList state (in fresh context from prior implementor turn)
2. ✅ BrandEditView — replaced all 8 link Input placeholders + accessibility labels with "Paste your {X} link here" / "{X} link" copy
3. ✅ brandList.ts — converted all populated social URLs across 4 stubs to full HTTPS URLs; updated header comment
4. ✅ tsc check — clean
5. ✅ TRANSITIONAL marker grep — no markers added/retired (verified)
6. ✅ Report written

---

## 14. Layman summary

When founder opens any brand edit screen:
- Each link field (website, Instagram, TikTok, X, Facebook, YouTube, LinkedIn, Threads) shows friendly placeholder "Paste your {Platform} link here"
- Stub data for the 4 demo brands now stores full URLs (e.g., `https://instagram.com/lonely.moth.events`) instead of handles (`@lonely.moth.events`)
- When the public profile ships in Cycle 3+, social chips will open the stored URL verbatim with no per-platform URL reconstruction logic

No schema change, no persist bump, no behavior change to existing flows. Tap on social chip still fires the same TRANSITIONAL Toast it did before — that deferral closes when Cycle 3+ wires `Linking.openURL`.

---

## 15. Hand-off

Per locked sequential rule, **stopping here**. tsc clean across both files; 4/4 ACs PASS at code-trace level. Founder smoke is a 5-line visual confirmation.

D-IMPL-A8P-URL-1 (legacy handle-format brands at Cycle 3+ launch) tracked for orchestrator visibility.

Hand back to `/mingla-orchestrator` for review + founder smoke + AGENT_HANDOFFS update.

---

**End of J-A8 polish URL fix implementation report.**
