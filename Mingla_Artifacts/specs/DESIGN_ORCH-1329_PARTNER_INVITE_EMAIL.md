# DESIGN — ORCH-1329 [partner-invite email polish + "Get the Mingla app" download CTA]

**Phase:** DESIGN (pixel-precise contract for the implementor). No product code written here.
**Surface:** the transactional email rendered by `supabase/functions/invite-brand-member/index.ts::buildInviteEmail()`, two variants, wrapped by the shared `renderShell` (`_shared/email/shell.ts`).
**Companion mockup:** `Mingla_Artifacts/specs/DESIGN_ORCH-1329_mockup.html` (open in a browser — renders BOTH improved variants faithfully with the real tokens).
**Reads:** INVESTIGATION_ORCH-1329 (current-state facts + §8 improvement list + §7 hard constraints), `_shared/email/shell.ts`, `_shared/email/escape.ts`, `mingla-product/references/voice-lanes.md` (business voice).
**Decisions honored (not relitigated):** secondary CTA → static literal `https://usemingla.com/business/download` (business app; server 307 UA-branch; email-safe, no JS); both variants carry it, subordinate to Accept; must flow through `renderShell`; existing shell tokens; light-only; styled button (no store-badge PNGs exist in-repo).

---

## 0. Design thesis (the moment)

The recipient just got an email that hands them money-making infrastructure — a brand someone
already built for them, or a seat on a team that sells tickets. Their two live questions are
**"is this real / safe?"** and **"what do I actually do now?"** The redesign answers both:
a scannable 3-step spine replaces the dense paragraph, the Stripe reassurance is lifted out of the
grey basement into a visible trust note, and a single obviously-primary Accept button owns the
decision while the app download sits below it as a calm, clearly-secondary offer. Nothing decorative
is added. Every block earns its place against one of those two questions.

---

## 1. Token table (email-scoped — all values inline; NO new shell tokens required)

| Token (spec name) | Value | Role | Source |
|---|---|---|---|
| `orange` | `#FF6B2C` | Primary button fill; secondary-button border; personal-note left rule; logo dot | shell `BRAND_ORANGE` |
| `orange-ink` | `#B23E12` | **NEW usage** — AA-safe dark orange for text on white/soft: secondary-CTA label, step-number badges, eyebrow chip, brand-name emphasis, "Bank-secure." lead | derived; 5.85:1 on white, 5.49:1 on `#FFF6F1` |
| `ink` | `#0F1115` | Body headings + primary copy | shell `BRAND_INK` |
| `muted` | `#5B6172` | Sub-copy, captions, fine print | shell `BRAND_MUTED` |
| `soft` | `#FFF6F1` | Chip / step-badge / trust-note / personal-note fills | shell `BRAND_BG_SOFT` |
| `border` | `#ECECEE` | Card border, hairlines, secondary-card border | shell `BRAND_BORDER` |
| `page` | `#F5F5F7` | Email page background | shell |
| `white` | `#FFFFFF` | Card + button-on-card fills, button text | shell |
| Font stack | `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif` | All text | shell |

**Why `orange-ink #B23E12` exists:** brand `#FF6B2C` as TEXT on white is **2.84:1 — fails WCAG AA**
(and fails even the 3:1 large-text floor). Every place the old design (or a naïve new one) would put
orange *text* or a soft-bg orange badge, use `#B23E12` instead. `#FF6B2C` stays valid only as a
**fill** (button/border), never as small text.

---

## 2. Layout & spacing grid (4pt system; single 600px column)

Card, header, footer, and the outer 28px body padding are **owned by `renderShell` — do not touch.**
Everything below lives inside the `bodyHtml` string passed to `renderShell`. Vertical rhythm inside
the body, top→bottom:

| Block | Bottom margin | Notes |
|---|---|---|
| Greeting `Hi {name},` | 14px | 15px/1.55 ink |
| Eyebrow chip (partner only) | 14px | pill |
| Lead line (bold) | 20px (partner) / 8px (standard) | |
| Sub-lead ("Three quick steps…" / role-clarity) | 18px (partner) / 16px (standard) | muted |
| Steps table (partner only) | 22px | inter-step gap 16px |
| Context value line (standard only) | — (CTA margin takes over) | |
| Personal-note block (optional) | 22px | |
| **Primary CTA** | 12px (partner) / 26px (standard) | |
| Stripe trust note (partner only) | 26px | |
| Secondary app card | 6px | |
| Fine print (expiry + paste-URL) | — (last block) | top margin 22px |

Steps use a **2-column table per row**: col A = fixed `width:40` (28px badge + 12px right gap),
col B = flexible text, both `valign="top"`. Buttons are **table-cell based** (fill/border on the
`<td>`, `<a>` inside with padding) — matches the codebase's existing CTA construction for
Outlook/Gmail robustness. No flexbox, no CSS grid, no media queries (single column is intrinsically
responsive; the shell already sets `max-width:600px;width:100%`).

---

## 3. Type scale (every text element)

| Element | Size / weight / line-height | Color |
|---|---|---|
| Greeting | 15px / 400 / 1.55 | ink |
| Eyebrow chip | 12px / 700 / 1 · uppercase · letter-spacing 0.4px | orange-ink on soft |
| Lead line | 16px / 600 / 1.5 | ink (brand name span → orange-ink) |
| Sub-lead / role-clarity | 14–15px / 400 / 1.55 | muted |
| Context value line (standard) | 15px / 400 / 1.55 | ink |
| Step number badge | 14px / 700 / line-height 28px (vertically centers in 28px circle) | orange-ink on soft |
| Step label | 15px / 600 / 1.35 | ink |
| Step sub | 14px / 400 / 1.5 | muted |
| Personal-note quote | 14px / 400 italic / 1.5 | ink |
| Personal-note attribution | 12px / 400 / — | muted |
| **Primary CTA label** | **16px / 700 / line-height 20px** | white on orange |
| Trust-note body | 13px / 400 / 1.5 | ink; lead word "Bank-secure." → 700 orange-ink |
| Secondary-card heading | 14px / 600 / 1.4 | ink |
| Secondary-card sub | 13px / 400 / 1.5 | muted |
| **Secondary CTA label** | **15px / 600 / line-height 20px** | orange-ink on white |
| Fine print | 13px / 400 / 1.5 | muted |
| Paste-URL | 12px / 400 · `word-break:break-all` | muted |

Dynamic Type: email clients don't honor OS text scaling reliably; all sizes are fixed px (email
convention). Body copy is ≥13px and primary reading text ≥15px — comfortable in every mail client.

---

## 4. Component specs (exact inline styles)

### 4.1 Primary CTA button (both variants)
```
<td> : background:#FF6B2C; border-radius:10px;
<a>  : display:inline-block; padding:15px 30px; color:#FFFFFF; text-decoration:none;
       font-weight:700; font-size:16px; line-height:20px; font-family:<stack>;
```
Rendered tap height ≈ 15+20+15 = **50px** (≥44pt ✓). `href` = `escapeHtml(acceptUrl)` (already so).
Radius bumped 8→10px and label 15→16px/700 (was 14px padding / 15px / 600) so the primary reads
unmistakably as the dominant action next to the new secondary.
**Fill stays brand `#FF6B2C` per the fixed-token constraint** — see §7 a11y note (white-on-orange is
2.84:1; this is an inherited shared-button gap, flagged for a brand-level decision, NOT forked here).

### 4.2 Secondary CTA — "Get the Mingla Business app" (both variants)
Sits inside a quiet card so it never competes with the filled primary. Card:
```
<td> : padding:18px 20px; background:#FFFFFF; border:1px solid #ECECEE; border-radius:12px;
```
Ghost button inside (outline, not fill — the hierarchy signal):
```
<td> : background:#FFFFFF; border:1.5px solid #FF6B2C; border-radius:8px;
<a>  : display:inline-block; padding:12px 22px; color:#B23E12; text-decoration:none;
       font-weight:600; font-size:15px; line-height:20px; font-family:<stack>;
       href="https://usemingla.com/business/download"   ← STATIC LITERAL, no interpolation
```
Tap height ≈ 12+20+12 = **44px** (≥44pt ✓). Fill white / border `#FF6B2C` / label `#B23E12`
(5.85:1 ✓). Outline-vs-fill + burnt-orange-vs-white label = a clear "second, helpful" read.
**Hierarchy rule:** exactly ONE filled-orange button per email. The download is ALWAYS the outline
one. Never two fills.

### 4.3 Eyebrow chip (partner only)
```
<span> : display:inline-block; padding:6px 12px; border-radius:999px; background:#FFF6F1;
         color:#B23E12; font-size:12px; font-weight:700; letter-spacing:0.4px; text-transform:uppercase;
text = "Set up for you by " + escapeHtml(inviterName)
```
Only change vs today: text color `#FF6B2C → #B23E12` (AA) and weight 600→700.

### 4.4 Step badge (partner only)
```
<div> : width:28px; height:28px; border-radius:14px; background:#FFF6F1; color:#B23E12;
        font-size:14px; font-weight:700; line-height:28px; text-align:center;
```
(A `<div>` is fine inside the body `<td>`; Outlook renders a rounded square — acceptable graceful
degradation. Do NOT add VML — no existing email uses it.)

### 4.5 Stripe trust note (partner only) — ELEVATED from fine print
```
<td> : padding:12px 14px; background:#FFF6F1; border-radius:8px;
<p>  : font-size:13px; line-height:1.5; color:#0F1115;
lead <span> : font-weight:700; color:#B23E12;   ("Bank-secure.")
```
This is the single biggest trust lift: the reassurance now sits **directly under the primary CTA**,
in a soft card, where the "am I about to hand my bank details to an app?" anxiety actually fires —
not buried at the bottom in grey. Removed from the fine-print block entirely.

### 4.6 Personal-note block (optional, partner) — unchanged structurally
Keep today's construction verbatim (`padding:14px 16px; background:#FFF6F1; border-left:3px solid
#FF6B2C; border-radius:6px;`), quote `escapeHtml(personalNote)`, attribution `— escapeHtml(inviterName)`.

---

## 5. Exact copy — VARIANT 1: PARTNER-SETUP (`partner_setup = true`)

Placeholders: `{brand}`, `{inviter}`, `{name}` (invitee), `{note}` (optional). All are HTML-escaped
at build (§7). Sample values in the mockup: brand "Zuri Kitchen", inviter "David Okon", name "Amara".

- **Subject:** `{brand} — your Mingla brand is ready to claim`
  *(KEPT verbatim — already clear, warm, non-hype. Do not churn it.)*
- **Preheader (NEW):** `{inviter} built {brand} for you. Accept, connect your bank, and you're live.`
  *(was: "{inviter} built {brand} for you on Mingla. Accept to become the owner." — new line front-loads the 3-step payoff.)*
- **Greeting:** `Hi {name},`
- **Eyebrow chip:** `Set up for you by {inviter}`
- **Lead line (bold, 16px):** `{inviter} built {brand} for you on Mingla — your page, events and photos are done.` *(brand name wrapped in `orange-ink` span.)*
- **Sub-lead (muted):** `Three quick steps and it's yours:`
- **Steps:**
  1. **`Accept & claim {brand}`** — `You take over as owner — nothing to rebuild.`
  2. **`Connect your bank`** — `A few minutes through Stripe, so customers can pay you.`
  3. **`You're live`** — `Your events open for tickets and the money lands in your account.`
- **Personal note (if present):** `"{note}"` then `— {inviter}`
- **Primary CTA:** `Accept & set up {brand}`
- **Stripe trust note:** **`Bank-secure.`** ` Your bank details go straight to Stripe. Mingla never sees them.`
- **Secondary card heading:** `Prefer to run {brand} from your phone?`
- **Secondary card sub:** `Get the Mingla Business app — iPhone opens the App Store, everywhere else opens your dashboard on the web.`
- **Secondary CTA:** `Get the Mingla Business app`
- **Fine print:** `This link expires in 7 days. If the button doesn't work, paste this into your browser:` then the accept URL on its own line.

### Plain-text fallback (partner) — download URL MUST appear
```
Hi {name},

{inviter} built {brand} for you on Mingla — your page, events and photos are done.

Three quick steps and it's yours:
1. Accept — you take over as owner of {brand}. Nothing to rebuild.
2. Connect your bank — a few minutes through Stripe, so customers can pay you.
3. You're live — your events open for tickets and you get paid.

[if note]  {inviter} added a note: "{note}"

Accept & set up {brand}:
{acceptUrl}

Bank-secure: your bank details go straight to Stripe. Mingla never sees them.

Prefer to manage on your phone? Get the Mingla Business app:
https://usemingla.com/business/download

This link expires in 7 days.
Need help? support@usemingla.com
```

---

## 6. Exact copy — VARIANT 2: STANDARD TEAM INVITE (`partner_setup = false`)

- **Subject (NEW):** `{inviter} invited you to join {brand}'s team on Mingla`
  *(was: "{brand} invited you to join their team on Mingla" — leading with the human inviter lifts open-recognition; brand still present.)*
- **Preheader (NEW):** `{inviter} added you to {brand} as {role}. Accept to jump in — and grab the app.`
  *(was: "{inviter} invited you to {brand} as {role}." — new line adds the action + signals the app.)*
- **Greeting:** `Hi {name},`
- **Value line (bold, 16px):** `{inviter} invited you to join {brand} on Mingla as {role}.` *(brand + role wrapped in `orange-ink` spans.)*
- **Role-clarity line (muted, NEW):** `As a{n} {role_lower} you can {role_can}.` — from the map below.
- **Context value line (ink):** `{brand} runs its events, tickets and page on Mingla — you're now part of the team that makes it happen.`
- **Primary CTA:** `Accept invitation`
- **Secondary card heading:** `Get the app to manage on the go`
- **Secondary card sub:** `The Mingla Business app is where you'll do the work — scan guests in, check sales, run events. iPhone opens the App Store, everywhere else opens the web.`
- **Secondary CTA:** `Get the Mingla Business app`
- **Fine print:** identical to partner (expiry + paste-URL).

### Role-clarity map (`{role_can}` — new, drives the role-clarity line + optional plain-text)
| role | `{role}` label (exists: `roleDisplay`) | `{role_can}` |
|---|---|---|
| `brand_owner` | Brand owner | `manage everything — events, payouts, team and settings` |
| `brand_admin` | Brand admin | `manage events, the team and most brand settings` |
| `event_manager` | Event manager | `create and run events, and manage tickets and guests` |
| `finance_manager` | Finance manager | `see sales, and manage payouts and refunds` |
| `marketing_manager` | Marketing manager | `run campaigns and manage the page and promotions` |
| `scanner` | Scanner | `scan tickets and check guests in at the door` |

(Article `a`/`an`: use "an" before Event/…; simplest safe implementation = drop the article →
`As event manager you can …` OR hardcode per-role. Implementor's call; keep it grammatical.)

### Plain-text fallback (standard) — download URL MUST appear
```
Hi {name},

{inviter} invited you to join {brand} on Mingla as {role}.
As {role_lower} you can {role_can}.

{brand} runs its events, tickets and page on Mingla — you're now part of the team.

Accept your invitation:
{acceptUrl}

Get the Mingla Business app to manage {brand} on the go:
https://usemingla.com/business/download

This link expires in 7 days.
Need help? support@usemingla.com
```

---

## 7. States, accessibility & platform (email realities)

**Interactive states.** Email offers no reliable `:hover`/`:active`/`:focus`/`:disabled` styling and
no JS — every element is effectively single-state. Affordance therefore rides entirely on visual
form: the primary is a filled pill, the secondary an outlined pill, both with generous padding that
reads as tappable. Mail clients apply their own focus ring on tab — do not suppress it. There is no
loading/empty/error state in an email; the "error" path (dead button) is handled by the paste-URL
fine print, which every variant keeps.

**Motion.** None. Email clients do not run animation reliably; `prefers-reduced-motion` is moot.
The design is fully static by construction — this is correct, not a gap.

**Accessibility (WCAG AA), stated per pairing:**
| Pairing | Ratio | Verdict |
|---|---|---|
| ink `#0F1115` on white | 18.9:1 | ✓ |
| ink on soft `#FFF6F1` | 17.7:1 | ✓ |
| muted `#5B6172` on white | 6.2:1 | ✓ |
| muted on soft | 5.8:1 | ✓ |
| orange-ink `#B23E12` on white (secondary label, chip, badges) | 5.85:1 | ✓ |
| orange-ink on soft (chip, badge, "Bank-secure.") | 5.49:1 | ✓ |
| **white on orange `#FF6B2C` (PRIMARY button label)** | **2.84:1** | **✗ — inherited shared-button gap; see below** |

- Tap targets: primary ~50px, secondary ~44px — both ≥44pt ✓.
- Color is never the sole signal: primary vs secondary differ by **fill vs outline + weight + size**,
  not just hue; the trust note leads with the word "Bank-secure.", not a color.
- Images: shell logo has `alt="Mingla"`; brand cover hero uses `alt=""` (decorative) per shell — unchanged.
- Reading order is linear DOM order (greeting → what → do-this → trust → app → fine print) — correct for screen readers.

> **⚠ PRIMARY-BUTTON CONTRAST — the one thing needing a decision (see §10).** White text on
> `#FF6B2C` is **2.84:1** and fails AA. This is the *shared brand button* used identically by the
> ticket, trip and invite emails; the ORCH-1329 constraint fixes `#FF6B2C` as a token, so this spec
> does **not** fork the invite's button. Recommended brand-level fix (separate call): darken the
> shared button fill to **`#C4471A`** (white-on-it = 4.93:1, passes AA, still clearly orange) in
> `shell.ts`/the email token set so ALL transactional emails benefit at once. Flagged, not silently
> shipped.

**Per-platform (mail-client) deltas.** No iOS/Android/web app deltas apply (this is email, not RN).
Client notes for the implementor: (a) Outlook Windows renders the badge `border-radius` as a
near-square — accepted; (b) `word-break:break-all` on the paste-URL prevents horizontal scroll on
narrow clients; (c) all layout is table-based single-column so it reflows to phone width without
media queries; (d) `<meta color-scheme:light only>` in the shell keeps Dark-Mode clients from
inverting the soft-orange fills — unchanged, keep it.

---

## 8. Per-variant BEFORE → AFTER rationale

### Partner-setup
| # | Before | After | Why |
|---|---|---|---|
| 1 | Dense 3-sentence paragraph ("events, cover photos, description … connect your bank so customers can buy tickets and you can get paid") | Bold lead line + **3 scannable steps** (Accept → Connect bank → You're live) | The recipient's real question is "what do I do?" — steps answer it in one glance; the paragraph buried the sequence. |
| 2 | Stripe line in grey fine print at the very bottom | **Elevated trust note** in a soft card directly under the CTA, "Bank-secure." lead | Reassurance must fire at the anxiety moment (bank connection), not in the basement. |
| 3 | Single orange button, no app option | Filled-orange primary + **outlined** secondary app card | Adds the app path without a competing second fill; hierarchy is unmistakable. |
| 4 | Eyebrow chip orange text (2.67:1, fails AA) | Same chip, `#B23E12` text (5.49:1) | Accessibility, zero visual cost. |
| 5 | Fine print = expiry + URL + Stripe (a wall) | Fine print = expiry + URL only | Stripe moved up; the wall is now two tight lines. |
| 6 | Preheader states a fact | Preheader front-loads the 3-step payoff | Higher-intent inbox preview. |

### Standard team invite
| # | Before | After | Why |
|---|---|---|---|
| 1 | Bare: logo header, one line "{inviter} invited you to {brand} as {role}", button, fine print | Value line + **role-clarity line** (what the role can DO) + a context value line | It was the weakest surface (investigation F-1/§8); recipients often don't know what a "Scanner"/"Finance manager" seat means. |
| 2 | No app path | Same **outlined secondary app card**, copy tuned to "do the work" (scan/sales/events) | Consistency with partner; scanners literally need the app at the door. |
| 3 | Generic brand-led subject | Inviter-led subject "{inviter} invited you to join {brand}'s team" | Human sender name lifts recognition/open-rate; brand still named. |
| 4 | Thin preheader | Action + app-signal preheader | Same intent lift as partner. |

---

## 9. Build-ready handoff (implementor — honor investigation §7 gates)

**Where it goes:** everything is appended/edited **inside the `bodyHtml` string** in
`buildInviteEmail()` and the `text` string — NEVER a new doctype/html wrapper (I-PROPOSED-AD /
ORCH-0785-D shell-singleton gate; keep `renderShell` as the only shell).

**Escape-gate (ORCH-0785-C buyer-string-escape) — concrete rules:**
- The download URL is a **static string literal** — no interpolation, nothing to escape. Keep it literal `"https://usemingla.com/business/download"` (optionally behind an env-with-default `MINGLA_MARKETING_URL ?? "https://usemingla.com"` + `"/business/download"`, per investigation §7.5 — but the origin must NOT be built from any `brand|order|event|…`-named variable).
- If you factor the secondary block into a variable, name it with a `Html`/`HTML` suffix (`downloadCtaHtml`) or a `render*` fn — a bare `${downloadCta}` in HTML context would trip the gate.
- Any `brand`/`inviter`/`note`/`role` string placed into the new HTML (chip, lead line, steps, trust note, secondary heading, role-clarity) MUST be `sharedEscapeHtml(...)` at the call site (the gate's regex keys on the leading identifier + inline `escapeHtml(...)` form). The role-clarity `{role_can}` strings are static literals chosen by a `switch(role)` — no escape needed on the literal, but escape `roleLabel` where interpolated.
- Plain-text (`text`) is `text/plain` — no escaping; interpolate raw `{brand}`/`{inviter}`/`{note}` as today. **Both variants' `text` MUST include `https://usemingla.com/business/download`.**

**Suggested render helpers (all return `*Html` strings, all live in this file, all fed into `bodyHtml`):**
`renderStepsHtml()` (partner), `renderTrustNoteHtml()` (partner), `downloadCtaHtml` (both — a `render*`
fn taking the variant heading/sub), `roleClarity(role)` (returns the `{role_can}` literal).

**Regression test (CLOSE Step-0.5, fails-on-revert; tests-append-only):** new/appended test over
`buildInviteEmail()` asserting for **both** `partnerSetup:true` and `partnerSetup:false` that
`payload.html` AND `payload.text` contain `usemingla.com/business/download`; and that `payload.html`
contains the filled primary (`background:#FF6B2C`) and the outlined secondary
(`border:1.5px solid #FF6B2C`) so the hierarchy can't silently collapse to two fills. (The escape
gate skips `__tests__`.)

**No new tokens** for the system; `#B23E12` is used inline only (email has no token file). If the
brand-button darken (§10) is later adopted, that is a `shell.ts` change, not an invite-only one.

---

## 10. The single decision for Seth

**Primary-button contrast.** The shared Mingla email button (white text on `#FF6B2C`, used by
ticket/trip/invite) is 2.84:1 — below WCAG AA. This spec ships within the fixed `#FF6B2C` token and
does not fork one email. Two paths: **(A)** accept the known gap for now (visually on-brand, status
quo everywhere); **(B)** darken the shared button fill to `#C4471A` (4.93:1, passes AA, still reads
orange) as a one-line `shell.ts`/token change that fixes every transactional email at once. Everything
else in this spec is AA-clean and ready to build.
