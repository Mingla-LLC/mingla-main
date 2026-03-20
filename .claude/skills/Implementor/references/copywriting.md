# Copywriting Reference — Mingla Implementor

Read this file before writing any user-facing text: button labels, error messages, empty
states, notifications, onboarding, App Store copy, marketing content, or admin UI copy.

---

## Mingla's Brand Voice

**In one sentence:** Mingla sounds like your funniest friend who also happens to have
incredible taste — creative, playful, punchy, friendly, and always down for a good time.

### Voice Attributes

**1. Creative — Surprising, Never Generic**
Not "Find restaurants" — "Feed your next obsession."
Not "No results found" — "This spot's playing hard to get."
Intentional surprise. Feels like someone *thought about it*.

**2. Playful — Light Touch, Not Lightweight**
Wink in the voice. Emotional warmth. Human, not robotic.
Dials down for money, errors, frustration — stays trustworthy.

**3. Punchy — Short, Rhythmic, Hits Hard**
Short sentences. Fragments OK. "Rooftop. Live jazz. Say less."
Read aloud. If no rhythm, rewrite. If robot-sounding, delete.

**4. Friendly — On Your Side, Always**
"You" and "your" — never "the user." Celebrates wins. Treats mistakes as no big deal.
Inclusive: no assumptions about who you're with, what you afford, what you're into.

**5. Funny — Earned Laughs, Not Forced**
Sharp funny, not random LOL. Unexpected observations, self-awareness, well-timed one-liners.
The exhale-through-the-nose kind. Humor serves the experience — never hijacks it.

### Where Humor Works Best
Empty states, loading messages, celebrations, onboarding, skip/dismiss feedback.

### Where Humor Pulls Back
Payment confirmations, progress-blocking errors, privacy/data screens, destructive actions.

### Humor Guardrails
1. Never punch down (budget, location, choices)
2. Never be sarcastic (reads as passive-aggressive in UI)
3. Never sacrifice clarity for comedy
4. Never repeat the same joke (must work as plain communication by third viewing)
5. Never force it (some moments are just functional)

---

## Voice Spectrum (Tone Dials by Context)

| Context | Tone | Example |
|---------|------|---------|
| Discovering | Playful + Creative HIGH | "Ooh, this one's good" |
| Deciding | Punchy + Friendly | "Rooftop. Tacos. Need we say more?" |
| Booking | Friendly + Clear | "Locked in for 7pm. See you there." |
| Celebrating | Funny + Warm | "Look at you, planner extraordinaire" |
| Error/Problem | Friendly + Calm, humor LOW | "That didn't work. Give it another go?" |
| Waiting/Loading | Playful + Light humor | "Consulting our sources..." |
| Empty state | Creative + Funny | "Nothing here yet. Suspicious." |
| Onboarding | Friendly + Encouraging | "This helps us get you. Like, really get you." |
| Notification | Punchy + Specific | "New Thai spot just dropped on King St" |
| Sharing | Creative + Makes user shine | "You have to try this place →" |

The dial never goes to zero on any attribute. Mingla never goes full robot.

---

## Two Voice Modes

### Consumer Voice (Mobile App)
Full Mingla personality. Every rule above applies.

### Operator Voice (Admin Dashboard)
Professional, clear, efficient, confident, warm but not playful.

| Attribute | Consumer | Operator |
|-----------|----------|----------|
| Tone | Playful, witty | Professional, clear |
| Humor | Frequent | Rare (empty states/celebrations only) |
| Brevity | Punchy fragments OK | Complete sentences preferred |
| CTAs | Creative ("Let's go") | Direct ("Save", "Apply") |
| Errors | Light recovery | Clear, actionable, technical OK |
| Labels | Benefit-first ("Your vibe") | Descriptive ("User Preferences") |

---

## Character Limits

| Element | Max Chars | Guideline |
|---------|----------|-----------|
| Button label | 20 | 2-3 words. Verb-first. |
| Tab label | 10 | 1 word ideal. |
| Screen title | 25 | 2-4 words. |
| Card title | 40 | Descriptive, specific. |
| Toast notification | 50 | Action + result. |
| Push notification title | 40 | Hook + context. |
| Push notification body | 100 | Value + CTA. |
| Error message | 80 | Problem + solution. |
| Empty state headline | 30 | Inviting, forward-looking. |
| Empty state body | 80 | Why empty + what to do. |
| Tooltip | 60 | One sentence max. |
| App Store subtitle | 30 | Key value prop. |

---

## Copy for Every State (Non-Negotiable)

Every screen with async data needs all 5 states:

### Loading
- Under 25 chars. Progressive tense + personality.
- Prime humor real estate. Rotate messages for repeat visitors.
- Examples: "Consulting our sources...", "Finding places you'll brag about...", "On it..."

### Empty State
- Headline: acknowledge emptiness with wit (never "No results found")
- Body: light explanation + inviting nudge
- CTA: action-first, personality-forward
- Pattern: [Witty acknowledgment] + [Inviting nudge] + [Fun CTA]
- Example: "Nothing here yet. Suspicious." / "Start swiping and this'll fill up fast." / "Let's go"

### Error State
- Lead with what happened in plain language
- Immediately follow with the fix
- Light but not dismissive. Never blame user.
- Pattern: [Casual what-went-wrong] + [Here's what to do]
- Example: "That didn't land. Tap to try again."

### Success State
- Celebrate proportionally to action magnitude
- Small: "Saved. Good eye."
- Medium: "You're officially a planner now."
- Big: "Locked in for 7pm. The night starts here."

### Partial/Degraded
- Honest but light. Show what's available, not what's missing.
- Example: "Showing your saved gems — go online to see what's new"

---

## Notification Copy

**Formula:**
```
TITLE: [Hook] — max 40 chars
BODY: [Value] + [Implicit CTA] — max 100 chars
```

Rules: never valueless, never clickbait, be specific ("New Thai place on King St" not
"New restaurant nearby"), time-sensitive states the window, social names the person.

---

## Onboarding Copy

**Pattern per step:**
```
HEADLINE: [What this does — 3-5 words, benefit-first]
BODY: [Why it matters — 1 sentence, personal, personality wink]
CTA: [Exciting action verb, not bureaucratic]
```

Example: "Pick your vibe" / "This helps us get you. Like, really get you." / "Let's go"

Final step CTA: mic drop, not form submission. "Show me what you've got" — never "Complete setup"

Permissions: lead with payoff. "Turn on location so we find what's near you" beats
"Allow location access."

---

## The Terminology Bible (Non-Negotiable)

| Concept | Mingla Term | Never Use |
|---------|------------|-----------|
| Saving a rec | "Save" | Bookmark, favorite, heart, like |
| A rec card | "Place" or "Experience" | Venue, listing, item |
| Swiping right | "Like" | Approve, accept |
| Swiping left | "Skip" | Dislike, reject, pass |
| Collaborative planning | "Session" | Group, party, event |
| Planning board | "Board" | Feed, wall, list |
| AI itinerary | "Curated itinerary" | AI plan, algorithm picks |
| Rec quality | "Match" | Score, rating, fit % |
| Preferences | "Your vibe" (casual) / "Preferences" (settings) | Profile, config |
| Swipe deck | "Explore" | Deck, stack, carousel |
| Discovery feed | "Discover" | Browse, search |

For new concepts: propose the term + why it's right + 3 rejected alternatives with reasons.

---

## Copy Crimes (Never Commit)

- **"Something went wrong."** — What? Be specific.
- **"Submit."** — Submit what? Use the action: "Send message", "Save changes."
- **"Are you sure?"** — State the consequence: "Delete this session? Friends lose access."
- **"Please."** — Wastes characters in microcopy. Save for real apologies.
- **"Successfully."** — "Booked." They know it worked — you're showing a success message.
- **"Invalid."** — Sounds like user is broken. "Check your email — something doesn't look right."
- **"Oops!"** — Generic cute. Mingla is funny, not cutesy. "Well, that didn't work."
- **Feature jargon as labels** — "Collaborative Sessions" → "Plan with friends."

---

## Copy Deck Format

```
COPY DECK: [Feature Name]
VOICE: Mingla standard / Operator (admin)
TONE: [Specific — e.g., "Excited discovery" or "Calm recovery"]

SCREEN: [Name]
STATE: [Default / Loading / Empty / Error / Success / Partial]

[Element ID] | [Element Type] | [Copy] | [Chars] | [Notes]
─────────────┼────────────────┼────────┼─────────┼────────
header_title | Screen Title   | "Your Night"  | 10  |
cta_primary  | Button Label   | "Find places"  | 11  | Primary
empty_head   | Headline       | "Nothing here yet" | 16 |
empty_body   | Body           | "Start swiping to find places you'll love." | 43 |
error_msg    | Error          | "Couldn't load. Tap to retry." | 29 |
loading_msg  | Loading        | "Finding your vibe..." | 20 |
```

---

## Copy Audit Checklist

Before delivering any copy:

- [ ] Voice check: sounds like Mingla? Read aloud.
- [ ] Clarity check: non-native speaker understands on first read?
- [ ] Character check: within limits for element type?
- [ ] State check: every state covered?
- [ ] Emotion check: matches user's emotional state at this moment?
- [ ] Action check: every CTA has specific action verb?
- [ ] Blame check: no error messages blame user?
- [ ] Jargon check: no technical terms?
- [ ] Accessibility check: makes sense to screen reader without visuals?
- [ ] Consistency check: matches patterns elsewhere? Same terms for same things?
- [ ] Delight check: at least one smile moment in the flow?
- [ ] Brevity check: can any word be removed? Remove it.

---

## Accessibility in Copy

- Plain language: 8th-grade reading level. No jargon. No culture-specific idioms.
- Screen reader: every string makes sense read aloud without visuals.
  "Heart icon" → "Save to favorites". "X" → "Close".
- Inclusive: gender-neutral. No assumptions about relationships, ability, background.
  "Invite someone" not "Invite your partner."
- Errors without blame: "We couldn't load that" not "You entered an invalid request."

---

## Social Sharing Copy

User is the tastemaker. Mingla is invisible in the share.
- Bad: "I found this on Mingla!"
- Good: "Okay hear me out → [place name]"
- Good: "Hidden gem. Rooftop. Live jazz. You in?"

## Referral Copy

Benefit the receiver: "I've been finding great places on Mingla — thought you'd like it"
Not: "Join Mingla and we both get rewards!"

## Email Copy

Subject: 40 chars max, value-first. Body: 1 message, 1 CTA, max 150 words. Slightly warmer
than in-app.