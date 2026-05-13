# Mingla RCS Two-Way Concierge — Strategy Lock-In

**Status:** Strategy lock-in from operator brainstorm 2026-05-12. No SPEC, no code, no schema migration.
**Date registered:** 2026-05-12
**Owner:** Seth Ogieva
**Mode:** Strategy / pre-spec — converts to SPEC when Cycle B5 Phase C unblocks
**Parent:** `Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md` §3.5 (RCS interactivity, originally scoped as outbound-only) — this doc **expands** RCS scope to two-way concierge
**ORCH:** ORCH-0817

---

## 0. Hard Prerequisite Chain

This strategy is gated on the same chain as Cycle B5 Phase C:

```
B2 Stripe Connect live → B3 Checkout live → B4 Scanner + door payments live
  → B4 stable ≥ 4 weeks with zero open S0/S1
  → Twilio RBM brand verification complete (4–6 weeks lead time)
  → THIS DOC's strategy converts into a SPEC for Phase C+
```

Twilio RBM brand verification can begin **Day 1 of Cycle B5 Phase A** (in parallel
with email-blasts work) so the channel is unblocked by the time B5 is ready for it.

---

## 1. Vision (one sentence)

RCS becomes Mingla's branded SMS-but-better channel where every Mingla customer
can chat with us the way they chat with friends — and complete real transactions
inside that thread.

This is fundamentally different from "outbound blasts only." Outbound is one of
three use-cases this channel supports.

---

## 2. The Three Use-Cases

| # | Use-case | Initiator | Example |
|---|---|---|---|
| 1 | **Outbound sale** | Brand → Buyer | "Sunset Rooftop tonight — 12 tickets left → [Buy]" rich card |
| 2 | **Outbound utility** | Mingla / Brand → Buyer | "Your ticket for tomorrow's event. Tap to add to wallet. Doors at 7pm." |
| 3 | **Inbound concierge** | Buyer → Mingla | "Where's my ticket?" / "I need a refund." / "Show me events this weekend." |

Use-cases 1 and 2 are covered (at outbound-card level) in `MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md` §3.5.
Use-case 3 is new scope and is the strategic differentiator this doc locks in.

---

## 3. Pipeline Architecture

```
┌──── Twilio RBM (Mingla-verified RCS sender) ────┐
│                                                  │
│  Outbound side ───────────────────────────────►  │
│  edge fn: rcs-send                               │
│    • Rich card composer (event payload)          │
│    • Quick reply payload                         │
│    • Fallback SMS body (auto-generated)          │
│                                                  │
│  ◄─────────────────────────── Inbound side       │
│  edge fn: rcs-webhook                            │
│    • Parse inbound message                       │
│    • Intent classifier (rules → small LLM)       │
│    • Route to: auto-reply · self-service · human │
│                                                  │
└──────────────────────────────────────────────────┘
                    ↓
        ┌───── Conversation state ─────┐
        │  rcs_conversations           │
        │  rcs_messages                │
        │  rcs_handoff_tickets         │
        └────────────────┬──────────────┘
                         ↓
            ┌────────────┴────────────┐
            ↓                          ↓
   Automated reply              Human handoff
   (rich card / link)           (mingla-admin support inbox)
```

---

## 4. Intent Classification — the brain of inbound

Every inbound message runs through a classifier. **Cheapest version:** keyword +
regex rules. **Better version:** GPT-4o-mini with a tight system prompt. Both
versions emit the same intent enum so the routing layer is classifier-agnostic.

| Intent | Auto-reply | Example trigger phrases |
|---|---|---|
| **ticket_lookup** | Send rich card with QR + event details, pulled from `tickets` | "where's my ticket" / "show ticket" / "qr code" |
| **event_discovery** | Send carousel of upcoming local events | "events tonight" / "what's happening" / "this weekend" |
| **refund_or_cancel** | Reply with refund policy + Quick Reply "Talk to human" | "refund" / "cancel" / "didn't get in" |
| **buy_intent** | Send rich card of brand's next event with [Buy Ticket] | "got any tickets" / "is it sold out" / "buy" |
| **general_help** | "I can help with: tickets · events · refunds · support. Which?" | Anything ambiguous |
| **stop** | Honor STOP keyword, add to suppression list (TCPA-required) | "stop" / "unsubscribe" / "quit" |
| **human_handoff** | Open ticket in `rcs_handoff_tickets`, page support, send "A human will reply within 15min" | "talk to human" / "speak to someone" / "agent" |

**The trick:** every auto-reply contains a "Talk to a human" quick-reply
button. The customer never feels stuck with a bot. Bot handles ~80% of
intents instantly; the other ~20% routes to a human in `mingla-admin`.

---

## 5. Sender Scope — Mingla-level first, per-brand later

Two-way RCS works at two levels:

| Level | Verified sender | Inbox | When |
|---|---|---|---|
| **Mingla-level concierge** | One verified Mingla RBM sender | Mingla support routes to brand context based on intent | **MVP — Phase C** |
| **Brand-level RBM** | Each brand becomes its own verified RBM agent (own checkmark) | Inbox routes to that brand's mingla-business dashboard | **Phase C+** (each brand needs 4–6 week RBM verification — operationally heavy) |

**Decision:** ship Mingla-level concierge first. One verified sender, one
personality, one inbox. Scales infinitely with zero per-brand operational
overhead. Per-brand RBM is a Phase C+ premium feature for high-volume brands
who want their own verified-sender identity.

---

## 6. MVP Scope (Cycle B5 Phase C)

1. **One verified Mingla RBM sender** for all outbound rich cards and inbound concierge.
2. **Outbound rich cards** for: event marketing (sales), ticket delivery (utility), event reminders 24h before (utility), post-event thank-you with "rate brand" quick reply (engagement).
3. **Inbound webhook + intent classifier** handling the 7 intents above.
4. **Support inbox in `mingla-admin`** showing live RCS conversations with human-reply UI.
5. **Quick-reply payloads** that pre-fill specific replies ("Yes, buy" / "Talk to human" / "Stop").
6. **SMS fallback** automatic when recipient device doesn't support RCS — short link + brand name in body.

---

## 7. Schema Sketch (lives in B5 Phase C SPEC, not this doc)

```
rcs_conversations
  id, phone_e164, customer_id (nullable), brand_id (nullable),
  status (open/closed/handed_off), last_message_at, intent_history jsonb,
  created_at, updated_at

rcs_messages
  id, conversation_id, direction (in/out), body, rich_card jsonb,
  intent_classified, quick_reply_payload, twilio_sid,
  delivery_status (queued/sent/delivered/read/failed), created_at

rcs_handoff_tickets
  id, conversation_id, opened_at, assigned_to (admin user_id),
  resolved_at, resolution_note, sla_breach_at
```

Indexes on `phone_e164`, `conversation_id`, `assigned_to`, `last_message_at desc`.

RLS: customer-side anonymous (phone → conversation lookup via signed token only,
no direct phone-to-id query); admin-side gated on Mingla admin role; brand-side
deferred to Phase C+.

---

## 8. mingla-admin Support Inbox — UX Sketch

New page in `mingla-admin/src/pages/`. Three-pane layout (Linear / Front pattern):

```
┌──────────── Support Inbox ─────────────────────────────────┐
│ Conversations  │  Active thread          │  Context panel  │
│ ──────────────  │  ─────────────────────   │  ─────────────  │
│ ● Alex M.       │  Alex M.                 │  Phone: +1...   │
│   2m ago        │  +1 (555) 234-1234       │  Customer ID:   │
│   "where's my   │  ─────────────────────   │  cus_...        │
│   ticket?"      │  [auto] Hi Alex, here's  │  Past orders: 3 │
│ ● Maya R.       │  your ticket → [card]    │  Total spend:   │
│   8m ago        │  [Alex] thanks but qr    │  $147           │
│   "refund"      │  doesn't scan            │  Brand context: │
│ ○ Devon P.      │  [Mingla admin] ...      │  Rooftop Club   │
│   1h ago        │  ────────────────        │                 │
│                 │  [Reply box] ...         │  [End thread]   │
└────────────────────────────────────────────────────────────┘
```

- Color-coded status: ● open / ○ resolved / ⚠ SLA-breached (>15 min unanswered)
- Inline rich-card composer for admin replies
- One-click "Hand back to bot" to close the handoff and return control to auto-reply
- Customer context auto-populated from `orders` / `tickets` / `brand_team_members`
- Brand-specific context if the inbound mentions a brand or event
- Audit trail in `rcs_messages` (every admin reply is a logged event)

---

## 9. Strategic Positioning

| Competitor | Two-way RCS today? | Auto-reply intent routing? | Verified-sender brand? |
|---|---|---|---|
| Eventbrite | No | No | No |
| Posh | No | No | No |
| Dice | No | No | No |
| Bandsintown | No | No | No |
| **Mingla (post-Phase-C)** | **Yes** | **Yes** | **Yes (Mingla-level + per-brand later)** |

This is a real competitive moat. Two-way branded messaging is what every modern
DTC and SaaS company is moving to (Klaviyo, Attentive, PostScript) but **none of
the event-ticketing competitors offer it.**

---

## 10. Cost Model

- Outbound RCS: ~$0.015/msg via Twilio RBM
- Inbound RCS: ~$0.015/msg
- SMS fallback: ~$0.008/msg
- Intent classification: GPT-4o-mini ~$0.00015 per inbound classification (~3 sentence input)

**Per-conversation cost ceiling (back-of-envelope):** outbound 1 + auto-reply 1 +
maybe 2 inbound + 2 outbound = ~6 messages × $0.015 = $0.09 per concierge interaction.
Human handoff adds support-staff time but no incremental RCS cost.

**Risk:** chatty customers + unbounded threads = cost creep. Mitigation: per-customer
daily message cap (e.g., 20 messages/24h) with friendly "you've reached today's
limit — we'll be back tomorrow" fallback. Final number TBD; flag for product call.

---

## 11. Mingla Brain (Cycle B6) Integration Path

Cycle B6 / Mingla Brain P3 is the AI-agent layer that lives on top of this hub
(per `Mingla_Artifacts/MINGLA_BRAIN_AGENT_STRATEGY.md`). RCS plugs in cleanly:

- The `rcs-webhook` edge function's intent classifier becomes the agent's
  webhook entry point. Same plumbing.
- The agent reads `MINGLA_ADS_PLAYBOOK.md` (ORCH-0818) + `Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md`
  as system-prompt knowledge.
- The agent can compose outbound rich cards by calling `rcs-send` directly —
  no UI changes required.
- Human handoff fallback remains the same — the agent escalates to mingla-admin's
  Support Inbox when confidence drops below a threshold or the customer explicitly
  asks for a human.

**The plumbing built in Phase C is the same plumbing the agent uses in B6.**
No refactor required.

---

## 12. Open Questions for Operator

These need answers before Phase C SPEC is written. Not blockers for this doc.

1. **Single Mingla-concierge persona vs per-brand RBM agents at MVP?** This doc
   recommends Mingla-concierge-first. Operator may override.
2. **Support handoff routing: Mingla staff or brand staff?** This doc recommends
   Mingla staff at MVP (one inbox, one team), brand-staff inbox in `mingla-business`
   as Phase C+ add.
3. **Per-customer daily message cap to manage cost creep?** Recommend 20/24h
   with friendly fallback. Final number TBD.
4. **Support SLA target?** 15 min default in the schema sketch — confirm.
5. **Bot persona name + voice guide?** Mingla brand voice exists (`mingla-product`
   skill knowledge) — needs a 1-page concierge persona spec.

---

## 13. Cross-References

- `Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md` §3.5 (original outbound-only RCS scope, now superseded by this doc's expanded scope)
- `Mingla_Artifacts/github/epics/cycle-b5.md` Phase C (calendar gate)
- `Mingla_Artifacts/MINGLA_BRAIN_AGENT_STRATEGY.md` (Cycle B6 — AI layer that plugs into this pipeline)
- `Mingla_Artifacts/MARKETING_HUB_INFRASTRUCTURE_GAP_ANALYSIS.md` (prerequisite chain status)
- `Mingla_Artifacts/DECISION_LOG.md` DEC-149 (hub surface placement — Customers tab anchors the audience layer this channel consumes)

---

## 14. Conversion: This Doc → SPEC → Implementation

When Cycle B5 Phase C unblocks (Twilio RBM verification complete + B4 stable
4 weeks), this strategy doc converts into:

1. SPEC for `rcs-send` edge function + outbound rich-card composer (mingla-business)
2. SPEC for `rcs-webhook` edge function + intent classifier (rules-first, LLM-pluggable)
3. SPEC for `rcs_conversations` / `rcs_messages` / `rcs_handoff_tickets` schema + RLS
4. SPEC for mingla-admin Support Inbox three-pane UI
5. SPEC for SMS fallback + STOP-keyword suppression (already partially in scope for B5 Phase B)
6. Operator-facing: Twilio RBM brand verification paperwork (begin Day 1 of Phase A)
