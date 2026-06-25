# Public store submission plan — App Store + Play Store (both apps)

**Date:** 2026-06-22
**Goal:** Submit consumer + business apps for PUBLIC review on App Store + Play Store, then publish on approval (manual release).
**Backend:** LIVE (done). Builds bundle pk_live (done).

---

## Status at a glance

| | Consumer (app-mobile) | Business (mingla-business) |
|---|---|---|
| Production build | iOS 29 + Android 16 DONE | **none yet** — needs fresh prod build |
| On test track | TestFlight + Play internal LIVE | not yet |
| Store metadata (desc/screens/keywords) | drafted (ORCH-0977) | **none exists** |
| Privacy / data-safety / age-rating answer sheets | EXIST (ORCH-0977 docs) | **none** — must be authored |
| Reviewer demo access | phone bypass +12015550199/123456 (live) | **none** — business needs its own brand/venue demo |
| Subscriptions (IAP) | 3 Mingla Plus — must be "Ready to Submit" | none (no IAP) — simpler |
| Net distance to public submit | ~90% (dashboard fields + subs + policy) | large (build + full listing + reviewer flow) |

**Bottom line:** consumer can enter App Review within an hour of dashboard work; business needs a metadata-creation sprint first.

---

## What only Seth can do (Apple/Google web UIs — no API)

### App Store Connect — CONSUMER
1. App Information: Subtitle, **Category** (Lifestyle / Social Networking), **Age Rating** questionnaire, Content Rights.
2. App Privacy → **Privacy Policy URL** `https://usemingla.com/privacy-policy` + nutrition labels (Device ID/IDFA = Used to Track = YES).
3. Version page: **Support URL** `https://usemingla.com/support`, **Copyright** `2026 MINGLA LLC`, App Review **Contact Info** + Notes (bypass), Release = **"Manually release"**.
4. **Pricing and Availability**: Free + territories.
5. **Subscriptions**: weekly/monthly/annual → status "Ready to Submit"; sign **Paid Applications agreement** (Business → Agreements). Attach to the version.
6. Click **Add for Review → Submit**.

### Play Console — CONSUMER
1. Create a **Production** release (promote internal build 16 or fresh).
2. **Main store listing**: title, short + full description, screenshots, **feature graphic 1024x500 (required)**, icon.
3. **App content**: Data Safety form, Content rating (IARC), Target audience, Ads=No, App access (reviewer bypass), Privacy Policy URL, Financial features=No, Government=No.
4. **Countries/regions** + Free pricing.
5. Enable **Managed publishing** (so approval ≠ auto-go-live), submit production release.

### Both stores — BUSINESS (after metadata authored)
Same dashboards, category = **Business**, no subscriptions, its own reviewer demo (brand/venue account).

---

## What the orchestrator can do (automate / drive)
- A. **Fix the live Privacy Policy** to list all ~17 processors (marketing `[deploy]` PR) — prevents a policy-mismatch rejection on BOTH stores. ~15 min.
- B. **Author business store metadata** (description, subtitle, keywords, screenshots spec, data-safety + age-rating + privacy answer sheets, reviewer demo flow) via mingla-product + forensics.
- C. **Build + submit** the business production binaries (eas), and promote consumer Android internal→production via Play API.
- D. Provide every paste-ready value for the manual dashboard fields (consumer done; business after B).
- E. Set both releases to manual/managed publishing so Seth clicks the final "Release"/"Publish".

---

## Publish-after-approval mechanism (what Seth asked for)
- **App Store:** choose "Manually release this version" → after approval the build sits at **"Pending Developer Release"** → Seth clicks **Release**.
- **Play:** enable **Managed publishing** → after approval the release sits ready → Seth clicks **Publish**.

## Realistic timeline
- Consumer App Store review: typically ~24–48h after submit.
- Consumer Play review: hours to **~7 days** for a brand-new app/developer.
- Business: + the metadata sprint (1–2 working sessions) before it can even be submitted.

## Risks / gaps
1. Privacy Policy is out of date (lists few processors; app uses ~17) — fix before submit (item A).
2. Business app has **no reviewer demo path** documented — must create a brand/venue demo or extend the OTP bypass.
3. Business store listing assets (screenshots, descriptions) do not exist — must be produced.
4. Apple Guideline 1.2 UGC safeguards: consumer has report/block/filter ✓; confirm business equivalents if it has UGC.
