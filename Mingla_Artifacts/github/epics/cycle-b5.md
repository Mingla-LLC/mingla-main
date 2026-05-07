# Cycle B5 — Marketing Hub (Blasts + Mingla-Managed Ads)

**Phase:** Phase 7 — Post-MVP
**Estimated effort:** ~200–280 hrs across 9 phases (Phase 0 + A–H)
**Status:** ⬜ LOCKED STRATEGY — no SPEC dispatched. Phases gated per §0 below.
**Codebase:** `supabase/` + `mingla-business/` + `app-mobile/` (Web SDK only)
**Strategy doc (authoritative):** `Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md`
**Sibling doc:** `Mingla_Artifacts/MINGLA_BRAIN_AGENT_STRATEGY.md` (Cycle B6 — AI layer on top of this hub)
**Lock-in date:** 2026-05-06

---

## 0. Hard Prerequisite Chain (Non-Negotiable)

Per §0 of the strategy doc, this cycle is hard-gated on:

```
B2 (Stripe Connect live, brands receive money)
  ↓
B3 (Checkout live, real purchases generate orders + attribution events)
  ↓
B4 (Scanner + door payments live)        ← MVP CUTLINE / private beta opens
  ↓
B4 stable ≥ 4 weeks, zero open S0 / S1 issues
  ↓
B5 — THIS CYCLE
  ↓
B6 / Mingla Brain P3 (AI ads layer)      ← gated on B5 Phase F+G being Grade A
```

**Single exception — Phase E (M4 ads research).** Pure synthesis work, zero code
dependencies. May be dispatched as a research-only ORCH cycle anytime in parallel
with B2 / B3 / B4. Output (`MINGLA_ADS_PLAYBOOK.md`) becomes available when B5 starts.

**All other phases (0, A–D, F, G, H) require the full prerequisite chain.**

---

## 1. Vision

Two-track marketing hub inside `mingla-business`:

| Track | Purpose | Channels | Audience |
|---|---|---|---|
| **1. Marketing Blasts** | Reach existing customers | Email (Resend), SMS (Twilio 10DLC), RCS (Twilio RBM) | Ticket buyers, brand followers |
| **2. Mingla-Managed Ads** | Acquire new customers | Meta first; Google + TikTok later | Lookalike of past buyers + interest targeting |

When mature, Cycle B6 (Mingla Brain) automates this hub conversationally.

---

## 2. Locked Modifications (M1–M4)

| ID | Modification | Cycle B5 impact |
|---|---|---|
| **M1** | Multi-layer consent enforcement (4-layer max-reachability strategy, jurisdiction-aware: US/CA/EU) | Phase 0 schema + Phase A/B/C blast gates |
| **M2** | Mandatory verified email + phone at every ticket purchase; "Hide My Email" privacy-relay handled with warning + override | Phase 0 schema (`orders.buyer_email_verified` + `buyer_phone_verified` + DB trigger blocking `paid` transition without both) |
| **M3** | AppsFlyer cross-platform attribution — Web SDK + S2S Conversion API + OneLink, first-party hashed identifiers (Expo web included, not just mobile) | Phase F infra + `attribution_events` table |
| **M4** | Mandatory ads best-practices research synthesis BEFORE any Phase F mechanical-ads SPEC. Output: `MINGLA_ADS_PLAYBOOK.md` (Meta CAPI hierarchy, audience signals, creative, bid strategies, attribution windows, retargeting). Sources: Meta/Apple/Google/TikTok official docs + ≥3 industry experts (CTC, Foxwell, Sanchez, etc.) | Phase E research dispatch (8–16 hrs) gates Phase F SPEC |

---

## 3. Phasing (Sequential within track; A/B/C calendar-parallel; E exception)

| Phase | Scope | Calendar gate | Risk |
|---|---|---|---|
| **0** | Consent + verified-contact foundation. `marketing_consent` schema, `orders` verification columns, jurisdictional flow (US/CA/EU), audit log (`raw_disclosure_text`, IP, UA) | None | Medium (legal) |
| **A** | Email blasts MVP (Resend, ticket-buyer audience, composer, schedule, click tracking, unsubscribe) | None — Resend instant | Low |
| **B** | SMS blasts (Twilio 10DLC, STOP keyword, granular opt-in) | **10DLC registration: 1–3 weeks** — start Day 1 of Phase A | Medium |
| **C** | RCS (Twilio RBM, rich card composer, suggested actions, SMS fallback) | **RBM brand verification: 4–6 weeks** — start Day 1 of Phase A | Medium-High |
| **D** | Brand followers (`brand_follows` table, follow button, follower-based audiences) | None | Low |
| **E** | M4 ads-research synthesis → `MINGLA_ADS_PLAYBOOK.md` | None — pure research | Low |
| **F** | Mechanical ads pipeline (Stripe pre-pay → `ad_account_balance`, Meta Ads API integration, AppsFlyer Web SDK + S2S + OneLink, daily cron, spend caps via Postgres trigger on `ad_spend_log`) | **Meta BM onboarding: 1–2 weeks** | High |
| **G** | Mechanical optimizer (CPA-based pause/boost cron, dashboard insights) | None | Medium |
| **H** | Mingla Brain P3 (AI layer per `MINGLA_BRAIN_AGENT_STRATEGY.md`) — **THIS LIVES IN CYCLE B6**, listed here only for dependency clarity | Phase F + G must be Grade A | High |

---

## 4. Schema Adds (Phase 0 + F)

```
marketing_consent          (per user × brand × channel; consent_type, source, opted_in_at, jurisdiction, raw_disclosure_text)
marketing_audiences        (saved queries)
marketing_campaigns
marketing_templates
marketing_messages         (per-recipient delivery log)
marketing_unsubscribes     (global opt-out registry)
marketing_clicks           (mingla.app/m/{trackingId} redirect log)

orders                     (+buyer_email_verified, +buyer_phone_verified, +buyer_email_is_relay, +DB trigger)

ad_accounts                (per brand pre-pay balance)
ad_campaigns               (meta_campaign_id, target_type, budgets, status)
ad_creatives
ad_spend_log               (+spend-cap trigger pauses Meta campaign on overage)
attribution_events         (web_sdk | s2s_api | mobile_sdk source, AppsFlyer + Mingla user IDs)
```

---

## 5. Compliance Risks (Cross-Track — see §5 of strategy)

- **TCPA** (SMS w/o explicit consent): $500–$1,500 per text — M1 multi-layer consent + audit trail
- **GDPR** (EU w/o explicit opt-in): 4% global revenue — jurisdictional flow
- **CAN-SPAM** (no unsubscribe): $50K/violation — mandatory unsubscribe in every email + STOP for SMS
- **Twilio 10DLC unregistered** → SMS blocked — start Day 1
- **Meta ad policy violation** → account suspension — pre-screen creative
- **Apple ATT violation** → App Store rejection — honest prompts, respect declines

---

## 6. Conversion Path: This Doc → SPEC → Implementation

Per §9 of strategy doc:

1. Operator confirms M1, M2, M3, M4 strategies (already locked 2026-05-06)
2. Forensics writes a **Phase 0 SPEC** (consent + verified contact foundation)
3. Implementor → Tester → Orchestrator close
4. Repeat per phase. Phase E dispatched as research, not implementation.
5. Phase F SPEC explicitly references the `MINGLA_ADS_PLAYBOOK.md` output

DO NOT dispatch implementor against this epic file or the strategy doc directly.
Each phase needs its own bounded SPEC.

---

## 7. Operator-Owned Open Decisions (per §7 strategy)

1. Phase 0 launch threshold (gate all blasts vs. grandfather email-only)
2. EU jurisdiction handling (restrict vs. full GDPR flow at MVP)
3. Pre-pay refund policy (90/180-day idle balance forfeiture rule)
4. Ad creative approval (auto vs. Mingla manual vs. AI screen)
5. Soft opt-in lookback window (US/CASL allows ~2y; we may set shorter)
6. Per-business send limits (e.g., 10K SMS/day cap)
7. RBM verification owner (internal vs. consultant)
8. Multi-account migration trigger ($25K/mo? $50K/mo?)

---

## 8. Memory + Invariant Updates Triggered by This Cycle

On Phase 0 CLOSE (per §11 of strategy):

- New project memory: `project_marketing_consent_required.md`
- New invariant `I-MARKETING-CONSENT-REQUIRED` (CI gate via strict-grep registry pattern, per Cycle 17b memory)
- New invariant `I-VERIFIED-CONTACT-AT-PURCHASE` (DB trigger + CI gate)

On Phase F CLOSE — invariants for spend-cap DB trigger and AppsFlyer S2S deduplication.

---

## 9. References

- **`Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md`** (canonical 866-line strategy)
- **`Mingla_Artifacts/MINGLA_BRAIN_AGENT_STRATEGY.md`** (sibling — Cycle B6 AI layer)
- BUSINESS_PRD §8, §9, §10
- Strategic Plan §4 (out-of-MVP confirmation), §6 R3/R11/R14 (risk register: financial reconciliation, NFC platform support, marketing-tools spam)
- DEC-076 (auth model: buyers can be guest or logged-in) — preserved by Cycle 8a anon-buyer invariant
- Cycle 12 ticketing schema (`orders` table — M2 extends with verification columns)
- Cycle 17 Stripe wiring (proves pre-pay billing pattern)
- Existing AppsFlyer + Twilio + Resend integrations (already in stack)

---

## 10. Notes

- This was originally a 29-line placeholder. Updated 2026-05-06 to reflect the locked Marketing Hub Strategy + the new B6/Mingla Brain dependency chain. The epic itself stays compact; the 866-line strategy doc is the source of truth for design.
- Cycle B5 will likely split into B5-Phase0, B5-Blasts (A/B/C/D), B5-Ads (E/F/G) at decomposition time. Phase H (AI) is explicitly Cycle B6 and listed here only for dependency clarity.
