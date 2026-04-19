# Mingla Vibe Engine — Vibes v0.3

**Status:** Exploratory / testing concept
**Last updated:** 2026-04-18
**Owner:** Seth

---

## What a "vibe" is

A **vibe** is a single-word filter that describes the *feeling* of a place rather than its type. Types answer "what is this?" (bar, restaurant, museum). Vibes answer "what will it feel like when I walk in?" (intimate, loud, iconic).

Vibes are the fastest way for three very different users to find themselves on the same screen:
- **Friend groups** coordinating plans want energy and shape ("lively", "play", "boozy").
- **Couples** planning a date want emotional texture ("romantic", "cozy", "first meet").
- **Solo explorers** new to a city want orientation and safety ("hidden gem", "solo-welcoming", "iconic").

A good vibe list is short, mutually exclusive where it matters, and emotionally legible at first read. No one should need a tooltip to pick one.

---

## The 20 Vibes

### Mood & Energy (how it feels inside)
1. **Romantic** — soft lighting, slow pace, the kind of place where you lean in across the table. Candles, velvet, low music, a wine list you linger over.
2. **Sexy** — sultry, flirty, a little dangerous. Dim lights, a bass line you feel in your chest, someone across the room catching your eye.
3. **Cozy** — warm, unpretentious, soft edges. Sweater weather inside. Wood, candles, a fireplace, a mug you want to hold.
4. **Lively** — buzzing, social, a little loud. Laughter carries across the room, tables are close, the energy pulls you in.
5. **Chill** — low-key, easy, come-as-you-are. No dress code in the air, no reservation required. You can stay two minutes or two hours.
6. **Upscale** — elevated, polished, dress-up-for-it. Fewer words on the menu, heavier glassware, a decimal on the bill you feel.

### Time & Meal (when it happens)
7. **Brunch** — weekend-morning energy. Eggs, coffee, something sparkling, sunlight through big windows. 10am–2pm.
8. **Dinner** — the main event of the evening. 7pm-onward, sit-down, order a few things, stay a while.
9. **Late-Night** — after-10pm territory. Dim, loose, a little unpredictable. Kitchens still open, music turned up.

### Setting (what's outside the window)
10. **Rooftop** — open air and skyline. The view is the main course, the drink is an accessory.
11. **Nature** — trees, water, open space. Parks, trails, gardens, beaches, waterfronts. Where the phone goes in the pocket and the city fades out.

### Activity (what you're *doing*)
12. **Creative** — make something with your hands. Pottery, paint-and-sip, candle-making, a workshop you leave with something from.
13. **Theatre & Arts** — live performance, galleries, exhibitions. Culture you sit with, not scroll past.
14. **Movies** — cinema of any shape. Indie screening, IMAX blockbuster, drive-in, rooftop film night.
15. **Play** — active fun. Bowling, arcade, go-karts, mini-golf, board-game café, escape room. Also the natural icebreaker — an activity so conversation flows around something.

### Social Shape (who it's for)
16. **First Meet** — built for meeting someone for the first time. Easy to find, easy to leave, conversation-friendly, not too intimate, not too loud. A safe landing for a first date or a friend-of-a-friend hang.
17. **Solo-Welcoming** — bar seating, no-judgment energy, staff that won't ask if you're "waiting for someone." A book, a laptop, or a plate for one all welcome.

### Discovery & Signal (why you'd pick it)
18. **Hidden Gem** — off the tourist map, locals-only, the kind of place you have to be told about. A small win just to have found it.
19. **Iconic** — the must-see, the bucket-list, the place that defines the neighborhood. If you just moved here, go once.

### Flavor
20. **Boozy** — cocktails are the point. A serious drink program, a bartender who asks questions, a menu that reads like a novella.

---

## How these serve each audience

| Vibe | Friend Groups | Couples | Solo Explorers |
|------|:---:|:---:|:---:|
| Romantic | | ★ | |
| Sexy | ★ | ★ | |
| Cozy | ★ | ★ | ★ |
| Lively | ★ | | |
| Chill | ★ | ★ | ★ |
| Upscale | | ★ | |
| Brunch | ★ | ★ | ★ |
| Dinner | ★ | ★ | ★ |
| Late-Night | ★ | ★ | |
| Rooftop | ★ | ★ | ★ |
| Nature | ★ | ★ | ★ |
| Creative | ★ | ★ | ★ |
| Theatre & Arts | ★ | ★ | ★ |
| Movies | ★ | ★ | ★ |
| Play | ★ | ★ | |
| First Meet | | ★ | |
| Solo-Welcoming | | | ★ |
| Hidden Gem | ★ | ★ | ★ |
| Iconic | ★ | | ★ |
| Boozy | ★ | ★ | |

**Universal anchors (all three audiences):** Cozy, Chill, Brunch, Dinner, Rooftop, Nature, Creative, Theatre & Arts, Movies, Hidden Gem. Ten vibes carry every persona — if you need to ship a smaller first pass, start here.

**Audience-exclusive signals:**
- Solo explorers own: **Solo-Welcoming**
- Couples own: **Romantic, Upscale, First Meet**
- Friend groups own: **Lively**
- Everything else is shared, which is the point — vibes should connect audiences, not wall them off.

---

## What we cut from v0.2 (30 → 20) and why

| Cut | Absorbed by | Reason |
|-----|-------------|--------|
| Intimate | Romantic + Cozy | Overlap too heavy; pick the more legible word |
| Casual | Chill | Two words for the same feeling |
| Dive | Chill + Boozy | Edge case; loses to more universal vibes |
| Lunch | Brunch + Dinner | Least distinctive meal slot; most "lunch" is just "casual daytime" |
| Scenic | Rooftop + Nature | Split cleanly into urban-view vs. outdoor-green |
| Group-Friendly | Lively + Play + Boozy | Friend groups infer from energy/activity vibes |
| Conversation-First | Cozy + First Meet | Implied by both; doesn't earn its own slot |
| Icebreaker | Play + First Meet | Play IS the icebreaker mechanism |
| Date-Worthy | Romantic + Upscale | Together they signal "this will impress" |
| Instagrammable | Rooftop + Iconic + Creative | These three already capture the photo-worthy places |

---

## Open questions for the test

1. **How many vibes can a user pick at once?** One (decisive, fast) vs. multi-select (expressive, slower)?
2. **Are vibes additive or subtractive?** Do they narrow the deck or reweight it?
3. **Should some vibes be time-aware?** "Brunch" only shows before 2pm. "Late-Night" only shows after 9pm.
4. **Do users see vibes on cards?** A place tagged `Cozy • Hidden Gem • First Meet` as social proof.
5. **How do vibes get assigned to places?** Rules from Google types + name + reviews? AI classification? Admin curation?
6. **Does a place have a hard cap on vibes?** e.g. max 4 so the signal stays strong.

---

## Candidates parked for v0.4 (if test signals demand more)

- **Live Music** — where a performance is the draw, not the drink.
- **Wellness** — spa, sauna, yoga, hot springs.
- **Dancing** — a dance floor that's actually used.
- **Sporty** — watch-a-game bars, pickleball, climbing gyms.

---

## Next steps (if the test resonates)

- Spec a prototype filter surface — single-select chip bar above the deck, or multi-select sheet.
- Define the assignment rules (likely deterministic-first, AI-assisted second, per the categorizer pattern).
- Pick 5–8 vibes for a first A/B — don't ship all 20 at once.
- Measure: swipe-through rate, save rate, and schedule rate with vs. without vibe filter active.
