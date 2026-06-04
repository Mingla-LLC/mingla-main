# META-ORCH-1072 — Mingla Business Notification Taxonomy & Build Map

**Date:** 2026-06-04 · **Owner:** mingla-orchestrator+claude · **Status:** INTAKE complete, awaiting v1-cut steering
**Companion:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1072_BUSINESS_NOTIFICATIONS.md` (anchor) — cross-app forensic map.

This document answers the operator's directive: *"a thorough investigation of everything and anything the user should be notified about."* It is the complete catalog of brand-relevant events, with the current notification state, the proposed `business.*` type, recipient, deep-link target, and a recommended v1 cut.

---

## A. What already exists (reuse — do NOT rebuild)

| Layer | Asset | State |
|---|---|---|
| DB | `notifications` table w/ `brand_id` + `deep_link` | ✅ business-ready |
| DB | `notification_preferences` (channel × type × opt_in) | ✅ |
| Backend | `notify-dispatch` (prefs, quiet-hours, rate-limit, in-app row + push) | ✅ accepts `brandId`/`deepLink` |
| Backend | `_shared/push-utils.ts` `sendPush`/`sendPushToMany` | ⚠️ single (consumer) OneSignal app only |
| Backend | Stripe-compliance senders (kyc/payout-failed/deauth/bank/deadline) | ✅ already push `stripe.*` to brand |
| Business client | `useBusinessNotifications` hook (Realtime, `business.%`/`stripe.%` filter, I-PROPOSED-W gate) | ✅ built |
| Business client | `BusinessNotificationsScreen.tsx` | ✅ exists (needs bell wiring + design pass) |
| Business client | `stripeNotificationTemplates.ts`, `notificationPrefsStore.ts`, `app/account/notifications.tsx` (4 toggles) | ✅ |
| Business client | OneSignal SDK init + login/logout wired | ✅ (opt-in deferred) |
| Business client | TopBar bell + unread badge slot | ⚠️ renders, onPress unwired |

## B. The four real gaps (the build)

1. **Backend dual-app push routing** — `push-utils`/`notify-dispatch` must target the SEPARATE business OneSignal app for `business.*`/`stripe.*` recipients. NEW secrets `ONESIGNAL_BUSINESS_APP_ID` + `ONESIGNAL_BUSINESS_REST_API_KEY`. **Keystone — nothing pushes to business devices until this lands.**
2. **Backend event triggers** — fire `business.*` notifications for the events in §D (the large content gap; today only Stripe-compliance fires).
3. **Client receive path** — `pushSubscription.optIn()` behind a permission moment + foreground display + click/deep-link handlers + business `NAV_TARGETS`.
4. **Client inbox finish** — wire TopBar bell → `BusinessNotificationsScreen`, unread badge from hook, design pass to consumer-grade cards, per-type prefs.

---

## C. Currently firing to brands (baseline — keep)

`stripe.payout_failed`, `stripe.kyc_stall_reminder`, `stripe.deadline_warning_7d|3d|1d`, `stripe.bank_verification_failed`, `stripe.account_deauthorized` → push+email+in-app to `account_owner`/`brand_admin`/`finance_manager`. (Push only actually delivers once Gap 1 lands.)

## D. Complete event catalog (proposed `business.*` types)

Legend — **Tier**: 1=core revenue/ops every brand needs · 2=risk/growth · 3=nice-to-have/digest. **Now**: ∅ none · DB db-row-only · ✉ buyer email/SMS · ✓ already brand-notifies.

### D1 — Money & commerce
| Event | Now | Proposed type | Tier | Recipient | Deep-link |
|---|---|---|---|---|---|
| Ticket sold / order paid | DB+✉(buyer) | `business.order_paid` | 1 | owner/admin/finance | order in Hub |
| First sale on an event | DB | `business.first_sale` | 2 | owner/admin | event |
| Sold out (capacity hit 0) | ∅ | `business.event_sold_out` | 1 | owner/admin | event |
| Low inventory (e.g. ≤10%) | ∅ | `business.low_inventory` | 2 | owner/admin | event |
| Refund processed | DB+✉(buyer) | `business.refund_processed` | 1 | owner/finance | order |
| Dispute / chargeback opened | ops-email | `business.dispute_opened` | 1 | owner/finance | order/payments |
| Dispute lost / evidence due | ops-email | `business.dispute_action_needed` | 1 | owner/finance | payments |
| Payout paid (you got paid) | DB | `business.payout_paid` | 1 | owner/finance | payments |
| Payout on the way / created | DB | `business.payout_created` | 3 | finance | payments |
| Installment failed / plan at-risk | DB+✉(buyer) | `business.installment_at_risk` | 2 | owner/finance | order |
| Installment plan paid in full | ✉(buyer) | `business.installment_completed` | 3 | finance | order |
| Account restricted / reactivated | DB | `business.account_status_changed` | 1 | owner/finance | payments |

### D2 — Audience, engagement & content
| Event | Now | Proposed type | Tier | Recipient | Deep-link |
|---|---|---|---|---|---|
| New follower / audience add | ∅ (no follower table) | `business.new_follower` | 2 | owner/admin | audience |
| Audience milestone (100/500/1k) | ∅ | `business.audience_milestone` | 3 | owner/admin | audience |
| New review / visit feedback | DB (`experience_feedback`/`place_reviews`) | `business.new_review` | 1 | owner/admin | review |
| Waitlist spot opened (your event) | ✉(buyer) | `business.waitlist_activity` | 2 | owner/admin | event |
| Waitlist demand summary | ∅ | `business.waitlist_summary` | 3 | owner/admin | event |
| Deck engagement daily digest (served/liked/saved) | DB (`engagement_metrics`) | `business.engagement_digest` | 3 | owner/admin | event analytics |
| Marketing campaign results digest | DB (`marketing_messages`) | `business.campaign_results` | 2 | owner/admin | campaign |
| Scanner / live check-in summary | DB (`scan_events`) | `business.checkin_summary` | 2 | owner/scanner | event door |

### D3 — Operational, team & lifecycle
| Event | Now | Proposed type | Tier | Recipient | Deep-link |
|---|---|---|---|---|---|
| Brand invite accepted / member joined | ∅ | `business.team_member_joined` | 2 | owner/admin | team |
| Scanner invite accepted | ∅ | `business.scanner_joined` | 3 | owner/admin | team |
| Role changed / removed (you) | ∅ | `business.role_changed` | 3 | affected member | account |
| Venue claim approved/rejected | ✉ only | `business.claim_decision` | 1 | owner | brand/listing |
| Listing go-live / servable | ∅ | `business.listing_live` | 2 | owner/admin | listing |
| Event/trip/experience published | ∅ | `business.listing_published` | 2 | team | listing |
| Event starts soon (brand reminder) | ∅ (consumer-only today) | `business.event_starting` | 2 | owner/admin/scanner | event |
| Event date/time changed after sale | banner+✉stub | `business.event_changed` | 2 | team | event |
| Event ended / wrap-up | ∅ | `business.event_ended` | 3 | owner/admin | event recap |
| Stripe onboarding step needed | ✓(kyc) | (keep `stripe.*`) | 1 | finance | onboarding |
| Profile / setup completion nudge | ∅ | `business.setup_nudge` | 3 | owner | home |
| Ari proactive insight | deferred | `business.ari_insight` | 3 | owner/admin | ari |
| Security: new login / email change | ∅ | `business.security_alert` | 2 | owner | account |

---

## E. Recommended v1 cut (Tier-1 + the highest-signal Tier-2)

**Ship in v1 (12):** `order_paid`, `event_sold_out`, `refund_processed`, `dispute_opened`, `dispute_action_needed`, `payout_paid`, `account_status_changed`, `new_review`, `claim_decision`, `low_inventory`, `new_follower`, `team_member_joined`.

**Rationale:** every Tier-1 is money or trust (sales, payouts, refunds, disputes, reviews, account health, claim outcome) — the things a brand *cannot* afford to miss. The three Tier-2 adds (`low_inventory`, `new_follower`, `team_member_joined`) are the highest-signal growth/ops moments and are cheap because their source data already exists. Tier-3 (digests, milestones, lifecycle nudges, Ari) → v2, to avoid alert fatigue and keep v1 scope shippable.

**Default prefs:** money/trust types default opt-in=true (push+in-app); digests/marketing default in-app-only or off; honor existing 4-category settings screen as the coarse master switches, with per-type rows added underneath.

## F. Proposed sub-ORCH decomposition
- **Sub-A (backend, no UI):** dual-app push routing + new secrets + audience-resolver (`brand_team_members` by role) + the v1 trigger call-sites. Cites OneSignal REST docs inline (COMMS-0003); backend strict-grep allowlist (COMMS-0002).
- **Sub-B (business client):** receive path — opt-in permission moment + handlers + deep-link `NAV_TARGETS`.
- **Sub-C (business client):** inbox finish — bell→screen wiring, unread badge, card design pass, per-type prefs.
- **Sub-D (product/copy):** titles/bodies/deep-links per type + default pref matrix (feeds Sub-A/C).

**Affected Surfaces:** business-iOS, business-Android (push+inbox), business-web-preview (inbox only), backend. NOT: consumer apps (reference only), admin-web, buyer-web.
