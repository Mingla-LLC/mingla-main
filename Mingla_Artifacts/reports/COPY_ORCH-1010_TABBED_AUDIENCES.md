# COPY — ORCH-1010 — Tabbed, Audience-Filterable Section (`/organisers`)

**Skill:** mingla-product (COPY / brand-voice mode)
**Surface:** `mingla-marketing` → `/organisers` (Mingla Business marketing page)
**Date:** 2026-05-30
**Mode:** Copy only — no code, no design. Each field is structured so an implementor can drop it into a component verbatim.

---

## What this section is

A tabbed, audience-filterable block. The visitor clicks an audience pill and the section re-skins to speak directly to THEM: a punchy heading (the outcome they want), a short emotional intro, a 3-step "how it works," and 3–4 tailored feature cards. A venue owner, a chef, a promoter, and an experience host should each read THEIR tab and feel seen.

**Section eyebrow (above the tab row, fixed across all tabs):**
> Built for your kind of place

**Section heading (fixed across all tabs):**
> pick your world. see your Mingla.

(Lowercase, house style. The heading frames the tabs as a "choose your world" interaction.)

---

## Reality anchor (what these claims map to — all shipped, grade A/B unless flagged)

- **Vibe-matched discovery** — people find places/events/experiences by vibe, not search; the brand gets matched to people already looking. (SHIPPED)
- **Native all-in checkout** — web + native, buyer never types an address, one all-in price up front, no checkout surprise. (SHIPPED)
- **Ari, the AI assistant** — names your vibe, builds your page, helps create events/experiences, helps run marketing. (SHIPPED)
- **Email your real buyers + owned customer list** — campaigns to people who actually bought. (SHIPPED)
- **Guest list + check-ins** — "know who showed up." (SHIPPED)
- **A page worth sharing** — on-brand page, your colors/photos/video/story. (SHIPPED)
- **Tell your vibe in plain words** — name the energy so the right people self-select. (SHIPPED)
- **"Keep the lion's share"** — aspirational register only; NO hard fee/percentage claim in this section (a separate stats band owns numbers).
- **Broader CRM / AI advertising that fills slow nights** — ROADMAP. Use aspirational register, never a shipped-spec promise.

**No fabricated metrics, SLAs, or percentages anywhere in this section.** Any number is forbidden here; the page has a dedicated stats band.

---

## Data model (for the implementor)

```
type Tab = {
  id: string                 // stable key
  tabLabel: string           // 1–2 words, the pill
  heading: string            // ~4–7 words, the outcome
  intro: string              // 1–2 sentences
  steps: { title: string; body: string }[]    // exactly 3
  features: { title: string; body: string }[] // 3 or 4
  proof?: string             // optional one-liner; if it contains a number it MUST read as illustrative
}
```

Render order of tabs: **Venues → Dining → Events → Experiences → Pop-ups** (a 5th tab is proposed below; ship 4 or 5 at implementor/operator discretion — the 5th strengthens the "full experience economy" promise from the canonical Business script).

---

# TAB 1 — Venues

> Bars, clubs, cafés, activity spaces — any room that gets better when it's full.

### tabLabel
```
Venues
```

### heading
```
turn your room into the plan.
```

### intro
```
The room that feels perfect on a Friday night shouldn't be the city's best-kept secret. Mingla turns your space, your nights, and your energy into a plan people actively choose — and fills the room with the crowd that fits it.
```

### steps (exactly 3)

1.
```
title: name your vibe
body: Tell Mingla the energy of your place in plain words — cozy, lively, late-night, high-energy — and Ari builds you a page that looks and feels like the room.
```

2.
```
title: get matched
body: Your place reaches people by vibe, taste, location, and timing — not just who's nearby, but who's looking for exactly this tonight.
```

3.
```
title: fill the room
body: They book a table, a spot, or a night right inside Mingla — and you watch the right crowd walk through the door.
```

### features (3–4)

1.
```
title: a page that feels like the room
body: Your colors, your photos and video, your story — the page people actually want to send to the group chat, not just another listing.
```

2.
```
title: matched to the right crowd
body: Reach the people already looking for a place like yours tonight, instead of paying to chase strangers who'll never come back.
```

3.
```
title: know which nights work
body: Your dashboard shows the guest list, check-ins, and what sold — so you finally know which nights, offers, and crowds are working.
```

4.
```
title: bring them back
body: Email the people who actually showed up — no list to build, no extra tool to learn. They're already there, and the slow nights are next.
```

### proof (optional)
```
Be the plan, not the afterthought.
```
*(No metric. Voice line only.)*

---

# TAB 2 — Dining

> Restaurants, cafés, supper clubs, food trucks — anywhere the menu is the reason.

### tabLabel
```
Dining
```

### heading
```
make your menu the reason.
```

### intro
```
The handmade pasta. The patio at golden hour. The cocktail only your bartender can make. Mingla turns your menu, your room, and your best nights into something people book a table for — and matches you to the people already hungry for exactly this.
```

### steps (exactly 3)

1.
```
title: show the dish
body: Put your menu, your room, and your golden-hour patio on a page that makes people taste it before they arrive — Ari helps you build it in minutes.
```

2.
```
title: reach the hungry
body: Mingla matches your place to people planning a dinner, a date, or a long lunch nearby — by taste and timing, not just distance.
```

3.
```
title: book the table
body: They reserve and pay one all-in price up front, right inside Mingla — no address typing, no checkout surprise, no third-party app skimming the night.
```

### features (3–4)

1.
```
title: a menu worth sharing
body: Your dishes, your photos, your story on a page built to be sent to the group chat — the reason someone picks you over the place next door.
```

2.
```
title: matched by taste
body: Reach diners by what they're actually craving and planning — the people looking for your kind of night, not a generic "restaurants near me" list.
```

3.
```
title: all-in checkout, built in
body: Sell tables, tasting menus, and prepaid experiences inside Mingla. Buyers see the full price before they pay — no surprises, fewer no-shows.
```

4.
```
title: regulars, not one-timers
body: Email the diners who already booked with you and keep your slow nights full — your customer list, owned by you, ready to use.
```

### proof (optional)
```
Sell the table, not just the listing.
```

---

# TAB 3 — Events

> Promoters, party throwers, comedy nights, festivals, one-off shows.

### tabLabel
```
Events
```

### heading
```
sell the night, not just the ticket.
```

### intro
```
A flyer says what's happening. Mingla says why it matters — the lineup, the crowd, the culture, the timing — and lets the right people buy in seconds, before the plan dies in the group chat.
```

### steps (exactly 3)

1.
```
title: build the night
body: Ari turns your event into a page that sells the experience — the lineup, the energy, the reason to be there — not just a date and a price.
```

2.
```
title: find your crowd
body: Mingla puts your night in front of the people already looking for exactly this — by vibe, scene, and timing — so you're not paying to chase strangers.
```

3.
```
title: sell in seconds
body: They buy their spot inside Mingla — one all-in price up front, no address typing, no abandoned cart, no checkout surprise.
```

### features (3–4)

1.
```
title: a page that sells the night
body: The lineup, the crowd, the culture, the timing — Mingla tells people why it matters, so the flyer becomes a reason to show up.
```

2.
```
title: in front of the right people
body: Reach the scene already looking for a night like yours, instead of buying ads that chase the same paid strangers over and over.
```

3.
```
title: all-in checkout, built in
body: Sell tickets and tables right inside Mingla, all-in price up front. Buyers see the full cost before they pay — fewer drop-offs, faster sell-through.
```

4.
```
title: know who showed up
body: Guest list, check-ins, and what sold — all in your dashboard — so you know which nights, lineups, and crowds to run back.
```

### proof (optional)
```
The group chat is where plans go to die. Mingla is where yours gets picked.
```

---

# TAB 4 — Experiences

> Cooking classes, horseback rides, tours, day trips, tastings, outdoor adventures, trip organizers.

### tabLabel
```
Experiences
```

### heading
```
turn a thing-to-do into a must-do.
```

### intro
```
Cooking classes, horseback rides, tours, day trips, tastings, outdoor adventures. Mingla helps experience and trip organizers turn "that sounds fun" into a booking — matched to the people already looking for exactly this.
```

### steps (exactly 3)

1.
```
title: tell the story
body: Ari helps you turn your experience, trip, or adventure into a page that makes people feel the day before they book it — no full-time marketer required.
```

2.
```
title: match the planner
body: Mingla connects your experience to people planning a weekend, a date, or a day out nearby — matched by vibe, budget, and what they're already after.
```

3.
```
title: book it out
body: They reserve their spot inside Mingla, one all-in price up front — no address typing, no checkout surprise — so "I'll think about it" becomes a confirmed seat.
```

### features (3–4)

1.
```
title: a page that sells the day
body: Your experience, your photos and video, your story — a page that turns "that sounds fun" into "we're booking it," built for the group chat.
```

2.
```
title: matched to real intent
body: Reach the people already planning the kind of day you offer — by vibe, location, timing, and budget — not random clicks you pay for twice.
```

3.
```
title: bookings, built in
body: Take prepaid bookings for classes, tours, and trips right inside Mingla. One all-in price up front means fewer no-shows and no checkout drop-off.
```

4.
```
title: no marketing degree needed
body: You shouldn't need to become a full-time marketer to be found. Ari names your vibe, builds your page, and helps you reach the right people from inside the app.
```

### proof (optional)
```
Your experience has a vibe. Your community is looking for it. Mingla helps them find you.
```

---

# TAB 5 — Pop-ups  *(proposed 5th — recommended)*

> Pop-up chefs, artists, makers, curators, supper clubs, market stalls, independent creators.

**Why add it:** the canonical Business script explicitly includes "creators" and the full experience economy, and the existing approved `audiences.tsx` already ships a "Pop-ups & independent creators" card. A dedicated tab makes the scarcity/timing story land for the one audience whose whole model is "one shot." Strengthens the "whatever you create, Mingla makes it the plan" promise.

### tabLabel
```
Pop-ups
```

### heading
```
land fast. land hard.
```

### intro
```
A pop-up has one shot. Mingla helps chefs, artists, makers, and curators turn concept, scarcity, and timing into something people feel they can't miss — and reach them before the window closes.
```

### steps (exactly 3)

1.
```
title: spin it up
body: Ari builds your page in minutes — concept, drop, and timing — so you can go from idea to live before the moment passes.
```

2.
```
title: reach fast
body: Mingla puts your pop-up in front of the people already hunting for something new nearby, matched by taste and timing, the moment you go live.
```

3.
```
title: sell the drop
body: They claim their spot inside Mingla, all-in price up front — scarcity does the rest, and you sell out the window you've got.
```

### features (3–4)

1.
```
title: live in minutes
body: No website to build, no marketer to hire — Ari turns your concept into a page worth sharing before the moment passes.
```

2.
```
title: found by the curious
body: Reach the people already looking for something new and worth talking about — matched by vibe and timing, not paid impressions.
```

3.
```
title: scarcity that sells
body: All-in checkout built in, so a limited drop becomes a fast sell-out — one price up front, no friction between "I want in" and "I'm in."
```

### proof (optional)
```
One shot. Make it unmissable.
```

---

## Voice + reality compliance notes (for review)

- **Signature lines honored verbatim where used:** "sell the night, not just the ticket" / "be the plan, not the afterthought" / "make your menu the reason" / "turn a thing-to-do into a must-do" / "land fast. land hard." (all from approved `audiences.tsx`); "the businesses with the most soul are the hardest for people to discover" and "you shouldn't need to become a full-time marketer" and "Your business has a vibe. Your community is looking for it. Mingla helps them find you." (canonical Business script, adapted per-audience); "The group chat is where plans go to die" (canonical consumer + approved comparison).
- **Cadence preserved:** short fragments, anaphora, emotion-before-feature, problem → "Mingla turns…" → outcome.
- **No fabricated metrics / SLAs / fee percentages** anywhere in this section. Optional `proof` lines are voice statements, not numbers. The stats band owns hard numbers.
- **Roadmap items in aspirational register only:** "keep the slow nights full," "fill slow nights" framed as outcome, never as a shipped feature spec; no AI-advertising hard claim.
- **Each tab is genuinely tailored:** Venues lean foot-traffic + dashboard + crowd fit; Dining leans menu + taste-match + tables; Events lean sell-the-night + checkout speed + who-showed-up; Experiences lean story + intent-match + bookings + "no marketing degree"; Pop-ups lean speed + scarcity + fast sell-out.
- **Mingla is an experience app, never a dating app.** Dates appear only as one of several occasions.

---

## Implementor handoff fields (flat reference)

| tab | tabLabel | heading |
|---|---|---|
| venues | Venues | turn your room into the plan. |
| dining | Dining | make your menu the reason. |
| events | Events | sell the night, not just the ticket. |
| experiences | Experiences | turn a thing-to-do into a must-do. |
| popups *(proposed)* | Pop-ups | land fast. land hard. |

Section eyebrow: **Built for your kind of place** · Section heading: **pick your world. see your Mingla.**
