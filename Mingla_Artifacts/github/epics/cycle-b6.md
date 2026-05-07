# Cycle B6 — Mingla Brain (One Claude-powered AI agent across all surfaces)

**Phase:** Phase 7 — Post-MVP
**Estimated effort:** ~250–350 hrs across 4 phases (P1 → P4)
**Status:** ⬜ LOCKED STRATEGY — no SPEC dispatched. Phase order non-negotiable.
**Codebase:** `supabase/` + `mingla-business/` + `app-mobile/` + `mingla-admin/`
**Strategy doc (authoritative):** `Mingla_Artifacts/MINGLA_BRAIN_AGENT_STRATEGY.md`
**Sibling doc:** `Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md` (Cycle B5 — mechanical layer this hub sits on top of)
**Lock-in date:** 2026-05-06

---

## 0. Hard Prerequisite Chain (Non-Negotiable, per §11.1 of strategy)

```
B2 → B3 → B4 (MVP cutline)
  ↓ B4 stable ≥ 4 weeks
B5 Phase 0 (consent + verified contact)
B5 Phases A/B/C/D (blasts)
B5 Phase E (ads research → MINGLA_ADS_PLAYBOOK.md)
B5 Phase F (mechanical ads pipeline)         ← MUST be Grade A
B5 Phase G (mechanical optimizer)            ← MUST be Grade A
  ↓
Cycle B6 — THIS DOC (Mingla Brain)
```

**Key gate — mechanical ads MUST be Grade A in Launch Readiness Tracker before
Mingla Brain P3 (Ads phase) is eligible for SPEC.** The agent's `launch_ad_campaign`
and `adjust_budget` tools are thin wrappers over the B5 Phase F+G pipeline; they
cannot exist without it. Building the AI ads layer on top of an unproven mechanical
pipeline means debugging two unknowns at once — separate them.

**P1 + P2 (consumer concierge + business co-pilot) are independent of ads** and
can ship after B5 Phases 0/A/B/C/D close. P3 (ads) is the ads-gated phase.

---

## 1. Vision

**One Claude + many small tools + persona switch.** Not six agents, not a separate
backend. The agent is the conversational layer over every product capability
Mingla already has or plans to ship.

## 2. The Six Capabilities (all must-haves)

| # | Capability | Surface | Persona | Phase |
|---|---|---|---|---|
| 1 | Query DB → generate cards on swipeable deck | `app-mobile` | Consumer concierge | P1 |
| 2 | Create events / experiences for business users | `mingla-business` | Business co-pilot | P2 |
| 3 | Compile ticket details | `mingla-business` | Business co-pilot | P1 |
| 4 | Human-warm chat → compile bugs/complaints/requests into admin tickets | both → admin | Support intake | P1 |
| 5 | Run ads to specific events with budget; daily/total optimization | `mingla-business` | Ad operator | **P3 (gated)** |
| 6 | Accept payment to Mingla Stripe | both | Stripe cashier | P2 |

---

## 3. Architecture

```
ChatSheet (consumer / business / support)
  ↓
edge fn: agent-chat   ← streams Anthropic Sonnet 4.6 (Haiku 4.5 as router)
  ↓
System prompt = persona      Tools = capabilities
  ↓
query_places · generate_deck_cards · create_event · create_experience ·
create_ticket · create_stripe_checkout · launch_ad_campaign · adjust_budget
```

- **Storage:** `agent_conversations` + `agent_messages` (Postgres + RLS)
- **Persona:** flag in system prompt, not a separate agent
- **Tools:** thin wrappers over existing services and tables
- **Streaming:** SSE direct from edge fn, OR Supabase Realtime broadcast
- **Supabase fit:** ~95% covered by current stack (no new vendor on infra side)

---

## 4. Phased Build (Sequential — Operator Non-Negotiable)

| Phase | Scope | Dependency | Risk |
|---|---|---|---|
| **P1 — Foundation** | edge fn `agent-chat`, `agent_conversations`/`agent_messages` tables, ChatSheet UI; tools: `query_places`, `generate_deck_cards`, `create_ticket`, `support_ticket_intake` | B5 Phases 0/A close (verified contact + consent foundation) | Low |
| **P2 — Business + payments** | persona=business; tools: `create_event_draft`, `create_experience_draft`, `create_stripe_checkout` | B5 Phase D close (brand followers schema); Cycle 17 Stripe wiring proves pattern | Low |
| **P3 — Ads** | tools: `launch_ad_campaign`, `adjust_budget`, `read_metrics`; AppsFlyer ingest path; optimizer cron | **B5 Phase F + G must be Grade A** (mechanical ads + optimizer proven in production with paying business users) | High |
| **P4 — Memory + polish** | per-user agent memory, voice mode (defer per cost model), cross-session continuity | P1–P3 stable | Low |

**Sequencing rule (operator-locked):** Events (P2) MUST ship before Ads (P3) because
ad campaigns need an `event_id` to point at.

---

## 5. Non-Obvious Hard Parts (per §5 strategy)

| Hard part | Mitigation |
|---|---|
| Ads is not one API — AppsFlyer is attribution; buying happens via Meta/Google/TikTok APIs | Pick ONE network first (Meta = cheapest path to event tickets). Onboard once. **Done in B5 Phase F.** |
| Money / public-write tools jailbreakable | UI confirm-sheet pattern: tool returns `pending_action_id`, UI renders confirm sheet, second tool call commits |
| DB writes need asserted identity | Edge fn uses service role for tool exec but injects `auth.uid()` from JWT into every write |
| Spend caps belong in the database (prompts persuadable, triggers aren't) | Postgres trigger on `ad_spend_log`. **Already implemented in B5 Phase F.** |
| Ticket compilation is noisy | Background "ticket candidate" emit; admin promotes the real ones |
| Cost compounds — Sonnet 4.6 streaming on every turn adds up | Haiku 4.5 router; escalate to Sonnet only when needed; aggressive system-prompt caching |
| "Generate deck cards" is a query tool, not the deck itself | New `agent_deck_proposals` table; deck UI subscribes alongside existing scoring pipeline |

---

## 6. Cost Model Summary (full math in §7 strategy)

- **Blended turn cost:** ~$0.018 (60% Sonnet 4.6 / 40% Haiku 4.5, with prompt caching, 1.5 tool roundtrips/turn)
- **Per active agent user:** ~$0.60/month average (light: $0.18, heavy: $1.80, business event+ads: $2.70–4.50)
- **Per MAU blended:** ~$0.18/MAU (assumes 30% adoption, 8 sessions/mo × 4 turns)
- **At 100K MAU:** ~$17.9K/month total (Claude API + Supabase infra)
- **Cost levers:** Haiku-as-router → -25%, prompt caching → -15%, rolling window → -10%, intent classifier → -15%, tool-result memoization → -5% → **stack to ~$0.10/MAU**
- **Cost killers (avoid):** voice mode without STT caching (2-3×), image gen (3-5×), 1M-token context, "always Sonnet", no caching discipline (1.5-2×)

---

## 7. Subscription Model (per §8 strategy)

| Tier | Price | Agent access | Margin |
|---|---|---|---|
| **Free** | $0 | 20 turns/mo (caps cost at $0.36/mo) | n/a |
| **Mingla+ Consumer** | $4.99/mo | Unlimited consumer chat | +$2.75/sub (55% heavy / 80% avg) |
| **Mingla Business** | $29/mo | Unlimited business chat + ads orchestration | +$23.36/sub (80%) |

**Break-even at 100K MAU:** 3,600 Mingla+ subs (3.6% conversion) covers full Claude bill.

**Revenue sanity at 100K MAU:** $25,760/mo subs - $17,900/mo cost = **+$7,860/mo net** before ticket commissions (3% of GMV) + ad-management fees stack as pure margin.

**What kills these margins:** no turn cap on free, voice in $4.99 tier, image gen, unlimited ad-orchestration on $29 tier, no caching discipline.

---

## 8. Operator-Owned Open Decisions (per §10 strategy)

1. Which phase ships first? (Recommended: P1 — consumer + tickets)
2. Which ad network do we onboard first? (Recommended: Meta) — only matters when P3 starts
3. Voice mode in P1 or defer to P4? (Recommended: defer — protects margin)
4. Where does the chat sheet live in consumer UI? (FAB? tab? home pill?)
5. Mingla+ Pro tier ($9.99) for voice / image generation later?
6. Spend cap on Mingla Business managed ad spend at $29 tier?

---

## 9. Conversion Path: This Doc → SPEC → Implementation

Per §11 of strategy:

1. Operator confirms phase order (likely P1 first) — done at lock-in
2. Operator confirms ad network (likely Meta) — only matters when P3 starts
3. Operator confirms tier pricing ($4.99 / $29 / 20-turn free cap)
4. Forensics writes SPEC for **P1 only** (not all four phases)
5. Implementor → Tester → Orchestrator close
6. Repeat per phase. P3 SPEC explicitly references B5 Phase F+G proven Grade A.

DO NOT dispatch implementor against this epic file or the strategy doc directly.

---

## 10. Cross-References

- **`Mingla_Artifacts/MINGLA_BRAIN_AGENT_STRATEGY.md`** (canonical 322-line strategy)
- **`Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md`** (sibling — B5 mechanical layer P3 sits on top of)
- BUSINESS_PRD §U.0 (agent gate), §U.1–U.14 (agent use cases)
- Cycle 17 / ORCH-0700-series Stripe wiring (proves payment-tool pattern feasible)
- Cycle 12 ticketing schema (proves event-creation tool pattern)
- Existing 72 edge functions (proves edge fn deployment pattern)
- Beta Feedback page in `mingla-admin` (proves admin ticket UI pattern)
- AppsFlyer + OpenAI integrations (proves LLM-from-edge-fn + attribution patterns)
- Strategic Plan R6 (chat agent built too early — this cycle exists to ensure that doesn't happen)

---

## 11. Confidence Levels (per §9 strategy)

| Claim | Confidence |
|---|---|
| Per-turn token math at 60/40 split with caching | **High (±20%)** |
| Engagement assumptions (30% adoption, 8 sessions/mo, 4 turns/session) | **Medium (±50%)** — real numbers post-P1 launch |
| Sub conversion (4% consumer / 1% business) | **Medium** — industry-typical, Mingla-specific TBD |
| Heavy-user / power-abuser mix | **Low** — real telemetry post-launch |
| Ad-spend management cost burden (P3) | **Low** — real test in P3 |

---

## 12. Notes

- This was originally a 29-line placeholder. Updated 2026-05-06 to reflect the locked Mingla Brain Strategy and the hard sequencing dependency on Cycle B5 Phase F+G being Grade A. The epic itself stays compact; the 322-line strategy doc is the source of truth.
- **Hard rule (per BUSINESS_PRD §U.0):** No agent code merges before Cycles 0a–17 + B1–B5 (at minimum Phases 0/A) sign-off. The product must work fully without the agent. The agent is a productivity layer, not a replacement.
- Cycle B6 will decompose into B6-P1, B6-P2, B6-P3, B6-P4 sub-cycles at SPEC time. Each phase is its own ORCH dispatch.
