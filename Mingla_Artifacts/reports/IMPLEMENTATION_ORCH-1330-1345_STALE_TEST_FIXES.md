# IMPLEMENTATION — ORCH-1330 + ORCH-1345: stale source-contract test fixes

**Type:** test-only drift correction (zero product-code touch).
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1330-[pre-existing-test-reds]` on branch `ORCH-1330-pre-existing-test-reds` (rebased on origin/main — 0 commits ahead at start; rebase was a no-op).

Two pre-existing test-vs-code drifts where a source-contract test asserted REMOVED behavior. Each stale test was rewritten to the CURRENT shipped contract. No product code changed. The removed features were NOT restored (that would be a regression).

---

## FIX 1 — ORCH-1330: `supabase/functions/_shared/email/__tests__/shell.test.ts`

### Current-contract evidence
- `supabase/functions/_shared/email/ticketBody.ts:100-110` — HTML renders an inclusive-VAT note: `Includes ${formatMoneyFromCents(taxAmountCents, order.currency)} VAT` under Total when `taxAmountCents > 0` (else omitted). "ORCH-1006 Surface 7 (§7.2)".
- `supabase/functions/_shared/email/ticketBody.ts:227-236` — text body mirrors it: `Includes ${amount} VAT`.
- No renderer consumes `taxBreakdown` (grep of `_shared/email/` shows it only in `types.ts`, unused by any renderer). The per-jurisdiction `Tax (…)` string exists in NO source file.
- `formatMoneyFromCents(725, "GBP")` returns exactly `"£7.25"` (verified via `deno eval` against `currency.ts`).

### Red proof (before)
`deno test … shell.test.ts` → `FAILED | 9 passed | 1 failed`; failure at `shell.test.ts:96` — `assertStringIncludes(result.html, "Tax (New York State, New York City)")` not found in rendered HTML.

### Before (lines 81–98)
```ts
Deno.test("paid ticket render: tax row includes jurisdiction labels", () => {
  const fixture = ticketFixture();
  const body = fixture.body as TicketBodyInput;
  body.order.taxAmountCents = 725;
  body.order.taxBreakdown = [
    { jurisdiction: { display_name: "New York State" }, tax_rate_details: {...} },
    { jurisdiction: { display_name: "New York City" },  tax_rate_details: {...} },
  ];
  const result = renderTransactionalEmail(fixture);
  assertStringIncludes(result.html, "Tax (New York State, New York City)");
  assertStringIncludes(result.text, "Tax (New York State, New York City):");
});
```

### After
```ts
Deno.test("paid ticket render: inclusive VAT note under Total, no jurisdiction label", () => {
  const fixture = ticketFixture();
  const body = fixture.body as TicketBodyInput;
  body.order.taxAmountCents = 725;
  const result = renderTransactionalEmail(fixture);
  assertStringIncludes(result.html, "Includes");
  assertStringIncludes(result.html, "£7.25");
  assertStringIncludes(result.html, "VAT");
  assertStringIncludes(result.html, "Includes £7.25 VAT");
  assertStringIncludes(result.text, "Includes £7.25 VAT");
  assert(!result.html.includes("Tax ("));
  assert(!result.text.includes("Tax ("));
});
```
Rest of the file untouched. The obsolete `taxBreakdown` fixture setup was dropped (no renderer reads it); the assertion now pins the current inclusive-VAT note + a negative that guards against the jurisdiction label reappearing.

---

## FIX 2 — ORCH-1345: `mingla-business/src/components/venue/__tests__/VenueCreatorWizard.ve2.test.ts`

### Current-contract evidence (`mingla-business/src/components/venue/VenueCreatorWizard.tsx`)
Token counts in the current wizard source (grep -cF):
- Present (current contract): `useCreateVenueListing` ×2 (import L52 + `const createVenue = useCreateVenueListing()` L181), `createVenue.mutateAsync` ×1 (L344), `coverChoice` ×6 (L292 `const coverChoice = claim?.coverChoice ?? st.coverChoice ?? null` etc.), `coverMediaUrl: coverChoice?.url` ×2 (L362, L380).
- Absent (removed architecture): `CoverPickerSheet` 0, `syncHeroMedia` 0, `runTier2Pipeline` 0, `confirmAiOutputs` 0, `refreshDeckReadiness` 0, `initialPendingBio` 0, `initialTier2` 0, `focus === "cover"` 0, `uploadBrandCover` 0, `ImagePicker.launchImageLibraryAsync` 0.
- The current folded flow is already covered by `venueAuthoringOneSubmission.metaOrch1290.test.ts` + `venueApproveGeneratesPitch.orch1304.test.ts`.

### Red proof (before)
`npx jest … VenueCreatorWizard.ve2.test.ts` → `1 failed`; failure at `ve2.test.ts:12` — `expect(src).toContain("CoverPickerSheet")` (removed token).

### Decision: rewrite-in-place (NOT delete)
The append-only gate (`.github/scripts/test-append-only-check.js`) forbids test-file DELETION with **no override token available** ("Deletions cannot be overridden"). Deletion was therefore not viable. Rewrote in place (status M) to the current contract, covered by the `[TEST-MOD-APPROVED ORCH-1345]` token.

### Before
Asserted the removed Tier-1→CoverPickerSheet→Tier-2 pipeline: `placePoolId: st.placePoolId`, `upsertTier1Place`, `CoverPickerSheet`, `syncHeroMedia`, `runTier2Pipeline`, `confirmAiOutputs`, `refreshDeckReadiness`, `initialPendingBio`, `initialTier2`, `focus === "cover"`, plus negatives `not uploadBrandCover`, `not ImagePicker.launchImageLibraryAsync`.

### After
```ts
expect(src).toContain("useCreateVenueListing");
expect(src).toContain("createVenue.mutateAsync");
expect(src).toContain("coverChoice");
expect(src).toContain("coverMediaUrl: coverChoice?.url");
expect(src).not.toContain("CoverPickerSheet");
expect(src).not.toContain("runTier2Pipeline");
expect(src).not.toContain("uploadBrandCover");
expect(src).not.toContain("ImagePicker.launchImageLibraryAsync");
```
Positives pin the folded single-submission cover-submit contract; negatives keep the removed architecture (CoverPickerSheet/Tier-2) and still-valid image-picker paths out.

---

## Suite results (after)

**Deno — shell.test.ts:** `ok | 10 passed | 0 failed (44ms)`

**Jest — VenueCreatorWizard.ve2.test.ts:** `Test Suites: 1 passed, 1 total` / `Tests: 1 passed, 1 total`

## Product code UNCHANGED
`git status --porcelain` shows ONLY the two test files modified. `git diff --name-only` for `ticketBody.ts`, `shell.ts`, `VenueCreatorWizard.tsx` → empty. No product code touched.

## Append-only gate handling
Both edits are status `M` with deleted lines → require `[TEST-MOD-APPROVED ORCH-NNNN]` in the latest commit body (per `.github/workflows/tests-append-only.yml` + `.github/scripts/test-append-only-check.js`). Neither is a file deletion (deletion cannot be overridden), so both fixes stay as in-place modifications. The single closing commit body carries BOTH `[TEST-MOD-APPROVED ORCH-1330]` and `[TEST-MOD-APPROVED ORCH-1345]`, each with a bracketed feature label (Rule 0), and documents that each edit updates a test asserting REMOVED behavior. Local gate run confirmed PASS.

## Step-0.5 regression gate: BACKFILL-EXEMPT
Reason: this is a pure test-drift correction with zero product-code touch — "restore the removed feature" is explicitly the wrong option, so a fails-on-revert against product code does not apply. (Both rewritten tests are source-contract tests and inherently fail if the product contract regresses.)

## Discoveries for Orchestrator
None. Both were exactly the pre-existing test reds described in the dispatch. Note: `upsertTier1Place` and `placePoolId: st.placePoolId` remain in the wizard for the claim-mode path — the rewritten ve2 test intentionally does not assert them (they are not the cover-submit contract).
