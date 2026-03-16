# Mingla — Product Marketing Document

> Created: 2026-03-16 | Status: Partial (Analytics/Attribution focus) | Other sections pending full analysis

---

## 1. Product Positioning

**Category:** AI-powered experience discovery and social planning
**Target:** Consumers looking to discover and plan real-world experiences (dates, outings, group activities)
**Core Value Prop:** Discover personalized experiences, plan them with friends, and make them happen
**Differentiator:** AI-matched experience recommendations + collaborative planning boards

> Updated: 2026-03-16 | Trigger: Initial analysis | Evidence: Navigation, services, tier structure | Confidence: M (needs full analysis for positioning depth)

---

## 2. Attribution & Campaign Measurement (Current State)

### What's Measurable Today
- **Install volume** per campaign/channel (AppsFlyer automatic)
- **Product engagement** patterns (Mixpanel — 25+ events)
- **Behavioral depth** (Supabase — card interactions, timing, location context)
- **Revenue** (RevenueCat — subscription status, LTV)

### What's NOT Measurable Today (The Gap)
- Campaign → signup conversion rate
- Campaign → onboarding completion rate
- Campaign → trial start rate
- Campaign → subscription conversion rate (ROAS)
- Campaign → viral coefficient (invites per acquired user)
- Campaign → engagement quality (saves, schedules per acquired user)
- D1/D7/D30 retention per campaign source

### Why This Matters
Without AppsFlyer in-app events, every campaign optimization decision is based on install volume alone. A campaign bringing 10,000 installs with 1% subscription rate is worse than one bringing 1,000 installs with 15% subscription rate — but today, both look the same.

### Recommended Events for Attribution

**Must-have (5):** af_complete_registration, af_tutorial_completion, af_subscribe, af_invite, af_add_to_wishlist

**Full set (12):** + af_start_trial, af_content_view, af_share, experience_scheduled, collaboration_session_created, referral_completed, af_login

See RECOMMENDATIONS_REPORT.md for full event specifications with parameters.

> Updated: 2026-03-16 | Trigger: AppsFlyer event selection task | Evidence: appsFlyerService.ts (0 event callers), mixpanelService.ts (25+ events), all analytics services | Confidence: H

---

## 3. Key Marketing Metrics (Derivable Once Events Are Wired)

| Metric | Formula | Events Required |
|--------|---------|----------------|
| Install → Signup Rate | registrations / installs | af_complete_registration |
| Signup → Activation Rate | tutorial_completions / registrations | af_tutorial_completion |
| Trial → Paid Conversion | subscriptions / trial_starts | af_subscribe, af_start_trial |
| ROAS | subscription_revenue / ad_spend | af_subscribe (with af_revenue) |
| Viral Coefficient | invites_sent / activated_users | af_invite, af_tutorial_completion |
| Engagement Quality | saves / activated_users | af_add_to_wishlist, af_tutorial_completion |
| Intent Depth | schedules / saves | experience_scheduled, af_add_to_wishlist |
| Retention (Dx) | logins_day_x / installs | af_login |

---

## 4. Retargeting Audiences (Buildable Once Events Are Wired)

| Audience | Definition | Use Case |
|----------|-----------|----------|
| Installed, not registered | Install event, no af_complete_registration | Re-engagement ads |
| Registered, not onboarded | af_complete_registration, no af_tutorial_completion | Push to complete setup |
| Trial active, not subscribed | af_start_trial, no af_subscribe | Trial conversion campaigns |
| Trial expired, not subscribed | af_start_trial > 7 days ago, no af_subscribe | Win-back offers |
| Active savers, not subscribers | af_add_to_wishlist > 5, no af_subscribe | Upgrade nudge |
| Inviters (high viral value) | af_invite > 0 | Lookalike audiences |
| Subscribers | af_subscribe | Exclusion lists, upsell (Pro → Elite) |

---

## 5-10. [Pending Full Analysis]

The following sections require a full product analysis (Mode F) to populate:
- ICP Definition & Segments
- Messaging Framework
- Competitive Positioning
- Feature-to-Benefit Mapping
- Go-to-Market Strategy
- Content & Campaign Strategy

---

*Document maintained by PMM Codebase Analyst | Source of truth: codebase, not documentation*
