# Mingla Supply CRM + AI Prospecting System

Date: 2026-06-23
Mode: Sales strategy / ClickUp operating system
Source: ClickUp `Mingla Growth` space inspection + Mingla sales skill references

## 1. What I Found In ClickUp

### Current ClickUp Structure

| Surface | ID | Role | Current fit |
|---|---:|---|---|
| Space: `Mingla Growth` | `90146114214` | Growth operating home | Correct home for supply growth work. |
| Folder: `02 Supply Pipeline` | `901410144770` | Supply-side pipeline folder | Correct place for lead/prospect CRM. |
| List: `Supply CRM` | `901417374441` | One card per venue / creator / promoter / trip host lead | Structurally good, but currently appears sample-only. |
| List: `Activity Log` | `901417374445` | Daily leading-indicator tracker | Good companion list for touches/posts/replies, but should not replace lead cards. |
| List: `Creator Onboarding` | `901417374442` | Post-yes concierge setup pipeline | Correct handoff point after a prospect sends assets or agrees to a pilot. |

### Supply CRM Current List Description

Owner: Sales Support.

Purpose: hunting pipeline for venues / creators / promoters / trip hosts.

Current flow: `Prospect -> Contacted -> Meeting Set -> Onboarded -> LIVE -> Active`, with `At-risk / Churned` exits.

Operating rule already present: one card per lead; every card needs a Next Action date. When a lead says yes, create a Creator Onboarding card.

### Supply CRM Statuses

| Status | Recommended meaning |
|---|---|
| `to do` | Raw imported lead, not yet scored. |
| `prospect` | Scored as ICP-fit and ready for first touch. |
| `contacted` | First touch sent. |
| `meeting set` | Call / visit / async setup agreed. |
| `onboarded` | Yes received; Creator Onboarding card created and linked. |
| `live` | First page / event / campaign / share link is live. |
| `active` | Repeated publish, repeat share, buyer/lead proof, or ongoing partner behavior. |
| `at risk` | No next action, no share, no response, or stalled after yes. |
| `churned` | Explicit no, wrong fit, or dead after follow-up sequence. |

### Creator Onboarding Current Flow

`Waiting for assets -> Assets received -> Page setup -> Copy needed -> Design needed -> Sent to creator -> Approved -> Published -> Promo live -> Post-event follow-up`

This is strong. Do not overload Supply CRM with page setup work. Supply CRM owns the relationship and source pipeline; Creator Onboarding owns fulfillment.

## 2. How To Adapt The Prospecting Plan To This Pipeline

### Principle

Do not run prospecting from a spreadsheet and then separately update ClickUp. ClickUp should become the supply-side source of truth. A spreadsheet can still be used as an AI staging table, but only temporarily before import.

### The Three-List Operating Model

| Work type | ClickUp list | One card means | Completion signal |
|---|---|---|---|
| Lead relationship | `Supply CRM` | One business / creator / promoter / host | Lead is active, churned, or moved to onboarding. |
| Daily activity | `Activity Log` | One day/person/channel activity summary | Counts and learnings logged. |
| Concierge fulfillment | `Creator Onboarding` | One accepted prospect being built live | Published + promo live + post-event follow-up. |

### Lifecycle

1. Raw lead discovered by AI/manual sourcing.
2. Create/append a `Supply CRM` card in `to do`.
3. AI enriches and scores.
4. Human reviews; good leads move to `prospect`.
5. First personalized outreach sent; move to `contacted`.
6. Reply/call/visit booked; move to `meeting set`.
7. Prospect says yes or sends asset; create `Creator Onboarding` card and move Supply CRM to `onboarded`.
8. Creator Onboarding handles assets, page setup, copy/design, approval, publishing, and promo.
9. Supply CRM mirrors outcome: `live` after first launch, `active` after repeat behavior.
10. Activity Log captures daily touch volume and conversion quality.

## 3. Required Supply CRM Fields

The connector confirmed the sample cards have 18 custom fields, but did not expose the field definitions. Whether these already exist or not, the Supply CRM should support the fields below.

### Minimum Required Fields

| Field | Type | Why it matters |
|---|---|---|
| City | dropdown | Triangle / DC / Lagos prioritization. |
| Segment | dropdown | Restaurant, bar, cafe, venue, promoter, creator, experience brand, trip host, pop-up, wellness. |
| ICP Tier | dropdown | A / B / C fit. |
| Lead Score | number | Forces prioritization. |
| Source Type | dropdown | Directory, Instagram, Eventbrite, Tix Africa, referral, field visit, article, chamber, venue list. |
| Source URL | URL | Audit trail. |
| Instagram URL | URL | Best channel for operator signal. |
| Website URL | URL | Checks current public surface. |
| Contact Name | text | Owner / manager / promoter if known. |
| Contact Role | dropdown | Owner, GM, marketer, promoter, creator, events manager. |
| Current Tool | dropdown | Instagram, WhatsApp, Eventbrite, Posh, Google Forms, Square, Mailchimp, OpenTable/Resy, spreadsheet, unknown. |
| Upcoming Moment | text | Event, brunch, weekly night, menu drop, party, workshop, creator activation. |
| Upcoming Moment Date | date | Urgency. |
| Pain Signal | dropdown/multi-select | DM chaos, weak link, flyer-only, no checkout, recurring nights, slow night, weak page, strong vibe invisible. |
| Personalization Token | text | Exact line used in first outreach. |
| First Ask | dropdown | Send flyer, send menu, 15-min call, publish one page, QR/link test, pilot one event. |
| Last Touch Date | date | Hygiene. |
| Next Action Date | due date | Non-negotiable. |
| Next Action Type | dropdown | DM, email, call, visit, follow-up, build mock, send link, ask for asset. |
| Outreach Step | dropdown | 1-5 sequence step. |
| Linked Onboarding Task | URL/text | Connect Supply CRM to Creator Onboarding. |
| Live Page URL | URL | Proof. |
| Result Metric | text | Shared link, clicks, buyer, lead, repeat publish, quote, objection. |

### Lead Scoring

Use a 10-point score:

- `+3` upcoming event / recurring programming / active offer in next 30 days.
- `+2` visible payment or checkout friction: DMs, WhatsApp, Google Forms, Eventbrite/Posh link, flyer-only.
- `+2` strong vibe but weak public surface.
- `+1` active Instagram/social proof.
- `+1` owner-operated or creator-led.
- `+1` in priority city wedge.
- `-3` enterprise chain / procurement-heavy / no obvious owner.
- `-2` no upcoming moment.
- `-2` no clear way to contact.

Priority:

- `8-10`: contact now.
- `5-7`: contact after A-list or batch into nurture.
- `0-4`: park, follow content, or discard.

## 4. City-Specific Sourcing Lanes

### Triangle

Primary lanes:

- Downtown Raleigh restaurants, bars, nightlife, events.
- Downtown Durham restaurants/bars, breweries, cafes, Black-owned/story-rich venues.
- Cary restaurants, cafes, community venues, family/occasion spots.
- Shop Local Raleigh / chamber businesses with food, beverage, vendor, or event programming.

Best sources:

- Downtown Raleigh Alliance
- Raleigh Chamber
- Downtown Durham Inc.
- Durham Chamber
- Cary Chamber
- Shop Local Raleigh
- Instagram venue/event calendars
- Axios/Eater-style opening lists

Best first asks:

- "Send one menu item, flyer, or recurring night."
- "Let us turn one slow-night idea into a shareable Mingla page."
- "Let us build the page/QR and see if people respond."

### DC

Primary lanes:

- RAMW restaurants/bars.
- Restaurant Week / food event participants.
- Nightlife venues and recurring promoters.
- Cultural/community events, diaspora events, museums/venues with programming.
- BIDs and neighborhood event calendars.

Best sources:

- RAMW member list and restaurant week pages.
- Washington.org event listings.
- Events DC.
- DC nightlife/event venue pages.
- Instagram promoter/event calendars.

Best first asks:

- "You already have demand moments. Mingla can make the moment easier to discover, share, buy/book, and follow up from."
- "Let us mirror one event or recurring night."

### Lagos

Primary lanes:

- Nightlife promoters.
- Lounges, beach clubs, event centers.
- Creator-led events.
- Ticketed food/drink/culture experiences.
- Venues selling through WhatsApp, DMs, Eventbrite, Tix Africa, Popout, Landmark-style platforms.

Best sources:

- Tix Africa.
- Popout Tickets.
- Eventbrite Lagos nightlife.
- Lagos Events Instagram.
- My Guide Nigeria venue/category lists.
- Landmark Events.
- Instagram creator/promoter pages.

Best first asks:

- "Stop collecting payments in DMs."
- "Keep WhatsApp for conversation; use Mingla for the page, payment, guest list, ticket, and proof."
- "Send one flyer and we will turn it into a cleaner page/checkout test."

## 5. AI Automation Architecture

### Level 1: Fast Manual + AI Assist

Best immediate setup.

Tools:

- ClickUp: CRM + Activity Log + Creator Onboarding.
- Google Sheets or Airtable: temporary enrichment/import staging.
- ChatGPT/Codex: scoring, personalization, message generation, data cleaning.
- Clay or Apollo: enrichment and contact discovery.
- Phantombuster / Apify: public directory and Instagram metadata scraping where permitted.
- Zapier / Make / n8n: move rows into ClickUp tasks and trigger follow-ups.

Workflow:

1. Pull 50-100 source rows from directories/event platforms.
2. AI dedupes, segments, scores, and drafts personalization.
3. Human approves top 25.
4. Automation creates ClickUp `Supply CRM` cards in `to do` or `prospect`.
5. AI writes first-touch message into the task description/comment.
6. Seth sends or approves outreach.
7. Replies update status and next action.

### Level 2: Semi-Automated AI SDR

Use once the first two weeks prove which segment converts.

Tools:

- Clay: source/enrich/signal extraction.
- Instantly / Smartlead / Apollo: email sequencing.
- Common Room / Folk / Attio / HubSpot: optional richer relationship CRM, if ClickUp becomes clumsy for contacts.
- ClickUp: operational source of truth and fulfillment.
- Make/Zapier/n8n: sync between lead source and ClickUp.
- OpenAI API / ChatGPT tasks: classify and draft.
- Browse AI / Apify: monitor event calendars and pages.

Workflow:

1. Source monitors run daily by city and segment.
2. AI detects new upcoming moments: event date, flyer, menu drop, recurring night.
3. Lead score updates.
4. If score >= 8 and no duplicate, create Supply CRM card.
5. AI generates first-touch and follow-up copy from personalization token.
6. Outreach tool sends email or prepares DM.
7. Positive reply creates a follow-up task or Creator Onboarding task.

### Level 3: Full Prospecting Engine

Use only after you know the winning city/segment/message.

Components:

- A source crawler for each lane.
- A dedupe/enrichment database.
- An LLM scoring/classification layer.
- Outreach sequencer.
- ClickUp task creation/update.
- Weekly dashboard.
- Human approval queue for high-value or sensitive prospects.

Do not build Level 3 first. First prove the scorecard and message manually.

## 6. Recommended Tool Stack

### Keep ClickUp As The Operating CRM

Use ClickUp because it already has the pipeline, handoff lists, and daily activity list.

Strengths:

- Good for workflows and fulfillment.
- Good for next-action discipline.
- Good for connecting prospect -> onboarding -> content.

Weaknesses:

- Less ideal for bulk enrichment, contact dedupe, email deliverability, and automatic sourcing.

### Add A Prospecting Data Layer

Best options:

| Tool | Use |
|---|---|
| Clay | Best all-around AI prospecting/enrichment layer. Strong for scraping sources, enriching contacts, scoring, AI personalization, and pushing to ClickUp. |
| Airtable | Cleaner database if you want full control before pushing only qualified leads into ClickUp. |
| Google Sheets | Cheapest staging layer. Good enough for first 2 weeks. |
| Apollo | Contact discovery and email sequences, better for US markets than Lagos. |
| Instantly / Smartlead | Cold email sequencing once deliverability is ready. |
| Phantombuster | Instagram/public social extraction. Use carefully and respect platform limits. |
| Apify | Directory/event scraping and repeatable crawlers. |
| Browse AI | No-code monitoring of event calendars/directories. |
| Make / Zapier / n8n | Glue between source tables, AI, outreach tools, and ClickUp. |
| Perplexity / ChatGPT / Codex | Research, enrichment, scoring, and message drafting. |

Recommended first stack:

1. ClickUp for system of record.
2. Google Sheets for staging.
3. Clay for sourcing/enrichment once weekly process is proven.
4. Make or Zapier to create ClickUp tasks.
5. ChatGPT/Codex for scoring and personalization.

## 7. ClickUp Card Template

Task name:

`[City] [Segment] - [Business/Creator Name] - [Upcoming Moment]`

Description:

```md
## Snapshot
- City:
- Segment:
- Buyer/persona:
- Contact:
- Source:
- Instagram:
- Website:

## Why this is a fit
- Upcoming moment:
- Pain signal:
- Current workaround:
- Lead score:
- Personalization token:

## First ask
[Send flyer / send menu / 15-min call / publish one page / QR-link test / pilot one event]

## Outreach
- Step 1:
- Step 2:
- Step 3:
- Step 4:
- Step 5:

## Notes
- Objections:
- Product gaps:
- Proof captured:
- Next action:
```

## 8. Automation Rules To Add

In ClickUp:

- If status becomes `prospect`, require/verify due date = Next Action.
- If status becomes `contacted`, create Activity Log card for that day.
- If status becomes `meeting set`, set priority high and due date to meeting date.
- If status becomes `onboarded`, create Creator Onboarding task from template.
- If no update for 7 days in `contacted`, move to `at risk` or create follow-up task.
- If Creator Onboarding status becomes `Published`, update linked Supply CRM card to `live`.
- If Creator Onboarding status becomes `Promo live`, update linked Supply CRM card to `active` only after proof is logged.

Outside ClickUp:

- New high-score staging row -> create ClickUp Supply CRM task.
- Positive email/DM reply -> update status to `meeting set` or add comment.
- Asset received -> create Creator Onboarding card and attach/link asset folder.
- Weekly Friday -> generate summary by city, segment, source, and objection.

## 9. Weekly Metrics

Supply:

- New leads added.
- Scored A leads.
- First touches sent.
- Reply rate.
- Asset-send rate.
- Meeting-set rate.
- Onboarding handoff rate.

Activation:

- Creator Onboarding cards created.
- Assets received.
- Pages published.
- Promo live.
- First buyer/lead/share.
- Repeat publish.

Learning:

- Best source.
- Best segment.
- Best first ask.
- Most repeated objection.
- Product gap discovered.

## 10. Recommendation

Keep the existing ClickUp pipeline. Do not rebuild it.

Adapt it by adding strict intake fields, scoring, and automation rules. Use a staging layer for AI-assisted sourcing and enrichment, then push only qualified leads into ClickUp. The fastest version is Google Sheets + ChatGPT/Codex + ClickUp. The scalable version is Clay + Apollo/Instantly + Make/Zapier + ClickUp. The rule is simple: AI sources and drafts, Seth approves strategy and high-value outreach, ClickUp tracks every next action and every conversion.
