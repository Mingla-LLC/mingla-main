# Mingla Business Marketing Hub - Infrastructure Requirements And Gap Analysis

**Date:** 2026-05-10  
**Mode:** Orchestrator + PMM planning artifact  
**Status:** Planning / pre-spec  
**Owner:** Seth Ogieva  
**Source authority:** `MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md`, `github/epics/cycle-b5.md`, ORCH-0777 investigation/spec, current repo inspection  

## Executive Verdict

The Marketing Hub is strategically locked, but the infrastructure is not ready to build against yet.

The core blocker is not the marketing composer UI. It is the missing production commerce backbone. Marketing blasts and ads depend on real ticket purchases, durable buyer contact records, verified order/ticket truth, consent, attribution, notification delivery, and spend/audit controls. Today, the strategy docs correctly place B5 after B2/B3/B4, and ORCH-0777 confirms B3-level ticket checkout is still local/stubbed.

**Recommendation:** do not start B5 Phase 0/A/B/F implementation until ORCH-0777 and the B2-B4 prerequisite chain are Grade A. The one safe parallel path is **B5 Phase E ads research**, because it is documentation/research only and produces `MINGLA_ADS_PLAYBOOK.md`.

## Customer Pain This Must Solve

Organisers want one place to sell tickets, reach buyers, refill slow events, and understand what drove revenue. Today they would otherwise stitch together Eventbrite/Posh, Mailchimp, Twilio, Meta Ads, spreadsheets, and manual attribution.

The Marketing Hub should make Mingla Business the operating surface for:

- re-engaging people who already bought tickets;
- sending event-specific email/SMS/RCS blasts;
- promoting an event page or brand page with paid ads;
- proving which campaigns generated clicks, conversions, and revenue;
- doing all of this with compliant consent, suppression, unsubscribe, billing, and audit trails.

## Current Locked Scope

| Track | Product outcome | Channels / systems | Initial audience |
|---|---|---|---|
| Track 1: Marketing Blasts | Reach existing customers | Resend email, Twilio SMS, Twilio RCS later | Ticket buyers first, brand followers later |
| Track 2: Mingla-Managed Ads | Acquire new customers | Meta first; Google/TikTok later | Lookalike audiences, local targeting, interest targeting |

Canonical docs:

- `Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md`
- `Mingla_Artifacts/github/epics/cycle-b5.md`
- `Mingla_Artifacts/MINGLA_BRAIN_AGENT_STRATEGY.md` for the later AI layer

## Non-Negotiable Prerequisite Chain

| Gate | Required state before B5 implementation | Why it matters |
|---|---|---|
| B2 Stripe Connect live | Brands can receive money through connected Stripe accounts; status is server truth; KYC/remediation is reliable | Paid checkout and ad pre-pay both depend on reliable money movement |
| B3 Checkout live | Real purchases create durable `orders`, `order_line_items`, and `tickets`; paid checkout finalizes through Stripe webhook | Blasts need real buyers; ads need real conversion/revenue attribution |
| B4 Scanner + door payments live | Scanner validates server tickets; door payments create server orders; operational loop is trusted | Marketing should not drive demand into an untrusted door/check-in flow |
| B4 stable 4+ weeks | Zero open S0/S1 issues across Mingla Business | Growth tooling should not amplify unstable commerce |
| Phase 0 consent/contact foundation | `marketing_consent`; verified contact capture; jurisdictional flow; suppression basis | No compliant blast system exists without this |
| Phase E ads research | `MINGLA_ADS_PLAYBOOK.md` from official + expert sources | Mechanical ads spec needs a Mingla-specific operating doctrine |

## Infrastructure Requirements

### 1. Commerce And Buyer Truth

Required:

- server-owned checkout transaction for free and paid tickets;
- durable `orders`, `order_line_items`, and `tickets` rows for every completed checkout;
- server-side capacity protection and idempotency;
- buyer name, email, and phone captured consistently;
- paid checkout finalized only after Stripe confirms through verified webhook;
- free checkout completed atomically without Stripe;
- organizer dashboards, orders, guests, revenue, and scanner all read server truth.

Current state:

- Core tables exist in the baseline migration: `orders`, `order_line_items`, `tickets`, `scan_events`, `ticket_types`.
- ORCH-0777 proves buyer checkout is still local/stubbed: no durable writes, optional phone, mock Stripe, confirmation writes to local `useOrderStore`.
- `mingla-business/src/store/orderStore.ts` explicitly says it is transitional and will migrate to Supabase in B-cycle.

Gap:

- No production buyer checkout edge function is wired.
- No Stripe buyer PaymentIntent path is live for ticket sales.
- No backend scan-ticket validation is live.
- Marketing cannot safely target "buyers" until buyer/order truth is durable.

Blocking dependency:

- Finish ORCH-0777 implementation and independent tester verification before B5 Phase 0/A/F.

### 2. Consent, Contact Verification, And Suppression

Required:

- `marketing_consent` table scoped by brand/contact/channel;
- consent type: transactional-only, soft opt-in, explicit marketing;
- source: checkout, onboarding, brand follow, settings;
- jurisdiction: US, CA, EU, other;
- raw disclosure text, IP, user agent, timestamps;
- opt-out and unsubscribe records;
- suppression lists for email/SMS/RCS;
- buyer phone required and ideally verified before marketing use;
- email unsubscribe and SMS STOP handling.

Current state:

- `notification_preferences` exists for per-user notification preferences.
- Business notification preferences are partly transitional in `notificationPrefsStore`.
- `creator_accounts.marketing_opt_in` exists as a broad account-level toggle, but this is not granular brand/channel consent.
- Twilio Verify exists for OTP flows, but marketing SMS needs Twilio Messaging Service and STOP handling.

Gap:

- No `marketing_consent` schema.
- No per-brand/per-channel consent.
- No marketing suppressions/unsubscribes.
- No jurisdiction-aware checkout consent capture.
- No stored legal disclosure text for marketing consent.
- No STOP webhook/keyword handling for marketing messages.

Blocking dependency:

- B5 Phase 0 must be the first marketing implementation phase.

### 3. Messaging Providers And Delivery Ledger

Required:

- Resend marketing email sender/domain setup;
- Twilio Messaging Service for SMS/MMS and later RCS;
- 10DLC registration for US SMS;
- RBM/RCS brand verification if RCS is promised;
- delivery/open/click webhook ingestion;
- retryable outbound message ledger;
- idempotency that works for guest buyers, not only authenticated users;
- per-brand send limits and rate limiting.

Current state:

- `notify-dispatch` can send Resend email and write notifications.
- `notify-dispatch` idempotency currently checks `idempotencyKey && userId`; ORCH-0777 flags this as insufficient for guest/email-only buyer notifications.
- Existing Twilio functions are OTP/Verify-oriented, not marketing Messaging Service-oriented.
- There are no marketing campaign/message delivery tables yet.

Gap:

- No `marketing_messages` delivery ledger.
- No campaign-level send scheduler.
- No Resend webhook/open/click pipeline for marketing.
- No Twilio delivery status callback pipeline for marketing SMS/RCS.
- No guest-safe notification idempotency ledger.
- No 10DLC/RBM readiness record.

Blocking dependency:

- ORCH-0777 buyer notification hardening first, then B5 Phase A/B/C provider work.

### 4. Audience And CRM Foundation

Required:

- saved audience definitions;
- ticket-buyer audience query by brand/event/ticket/date/status;
- exclusion/suppression filters;
- brand follower table and follow/unfollow flow;
- customer profile rollups;
- tags, journey state, CLV/revenue snapshots later.

Current state:

- Order/ticket schema exists but is not yet fed by live checkout.
- Strategy doc identifies buyer email/phone/order/event/brand linkage as available once real orders exist.
- `brand_follows` is planned for B5 Phase D, not present yet.

Gap:

- No `marketing_audiences`.
- No `brand_follows`.
- No customer profile/tag/journey tables for marketing.
- No audience builder service or query policy.

Blocking dependency:

- Durable orders first. Brand followers can follow after Phase A/B, but cannot replace ticket-buyer audience as MVP source.

### 5. Campaign Management

Required:

- campaign records with status, schedule, channel, brand, creator, audience, template, and compliance state;
- reusable templates;
- composer UI in `mingla-business`;
- preview/test send;
- scheduled send and cancellation;
- send workers/cron;
- per-recipient message rows;
- analytics state: sent, delivered, opened, clicked, converted, revenue.

Current state:

- Strategy and design package contain marketing screens, but no production campaign schema/function was found.
- `BUSINESS_PROJECT_PLAN` lists email/SMS/CRM as post-MVP.

Gap:

- No `marketing_campaigns`.
- No `marketing_templates`.
- No `marketing_messages`.
- No `marketing-click` redirect function.
- No schedule/send/test edge functions.
- No campaign analytics pipeline.

Blocking dependency:

- Consent + delivery ledger must exist before campaign send.

### 6. Tracking And Attribution

Required:

- first-party redirect links such as `/m/{trackingId}`;
- `marketing_clicks`;
- UTM persistence into checkout/order;
- conversion attribution from order to campaign;
- AppsFlyer Web SDK in Expo web;
- AppsFlyer S2S purchase events from checkout/webhook;
- `attribution_events` table;
- Meta CAPI and pixel/CAPI dedupe strategy for ads.

Current state:

- `app-mobile` has AppsFlyer native SDK setup and an `appsflyer_devices` table.
- Strategy requires AppsFlyer Web SDK + S2S + OneLink for Expo web.
- No `attribution_events` table was found in current migrations.

Gap:

- No AppsFlyer web integration in `mingla-business`.
- No S2S purchase event pipeline from orders/Stripe webhook.
- No campaign click redirect or UTM capture tied to orders.
- No Meta CAPI event hierarchy/playbook.

Blocking dependency:

- ORCH-0777 checkout/webhook order finalization first; Phase E playbook before Phase F ads spec.

### 7. Ads Billing, Spend, And Platform Integration

Required:

- `ad_accounts` per brand with prepaid balance;
- Stripe pre-pay flow into ad balance;
- `ad_campaigns`, `ad_creatives`, `ad_spend_log`;
- Meta Business Manager onboarding and API credentials;
- campaign create/pause/resume functions;
- daily metric ingestion from Meta;
- spend-cap enforcement at DB and worker level;
- low-balance auto-pause and notifications;
- creative policy screening and approval workflow.

Current state:

- Stripe Connect work exists for organizer payouts and B2 path work.
- Strategy chooses a pre-pay model for ad spend.
- Mingla Brain doc correctly gates AI ads behind a proven mechanical ads pipeline.

Gap:

- No ad account/balance/spend schema.
- No Meta Ads API integration.
- No AppsFlyer/Meta attribution loop.
- No creative moderation/approval workflow.
- No pre-pay refund policy.
- No operator dashboard for ad performance.

Blocking dependency:

- B2-B4 stable, Phase E ads playbook, then B5 Phase F mechanical ads.

### 8. Permissions, Audit, And Abuse Controls

Required:

- marketing actions gated to marketing_manager+ or brand_admin+;
- finance/account owner gates for ad spend funding/refunds;
- append-only audit log for campaign creation, send, cancel, opt-out import, ad launch, budget changes;
- abuse/spam controls: send caps, content screening, domain reputation monitoring, complaint handling;
- admin/operator visibility into campaigns, delivery failures, and ad spend.

Current state:

- `brand_team_members` and role vocabulary exist, including `marketing_manager`.
- `audit_log` exists and Stripe work already uses audit patterns.
- Marketing manager role is explicitly out-of-MVP because the marketing surface is out-of-MVP.

Gap:

- No marketing permission action matrix.
- No campaign/ad audit event taxonomy.
- No admin review queue for risky campaigns/creative.
- No spam reputation monitoring or complaint loop.

Blocking dependency:

- Include permission/audit requirements in Phase 0 and every later B5 spec.

## Gap Analysis Summary

| Area | Current readiness | Gap severity | Notes |
|---|---:|---:|---|
| Strategy / scope | High | Low | Locked in strategy + B5 epic |
| Checkout/order truth | Low | Critical | ORCH-0777 S0 confirms local/stubbed checkout |
| Stripe Connect | Medium | High | B2 work exists, but B2/B3/B4 must be completed and stable |
| Buyer contact capture | Low | Critical | Phone required is not yet enforced in current checkout |
| Consent infrastructure | Low | Critical | Existing notification prefs are not marketing consent |
| Email delivery | Medium | High | Resend exists via notify-dispatch, not marketing campaign-grade |
| SMS/RCS delivery | Low | High | Twilio Verify exists; marketing Messaging Service/10DLC/RBM not ready |
| Audience builder | Low | High | Depends on durable orders and consent |
| Campaign management | None/low | High | No campaign schema/functions yet |
| Tracking links | None/low | High | Needed for blast attribution |
| AppsFlyer attribution | Partial | High | Native consumer setup exists; web/S2S purchase loop missing |
| Ads platform integration | None/low | High | Meta/Google/TikTok API work not started |
| Spend controls | None/low | Critical for ads | Must be DB-enforced before ad launch |
| Permissions/audit | Partial | Medium/high | Roles/audit exist, marketing-specific rules missing |
| Admin/operator controls | Low | High | Needed for abuse, delivery failures, ad policy |

## Recommended Build Order

1. **Close ORCH-0777**: production ticket checkout, server orders/tickets, phone required, Stripe buyer PaymentIntent path, buyer notifications, server scanner validation.
2. **Finish and stabilize B2-B4**: Stripe Connect, checkout, scanner/door payments live and stable for 4+ weeks with zero open S0/S1.
3. **Dispatch B5 Phase E now if desired**: ads best-practices research only; output `MINGLA_ADS_PLAYBOOK.md`.
4. **B5 Phase 0**: consent + verified contact foundation; marketing suppressions; legal audit trail; project memory/invariants.
5. **B5 Phase A**: email blasts MVP to ticket-buyer audiences.
6. **B5 Phase B/C**: SMS then RCS, with 10DLC/RBM paperwork started early.
7. **B5 Phase D**: brand followers and follower audiences.
8. **B5 Phase F**: mechanical ads with Stripe pre-pay, Meta API, AppsFlyer web/S2S, spend caps.
9. **B5 Phase G**: optimizer and insights.
10. **B6 / Mingla Brain P3**: AI wraps the proven mechanical ads workflow only after Grade A evidence.

## Operator Decisions Needed Before Phase 0/F

| Decision | Needed by | Recommendation |
|---|---|---|
| EU handling | Phase 0 | Implement GDPR-compliant explicit opt-in instead of avoiding EU buyers |
| Soft opt-in lookback window | Phase 0/A | Start conservative: 12 months after purchase for same-brand similar events |
| Per-brand send limits | Phase A/B | Start with low default caps and operator override |
| SMS/RCS ownership | Phase B/C | Assign one owner for 10DLC/RBM paperwork before engineering starts |
| Application/platform fee for ticket checkout | ORCH-0777/B3 | Use `0` until finance pricing is locked, as ORCH-0777 recommends |
| Ad pre-pay refund policy | Phase F | Define before accepting ad funds |
| Ad creative approval | Phase F | Start with Mingla manual review for first private-beta advertisers |
| Meta multi-account threshold | Phase F/G | Start single managed account; shard at a defined spend threshold after real data |

## Next Best Orchestrator Move

Write a self-contained **research dispatch prompt** for B5 Phase E:

`Mingla_Artifacts/prompts/FORENSICS_B5_PHASE_E_MINGLA_ADS_PLAYBOOK.md`

This is the only B5-related work that should start before ORCH-0777 and B2-B4 are closed. Everything else should remain gated.

