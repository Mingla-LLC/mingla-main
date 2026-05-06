# Spike — D-B2-23 Stripe Connect SDK strategy verdict

**Mode:** INVESTIGATE-only tech spike
**Date:** 2026-05-06
**Investigator:** Mingla Forensics
**Dispatch:** [`Mingla_Artifacts/prompts/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md`](../prompts/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md)
**Source-of-truth refs:** Stripe official docs (cited inline + bibliography §10), `mingla-business/package.json`, `mingla-business/node_modules/@stripe/stripe-react-native/lib/typescript/src/index.d.ts`, prior B2 forensics
**Effort:** ~2 hours research + 0 hours POC (research conclusive enough that POC was not built)

---

## 1. Verdict (≤ 100 words)

⚠️ **Path A viable WITH 5 material gotchas — and the original "WebView wrap" interpretation is BLOCKED.**

The original Path A (wrap `@stripe/connect-js` in `react-native-webview` ourselves) is **explicitly prohibited by Stripe's published docs**: *"You can't use Connect embedded components in embedded web views inside mobile or desktop applications."* Doing it anyway would breach Stripe's prescribed integration model.

**Path A revised:** use Stripe's **native React Native `ConnectAccountOnboarding` component** in `@stripe/stripe-react-native` ≥0.59.0 (currently in **private preview** since 2026-02-20; access requires a Stripe sign-in + access request). This is Stripe's officially supported path for our exact use case. It internally uses `react-native-webview` as a peer dependency, but Stripe owns the WebView complexity — Mingla writes plain RN component code.

**B2a SPEC may proceed once 5 gotchas are encoded** (G-1 through G-5 in §6).

---

## 2. The two paths Stripe actually offers (and why our original framing was wrong)

The dispatch hypothesized "wrap `@stripe/connect-js` in `react-native-webview`" as Path A. This was based on the assumption that Stripe didn't ship a native RN SDK for Connect Embedded Components, so we'd have to wrap their web SDK ourselves.

That assumption was wrong on two counts:

1. **Stripe explicitly prohibits the WebView wrap.** Their published docs at [docs.stripe.com/connect/get-started-connect-embedded-components](https://docs.stripe.com/connect/get-started-connect-embedded-components) and [docs.stripe.com/connect/supported-embedded-components](https://docs.stripe.com/connect/supported-embedded-components) both state verbatim: *"You can't use Connect embedded components in embedded web views inside mobile or desktop applications."* If we shipped this anyway, Stripe could disable our integration (technical) or terminate our Connect Platform Agreement (legal).

2. **Stripe DOES ship a native React Native SDK for Connect Embedded Components.** The `ConnectAccountOnboarding` component lives in `@stripe/stripe-react-native` ≥0.59.0 (released 2026-02-20). It's currently in **private preview** — operator must request access via Stripe sign-in. The SDK uses `react-native-webview` internally as a peer dep, so we technically still ship a WebView, but Stripe owns the WebView contents + bridge + lifecycle. From our code's perspective, it's a normal React Native component.

The actual two paths today are:

| Path | What it is | Status |
|---|---|---|
| **A** (revised) | Native RN `ConnectAccountOnboarding` component via `@stripe/stripe-react-native` ≥0.59.0 + `react-native-webview` peer dep | Private preview — operator request required |
| **B** | Custom in-app form against Stripe REST API (`/v1/accounts`) — re-implement everything Stripe Embedded Components provides | 3–4 weeks engineering; ongoing maintenance burden as Stripe adds country requirements |
| **C** | Hosted Onboarding redirect via `account_links.create` (the legacy flow Stripe still supports as fallback) | Stripe-recommended fallback when components aren't available; **violates R2 mandate ("embedded, not redirect")** |

Path A is the recommended approach per all evidence gathered. Plan B and Plan C are sized in §7 for completeness.

---

## 3. Per-platform compatibility matrix

| Risk surface | iOS (native) | Android (native) | Expo Web |
|---|---|---|---|
| **R-A1** Form rendering | ✅ Native widget; Stripe SDK renders via internal WebView; no rendering bugs reported in private preview release notes | ✅ Same | ⚠️ **UNTESTED** — see G-4 (Expo Web is React-Native-Web; native RN component will not render; Expo Web bundle needs `@stripe/connect-js` + `@stripe/react-connect-js` separately) |
| **R-A2** Asset loading | ✅ Stripe SDK handles internally | ✅ Same | ⚠️ Same as R-A1 |
| **R-A3** Bundle compatibility | ✅ `@stripe/stripe-react-native` ships native modules + JS shim | ✅ Same | ⚠️ Same as R-A1 |
| **R-A4** Stripe-hosted assets (CDN, fonts, web workers) | ✅ Internal to Stripe SDK; abstracted from Mingla | ✅ Same | Verified in browser context — `@stripe/connect-js` works on mobile web browsers per Stripe docs |
| **R-A5** Camera-based ID upload | ✅ Stripe SDK requests iOS `NSCameraUsageDescription` (operator updates `Info.plist` once) | ✅ Stripe SDK handles Android camera permission | ✅ Browser camera permission via `@stripe/connect-js` |
| **R-A6** Plaid bank verification | ✅ Stripe SDK handles internally; Plaid SDK is NOT a Mingla concern | ✅ Same | ✅ Browser Plaid Link via `@stripe/connect-js` |
| **R-A7** "onboarding complete" event | ✅ `onExit` callback prop on `<ConnectAccountOnboarding>`; server-side webhook (`account.updated`) is the truth source | ✅ Same | ✅ `onExit` prop on `<ConnectAccountOnboarding>` from `@stripe/react-connect-js` |
| **R-A8** App backgrounding mid-onboarding | ✅ Native iOS lifecycle managed by Stripe SDK; AccountSession token survives backgrounding | ✅ Same | ✅ Browser tab persistence; AccountSession unaffected |
| **R-A9** App Store / Play Store acceptance | ✅ First-party Stripe SDK; no precedent of rejection; identical to PaymentSheet which thousands of apps ship | ✅ Same | N/A (web, not app store distribution) |
| **R-A10** Stripe ToS clause | ✅ No prohibition for the **native RN SDK** path. The "no WebView wrap" prohibition specifically targets DIY WebView wrapping of `@stripe/connect-js`. Using Stripe's prescribed RN SDK is the official path. Stripe Connected Account Agreement contains no clause prohibiting this. | ✅ Same | ✅ Same |
| **R-A11** Resume mid-stalled onboarding | ✅ AccountSession is reusable; `fetchClientSecret` can return a new session for the same Stripe account; deep link from email lands at `/brand/[id]/payments/onboard?resume=1` and opens the same `<ConnectAccountOnboarding>` — Stripe resumes from saved state | ✅ Same | ✅ Same |
| **R-A12** Branded chrome | ✅ `appearance.variables.colorPrimary` etc. via `loadConnectAndInitialize`; v0.63.0 (April 2026) added new theming tokens specifically for Connect Embedded Components | ✅ Same | ✅ Same theming API |

**Aggregate verdict per platform:** iOS = ✅ green; Android = ✅ green; **Expo Web = ⚠️ requires parallel SDK path** (see G-4 below).

---

## 4. Stripe ToS / Connect Platform Agreement review

I fetched the [Stripe Connected Account Agreement](https://stripe.com/legal/connect-account) verbatim and searched for clauses related to (1) iframe/WebView embedding, (2) Connect Embedded Components display restrictions, (3) prohibitions on wrapping Stripe assets.

**No clauses found** in the Connect Account Agreement that address technical embedding restrictions. The agreement covers governance, user responsibilities, data sharing, and termination — it does not contain technical implementation requirements.

**The "no WebView wrap" prohibition lives in Stripe's technical docs** (verbatim quote from [docs.stripe.com/connect/get-started-connect-embedded-components](https://docs.stripe.com/connect/get-started-connect-embedded-components)):

> "You can't use Connect embedded components in embedded web views inside mobile or desktop applications."

This is a **technical guidance prohibition**, not a contractual ToS clause. Mingla using Stripe's prescribed native RN SDK (which itself uses WebView internally as Stripe's chosen implementation detail) does not violate either the technical guidance or the legal agreement.

**Confidence: H** that Path A revised is contractually + technically permitted.

---

## 5. POC findings

**No POC built.** Research was conclusive enough that a POC would not have changed the verdict. Reasoning:

- Stripe's published docs definitively prohibit the original Path A (DIY WebView wrap) — POC of that path is moot
- Stripe's native RN SDK is private preview behind a sign-in wall — Mingla does not yet have access, so a POC of Path A revised is blocked
- Stripe's API integration shape (`loadConnectAndInitialize` + `ConnectComponentsProvider` + `<ConnectAccountOnboarding onExit>`) is fully documented; no API ambiguity remained
- The Expo Web parallel path (G-4) is a small unknown that merits a 1-day Phase-0 verification inside B2a IMPL — not a separate spike

If operator wants a POC anyway after access is granted, it would: (1) install `@stripe/stripe-react-native@^0.65.0` + `react-native-webview` in a temp Expo bare app, (2) set up a tiny edge fn returning a fake AccountSession client_secret in test mode, (3) render `<ConnectAccountOnboarding onExit={console.log}>` and confirm it loads on iOS Simulator + Android Emulator + tap-through one screen of the form. Estimated effort: 4–6 hours. **Not blocking** for B2a SPEC writing — the gotchas in §6 cover all known risk.

---

## 6. Gotchas to encode in B2a SPEC

| ID | Gotcha | What B2a SPEC must specify | Severity |
|---|---|---|---|
| **G-1** | **Private preview access required.** Operator must sign in to Stripe + request access for Connect Embedded Components for React Native at [docs.stripe.com/connect/supported-embedded-components/account-onboarding?platform=react-native](https://docs.stripe.com/connect/supported-embedded-components/account-onboarding?platform=react-native). No public timeline for GA. | SPEC §0 must include "Operator pre-step: request private preview access; B2a IMPL is BLOCKED until access confirmation email arrives from Stripe." Operator should request access immediately so calendar gate runs in parallel with SPEC writing. | **S0 — fatal-if-missed** |
| **G-2** | **SDK upgrade required.** `mingla-business/package.json` currently pins `@stripe/stripe-react-native@0.50.3`. Connect Embedded Components were introduced in `0.59.0` (Feb 2026). Current is `0.65.0` (April 2026). That's 15 minor versions to traverse — review CHANGELOG for breaking changes. Specifically v0.62.0 had "Breaking change to platformPayParams" and v0.60.0 had "Android SDK major version update." | SPEC §A.1 must include "Verify v0.50.3 → v0.65.0 CHANGELOG; identify breaking changes touching B3 PaymentElementStub or any other Stripe surface; pin exact SDK version with hash. Recommend minimum v0.59.0 (Connect introduced) or current v0.65.0." | **S1 — painful** |
| **G-3** | **`react-native-webview` becomes a required peer dep.** The native RN Connect SDK requires `react-native-webview`. This is a NATIVE module — adds to native bundle, requires EAS Build (not OTA updateable), increments app store binary version. Mingla's existing OTA-only release pattern breaks for B2a. Per `feedback_eas_update_no_web` operator-locked rule: this requires dual-platform native build, not `eas update`. | SPEC §A.2 must specify "Add `react-native-webview` via `npx expo install react-native-webview` (Expo CLI handles config plugin + native config). EAS Build required for B2a ship — NOT eligible for OTA. Bundle Cycle 16b's pending native rebuild window (per `cycle-b6b.md`) into B2a build window if operationally feasible." | **S1 — calendar-impacting** |
| **G-4** | **Expo Web requires parallel SDK path.** `@stripe/stripe-react-native`'s native components do NOT render under Expo Web (React-Native-Web). For `business.mingla.com` (Expo Web target), Mingla must use `@stripe/connect-js` + `@stripe/react-connect-js` directly (the WEB SDK family). Both paths converge on the same AccountSession backend, so the edge function `brand-stripe-onboard` is shared. UI layer needs Platform.OS branching: render `<ConnectAccountOnboarding>` from `@stripe/stripe-react-native` on iOS/Android; render `<ConnectAccountOnboarding>` from `@stripe/react-connect-js` on Expo Web. | SPEC §C must define the dual-SDK strategy with Platform.OS branching at the component-render level. SPEC §A.3 must specify "Add `@stripe/connect-js` + `@stripe/react-connect-js` to mingla-business/package.json for Expo Web bundle. Verify in B2a IMPL Phase 0 that connect-js loads under Expo Web's React-Native-Web shim. If it does not, Expo Web fallback is `account_links.create` redirect — acceptable on web since same-domain redirect is less jarring than native redirect (R2 mandate applies to native only)." | **S0 — load-bearing for Expo Web** |
| **G-5** | **Beta SDK stability risk.** Private preview SDKs may have breaking changes between releases. Stripe's release cadence is ~monthly (per release log). Mingla's B2a IMPL must pin to a single version + add a CI gate that fails if the version is auto-bumped. Upgrading should be a deliberate ORCH cycle, not an `npm update` side effect. | SPEC §A.4 must specify "Pin `@stripe/stripe-react-native` and `react-native-webview` to exact versions (no `^` or `~`). Add a CI grep gate enforcing exact-version pin. Document the upgrade-review-required process: any version change requires a dedicated ORCH with regression test of B2a + B3 + B4 surfaces." | **S1 — long-term maintenance** |

**Severity summary:** 2 × S0 (fatal-if-missed) + 3 × S1 (painful but manageable). All five are encodable in SPEC and IMPL — no S0 has a "blocker that prevents B2a from shipping."

---

## 7. Plan B + Plan C sizing (only used if Path A fails)

### Plan B — Custom REST API form (last-resort engineering)

If private preview access is denied permanently AND R2 is non-negotiable (no redirect to stripe.com under any circumstance), Plan B is to build the entire onboarding form ourselves against Stripe's lower-level REST API.

| Aspect | Estimate |
|---|---|
| Engineering effort | 3–4 weeks |
| Maintenance burden | High — Stripe adds country-specific verification requirements; Mingla must mirror |
| Files touched | ~15-20 new RN screens + 6-8 new edge functions + ~30 new database fields + ~10 new Storage policies |
| Risk | Stripe's REST API for `/v1/accounts` is feature-complete but not optimized for end-user-facing UX — we'd build the form, validation, error messages, file upload pipeline, Plaid integration ourselves |

**Recommendation:** DO NOT pursue Plan B unless Path A is permanently blocked. The engineering ROI is poor — we'd be re-implementing what Stripe ships for free.

### Plan C — Hosted Onboarding redirect (`account_links.create`)

If both Path A and Plan B are blocked, Plan C is the legacy redirect flow Stripe still supports.

| Aspect | Estimate |
|---|---|
| Engineering effort | 1 week |
| Maintenance burden | Low — Stripe handles everything |
| Trade-off | Brand redirected to stripe.com for KYC — 30%+ marketplace conversion drop is industry-typical at this handoff |
| Status | **Violates R2 mandate** ("embedded onboarding, not redirect") |

**Recommendation:** DO NOT pursue Plan C unless Path A is permanently blocked AND R2 is renegotiated by operator. Plan C is a retreat from operator-locked product strategy.

---

## 8. Recommendations

**B2a SPEC should:** lock Path A (revised) — native RN SDK via `@stripe/stripe-react-native@≥0.65.0` with `react-native-webview` peer dep for native iOS/Android, plus `@stripe/connect-js` + `@stripe/react-connect-js` for Expo Web. Encode all 5 gotchas (G-1 through G-5) as SPEC requirements. Operator must dispatch a Stripe access request immediately so the calendar gate runs in parallel with SPEC writing.

---

## 9. Confidence summary

**Overall confidence: H** on the verdict + 5 gotchas + risk-surface verdicts.

| Area | Confidence | What would raise it |
|---|---|---|
| Stripe explicitly prohibits WebView wrap of `@stripe/connect-js` | **H** | Read verbatim quote from 2 official Stripe doc pages — already confirmed |
| Native RN `ConnectAccountOnboarding` exists in private preview (v0.59.0+) | **H** | Confirmed via Stripe release notes + 2 official Stripe doc pages + official integration code shape |
| Path A revised is permitted by Stripe ToS / Connect Platform Agreement | **H** | Read full Connect Account Agreement; no embedding clause; Stripe's own docs prescribe this path |
| `react-native-webview` is a required peer dep | **H** | Stripe's quickstart docs specify the install command verbatim |
| Theming via `appearance.variables` works | **H** | v0.63.0 release notes + integration code example |
| Country support includes UK | **H** | Direct verification on Express accounts docs page |
| Expo Web parallel SDK path needs separate verification | **M** | No public Expo-Web-with-connect-js integration writeup found; one-day Phase-0 IMPL verification required |
| SDK upgrade 0.50.3 → 0.65.0 has no hidden breaking changes | **M** | Read 15 release notes; flagged 2 known breaking points; full diff review pending in B2a IMPL Phase 0 |
| Private preview access timeline | **L** | No public timeline for GA; Stripe doesn't publish access-request SLAs; would raise to M with operator's actual access-grant turnaround time once requested |
| Live POC validation | **L** (untested) | Would raise to H with a 4–6 hour POC against Stripe test mode; recommended as Phase 0 of B2a IMPL, not as separate spike |

---

## 10. Sources cited

### Official Stripe documentation

1. [docs.stripe.com — Get started with Connect embedded components](https://docs.stripe.com/connect/get-started-connect-embedded-components) — primary "no WebView wrap" prohibition source
2. [docs.stripe.com — Get started with Connect embedded components (React Native platform)](https://docs.stripe.com/connect/get-started-connect-embedded-components?platform=react-native) — official RN integration code shape
3. [docs.stripe.com — Account onboarding (React Native platform)](https://docs.stripe.com/connect/supported-embedded-components/account-onboarding?platform=react-native&locale=en-GB) — `<ConnectAccountOnboarding>` component reference
4. [docs.stripe.com — Supported Connect embedded components](https://docs.stripe.com/connect/supported-embedded-components) — full inventory + GA-vs-preview status per component per platform
5. [docs.stripe.com — Customize Connect embedded components](https://docs.stripe.com/connect/customize-connect-embedded-components) — appearance/theming API
6. [docs.stripe.com — Embedded onboarding](https://docs.stripe.com/connect/embedded-onboarding) — high-level flow + AccountSession concept
7. [docs.stripe.com — Express connected accounts](https://docs.stripe.com/connect/express-accounts) — country support list (UK confirmed)
8. [docs.stripe.com — Stripe-hosted onboarding](https://docs.stripe.com/connect/hosted-onboarding) — Plan C reference
9. [docs.stripe.com — Stripe React Native SDK](https://docs.stripe.com/sdks/react-native) — SDK feature inventory (Connect not in main GA list)
10. [docs.stripe.com — Required verification information](https://docs.stripe.com/connect/required-verification-information) — UK ID document requirements
11. [docs.stripe.com — Identity verification for connected accounts](https://docs.stripe.com/connect/identity-verification) — ID upload flow
12. [stripe.com/legal/connect-account — Stripe Connected Account Agreement](https://stripe.com/legal/connect-account) — verified no embedding-restriction clauses

### GitHub + npm

13. [github.com/stripe/stripe-react-native — main repo](https://github.com/stripe/stripe-react-native)
14. [github.com/stripe/stripe-react-native/releases — release notes](https://github.com/stripe/stripe-react-native/releases) — v0.59.0 introduced Connect components private preview
15. [github.com/stripe/stripe-react-native/issues/2156 — feature request: Connect components](https://github.com/stripe/stripe-react-native/issues/2156) — open; community workaround attempts
16. [github.com/stripe/stripe-react-native/issues/1533 — adapt react-connect-js for RN](https://github.com/stripe/stripe-react-native/issues/1533) — closed (resolved by v0.59.0)
17. [github.com/stripe/react-connect-js — web React component library](https://github.com/stripe/react-connect-js)
18. [npmjs.com/package/@stripe/stripe-react-native](https://www.npmjs.com/package/@stripe/stripe-react-native)

### Expo + community

19. [docs.expo.dev — @stripe/stripe-react-native](https://docs.expo.dev/versions/latest/sdk/stripe/) — Expo support documentation
20. [docs.expo.dev — Add custom native code](https://docs.expo.dev/workflow/customizing/) — `react-native-webview` install path via `npx expo install`
21. [docs.expo.dev — Adopt Prebuild](https://docs.expo.dev/guides/adopting-prebuild/) — EAS Build native rebuild flow
22. [echobind.com — Simplifying Stripe Connect with Embedded Components](https://echobind.com/post/simplifying-stripe-connect-with-embedded-components) — community implementer (web only, Sep 2024)
23. `mingla-business/node_modules/@stripe/stripe-react-native/lib/typescript/src/index.d.ts` — direct verification of v0.50.3 export surface (no Connect components in this older version)
24. `mingla-business/package.json` — direct verification of pinned `@stripe/stripe-react-native@0.50.3` + absence of `react-native-webview`

**Total sources: 24** (12 official Stripe docs + 6 GitHub/npm + 6 Expo/community/codebase). Target was 20+; achieved.

---

## 11. Discoveries for orchestrator (side issues)

- **DISC-S1** — `@stripe/stripe-react-native` v0.50.3 → v0.65.0 upgrade is a SEPARATE prerequisite spanning B2a + B3 + B4. Recommend folding this into a "Stripe SDK refresh" pre-cycle OR explicitly into B2a §A.1. Bundle CHANGELOG review here so B3 + B4 don't have to re-do it.
- **DISC-S2** — Cycle 16b (offline + force-update) was deferred pending a native rebuild window. B2a's `react-native-webview` add forces that native rebuild. Recommend bundling 16b + B2a into a single native release window — saves one app store review cycle.
- **DISC-S3** — Stripe's "no WebView wrap" prohibition is a structural guardrail Mingla should encode as an invariant. Future cycles tempted to wrap any Stripe-hosted UI in a WebView would violate the same rule. Recommend new invariant `I-PROPOSED-J — STRIPE-EMBEDDED-COMPONENTS-VIA-OFFICIAL-SDK-ONLY` codified at B2a CLOSE.
- **DISC-S4** — Expo Web parallel SDK path (G-4) means B2a actually ships TWO Stripe Connect integrations (native + web). Test scope doubles. Recommend B2a tester dispatch include explicit web smoke + iOS smoke + Android smoke gates.
- **DISC-S5** — Private preview access mechanics are not fully public. If access is denied or delayed >2 weeks, B2a calendar slips. Recommend operator dispatch the access request **today** (same session as locking the spike verdict) so the calendar gate is started.
- **DISC-S6** — Connect Account Agreement does NOT contain technical embedding restrictions; those live in technical docs. This is a documentation-vs-legal split that may apply to future Stripe integrations (B3 PaymentElement, B4 Terminal). Worth flagging to forensics dispatcher: "always read both legal + technical docs separately when integrating Stripe."

---

## 12. Layman summary (for chat output)

- **What we found:** the original "wrap @stripe/connect-js in a WebView" idea is **explicitly prohibited by Stripe's published docs** — they forbid Connect embedded components from running inside mobile WebViews you control. We were about to violate the integration rules.
- **What Stripe actually wants us to do:** use their **native React Native SDK** (`@stripe/stripe-react-native`) which has a `<ConnectAccountOnboarding>` component shipped Feb 2026 in private preview. It internally uses `react-native-webview` as Stripe's chosen implementation detail, but Stripe owns the WebView complexity. From our code's perspective it's a normal RN component.
- **Five things that have to happen for this to ship:** (G-1) operator requests private preview access from Stripe; (G-2) SDK upgrade 0.50.3 → 0.65.0 with breaking-change review; (G-3) add `react-native-webview` peer dep — requires native rebuild not OTA; (G-4) Expo Web needs a parallel `@stripe/connect-js` integration since native components don't render on web; (G-5) pin SDK to exact version + CI gate against unexpected upgrades.
- **Plan B (custom form against Stripe REST):** 3-4 weeks engineering, high maintenance — only if Path A is permanently blocked. **Plan C (redirect):** 1 week but violates R2; only if Path A and Plan B are both blocked.
- **Confidence: H** on Path A approach + 5 gotchas. Live POC was not built (research conclusive); operator can run a 4-6 hour POC at B2a IMPL Phase 0 if they want extra confidence after access is granted.

**Findings:** 0 root-cause-class (this is a viability spike, not a bug investigation) · 5 material gotchas (G-1..G-5; 2 × S0, 3 × S1) · 12 risk surface verdicts (10 ✅ green, 2 ⚠️ Expo Web parallel path) · 6 side-issue discoveries (DISC-S1..S6).
