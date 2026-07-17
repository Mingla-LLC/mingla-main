# DESIGN — ORCH-1384 [partner Brands screen dead end → partner brand-management verbs]

- **Phase:** DESIGN (pixel-precise build contract; joint contract with the SPEC for IMPLEMENT).
- **Author:** mingla-designer+claude, 2026-07-16.
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1384-[partner-brand-management]/` on branch `ORCH-1384-partner-brand-management`.
- **Binding inputs (read verbatim):** `Mingla_Artifacts/specs/SPEC_ORCH-1384_PARTNER_BRAND_MANAGEMENT_VERBS.md`
  (REVIEW-APPROVED — this design lives strictly INSIDE its §4.6 content/verb/state contract; no scope,
  verb, state, or data change) and `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1384_PARTNER_BRAND_MANAGEMENT.md` (F-1..F-10).
- **Design-language sources (real code, read verbatim):** `mingla-business/src/constants/designSystem.ts`
  (the ONLY token source used here), `app/partner/brands.tsx`, `app/brand/[id]/team.tsx`,
  `src/components/ui/{Icon,IconChrome,Button,GlassCard,GlassChrome,Sheet,SheetMobile,Modal,ConfirmDialog,Input,Toast,StatusPill}.tsx`,
  `src/components/team/MemberDetailSheet.tsx`, `src/components/brand/BrandDeleteSheet.tsx`.
- **House destructive-confirm precedents cited (as demanded by dispatch):**
  1. `src/components/brand/BrandDeleteSheet.tsx` — the INLINE-in-sheet stepped confirm + the shipped
     Decision-11 `rejected` state (its header comment explicitly cites
     `feedback_rn_sub_sheet_must_render_inside_parent` as the reason confirms render inside the sheet).
  2. `src/components/team/MemberDetailSheet.tsx` + `src/components/ui/ConfirmDialog.tsx` — the
     destructive-Button + ConfirmDialog pattern for an EXISTING sheet gaining a destructive verb.
  Both are reused verbatim below — new sheet uses pattern 1; the existing MemberDetailSheet keeps its own pattern 2.
- **Glyph ruling:** the Icon set (`Icon.tsx`, 80 glyphs) ALREADY contains `plus`
  (`<Path d="M12 5v14M5 12h14" />`, Icon.tsx:125) — **no new icon asset is needed**. The NOTIFY-LIST
  branch (missing add glyph) did not trigger.

---

## 1. IA & flow

### 1.1 The moments being designed

| Deliverable | User's moment | Decision | Action |
|---|---|---|---|
| D1 Header add-CTA | Partner has ≥1 client brand, wants another | none — recognition | one tap → wizard |
| D2 `PartnerLinkDetailSheet` | "What's happening with THIS brand, and what can I do?" | pick a verb | resend / correct / cancel / disconnect / open dashboard |
| D3 Cancelled rows | Scanning the portfolio; terminal rows must inform, not distract | none | optional tap → read-only record |
| D4 Partner badge + owner disconnect | Owner asks "who is this on my team?" / "how do I end this?" | disconnect or not | confirm-gated disconnect |
| D5 Reject modal | Partner tried to cancel; inventory blocks it | fix events or back out | open dashboard (fastest fix path) or close |
| D6 Expired rows | Invite died silently after 7 days; partner must learn it and revive | resend or not | row tap → Resend |

### 1.2 Screen-to-screen flow

```
/partner/brands (list, all states)
 ├─ header [+] ─────────────────────────► /brand/new?partner_mode=client   (D1; existing wizard)
 ├─ row tap (awaiting_owner | expired) ──► PartnerLinkDetailSheet · snap "full"
 │     ├─ Resend invite ────────► submitting → success(dismiss+toast) | error(inline card)
 │     ├─ Correct email & resend ► inline email input → Send new invite → same terminal states
 │     ├─ Open brand dashboard ──► /brand/{brand_id}
 │     ├─ Cancel invite ─────────► STEP confirm-cancel → confirm → submitting
 │     │        ├─ success ──────► dismiss + toast + list refresh (brand gone from switcher)
 │     │        ├─ has_upcoming_events ► STEP rejected (D5) → Open dashboard | Close(back to detail)
 │     │        └─ error ────────► back to confirm-cancel + inline error card
 │     └─ Close / drag / scrim ──► dismiss
 ├─ row tap (awaiting_stripe | active) ──► PartnerLinkDetailSheet · snap "half"
 │     ├─ Open brand dashboard ──► /brand/{brand_id}
 │     ├─ Disconnect ────────────► STEP confirm-disconnect → confirm → submitting → success | error
 │     └─ Close ─────────────────► dismiss
 └─ row tap (cancelled, any reason) ─────► PartnerLinkDetailSheet · snap "half" · terminal read-only
       └─ Close ─────────────────► dismiss        (NO dashboard verb — SC-14)

/brand/[id]/team (owner view)
 └─ partner member row (badge "Mingla Partner") tap ► MemberDetailSheet
       └─ [owner only] Disconnect partner ► ConfirmDialog(destructive) → confirm → submitting → dismiss | error
          every OTHER member's remove stays inert exactly as today (SC-9)
```

### 1.3 `PartnerLinkDetailSheet` internal state machine (one sheet, stepped — BrandDeleteSheet pattern)

```
step: "detail" (default; per-status verb set; optional inline email expansion within it)
  → "confirmCancel"      (from Cancel invite)
  → "confirmDisconnect"  (from Disconnect)
  → "rejected"           (from confirmCancel submit, typed has_upcoming_events)
submitting = boolean flag on the acting button (Button `loading`), never a separate step
error      = inline danger card within the CURRENT step, never a toast, never dismissal
success    = sheet dismiss + canonical Toast + React-Query invalidation (per SPEC §4.5/§4.6)
Back from any confirm step returns to "detail" with state intact. Backing out never mutates.
```

Justification: confirms render INSIDE the parent sheet (house rule
`feedback_rn_sub_sheet_must_render_inside_parent`, proven precedent BrandDeleteSheet). No dead taps:
every rendered control has a live handler in every state; disabled controls show the disabled visual +
`accessibilityState.disabled`.

---

## 2. Layout & spacing grid

All values are `designSystem.ts` tokens. Grid = the token 4/8 family (`spacing.xs 4 / sm 8 / md 16 / lg 24 / xl 32 / xxl 48`).

### 2.1 D1 — Header add-CTA (`app/partner/brands.tsx`)

- The header row (`styles.header`: row, align center, `paddingHorizontal: spacing.md`,
  `paddingVertical: spacing.sm`, `gap: spacing.sm`) is UNCHANGED.
- The empty right spacer `<View style={styles.headerRightSlot} />` (`width: 36`, brands.tsx:125) is
  REPLACED by:

```tsx
<IconChrome
  icon="plus"
  size={36}
  onPress={handleSetUpFirst}                       // existing handler → /brand/new?partner_mode=client
  accessibilityLabel="Set up another partner brand"
  testID="partner-brands-add-button"
/>
```

- `IconChrome` at `size 36` renders the 18px `plus` glyph and ships a baked-in default
  `hitSlop {4,4,4,4}` → effective touch target **44×44pt** (IconChrome.tsx:79–80, the I-38 contract).
  Do NOT pass a custom `hitSlop`.
- Rendered in **ALL list states** — loading, error, empty, populated (SC-1). The route is always valid.
  Header symmetry is preserved: close-chrome 36 left, title center (`headerMid flex:1`), add-chrome 36 right.
- The zero-links empty-state CTA card stays **byte-identical** (SC-1). Both affordances co-exist in the
  empty state by design: the card teaches, the header persists.
- `active={false}` (default), default glass chrome tint/border. No badge.

*Why `plus` reads as "add another brand" here:* this screen shows exactly one entity type (brand links);
`plus` in the header is the codebase's own add-entity grammar (team screen header invite CTA uses the same
`plus` glyph, team.tsx:316).

### 2.2 D2 — `PartnerLinkDetailSheet` (`src/components/partner/PartnerLinkDetailSheet.tsx`, NEW)

**Container:** house `Sheet` primitive.

- `snapPoint`: `"full"` (90% screen) when opening status is `awaiting_owner` (incl. expired) — 4 verbs +
  potential inline input need the room; `"half"` (50%) for `awaiting_stripe` / `active` / `cancelled`
  (MemberDetailSheet precedent). Status is fixed at open; the snap never changes mid-open.
- Body: `<ScrollView>` via `SmartScrollView` wrapper (BrandDeleteSheet precedent, ORCH-0892-B),
  `keyboardShouldPersistTaps="handled"`, `keyboardDismissMode="on-drag"`,
  `showsVerticalScrollIndicator={false}`.
- Content container: `paddingHorizontal: spacing.lg` (24; on top of the Sheet body's built-in
  `spacing.md` → 40pt effective gutter, matching MemberDetailSheet + BrandDeleteSheet exactly),
  `paddingTop: spacing.md` (16), `paddingBottom: spacing.xl` (32).
- Sheet supplies: drag handle (36×4, `glass.border.pending`), scrim `rgba(0,0,0,0.5)`, glass panel
  (5-layer stack; deltas in §8), keyboard plumbing (`KeyboardRoot` + `KeyboardToolbarRoot` are mounted
  INSIDE the Sheet's Modal window per ORCH-1165/1170 — this is what keeps the inline email input above
  the keyboard; see §7.4).

**Step "detail" layout, top → bottom:**

1. **Identity header** — row, `gap: spacing.md` (16), `alignItems: "center"`.
   - Thumb 48×48, `borderRadius: 24`, `overflow: "hidden"`. Still covers only (same
     `cover_media_type !== "video"` rule as the list). Fallback: `backgroundColor: accent.tint`,
     centered initial letter fontSize 18 / weight "800" / color `accent.warm`.
     (48 not 60: the sheet header is secondary to the list anchor and aligns to the 48pt input height.)
   - Right column (`flex:1`): brand name — `typography.h3` (20/32/600), color `text.primary`,
     `numberOfLines={2}`. Beneath it (`marginTop: 2`) the status row: dot 8×8 `borderRadius 4` +
     status label (`typography.micro` 11/600, `letterSpacing 0.5`, color `text.secondary`), `gap: 6` —
     identical grammar to the list rows. Dot colors per §4.2.
2. **Facts card** — `marginTop: spacing.md`; `padding: spacing.md`; `borderRadius: radius.md` (12);
   `overflow: "hidden"`; `backgroundColor: glass.tint.profileBase`; `borderWidth: 1`;
   `borderColor: glass.border.profileBase` (MemberDetailSheet `descriptionCard` grammar). Internal
   groups separated by `spacing.md`; rows inside a group by 6 (`spacing.xs + 2`).
   - Group A — **INVITED OWNER** (label: 12/600 `text.secondary`, `textTransform: "uppercase"`,
     `letterSpacing: 0.4`, `marginBottom: 6`): value = `invited_owner_email`, 14 `bodySm` `text.primary`,
     `lineHeight 20`, `selectable` (long emails wrap; never truncate — this is the fact F-3 existed for).
   - Group B — **YOUR NOTE** (same label style), rendered ONLY when `personal_note` is non-null/non-empty:
     value = `"{personal_note}"` wrapped in typographic quotes, 14 `bodySm` `text.secondary`, `lineHeight 20`.
   - Group C — **TIMELINE** (same label style): one two-column row per SET timestamp, in lifecycle order
     `invited_at → accepted_at → owner_stripe_connected_at → first_split_at → cancelled_at`; unset
     timestamps render nothing (§4.6: "render only the ones that are set"). Left cell: event name,
     12 `caption` `text.secondary`. Right cell: ABSOLUTE locale date, 12/600 `text.primary`
     (`new Date(iso).toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" })`
     → "Jul 16, 2026"). Event names: "Invited" / "Accepted" / "Payouts connected" / "First split" /
     terminal verb per reason ("Cancelled" | "Declined" | "Revoked" | "Disconnected"; NULL reason → "Cancelled").
3. **Verb stack** — `marginTop: spacing.lg` (24), `gap: spacing.sm` (8) between buttons. Per state:

   **`awaiting_owner` (incl. expired — identical verb set; SC-3, SC-12):**
   - `Button` **primary / lg (52) / fullWidth / leadingIcon "send"** — label **"Resend invite"** —
     `testID="partner-link-resend"`.
   - `Button` **secondary / md (44) / fullWidth / leadingIcon "mail"** — label **"Correct email & resend"**
     — `testID="partner-link-correct-email"`. Tapping it swaps THIS button for the inline expansion block
     (§2.2.1) in place.
   - `Button` **secondary / md / fullWidth / trailingIcon "chevR"** — label **"Open brand dashboard"** —
     `testID="partner-link-open-dashboard"` → `router.push("/brand/{brand_id}")` then dismiss.
   - Destructive zone, `marginTop: spacing.lg` above it (deliberate distance from constructive verbs):
     `Button` **destructive / md / fullWidth** — label **"Cancel invite"** — `testID="partner-link-cancel"`
     → step `confirmCancel`. (md not lg: the destructive verb never outweighs the primary revival verb.)
   - `Button` **ghost / md / fullWidth** — label **"Close"** — `marginTop: spacing.sm` —
     `testID="partner-link-close"` (MemberDetailSheet closing-ghost precedent).

   **`awaiting_stripe` / `active`:**
   - `Button` primary / lg / fullWidth / trailingIcon "chevR" — **"Open brand dashboard"** (the everyday verb earns primary).
   - destructive zone (`marginTop: spacing.lg`): `Button` destructive / md / fullWidth — **"Disconnect"**
     — `testID="partner-link-disconnect"` → step `confirmDisconnect`.
   - `Button` ghost / md / fullWidth — **"Close"**.

   **`cancelled` (terminal read-only; SC-14):** NO verbs except `Button` ghost / md / fullWidth —
   **"Close"** — `marginTop: spacing.lg`. No dashboard verb for ANY cancelled reason (§4.6 "cancelled:
   terminal read-only"; the brand may be soft-deleted). The facts card additionally gains a terminal
   status line as Group D — **STATUS**: value = reason label (per §9 copy table), 14 `bodySm` `text.secondary`.
   ("Invite again" is a SPEC SHOULD — deliberately omitted from v1; recorded in §10.)

#### 2.2.1 Inline "Correct email & resend" expansion (within step "detail")

Replaces the "Correct email & resend" button in-place (no nested card — the Input primitive carries its
own field chrome):

- Label: **"NEW OWNER EMAIL"** — 12/600 `text.secondary`, uppercase, `letterSpacing 0.4`, `marginBottom: 6`.
- `Input variant="email"` (house primitive: 48pt field, `keyboardType email-address`, `autoCorrect false`,
  `autoCapitalize none`, `autoComplete email`, focus border 1.5px `accent.warm` @120ms),
  `placeholder={invited_owner_email}` (the current address — communicates "replacing this"),
  `accessibilityLabel="New owner email"`, `testID="partner-link-correct-email-input"`.
- Helper: **"The old invite link stops working. We'll send a fresh one here."** — `typography.caption`
  (12/16/500 +0.2), color `text.tertiary`, `marginTop: spacing.xs`.
- Validation error (when send tapped with invalid format): **"Enter a valid email address."** —
  caption, color `semantic.error`, `marginTop: spacing.xs`, `accessibilityRole="alert"`; Input border →
  `semantic.error` (BrandDeleteSheet `inputWrapError` grammar). Validation = the edge fn's `EMAIL_RE`
  semantics mirrored client-side (format + non-empty + ≤ EMAIL_MAX); button disabled until non-empty.
- Action row, `marginTop: spacing.md` — two cells `flex:1`, `gap: spacing.sm` (BrandDeleteSheet
  `actionRow` grammar): left `Button` ghost / md — **"Never mind"** (collapses back to the button);
  right `Button` primary / md — **"Send new invite"** — `testID="partner-link-correct-email-send"`,
  `disabled` until input non-empty, `loading` while submitting.

**Step "confirmCancel" layout (SC-3/SC-6 confirm gate):**

1. Title — `typography.h3`, `text.primary`: **"Cancel this invite?"**, `marginBottom: spacing.sm`.
2. Brand line — 14 `bodySm` `text.tertiary`, `marginBottom: spacing.lg`: brand name.
3. Danger card (BrandDeleteSheet `warnCard`+`warnCardDanger` verbatim: row, `alignItems flex-start`,
   `gap spacing.sm`, `padding spacing.md`, `radius.md`, `overflow hidden`,
   bg `rgba(239, 68, 68, 0.08)`, border 1 `rgba(239, 68, 68, 0.32)`):
   - `Icon name="trash" size={18} color={semantic.error}` (18px, non-text indicator).
   - Title: **"This deletes the draft brand"** — 14/600 **`text.primary`** (NOT `semantic.error` — 3.86:1
     fails AA on this surface; the icon + border carry the danger hue; see §4.3).
   - Body (the NON-NEGOTIABLE deletion disclosure, verbatim from the spec):
     **"This cancels the invite and deletes the draft brand you built. This can't be undone."** —
     `typography.caption`, `text.secondary`, `lineHeight 16`.
4. Inline error card slot (only after a failed submit; §5.6 copy) — same danger-card grammar,
   `marginTop: spacing.sm`, `accessibilityRole="alert"`.
5. Action row `marginTop: spacing.lg`, two `flex:1` cells, `gap spacing.sm`:
   - left `Button` ghost / md — **"Keep invite"** — `testID="partner-link-confirm-back"` → step `detail`.
   - right `Button` destructive / md — **"Cancel invite"** — `testID="partner-link-confirm-cancel"`,
     `loading` while submitting (label swaps for house Spinner; layout stable per Button contract).

**Step "confirmDisconnect" layout (SC-8 confirm gate):**

Same skeleton. Title: **"Disconnect from {brand name}?"**. Danger card icon `Icon name="link" size 18
color semantic.error`; card title: **"Future sales stop paying you"** (14/600 `text.primary`); body (the
money truth, verbatim-required semantics): **"You'll stop earning from future sales for this brand.
Money already earned still pays out."** Action row: ghost **"Keep connection"** / destructive
**"Disconnect"** — `testID="partner-link-confirm-disconnect"`.

**Step "rejected" — see §2.5 (D5).**

### 2.3 D3 — Cancelled-row treatment (`app/partner/brands.tsx` list)

Rows keep the existing skeleton (GlassCard, 60px thumb, name / status / subtext, `rowOuter` gap
`spacing.md`). The cancelled delta — a systemic recession, not decoration:

| Element | Live rows (today, unchanged) | Cancelled rows |
|---|---|---|
| Card | `GlassCard variant="elevated" radius="md" padding={spacing.md}` | `GlassCard variant="base" radius="md" padding={spacing.md}` — lower tint (0.04 vs 0.06 white), lower blur (30 vs 34), softer shadow: the row physically recedes |
| Thumb image | opacity 1 | `opacity: 0.55` (RN has no grayscale filter without a new dependency — banned; 0.55 over the dark card reads as muted) |
| Thumb fallback | bg `accent.tint`, letter `accent.warm` | bg `glass.tint.profileElevated` (0.06 white token), letter color `text.tertiary` (decorative — the name beside it carries identity) |
| Brand name | `typography.bodyLg` 18, weight "700", `text.primary` | same size, weight **"600"**, color **`text.secondary`** (9.6:1 — recessed but fully AA) |
| Status dot | per-status semantic color | `backgroundColor: textTokens.tertiary` (existing dead-branch value, now live; 5.58:1 ≥ 3:1 UI minimum, and redundant with the text label) |
| Status label | micro 11/600 ls0.5 `text.secondary` | same type, color **`text.tertiary`** (5.58:1 AA), text = reason label (§9) |
| Subtext | caption `text.tertiary` | unchanged type/color; text = reason verb + `timeAgo(cancelled_at)` (§9) |
| Press | ADD `opacity 0.7` while pressed (see §5.1) | same |
| Tap | opens detail sheet | opens detail sheet in terminal read-only mode |

- **Never dim below `text.tertiary` for any text** — `text.quaternary` composites to 2.91:1 on these
  cards (measured, §4.3) and is BANNED from cancelled-row text.
- Sorting: `STATUS_RANK` unchanged (cancelled = 3 → last); within cancelled, `cancelled_at` desc (SPEC §4.6-3).
- Counts: header "N active · N pending" and the Account row count are already status-filtered — cancelled
  rows MUST NOT alter them (SC-13). No design change to the count line.
- `accessibilityLabel` for cancelled rows: `"{brandName}, {reasonLabel}"` (not "Open {brandName}" —
  honest affordance).

### 2.4 D4 — "Mingla Partner" badge + owner-side Disconnect

**Badge (team list row, `app/brand/[id]/team.tsx`):** rendered in `rowMetaCol` (align flex-end, gap 4)
DIRECTLY BELOW the existing role pill, for exactly the member row whose `user_id` matches an accepted,
non-cancelled link's `partner_account_id` (via `useBrandPartnerLinks(brandId)`, SPEC §4.5):

- Container: row, `alignItems: "center"`, `gap: 4`; `paddingHorizontal: spacing.sm` (8),
  `paddingVertical: 3`; `borderRadius: radius.full`; `backgroundColor: accent.tint`
  (`rgba(235,120,37,0.28)` — a real token); `borderWidth: 1`; `borderColor: accent.border`
  (`rgba(235,120,37,0.55)`).
- `Icon name="award" size={10} color={accent.warm}` (decorative; the text carries meaning).
- Text: **"Mingla Partner"** — 11/600, `letterSpacing 0.2`, color **`textTokens.primary`**
  (10.66:1 on this fill — see §4.3. Deliberately NOT `accent.warm` text like the role pill: warm-on-warm
  measures 4.27:1 on the sheet surface, and the badge must be visually distinct from the adjacent role
  chip anyway — two different facts, two different treatments).
- `testID="team-partner-badge"`. Non-interactive (no dead tap — it is a label inside an already-tappable row).

**Badge (inside `MemberDetailSheet`):** same pill appended to the existing `rolePillRow`
(`marginLeft: spacing.xs + 2` after the role pill; row wraps via `flexWrap: "wrap"`, `rowGap: 4` added to
`rolePillRow` so narrow screens stack the chips).

**Owner-side "Disconnect partner" (inside `MemberDetailSheet`):** slots into the EXISTING actions block
and reuses the component's own shipped confirm pattern (destructive `Button` + `ConfirmDialog`) — no
re-architecture of a live component:

- Gate: `currentRank` = brand_owner AND the entry is the matched partner row → the destructive button
  renders label **"Disconnect partner"** (`Button destructive / lg / fullWidth`, the component's existing
  destructive slot, `testID="member-detail-disconnect-partner"`), wired to `useDisconnectLink`.
- Every OTHER accepted row: the existing "Remove from team" button + `handleRemove` no-op stays
  **byte-identical** (SC-9; general removal remains ORCH-1051's). Non-owner viewing the partner row:
  today's behavior exactly (gate caption pattern untouched).
- `ConfirmDialog` (house `Modal` portal — this component's shipped pattern; renders above the sheet):
  `title="Disconnect this partner?"`,
  `description="They'll lose team access and stop earning from future sales for this brand. Money already earned still pays out."`,
  `confirmLabel="Disconnect"`, `destructive`, `confirmLoading` bound to the mutation,
  `errorMessage` bound to the typed error copy (§5.6), `closeDisabled` while loading,
  `confirmTestID="member-detail-disconnect-confirm"`, `dismissOnScrimTap={false}` (destructive-modal
  option per Modal.tsx contract).
- On success: dialog closes, sheet closes, canonical success Toast **"Partner disconnected"**; list
  refreshes via invalidation (the member row disappears — `removed_at` stamped).

### 2.5 D5 — `has_upcoming_events` reject state (Decision-11; SC-7)

Step "rejected" inside `PartnerLinkDetailSheet` (BrandDeleteSheet's shipped `rejected` step is the
Decision-11 house implementation — inline in the sheet, never a toast, never auto-dismissed):

1. Title — `typography.h3`, `text.primary`: **"Can't cancel yet"**.
2. Danger card (grammar as §2.2 confirm steps): `Icon name="calendar" size={18} color={semantic.error}`;
   card title: **"{N} upcoming event{N===1?"":"s"}"** — 14/600 `text.primary`; body — caption
   `text.secondary`: **"This brand has {N} upcoming event{s}. Cancel {it/them} first, then come back and
   cancel the invite."** (count from the RPC's `DETAIL`, SPEC §4.4-5).
   Card has `accessibilityRole="alert"` (announced on entry).
3. Actions, stacked, `marginTop: spacing.lg`, `gap: spacing.sm`:
   - `Button` primary / md / fullWidth / trailingIcon "chevR" — **"Open brand dashboard"** —
     `testID="partner-link-reject-dashboard"` (the user's next real action is fixing events; give the
     path, don't just refuse).
   - `Button` ghost / md / fullWidth — **"Close"** — `testID="partner-link-reject-close"` → returns to
     step "detail" (the record is still pending; sheet stays open).
4. ZERO writes happened (SC-7) — the copy never implies partial action.

### 2.6 D6 — Expired-row treatment (SC-12)

`isInviteExpired(row)` (SPEC §4.4-6) restyles the `awaiting_owner` row WITHOUT changing rank (still
rank 0 — needs attention) or card variant (still `elevated`):

- Status dot: `semantic.error` (#ef4444; 4.74:1 ≥ 3:1 UI minimum). Red = the token is dead; distinct
  from live-orange `awaiting_owner`, from amber `awaiting_stripe`, from grey `cancelled`. Color is never
  the sole signal — the label states it.
- Status label: **"Invite expired"** — type/color unchanged (micro, `text.secondary`).
- Subtext: **"Expired {timeAgo(invited_at + 7d)}"** — caption `text.tertiary`.
- Row tap → detail sheet, which shows the same "Invite expired" status in the identity header and the
  FULL `awaiting_owner` verb set — **Resend invite (primary/lg) is the revival path** (SC-12). No
  extra "expired" banner in the sheet: the status line + the primary verb ARE the message.
- Detail-sheet facts card is unchanged (timeline still shows "Invited {date}" — honest history).

---

## 3. Type scale (every text element → token)

| Element | Token | Size/LH/Weight/LS | Color |
|---|---|---|---|
| Sheet titles (confirm/reject steps) | `typography.h3` | 20/32/600/0 | `text.primary` |
| Sheet brand name (identity header) | `typography.h3` | 20/32/600/0 | `text.primary` |
| List brand name (live) | `typography.bodyLg` + weight 700 | 18/28/700 | `text.primary` |
| List brand name (cancelled) | `typography.bodyLg` + weight 600 | 18/28/600 | `text.secondary` |
| Status labels (list + sheet) | `typography.micro` + ls 0.5 | 11/14/600/0.5 | `text.secondary` (cancelled rows: `text.tertiary`) |
| Row subtext / helpers / card bodies | `typography.caption` | 12/16/500/0.2 | `text.tertiary` (danger-card body: `text.secondary`) |
| Facts labels (INVITED OWNER…) | 12/600 uppercase ls 0.4 | — | `text.secondary` (MemberDetailSheet `descriptionLabel` grammar) |
| Facts values / danger-card titles | `typography.bodySm` (+600 where noted) | 14/20 | `text.primary` (note body: `text.secondary`) |
| Timeline dates | 12/600 | — | `text.primary` |
| Button labels | `typography.buttonMd` (sm/md) / `buttonLg` (lg) | 14/20/600/0.2 · 16/24/600 | per Button variant |
| Badge "Mingla Partner" | 11/600 ls 0.2 | — | `text.primary` |
| Brand line under confirm titles | `typography.bodySm` | 14/20/400 | `text.tertiary` |

**Dynamic Type:** `allowFontScaling` stays at RN default (true) everywhere. Rows and the facts card have
no fixed heights — vertical padding + `lineHeight` let them grow. `numberOfLines` limits: list brand
name 1 (as today), sheet brand name 2, email UNLIMITED (wraps). Buttons keep `numberOfLines={1}` per the
primitive; labels above are ≤ 24 chars at default scale.

---

## 4. Color & token mapping + numeric WCAG verification

### 4.1 Token usage (no raw values except the two shipped danger-card literals already in the codebase)

- Canvas: `canvas.discover` #0c0e12 (screen), Sheet/Modal primitives own their glass stacks.
- Cards: `GlassCard` variants (`glass.tint/border/highlight.profileBase|profileElevated`).
- Dots: `accent.warm` (awaiting_owner) · `semantic.warning` (awaiting_stripe) · `semantic.success`
  (active) · `semantic.error` (expired) · `text.tertiary` (cancelled).
- Danger cards: bg `rgba(239, 68, 68, 0.08)` + border `rgba(239, 68, 68, 0.32)` — the exact literals
  BrandDeleteSheet ships (`warnCardDanger`); reused verbatim, not new values. (Candidate future tokens —
  noted in §10, not created here.)
- Badge: `accent.tint` bg + `accent.border` border + `accent.warm` icon + `text.primary` text.
- All colors are hex/rgba — RN color-format rule satisfied (no oklch/lab/color-mix anywhere).

### 4.2 Status → dot/label matrix (list row + sheet header, one source of truth)

| Derived state | Dot | Label text | Label copy |
|---|---|---|---|
| awaiting_owner (live) | `accent.warm` | `text.secondary` | "Awaiting Owner" (unchanged) |
| awaiting_owner + expired | `semantic.error` | `text.secondary` | "Invite expired" |
| awaiting_stripe | `semantic.warning` | `text.secondary` | "Awaiting payouts" (unchanged) |
| active | `semantic.success` | `text.secondary` | "Active" (unchanged) |
| cancelled (all reasons) | `text.tertiary` | `text.tertiary` | reason label (§9) |

### 4.3 Numeric contrast verification (WCAG 2.x relative luminance; composited src-over on the real surfaces; script in `Mingla_Artifacts/evidence/ORCH-1384/design_contrast_check.mjs`)

Surfaces: cardBase = `glass.tint.profileBase` over canvas ≈ #16181b · cardElev = profileElevated over
canvas ≈ #1b1c20 · sheetPanel = Sheet fallback (0.92 #14161a) + profileElevated tint ≈ #212327 ·
dangerCard = 0.08 #ef4444 over sheetPanel ≈ #322629.

| Pair (usage) | Ratio | AA (4.5 text / 3.0 UI) |
|---|---|---|
| `text.primary` on cardElev / sheetPanel / dangerCard | 15.70 / 14.52 / 13.50 | PASS |
| `text.secondary` on cardElev / cardBase / sheetPanel / dangerCard | 9.28 / 9.61 / 8.74 / 8.25 | PASS |
| `text.tertiary` on cardElev / cardBase / sheetPanel / canvas | 5.47 / 5.58 / 5.26 / 5.69 | PASS |
| **Cancelled-row text set** (name `secondary`, label+subtext `tertiary` on its `base` card) | 9.61 / 5.58 | **PASS — the greyed rows stay AA** |
| `text.primary` on "Mingla Partner" badge fill (team row / sheet) | 10.66 / 9.41 | PASS |
| StatusDots (UI ≥3:1): accent.warm 6.15 · error 4.74 · warning 8.30 · success 7.83 · tertiary 5.58 | — | PASS |
| `text.quaternary` on cardBase — **2.91** | 2.91 | **FAIL → BANNED for any meaningful text in this feature** (allowed only as the pre-existing Input placeholder, non-essential) |
| `semantic.error` text on sheetPanel (4.16) / dangerCard (3.86) | — | **FAIL for body text → this design puts danger-card TITLES in `text.primary`** and carries the danger hue via icon + border (which pass the 3:1 UI minimum) |
| accent.warm text on role-pill fill over sheetPanel (existing house chip) | 4.27 | marginal-fail, PRE-EXISTING (MemberDetailSheet rolePill); untouched here; the NEW badge deliberately avoids the pairing |
| White on `Button destructive` #ef4444 / `Button primary` #eb7825 | 3.76 / 2.90 | **inherited house primitives** (app-wide; Seth's 2026-06-08 ruling in designSystem.ts:206-213 chose brand consistency for action buttons). Not new debt; every destructive flow here carries AA-passing title+body text making the button label redundant. Flagged, not repaired, per design-only scope. |

---

## 5. Every interactive state

### 5.1 List rows (`brands.tsx`) — all statuses

- **Default:** per §2.3.
- **Pressed:** `opacity: 0.7` while pressed via `Pressable` style function (team.tsx `rowPressed`
  precedent). ← This is NEW for this screen: today's rows have NO pressed feedback (a dead-feel tap —
  fails house interaction rules); the fix ships with this ORCH for ALL rows.
- **Disabled:** never (all rows tappable, incl. cancelled → read-only sheet).
- Loading / error / empty list states: unchanged from today EXCEPT the header add-CTA persists (§2.1).

### 5.2 Header add-CTA

IconChrome built-ins: press scale 0.96 @120ms (`easings.press`), reduce-motion → opacity 0.7, light
haptic on native press-down, disabled opacity 0.32 (never disabled here). Web: primitive defaults.

### 5.3 Sheet verbs (all `Button` primitives — states come from the primitive)

- Default per variant · pressed scale 0.96 @120ms (+haptic native) · web hover +6% alpha ·
  web focus 2px `accent.warm` `:focus-visible` ring · disabled = solid `rgba(255,255,255,0.06)` bg +
  `text.tertiary` label + 1px `rgba(255,255,255,0.10)` border (house disabled contract) · loading =
  Spinner replaces leading icon, label dims 0.7, layout stable.
- **Submitting rule:** the acting button gets `loading`; EVERY other button in the sheet gets
  `disabled` simultaneously (no concurrent verbs, no double-fire). Scrim-tap + drag-dismiss stay enabled
  (mutations are pessimistic; a dismissal never cancels the in-flight RPC and the list refresh reflects
  truth on settle).
- **Success (every verb):** sheet dismisses (Sheet close animation) → canonical `Toast kind="success"`
  (§9 copy) → `partnerBrandLinksKeys.all` invalidation refreshes the list (SPEC §4.5). Toast is the
  self-positioning portal primitive — no wrapper views (its portal satisfies the absolute-wrap rule by
  construction; do NOT hand-build a banner).
- **Error (every verb):** inline danger card in the current step (§9 typed copy), `accessibilityRole="alert"`;
  the acting button returns to enabled ("try again" is the same button). NEVER a silent catch, NEVER
  dismissal-on-error.
- **Reject (`has_upcoming_events`, cancel only):** step "rejected" (§2.5) — not an error card, not a toast.

### 5.4 Inline email input

Idle (1px `glass.border.profileBase`-family Input chrome) → focus (1.5px `accent.warm`, 120ms) →
validation-error (border `semantic.error` + alert caption) → submitting (Input `editable={false}`, send
button `loading`) → success/failure per §5.3. "Never mind" always enabled except while submitting.

### 5.5 Owner-side ConfirmDialog

Idle → `confirmLoading` (Cancel + scrim disabled via `closeDisabled`, confirm shows Spinner) →
`errorMessage` rendered by the primitive above the actions → success closes dialog + sheet + toast.

### 5.6 Typed error copy (service error → user copy; one table, used by both sheets)

| Typed error | Copy |
|---|---|
| `link_not_pending` (409) | "This invite already changed state. Close this and check the list." |
| `link_not_active` | "This connection isn't active anymore. Close this and check the list." |
| `link_not_found` | "This link no longer exists. Close this and refresh." |
| `forbidden` | "You don't have permission to manage this link." |
| `email_send_failed` (502) | "We couldn't send the email. Tap Resend invite to try again." (SC-16: the retry fully cures) |
| network / `server` / unknown | "Something broke on our side. Try again." |

---

## 6. Motion spec (trigger → curve → duration → property → reduced-motion)

| # | Animation | Trigger | Curve | Duration | Property | Reduced-motion |
|---|---|---|---|---|---|---|
| M1 | Sheet open | row tap | primitive spring (damping 22, stiffness 200, mass 1) | — | translateY | 200ms fade (primitive) |
| M2 | Sheet close | verb success / Close / drag>80px / velocity>600 / scrim | `easings.in` cubic | 240ms | translateY + scrim opacity | primitive fallback |
| M3 | Step swap (detail ⇄ confirm ⇄ rejected) | verb tap / back | `easings.out` | `durations.normal` (200ms) | incoming step opacity 0→1 (outgoing swaps instantly — BrandDeleteSheet precedent; opacity ONLY, no translate, no layout animation) | instant swap |
| M4 | Inline email expansion | "Correct email & resend" tap | `easings.out` | `durations.normal` (200ms) | expansion block opacity 0→1 + translateY -4→0 | instant |
| M5 | Row press | press-in/out | Pressable style fn | instant | opacity 1→0.7 | same (opacity is the fallback) |
| M6 | Button/IconChrome press | press-in | `easings.press` | `durations.fast` (120ms) | scale 1→0.96 | opacity 1→0.7 (primitive) |
| M7 | ConfirmDialog open/close | disconnect-partner tap | `easings.out`/`in` cubic | 200/160ms | scale 0.96⇄1 + opacity (primitive) | opacity-only (primitive) |
| M8 | Toast in/out | verb success | `easings.out`/`in` | 220/160ms | translateY + opacity (primitive) | opacity-only (primitive) |

Every animation communicates state (arrival, confirmation, or feedback). Nothing else animates — no
decorative motion anywhere in this feature.

---

## 7. Accessibility

1. **Touch targets ≥44pt:** header IconChrome 36+hitSlop→44 (built-in) · all Buttons md=44 / lg=52
   (sm never used here) · list rows ≥ 92pt tall · Input 48pt · ConfirmDialog actions 44 · Toast close
   32+hitSlop12→56 (primitive). NOTHING interactive below 44pt effective.
2. **Labels & roles:** every Pressable/Button carries `accessibilityRole="button"` +
   `accessibilityLabel` (Button defaults to its label; explicit labels listed in §2). Rows:
   `"{brandName}, {statusLabel}"` (cancelled: reason label; today's "Open {brandName}" is replaced —
   status-in-label is the honest announcement). Sheet drag/scrim labels come from the primitive.
   Danger/reject/error cards: `accessibilityRole="alert"`. Email input: label + hint
   ("Sends a fresh invite to this address").
3. **Reading order** = visual order (single column; no absolute positioning inside content). The
   identity header groups name+status in one accessible container so SR reads "Rockstar Vibes,
   Invite expired" as one unit.
4. **Keyboard never blocks the input (house rule):** Sheet mounts `KeyboardRoot` (per-window
   KeyboardProvider, ORCH-1170) + `KeyboardToolbarRoot` (Done bar, ORCH-1165) inside its Modal window;
   the body ScrollView is `SmartScrollView` with `keyboardShouldPersistTaps="handled"` — the focused
   email input scrolls above the keyboard within the sheet (ORCH-0892-B contract; BrandDeleteSheet is
   the shipped proof of this exact stack).
5. **Contrast:** §4.3 — every NEW text/chip pairing ≥4.5:1, every meaningful non-text indicator ≥3:1,
   with the two inherited primitive pairs explicitly flagged.
6. **Color never the only indicator:** every dot has a text label; expired/cancelled/danger states all
   carry words; the badge carries text, not just hue.
7. **Reduced motion:** every row of §6 has an explicit fallback, all supplied by the primitives plus the
   two instant-swap rules (M3/M4).
8. **One-handed reach:** all verbs live in the bottom-sheet thumb zone; destructive verbs are separated
   by a `spacing.lg` dead zone + two-step confirm (friction by steps, not by unreachable placement).
9. **Dynamic Type:** §3 — no fixed-height text containers; wrap rules stated per element.

---

## 8. Per-platform deltas — Cross-Surface Impact Declaration

| # | Surface | Covered | Delta |
|---|---|---|---|
| 1 | Business iOS | YES | Reference rendering. Real BlurView glass: Sheet/GlassCard/GlassChrome translucent stacks (tints `glass.tint.*` w/ intensities 28/30/34/40); iOS shadows per `shadows.glass*`; haptics on press (primitives). |
| 2 | Business Android | YES (same RN files — parity automatic) | **Glass policy (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`):** all glass in this design flows through the shipped primitives, which already implement the policy — `GlassChrome`/Sheet fall back to the **opaque ≥0.92 fill `rgba(20,22,26,0.92)`** (GlassChrome.tsx:57, SheetMobile.tsx:98) with `overflow:"hidden"` clipping, and every shadow token zeroes Android `elevation` (`androidSafeElevation`, designSystem.ts:26-27). This design introduces ZERO new glass surfaces outside the primitives → no new fallback values needed; iOS translucent + Android opaque values are the primitives' own, cited here as required. Contrast table §4.3 uses the darker fallback-composite surfaces, so Android passes wherever iOS does. |
| 3 | Confirm-presentation choice (explicit per dispatch) | — | **Custom in-app confirms on BOTH platforms — native `Alert` is NOT used.** Rationale: zero `Alert.alert` exists in any partner/team surface (grep-verified); the house patterns are ConfirmDialog (Modal) and inline sheet steps (BrandDeleteSheet); a native Alert would break dark-glass visual continuity and platform-fork the copy. One codepath, identical iOS/Android behavior. |
| 4 | Android hardware back | — | Sheet's Modal `onRequestClose` → `onClose` (primitive): back dismisses the WHOLE sheet from any step. Safe by design — backing out of a confirm step never mutates (§1.3). ConfirmDialog: back closes the dialog only (its own Modal). |
| 5 | Keyboard | — | iOS + Android share the KeyboardRoot/SmartScrollView stack (§7.4); Android `statusBarTranslucent` handled by the primitives. |
| 6 | Business Web preview (adjacent, compiles — not a target) | tolerant | Primitives self-fork: Sheet → SheetWeb (opaque `#16181b` panel, CSS transitions, drag-catch band), Modal → ModalWeb, Button hover/focus states. No design work owed; nothing here breaks the web build. |
| 7 | Consumer iOS/Android, buyer-web, admin | NOT covered | Out of scope per SPEC §3 (zero refs / read-only tolerance). |

---

## 9. Copy blocks (Mingla voice — plain, honest, no drama)

### 9.1 Status labels + cancelled reasons (SPEC §4.6-4 binding list)

| `cancelled_reason` | Row/sheet label | Row subtext (verb + `timeAgo(cancelled_at)`) |
|---|---|---|
| `partner_cancelled` | "Cancelled" | "Cancelled {timeAgo}" |
| `owner_declined` | "Declined by owner" | "Declined {timeAgo}" |
| `invitation_revoked` | "Invite revoked" | "Revoked {timeAgo}" |
| `partner_disconnected` | "Disconnected" | "Disconnected {timeAgo}" |
| `owner_removed` | "Disconnected by owner" | "Disconnected {timeAgo}" |
| NULL (legacy) | "Cancelled" | "Cancelled {timeAgo}" |

Expired: label "Invite expired" · subtext "Expired {timeAgo(invited_at + 7d)}".

### 9.2 Verbs, confirms, results

| Moment | Copy |
|---|---|
| Resend success toast | "Invite sent to {email}" |
| Correct-email helper | "The old invite link stops working. We'll send a fresh one here." |
| Correct-email success toast | "Invite sent to {new email}" |
| Cancel confirm title / card title / card body | "Cancel this invite?" / "This deletes the draft brand" / **"This cancels the invite and deletes the draft brand you built. This can't be undone."** (deletion disclosure — non-negotiable, verbatim) |
| Cancel success toast | "Invite cancelled. {brandName} was deleted." |
| Disconnect confirm title / card title / card body | "Disconnect from {brandName}?" / "Future sales stop paying you" / **"You'll stop earning from future sales for this brand. Money already earned still pays out."** (money truth — verbatim) |
| Disconnect success toast | "Disconnected from {brandName}" |
| Reject title / card title / card body | "Can't cancel yet" / "{N} upcoming event{s}" / "This brand has {N} upcoming event{s}. Cancel {it/them} first, then come back and cancel the invite." |
| Owner disconnect dialog | title "Disconnect this partner?" · description "They'll lose team access and stop earning from future sales for this brand. Money already earned still pays out." · confirm "Disconnect" |
| Owner disconnect success toast | "Partner disconnected" |
| Typed errors | §5.6 table |

---

## 10. Build-ready handoff

### 10.1 Components & primitives (all existing — ZERO new primitives, ZERO new dependencies, ZERO new tokens)

`IconChrome` (icon="plus") · `GlassCard` (variants base/elevated) · `Button` (primary/secondary/ghost/
destructive · md/lg) · `Sheet` (snapPoint "full"/"half") · `SmartScrollView` · `Input` (variant="email")
· `ConfirmDialog` (simple + destructive + confirmLoading + errorMessage) · `Icon` (plus, send, mail,
chevR, trash, link, calendar, award) · `Toast` (canonical portal) · `Avatar` (team rows, unchanged).

### 10.2 testID registry (tester contract)

`partner-brands-add-button` (SPEC-fixed) · `partner-brand-row-{link.id}` · `partner-link-detail-sheet` ·
`partner-link-resend` · `partner-link-correct-email` · `partner-link-correct-email-input` ·
`partner-link-correct-email-send` · `partner-link-open-dashboard` · `partner-link-cancel` ·
`partner-link-confirm-cancel` · `partner-link-confirm-disconnect` · `partner-link-confirm-back` ·
`partner-link-disconnect` · `partner-link-reject-dashboard` · `partner-link-reject-close` ·
`partner-link-close` · `team-partner-badge` · `member-detail-disconnect-partner` ·
`member-detail-disconnect-confirm`.

### 10.3 File → design section map (within the SPEC §8 allowlist only)

| File | Sections |
|---|---|
| `app/partner/brands.tsx` | §2.1 (header CTA), §2.3 (cancelled rows), §2.6 (expired rows), §5.1 (pressed feedback), §4.2 (dot matrix), §9.1 (labels) |
| `src/components/partner/PartnerLinkDetailSheet.tsx` (NEW) | §1.3, §2.2, §2.5, §5.3–5.6, §6, §9 |
| `app/brand/[id]/team.tsx` | §2.4 badge (row) |
| `src/components/team/MemberDetailSheet.tsx` | §2.4 badge (sheet) + owner disconnect |

### 10.4 Design decisions of record (justifications the implementor/tester should not relitigate)

1. `plus` glyph exists — no asset work; NOTIFY-LIST branch void.
2. Confirms are inline sheet STEPS in the new sheet (BrandDeleteSheet pattern, per the
   sub-sheet-inside-parent rule); the existing MemberDetailSheet keeps its own shipped
   ConfirmDialog pattern — minimal-diff over uniformity for a live component.
3. Danger-card titles use `text.primary`, not `semantic.error` (3.86:1 measured fail); hue rides icon+border.
4. `text.quaternary` banned from meaningful text (2.91:1 measured fail).
5. Badge text is white-on-accent-tint (≥9.4:1), intentionally distinct from the role pill's warm-on-tint.
6. Cancelled recession = card variant drop (elevated→base) + one-step text-tier drop — never below AA.
7. Expired dot = `semantic.error` with a redundant text label; rank/attention unchanged.
8. Rejected step offers "Open brand dashboard" — recovery path, not just refusal.
9. "Invite again" on cancelled rows (SPEC SHOULD) deliberately deferred — terminal records stay quiet;
   the header add-CTA covers new setups. Product may revisit post-ship (one secondary button slot reserved
   below the facts card if so).
10. List rows gain pressed feedback (0.7 opacity) — fixes a pre-existing dead-feel tap on this screen.
11. Inherited AA debt on Button primary/destructive label contrast is flagged in §4.3, not repaired
    (design-only scope; primitive owned app-wide; candidate `semantic.errorHover`/`accent.warmHover`
    token work already tracked as D-IMPL-1 in Button.tsx).

### 10.5 Candidate future tokens (NOT created in this ORCH — recorded only)

`semantic.errorCardBg` = rgba(239,68,68,0.08) · `semantic.errorCardBorder` = rgba(239,68,68,0.32)
(both currently component literals in BrandDeleteSheet + reused here verbatim).

---

*Contrast script: `Mingla_Artifacts/evidence/ORCH-1384/design_contrast_check.mjs` (evidence dir is
gitignored by house convention — script lives on disk beside the investigation probes; its full output
is transcribed in §4.3). Downstream: orchestrator REVIEW → IMPLEMENT (mingla-implementor; SPEC + this design = the joint
contract) → TEST (SC-1/2/3/7/9/12/13/14 visual legs against §2–§9) → CLOSE (gated on main green, COMMS-0108 / ORCH-1385).*
