# COPY — ORCH-1010 Business Marketing Rewrite (`/organisers`)

**Phase:** 2 of 3 (COPY only — no `.tsx` edits, no design specs, no migrations, no deploys)
**Skill:** `mingla-product` (brand-voice mode)
**Surface:** marketing web — the `/organisers` business surface (`mingla-marketing/components/sections/organiser-home/` + `app/organisers/page.tsx`)
**Date:** 2026-05-30
**Sources of truth:**
- Canonical voice + North Star — `.claude/skills/mingla-product/references/canonical-voice.md` (Business Script "Your Place Deserves to Be Found." + Manifesto "Real Life Is Still the Point." + morph doctrine)
- Competitive landscape — `.claude/skills/mingla-product/references/competitive-landscape.md` (verbatim positioning lines, the 9 arms, the outing-loop moat)
- Reality anchor — `Mingla_Artifacts/WORLD_MAP.md` + operator memory (what is actually shipped vs. vision)

---

## REALITY ANCHOR (read before reading the rewrite)

Every concrete capability claim in PART B is graded against what is actually built. This is non-negotiable per the reality-check protocol and operator memory.

| Capability the copy wants to claim | Reality | Verdict for copy |
|---|---|---|
| Taste/vibe-matched consumer demand (the deck) | **SHIPPED, grade A** — the consumer recommendation engine is the live core app | Claim confidently. This is the moat. |
| Public brand + event pages, cover media, brand theming | **SHIPPED** (`packages/brand-rendering`, public `/b/{slug}` + `/e/...` pages) | Claim confidently. |
| Native all-in checkout (Stripe Connect, brand toggles tax/fee, buyer never types address, all-in upfront price) | **SHIPPED, grade A/B** — Stripe Connect, orders, refunds, disputes, payouts, native PaymentSheet | Claim confidently — and it's a real wedge vs. Eventbrite/POSH. |
| Email blasts / campaigns / audiences (`brand_buyers` + `event_buyers` reach anon + app buyers) | **SHIPPED** — Marketing Hub **Phase A** | Claim — but only **email**. Do NOT say SMS/RCS/push automation. |
| SMS, RCS, push-campaign automation, ads playbook, ads buying, AI optimizer, Mingla Brain | **NOT shipped** (gated phases B–H) | Do NOT market as live. Frame as roadmap or omit. |
| AI that auto-generates push copy / SMS copy / ad campaigns on demand | **NOT shipped** | Omit. Email-composer assist is the only live AI-copy surface; keep AI claims at "helps you shape the story / the page / the email." |
| AI taste-matching of a brand's offer to likely-fit consumers (supply-side feeder → deck) | **NOT shipped** — META-ORCH-1009 REGISTERED + BLOCKED | This is **vision**, not live. The live matching is consumer-side. Frame brand-side matching as the promise/where this is going, never as a delivered metric. |
| Dashboard: orders, buyer list, check-in/scanner | **SHIPPED, grade A/B** (scanner, check-in attribution, order state) | Claim the guest list + check-ins. |
| Dashboard: summarized AI feedback, save/share counts surfaced to brand | **PARTIAL / aspirational** — voice reviews exist consumer-side; brand-facing "summarized feedback + save/share analytics dashboard" is not a proven grade-A surface | Soften to what's real (who showed up, what they bought) — do NOT promise a feedback-summary product. |
| "Performance-based pricing — charged only when Mingla drives a booking/check-in/sale, no flat fees, refunds available" | **FABRICATED** — no such billing system exists | **DELETE.** This is the single most dangerous line on the page. Replace pricing answer with an honest early-partner framing. |
| "First placements go live within a week" | **FABRICATED metric** | **DELETE.** Replace with an honest onboarding description, no invented timeline. |

**Net rule applied throughout PART B:** the page may speak the manifesto's *aspiration* in brand/emotional beats (allowed — it's a brand surface), but every *concrete feature/pricing/timeline claim* is true and grade A/B, or it's cut. No fabricated metrics, no unshipped channels, no invented SLAs.

---

# PART A — Manifesto audit (section by section, render order)

The throughline finding: the current page is **good but generically premium**. It has adopted ONE real Mingla idea ("a reason to show up") and stretched it across nine sections, so the word *reason* and the verb *package* repeat until they go numb. It reaches for the Business Script's soul but never actually lands the sacred signature lines ("Your place deserves to be found," "the businesses with the most soul are the hardest for people to discover," "You shouldn't need to become a full-time marketer," "Where neighborhoods become neighborhoods," "Your business has a vibe. Your community is looking for it. Mingla helps them find you."). It also leans on the canonical-voice doc's *cadence* unevenly, and — critically — the FAQ ships two **fabricated claims** (performance-based pricing, one-week placements) that violate the honesty non-negotiable in `canonical-voice.md` (§"Non-negotiables 5. Honesty"). And it almost entirely omits the experience-economy inclusion rule — cooking classes, horseback riding, tours, day trips, adventures — that the Business Script makes mandatory.

| # | Section | Verdict | What's wrong | What the section must accomplish |
|---|---|---|---|---|
| 1 | `hero.tsx` | **On-voice but under-powered** | Headline "we give people a reason to show up for you" is strong and IS the business North Star — keep it. But the subhead is a feature-list run-on ("label the vibe, shape the story, highlight what matters, and match you…") that opens with mechanics, violating "emotion over feature-listing" (`canonical-voice.md` non-negotiable #3). The closing micro ("Not just listings. Not just ads.") is good and should survive. CTA "Partner with Mingla" is fine. | Land the emotional promise in ONE breath, anchored to the sacred line "Your place deserves to be found." Make the reader (a venue owner) feel seen in the first 6 seconds. Feature mechanics belong later. |
| 2 | `what-mingla-does.tsx` | **On-voice, strongest section** | The "The food. The room. The crowd…" litany is the most Mingla-feeling moment on the page — pure canonical cadence (anaphora, fragments, emotional build). Keep the structure. Only weakness: the bookend prose over-uses "package… reason… care" and never names the experience economy. | Define WHAT Mingla sells in human terms: not your listing, the *reason* people pick you. Keep the litany. Tighten the bookends and quietly widen the world (a tour, a class, a trip — not only a room). |
| 3 | `how-it-works.tsx` | **Weak / generic-AI-slop risk** | The 4 steps are abstract and process-y ("tell us what you have → mingla finds the reason → we match → you get action"). Step 2 "Our AI labels the vibe, surfaces what makes it desirable, shapes the message" over-promises an AI that doesn't yet auto-package supply-side (META-ORCH-1009 not shipped). Reads like every AI-startup "how it works." | Show the actual journey from a real owner's POV in concrete, true steps. Anchor to the manifesto pivot ("That's why we built Mingla Business"). Keep AI claims to what's real (helps shape your page/story/email), promise the matching as the engine without claiming an auto-generator that isn't built. |
| 4 | `audiences.tsx` ("Built for") | **On-voice but incomplete + repetitive** | Five strong cards (restaurants, bars, venues, events, pop-ups) — but every title is "turn your X into Y" and every body ends on "reasons people…", which by the fourth card is formula. **Critical miss:** the canonical Inclusion Rule (experience/trip/adventure organizers — cooking classes, horseback riding, tours, day trips) is absent. The Business Script REQUIRES they feel explicitly included. | Show the venue owner / organizer "that's me." Keep five cards but break the title formula, and ADD/expand so experience + trip + adventure organizers are explicitly named (per `canonical-voice.md` Inclusion Rule). |
| 5 | `why-mingla.tsx` | **On-voice, keep the device** | The "they don't just want 'a restaurant' → they want somewhere cute but not too loud" generic→specific pairs are excellent and very on-brand (this is literally the consumer wedge: "you know the vibe but not the venue," seen from the supply side). Closing line "Mingla turns those feelings into discovery" is good. | Explain the *insight* that makes Mingla different: people choose feelings before categories — so being listed isn't enough; being *understood* wins. Keep the pairs, refresh two, sharpen the close. |
| 6 | `comparison.tsx` ("Mingla vs the rest") | **On-voice but soft + missing the verbatim kill-shots** | The Listings/Ads/Ticketing/Social-posts contrast is the right idea, but it's written in-house and ignores the **canonical verbatim positioning lines** in `competitive-landscape.md` ("Eventbrite sells the ticket. Mingla sells the night.", "They market to customers you already have. Mingla finds the people looking for a place like yours right now.", "The group chat is where plans go to die."). Those lines are sharper than anything currently here. | Draw the bright line: listings/ads/ticketing/CRM each own one slice; Mingla owns the whole outing loop. Use the canonical verbatim lines — they're our best ammunition and they're approved. |
| 7 | `features.tsx` | **Mixed — partly off-reality** | Seven features. "vibe labeling / ambience positioning / menu storytelling / event packaging" are fine framed as what the platform helps you express. But "campaign creation: generate… push copy, email copy, audience angles" overstates (only **email** is shipped via Phase A — push/SMS gen is not), and "audience matching" + "performance learning" imply a supply-side AI + analytics product that isn't grade-A yet. Header "AI that packages your business for demand" leans hard on unshipped auto-packaging. | Make the capability list concrete and TRUE: a beautiful brand/event page, native all-in checkout, email campaigns to people who already bought from you, a guest list + check-ins, and taste-matched discovery as the engine. Cut/soften the unshipped AI-autopilot framing. |
| 8 | `faq.tsx` | **OFF-VOICE + TWO FABRICATED CLAIMS (P0)** | (1) **Pricing answer is fabricated** — "performance-based, charged when Mingla drives a booking/check-in/sale, no flat fees, refunds available." No such billing exists. (2) **"First placements within a week"** — invented SLA/metric. Both violate `canonical-voice.md` honesty non-negotiable. Other answers are decent but "Mingla's AI reads your menu, room… matches them to people" again implies the unshipped supply-side matcher as live. Tone is also flatter/more corporate than the rest of the page. | Answer real objections honestly, in Mingla voice, with zero invented pricing or timelines. Reframe pricing as honest early-partner language. Reframe "results" without a fake SLA. Keep matching framed as the engine, not a delivered per-brand metric. |
| 9 | `cta.tsx` | **On-voice but generic close** | "create the reason. Mingla brings it to the right people." is fine, and the audience roll-call is good (but again omits experience/trip organizers). The closer doesn't land the single most powerful sacred line available: "Your business has a vibe. Your community is looking for it. Mingla helps them find you." | Convert. End on the sacred Business signature line — it's the strongest sentence we own and it belongs on the final CTA. Include the full experience demographic. |
| — | `page.tsx` metadata | **On-voice but inherits hero's run-on** | Title is good (uses the North Star line). Description repeats the hero's feature-list run-on and the same "label the vibe, shape the story" mechanics-first phrasing. | Premium, search-legible, emotion-first meta that uses the sacred line and reads like Mingla, not like a feature list. |

---

# PART B — Full rewrite (section by section, render order)

> Implementor/designer note: this preserves each section's **structural role** (eyebrow, headline w/ `text-warm` accent span, subhead, list/grid items, CTA). Only the WORDS change. The `<br className="hidden md:block" />` line-break points are preserved where they exist. Sacred signature lines from `canonical-voice.md` are marked **[SACRED]** and must ship verbatim.

---

## 1. HERO — `hero.tsx`

**Section job:** In one breath, make a venue/experience owner feel seen and state the business North Star. Emotion first; mechanics later.

- **Eyebrow:** *(none — hero has no eyebrow today; keep it that way)*
- **Headline** (keep current line break; second line is the `text-warm` accent):
  > we give people a reason
  > **to show up for you.**
  *(KEEP — this is the canonical Business North Star "we give people a reason to show up for you." Do not change.)*

- **Subhead** (replace the feature run-on — lead with the human truth, then one clean line of what Mingla does):
  > The businesses with the most soul are the hardest for people to find. Mingla changes that. We take what makes your place, event, or experience special — the vibe, the story, the night people will actually remember — and put it in front of the people already looking for exactly that.

  *(Opens on the **[SACRED]** line "the businesses with the most soul are the hardest for people to discover" — morphed to "find" to fit the hero's verb, per morph doctrine. Emotion before feature.)*

- **Primary CTA button:** `Partner with Mingla` *(KEEP)*
- **Secondary (PlayTile):** label stays `Watch · See how Mingla works` *(KEEP — copy in component is fine; runtime length `2:14` is a design/asset concern, not copy)*

- **Closing microcopy** (under the buttons — keep the structure, sharpen):
  > Not just a listing. Not just an ad. **A reason people choose you.**
  *(KEEP the spirit; singular "a listing / an ad" reads tighter than the current plural.)*

---

## 2. WHAT MINGLA DOES — `what-mingla-does.tsx`

**Section job:** Define what Mingla actually sells — not your listing, the *reason* people pick you. Keep the litany (the page's best moment).

- **Eyebrow:** `What Mingla does` *(KEEP)*
- **Headline** (keep break; `you special.` is the `text-warm` accent):
  > we sell what makes <br>
  > **you special.**
  *(KEEP — it's clean, true, and on-voice.)*

- **Intro subhead** (tighten, widen the world quietly):
  > Nobody chooses a place, an event, or an experience because it exists. They choose it because something about it feels worth showing up for.

- **The litany** (the emotional core — keep the anaphora, refresh two lines so it spans the full experience economy, not only a room):
  > The food.
  > The room.
  > The crowd.
  > The music.
  > The host who remembers your name.
  > The view from the trail.
  > The class you can't stop talking about.
  > The story only you can tell.
  > The *"we should go there"* moment.

  *(Adds the experience-economy texture — the trail, the class, the host — per the Inclusion Rule, without breaking the cadence. "The host who remembers everyone's name" is itself a near-quote of the Business Script.)*

- **Closing line** (keep AI claim honest — "shape," not "auto-generate"):
  > Mingla helps you name that reason, shape it into a page and a plan people understand instantly, and put it in front of the people most likely to care.

---

## 3. HOW IT WORKS — `how-it-works.tsx`

**Section job:** Show the real journey from an owner's chair, in true steps, with the manifesto pivot. Keep AI claims to what's shipped.

- **Eyebrow:** `How it works` *(KEEP)*
- **Headline** (keep break; `to real demand.` is `text-warm`):
  > from what you have <br>
  > **to a full room.**
  *(Morphs toward the Manifesto sacred beat "More businesses with full rooms." — sharper and more emotional than "to real demand," and it's true to the outcome.)*

- **The 4 steps** (replace abstract process with concrete, true steps):

  | n | title | body |
  |---|---|---|
  | 01 | `show us what you've got` | Your place, your menu, your event, your trip, your class, your pop-up — whatever you want people to show up for. |
  | 02 | `we make it impossible to ignore` | We turn it into a page and a story people get in seconds: the vibe, the details that matter, the reason it's worth leaving the house for. |
  | 03 | `we put it in front of the right people` | Mingla matches what you offer to people nearby by taste, mood, timing, budget, and what they're already planning — not just who's close, but who actually wants this tonight. |
  | 04 | `they show up — and you can sell them the night` | People discover you, save you, and book or buy right there. Sell tickets, packages, and tables with all-in pricing and no checkout surprises — then watch who came through the door. |

  *(Step 02 stays honest — "we make it" = the platform helps you build it, no claim of a fully-automatic AI packager. Step 03 frames matching as the engine — true on the consumer side, which is where matching is live. Step 04 markets the **shipped** native all-in checkout + guest-list/check-in backbone — real grade-A/B claims.)*

---

## 4. AUDIENCES ("Built for") — `audiences.tsx`

**Section job:** Make the reader say "that's me." Break the title formula. Honor the Inclusion Rule — experience/trip/adventure organizers must be explicitly named.

- **Eyebrow:** `Built for` *(KEEP)*
- **Headline** (keep break; `Mingla makes it the plan.` accent):
  > whatever you create, <br>
  > **Mingla makes it the plan.**
  *(Swaps "packages it" → "makes it the plan" — ties to the consumer promise "Find the plan that fits the vibe," and breaks the over-used "package" verb.)*

- **The cards** (6 cards — five refreshed + one NEW experience-economy card per the Inclusion Rule):

  | eyebrow | title | body | cta |
  |---|---|---|---|
  | `Restaurants & cafés` | `make your menu the reason.` | The handmade pasta. The patio at golden hour. The cocktail only your bartender can make. Mingla turns your menu, your room, and your best nights into something people book a table for. | `Fill more tables` |
  | `Bars, clubs & nightlife` | `give people a night they brag about.` | The DJ. The sound. The room when it's full. The thing everyone wants to be in. Mingla turns your energy into a crowd that shows up — and comes back. | `Build the crowd` |
  | `Venues & activity spaces` | `be the plan, not the afterthought.` | A date. A birthday. A team night. A weekend ritual. Mingla shapes your space and packages into plans people actively choose — and pay for up front. | `Sell more group plans` |
  | `Events & promoters` | `sell the night, not just the ticket.` | A flyer says what's happening. Mingla says why it matters — the lineup, the crowd, the culture, the timing — and lets people buy in seconds. | `Sell out your event` |
  | `Experiences, trips & adventures` | `turn a thing-to-do into a must-do.` | Cooking classes, horseback rides, tours, day trips, tastings, outdoor adventures. Mingla helps experience and trip organizers turn "that sounds fun" into a booking — matched to the people already looking for exactly this. | `Book out your experience` |
  | `Pop-ups & independent creators` | `land fast. land hard.` | A pop-up has one shot. Mingla helps chefs, artists, makers, and curators turn concept, scarcity, and timing into something people feel they cannot miss. | `Launch your pop-up` |

  *(The new "Experiences, trips & adventures" card discharges the canonical Inclusion Rule directly — cooking classes, horseback riding, tours, day trips, outdoor adventures, verbatim from the Business Script. Every title now varies; the "package" verb is retired across cards.)*

---

## 5. WHY MINGLA — `why-mingla.tsx`

**Section job:** Reveal the insight — people choose feelings before categories, so being *listed* loses to being *understood*. Keep the generic→specific device.

- **Eyebrow:** `Why Mingla` *(KEEP)*
- **Headline** (keep break; `feelings before categories.` accent):
  > because people choose <br>
  > **feelings before categories.**
  *(KEEP — this is genuinely sharp and it's the supply-side mirror of the consumer North Star.)*

- **The pairs** (keep five, refresh two, keep the generic→specific structure):

  | generic | specific |
  |---|---|
  | they don't want *"a restaurant."* | they want somewhere cute, where they can actually hear each other. |
  | they don't want *"an event."* | they want a night worth leaving the house for. |
  | they don't want *"a class."* | they want a plan that feels fun, useful, or a little bit theirs. |
  | they don't want *"a trip."* | they want the story they'll tell for years. |
  | they don't want *"a bar."* | they want the right energy, with the right people. |

  *(Swapped the "market → weekend ritual" pair for a "trip → story" pair to keep reinforcing the experience-economy widening; refreshed two specifics for sharper, more human phrasing.)*

- **Closing line** (keep break; `into demand.` accent — make it land harder):
  > Mingla turns those feelings <span>**into demand.**</span>
  *(Tightens "into discovery" → "into demand" to match the business North Star "measurable demand." Keep the `text-warm` accent on the last two words.)*

---

## 6. COMPARISON ("Mingla vs the rest") — `comparison.tsx`

**Section job:** Draw the bright line — everyone else owns one slice of the outing loop; Mingla owns the whole loop. Use the **canonical verbatim positioning lines**.

- **Eyebrow:** `Mingla vs the rest` *(KEEP)*
- **Headline** (keep break; second line `text-warm`):
  > they show people your business. <br>
  > **Mingla shows them why they'd love it.**
  *(Morph of the canonical vs-Google line "They show you everything nearby. Mingla shows you what fits tonight." — recast to the business POV.)*

- **The contrast cards** (4 cards — now powered by the verbatim positioning lines from `competitive-landscape.md`):

  | category | generic (struck-through) | Mingla |
  |---|---|---|
  | `Listings` | tell people you exist. | sells why you're worth choosing tonight. |
  | `Ticketing` | sells the ticket. | sells the night. |
  | `Ads` | chase customers you have to pay for again and again. | finds the people already looking for a place like yours. |
  | `The group chat` | is where plans go to die. | is where they get picked. |

  *("Ticketing → sells the ticket / sells the night" = verbatim canonical Eventbrite line. "Ads" line = morph of the canonical Toast/Popmenu/Owner line "They market to customers you already have. Mingla finds the people looking for a place like yours right now." "The group chat is where plans go to die. Mingla is where they get picked." = verbatim canonical vs-group-chats line. Replaces the soft in-house "social posts disappear" card with our sharpest approved ammunition.)*

---

## 7. FEATURES — `features.tsx`

**Section job:** Make the capability list concrete and TRUE — what you actually get, all grade-A/B. Cut the unshipped AI-autopilot framing.

- **Eyebrow:** `What you get` *(replaces "What Mingla does for you" — more direct)*
- **Headline** (keep break; `that fills the room.` accent):
  > everything you need to turn a vibe <br>
  > into a booking — **and a full room.**
  *(Replaces "AI that packages your business for demand" — which leans on the unshipped supply-side AI packager — with an outcome-true headline.)*

- **The feature cards** (6 cards — every one is shipped/grade-A-B; reordered to lead with the most concrete):

  | title | body |
  |---|---|
  | `a page worth sharing` | A beautiful, on-brand page for your place, event, or experience — your colors, your photos and video, your story. The page people actually want to send to the group chat. |
  | `taste-matched discovery` | Your offer reaches people by vibe, taste, location, timing, budget, and what they're already planning — not just who's nearby, but who's looking for exactly this tonight. |
  | `all-in checkout, built in` | Sell tickets, tables, and packages right inside Mingla. One all-in price up front, no address typing, no checkout surprises — buyers see the full cost before they pay. |
  | `email your real customers` | Send campaigns to the people who actually bought from you or your events — no list to build, no extra tool to learn. They're already there. |
  | `know who showed up` | Your dashboard shows the guest list, check-ins, and what sold — so you finally know which nights, offers, and crowds are working. |
  | `tell your vibe in plain words` | Name the energy people should expect — cozy, lively, romantic, late-night, family-friendly, high-energy, intimate — so the right people self-select in, and the wrong fit self-selects out. |

  *(REALITY-ANCHORED: "page worth sharing" = shipped brand-rendering. "taste-matched discovery" = shipped consumer engine. "all-in checkout" = shipped native Stripe checkout + tax/fee toggles. "email your real customers" = shipped Marketing Hub Phase A (`brand_buyers`/`event_buyers`). "know who showed up" = shipped scanner/check-in/orders. "tell your vibe" = vibe labeling, real. **Dropped:** "campaign creation: generate push/email/audience copy" (push/SMS not shipped), "performance learning" analytics-product framing, and standalone "ambience/menu/event packaging" cards that overlapped with the page card. No unshipped channel survives.)*

---

## 8. FAQ — `faq.tsx`

**Section job:** Answer real objections honestly, in Mingla voice, with ZERO fabricated pricing or timelines. This section carried the two P0 honesty violations — both are removed.

- **Eyebrow:** `Common questions` *(KEEP)*
- **Headline:** `before we get on a call.` *(KEEP — it's warm and on-voice.)*

- **The Q&A** (8 items):

  1. **Q:** How does Mingla decide who to show your place to?
     **A:** Mingla learns what people are in the mood for — the vibe, the timing, the budget, the kind of night they're planning — and surfaces the places and events that actually fit. The match isn't "they're nearby." It's "this is the one they've been looking for."

  2. **Q:** What kinds of businesses is Mingla for?
     **A:** Restaurants, bars, cafés, clubs, activity venues, galleries, comedy clubs, taprooms, markets, ticketed events and pop-ups — and the whole experience economy: cooking classes, horseback rides, tours, day trips, tastings, and outdoor adventures. If people gather to do a thing, Mingla is for you.

  3. **Q:** How is this different from a listing or an ad?
     **A:** A listing says you exist. An ad rents you attention for a moment. Mingla shows people *why you're worth choosing tonight* — your vibe, your story, the reason — and puts it in front of people whose plans already fit. You're not buying impressions. You're getting found by the right people.

  4. **Q:** Do I have to build everything myself?
     **A:** No. You bring the raw material — your photos, your menu, your event, your experience — and Mingla helps you shape it into a page and a story people understand instantly. The heavy lifting of getting discovered is on us.

  5. **Q:** Can people actually book and pay through Mingla?
     **A:** Yes. Sell tickets, tables, and packages with checkout built right in — one all-in price up front, no address typing, no surprise fees at the end. You choose whether to pass on taxes and fees or absorb them; buyers always see the real total before they pay.

  6. **Q:** Can I see who showed up?
     **A:** Yes. Your dashboard shows the guest list, check-ins, and what sold — so you know which nights, offers, and crowds are working, and can do more of what does.

  7. **Q:** Can I reach my own customers, too?
     **A:** Yes. Mingla can send email campaigns to the people who've already bought from you or your events — no list to build, no separate tool. The audience is already there; you just hit send.

  8. **Q:** Does Mingla replace my other marketing?
     **A:** No — it makes the rest of it work harder. Your menu, your vibe, your events, your story become reasons people choose you. Keep your other channels; Mingla is the layer that turns all of it into people actually showing up.

  *(**DELETED:** the fabricated "performance-based pricing / charged when Mingla drives action / no flat fees / refunds available" answer AND the fabricated "first placements within a week" answer. **Q5 + Q7** now market only **shipped** capabilities — native all-in checkout with tax/fee toggles, and Marketing Hub Phase A email. **Q1** keeps matching framed as the live consumer-side engine, no per-brand metric. If Seth wants a pricing question on the page, that copy must wait until a billing model is decided — flagged below.)*

---

## 9. CTA — `cta.tsx`

**Section job:** Convert — and end on the strongest sentence Mingla owns.

- **Eyebrow:** `Ready to give people a reason?` *(KEEP — on-voice.)*
- **Headline** (keep break; second line `text-warm`):
  > your business has a vibe. <br>
  > **your community is looking for it.**
  *(**[SACRED]** — the canonical Business signature line "Your business has a vibe. Your community is looking for it. Mingla helps them find you." split across the headline + the line below.)*

- **Body** (roll-call with the full demographic, then the sacred close):
  > Restaurants, bars, venues, events, pop-ups, and the people behind every experience, trip, and adventure — Mingla takes what makes you special and puts it in front of the people already looking for it. **Mingla helps them find you.**

  *(Completes the **[SACRED]** line. Roll-call now explicitly includes experience/trip/adventure organizers per the Inclusion Rule.)*

- **Primary CTA button:** `Partner with Mingla` *(KEEP)*

---

## PAGE METADATA — `app/organisers/page.tsx`

- **`title`:**
  > `Mingla Business — we give people a reason to show up for you.`
  *(KEEP — it's the North Star line and it's search-legible.)*

- **`description`** (replace the feature run-on; emotion-first, uses the sacred line, premium):
  > `The businesses with the most soul are the hardest to find. Mingla Business changes that — we take what makes your place, event, or experience special and put it in front of the people already looking for exactly that. Your business has a vibe. Your community is looking for it. Mingla helps them find you.`

  *(Opens on the **[SACRED]** "businesses with the most soul are the hardest to discover" beat and closes on the **[SACRED]** "Your business has a vibe…" line — both verbatim/morphed-faithful, no unshipped feature claims, ~250 chars.)*

---

# PART C — Voice rationale (for the designer's Phase 3)

The throughline is **"the reason to show up,"** told from the heart of the canonical Business Script — empathy for the owner with the most soul and the least time, who shouldn't have to become a full-time marketer to be found. The whole page should feel like the manifesto's arc: a warm, human *problem* ("the businesses with the most soul are the hardest for people to find"), the *pivot* ("that's why we built Mingla Business"), and an *uplift* that ends on a full room. Cadence is the personality layer — short lines, anaphora, fragments, an emotional build before any mechanic, never a feature dumped cold — so the design should give the litany section (What Mingla Does) and the sacred CTA line room to breathe like quiet, confident statements rather than marketing copy. Every concrete claim is now real (a beautiful page, taste-matched discovery, native all-in checkout, email to real buyers, a guest list) so the visuals can show actual product surfaces with confidence instead of abstract "AI" gloss. And the experience economy — classes, trips, adventures — is woven through the audiences and FAQ, so Phase 3 should picture more than restaurant tables: a trail, a tasting, a sold-out night. Premium here means *restraint and warmth*, not gradients and jargon — the page should feel like it was written by someone who loves local places, because it was.

---

## Flags for the orchestrator (not copy — coordination)

1. **Pricing question removed from FAQ.** The page no longer states any price or billing model, because none is built (the old "performance-based" answer was fabricated). If Seth wants pricing on the page, that's a separate decision + ORCH once a billing model exists — do NOT let Phase 3 re-introduce an invented price.
2. **No unshipped channels marketed.** SMS/RCS/push automation, ads, and Mingla Brain are deliberately absent. If a future copy pass wants them, gate on those phases actually shipping.
3. **Supply-side AI matching is framed as the engine, never as a delivered per-brand metric** (META-ORCH-1009 not shipped). The live, claimable matching is consumer-side. Keep it that way until 1009 ships.
