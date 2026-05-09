# TESTER RUNTIME PROMPT: ORCH-0763 Free Event Publish + Share Device Sweep

You are `$tester` for Mingla. Run a real iOS simulator QA pass for the event publish/share flow and document every flaw found.

## Required Output

Write:

`Mingla_Artifacts/reports/RUNTIME_ORCH-0763_FREE_EVENT_SHARE_DEVICE_SWEEP.md`

Verdict options:

- PASS
- CONDITIONAL PASS
- FAIL
- BLOCKED/UNVERIFIED

## Operator Intent

The operator wants a thorough runtime sweep before more fixes are made:

1. Use the open iOS simulator.
2. Access the test Stripe-enabled brand.
3. Create a polished/great event with **only free tickets**.
4. Publish the event.
5. Test every available share/copy/link button.
6. Open all generated links in a browser.
7. Document every error/blocker as it happens.
8. Delete/clean up the test event at the end if the app provides a safe supported deletion/cancel path.

## Known Context

ORCH-0763 fixed major publish/link authority issues, and migration `20260515000004` has been pushed and verified remote-applied.

Known runtime blocker already reported by operator:

- Manually copying/opening the visible public link works.
- **Copy link** copies nothing.
- **Share via...** opens the phone sheet but shares an Expo/dev link instead of the SEO public event webpage.

Related handoff:

- `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0763C_SHARE_COPY_NATIVE_URL_REPAIR.md`

This runtime test should still document the full blast radius, including that known share/copy issue, unless implementor rework has already landed before you run.

## Evidence To Read

- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`
- `Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`
- `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0763C_SHARE_COPY_NATIVE_URL_REPAIR.md`
- `Mingla_Artifacts/PRIORITY_BOARD.md`
- `Mingla_Artifacts/MASTER_BUG_LIST.md`

## Test Setup

Use the currently open iOS simulator/dev client if available.

Record:

- app environment/build identifier if visible,
- signed-in user identity if safe to mention,
- brand used,
- event title,
- event ID,
- public URL,
- browser used for cold link tests,
- exact time/date of the run.

If login/session/brand access blocks the test, document the blocker precisely and stop with `BLOCKED/UNVERIFIED`.

## Event To Create

Create a high-quality but disposable event:

- Clear title, not just "test".
- Realistic description.
- Realistic date/time.
- Realistic venue or online setting.
- Free tickets only.
- At least one public free ticket tier.
- No paid ticket, no approval/password/waitlist complexity unless already enabled by default.

Do not create paid transactions.

## Required Test Matrix

### A. Publish Flow

1. Create the event.
2. Confirm Step 7 does not show a guessed `draft-*` public URL before publish.
3. Publish the event.
4. Confirm the post-publish organiser route uses durable server-backed event identity.
5. Confirm the event appears in organiser Events/Home where expected after refresh/navigation.

### B. Public Page

1. Open the visible public event link directly.
2. Open the same URL in a cold browser/incognito-like browser session if available.
3. Confirm URL is:
   - `https://business.usemingla.com/e/{brandSlug}/{eventSlug}`
4. Confirm URL is not:
   - `exp://...`
   - localhost/LAN
   - app scheme/deep link
   - `business.mingla.com`
   - `mingla.com/e/...`
   - `draft-*` slug
5. Confirm public page shows the event title, description, date/time, venue/online info, and free ticket CTA.

### C. Share Modal / Buttons

Test every visible share/copy/open route from:

- organiser Event Detail share icon,
- Events tab manage/share action,
- public event page share button,
- any visible "open link" / URL box,
- Copy link,
- Share via...
- Twitter/X,
- WhatsApp,
- Email,
- SMS,
- QR code if scannable/screenshotable.

For each, record:

- button name,
- actual payload/URL produced,
- whether it opens/copies/shares,
- whether it is canonical public web URL,
- whether it is clickable by the recipient/browser,
- screenshots or exact text where possible.

### D. Management Subroutes

From the published event detail, test visible management routes:

- Orders
- Guests
- Scan tickets
- Scanners
- Door Sales if enabled/visible
- Reconciliation
- Public page
- Brand page

Record any false "Event not found" / "Order not found" / blank/loading failures.

### E. Cleanup

Try to delete/cancel/remove the test event only through a supported safe app path.

If event deletion is unavailable or server-backed lifecycle actions honestly say unavailable, record that outcome. Do not mutate production data manually in Supabase. Do not use SQL cleanup unless explicitly authorized by the operator.

## Command Checks

From `mingla-business/`, run:

```bash
npm run test:orch-0763
npm run test:orch-0759
npm run test:orch-0756b
npx tsc --noEmit
```

From repo root:

```bash
git diff --check
/Users/sethogieva/bin/supabase migration list --linked
```

## Report Requirements

Include:

1. Verdict.
2. Layman summary.
3. Environment/session/brand/event details.
4. Step-by-step timeline.
5. Findings table with severity P0/P1/P2/P3/P4.
6. Share/copy matrix.
7. Public browser link results.
8. Management route results.
9. Cleanup result.
10. Screenshots/log snippets if available.
11. Exact recommended next action:
    - implementor rework if blockers found,
    - retest if no blockers,
    - orchestrator close only if all close gates pass.

## Severity Guidance

P1:

- Copy/share sends Expo/dev/local/non-public URL.
- Copy link copies nothing.
- Published event cannot open in browser.
- Public page opens but does not show event.
- Server-published event routes false-404.

P2:

- Social deep-link intent opens but payload is malformed while main copy/share works.
- Cleanup unavailable but honestly messaged.
- Minor metadata/SEO mismatch that does not block link opening.

P3/P4:

- Cosmetic copy, small toast wording, minor button polish.

Do not declare ORCH-0763 closed from tester mode.
