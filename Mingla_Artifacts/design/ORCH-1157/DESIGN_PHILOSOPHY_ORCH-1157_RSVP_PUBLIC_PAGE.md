# ORCH-1157 — Public RSVP Event Page · Design Philosophy + Mockups

**Status:** DESIGN EXPLORATION (no product code). For Seth to open in a browser and react to.
**Benchmark:** Partiful. **Family:** Mingla Direction-A public-page system (ORCH-1138).
**Constitution rule 9:** real-data-only — the philosophy maps to fields we actually store. The
mockups use clearly-labeled SAMPLE content, but no affordance is shown that we do not persist.

---

## 1. The core insight — an RSVP page is NOT a ticket page

The current public RSVP body (`mingla-business/src/components/event/RsvpPublicBody.tsx`) is a
*subtraction* of the ticketed event page: same parallax cover, same body chrome, ticket tiers
removed and a Going/Maybe/Can't card dropped in. It is correct and coherent — but it inherits the
**transactional posture** of a page whose job is *price → checkout*. An RSVP has no price and no
checkout. Its job is the opposite emotional arc:

| Ticketed page | RSVP page |
|---|---|
| Reduce friction to **pay** | Build **anticipation** to *show up* |
| Social proof = scarcity ("42 left") | Social proof = momentum ("38 going") |
| Hero = price + Reserve | Hero = the **decision** (Going / Maybe / Can't) |
| Tone = trustworthy, all-in, no surprises | Tone = hype, casual, text-native, "you're invited" |
| Theme = restrained brand accent | Theme = expressive, per-event vibe |

So the RSVP page **may diverge** to be more expressive — it is social, not commercial — while still
reusing the Direction-A chrome (X · Share fixed buttons) and the brand-theming engine so it reads as
a Mingla sibling.

---

## 2. The real-data information model (what we can actually show)

Evidence: `RsvpPublicBody.tsx` (`RsvpPublicConfig`), `packages/event-rendering/types.ts`
(`PublicEventProps` / `PublicBrandProps`), `supabase/migrations/20261004000000_orch_1150_rsvp_events.sql`,
`supabase/functions/public-submit-rsvp/index.ts`.

### Fields that EXIST → can be on the page
| What | Field(s) | Notes |
|---|---|---|
| Cover | `coverMediaUrl` + `coverMediaType` (image/video/gif) + `coverHue` | hue = no-media fallback |
| Title | `event.name` | |
| Host identity | `brand.displayName`, `brand.slug`, `brand.photo` (avatar) | photo nullable |
| Single date+time | `event.dateLine`, `event.dateSubline` | one date — RSVP is single-date |
| Location | `event.venueName`, `event.address`, `event.format` (online/in-person) | normalize → City, Country |
| Description | `event.description` | |
| **Party type(s)** | `party_types[]` (canonical) | birthday-party, rooftop-party, club-night, house-party, warehouse-party, beach-party, pool-party, boat-party, themed-party, corporate-event, graduation-party, holiday-party, networking-event, rave, festival → **vibe chips** |
| **Going count** | `config.goingCount` | = SUM(1+plus_count) WHERE going AND approved. The headline social-proof number. |
| Capacity / spots-left | `config.capacity` (nullable) → derive `spotsLeft = capacity − goingCount` | null = unlimited |
| Waitlist state | `config.waitlistEnabled` + capacity-full | drives "Join waitlist" |
| Approval | `config.manualApproval` | "host approves each guest" |
| Plus-ones | `config.allowPlusOnes`, `config.plusOnesMax` | the +N stepper |
| Discoverability | `rsvp_discoverable` | host control; affects whether it lists publicly (not a page element) |
| Brand theming | `brand.theme` / `themeOverrides` → accent + font + light/dark palette | the expression engine |
| Guest's own state | submit returns `status` × `approvalStatus` | drives going / pending / waitlisted / maybe |

### Fields that DO NOT exist → MUST NOT be faked (the real-data gaps vs Partiful)
- **Guest list of NAMES / avatars (public).** `event_rsvps` stores `guest_name/email/phone`, but RLS
  exposes only the caller's own row; there is **no public read** of who's going. We store **no guest
  avatar** column at all. → We can show the *count* and an *anonymous* avatar motif, never real
  names/faces. This is the single biggest Partiful affordance we cannot honestly replicate.
- **Maybe-count (public).** "maybe" is tracked per-guest but `goingCount` is the only public tally;
  there is no public `maybeCount`. → Don't show a separate "X maybe" number.
- **Waitlist-count (public).** Tracked internally for the host; not exposed publicly. → Show waitlist
  *state* ("Join the waitlist"), not a number.
- **Comments / photos / reactions / message threads.** No schema. → Not shown.

**Design consequence:** social proof is carried by the **going COUNT + a capacity momentum meter +
an abstract (faceless) avatar cluster that is explicitly a count, not identities.** This is honest
and still feels alive. If we ever add an opt-in public guest list, every direction below reserves the
exact slot for it (the avatar cluster upgrades in place).

---

## 3. The philosophy (six principles)

1. **Lead with the vibe, not the logistics.** Expressive cover + bold oversized title + host, with a
   per-event theme (accent + font + party-type energy). The first screen should feel like an
   invitation, not a form.
2. **The decision IS the hero.** Going / Maybe / Can't is the single unmissable action — large, in
   the thumb zone on phone, sticky-docked, the loudest element on the page. Everything else is
   support.
3. **Momentum is the social proof we own.** "38 going" + a capacity momentum meter + an anonymous
   avatar cluster (count, not names — honest to our data). Scarcity language is for tickets; RSVP
   speaks in *momentum* ("filling up", "spots left").
4. **Logistics are clear but secondary.** Date, City/Country, description, party-type chips read at a
   calm second tier — present, scannable, never competing with the cover or the CTA.
5. **Honesty over hype-theater.** Waitlist, approval, capacity-full, plus-ones are surfaced plainly.
   No fake guest faces, no invented "12 people commented." Every state (open / full / waitlist /
   pending / going / maybe / not-going / submitting / error) has a designed, non-dead-end resolution
   — inherited from the current body's state machine.
6. **One Mingla family, louder dialect.** Reuse Direction-A chrome (fixed X · Share), the brand
   theming engine, City/Country normalization, and the Android opaque-glass policy — but turn the
   expression up: gradients, glow, kinetic-implied energy, heavier display type.

### Phone → desktop adaptation
- **Phone (≤1023px):** parallax/fixed cover, body slides up and over; the RSVP decision **floats then
  docks** flush at the base (thumb zone), mirroring the ticket page's float→dock reserve bar.
- **Desktop (≥1024px):** two-column. Scrolling content (cover caption, about, where, party-type,
  momentum) on the **left**; a **sticky RSVP panel** on the **right** carrying the going count, the
  momentum meter, the anonymous attendee cluster, the +N stepper, and the Going/Maybe/Can't control
  — the social-proof + decision unit always in view.

---

## 4. The three directions

All three render the SAME real information model; they differ in *flavor / loudness*.

### Direction A — "HYPE" (expressive / maximalist · full Partiful energy)
Dark, vibrant animated gradient theme; huge kinetic display title; glowing momentum bar; the RSVP
buttons are the brightest thing on the page; party-type chips as neon pills; casual text-native
microcopy ("You're invited", "who's pulling up"). The anonymous attendee cluster pulses. This is the
boldest departure from the ticket page.

**One-line pitch:** Maximum anticipation — a glowing, kinetic invite that makes Going feel like a
moment.

### Direction B — "ELEVATED" (refined / modern · tasteful, premium-social)
Lighter, editorial, generous whitespace, one tasteful brand-accent gradient, refined serif/display
title, soft glass cards, a calm momentum meter. Still social-first (decision + count are hero) but
grown-up — reads like a beautifully designed dinner-party invite. Closest to brand-theme-neutral
elegance; safest for corporate-event / networking party types.

**One-line pitch:** A grown-up invitation — premium, calm, and unmistakably tasteful.

### Direction C — "MOMENTUM" (hybrid · recommended)
Keeps Direction-A's structural DNA (it IS a Mingla sibling — parallax cover, brand accent, glass)
but makes the **going-momentum meter + the Going/Maybe/Can't decision** the gravitational center.
Expressive where it counts (theme accent glow on the CTA + meter, kinetic count), restrained
everywhere else (clean facts, party chips, about). Adapts gracefully across every party type from
rave to corporate because the *energy comes from the theme accent*, not from a fixed hype skin.

**One-line pitch:** The honest middle — social momentum as the hero, brand-theme as the energy dial,
elegant at any vibe.

### Recommendation: **Direction C (MOMENTUM)**
Because the brand-theming engine already varies the accent/font per brand, a *fixed* maximalist skin
(A) fights a corporate or networking party, and a *fixed* refined skin (B) under-serves a rave or
warehouse-party. C lets the **same layout dial its loudness from the theme** — quiet for a networking
mixer, electric for a club-night — which is exactly how a single RSVP component must behave across 15
canonical party types. It is the boldest design we can ship *once* and have it feel right everywhere,
and it stays closest to the proven Direction-A family while still being unmistakably its own,
non-transactional thing.

---

## 5. How to view + verify
Open each `.html` by double-clicking (self-contained). Resize: **≤1023px = phone**, **≥1024px =
desktop**. Use the demo bar to switch brand theme / party-type / RSVP state. Headless screenshots at
390px (phone) and 1280px (desktop) are saved alongside each file as proof (see filenames in §6).

## 6. Files
- `RSVP_DIRECTION_A_HYPE.html` — phone: `shot_A_phone.png`, desktop: `shot_A_desktop.png`
- `RSVP_DIRECTION_B_ELEVATED.html` — phone: `shot_B_phone.png`, desktop: `shot_B_desktop.png`
- `RSVP_DIRECTION_C_MOMENTUM.html` (recommended) — phone: `shot_C_phone.png`, desktop: `shot_C_desktop.png`
