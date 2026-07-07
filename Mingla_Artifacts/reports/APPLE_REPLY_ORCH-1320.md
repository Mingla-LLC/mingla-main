# ORCH-1320 — App Review reply (Guideline 2.1(a), Submission 8d0b57b5-…, build 1.0(28))

Paste into the App Store Connect Resolution Center reply, alongside submitting build 1.0.2 (30) for review.

---

Hello, and thank you for the detailed crash report.

We identified and fixed the root cause of the crash when tapping the Account tab. It was a rare race condition inside a third-party animation library (React Native Reanimated) during the tab transition, which produced a native memory error. It was not specific to Sign in with Apple — that was simply the path used to reach the screen.

Build 30 (version 1.0.2) resolves it in two ways: we moved the tab-bar animation off the affected code path so it can no longer race the screen's rendering, and we updated the animation library to the release that contains the upstream fix for this race condition. We tested the Account tab and rapid tab navigation on device and no longer reproduce the crash.

This build is ready for your review. Thank you for your patience.

---
