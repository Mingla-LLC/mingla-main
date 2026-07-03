# IMPLEMENTATION ORCH-1269 — claim-adoption phone country mis-defaults to GB

- **Date:** 2026-07-03
- **Worktree:** `~/Desktop/mingla-orchs/orch-1269-[claim-phone-country]/` on branch `orch-1269-claim-phone-country` (rebased onto origin/main @ `004678230`)
- **Status:** implemented, partially verified (all automated gates green; on-device c6 picker walk is the tester's runtime step)
- **Fix commit:** `522834656d56a8a30e5569152b1388541b70fc6e`

## 1. Summary

Claiming a seeded venue in another country no longer shows the wrong phone-country flag. The ORCH-1263 [claim-adoption] prefill copied the place's national phone number ("(919) 377-0509") into the c6 "How people reach you" step but never mapped the place's country, so the picker sat on the component's GB default — a UK flag presented beside an "On Mingla" chip for a US number, and a +44 mis-composition hazard for any E.164 consumer. Now both claim prefills map `place_pool.country` to an ISO alpha-2 code (tolerant of the messy prod values), the draft persists it (including manual operator picks), and c6 refuses to advance a phone that cannot compose to a plausible E.164 under the currently-shown country.

## 2. Root-cause proof (file:line, pre-fix)

- `mingla-business/src/utils/prefillDraftFromPoolMatch.ts:159` (pre-fix) — `contactPhone: detail.nationalPhoneNumber ?? ""` copied the NATIONAL number with **no** phone-country ISO anywhere in the prefill return. `DraftVenueState` had no phone-ISO field at all (`draftVenueStore.ts:93-126` pre-fix).
- `mingla-business/src/components/venue/claim/ClaimStepContact.tsx:46-57` (pre-fix) — the c6 `<Input variant="phone">` passed neither `defaultCountryIso` nor `onCountryChange`.
- `mingla-business/src/components/ui/Input.tsx:333-336` — `DEFAULT_PHONE_COUNTRY = PHONE_COUNTRIES.find((c) => c.iso === "GB")`; `:496-498` — country state lazily inits from `defaultCountryIso`, so with no prop the picker always rendered GB. That is exactly Seth's prod repro (Academy Street Bistro, `place_pool` `008c13b3-a97e-48bf-908c-5f5eca09aa11`, country `"USA"`, phone `"(919) 377-0509"`, GB flag on c7-of-10 / step id c6).
- Storage-path precision (dispatch said "submitting would E.164-normalize under GB"): I traced submit end-to-end — `VenueCreatorWizard.tsx:353` sends `st.contactPhone` RAW to `venueListingsService.ts:187` → `biz_create_venue_listing` (`supabase/migrations/20261130000003…sql:207`) stores `contact_phone` as trimmed free text. **No composer runs at venue submit today**, so the live harm was the wrong-country flag presented as adopted truth + a mis-composition/validation hole for every downstream E.164 consumer (the `Input` phone-variant contract at `Input.tsx:13-16` explicitly tells callers to compose `dialCode + value`, and `BrandEditView.tsx:699-703` already runs the ISO-tracked pattern). Client-only fix confirmed correct; **no server change needed** (per-dispatch guard respected).

## 3. Prod data probe (read-only, MCP `execute_sql`, 2026-07-03)

`SELECT DISTINCT country FROM place_pool WHERE national_phone_number IS NOT NULL LIMIT 30` →
`Nigeria` · `UK` · `USA` · `GB邮政编码: SW1P 2AF` · `Staten Island邮政编码: 10305` · `USSet P邮政编码: 27545` · `Level 0邮政编码: E14 4QT`
The mapper is built for exactly this set: names/ISO-2/ISO-3/common aliases map; a leading bare 2–3-letter code with a non-letter after it maps (`GB邮政编码…` → GB); everything else → null (no fabricated country, Constitution #9).

## 4. Files changed (all in commit `522834656`; +411 / −0)

| File | Change |
|---|---|
| `mingla-business/src/utils/phoneCountryIsoFromPlaceCountry.ts` | NEW (+104) — tolerant place-country → ISO-2 mapper |
| `mingla-business/src/utils/prefillDraftFromPoolMatch.ts` | +10 — both prefills set `contactPhoneCountryIso` |
| `mingla-business/src/store/draftVenueStore.ts` | +11 — `contactPhoneCountryIso?: string \| null` + `initial` + `pickDraft` |
| `mingla-business/src/components/venue/claim/ClaimStepContact.tsx` | +8 — `defaultCountryIso` + `onCountryChange` on the c6 phone Input |
| `mingla-business/src/components/venue/venueWizardValidation.ts` | +21 — c6 E.164 belt-and-braces (`composeE164` from ORCH-0847) |
| `mingla-business/src/utils/__tests__/claimPhoneCountry.orch1269.test.ts` | NEW (+257) — 17-test regression suite |

## 5. Design decisions (per dispatch)

- **One owner per truth / no new country table.** The mapper derives ISO-2 validity and name→ISO-2 from the shared `packages/phone-input/countries.ts` (ISO 3166-1 + ITU-T, ORCH-0847), adding only a small alias layer (USA/GBR/NGA ISO-3s + UK/Great Britain/England-style variants). Imported RELATIVELY so node-jest resolves without the Metro-only `@mingla/phone-input` alias — Metro resolves both to the same absolute file (no module duplication). Precedent: existing tests already relative-import `packages/offering-rendering/*`. `normalizeCityCountry.ts`'s alias map was evaluated and rejected — it owns DISPLAY forms ("USA"/"UK"), not ISO codes.
- **Unmappable → picker keeps its own default, chip-free.** The `Input` phone variant has no unset/neutral state (country state is always a `PhoneCountry`), so per dispatch the fallback path applies. The country selector itself has NO provenance chip in this UI (the "On Mingla" chip belongs to the phone VALUE, `ClaimStepContact.tsx:44`), so the wrong-country-flag-as-adopted-truth condition is only ever cleared by the mapping itself — which is why mappable countries now always win, and null means "we honestly don't know".
- **Optional-at-type-level store field.** `contactPhoneCountryIso?: string | null` follows the exact ORCH-1263 `PoolMatch` precedent: the pinned append-only suites (`__tests__/orch1263ClaimAdoption.happy.test.tsx:189` full `DraftVenueState` literal) must keep compiling untouched. `initial`/`pickDraft` always carry it; a pre-1269 persisted v3 blob rehydrates with `?? null` (no persist-name bump needed — additive field, zustand shallow-merges over `initial`).
- **Mount order makes the lazy init safe.** Prefill runs at "Yes, this is me" (`app/venue/create.tsx:216-221`) before the wizard renders; the wizard renders steps through a switch (`VenueCreatorWizard.tsx:525-526`), so the c6 `Input` mounts fresh with the store ISO already present — and remounts on every re-entry, picking up manual picks persisted via `onCountryChange`.
- **Belt-and-braces is c6-only.** The create-path s3 rule stays byte-equal (1263 contract). `c6DialCode(null)` mirrors the picker's GB default exactly, so validation and UI can never disagree about which dial code applies. Known limit (documented, accepted): `composeE164`'s ITU-T regex is length-based, so a 10-digit US number under +44 still parses (13 digits ≤ 15) — the parse check catches digit-free/over-long garbage; wrong-country storage is prevented by the mapping, not the regex. Real per-country length plausibility needs libphonenumber-class metadata the repo deliberately doesn't carry (`Input.tsx:83-88`).

## 6. Regression tests (append-only; existing suites UNMODIFIED)

**New file:** `mingla-business/src/utils/__tests__/claimPhoneCountry.orch1269.test.ts` — 17 tests:
M-1..M-5 mapper (USA/United States/U.S.A./US→US; UK/GB/GBR/United Kingdom/Great Britain/England→GB; Nigeria/NGA→NG; France→FR; all four garbage prod rows; null/undefined/empty→null) · P-1..P-4 prefill contract (both prefills; the exact prod fixture `(919) 377-0509` + `USA` → `US`) · W-1..W-3 c6 source contract (adopted ISO reaches the picker; operator picks persist; picker directory accepts US/GB/NG) · V-1..V-5 c6 validation (US number passes; digit-free and >15-digit rejected inline; null-ISO mirrors GB default; s3 untouched).

**Run:** `Tests: 17 passed, 17 total` (first run 3.132s).

**Fails-on-revert verified at `522834656d56a8a30e5569152b1388541b70fc6e`** — true LINE DELETION of the fix (both prefill `contactPhoneCountryIso:` lines, the ClaimStepContact `defaultCountryIso`/`onCountryChange` props, and the c6 E.164 block) → `Tests: 8 failed, 9 passed` (P-1..P-4, W-1, W-2, V-2, V-3 fail); restore → `Tests: 17 passed`.

## 7. Gates (real output)

- **Pinned suites untouched and green:** `npx jest __tests__/orch1263ClaimAdoption.happy.test.tsx __tests__/orch1263ClaimAdoption.tester.adversarial.test.tsx src/utils/__tests__/prefillDraftFromPoolMatch.test.ts` → `Test Suites: 3 passed · Tests: 84 passed`.
- **tsc zero new:** `npx tsc --noEmit` error set on clean HEAD (880 pre-existing lines, all in `../packages/*` under this raw invocation) vs with-fix → `diff` → **identical** ("TSC-IDENTICAL: zero new errors"). (Anchor `~/Desktop/mingla-main` was rejected as a baseline — it carries uncommitted drift; baseline taken from this worktree's own clean HEAD via stash.)
- **strict-grep:** full-folder run diffed vs clean HEAD → identical failure set (19 pre-existing env-dependent fails on both sides, none regressed). Both ORCH-1263 gates (`orch-1263-claim-front-load-and-overnight.mjs`, `orch-1263-claim-stage-only-preapprove.mjs`) pass individually.
- **Web export:** `npx expo export -p web --clear` → exit 0 (run twice; second run on the final restored fix state).

## 8. Cross-surface impact

| Surface | Affected | Detail |
|---|---|---|
| Business iOS / Android / Web preview | YES | One RN codebase — parity automatic. c6 picker now opens on the adopted place's country; c6 blocks E.164-implausible phones. |
| Buyer/anonymous Web | NO | Buyer checkout uses `@mingla/phone-input` `<PhoneInput>` (already ISO-tracked, ORCH-0847); untouched. |
| Consumer iOS / Android | NO | No consumer surface reads the venue draft store. |
| Admin Web | NO | No admin path touched; `contact_phone` storage format unchanged (raw national text, as before). |

## 9. Invariants & constitution

- I-PROPOSED-1263-CLAIM-ADOPTION-COPY-ON-START — preserved (client-only; zero server writes pre-submit; `claim.adopted` snapshot untouched).
- 1263 stage-only pre-approve + create-path byte-equal rules — preserved (s3 unchanged, V-5 pins it).
- Constitution: #2 one owner per truth (shared country directory reused), #9 no fabrication (unmappable → null, never a guessed flag), #12 validate at the right time (inline at c6, before submit). No `catch(){}`, no `any`, no new state layers.

## 10. Known issues / deferred (for orchestrator)

1. **[Discovery] `countryCode: match.country?.slice(0, 2)`** (`prefillDraftFromPoolMatch.ts:77` and `:159`) — the pre-existing naive slice feeds `venue_listings.country_code` ("United States" → "Un", "GB邮政编码…" → "GB" only by luck). Out of ORCH-1269 scope (different column, different consumer set); the new mapper is the obvious replacement. Recommend a follow-up ORCH.
2. **[Discovery] `place_pool.country` hygiene** — the probe shows postal-code garbage (`USSet P邮政编码: 27545`, `Level 0邮政编码: E14 4QT`, CJK label bleed) from the seeder. Data-quality follow-up candidate for the pipeline.
3. **E.164 length-only plausibility** — see §5; per-country number-length validation would need a metadata library the repo intentionally avoids.
4. **Runtime UI walk pending** — c6 flag rendering verified at source + mount-order level, not driven on a simulator this pass (hotfix dispatch; tester owns the adversarial runtime pass). Suggested tester step: claim Academy Street Bistro on prod-pointed dev build → c6 must show the US flag + "(919) 377-0509" + On Mingla chip.

## 11. Operator action required

None for data/backend — **no migration, no edge-function deploy** (client-only fix, as the dispatch anticipated). Route: orchestrator REVIEW → tester dispatch → PR off `orch-1269-claim-phone-country`. COMMS-0052 (business-app OTA BLOCKED pending new native build) complied with — nothing OTA'd from this ORCH; this fix ships with the next business native build / standard PR flow.
