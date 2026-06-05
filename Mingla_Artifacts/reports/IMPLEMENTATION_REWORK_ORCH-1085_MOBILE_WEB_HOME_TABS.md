# IMPLEMENTATION REWORK - ORCH-1085 Mobile Web Home Tabs

Date: 2026-06-05
Branch: `ORCH-1085-mobile-web-home-tabs`
Surface: Mingla Business web, mobile browser signed-in Home

## Trigger

Seth confirmed the crash-stop Home fixed sign-in reliability but correctly rejected it as the final Home experience because it did not look like the Business Home and did not expose tabs.

## Change

The static `/home.html` mobile-browser Home was upgraded from a placeholder crash barrier into a lightweight Business Home shell:

- Branded Mingla Business top bar.
- Product-facing Home copy instead of technical browser-mode copy.
- Five-tab bottom navigation matching the real Business tab contract: Home, Hub, Ari, Blast, Account.
- In-page tab switching for Hub, Ari, Blast, and Account so the signed-in mobile browser path remains light and does not boot Expo just to navigate Home tabs.
- Deeper actions still link to full app routes when the user intentionally chooses a tool.

The ORCH-1085 regression guard was hardened so the placeholder copy cannot pass again and the five tabs are required.

## Verification

Automated:

- `npm run test:orch-1085` - PASS.
- `EXPO_NO_TELEMETRY=1 npx expo export --platform web --output-dir web-build-orch1085-tabs` - PASS.
- `ORCH_1085_WEB_BUILD=web-build-orch1085-tabs npm run test:orch-1085` - PASS.
- `ORCH_1083_WEB_BUILD=web-build-orch1085-tabs node scripts/ci/orch-1083-initial-bundle-budget.mjs` - PASS; initial payload `2912217` bytes, `128` chunk files, zero deferred specifiers in the main entry chunk.

Physical Android Chrome:

- Device: Samsung SM-A725F, serial `R58R54YV7JT`.
- URL: `http://127.0.0.1:43186/home.html` via `adb reverse`.
- Screenshot: `Mingla_Artifacts/reports/orch-1085-tabs-evidence/local-android-tabbed-home.png`.
- DevTools tab-switch proof: Hub, Blast, Account, and Home all activate in the lightweight shell; all five tab labels remain present.
- Crash-only log grep: `0` lines in `Mingla_Artifacts/reports/orch-1085-tabs-evidence/local-android-tabbed-home-crash-only-log.txt`.

## Residual

This remains a lightweight mobile-web Home shell, not a full data-hydrated clone of the native/Expo Home. That is intentional for the signed-in phone-browser entry path: it preserves deterministic sign-in reliability while restoring a credible Home and tab navigation. Full app routes still load only when selected.
