# Mingla Growth OS — System of Truth

> **This is the single driving document for the Mingla growth org.** Strategy, targets, channel
> playbooks, role charters, cadence, and the live feedback loop all live here. Detail/spec lives in
> META-ORCH-1160 (`Mingla_Artifacts/investigations/INVESTIGATE_META-ORCH-1160_GROWTH_OS_STRATEGY.md`);
> lifecycle/status lives in the World Map. This doc is **slow-changing** — edit it deliberately, log
> every change in §9. If it's a daily task, it goes in ClickUp, not here.

**Status:** v0.1 SKELETON (registered META-ORCH-1160, 2026-06-18). NOT yet operational — instrumentation,
warehouse, dashboards, and the ClickUp space are unbuilt. This doc defines the target system.
**Owner:** Seth (Head of Product + Marketing).

---

## 1. North Star & Funnel

**North Star metric:** _[TBD — Seth to set. Candidate: weekly activated users who reach first-value
(onboarding complete → first save/schedule/purchase), sliced by geo (DC / Raleigh / Lagos)._

The funnel, stage by stage. Each stage has an owner, a primary metric, and a target (targets are
placeholders until Seth sets them):

| # | Stage | Primary metric | Target (TBD) | Primary owner |
|---|-------|----------------|--------------|---------------|
| 1 | Awareness | Leads by channel + CPL | — | Community/Social + Brand + Sales |
| 2 | Acquisition | Signups/installs + CAC | — | Growth Lead |
| 3 | Activation | % reaching first-value + TTFV | — | Growth Lead + Product |
| 4 | Retention | D7/D14/D30, MAU, churn | — | Product |
| 5 | Revenue | GMV, net profit, AOV, LTV | — | Seth |
| 6 | Referral | NPS, invite K-factor | — | Community/Social |

---

## 1A. Operating Rhythm (Agile Marketing — one-week sprints)

Goals nest top-down; results roll up bottom-up. Each level is a measurable contribution to the one above.

`North Star (quarter) → Monthly Theme + target → Weekly Sprint Goal → Per-member Weekly Goal List → daily ClickUp cards`

**Monthly (first Monday):** set ONE theme + one target (e.g. "Nail Lagos messaging → 100 activated users"). Everything that month serves it.

**Weekly sprint (Mon–Fri):**
- **Mon — Planning (60 min):** read last week's dashboard; pick 1 primary sprint goal; assign each member a weekly goal list; lock this week's messaging hypotheses to test.
- **Daily — async standup in ClickUp:** shipped / blocked / feedback. The 30-min AI loop re-directs continuously underneath.
- **Wed — Mid-sprint check:** read early signal; kill obvious losers; reallocate budget/effort.
- **Fri — Review + Retro (45 min):** what the numbers say; promote winners to "scale," kill losers with a reason; PMF pulse; roll learnings into §9.

**Cadence of decisions = three speeds:** tactical (every 30 min, AI), mid-course (Wed, human), strategic (Fri, human + doc update).

## 1B. PMF & Messaging Test Engine (the pre-PMF core)

Every test runs the same standardized loop so results are comparable:

1. **Hypothesis** — "We believe [audience] will [action] because [value prop]."
2. **Variant** — designer/video/copy produce 2–3 versions.
3. **Test** — ship to ONE channel with a tracked link / promo code / UTM; fixed small budget or fixed effort.
4. **Measure** — CTR, CPL, signup-rate, activation-rate vs baseline + qualitative (replies, DM sentiment, poll answers).
5. **Verdict (Fri, threshold rule)** — Kill / Iterate / Scale.
6. **Log** — winners become the new baseline messaging in this doc; losers archived with the reason.

**PMF signals tracked weekly:** activation rate, D7 retention, NPS, Sean-Ellis "% very disappointed if Mingla disappeared," organic/referral share. PMF is declared on the trend of these, not one good week.

**Automations / polling / scripts (build once, run forever):** tracked-link+UTM builder · nightly ad-spend ingest · cold email/DM sequencing + reply detection · in-app NPS + Sean-Ellis PMF survey + post-signup micro-polls · dashboard refresh + **canary monitors that alert when any feed/automation goes stale or breaks** · the 30-min ClickUp feedback ingest · Friday auto-report to the team.

---

## 2. Metric Dictionary (definitions are law)

Every metric: formula + source event(s) + slice dimensions. Full version in the META-ORCH-1160 brief
§A. Standard slice dimensions for ALL metrics: **channel, geo (DC/Raleigh/Lagos), platform
(iOS/Android/web), brand**. Status flags: `LIVE` (instrumented today) / `NEW` (needs instrumentation)
/ `DERIVED` (computed in warehouse).

- **CPL** = channel spend ÷ leads attributed to channel. `NEW` (needs spend ingestion + lead tagging).
- **CAC** = channel spend ÷ acquisitions (install or signup) attributed. `NEW`.
- **TTFV** (time-to-first-value) = first-value event ts − signup ts. `DERIVED` (events LIVE).
- **D7/D14/D30** = % of a signup cohort active on/after day N. `NEW` (cohort RPC or warehouse).
- **GMV / commission** = sum of paid order value / Mingla take. `NEW` (Stripe+Paystack → warehouse).
- **AOV** = GMV ÷ paid orders. `DERIVED`. **LTV** = avg lifetime revenue per buyer. `DERIVED`.
- **Cart abandonment** = checkout_started − purchase, ÷ checkout_started. `NEW` (`checkout_started` missing).
- **NPS** = %promoters − %detractors. `NEW` (no survey today).
- **Invite K-factor** = invites sent × accept-rate per user. `NEW` (link gen event missing).

> Full LIVE/NEW/PARTIAL map per metric: see the instrumentation inventory in the META-ORCH-1160 World
> Map entry. Headline: consumer app rich; **marketing-web, retention, revenue-detail, business-app
> creation events, NPS, invite links are all NEW.**

---

## 3. Channel Playbooks (Awareness)

Every channel becomes measurable through **three instruments — no exceptions:**
1. **Tracked short-links** (`go.usemingla.com/...`, UTM auto-appended, AppsFlyer OneLink for app installs). Nobody ever ships a raw URL.
2. **Unique promo/referral codes** for spoken/unlinkable channels (cold calls, influencers, community chats).
3. **A rigid UTM standard** enforced by a link-builder form (no hand-typed UTMs).

Channels (each gets a per-channel dashboard + a playbook card in ClickUp):

`blog · landing pages · Reddit · Quora · Instagram · Facebook · TikTok · Threads · X · Snapchat ·
influencers · local blogs · local Telegram/WhatsApp · cold calling · cold email · cold DM ·
search ads · Meta ads · TikTok ads · Reddit ads · Snapchat ads`

**Cost input:** ad spend auto-ingested from platform APIs where possible; manual costs (influencer
fees, rep payroll allocation) entered in ONE ClickUp "Spend" list. **A channel with zero cost rows
throws a "CPL unknown" alert** — cost discipline is enforced, not hoped for.

---

## 4. Role Charters

Each role: north-star metric · weekly goals · standard task templates (detailed enough for an
inexperienced hire) · what "good" looks like. Full templates in the META-ORCH-1160 brief §D.

| Person | Role | North-star metric | Owns |
|--------|------|-------------------|------|
| **Seth** | Head of Product & Marketing | LTV:CAC + net profit | Strategy, targets, budget calls, final review |
| **Aaron** | Head of Growth | CAC + activation rate | Acquisition + activation experiments; runs the sprint |
| _(unhired)_ | Social & Community Mgr | Leads + CPL (organic social) | IG/TikTok/X/Threads/Reddit/Quora + local community chats |
| | Graphics & Motion Designer | Asset throughput + on-brand rate | Static + motion creative for all channels |
| | Video Editor | Video output + watch-through | Short-form video for paid + organic |
| | Sales Support | **Live venues recruited** + demos set | Raleigh supply recruitment (the hard side) + cold outreach |
| | Brand Marketer (on-camera) | Brand reach + content CPL | On-camera content, blog, landing pages, influencers, brand voice |

> Detailed per-role charters (weekly goals + task templates + "good looks like") and the full ClickUp
> instantiation live in `Mingla_Roadmap/living/GROWTH_TEAM_CLICKUP_SYSTEM.md`.

---

## 5. ClickUp Structure (execution surface)

`Mingla Growth` space → lists by **role** + by **funnel stage** + an **Ops** list (Spend, Automations,
Experiments). Custom fields on every task: `channel`, `geo`, `promo_code`, `spend`, `Feedback`,
`Feedback_Status` (`none` / `needs_attention` / `addressed`). Statuses: `Backlog → This Week → In
Progress → Needs Review → Done`. All execution lives here; this doc holds only strategy.

---

## 6. The 30-Minute Feedback Loop

A scheduled AI job reads every ClickUp task where `Feedback_Status = needs_attention` every 30 minutes
and: (a) re-directs the hire with a concrete next task/card, (b) escalates budget/scope/strategy calls
to Seth, (c) logs every change to §9. This is how an inexperienced team gets oiled into one goal at
speed. **Spec for this job lands in META-ORCH-1160 Sub-C.**

---

## 7. Dashboard Architecture

- **Per-channel** (×21): spend, leads, CPL, trend.
- **Per-source** (acquisition): installs/signups, CAC, conversion to activation.
- **ONE master "What's Working" board:** every channel ranked by CPL and by LTV:CAC; spend vs return;
  top movers; **a row of automation-health canaries (green/red) so a broken automation is visible at a glance.**
- **Stack (recommended, pending Seth's call):** RudderStack (single event pipe → Mixpanel + warehouse +
  ad platforms) → BigQuery (join point for Mixpanel + AppsFlyer + Stripe/Paystack + RevenueCat + ad-spend
  + ClickUp cost/lead data) → Metabase. **Week-1 stopgap:** Looker Studio on what exists, so visibility
  isn't zero while the warehouse lands. Cheap-shallow fallback: GA4 + Looker Studio (cannot do
  LTV/CAC-by-channel joins well).

---

## 8. Phased Rollout

- **P1 — Visibility floor:** web analytics on marketing + buyer-web; the tracked-link/UTM/promo backbone; `checkout_started`. (Fastest "we can see anything at all.")
- **P2 — CPL/CAC truth:** warehouse + cost ingestion + CPL/CAC by channel; automation-health canaries.
- **P3 — Depth:** business-app creation events, retention cohorts, GMV/AOV/LTV/cart-abandon; the ClickUp team OS + 30-min feedback loop.
- **P4 — Compounding:** referral (NPS, invite links, K-factor); LTV:CAC ranking; self-steering direction.

---

## 9. Decision & Change Log

| Date | Change | By |
|------|--------|----|
| 2026-06-18 | v0.1 skeleton created; META-ORCH-1160 registered. Stack + targets pending Seth. | Orchestrator |
