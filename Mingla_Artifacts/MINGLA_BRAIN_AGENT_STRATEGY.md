# Mingla Brain — AI Agent Strategy (Brainstorm Lock-In)

**Status:** Brainstorm complete, no implementation dispatched
**Date registered:** 2026-05-06
**Owner:** Seth Ogieva
**Mode:** Strategy / pre-spec — to convert to a formal SPEC before any implementor dispatch
**Source:** Operator-led brainstorm session (2026-05-05 → 2026-05-06)

---

## 1. Vision

One Claude-powered agent ("Mingla Brain") that wears six hats across all three Mingla surfaces (consumer, business, admin), powered entirely by the existing Supabase backend. The agent is the conversational layer over every product capability Mingla already has or plans to ship.

---

## 2. The Six Capabilities (all are must-haves)

| # | Capability | Surface | Persona |
|---|---|---|---|
| 1 | Query the database and generate cards on the swipeable deck via chat | `app-mobile` | Consumer concierge |
| 2 | Create events and experiences for business users (experiences added to business app later) | `mingla-business` | Business co-pilot |
| 3 | Compile ticket details (event ticketing) | `mingla-business` | Business co-pilot |
| 4 | Chat with users human-warm; compile bugs / complaints / feature requests into admin tickets | both apps → admin | Support intake |
| 5 | Run ads to specific events given a budget; optimize daily / total spend | `mingla-business` | Ad operator |
| 6 | Accept payment to Mingla Stripe | both apps | Stripe cashier |

AppsFlyer is already in the stack; it provides attribution, not buying.

---

## 3. Architecture (Simplest Shape That Fits All Six)

**Principle:** One Claude + many small tools + persona switch. NOT six agents. NOT a separate backend.

```
ChatSheet (consumer / business / support)
    ↓
edge fn: agent-chat   ← streams Anthropic Sonnet 4.6 (Haiku 4.5 as router)
    ↓
System prompt = persona       Tools = capabilities
    ↓
query_places · generate_deck_cards · create_event · create_experience ·
create_ticket · create_stripe_checkout · launch_ad_campaign · adjust_budget
```

**Storage:** `agent_conversations` + `agent_messages` (Postgres + RLS).
**Persona:** A flag in the system prompt, not a separate agent.
**Tools:** Thin wrappers over services and tables that already exist.
**Streaming:** SSE direct from edge function, OR Supabase Realtime broadcast.

---

## 4. Phased Build (Sequential — Operator Non-Negotiable)

Sequencing rule: events (P2) must ship before ads (P3) because ad campaigns need an `event_id` to point at.

| Phase | Scope | Risk |
|---|---|---|
| **P1 — Foundation** | edge fn, conversations table, ChatSheet UI, tools: `query_places` + `generate_deck_cards` + `create_ticket` | Low |
| **P2 — Business + payments** | persona=business, tools: `create_event_draft` + `create_experience_draft` + `create_stripe_checkout` | Low (Stripe wired Cycle 17) |
| **P3 — Ads** | tools: `launch_ad_campaign` + `adjust_budget` + `read_metrics`, AppsFlyer ingest, optimizer cron | High |
| **P4 — Memory + polish** | per-user agent memory, voice mode, cross-session continuity | Low |

---

## 5. Non-Obvious Hard Parts

| Hard part | Why | Mitigation |
|---|---|---|
| Ads is not one API | AppsFlyer is attribution; buying happens via Meta / Google / TikTok Ads APIs. Each requires Business Manager onboarding, OAuth, and approval cycles. | Pick ONE network first (Meta = cheapest path to event tickets). Onboard once. |
| Money / public-write tools jailbreakable | Agent could be persuaded to drain Stripe or burn ad budget | UI confirm sheet pattern: tool returns `pending_action_id`, UI renders confirm sheet, second tool call commits |
| DB writes need asserted identity | Agent could claim a fake user_id | Edge fn uses service role for tool exec but injects `auth.uid()` from JWT into every write |
| Spend caps belong in the database | Prompts are persuadable; triggers aren't | Postgres trigger on `ad_spend_log`, hard cap per business per day |
| Ticket compilation is noisy | Auto-filing every chat as a ticket floods admin | Background "ticket candidate" emit; admin promotes the real ones |
| Cost compounds | Sonnet 4.6 streaming on every turn adds up | Haiku 4.5 as router; escalate to Sonnet only when reasoning needed; cache system prompt aggressively |
| "Generate deck cards" is just a query tool | Agent isn't writing the deck — it queries places and writes proposals | New `agent_deck_proposals` table; deck UI subscribes alongside existing scoring pipeline |

---

## 6. Supabase Fit Assessment

**Verdict: ~95% covered by current Supabase setup.** No new vendor needed on the infra side.

| Capability | Supabase piece | Fit |
|---|---|---|
| Claude chat (streaming) | New edge function `agent-chat` calling Anthropic SDK over SSE | YES |
| Conversation memory | New `agent_conversations` + `agent_messages` tables, RLS by user_id | YES |
| Generate deck cards from chat | Tool writes to `agent_deck_proposals`; deck UI subscribes via React Query / Realtime | YES |
| Create events / experiences | Tool inserts `events` rows with `status='ai_draft'`, uses Cycle 12 ticketing schema | YES |
| Compile tickets to admin | Tool inserts into new `support_tickets` table; admin reads like Beta Feedback page | YES |
| Chat-as-human / ask questions | Pure prompt + tool-use loop, no infra needed | YES |
| Stripe checkout from chat | Tool calls Stripe API from edge function; Cycle 17 wiring proves the pattern | YES |
| AppsFlyer attribution ingest | Edge function webhook → `attribution_events` table | YES |
| Launch ads to specific events | Edge function calls Meta / Google / TikTok Ads API over HTTPS | YES (infra); platform onboarding outside |
| Daily budget optimizer | `pg_cron` extension OR scheduled edge function | YES |
| Spend caps (jailbreak-proof) | Postgres trigger on `ad_spend_log` | YES |
| Real-time streaming UI | Supabase Realtime, or SSE direct from edge function | YES |

**Three caveats (all manageable):**

1. Edge function wall-clock cap (~150s) — fine for chat turns (5–30s), use `pg_cron` for long batch jobs.
2. Ad-network accounts (Meta Business Manager etc.) are platform onboarding, not infra — independent of where code runs.
3. Anthropic API key is a new edge function secret — same operational shape as the existing `OPENAI_API_KEY`.

---

## 7. Cost Model

### 7.1 Per-Turn Token Economics

Architecture assumption: Haiku 4.5 router → Sonnet 4.6 for reasoning when needed. Prompt caching enabled (5-min TTL on system prompt).

| Routing split | 60% Sonnet 4.6 / 40% Haiku 4.5 only |
|---|---|
| Tool roundtrips per turn (avg) | 1.5 |
| Sonnet turn cost | ~$0.019 |
| Haiku-only turn cost | ~$0.003 |
| **Blended turn cost (with tools)** | **~$0.018** |

### 7.2 Per-User Cost (by usage tier)

| User type | Turns/month | Real Claude+infra cost |
|---|---|---|
| Inactive (never opens agent) | 0 | $0 |
| Light (asks 2-3 things) | 10 | $0.18/mo |
| Average active | 32 | $0.58/mo |
| Heavy | 100 | $1.80/mo |
| Business (event + ads) | 150 | $2.70-4.50/mo |
| Power abuser (rate-limit, not price) | 300+ | $5.40+/mo |

**Blended cost across all MAU:** ~$0.18/MAU/month.
**Cost per active agent user:** ~$0.60/month average.

### 7.3 Total Monthly Bill (Claude + Supabase, excludes Stripe / ad spend / AppsFlyer)

Assumptions: 30% of MAU use the agent, 8 sessions/mo × 4 turns/session per active user.

| MAU | Active agent users | Turns/month | Claude (API) | Supabase (infra) | Total/mo | $/MAU |
|---|---|---|---|---|---|---|
| 10,000 | 3,000 | 96,000 | $1,700 | ~$25 | ~$1,750 | $0.17 |
| 100,000 | 30,000 | 960,000 | $17,300 | ~$600 | ~$17,900 | $0.18 |
| 1,000,000 | 300,000 | 9,600,000 | $173,000 | ~$4,000 | ~$177,000 | $0.18 |

### 7.4 Levers That Drop the Bill 30-50%

| Lever | Impact |
|---|---|
| Haiku-as-router → escalate to Sonnet only when reasoning is needed (target 70/30 split) | -25% |
| Aggressive system-prompt caching (5-min cache hits = 90% off input rate) | -15% |
| Rolling conversation window (last 10 turns, not full history) | -10% |
| Hard-code intent classifier for "obvious" requests (search, FAQ) — skip the LLM entirely | -15% |
| Tool-result memoization (same tool, same args, 5-min cache) | -5% |

Stack them and **$0.18/MAU drops to ~$0.10/MAU** without sacrificing quality.

### 7.5 Levers That Explode the Bill (Avoid)

- Voice mode without speech-to-text caching → 2-3x cost
- Image generation / analysis in chat → 3-5x cost on turns that use it
- Long context windows (1M token window) → input cost dominates
- "Always Sonnet" with no router → 2x cost
- No caching discipline → 1.5-2x cost

---

## 8. Subscription Model

### 8.1 Mingla+ Consumer — $4.99/mo

| Line item | $/mo |
|---|---|
| Sub revenue | +$4.99 |
| Stripe fee (2.9% + $0.30) | -$0.44 |
| Claude+infra (heavy user) | -$1.80 |
| **Margin per sub** | **+$2.75** |
| **Margin %** | **55% (heavy) / 80% (average)** |

Break-even: at 100K MAU and $17.9K monthly Claude bill, you need **3,600 subs (3.6%)** to fully cover the agent's cost. Normal freemium conversion.

### 8.2 Mingla Business — $29/mo

| Line item | $/mo |
|---|---|
| Sub revenue | +$29.00 |
| Stripe fee | -$1.14 |
| Claude+infra (event + ads tool use) | -$4.50 |
| **Margin per sub** | **+$23.36** |
| **Margin %** | **80%** |

One business sub covers ~40 consumer subs' agent cost. Business is where the real money is.

### 8.3 Free Tier (Gated, Not Unlimited)

| Free tier rule | Why |
|---|---|
| 20 agent turns/month | Caps free user cost at $0.36/mo |
| Unlimited search / browse without agent | The deck still works for non-chatters |
| Soft prompt to upgrade after turn 20 | Sub conversion funnel |

### 8.4 Recommended Three-Tier Structure

| Tier | Price | Agent access | Other perks |
|---|---|---|---|
| **Free** | $0 | 20 turns/mo | Browse deck, buy tickets |
| **Mingla+** | $4.99/mo | Unlimited consumer chat | Premium events, no ads |
| **Mingla Business** | $29/mo | Unlimited business chat + ads orchestration | Event creation, analytics, multi-organizer |

### 8.5 Revenue Sanity Check at 100K MAU

| Source | Math | Monthly |
|---|---|---|
| Mingla+ subs (4% conversion) | 4,000 × $4.99 | $19,960 |
| Mingla Business subs (1% of organizers) | 200 × $29 | $5,800 |
| **Sub revenue** | | **$25,760** |
| Claude + Supabase cost | | -$17,900 |
| **Net before transaction revenue** | | **+$7,860** |

Then ticket commissions (3% of GMV) and ad-management fees stack on top as pure margin since the agent is already paid for by subs.

### 8.6 What Kills These Margins

- No turn cap on free tier → power abusers consume budget
- Voice mode in Mingla+ at $4.99 → blows the margin (voice costs 2-3x text). Price higher or gate to Mingla+ Pro at $9.99
- Image generation in chat → same problem, save for higher tier
- Unlimited ad-orchestration on $29 business tier → cap at $10K/mo managed spend; charge per-incremental
- No prompt caching discipline → bill 1.5x higher, margin halved on heavy users

---

## 9. Confidence Levels

| Claim | Confidence | What would raise it |
|---|---|---|
| Per-turn token math at 60/40 Sonnet/Haiku split with caching | **High (±20%)** | N/A — Anthropic pricing is fixed |
| Engagement assumptions (30% adoption, 8 sessions/mo, 4 turns/session) | **Medium (±50%)** | Real numbers post-P1 launch |
| Sub conversion rates (4% consumer / 1% business) | **Medium** | Industry-typical, Mingla-specific unknown until launch |
| Heavy-user / power-abuser mix | **Low** | Real telemetry post-launch |
| Ad-spend management cost burden (agent calling Meta API repeatedly) | **Low** | Real test in P3 |

---

## 10. Open Product Decisions (Not Infra)

These are decisions the operator owns; engineering can't decide for you:

- Which phase ships first? (Recommended: P1 — consumer + tickets)
- Which ad network do we onboard first? (Recommended: Meta)
- Voice mode in P1 or defer to P4? (Recommended: defer — protects margin)
- Where does the chat sheet live in the consumer UI? (FAB? tab? home pill?)
- Do we want a Mingla+ Pro tier ($9.99) for voice / image generation later?
- What's the spend cap on Mingla Business managed ad spend at the $29 tier?

---

## 11. Conversion Path: This Doc → SPEC → Implementation

This is brainstorm only. Before any code is written, the next sequential steps are:

1. Operator confirms phase order (likely P1 first)
2. Operator confirms ad network (likely Meta) — only matters when P3 starts
3. Operator confirms tier pricing ($4.99 / $29 / 20-turn free cap)
4. Forensics writes a SPEC for P1 specifically (not all four phases)
5. Implementor executes SPEC
6. Tester verifies
7. Orchestrator closes and updates artifacts

This is a strategy document, NOT a spec. Do not dispatch implementor against this file.

### 11.1 Hard Dependency — Mechanical Ads Workflow Must Ship First

**Mingla Brain is a layer ON TOP of capabilities that already work mechanically.**
The AI agent cannot run ads via natural language until the underlying mechanical
ads pipeline exists and is proven in production by real business users. This means:

**Required to ship BEFORE Mingla Brain P3 (Ads phase):**

- Manual ads workflow inside `mingla-business` — a business user can:
  - Pick an event from their dashboard
  - Configure a campaign manually (audience, creative, budget, schedule)
  - Submit to Meta / Google / TikTok via the platform's ads API
  - See spend tracked back into a Mingla `ad_spend_log` table
  - Hit a hard daily / total budget cap enforced by Postgres trigger
- AppsFlyer attribution ingest webhook → `attribution_events` table populated
- Meta (or chosen network) Business Manager onboarding complete, OAuth flow live
- Spend cap triggers tested with real money in production
- Admin dashboard panel showing ad performance per event

**Only AFTER all the above are graded A in the Launch Readiness Tracker** does
Mingla Brain P3 become eligible for SPEC. The agent's `launch_ad_campaign` and
`adjust_budget` tools are thin wrappers over the mechanical pipeline — they
cannot exist without it.

**Phase ordering becomes:**

1. Build mechanical ads workflow (separate ORCH cycle, not Mingla Brain)
2. Prove it in production with paying business users
3. Mingla Brain P1 (consumer + tickets) — independent of ads
4. Mingla Brain P2 (business + payments) — independent of ads
5. **Mechanical ads must be Grade A by here**
6. Mingla Brain P3 (ads as agent tool) — wraps the proven pipeline
7. Mingla Brain P4 (memory + polish)

This dependency is **non-negotiable**. Building the AI ads layer on top of an
unproven mechanical pipeline means debugging two unknowns at once: "is the
agent reasoning right?" AND "is the underlying ad-buy pipeline working?"
Separate them.

---

## 12. Cross-References

- Stripe wiring (proves payment tool pattern is feasible): Cycle 17 / ORCH-0700-series
- Cycle 12 ticketing schema (proves event creation tool pattern): `events` table
- Existing 72 edge functions (proves edge fn deployment pattern): `supabase/functions/`
- Beta Feedback page (proves admin ticket UI pattern): `mingla-admin/src/`
- AppsFlyer integration (already in stack per system memory)
- OpenAI integration (proves LLM-from-edge-fn pattern; Anthropic key follows same shape)

---

**End of brainstorm artifact. Locked 2026-05-06.**
