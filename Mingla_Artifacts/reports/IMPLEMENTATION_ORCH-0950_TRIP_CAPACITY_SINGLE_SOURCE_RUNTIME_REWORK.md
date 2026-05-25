# IMPLEMENTATION RUNTIME REWORK - ORCH-0950 Trip Capacity Single Source

Date: 2026-05-24
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]`
Branch: `ORCH-0950-trip-capacity-single-source`
Status: implemented, partially verified

## 1. Retest Prompt

Codex tester-mingla retest returned FAIL in `Mingla_Artifacts/reports/QA_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE_RETEST.md` because the mandatory authenticated runtime matrix was incomplete. P1-001 was already fixed, static regressions passed, and DC Adventure checkout live-fire passed. This rework was limited to runtime proof or bounded rework for authenticated iOS simulator, Android emulator, business-web preview, canonical capacity persistence, reload/display behavior, legacy JSONB non-regression, and buyer checkout preservation.

Hard guards preserved:

- No migration apply.
- No edge deploy.
- No checkout RPC changes.
- No ORCH-0946 or ORCH-0947 scope.
- No product-code changes in this runtime pass.

## 2. Live Fixture

Runtime proof used the existing live trip fixture:

| Field | Value |
|---|---|
| Event | The DC Adventure |
| Event id | `060d0483-50db-48d1-840b-73d9fc59356a` |
| Ticket type id | `d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e` |
| Brand context | Travel Brand, `becddd00-85b1-4c95-81ba-f888954a4fa7` |

Before this runtime pass, tester live proof showed `ticket_types.quantity_total=100` and no `events.theme.business_trip.capacity`.

## 3. Runtime Matrix

| Runtime gate | Result | Evidence | Notes |
|---|---|---|---|
| iOS simulator | PASS | Maestro opened `mingla-business://trip/060d0483-50db-48d1-840b-73d9fc59356a/edit`, edited capacity 100 to 101, confirmed the review modal, and the live row updated to `ticket_types.quantity_total=101` with no legacy JSONB capacity key. Reload screenshot: `/tmp/orch0950-ios-reload-edit-101.png`. | Device: iPhone 17 Pro simulator, app id `com.sethogieva.minglabusiness`. |
| Business-web preview | PASS | Playwright authenticated `http://localhost:8087/trip/060d0483-50db-48d1-840b-73d9fc59356a/edit`, verified capacity 101, edited to 102, confirmed the review modal, reloaded the route, and verified the editor displayed 102. Screenshot: `/tmp/orch0950-web-edit-reloaded-102.png`. | Evidence script: `Mingla_Artifacts/evidence/orch-0950-runtime/web-authenticated-edit.spec.js`. |
| Backend canonical row | PASS | Post-web probe returned `quantity_total=102`, `updated_at=2026-05-24T22:17:15.180685+00:00`, and `hasThemeCapacity=false`. | Confirms runtime writes stayed in `ticket_types.quantity_total` and did not restore `events.theme.business_trip.capacity`. |
| Buyer checkout after edits | PASS | Quantity-6 checkout after the iOS edit returned `requires_web_redirect`, EUR 75000, hosted URL present, session `789bc279-56e0-4631-a451-01ec5cec7208`. Quantity-6 checkout after the web edit returned `requires_web_redirect`, EUR 75000, hosted URL present, session `5da11765-1e7f-4dd4-ae8d-bee6fbae758a`. | No checkout RPC source was changed. |
| Android emulator | BLOCKED | `Pixel_8_Pro` booted, but `npx expo run:android --variant debug` failed before install during `app:assembleDebug`. The failure is native CMake configuration for `react-native-worklets`; app id `com.sethogieva.minglabusiness` never installed. | This is a runtime-environment/native-build blocker, not evidence of an ORCH-0950 capacity regression. |

## 4. Commands Run

Representative runtime commands:

```bash
maestro test Mingla_Artifacts/evidence/orch-0950-runtime/ios-current-open-review.yaml
maestro test Mingla_Artifacts/evidence/orch-0950-runtime/ios-current-enter-review-reason.yaml
maestro test Mingla_Artifacts/evidence/orch-0950-runtime/ios-current-confirm-review-save.yaml
NODE_PATH=/Users/sethogieva/.npm/_npx/420ff84f11983ee5/node_modules npx --yes @playwright/test test --config Mingla_Artifacts/evidence/orch-0950-runtime/playwright.config.js --reporter=line
npx expo run:android --variant debug
git diff --check
```

Key outputs:

```text
iOS post-save DB probe:
quantity_total=101
hasThemeCapacity=false

Web Playwright:
1 passed (7.3s)

Post-web DB + checkout probe:
quantity_total=102
hasThemeCapacity=false
checkoutKind=requires_web_redirect
hasHostedUrl=true
checkoutSessionId=5da11765-1e7f-4dd4-ae8d-bee6fbae758a

Android:
BUILD FAILED during app:assembleDebug before install
react-native-worklets CMake configure exited non-zero

Whitespace:
git diff --check produced no output
```

## 5. Bounded Rework Conclusion

iOS simulator, business-web preview, backend canonical row, reload/display behavior, legacy JSONB non-regression, and buyer checkout preservation are now proven against the live DC Adventure fixture. Android remains the only incomplete mandatory runtime row because the local native debug build fails before the business app installs; fixing that requires native build-environment or dependency work outside ORCH-0950's capacity single-source scope. No DB push, edge deploy, checkout RPC edit, ORCH-0946 edit, or ORCH-0947 edit was performed.

## 6. Next Retest Request

Ask Codex tester-mingla to retest ORCH-0950 using this report plus the prior retest report. Expected tester output: `Mingla_Artifacts/reports/QA_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE_RUNTIME_RETEST.md`. PASS can route to Codex orchestrator-mingla for CLOSE if tester accepts Android as an environment-blocked manual gate; FAIL routes back to Codex implementor-mingla only if tester identifies an ORCH-0950 code or data-contract regression.
