# Implementation Rework ORCH-0769B: Draft Autosave Currency NOT NULL

Date: 2026-05-09
Implementor: Codex `$implementor`
Status: implemented and verified

## Summary

Fixed the draft autosave regression where a legacy/local draft with `currency: null` could upload cover media successfully, then fail autosave with:

```text
null value in column "currency" of relation "events" violates not-null constraint
```

The event cover MOV upload path was left untouched. This rework only makes server draft create/autosave currency-safe after ORCH-0769 made `events.currency` mandatory.

## Root Cause

`serverDraftEventMapper.ts` mapped `currency: draft.currency` directly into server insert/update payloads. Legacy/local drafts can still carry `draft.currency === null`, so `autosaveServerDraft` could explicitly write `events.currency = null`. Postgres correctly rejects that because `events.currency` is now `NOT NULL`.

## Files Changed

- `mingla-business/src/services/eventDrafts.ts`
- `mingla-business/src/utils/serverDraftEventMapper.ts`
- `mingla-business/src/services/__tests__/eventDraftsCurrency.test.ts`
- `mingla-business/src/utils/__tests__/serverDraftEventMapper.test.ts`
- `mingla-business/src/services/__tests__/businessEventsPublish.test.ts`

## Behavior Implemented

### Server Draft Create

`createServerDraft` now resolves an effective currency before building the insert payload:

1. `sourceDraft.currency`
2. brand `default_currency`
3. `GBP`

### Server Draft Autosave

`autosaveServerDraft` now reads existing server `theme,currency`, then resolves:

1. local `draft.currency`
2. existing server `events.currency`
3. brand `default_currency`
4. `GBP`

That resolved currency is written both to the top-level `events.currency` update and to `theme.business_draft.currency`, so reload cannot rehydrate the same draft back into a null-currency loop.

### Defensive Mapper Contract

`draftToServerInsert`, `draftToServerUpdate`, and `theme.business_draft.currency` now normalize currency through the shared `normalizeCurrency` utility. Even if a caller accidentally passes a null-currency draft, the mapper does not emit `currency: null`.

### Regression Fixture Repair

The `businessEventsPublish.test` RPC fixture now includes `event.currency`, matching the current ORCH-0769 publish/management response contract.

## Tests Added/Updated

Added `eventDraftsCurrency.test.ts` covering:

- `createServerDraft` falls back to brand default when source draft currency is null.
- Autosave preserves existing server event currency when local draft currency is null.
- Autosave falls back to brand default when local and server currencies are missing.
- Autosave final fallback is GBP for fully legacy null-currency rows.
- Explicit draft currency wins over server and brand defaults.
- Cover media autosave keeps `cover_media_url` / `cover_media_type` while writing non-null currency.

Updated `serverDraftEventMapper.test.ts` covering:

- null-currency insert/update payloads normalize to GBP instead of null.
- `theme.business_draft.currency` is non-null.
- explicit USD currency survives update and hydration.

## Verification

From `mingla-business`:

```bash
/opt/homebrew/bin/npx jest --runInBand src/services/__tests__/eventDraftsCurrency.test.ts src/utils/__tests__/serverDraftEventMapper.test.ts
```

PASS: 2 suites, 16 tests.

```bash
/opt/homebrew/bin/npm run test:orch-0769
```

PASS: strict guard plus 6 suites, 36 tests.

```bash
/opt/homebrew/bin/npm run test:orch-0763 -- --runInBand --testNamePattern='draft|autosave|currency|cover'
```

PASS: 5 suites passed, 2 skipped by testNamePattern, 38 tests passed.

```bash
/opt/homebrew/bin/npm run test:orch-0766f
```

PASS: event-cover QuickTime storage MIME guard.

```bash
/opt/homebrew/bin/npx tsc --noEmit
```

PASS.

```bash
/opt/homebrew/bin/npx eslint src/services/eventDrafts.ts src/utils/serverDraftEventMapper.ts
```

PASS.

From repo root:

```bash
git diff --check
```

PASS.

Note: Jest emitted the existing Watchman recrawl warning. It did not fail tests.

## Manual Runtime Gate

Tester/operator should repeat the real-device flow that exposed the issue:

1. Open the same draft/event creator Step 4.
2. Upload the valid iPhone `.MOV`.
3. Confirm logs still show `upload-verified`.
4. Confirm no `[useServerDraftAutosave]` `23502` / `events.currency` null error appears.
5. Navigate away/reload the draft and confirm the uploaded video cover persists.

## Scope Guard

No changes were made to:

- Event cover Storage migrations or bucket policy.
- Event cover picker/trimmer/renderer behavior.
- Giphy/Pexels/provider integration.
- Stripe onboarding/account creation.
- Checkout/payment semantics.
- Broad revenue/reconciliation UI.
