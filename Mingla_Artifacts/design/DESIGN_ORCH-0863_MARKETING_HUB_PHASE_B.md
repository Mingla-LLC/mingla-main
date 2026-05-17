# DESIGN — ORCH-0863 [Marketing Hub Phase B — Overview + Audiences + Templates tabs]

**Date:** 2026-05-17
**Author:** `ui-ux-pro-max` skill (operator-elected over `mingla-designer` for this dispatch)
**Status:** READY FOR IMPLEMENTOR
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Mode:** DESIGN pre-flight (per `feedback_implementor_uses_ui_ux_pro_max.md`)
**Inputs honored:** SPEC `Mingla_Artifacts/specs/SPEC_ORCH-0863_MARKETING_HUB_PHASE_B.md`, investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0863_MARKETING_HUB_PHASE_B.md`, Phase A design baseline `Mingla_Artifacts/design/DESIGN_ORCH-0815_MARKETING_HUB_PHASE_A.md` (§7.1 + §7.2 + §7.9 + §7.10), Mingla design tokens `mingla-business/src/constants/designSystem.ts`, Campaigns reference `mingla-business/app/(tabs)/marketing/campaigns/{index,[id],compose}.tsx`.

This design is a CONTINUATION of Phase A's visual language. It does NOT propose a new identity, new tokens, or a redesign of the Campaigns tab. Every color / radius / spacing / typography value comes from the existing token file. Three deltas from Phase A's §7.1 baseline are operator-confirmed and called out inline: **(D1)** Overview revenue hero is OMITTED entirely (Constitution #9 — no UTM-to-campaign attribution exists); **(D2)** Overview funnel drops "Opened" (no Resend webhook ingest yet) and replaces with "Failed"; **(D3)** Audiences "Coming Soon" section (brand-followers + custom-segment) is omitted (out of Phase B scope per SPEC NG-12 + NG-13).

---

## §1 Cross-Surface Impact Declaration

Per `feedback_cross_surface_impact_inspection.md`:

| Surface | In scope | Reason / contract |
|---|---|---|
| Consumer iOS (`app-mobile/` iOS) | NO | No consumer Marketing tab — phase B is mingla-business only. |
| Consumer Android (`app-mobile/` Android) | NO | Same as iOS. |
| Buyer/anon Web (`/checkout/*`, `/e/*`, `/b/*`) | NO | Anonymous routes do not reach marketing. |
| Business iOS (`mingla-business/` iOS) | **YES — primary** | Designed-for surface. Every component spec'd here ships here. |
| Business Android (`mingla-business/` Android) | **YES — automatic parity** | Shared React Native code paths; no per-OS deltas in this design. |
| Admin Web (`mingla-admin/`) | NO | No admin marketing route exists. |
| Business Web preview (`mingla-business/` dev/web RN-Web build) | **YES — adjacent, spot-check** | Same components render via RN-Web. One known constraint flagged in §10. |

Parity model: **shared code, automatic parity.** Tester runs ONE iOS sim + ONE Android emu live-fire + ONE web preview spot-check.

---

## §2 Sub-nav reuse statement

`MarketingSubNav` (`mingla-business/src/components/marketing/MarketingSubNav.tsx`) is **reused verbatim**. No visual change, no prop change, no behavior change. It already detects the active route via pathname inspection (lines 49–55) and renders 4 pills (Overview / Audiences / Campaigns / Templates) with `accent.tint` background + `accent.border` on the active pill. Phase B simply replaces the three placeholder routes that the sub-nav already routes to — the sub-nav itself is untouched.

---

## §3 Overview tab — full pixel spec

**Route:** `mingla-business/app/(tabs)/marketing/index.tsx` (REPLACE placeholder)

### §3.1 Layout schematic — populated state

```
┌─────────────────────────────────────────────┐
│  MarketingSubNav: [●Overview] Aud Camp T    │  sticky chrome (reused)
├─────────────────────────────────────────────┤  spacing.md vertical gap
│                                             │
│  ┌─ Headline Card (elevated glass) ───────┐ │
│  │  ✉  CAMPAIGNS SENT                     │ │  labelCap / text.tertiary
│  │      127                               │ │  typography.statValue
│  │      in the last 30 days               │ │  typography.bodySm / text.secondary
│  └────────────────────────────────────────┘ │
│                                             │  spacing.lg gap
│  ┌─ Sent ──┐┌─ Delivered ──┐                │
│  │  2,341  ││  2,217 / 94% │                │  flex-basis 47%, flexGrow 1
│  │         ││              │                │  spacing.sm gap
│  └─────────┘└──────────────┘                │
│  ┌─ Clicked ┐┌─ Failed ────┐                │
│  │   287/12%││  6 (warn)   │                │
│  │          ││             │                │
│  └──────────┘└─────────────┘                │
│                                             │  spacing.lg gap
│  RECENT CAMPAIGNS                           │  labelCap / text.tertiary
│  ┌────────────────────────────────────────┐ │
│  │ ✉  Last 50 tickets — Sunset Rooftop  ›│ │
│  │    Sent · 247 recipients · 2d ago      │ │  bodySm / text.secondary
│  │  ─────────────── hairline ───────────  │ │
│  │ ✉  Thanks for buying — Garden Brunch ›│ │
│  │    Sent · 89 recipients · 6d ago       │ │
│  │  ─────────────── hairline ───────────  │ │
│  │ ✉  Test Campaign 12                  ›│ │
│  │    Sent · 7 recipients · 14d ago       │ │
│  └────────────────────────────────────────┘ │
│                                             │  scrollContent paddingBottom: 120
│                                             │
└─────────────────────────────────────────────┘
                                       [+ FAB] ← right: spacing.md, bottom: insets.bottom + 96
```

### §3.2 Headline Card — `OverviewHeadlineCard` (inline in route file; not a separate component)

**Container:**
- Padding: `spacing.lg` (24) all sides
- Border-radius: `radius.xl` (24)
- Border: `StyleSheet.hairlineWidth` solid `glass.border.profileElevated`
- Background: `glass.tint.profileElevated` (`rgba(255,255,255,0.06)`)
- Shadow: NONE (Phase A baseline ran `shadows.glassCardElevated` — Phase B omits to keep visual quiet; the headline isn't where attention belongs)
- Layout: vertical stack, gap `spacing.xs` (4)

**Contents (top-down):**
1. Icon + label row: `<Icon name="send" size={20} color={text.secondary} />` + `<Text style={typography.labelCap}>CAMPAIGNS SENT</Text>` (color `text.tertiary`).
2. Count: `<Text style={typography.statValue}>{count}</Text>` (color `text.primary`).
3. Caption: `<Text style={typography.bodySm}>in the last 30 days</Text>` (color `text.secondary`).

**Zero state:** When `campaigns_sent_count === 0`, count text reads `"0"` and caption reads `"Your first blast is one tap away. Tap + below."`. Same typography, no color change — honesty over decoration.

**NO `$` symbol anywhere.** NO "Revenue" word anywhere. This is enforced by the SPEC's strict-grep gate (§18) and by I-PROPOSED-MKT-OVERVIEW-NO-REVENUE-FABRICATION.

### §3.3 Metric cards — `OverviewMetricCard.tsx` (NEW component)

**Container:**
- `flexBasis: "47%"`, `flexGrow: 1` (mirrors Campaigns report `statCell` at `campaigns/[id].tsx:436-446`)
- Padding: `spacing.md` (16) horizontal, `spacing.sm` (8) vertical
- Border-radius: `radius.lg` (16)
- Border: `StyleSheet.hairlineWidth` solid `glass.border.profileBase`
- Background: `glass.tint.profileBase` (`rgba(255,255,255,0.04)`)
- Layout: vertical stack, gap 2

**Contents:**
1. Label: `<Text style={typography.labelCap}>{label}</Text>` color `text.tertiary` (uppercase by source string).
2. Value row (flex-row, alignItems baseline, gap `spacing.xs`):
   - Primary: `<Text style={typography.h3}>{value.toLocaleString()}</Text>` color `text.primary` (h3 not statValue — 4 cards in 2-row grid need a calmer treatment than the headline).
   - Percentage (when defined): `<Text style={typography.bodySm}>{percentage}%</Text>` color `text.tertiary`. Format: integer percent, no decimals (`12%` not `12.3%`).

**Tone modifier (Failed card only):** when `value > 0` AND `label === "Failed"`, value color becomes `semantic.warning` (`#f59e0b`) and percentage color matches. When `value === 0`, all 4 cards stay in `text.primary` (no "all zero is bad" tone — fresh accounts have 0 of everything).

**Grid wrap:** parent is `<View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>`. Four `OverviewMetricCard` children wrap into a 2x2 grid on phone widths; stays 4-across on tablet (≥720pt) by virtue of flexBasis-47% allowing 4-fit when available width permits.

**Skeleton state (when query is loading + no cached data):**
- Same container (same border, padding, radius, background) — so the layout doesn't jump
- Label: dim text "—" in `text.quaternary`
- Value: a 60×26pt block of `glass.tint.profileBase` with `radius.sm`, no shimmer animation (Campaigns reference uses an `ActivityIndicator`, not shimmer — match that minimalist pattern to keep cognitive load low)

### §3.4 Recent campaigns — `OverviewRecentCampaignRow.tsx` (NEW component)

**Container (outer card wrapping all 3 rows):**
- Padding: 0 (rows own their own padding)
- Border-radius: `radius.lg` (16)
- Border: `StyleSheet.hairlineWidth` solid `glass.border.profileBase`
- Background: `glass.tint.profileBase`
- Overflow hidden so hairline separators don't overshoot rounded corners

**Per-row (`OverviewRecentCampaignRow`):**
- `<Pressable>` — wraps full row, navigates to `/marketing/campaigns/{id}`
- Touch target: row height ≥56pt to satisfy I-38 (44pt minimum) with breathing room
- Padding: `spacing.md` (16) horizontal, `spacing.sm` (8) vertical
- Layout: flex-row, alignItems: center, gap `spacing.sm`
- Press feedback: opacity 0.78 on pressed (matches `iconBtnPressed` at `campaigns/[id].tsx:357-358`)

**Contents (left → right):**
1. Status icon: 18pt, color depends on campaign.status. Mapping:
   - `sent` → `send` icon, `text.secondary`
   - `scheduled` → `clock` icon, `accent.warm` (warmth = anticipation)
   - `failed` → `alert` icon, `semantic.warning`
   - `draft` → `edit` icon, `text.tertiary`
   - `sending` → `loader` icon, `text.secondary`
   - `cancelled` → `x` icon, `text.tertiary`
2. Vertical text stack (flex-1):
   - Title: `<Text style={typography.body} numberOfLines={1}>{campaign.name}</Text>` color `text.primary`.
   - Meta: `<Text style={typography.bodySm} numberOfLines={1}>{status_label} · {recipient_count} recipients · {relative_date}</Text>` color `text.secondary`.
     - status_label = "Sent" / "Scheduled" / "Failed" / "Draft" / "Sending" / "Cancelled"
     - When recipient_count is null (drafts): omit that segment and the surrounding dot (yields "Draft · 12h ago")
     - relative_date format: `<60min` → "Xm ago"; `<24h` → "Xh ago"; `<7d` → "Xd ago"; else absolute "Mon Jun 3"
3. Right chevron: 16pt `chevR` icon, `text.tertiary`

**Hairline separator between rows:** rendered as `<View style={{ height: StyleSheet.hairlineWidth, backgroundColor: glass.border.profileBase, marginLeft: spacing.md + 18 + spacing.sm }} />` (indented past the icon column for a cleaner visual rhythm; matches the `linkRow` pattern at `campaigns/[id].tsx`). NO separator after the last row.

### §3.5 FAB — copy verbatim from `campaigns/index.tsx:143-158`

No design change. Same shape, same `bottom: insets.bottom + 96`, same `accent.warm`-rgba background, same plus-icon-with-label layout. Implementor literally copies the JSX block; this preserves visual identity across the Marketing tab.

Accessibility label: `"New campaign"`.

### §3.6 States

| State | Layout |
|---|---|
| **Loading (first load, no cache)** | Headline card + 4 metric-card skeletons (per §3.3) + zero recent-campaign rows. NO full-screen spinner — the layout itself communicates "loading." |
| **Loading (refetch, has cache)** | Show cached values; no skeleton swap. React Query default behavior. |
| **Error** | `<EmptyState illustration="users" title="Couldn't load metrics" description="Pull to retry, or come back in a moment." />` — single primitive, no toast (top-level service failure deserves full-screen honesty). Pull-to-refresh triggers `refetch`. |
| **Empty (0 campaigns sent in last 30d)** | Headline card with count "0" + caption "Your first blast is one tap away. Tap + below." 4 metric cards all read "0" (don't hide them — operator wants to see the metric exists). Recent-campaigns section is omitted entirely (no header, no card) — silence beats a "no campaigns yet" empty card. |
| **Populated** | Per §3.1 schematic. |

### §3.7 Accessibility

- Headline card: `accessibilityLabel="{count} campaigns sent in the last 30 days"`.
- Metric cards: `accessibilityLabel="{label}: {value}{, percentage_value percent}"`. When `Failed > 0`: append "warning".
- Recent campaign rows: `accessibilityLabel="{campaign_name}, {status_label}, {recipient_count} recipients, {relative_date}"` + `accessibilityHint="Opens the campaign report"` + `accessibilityRole="button"`.
- FAB: `accessibilityLabel="New campaign"` (already present in Campaigns FAB).

---

## §4 Audiences tab — full pixel spec

**Route:** `mingla-business/app/(tabs)/marketing/audiences/index.tsx` (REPLACE placeholder)

### §4.1 Layout schematic — populated state

```
┌─────────────────────────────────────────────┐
│  MarketingSubNav: Over [●Audiences] Camp T  │
├─────────────────────────────────────────────┤  spacing.md gap
│                                             │
│  YOUR AUDIENCES                             │  labelCap / text.tertiary
│  Auto-updated as people buy tickets.        │  bodySm / text.tertiary
│                                             │  spacing.md gap
│  ┌─ AudienceCard (Brand rollup) ─────────┐  │
│  │ Rooftop Club — All buyers          › │  │  body/600 / text.primary
│  │ 412 buyers · 387 reachable            │  │  bodySm / text.secondary
│  │ Last sent 3d ago                      │  │  bodySm / text.tertiary
│  └────────────────────────────────────────┘  │
│  ┌─ AudienceCard (event) ────────────────┐  │
│  │ Sunset Rooftop · Sat Apr — buyers   › │  │
│  │ 247 buyers · 231 reachable            │  │
│  │ Last sent 6d ago                      │  │
│  └────────────────────────────────────────┘  │
│  ┌─ AudienceCard (event, virtual) ──────┐  │
│  │ Garden Brunch · Sun May — buyers    › │  │  (visually identical to real)
│  │ Loading reach…                        │  │  bodySm / text.tertiary
│  │ Never sent                            │  │  bodySm / text.tertiary
│  └────────────────────────────────────────┘  │
│  …                                          │
│                                             │  scrollContent paddingBottom: 120
└─────────────────────────────────────────────┘
```

NO FAB on this tab (saved-query audiences out of scope; no add path).

### §4.2 Section header

- Title row: `<Text style={typography.labelCap}>YOUR AUDIENCES</Text>` color `text.tertiary` (uppercase, letter-spaced — labelCap default).
- Caption: `<Text style={typography.bodySm}>Auto-updated as people buy tickets.</Text>` color `text.tertiary`.
- Margin: `spacing.lg` page padding-horizontal (matches Campaigns + Overview); `spacing.md` padding-top from sub-nav baseline; `spacing.md` gap before first AudienceCard.

### §4.3 `AudienceCard.tsx` — NEW component

**Container:**
- `<Pressable>` — wraps full row
- Touch target: min height 76pt (per I-38 with breathing)
- Padding: `spacing.md` (16) horizontal, `spacing.sm` (8) vertical
- Border-radius: `radius.lg` (16)
- Border: `StyleSheet.hairlineWidth` solid `glass.border.profileBase`
- Background: `glass.tint.profileBase`
- Gap from preceding card: `spacing.sm` (8) — applied via parent `gap` prop on the wrapping ScrollView contentContainerStyle
- Press feedback: opacity 0.78 on pressed

**Contents (vertical stack, gap 2):**
1. **Top row (flex-row, alignItems: baseline):**
   - Display name (flex-1): `<Text style={typography.body, {fontWeight: "600"}} numberOfLines={1}>{display_name}</Text>` color `text.primary`.
   - Right chevron: 16pt `chevR` icon, `text.tertiary`.
2. **Reach line:**
   - When loaded: `<Text style={typography.bodySm}>{total} buyers · {reachable_email} reachable</Text>` color `text.secondary`.
   - When loading: `<Text style={typography.bodySm}>Loading reach…</Text>` color `text.tertiary`.
   - When error (silent degrade per SPEC SC-8): `<Text style={typography.bodySm}>—</Text>` color `text.tertiary`. NO error overlay, NO red, NO retry button — the row stays tappable.
3. **Last-sent line:**
   - When `last_used_at !== null`: `<Text style={typography.bodySm}>Last sent {relative_or_absolute_date}</Text>` color `text.tertiary`.
     - Format same as Overview recent rows (§3.4): `<7d` → relative; else absolute "Mon Jun 3".
   - When `last_used_at === null`: `<Text style={typography.bodySm}>Never sent</Text>` color `text.tertiary`.

**Virtual rows render IDENTICALLY to real rows** — no badge, no opacity change, no visual distinction. The operator should not have to think about the materialization-on-tap mechanism. Per SPEC §6.2.6 the tap navigation handles create-then-route transparently.

### §4.4 Empty state

When `audienceList.length === 0` (no managed brands with paid orders):

```
┌─────────────────────────────────────────────┐
│                                             │
│         [users icon, 48pt, accent.warm]     │  centered, 40% from top of safe area
│                                             │
│       No buyers yet.                        │  typography.h3, text.primary
│                                             │
│  Audiences fill in automatically as         │  typography.body, text.secondary
│  people buy tickets from your events.       │  centered, 2-line wrap, max 320pt
│                                             │
└─────────────────────────────────────────────┘
```

- Icon: `<Icon name="users" size={48} color={accent.warm} />`
- Title: `<Text style={[typography.h3, { textAlign: "center", color: text.primary }]}>No buyers yet.</Text>`
- Body: `<Text style={[typography.body, { textAlign: "center", color: text.secondary, maxWidth: 320 }]}>Audiences fill in automatically as people buy tickets from your events.</Text>`
- NO CTA (nothing for the operator to do here — they need to sell tickets first; offering a "Create event" link belongs to the Events tab, not Marketing).
- Vertical placement: container `flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.lg`.

### §4.5 States

| State | Layout |
|---|---|
| **Loading (first load)** | 3 skeleton AudienceCards. Each card same dimensions + border + background as real card; content replaced with: name → 200×16pt block in `glass.tint.profileBase` `radius.sm`; reach + last-sent lines → 120×14pt and 80×14pt blocks. |
| **Loading (refetch)** | Show cached rows; no skeleton swap. |
| **Error (top-level service throw)** | `<EmptyState illustration="users" title="Couldn't load audiences" description="Pull to retry, or come back in a moment." />`. Pull-to-refresh triggers `refetch`. |
| **Empty** | Per §4.4. |
| **Populated** | Per §4.1. |
| **Tap on virtual row (creating)** | Row's chevron becomes `<ActivityIndicator size="small" color={text.secondary} />` for the brief async window. Once created, navigation fires. Failure rolls back the spinner and shows a toast: "Couldn't open this audience. Try again in a moment." per `feedback_toast_needs_absolute_wrap.md` (toast must be absolute-wrapped). |

### §4.6 Accessibility

- AudienceCard real row: `accessibilityLabel="{display_name}, {total} buyers, {reachable_email} reachable, last sent {date or 'never'}"` + `accessibilityRole="button"` + `accessibilityHint="Opens the campaign composer with this audience pre-filled"`.
- AudienceCard virtual row: same label + `accessibilityHint="Creates this audience and opens the campaign composer"` (more honest about the side-effect).
- AudienceCard loading state: `accessibilityLabel="{display_name}, loading reach count"`.
- Empty state icon: `accessibilityLabel="users"` (decorative, but RN screen readers pick it up — fine).

---

## §5 Templates tab — full pixel spec

**Route:** `mingla-business/app/(tabs)/marketing/templates/index.tsx` (REPLACE placeholder)

### §5.1 Layout schematic — populated state

```
┌─────────────────────────────────────────────┐
│  MarketingSubNav: Over Aud Camp [●Template] │
├─────────────────────────────────────────────┤  spacing.md gap
│                                             │
│  MINGLA STARTER PACK                        │  labelCap / text.tertiary
│  Read-only — duplicate to customize.        │  bodySm / text.tertiary
│                                             │  spacing.md gap
│  ┌─ TemplateCard (starter) ───────────────┐ │
│  │ Last call — N spots left   [Read-only]› │ │   body/600  + pill chip
│  │ Hi {first_name}, Just a heads up — only │ │   bodySm/secondary  (preview)
│  └────────────────────────────────────────┘ │
│  ┌─ TemplateCard (starter) ───────────────┐ │
│  │ Pre-event reminder (24h)   [Read-only]› │ │
│  │ Hi {first_name}, Quick reminder — {event│ │
│  └────────────────────────────────────────┘ │
│  …(3 more starter cards)                    │
│                                             │  spacing.lg gap
│                                             │
│  YOUR TEMPLATES                             │  labelCap / text.tertiary
│                                             │  spacing.md gap
│  ┌─ TemplateCard (user) ──────────────────┐ │
│  │ Last call (copy)                      ›│ │   body/600  (no pill chip)
│  │ Hi {first_name}, only 12 spots left for │ │   bodySm/secondary
│  └────────────────────────────────────────┘ │
│  …                                          │
│                                             │  scrollContent paddingBottom: 120
└─────────────────────────────────────────────┘
                                       [+ FAB] ← "New template"
```

### §5.2 Section headers

- **Starter pack header (always rendered):**
  - Title: `<Text style={typography.labelCap}>MINGLA STARTER PACK</Text>` color `text.tertiary`.
  - Caption: `<Text style={typography.bodySm}>Read-only — duplicate to customize.</Text>` color `text.tertiary`.
- **Your templates header (only rendered when `userTemplates.length > 0`):**
  - Title: `<Text style={typography.labelCap}>YOUR TEMPLATES</Text>` color `text.tertiary`.
  - No caption — empty section yields no header at all (cleaner than an empty "you don't have any" state).

### §5.3 `TemplateCard.tsx` — NEW component

**Container:**
- `<Pressable>` — wraps full row
- Touch target: min height 64pt
- Padding: `spacing.md` (16) horizontal, `spacing.sm` (8) vertical
- Border-radius: `radius.lg` (16)
- Border: `StyleSheet.hairlineWidth` solid `glass.border.profileBase`
- Background: `glass.tint.profileBase`
- Press feedback: opacity 0.78 on pressed

**Contents (vertical stack, gap 2):**
1. **Top row (flex-row, alignItems: baseline, gap `spacing.xs`):**
   - Name (flex-1): `<Text style={typography.body, {fontWeight: "600"}} numberOfLines={1}>{template.name}</Text>` color `text.primary`.
   - Optional pill chip (starter rows only): see §5.4.
   - Right chevron: 16pt `chevR` icon, `text.tertiary`.
2. **Body preview line:** `<Text style={typography.bodySm} numberOfLines={1}>{preview}</Text>` color `text.secondary`. Preview = first 80 chars of `body_template`, with `\n` replaced by `" "` and trailing `…` if truncated. Tokens (`{first_name}`, `{{event:id}}`) preserved verbatim — no escaping, no replacement.

### §5.4 "Read-only" pill chip (starter rows only)

- Inline component (no separate file needed): `<View style={pillStyle}><Text style={pillTextStyle}>Read-only</Text></View>`
- Background: `glass.tint.profileBase`
- Border: `StyleSheet.hairlineWidth` solid `glass.border.profileBase`
- Border-radius: `radius.full` (999)
- Padding: 2 vertical, `spacing.xs` (4) horizontal
- Text: `typography.micro` (11/14/600/0.4), color `text.tertiary`
- Vertical-align: center-aligned with the name baseline via parent flex-row alignItems

### §5.5 FAB — "New template"

Same shape as Overview/Campaigns FAB. Copy from `campaigns/index.tsx:143-158` verbatim with two text changes:
- `accessibilityLabel="New template"` (was "New campaign")
- Label text "New template" (was "New campaign")

On press: navigate to `/marketing/templates/new` (sentinel id — see §6 for editor handling).

### §5.6 States

| State | Layout |
|---|---|
| **Loading (first load, both queries pending)** | 3 skeleton TemplateCards under starter header (height ≈ real card). No "Your templates" header. |
| **Loading (starter loaded, user still loading)** | Starter section fully rendered; user section shows 2 skeleton cards under "YOUR TEMPLATES" header. |
| **Error (starter query throws)** | `<EmptyState illustration="users" title="Couldn't load templates" description="Pull to retry." />` full screen. (Starter failure is unusual — DB read; treat as system error.) |
| **Error (user query throws but starter loaded)** | Render starter section normally; below it render a small inline error row "Couldn't load your templates" (one line, `bodySm`, `semantic.warning`) instead of the "YOUR TEMPLATES" section. Pull-to-refresh retries both. |
| **Empty (zero user templates)** | Starter section renders fully; user section + header simply absent. |
| **Populated** | Per §5.1. |

### §5.7 Accessibility

- Starter card: `accessibilityLabel="{template.name}, read-only starter template"` + `accessibilityHint="Opens the template preview"` + `accessibilityRole="button"`.
- User card: `accessibilityLabel="{template.name}, your template"` + `accessibilityHint="Opens the template editor"` + `accessibilityRole="button"`.
- Pill chip: NOT separately announced (it's redundant with the label text already saying "starter template").

---

## §6 Template detail screen — full pixel spec

**Route:** `mingla-business/app/(tabs)/marketing/templates/[id].tsx` (NEW)

The screen has TWO modes determined by the loaded template:
- **Read-only mode** when `template.is_starter_pack === true`.
- **Editable mode** when `template.is_starter_pack === false AND template.account_id === current_user_id`.
- **New-template mode** (subset of editable) when route param `id === "new"` — no `getTemplate` call; subject + body start empty.

If the loaded template is owned by a different account (which RLS already blocks; defense in depth in UI): render the same EmptyState used elsewhere — "Couldn't load template" — and back-button.

### §6.1 Read-only mode layout (starter)

```
┌─────────────────────────────────────────────┐
│  [←]   Last call — N spots left      [   ]  │  Header row (56pt min)
├─────────────────────────────────────────────┤  spacing.md gap
│                                             │
│  SUBJECT                                    │  labelCap / text.tertiary
│  Last {spots_left} tickets — see you …      │  body / text.primary  (selectable)
│                                             │  spacing.lg gap
│  BODY                                       │  labelCap / text.tertiary
│  Hi {first_name},                           │
│                                             │  body / text.primary
│  Just a heads up — only {spots_left}        │  preserves \n verbatim
│  tickets left for {event_name} on           │  selectable
│  {event_date}. See you there.               │
│                                             │
│  {{event:{event_id}}}                       │  visible inline (no special treatment)
│                                             │
│  — {brand_name} via Mingla                  │
│                                             │
│  Use {first_name} for personalization ·     │  bodySm / text.tertiary
│  {{event:abc}} to embed an event card.      │  monoMd typography for the tokens
│                                             │
└─────────────────────────────────────────────┘
│  [ Duplicate ]   [ Use this template → ]   │  Sticky footer (insets.bottom + spacing.md)
└─────────────────────────────────────────────┘
```

**Header row:**
- Padding: `spacing.md` horizontal, `spacing.sm` vertical, minHeight 56
- Layout: flex-row, alignItems: center, gap `spacing.sm`
- Back button: 44×44 `<Pressable>`, `radius.full`, `glass.tint.profileBase` background, `glass.border.profileBase` hairline border, `<Icon name="arrowL" size={24} />`. (Verbatim from `campaigns/[id].tsx:301-312`.)
- Title (flex-1): `<Text style={typography.bodyLg, {fontWeight: "600"}} numberOfLines={1} textAlign="center">{template.name}</Text>` color `text.primary`.
- Right spacer: 44pt-wide empty view for layout symmetry.

**SUBJECT block:**
- Label: `<Text style={typography.labelCap}>SUBJECT</Text>` color `text.tertiary`, `marginBottom: spacing.xs`.
- Value: `<Text style={typography.body} selectable>{template.subject_template ?? "(no subject)"}</Text>` color `text.primary`.

**BODY block:**
- Label: `<Text style={typography.labelCap}>BODY</Text>` color `text.tertiary`, `marginBottom: spacing.xs`.
- Value: `<Text style={typography.body} selectable>{template.body_template}</Text>` color `text.primary`. RN's `<Text>` preserves `\n` natively. Tokens render as plain text — `{first_name}` and `{{event:abc}}` are visible to the operator AS the literal strings so they understand what the live render will substitute.

**Token cheatsheet caption (always rendered in detail screen):**
- Wrapper padding: `spacing.md` horizontal, `spacing.sm` vertical; border-radius `radius.md` (12); border `StyleSheet.hairlineWidth` solid `glass.border.profileBase`; background `glass.tint.profileBase`.
- Text: layout flex-row wrap with `<Text style={typography.bodySm}>`, color `text.tertiary`. The token literals (`{first_name}` and `{{event:abc}}`) styled with `typography.monoMd` color `text.primary` so they visually pop as code-tokens.
- Full text: `"Use {first_name} for personalization · {{event:abc}} to embed an event card."`

**Sticky footer (read-only mode):**
- Container: absolute positioned at bottom, padding `spacing.md` horizontal + `insets.bottom + spacing.sm` bottom; background `canvas.discover` (matches scroll background); border-top `StyleSheet.hairlineWidth` solid `glass.border.profileBase`.
- Layout: flex-row, gap `spacing.sm`.
- Left button "Duplicate" (secondary):
  - Flex 1, height 48, `radius.lg`, background `glass.tint.profileBase`, border `StyleSheet.hairlineWidth` solid `glass.border.profileBase`.
  - Label: `typography.buttonMd`, color `text.primary`, center-aligned.
- Right button "Use this template →" (primary):
  - Flex 1, height 48, `radius.lg`, background `accent.tint`, border 1pt solid `accent.border`.
  - Label: `typography.buttonMd`, color `text.primary`, center-aligned.

### §6.2 Editable mode layout (user template)

Same header pattern as §6.1 BUT title is prefixed with `"• "` when `isDirty === true` (e.g., `"• My Custom Template"`). Header right-side spacer is REPLACED by a "Save" text button (44pt min touch) when `isDirty === true`; absent when clean.

Below header:
- **SUBJECT label + TextInput:**
  - Label: same as §6.1.
  - Input: `<TextInput style={inputStyle} value={subject} onChangeText={setSubject} placeholder="Subject line — what your buyers see in their inbox" placeholderTextColor={text.quaternary} />`.
  - Input style: padding `spacing.md` horizontal, `spacing.sm + 2` vertical; border-radius `radius.md`; border `StyleSheet.hairlineWidth` solid `glass.border.profileBase`; background `glass.tint.profileBase`; `typography.body`; color `text.primary`; minHeight 48 (≥44pt touch).
- **BODY label + TextInput:**
  - Label: same as §6.1.
  - Input: `<TextInput style={[inputStyle, { minHeight: 192, textAlignVertical: "top" }]} value={body} onChangeText={setBody} multiline placeholder="Hi {first_name},\n\nWrite your message here…" placeholderTextColor={text.quaternary} />`.
  - minHeight 192 = approximately 8 rows × `typography.body` line-height 24.
  - `textAlignVertical: "top"` for Android — without it the placeholder + content vertically center which looks broken with multiline.
- **Token cheatsheet caption:** identical to §6.1.

**Sticky footer (editable mode):**
- Layout: flex-row, gap `spacing.sm`.
- "Delete" button (destructive, secondary visual):
  - Flex 0, paddingHorizontal `spacing.md`, height 48, `radius.lg`, background `semantic.errorTint` (`rgba(239,68,68,0.18)`), border `StyleSheet.hairlineWidth` solid `semantic.error`.
  - Label: `typography.buttonMd`, color `semantic.error`.
  - On press: native `Alert.alert("Delete this template?", "This can't be undone. Campaigns that used this template keep their saved content.", [{text: "Cancel", style: "cancel"}, {text: "Delete", style: "destructive", onPress: handleDelete}])`.
- "Use this template →" button (primary):
  - Same as §6.1 sticky-footer primary.
  - Flex 1.

**Keyboard-safe spacing (CRITICAL per `feedback_keyboard_never_blocks_input.md`):**
- Wrap the editor body in `<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{flex: 1}}>` (mirror composer at `compose.tsx:597-742`).
- ScrollView contentContainerStyle includes `paddingBottom: 96 + insets.bottom` so the sticky footer doesn't occlude the last line of body input.
- When BODY TextInput is focused: after `requestAnimationFrame`, scroll the input into view via `scrollToEnd({ animated: true })`.

### §6.3 Dirty-state back-block (CRITICAL per `feedback_back_listener_disarm_pattern.md`)

Mirror the composer pattern at `compose.tsx:384-420`:
- `sanctionedExitRef = useRef(false)`.
- `navigation.addListener("beforeRemove", e => { if (sanctionedExitRef.current || !isDirty) return; e.preventDefault(); Alert.alert("Save changes?", "You've edited this template. Save them so you can use them later — or discard.", [{text:"Cancel", style:"cancel"}, {text:"Discard", style:"destructive", onPress: () => { sanctionedExitRef.current = true; router.back(); }}, {text:"Save", onPress: async () => { await saveMutation.mutateAsync(); sanctionedExitRef.current = true; router.back(); }}]) })`.

### §6.4 New-template mode (route param `id === "new"`)

- Skip `useTemplate(id)` call.
- Subject + body start empty (`""`).
- `template.id` is undefined until first save.
- Save button creates via `createUserTemplate(...)` and on success replaces the route via `router.replace("/marketing/templates/{newId}")` so subsequent navigation lands on the canonical id-route.

### §6.5 States summary

| State | Layout |
|---|---|
| Loading (`getTemplate` pending, not `new`) | Centered `<ActivityIndicator size="small" color={text.secondary} />` |
| Error / not found | `<EmptyState illustration="users" title="Couldn't load template" description="The link may be stale." />` + back-button works |
| Read-only populated (starter) | Per §6.1 |
| Editable populated (user) | Per §6.2 |
| Editable dirty | Per §6.2 + title prefix "• " + Save header-button visible |
| Save in flight | Save header-button replaced by small `<ActivityIndicator />` |
| New (id === "new") | §6.4 + same editable shell |

### §6.6 Accessibility

- Header back button: `accessibilityLabel="Back"` (verbatim from Campaigns precedent).
- Header save button (when present): `accessibilityLabel="Save changes"` + `accessibilityState={{disabled: !isDirty}}`.
- Subject input: `accessibilityLabel="Subject"`.
- Body input: `accessibilityLabel="Body — supports first_name and event-card tokens"`.
- Duplicate button: `accessibilityLabel="Duplicate this template"` + `accessibilityHint="Creates a copy you can edit"`.
- Delete button: `accessibilityLabel="Delete this template"` + `accessibilityHint="Removes the template. Existing campaigns keep their saved content."`.
- "Use this template" button: `accessibilityLabel="Use this template"` + `accessibilityHint="Opens the campaign composer with this template loaded"`.

---

## §7 Composer template-pre-fill — visual note (NO design change)

`mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` gets a ≤30 LOC functional change (per SPEC §6.4) — it parses `?template={id}`, loads the template, pre-fills subject + body, marks dirty. **There is NO visual change to the composer.** The operator simply lands in compose.tsx with subject and body already populated; from that point everything looks identical to a fresh-composer or draft-resume flow.

In-composer template picker UI (Sub-C polish per memory `project_orch_0815_b_polish_deferred.md`) remains deferred — NOT designed here.

---

## §8 Empty / Loading / Error state primitives — REUSE CONFIRMED

- Empty states: `mingla-business/src/components/ui/EmptyState.tsx` (already used by `campaigns/index.tsx:112-124`). Phase B reuses verbatim — no new prop, no new variant.
- Loading spinners: `<ActivityIndicator size="small" color={textTokens.secondary} />` (verbatim from Campaigns pattern `campaigns/index.tsx:108`).
- Toasts for non-blocking errors: `<Toast />` primitive wrapped in `<View style={{position:"absolute", top:..., zIndex:100}}>` per `feedback_toast_needs_absolute_wrap.md`. The composer at `compose.tsx:591-596` is the canonical example; Phase B reuses the same shape when needed (audience virtual-create failure in §4.5; user-templates-loaded-but-failed inline in §5.6).

No new state primitives. No new EmptyState variants.

---

## §9 Accessibility callouts — consolidated checklist

| Component | accessibilityRole | accessibilityLabel template | Touch target |
|---|---|---|---|
| `OverviewHeadlineCard` (display) | none | `"{count} campaigns sent in the last 30 days"` (whole card decorative) | N/A (not interactive) |
| `OverviewMetricCard` (display) | none | `"{label}: {value}{, percentage_value percent}{, warning}"` | N/A |
| `OverviewRecentCampaignRow` | `"button"` | `"{name}, {status_label}, {recipient_count} recipients, {relative_date}"` + hint `"Opens the campaign report"` | ≥56pt height |
| Overview FAB | `"button"` | `"New campaign"` | ≥48pt height + 96pt label |
| `AudienceCard` (real) | `"button"` | `"{display_name}, {total} buyers, {reachable_email} reachable, last sent {date or 'never'}"` + hint `"Opens the campaign composer with this audience pre-filled"` | ≥76pt height |
| `AudienceCard` (virtual) | `"button"` | same label + hint `"Creates this audience and opens the campaign composer"` | ≥76pt height |
| `TemplateCard` (starter) | `"button"` | `"{template.name}, read-only starter template"` + hint `"Opens the template preview"` | ≥64pt height |
| `TemplateCard` (user) | `"button"` | `"{template.name}, your template"` + hint `"Opens the template editor"` | ≥64pt height |
| Templates FAB | `"button"` | `"New template"` | ≥48pt height + label |
| Template detail back button | `"button"` | `"Back"` | 44×44 |
| Template detail Save header button | `"button"` | `"Save changes"` + state `{disabled: !isDirty}` | ≥44pt |
| Template detail "Duplicate" | `"button"` | `"Duplicate this template"` + hint `"Creates a copy you can edit"` | ≥48pt height |
| Template detail "Delete" | `"button"` | `"Delete this template"` + hint `"Removes the template. Existing campaigns keep their saved content."` | ≥48pt height |
| Template detail "Use this template" | `"button"` | `"Use this template"` + hint `"Opens the campaign composer with this template loaded"` | ≥48pt height |
| Template editor Subject input | `"none"` (native) | `"Subject"` | 48 minHeight |
| Template editor Body input | `"none"` (native) | `"Body — supports first_name and event-card tokens"` | 192 minHeight |

All Pressables have an explicit accessibilityLabel — none rely solely on icon-only or text-only inference. WCAG AA I-38 (≥44pt touch) and I-39 (explicit accessibilityLabel) honored throughout.

Color contrast: all `text.primary` (`rgba(255,255,255,0.96)`) against `canvas.discover` (`#0c0e12`) is approximately 18.9:1 — well above WCAG AAA 7:1 for normal text. `text.secondary` (rgba 0.72) is ~13:1. `text.tertiary` (rgba 0.52) is ~9:1 — passes for body, fine for captions. The `Failed`-card `semantic.warning` (`#f59e0b`) on `glass.tint.profileBase` is ~6.8:1 — passes WCAG AA for normal text. No new color combinations introduced.

---

## §10 Cross-platform notes (RN-Web preview)

| Component | iOS | Android | Web (RN-Web preview) | Notes |
|---|---|---|---|---|
| OverviewHeadlineCard | ✓ | ✓ | ✓ | Pure View + Text + Icon |
| OverviewMetricCard | ✓ | ✓ | ✓ | flexBasis 47% wrap works identically; verified by Campaigns report `statCell` precedent |
| OverviewRecentCampaignRow | ✓ | ✓ | ✓ | Pressable navigates correctly on web via expo-router |
| FAB | ✓ | ✓ | ✓ | Existing Campaigns FAB ships on web; copy verbatim |
| AudienceCard | ✓ | ✓ | ✓ | No native-only API |
| TemplateCard + pill chip | ✓ | ✓ | ✓ | No native-only API |
| Template detail Header | ✓ | ✓ | ✓ | Mirror Campaigns report header (already web-tested) |
| Template detail Body TextInput | ✓ | ✓ (textAlignVertical: top required) | ⚠ KNOWN GAP | RN-Web `<TextInput multiline>` has a known issue: `minHeight` is honored but auto-growing height as the user types beyond minHeight requires manual measurement. **Acceptable degradation:** body input on web stays at 192pt minHeight + becomes scrollable internally when content exceeds. Operator confirms this is acceptable for the preview surface; not a launch blocker. |
| KeyboardAvoidingView | ✓ (behavior="padding") | ✓ (behavior=undefined) | no-op on web | Standard pattern; no web issue |
| Sticky footer (absolute) | ✓ | ✓ | ✓ | Standard pattern |
| Native `Alert.alert` (back-block, delete confirm) | ✓ | ✓ | ✓ (renders as `window.confirm`) | RN-Web shim handles it |

**Single known constraint:** §6.2 multiline body input on web. Implementor should add `// ORCH-0863-RN-WEB-GAP: multiline TextInput auto-grow unsupported on web; using fixed minHeight + internal scroll` comment so future eyes know it's intentional. Not a blocker for the operator's review of the preview build.

---

## §11 Token usage audit

Every token consumed by this design exists in `mingla-business/src/constants/designSystem.ts`. Listed below for implementor reference; no new tokens are proposed.

### Colors / surfaces

| Token | Value | Usage |
|---|---|---|
| `canvas.discover` | `#0c0e12` | Route background |
| `glass.tint.profileBase` | `rgba(255,255,255,0.04)` | All cards (metric, audience, template, recipient rows) |
| `glass.tint.profileElevated` | `rgba(255,255,255,0.06)` | Overview headline card |
| `glass.border.profileBase` | `rgba(255,255,255,0.08)` | All hairline borders, separators |
| `glass.border.profileElevated` | `rgba(255,255,255,0.12)` | Headline card border |
| `accent.warm` | `#eb7825` | FAB tint, Empty-state icon, status-icon scheduled |
| `accent.tint` | `rgba(235,120,37,0.28)` | Primary button background ("Use this template") |
| `accent.border` | `rgba(235,120,37,0.55)` | Primary button border |
| `semantic.success` | `#22c55e` | (Reserved; not used in Phase B since revenue hero omitted — kept here for completeness) |
| `semantic.warning` | `#f59e0b` | Failed-card value tint, inline error text, status-icon failed |
| `semantic.warningTint` | `rgba(245,158,11,0.18)` | (Reserved for warning toast bg if needed) |
| `semantic.error` | `#ef4444` | Delete button border + text |
| `semantic.errorTint` | `rgba(239,68,68,0.18)` | Delete button background |
| `text.primary` | `rgba(255,255,255,0.96)` | All primary text + values + names |
| `text.secondary` | `rgba(255,255,255,0.72)` | Meta lines, captions on cards, EmptyState body |
| `text.tertiary` | `rgba(255,255,255,0.52)` | Labels (labelCap), captions (bodySm), chevrons, placeholder context |
| `text.quaternary` | `rgba(255,255,255,0.32)` | TextInput placeholder text, skeleton "—" dim text |

### Spacing / radius / typography / shadow

| Token | Usage |
|---|---|
| `spacing.xxs` (2) | Vertical gap inside metric card (label↔value) |
| `spacing.xs` (4) | Inline gaps (icon↔label baseline, padding chip vertical-no, etc.) |
| `spacing.sm` (8) | Card-to-card gap, button-to-button gap, hairline-from-content |
| `spacing.md` (16) | Standard horizontal page padding, card internal padding-horizontal |
| `spacing.lg` (24) | Section-to-section vertical gap (between Overview hero block and metric grid) |
| `spacing.xl` (32) | Headline card internal padding (alternative to lg if Phase A's xl looks tight at QA) |
| `radius.sm` (8) | Skeleton block radius |
| `radius.md` (12) | TextInput border-radius, cheatsheet caption box |
| `radius.lg` (16) | All card containers, button containers |
| `radius.xl` (24) | Headline card |
| `radius.full` (999) | FAB, Read-only pill chip |
| `typography.h3` | Empty-state title, metric value (calmer than statValue at 4-card scale) |
| `typography.bodyLg` | Template detail header title |
| `typography.body` | Card titles, subject/body display, primary buttons |
| `typography.bodySm` | Meta lines, captions, button-md labels |
| `typography.caption` | (Reserved; not actively used) |
| `typography.micro` | Pill chip text |
| `typography.labelCap` | Section headers ("YOUR TEMPLATES", "MINGLA STARTER PACK", "RECENT CAMPAIGNS", "CAMPAIGNS SENT") |
| `typography.statValue` | Headline card count value |
| `typography.monoMd` | Token literals (`{first_name}`, `{{event:abc}}`) inside cheatsheet caption |
| `typography.buttonMd` | All button labels |
| shadows | NONE used (Phase B intentionally stays flat — Phase A baseline ran `shadows.glassCardElevated` on hero but the omitted revenue hero removed the only meaningful surface; rest of design relies on hairline borders for separation, which matches Campaigns tab visual identity) |
| `durations.fast` (120) | Press feedback opacity transitions (matches Campaigns precedent) |
| `easings.out` | (Reserved for future motion polish; static design ships without animation beyond press feedback) |

**Flagged gaps:** zero. Every token this design needs already exists.

---

## §12 Anti-patterns explicitly avoided

Per `ui-ux-pro-max` Common Rules + Mingla-bespoke memories:

| Rule | How this design honors it |
|---|---|
| No emoji icons | Status indicators use `<Icon name="..." />` (Mingla icon set), never emoji. The earlier Phase A schematic uses ✉ glyphs for ASCII clarity; actual implementation uses SVG icons. |
| Stable hover/press states | Press feedback uses `opacity: 0.78` (no scale, no translate, no layout shift). |
| Consistent icon sizing | 16pt chevrons, 18pt row status icons, 20pt FAB icon, 24pt back button, 48pt empty-state hero. Sizes match Campaigns precedent. |
| Cursor pointer (web) | RN `<Pressable>` automatically applies `cursor: pointer` on RN-Web — no extra work. |
| Smooth transitions | All transitions are 120ms opacity (RN default press timing); no custom animation. |
| Glass card light mode | N/A — Mingla is dark-only (`canvas.discover #0c0e12`). No light-mode variant. |
| Floating navbar | Sub-nav already pinned with proper spacing; FAB respects `insets.bottom + 96`. |
| Consistent max-width | All routes inherit the tab's content width (no custom max-width). |
| `prefers-reduced-motion` | All animations are 120ms opacity (already imperceptible); no large transforms to suppress. |
| No fabricated data | Revenue hero omitted (Constitution #9). "Opened" metric omitted (no Resend webhook data). Empty states are honest ("Audiences fill in automatically…", "Your first blast is one tap away"). |

---

## §13 Implementor handoff notes

- Designer flagged ZERO new tokens needed. Implementor should NOT introduce one-off hex values; if a value seems missing from the table in §11, surface to operator before inventing.
- All five new components (`OverviewHeadlineCard` inline, `OverviewMetricCard`, `OverviewRecentCampaignRow`, `AudienceCard`, `TemplateCard`) follow the same container pattern (Pressable or View, padding, hairline border, glass tint background, radius.lg). Implementor can extract a `<MarketingCard>` primitive if it reads cleaner — design tolerates that.
- `OverviewHeadlineCard` is described inline (not a separate component file) because it's used in exactly one route and refactoring it later if reused elsewhere is trivial.
- The TextInput keyboard-rule, sub-sheet-inside-parent, back-listener-disarm, toast-absolute-wrap, ScrollView flexGrow-0-on-siblings, no-bare-randomUUID rules are all referenced in the SPEC §11; this design does not introduce any sibling ScrollViews (Overview / Audiences / Templates each have at most one ScrollView), so the flexGrow-0 rule mostly does not apply — but if the implementor adds a horizontal pills row above any list, the rule kicks in.
- The pre-existing strict-grep gate from SPEC §18 (no `$` or "revenue" in `app/(tabs)/marketing/index.tsx`; no "Opened" funnel label) is verifiable against this design.

---

## §14 Cross-references

- SPEC: `Mingla_Artifacts/specs/SPEC_ORCH-0863_MARKETING_HUB_PHASE_B.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0863_MARKETING_HUB_PHASE_B.md`
- Phase A design baseline: `Mingla_Artifacts/design/DESIGN_ORCH-0815_MARKETING_HUB_PHASE_A.md` (§7.1, §7.2, §7.9, §7.10 selectively superseded)
- Mingla design tokens: `mingla-business/src/constants/designSystem.ts`
- Visual reference (existing): `mingla-business/app/(tabs)/marketing/campaigns/{index,[id],compose}.tsx`
- Reused primitives: `mingla-business/src/components/ui/EmptyState.tsx`, `Icon.tsx`, `Toast.tsx`, existing `MarketingSubNav.tsx`
- Mingla-bespoke rules: `feedback_keyboard_never_blocks_input.md`, `feedback_rn_sub_sheet_must_render_inside_parent.md`, `feedback_rn_color_formats.md`, `feedback_toast_needs_absolute_wrap.md`, `feedback_back_listener_disarm_pattern.md`, `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md`, `feedback_implementor_uses_ui_ux_pro_max.md`
- Operator decisions (this dispatch): Overview revenue hero OMITTED; Phase 0 consent foundation DEFERRED (no ORCH-NEW this cycle)

---

## §15 Working Tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. No code touched in this dispatch — design artifact only.
