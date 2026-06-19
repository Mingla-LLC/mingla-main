# Mingla Growth Team — Working System (ClickUp Build Blueprint)

> The complete operating system for the growth team: every space, list, field, status, doc, automation,
> the fulfillment + verification logic, and how data flows. This is the **build spec** — when ClickUp MCP
> is connected, it gets instantiated click-for-click. Strategy/targets live in `GROWTH_OS.md`; lifecycle
> lives in the World Map (META-ORCH-1160).
>
> **Status:** v0.1 blueprint (2026-06-18). NOT yet instantiated. ClickUp MCP not connected; Drive folder
> not yet ingested.

---

## 0. Team (real roster)

| Person | Role | One-line mandate |
|--------|------|------------------|
| Seth | Head of Product & Marketing | Sets strategy + targets, approves budget, final reviewer |
| Aaron | Head of Growth | Runs the weekly sprint; owns CAC + activation; **commissions all blog posts, landing pages & social** (ideates topics/angles, briefs the Content Engine, AI writes the copy) |
| _(unhired)_ | Social & Community Mgr | Organic social + local community supply/demand |
| — | Graphics & Motion Designer | All static + motion creative |
| — | Video Editor | Short-form video |
| — | Sales Support | **Recruits + onboards Raleigh venues (the hard side)** + cold outreach |
| — | Brand Marketer (on-camera) | On-camera content, blog, landing pages, influencers, brand voice |

Marketplace reality (2026-06-18): pre-liquidity, pre-revenue, Stripe in TEST mode — nothing on Mingla
Business is real yet. Lead city = **Raleigh** (only real supply cluster). So the system is **supply-first**:
Sales Support filling the Supply Pipeline is the #1 job until the deck clears.

---

## 1. ClickUp Hierarchy (one Space, role+function folders)

```
WORKSPACE: Mingla
└── SPACE: Mingla Growth
    ├── FOLDER 00 · Command            (Seth)        → strategy, sprint planning, decisions, docs
    ├── FOLDER 01 · Sprint Board       (everyone)    → THE weekly heartbeat — every task lives or links here
    ├── FOLDER 02 · Supply Pipeline    (Sales)       → lists: Venue CRM · Cold Outreach Activity
    ├── FOLDER 03 · Demand & Outreach   (Aaron+Social) → lists: Experiments · Influencer CRM · Channel Activity
    ├── FOLDER 04 · Content Engine     (Aaron briefs; Designer/Video/Brand+AI produce) → lists: Content Production (AI→blog→imagery) · Asset Library
    ├── FOLDER 05 · Ops               (Seth+Aaron)   → Spend, Automation Health, SOP Docs
    └── FOLDER 06 · Feedback & Re-direct (loop)       → Standups · Activity Rollup · 30-min ingest queue
```

One Space keeps everything in one searchable, one-dashboard place. Folders separate by *function* so each
hire has a clear home, while the **Sprint Board** is the single cross-cutting execution surface. **Granularity
principle:** every unit of work is logged twice — as a *leading activity metric* (the act: a call, a DM, a draft,
an outreach) and a *lagging outcome metric* (what it produced). No work is invisible.

---

## 1A. ClickUp Geography — where every component physically lives

**Mental model — ClickUp has two kinds of places, both reached from the LEFT SIDEBAR:**
- **Storage (the filing cabinet):** `Space → Folder → List → Task → Subtask`. This is where work actually lives. Our work lives in ONE Space: *Mingla Growth*.
- **Lenses (hubs that read across the cabinet):** `Dashboards`, `Goals`, `Docs`. These are SEPARATE top-level sidebar sections — they are NOT inside the Space; they pull data out of it.

**Left sidebar, top to bottom (what you click):**
`Home · Inbox · Dashboards · Docs · Goals · ─── Spaces ─── › Mingla Growth › (Folders 00–06) › (Lists)`

| Component | Exactly where it lives | How to get there |
|-----------|------------------------|------------------|
| **Command dashboard** | **Dashboards** hub (sidebar, bar-chart icon) — a dashboard named "Command". NOT inside the Space. | Sidebar → Dashboards → Command. Built from "Cards"/widgets each scoped to the Mingla Growth lists. |
| Sprint Board, Venue CRM, Experiments, Content, etc. (all **Lists**) | Inside **Space › Folder › List** | Sidebar → expand *Mingla Growth* → expand the folder → click the list |
| **Views** (This Sprint, By Person, Needs Review…) | **Tabs along the top of each List** | Open the list → click the view tab; "+ View" adds more |
| **Statuses** (Backlog→Done, Prospect→Live…) | Defined **per List** | Open list → list settings → Statuses |
| **Custom fields** (Role, Channel, Proof, Outcome#…) | **Space-level Field Manager**, applied to each list | Space settings → Field Manager (create once = "global", reuse on each list) |
| **Automations** (the §7 rules) | **Per List**, via the "Automate" button | Open a list → top-right **Automate** (robot icon) → New automation (trigger → action) |
| **Goals** (1/3/6-mo + weekly) | **Goals** hub (sidebar, target icon) — NOT inside the Space | Sidebar → Goals → each Goal holds numeric Targets linked to lists |
| **SOP / Playbook Docs** (GROWTH_OS mirror, sales script, Messaging Baseline) | **Docs** — created inside Folder 05 (also visible in the Docs hub) | Sidebar → Mingla Growth → Folder 05, or sidebar → Docs |
| **Standup / activity cards** | **Tasks** inside the Folder 06 lists | auto-created daily by automation 8a / 2 |

**Lives OUTSIDE ClickUp entirely (be clear about the boundary):**
- **"What's Working" master metrics dashboard** → **Metabase** (separate BI tool), fed by the warehouse. ClickUp can't compute CPL/CAC/LTV. (Looker Studio is the week-1 stand-in.)
- **The 30-min AI feedback loop** → an **external script** (cron + ClickUp API + LLM). It *writes into* ClickUp (comments, status changes) but *runs* outside it.
- **The data warehouse** (BigQuery) + **tracked-link/UTM builder** + **ChatGPT copywriting** → all external tools. ClickUp stores the *artifact and the link*, not the engine.

So: if it's a **task/list**, it's inside the *Mingla Growth* Space. If it's a **dashboard, goal, or doc**, it's a separate sidebar hub. If it's **metrics math or AI automation**, it's a tool outside ClickUp that feeds ClickUp.

---

## 2. The Lists (with statuses, custom fields, views)

Custom fields marked **[global]** exist on every task-list so dashboards can slice uniformly:
`Role`, `Funnel Stage` (Awareness/Acquisition/Activation/Retention/Revenue/Referral), `Channel`, `Geo`
(options: Raleigh · Cary · Durham · DC · New York · Lagos — beachheads = Lagos + Triangle (Raleigh/Cary/Durham); DC + NY secondary; extensible), `Hypothesis` (relationship → Experiments), `Spend $`, `Outcome #`, `Proof` (URL/attachment),
`Feedback` (text), `Feedback Status` (none / needs_attention / addressed).

**`Channel` field — canonical options (EXTENSIBLE; add new options as channels are added).** The dropdown is
a single source of truth; adding a channel = add the option here + a Channel Playbook doc section + a Spend
Tracker row. Current 22:
1. Website — Blog Posts
2. Website — Guides
3. Website — Landing Pages
4. Reddit
5. Quora
6. Instagram
7. Facebook
8. Threads
9. TikTok
10. X
11. Snapchat
12. Influencer Marketing
13. Local Blogs Marketing
14. Local Communities (Telegram & WhatsApp)
15. Cold Calling
16. Cold DMing
17. Cold Emailing
18. Search Ads
19. Meta Ads
20. TikTok Ads
21. Reddit Ads
22. Snapchat Ads
> _(more added as we go — the field, the playbooks doc, and the dashboard all expand without restructuring.)_

### 2.1 Sprint Board (Folder 01) — the heartbeat
- **Statuses:** `Backlog → This Week → In Progress → Blocked → Needs Review → Done`
- **Fields:** [global] + `Sprint` (e.g. S1), `Effort` (S/M/L), `Due`.
- **Views:** `This Sprint` (board by status) · `By Person` (board grouped by assignee) · `Needs Review`
  (Seth/Aaron queue) · `Blocked` · `My Week` (per-hire filtered).
- **Rule:** nothing is worked that isn't on this board for the current sprint.

### 2.2 Supply Pipeline (Folder 02) — recruit Raleigh venues (CRM)
- **Statuses:** `Prospect → Contacted → Meeting Set → Onboarding → LIVE (≥1 bookable offering) → Active → At-risk → Churned`
- **Fields:** `Venue name`, `Contact`, `Category`, `# Live Offerings`, `Charges-enabled?` (bool),
  `Last Touch` (date), `Owner`, [global Geo].
- **Views:** `Pipeline` (board by stage) · `Going Live This Week` · `At-risk` · `Map` (location).
- **This is the hard-side funnel.** Target counts (Month 1: 25–30 LIVE offerings) are tracked off the LIVE+Active stages.

### 2.3 Demand & Experiments (Folder 03) — the PMF / messaging test engine
- **Statuses:** `Idea → Designed → LIVE → Measuring → Verdict: Scale / Verdict: Iterate / Verdict: Kill`
- **Fields:** `Hypothesis` ("[audience] will [action] because [value]"), `Audience`, [global Channel],
  `Variants #`, `Tracked Link`, [global Spend $], `CTR %`, `CPL $`, `Signups #`, `Activation %`,
  `Verdict`, `Learning` (text → archived to Messaging Baseline doc).
- **Views:** `Active Tests` · `Awaiting Verdict (Fri)` · `Winners (Scale)` · `Library (all past)`.
- Each test, ONE channel, tracked link mandatory. Verdicts decided at Friday retro by the threshold rule.

### 2.4 Content Production (Folder 04) — AI-written, human-edited, imagery-attached
The blog/page/social pipeline. **Aaron briefs → ChatGPT writes the copy → human edits → pictures sourced →
uploaded.** ClickUp tracks the artifact + the prompt + the images; it does not generate (that's your external ChatGPT).
- **Statuses (the actual workflow):** `Brief (Aaron) → AI Draft (ChatGPT) → Human Edit → SEO/Brand Check → Imagery Sourced → Seth Approve → Uploaded/Published → Measured`
- **Fields:** `Format` (blog/landing/social-static/social-video/email), [global Channel], `Target Keyword`,
  `Hypothesis` link, `Owner`, `AI Prompt Used` (text/link — what was fed to ChatGPT), `Word Count`,
  `Image Source` (Pexels/Unsplash/Giphy/custom) + `Image URLs`, `CMS/Post URL`, `Tracked Link`, `Performance` (views/CTR post-publish).
- **Subtask checklist (auto-applied per blog card):** ☐ ChatGPT draft from approved prompt → ☐ edit to brand voice →
  ☐ add internal links + CTA → ☐ source 3–5 relevant images → ☐ upload to CMS → ☐ attach tracked link/UTM →
  ☐ Seth approve → ☐ publish → ☐ log performance. Every checkbox is a tracked, timestamped unit.
- **Views:** `Production Queue` (board by status) · `Awaiting AI Draft` · `Awaiting Seth Approval` ·
  `Needs Imagery` · `Published Library` · **`Content Calendar`** (Calendar view by `Publish Date` — the editorial/social
  calendar: what's going out and when, across all channels) · **`Social Calendar`** (Calendar filtered to social formats).
- **SEO** is tracked here via the `Target Keyword` field on blog/guide/landing cards; deep rank/traffic data comes from
  **Google Search Console** (free — near-term add) feeding the deferred warehouse.
- Content is **demand-pulled**: a card is briefed *because* Aaron's plan or an Experiment needs it — not produced speculatively.

### 2.4b Influencer CRM (Folder 03) — per-contact, per-touch outreach
- **Statuses:** `Identified → Researched → Contacted → Replied → Negotiating → Booked → Posted → Measured → Recurring / Passed`
- **Fields:** `Handle`, `Platform`, `Followers`, `Niche`, [global Geo], `Contact Method`, `Touches #`,
  `Last Touch` (date), `Next Action` + `Next Action Date`, `Replied?`, `Deal Terms / $`, `Promo Code`,
  `Tracked Link`, `Posts #`, `Reach`, `Clicks`, `Signups`, `CPL $`, `Owner` (Brand Marketer / Social).
- **Views:** `Pipeline` (by stage) · `Awaiting Reply (follow-up due)` · `Booked & Live` · `Top ROI`.
- Every touch is logged (Touches # increments + a dated comment), so "how many influencers did we contact this week and what replied" is a number, not a memory.

### 2.4c Cold Outreach Activity (Folder 02) — granular cold calling / email / DM
Targets (venues/prospects) live as cards on the **Venue CRM** (§2.2); this list logs the *activity* against them
so leading indicators are visible daily.
- **One card per person per day** (auto-created): `Cold Outreach — {person} — {date}`.
- **Fields:** `Calls Made`, `Connects`, `Emails Sent`, `DMs Sent`, `Replies`, `Meetings Set`, `Script Version`,
  `Notes`, `Owner`. (Plus per-prospect `Last Touch`/`Next Action` on the Venue CRM card itself.)
- **Views:** `Today` · `This Sprint by Person` · `Reply-rate trend`.
- This is the granularity into cold calling you asked for: every call, email, DM, and reply is counted per person per day.

### 2.5 Spend Tracker (Folder 05)
- **Fields:** [global Channel], `Amount $`, `Date`, `Campaign/Experiment` link, `Owner`, `Type` (ads/influencer/tooling/payroll-alloc).
- Feeds CPL/CAC. **A channel running with zero spend rows = "CPL unknown" alert** (automation 7.6).

### 2.6 Automation Health (Folder 05) — the canaries
- One task per automation/script/feed (link-builder, ad-spend ingest, NPS survey, 30-min loop, dashboard refresh…).
- **Status field:** `Healthy / Degraded / BROKEN`; fields `Last Run`, `Owner`, `Runbook` link.
- **Views:** `Canary Board` (color by status) — this is what makes "is an automation broken?" a glance, not a guess.

### 2.7 SOP & Playbook Docs (Folder 05, ClickUp Docs)
GROWTH_OS mirror · Channel Playbooks (1/channel) · **Sales scripts + venue-onboarding SOP** · Messaging
Baseline (current winners) · Brand voice + asset guidelines (← Drive folder once ingested) · Link-builder/UTM
standard · Weekly Sprint Notes archive. SOPs are step-by-step so an inexperienced hire executes without asking.

### 2.8 Standups & Re-direct (Folder 06)
- Daily auto-created `Standup — {date}` task per person: `Shipped / Blocked / Need`. The `Feedback`+`Feedback Status`
  fields here are what the 30-min loop reads.
- `Re-direct Queue` view = all tasks (any list) where `Feedback Status = needs_attention`.

### 2.8b Activity Rollup (Folder 06) — per-person granularity, leading indicators
Every role has a **weekly activity target** in their own units, tracked daily so output is never a mystery:

| Person/Role | Leading activity metrics (counted daily) | Lagging outcome |
|-------------|------------------------------------------|-----------------|
| Sales Support | calls, connects, emails, DMs, meetings set | venues moved to LIVE |
| Social & Community | posts shipped, comments/DMs sent, communities posted in, follower delta | leads + CPL |
| Brand Marketer | influencers contacted, on-camera videos shot, blogs/pages briefed | reach + content CPL |
| Aaron (Growth) | blogs/pages commissioned, experiments launched, channels tested | CAC + activation |
| Designer | assets delivered, revisions | on-brand rate, asset throughput |
| Video Editor | videos delivered, cuts | watch-through |

- Source data comes from the activity lists (Cold Outreach Activity §2.4c, a parallel **Channel Activity** list in
  Folder 03 for social/community counts, and the Content/Experiment cards). The Rollup view aggregates them per person.
- **Dashboard widget "Activity Board":** planned-vs-actual activity per person this sprint → makes underwork visible
  the same day, not at Friday retro.

---

## 3. Goals (ClickUp Goals feature)

Mirror GROWTH_OS targets as numeric ClickUp Goals so progress is automatic:
- **6-mo Goal:** PMF in Raleigh (Sean-Ellis ≥40%) + copyable playbook.
- **3-mo Goal:** 50–60 active venues · 1,000–1,500 activated consumers · 30–50 bookings/wk.
- **1-mo Goal (current):** First real dollar · 25–30 LIVE offerings · 10–20 real bookings · 150–300 consumers · 5 hypotheses tested.
- **Weekly Sprint Goal:** one number, set Monday, tied to the 1-mo Goal.
Each Goal's Targets auto-roll from list fields (LIVE venues count, bookings, etc.).

---

## 4. Dashboards (two surfaces — be honest about the seam)

**ClickUp Dashboard "Command"** (execution + cost + supply — data ClickUp owns):
Sprint burn-up · tasks Needs-Review/Blocked · Supply Pipeline funnel + LIVE-offering count · Spend by channel
· Experiment win-rate · **Automation canary row** · per-person planned-vs-done-with-proof · **Activity Board
(per-person leading metrics: calls/DMs/posts/blogs/influencers-contacted vs target)** · **Influencer pipeline +
reply-rate** · **Cold-outreach daily counts** · **Content pipeline (blogs in AI-draft / awaiting-imagery / awaiting-approval / published)**.

**Metabase Dashboard "What's Working"** (product + revenue — from the warehouse, META-ORCH-1160 Sub-B):
CPL/CAC by channel · activation % · D7/14/30 · GMV/AOV/LTV · cart-abandon · NPS · LTV:CAC ranking.

The seam: ClickUp shows what the team *did* and what it *cost*; Metabase shows what it *produced* in the product.
The master "what's working" view is the Metabase one; the Command dashboard is the daily driver. Until the
warehouse lands, the Looker Studio week-1 stopgap stands in for Metabase.

---

## 5. Data Flow (end to end)

```
1 STRATEGY    Seth sets North Star + monthly theme in GROWTH_OS.md
2 PLAN        Mon planning → Sprint Goal + tasks created on Sprint Board, assigned by Role
3 EXECUTE     Each hire works cards → Supply Pipeline (venues) / Experiments (tests) / Content (assets)
              every external asset carries a tracked link/promo/UTM (built from the standard, never raw)
4 PROVE       Definition of Done (§6) blocks "Done" without Proof + Outcome #
5 MEASURE     tracked links + UTMs + product events → warehouse → Metabase
              Spend + Outcome # entered in ClickUp → Command dashboard
6 REVIEW      Wed mid-check (kill losers) · Fri retro (verdicts → Learning → Messaging Baseline + GROWTH_OS log)
7 FEEDBACK    daily Standup Feedback → 30-min AI ingest re-directs hires / escalates to Seth → logged
8 LOOP        learnings update STRATEGY → back to 1
```

---

## 6. Fulfillment & Verification — "how we KNOW they executed"

No task reaches `Done` on a hire's word. **Definition of Done (enforced by automation 7.3):**
1. `Proof` field populated — URL/screenshot/asset/recording of the actual output.
2. `Outcome #` entered — the number the task produced (links built, venues moved a stage, CTR, calls made).
3. For anything external: the **tracked link** is attached (no raw URL ever shipped).

A `Done` card missing any of the three auto-bounces to `Needs Review`. Verification then rolls up three ways:
- **Per-person weekly scorecard:** planned vs done **with proof** (proof-rate is the trust metric).
- **Pipeline movement:** venues advancing stages, experiments reaching verdict, assets published.
- **Outcome rollup:** the dashboard sums Outcome # by Role/Channel/Stage — execution becomes a number, not a vibe.

This is the constitution's "proof before promotion" applied to people: claimed ≠ done; evidence = done.

---

## 7. Automation Worker (external — webhook + cron driven, NOT ClickUp-native)

> **Verified constraint (Seth, 2026-06-18, tested against the ClickUp REST API):** the API can create/update
> Spaces, Folders, Lists, Tasks, Comments, **Webhooks**, and Custom Fields and set field values — but it
> **cannot fully control native Automations**, and Free Forever caps automations at **5 active / 100 actions/mo**.
> Native ClickUp automations would also have to be hand-built in the UI and would blow the Free quota in a day
> (7 people × daily auto-cards). **So we do NOT use native automations.** All automation logic lives in ONE
> external **Automation Worker** — the same service that runs the 30-min loop (§8) — that I control entirely by API.
>
> **How the worker fires:** (a) **Webhooks** I register on the workspace (`taskCreated`, `taskUpdated`,
> `taskStatusUpdated`, `taskCommentPosted`) push events to the worker in real time; (b) a **cron** (Supabase edge
> scheduled function — already in our stack, free) handles the time-based rules (Mon/Fri/daily 8:00). The worker
> then creates tasks, sets statuses (using each list's **exact** status strings), sets field values, and posts
> comments — all confirmed-available API calls. This sidesteps the automation quota entirely and needs no paid tier *for automations*.

**Worker responsibilities (same rules, now executed by the worker):**
1. **Mon 8:00 (cron)** — create `Sprint Planning` task (Seth+Aaron) + roll incomplete cards to new Sprint.
2. **Daily 8:00** — create `Standup — {date}` per person.
3. **DoD gate** — status→`Done` with empty `Proof` OR empty `Outcome #` → set status `Needs Review` + comment "DoD: attach proof + outcome."
4. **Review routing** — status→`Needs Review` → assign Seth (content/strategy) or Aaron (experiments) + notify.
5. **Feedback flag** — `Feedback Status`→`needs_attention` → add to `Re-direct Queue` + notify Aaron; if tagged `budget`/`scope` → notify Seth.
6. **Supply** — Pipeline stage→`LIVE` → create `Verify live bookable offering` QA task; stage→`At-risk` → notify Sales + Seth.
7. **Experiment lifecycle** — status→`LIVE` → create `Measure (T+7d)` task due in 7 days; `Verdict:*` set → create `Log learning` subtask; channel has experiment but Spend Tracker has 0 rows for it → flag `CPL unknown`.
8. **Fri 16:00** — create `Sprint Review + Retro` task; attach the week's experiments awaiting verdict.
8a. **Daily 8:00** — auto-create the day's `Cold Outreach — {person}` activity card for Sales + a `Channel Activity — {person}` card for Social, pre-filled with zeroed counters.
8b. **Content workflow** — Content card status→`AI Draft` → add the AI-draft subtask checklist + remind owner "paste ChatGPT output + prompt used"; status→`Imagery Sourced` with empty `Image URLs` → bounce back "attach 3–5 images"; status→`Uploaded/Published` with empty `Tracked Link` → bounce (no raw URLs).
8c. **Influencer follow-up** — Influencer card `Replied?`=No and `Last Touch` > 3 days → set `Next Action`=follow-up + surface in `Awaiting Reply` view.
9. **External — 30-min AI ingest (NOT native; needs ClickUp API + a scheduled runner):** every 30 min read
   `Re-direct Queue`; for each: summarize, post a concrete next-step comment, assign the next card, escalate
   flagged items to Seth, set `Feedback Status=addressed`, append to the decision log. **Build item — scaffolded
   once ClickUp API access exists.**

---

## 8. The 30-Minute Loop — what it actually is

ClickUp's native automations can't run an LLM, so the "AI ingests feedback every 30 min and re-directs" is an
**external script** on a schedule (cron / edge function) using the ClickUp API + an LLM. It: (a) reads the
Re-direct Queue, (b) drafts a re-direction per hire, (c) escalates budget/scope/strategy to Seth, (d) writes
decisions to the log. This is the single highest-leverage automation and is specced as META-ORCH-1160 Sub-C.
It can run read-only-suggest first (drafts comments for Seth to approve) before going fully autonomous.

---

## 9. Build Order (when ClickUp is connected)

1. Space + 7 folders + global custom fields.
2. Sprint Board + Supply Pipeline (the two that matter Week 1) with statuses/fields/views.
3. Experiments + Content + Spend + Automation Health + Standups lists.
4. Goals (1/3/6-mo + weekly) + the Command dashboard.
5. Native automations 7.1–7.8.
6. SOP/Playbook docs (seed sales script + venue-onboarding SOP first — that's what Sales Support needs Day 1).
7. External 30-min loop (Sub-C) + warehouse/Metabase (Sub-B).

---

## 9A. Setup Requirements & Cost

**Two buckets. You only need Bucket A to run the team system; Bucket B adds metric depth later and is still mostly free at current scale.**

### Bucket A — run the human system now (sprints, lists, dashboards, execution)
| Need | What to set up | Free? | Realistic cost |
|------|----------------|-------|----------------|
| ClickUp workspace | 1 workspace + the *Mingla Growth* space + API token | **Free can START** — structure + tasks + custom fields + webhooks + the external worker all run on Free (we externalized automations, so the 5-automation cap is irrelevant). The open question is whether Free's **dashboard** and **custom-field** allowances cover our 11-widget dashboard + 10 global fields. | **$0 to begin.** Upgrade to Unlimited $7/user/mo ONLY if the dashboard/field caps bite → 7 seats ≈ **$49/mo** |
| Web analytics | GA4 on marketing + buyer-web (free) | **Yes** (GA4 free; Vercel Web Analytics free tier as alt) | $0 |
| Tracked-link / UTM builder | A short-link + a UTM convention (Bitly free / a Sheet / self-host) | **Yes** (free tiers) | $0 (+ optional ~$10/mo custom short domain) |
| AI copywriting | ChatGPT (already have) | n/a | already paid |

**Bucket A bottom line: ~$49–$84/mo (ClickUp seats) + a one-time build effort. Everything else free.**

### Bucket B — full metric depth (CPL/CAC/LTV, the master dashboard, the AI loop) — Phase 2
| Need | What to set up | Free at our scale? | Cost when it grows |
|------|----------------|--------------------|--------------------|
| Event pipeline | RudderStack (free cloud tier ~5k MTU, or self-host OSS) | **Yes** | paid only past ~5k monthly users |
| Data warehouse | BigQuery (10GB storage + 1TB queries/mo free) | **Yes** (tiny scale) | cents-to-low-$ for a long time |
| BI dashboards | Metabase OSS (self-host free) or Looker Studio (free) | **Yes** | Metabase Cloud ~$85/mo only if you don't self-host |
| Product analytics | Mixpanel (already wired; free ≤ ~20M events/mo) | **Yes** | free at this scale |
| 30-min AI loop | a cron runner (Supabase edge cron — already in stack) + an LLM API key + ClickUp API | mostly | a few $/mo in LLM tokens |
| Web instrumentation + new events | engineering build (META-ORCH-1160 Sub-A/C) | n/a | internal build time, not a SaaS bill |

**Bucket B bottom line: ~$0–$5/mo in SaaS at current pre-launch scale; the real cost is build time, not subscriptions. Metabase Cloud (~$85/mo) is the only line you can avoid entirely by self-hosting.**

### Honest summary
- **To start running the team next week:** one paid ClickUp tier (~$49–$84/mo for 7 seats) + free GA4 + a free link builder. That's it.
- **The whole analytics stack** (pipeline → warehouse → BI → AI loop) is **free-to-near-free at Mingla's current scale** — you pay in engineering time, not subscriptions, and SaaS bills only appear once volume is real (a good problem).
- **Nothing here is locked to an expensive vendor:** every paid option (Segment, Metabase Cloud, Plausible) has a free/open-source substitute already compatible with the stack.

## 9B. Adopted from the supply-acquisition thesis (2026-06-18)

Reconciling the ChatGPT GTM thesis ([GROWTH_90DAY_ACQUISITION_PLAN.md](GROWTH_90DAY_ACQUISITION_PLAN.md)) into the
build. **One reframe + four additions:**

- **REFRAME: `Venue CRM` (§2.2) → `Supply CRM`** — same statuses/fields, but targets = creators · venues · promoters ·
  trip hosts · restaurants · galleries · campus/diaspora orgs (not venues only). Add field `Lead Type`.
- **ADD List: `City Launches`** (Folder 03) — one list-view per city (Lagos · Raleigh · Cary · Durham · DC · NY)
  filtered from Supply CRM by `Geo`, so each beachhead has its own board. (Implementation: saved views on Supply CRM
  by Geo, OR per-city lists if Codex finds views insufficient.)
- **ADD List: `Creator Onboarding`** (Folder 04) — the post-"yes" concierge pipeline.
  - Statuses: `Waiting for assets → Assets received → Page setup → Copy needed → Design needed → Sent to creator → Approved → Published → Promo live → Post-event follow-up`
  - Columns: Creator · Event/Trip/Experience name · Geo · Date · Capacity · Ticket/RSVP details · Current platform/link ·
    Assets (flyer/cover) · Mingla link · Promo pack (IG/story/WhatsApp/email/reel) · Results (views/RSVPs/revenue/feedback/repeat?)
- **ADD List: `Product Growth Requests`** (Folder 05) — growth→engineering bridge (evidence-required).
  - Statuses: `Request → Spec needed → Prioritized → Sent to GitHub → In progress → QA → Shipped → Measured`
  - Columns: Pain (with evidence) · Business impact · Current workaround · Proposed solution · MVP scope · Success metric · GitHub link
- **ADD Doc: `Mingla Growth AI Playbooks`** (Folder 05) — the reusable prompt library (§8 of the 90-day plan).

These fold into the manifest totals: **16 Lists · 9 Docs** (everything else unchanged).

## 9C. Build Stages (lean → fully built)

Each stage is independently valuable and shippable — the team can acquire customers from Stage 0; later stages add
automation + visibility, they don't block the motion. Gated by dependency, not by calendar.

- **Stage 0 — Lean structure (this dispatch).** Codex builds the 10-list ClickUp workspace + fields + views + content
  calendar + spend ledger + Docs + Drive + registers webhooks. *Unlocks: the system exists; team operates manually.*
- **Stage 1 — Operate & learn (1–2 wks, no build).** Team runs it manually; we find the real friction. *Unlocks: validated workflow + the exact list of what to automate.*
- **Stage 2 — Automation Worker v1.** External webhook+cron service: auto-creates daily standup/activity cards, bounces
  "Done" without Proof+Outcome, routes feedback, flags CPL-unknown + influencer follow-ups. *Unlocks: the nudges run themselves.*
- **Stage 3 — AI loop + Playbooks.** Worker gains the LLM layer: 30-min feedback re-direction + the AI Playbooks (lead
  research, outreach drafts, onboarding packs, weekly report) — "draft-for-approval" first, then autonomous. *Unlocks: AI does the grunt copywriting/research; humans close.*
- **Stage 4 — Visibility floor (Sub-A).** Tracked-link/UTM backbone + GA4/Vercel on marketing + buyer-web + Google
  Search Console + `checkout_started`. *Unlocks: first real traffic + conversion + SEO visibility.*
- **Stage 5 — Warehouse + master dashboards (Sub-B).** RudderStack → BigQuery → Metabase; joins Mixpanel + AppsFlyer +
  Stripe/Paystack + RevenueCat + ad-spend + ClickUp ledger. Ad-platform APIs auto-fill the Spend Ledger. *Unlocks: real CPL/CAC/LTV by channel + the "What's Working" master view + canaries.*
- **Stage 6 — Instrumentation depth (Sub-C).** Business-app creation events, retention cohorts (D7/14/30, MAU, churn,
  uninstalls), NPS survey, invite-link/referral events, cart-abandon. *Unlocks: the activation/retention/revenue/referral metrics that are missing today.*
- **Stage 7 — Fully built / self-steering.** Loop self-directs the team, full-funnel dashboards, spend auto-ingests,
  PMF signals tracked, LTV:CAC drives budget. *(Tier-3 native in-Mingla CRM/campaign tools = much later, only if it earns it.)*

**Runs in parallel (product prerequisite, not part of this build):** flip Stripe TEST→LIVE + land the first real paid
booking — gate-zero for the whole revenue funnel.

## 10. Change Log
| Date | Change | By |
|------|--------|----|
| 2026-06-18 | v0.1 blueprint created. ClickUp MCP not connected; Drive not ingested. | Orchestrator |
