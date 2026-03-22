# Spec Prompt: Pass 2a — Currency + Pricing (3 fixes)

**Target skill:** Software and Code Architect (Specer mode)
**Gate:** 2 (Spec)
**Pass:** 2a
**Investigation:** `outputs/INVESTIGATION_PASS2A.md`

---

## 3 Bugs — Verified Findings

### P2-01: Currency changes with GPS location
- `PreferencesSheet.tsx` calls `detectLocaleFromCoordinates` at lines 591 and 639
- This OVERWRITES `profile.currency` whenever user changes search location or toggles GPS
- Fix: remove both `detectLocaleFromCoordinates` calls. Currency should only be set during onboarding — never re-derived from GPS/location changes.
- Adjacent find: measurement system also flips with GPS (same code). If measurement system should also be locked from onboarding, remove that too. If it should follow location (showing km in UK, miles in US), keep it.
- Edge case: what if the user has no currency set (old account before onboarding set it)? Need a fallback — default to USD or detect once on first load only.

### P2-02: priceRange = priceLevel (Google enum)
- `PersonHolidayView.tsx:383` passes `c.priceLevel` (raw "PRICE_LEVEL_MODERATE")
- Should use `c.priceTier` (computed by edge function as "comfy") + `tierLabel()` to get display text
- Also line 395 — same fix needed
- Fix: `priceRange={tierLabel(c.priceTier)}` at both lines

### P2-03: Slug on saved page
- `SavedTab.tsx:1900` renders `card.category` directly ("fine_dining")
- `getReadableCategoryName()` exists and is used everywhere else — just not imported in SavedTab
- Fix: import + wrap: `getReadableCategoryName(card.category)`
- Adjacent find: category filter pills in SavedTab may also show slugs — check and fix if so

---

## Files to Read

- `app-mobile/src/components/PreferencesSheet.tsx` — detectLocaleFromCoordinates calls (P2-01)
- `app-mobile/src/components/PersonHolidayView.tsx` — priceLevel lines 383, 395 (P2-02)
- `app-mobile/src/components/activity/SavedTab.tsx` — category render line 1900 + filter pills (P2-03)
- `outputs/INVESTIGATION_PASS2A.md` — full code traces

---

## Constraints

- Currency must NEVER change after onboarding — removing detectLocaleFromCoordinates is the fix, not adding logic
- Measurement system: decide whether to lock from onboarding (like currency) or keep location-aware. Recommend locking both for consistency.
- If category filter pills in SavedTab show slugs, fix those too in this pass

---

## Output Format

Write to `outputs/SPEC_PASS2A.md` with:
- Per fix: exact file, line, before/after code
- Edge cases (no currency set, no priceTier, filter pills)
- Test criteria
