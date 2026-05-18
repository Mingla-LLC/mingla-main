# SPEC — ORCH-0864 [Marketing Composer V2 — inline chip rich-text editor]

> **Status:** DRAFT — awaits operator approval before implementor dispatch.
> **Decision locked:** Concept B (floating insertion bar) + TenTap (Tiptap-in-WebView). See `Mingla_Artifacts/design/DESIGN_ORCH-0864_MARKETING_COMPOSER_V2.md` §4 + §7 + §8.
> **Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

---

## §0 — Layman summary of this spec (read this first)

This spec defines exactly what to build so a Mingla operator opening the campaign composer sees: a clean writing surface, a small toolbar above the keyboard with `[+ Event]`, `[{ } Personalize]`, and `[⋮]` (more) pills, events that appear inline as full-width card blocks they can tap to edit, personalization tokens that appear as small monospace pills, and templates that "melt in" via a side preview drawer with live audience render before commit.

Everything below is a binding contract — the implementor must build to it, the tester must verify against it. 18 numbered success criteria, 4 new ACTIVE invariants, 1 new native dep (`react-native-webview` + `@10play/tentap-editor`), zero new DB tables / RPCs / migrations / edge functions. The composer body string contract (storing `{first_name}` and `{{event:<uuid>}}` byte-for-byte in `channel_payload.body_html`) is preserved unchanged so the send-side renderer (`marketingRenderingService.renderEmail()`) needs zero changes. **EAS OTA is NOT eligible — adding `react-native-webview` as a direct dep is a native module change requiring a full EAS build.**

Bullet-list of every success criterion + every invariant (for operator skim without opening the file):

- **SC-01:** Composer opens with empty subject + body + visible insertion bar above keyboard.
- **SC-02:** Tap `[+ Event]` → inline horizontal scroller of upcoming brand events appears within the bar; tap a card → block event chip inserts at cursor.
- **SC-03:** Tap `[{ } Personalize]` → inline grid of 11 personalization tokens appears; tap any → small inline pill inserts at cursor; bar stays open for chained inserts.
- **SC-04:** Tap `[⋮]` → overflow menu with Link / Divider / Image / **From template…**
- **SC-05:** Subject line has its own mini `[{ } Personalize]` button (events don't apply to subject).
- **SC-06:** Tap any event chip in body → inline expand-in-place editor reveals CTA-label dropdown (`Get tickets` / `RSVP` / `See details`) + `Remove from email`; tapping title navigates to event page.
- **SC-07:** Tap any personalization chip → tiny popover showing preview substitution ("→ Sarah" for `first_name` based on first audience row).
- **SC-08:** Text selection → floating tooltip above selection with `[B] [I] [Link]`.
- **SC-09:** Templates open via overflow → side preview drawer; operator swipes through templates and sees live preview rendered with their audience variables; tap `Apply` replaces draft (confirmation if dirty), tap `Apply at cursor` inserts body fragment without touching subject.
- **SC-10:** Insertion bar pins above keyboard with zero jank on iOS (via `InputAccessoryView`) and Android (via keyboard-event listener with 16pt margin).
- **SC-11:** Composer round-trip is lossless: a draft saved with `body_html = "Hey {first_name}, see ya at {{event:abc-uuid}}"` re-opens identically (chip positions, token preservation, no whitespace drift).
- **SC-12:** V1 draft migration: opening a draft created by the V1 composer parses `body_html` back into TenTap document state cleanly (existing `{first_name}` + `{{event:uuid}}` tokens become chips).
- **SC-13:** Performance: first-paint ≤ 800ms p95 on iPhone 13, ≤ 1200ms p95 on Pixel 6; keystroke latency ≤ 80ms p95 on both.
- **SC-14:** Accessibility: every insertion-bar pill has explicit `accessibilityLabel`, chips report as buttons with descriptive labels, selection tooltip is keyboard-reachable on web preview, color contrast on chip backgrounds meets WCAG AA.
- **SC-15-iOS:** iOS composer renders TenTap canvas inside a `KeyboardAvoidingView` with `InputAccessoryView` toolbar; live-fire smoke on iPhone 17 Pro sim passes Maestro flow at `mingla-business/maestro/orch-0864-composer-v2-ios.yaml`.
- **SC-15-Android:** Android composer renders TenTap canvas with `softInputMode="adjustResize"` + keyboard listener; live-fire smoke on Pixel emu passes Maestro flow at `mingla-business/maestro/orch-0864-composer-v2-android.yaml`.
- **SC-15-Web:** Web preview composer renders TenTap with sticky-bottom bar at <1024px viewport, sticky-right vertical rail at ≥1024px; live-fire smoke via Playwright at `mingla-business/playwright/orch-0864-composer-v2-web.spec.ts`.
- **SC-16:** No `<TextInput>` JSX in `compose.tsx` body region — body editor goes via TenTap bridge only. Subject MAY use native `<TextInput>` (single-line; TenTap overhead unjustified for single-line input) OR be a TenTap single-line region — implementor picks, must justify in implementation report.
- **SC-17:** Existing audience picker, footer (`Save draft` / `Review`), send/schedule mutation, review sheet, sent-confirmation, dirty-state back-block, and draft auto-save are all preserved verbatim from V1 — V2 only swaps the editor canvas + insertion bar + template flow.
- **SC-18:** EAS OTA is explicitly NOT used for this ORCH; CLOSE requires a full EAS build cycle on both iOS + Android. Operator-attested live-fire post-build on both platforms is mandatory for PASS.

New ACTIVE invariants (DRAFT → ACTIVE on CLOSE):

- **I-PROPOSED-MKT-COMPOSER-V2-TOKEN-ROUNDTRIP-LOSSLESS** — `channel_payload.body_html` re-opened in V2 produces a TenTap document whose `toTokenString()` returns the byte-identical input string. Verified by jest test `marketingComposerV2.roundtrip.test.ts`.
- **I-PROPOSED-MKT-COMPOSER-V2-INSERTION-BAR-ALWAYS-VISIBLE** — the insertion bar must be visible whenever the body editor has focus; cannot be hidden by keyboard, modals, or scroll. Verified by strict-grep gate + Maestro live-fire flow.
- **I-PROPOSED-MKT-COMPOSER-V2-SINGLE-RENDERER-TENTAP** — only one rich-text renderer ships in `mingla-business`; no parallel use of `react-native-pell-rich-editor`, custom contenteditable WebViews, or alternative HTML editors. Verified by strict-grep gate.
- **I-PROPOSED-MKT-COMPOSER-V2-NO-DIRECT-TEXTINPUT-IN-BODY** — body editor JSX does not reference `<TextInput>` at the body region; all body keystroke handling goes through the TenTap WebView bridge. Subject may use TextInput (carve-out). Verified by strict-grep gate.

---

## §1 — Scope + non-goals

**Scope:** Replace the body+subject editor inside `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` with a TenTap-backed rich-text editor + a persistent insertion bar (`[+ Event] [{ } Personalize] [⋮]`) + a template side-preview drawer + inline block event chips + inline personalization pills + selection-formatting tooltip. Replace `ComposerStepWhat.tsx`, `EventCardInserter.tsx`, and `EmbeddedEventChips.tsx`. Adopt `react-native-webview` + `@10play/tentap-editor` as new direct deps.

**Non-goals:** Do NOT touch audience picker, footer, send/schedule mutation, review sheet, sent-confirmation, dirty-state back-block, draft auto-save, template CRUD, marketing-send edge function, email render pipeline. Do NOT introduce SMS / RCS composer affordances. Do NOT add image upload / AI copy / A/B subject testing / send-time optimization (separate future ORCHs). Do NOT change `channel_payload` JSONB shape. Do NOT alter `marketingRenderingService.renderEmail()` substitution rules. Do NOT touch the Stripe Connect onboarding flow's `react-native-webview` ban (per-feature, not project-wide).

**Assumptions:** TenTap (`@10play/tentap-editor`) ships on Expo SDK 54 + iOS + Android + Web. Implementor MUST verify before writing native code; if blocked (e.g., New Architecture incompatibility), STOP and surface to operator — do NOT silently swap renderer. `react-native-webview` is allowed as a transitive dep in `mingla-business` (already present in package-lock.json via expo-auth-session); promoting it to a direct dep does not violate the per-feature Stripe Connect ban.

---

## §2 — Affected Surfaces

- **Consumer iOS** — NOT in scope (no Marketing Hub on consumer app).
- **Consumer Android** — NOT in scope (no Marketing Hub on consumer app).
- **Buyer/anonymous Web** — NOT in scope (anon buyer routes do not expose composer).
- **Business iOS** — IN SCOPE. New composer canvas + insertion bar visible to operators in `app/(tabs)/marketing/campaigns/compose.tsx`. Manual parity vs Android (separate keyboard avoidance code paths).
- **Business Android** — IN SCOPE. Same composer, separate `softInputMode` + keyboard listener implementation. Manual parity vs iOS.
- **Admin Web** — NOT in scope (no marketing tools on admin).
- **Business Web preview** — IN SCOPE. TenTap WebView is web-native there; insertion bar adapts to sticky-bottom <1024px / sticky-right ≥1024px. Manual parity vs mobile (different layout).

---

## §2.5 — Cross-Surface Impact (manual parity — separate SC per surface)

| Surface | User-visible behaviour | Files touched | Parity model |
|---|---|---|---|
| Business iOS | TenTap editor in body region, InputAccessoryView toolbar above keyboard, inline horizontal-scroll event picker, personalization grid palette, side-drawer template preview. | `app/(tabs)/marketing/campaigns/compose.tsx` + new `src/components/marketing/ComposerV2/*` | Shared TenTap WebView; iOS-specific keyboard avoidance via `InputAccessoryView` |
| Business Android | Same canvas, same chips, same drawer. Insertion bar follows keyboard via Android `Keyboard.addListener` + 16pt margin. | Same files | Same TenTap WebView; Android-specific keyboard-event handler |
| Business Web preview | Same canvas. Insertion bar sticky-bottom <1024px viewport, sticky-right vertical rail ≥1024px. Drawer slide-in-from-right at ≥768px. | Same files | Same TenTap WebView (native web target); responsive layout via existing dimension hook |

Parity is **manual** on every dimension that touches keyboard / layout / native UIView. SC-15-iOS, SC-15-Android, SC-15-Web are explicitly separate so the implementor cannot ship one and skip the others.

---

## §3 — Invariants

### Invariants preserved (carry-over from prior ORCHs)

| ID | Statement | Verification |
|---|---|---|
| I-PROPOSED-MKT-TEMPLATE-TOKENS-VERBATIM | `body_html` stores `{first_name}` + `{{event:<uuid>}}` byte-for-byte | Round-trip test (SC-11, SC-12) + strict-grep that no token rewriting helpers exist |
| I-PROPOSED-MKT-STARTER-TEMPLATES-READ-ONLY | Starter pack templates cannot be edited by V2 (template preview drawer respects `is_starter_pack`) | Unit test on `marketingTemplateService.assertNotStarterPack` (already exists from ORCH-0863) |
| I-PROPOSED-MKT-PHASE-B-NO-NEW-TABLES | Zero new DB tables / RPCs / migrations | `git diff` shows no `supabase/migrations/` additions; strict-grep |
| I-PROPOSED-MKT-AUDIENCE-LAZY-VIRTUAL-ROW | Audience picker eager-virtual-row discovery still works | Existing audience hook unchanged |
| I-RN-SUB-SHEET-INSIDE-PARENT | Template drawer + chip-edit popover render inside parent `KeyboardAvoidingView` | Manual code review + Maestro flow (no invisible drawer) |
| I-KEYBOARD-NEVER-BLOCKS-INPUT | Subject + body editor remain visible above keyboard | Maestro flow asserting visible-area assertion |
| I-RN-COLOR-FORMATS | Chip backgrounds use hex/rgb/hsl/hwb only | Strict-grep gate (already exists) |
| I-BACK-LISTENER-DISARM | Sanctioned exits (template apply, send) flip `sanctionedExitRef.current = true` before navigation | Code review (V1 pattern preserved) |
| I-WCAG-AA-TOUCH-44PT | Every insertion-bar pill + chip ≥ 44×44pt touch target | Maestro hit-area probe + manual code review |

### New invariants (DRAFT in this spec → ACTIVE on CLOSE)

| ID | Statement | Verification |
|---|---|---|
| **I-PROPOSED-MKT-COMPOSER-V2-TOKEN-ROUNDTRIP-LOSSLESS** | `channel_payload.body_html` re-opened in V2 → TenTap doc → `toTokenString()` equals input byte-for-byte for the full 11-token vocabulary + multi-event embeds + mixed inline/block. | `marketingComposerV2.roundtrip.test.ts` — at least 12 round-trip fixtures including empty, whitespace-only, single token, all 11 tokens, multiple events, mixed personalization+events, Unicode, emoji-in-body, very long body (≥ 4KB). |
| **I-PROPOSED-MKT-COMPOSER-V2-INSERTION-BAR-ALWAYS-VISIBLE** | Insertion bar must remain visible whenever body editor has focus. Cannot be obscured by keyboard, modals, scroll. | Maestro flow: focus body, type 50 lines, scroll → bar stays pinned. Strict-grep: no `display: none` / `pointerEvents: "none"` toggles on bar in code. |
| **I-PROPOSED-MKT-COMPOSER-V2-SINGLE-RENDERER-TENTAP** | Only one rich-text renderer in `mingla-business`. | Strict-grep: forbid `react-native-pell-rich-editor`, alternative HTML editor packages, and direct `WebView` rich-text bridges outside the TenTap wrapper. |
| **I-PROPOSED-MKT-COMPOSER-V2-NO-DIRECT-TEXTINPUT-IN-BODY** | Composer body JSX does not include `<TextInput>` at the body region. | Strict-grep gate at `.github/scripts/strict-grep/orch-0864-composer-v2.mjs`. |

---

## §4 — Per-layer specification

### §4.1 Database — UNCHANGED

Zero migrations. Zero RPC changes. `channel_payload` JSONB shape stays:

```ts
{
  kind: "email";
  subject: string;
  body_html: string;          // stores token strings verbatim
  body_text: string;          // derived via stripHtml() on save
  embedded_events?: string[]; // derived from {{event:uuid}} tokens in body_html
}
```

### §4.2 Edge functions — UNCHANGED

Zero edge function changes. `marketing-send`, `marketing-track-click`, `marketing-unsubscribe` keep current behaviour. Server-side render via `marketingRenderingService.renderEmail()` reads `body_html` and substitutes tokens — same code path as V1.

### §4.3 Services — minor additions only

**New file:** `mingla-business/src/services/marketing/tenTapTokenBridge.ts`

Exports two pure functions:

```ts
/**
 * Parse a token-bearing body_html string into TenTap document JSON.
 * Recognizes:
 *   - {first_name} | {brand_name} | {event_name} | {event_date} | {event_time}
 *     | {doors_open} | {event_url} | {spots_left} | {previous_event_name}
 *     | {next_event_name} | {event_id}    → inline personalization node
 *   - {{event:<uuid>}}                    → block event-card node
 *   - <p>…</p> | <br> | <strong> | <em> | <a href>  → standard Tiptap nodes
 * Returns TenTap-compatible ProseMirror JSON.
 */
export function bodyHtmlToTenTapDoc(bodyHtml: string): TenTapDocument;

/**
 * Inverse: serialize TenTap document JSON back to body_html string.
 * GUARANTEE: bodyHtmlToTenTapDoc → toBodyHtml is byte-identical for any
 * input produced by V1 composer or V2 composer.
 */
export function toBodyHtml(doc: TenTapDocument): string;
```

Error contract: both functions THROW on malformed input (do not silently coerce). Caller (compose.tsx) catches and surfaces to operator via existing `errorBanner` state.

**No changes to:**
- `marketingCampaignService.ts`
- `marketingTemplateService.ts`
- `marketingAudienceService.ts`
- `marketingRenderingService.ts`
- `marketingOverviewService.ts`

### §4.4 Hooks — one new, none modified

**New file:** `mingla-business/src/hooks/marketing/useTenTapEditor.ts`

Wraps the TenTap `useEditorBridge` hook with Mingla-specific config:
- `bridgeExtensions` = TenTap defaults + custom `PersonalizationChip` inline node + custom `EventChip` block node
- `initialContent` derived from `bodyHtmlToTenTapDoc(body)`
- Exposes: `editor`, `insertEventChip(eventId, title, date, ctaLabel)`, `insertPersonalizationChip(token)`, `getBodyHtml()`, `onSelectionChange` callback, `onChange` callback

Cache invalidation: N/A (no React Query).

### §4.5 Components — 4 new, 3 replaced, 1 removed

**New components** (all under `mingla-business/src/components/marketing/ComposerV2/`):

| Component | Purpose | Props |
|---|---|---|
| `ComposerV2Editor.tsx` | TenTap WebView host + InputAccessoryView toolbar mount | `value: string` (body_html), `onChange(html)`, `onSelectionChange`, `subject: string`, `onSubjectChange`, `previewVariables: PreviewVariables`, `brandEvents: EventCardOption[]`, `onOpenTemplateDrawer()` |
| `InsertionBar.tsx` | The 3-pill persistent bar | `state: "closed" \| "events-open" \| "personalize-open" \| "overflow-open"`, `onStateChange`, `events: EventCardOption[]`, `onInsertEvent`, `onInsertPersonalization`, `onOpenLink`, `onOpenTemplateDrawer`, `onInsertDivider` |
| `EventChipNode.tsx` | Block-level event card rendered inside TenTap canvas (registered as a Tiptap node view) | `eventId`, `title`, `dateLabel`, `coverUrl \| null`, `ctaLabel`, `onEdit(eventId)`, `onRemove(eventId)` |
| `TemplatePreviewDrawer.tsx` | Side-drawer that swipes through templates + renders live preview | `visible`, `onClose`, `templates: MarketingTemplate[]`, `previewVariables`, `currentIndex`, `onIndexChange`, `onApplyReplace(template)`, `onApplyAtCursor(template)`, `currentDraftIsDirty` |

**Replaced components** (V1 file deleted, V2 file under `ComposerV2/`):

| Old | New |
|---|---|
| `ComposerStepWhat.tsx` | Replaced by `ComposerV2Editor.tsx` + `InsertionBar.tsx` |
| `EventCardInserter.tsx` | Replaced by inline event scroller inside `InsertionBar.tsx` (no modal sheet) |
| `EmbeddedEventChips.tsx` | DELETED — chips now live inside body via `EventChipNode.tsx` |

**Modified:**
- `compose.tsx` — swap `<ComposerStepWhat … />` for `<ComposerV2Editor … />`, delete `<EmbeddedEventChips … />`, delete `handleInsertEventCard` (handler moves into `ComposerV2Editor`), keep all other state/effects/handlers verbatim.

**State handling on `ComposerV2Editor`:** loading (initial TenTap WebView spin-up shows skeleton), error (parse error → caller's `errorBanner` toast), empty (placeholder text "Write your message…"), populated (rendered chips + text), submitting (disabled toolbar via `editor.setEditable(false)`).

### §4.6 Native deps

**New direct deps** (added to `mingla-business/package.json`):

```json
"react-native-webview": "13.13.5",
"@10play/tentap-editor": "^0.7.0"
```

Implementor MUST verify SDK 54 compatibility before installing. If a different TenTap version is required, surface in implementation report.

`react-native-keyboard-controller` is OPTIONAL — implementor evaluates whether existing `KeyboardAvoidingView` + Android keyboard listener satisfies SC-15; if not, adds it with a justification line in the implementation report.

### §4.7 WebView bridge contract

The TenTap WebView communicates with the RN host via the standard TenTap bridge. Custom bridge extensions Mingla adds:

| Bridge method | Direction | Payload | Effect |
|---|---|---|---|
| `insertEventChip` | RN → WebView | `{ eventId, title, dateLabel, coverUrl, ctaLabel }` | Inserts block `EventChipNode` at current cursor |
| `insertPersonalizationChip` | RN → WebView | `{ token: PersonalizationToken }` | Inserts inline `PersonalizationChipNode` at current cursor |
| `setBody` | RN → WebView | `{ doc: TenTapDocument }` | Replaces entire document (used by template apply + draft hydration) |
| `getBody` | RN → WebView (sync via callback) | — | Returns serialized `body_html` string |
| `setEditable` | RN → WebView | `boolean` | Disables editing (used during submit) |
| `onChange` | WebView → RN | `{ html: string }` | Fires on every keystroke (debounced inside TenTap to ~120ms) |
| `onSelectionChange` | WebView → RN | `{ from: number, to: number }` | Fires when selection changes; used to show/hide formatting tooltip |
| `onChipEditRequest` | WebView → RN | `{ kind: "event" \| "personalization", id }` | Operator tapped a chip — host opens inline popover |
| `onChipRemoveRequest` | WebView → RN | `{ kind, id }` | Operator chose Remove from chip popover |

Bridge error contract: on round-trip mismatch (`getBody` returns string that does NOT match `bodyHtmlToTenTapDoc → toBodyHtml` round-trip), host logs to console and sets `errorBanner = "Composer state out of sync. Tap Save draft to retry."` — never silently overwrites operator content.

### §4.8 Insertion-bar state machine

```
       ┌──────────┐ +Event tap   ┌────────────────┐
       │ closed   │─────────────▶│ events-open    │
       │          │              │ (horiz scroller│
       │          │              │  of brand evts)│
       └──────────┘              └────────────────┘
            ▲                            │
            │  tap outside / select event │
            └────────────────────────────┘

       ┌──────────┐ {} tap       ┌────────────────┐
       │ closed   │─────────────▶│ personalize-   │
       │          │              │ open (grid of  │
       │          │              │ 11 tokens)     │
       └──────────┘              └────────────────┘
            ▲ tap outside;        │ tap token: stays open
            │ also: select token  │ for chained inserts
            │                     │
            └─backspace×2 ────────┘

       ┌──────────┐ ⋮ tap        ┌────────────────┐
       │ closed   │─────────────▶│ overflow-open  │
       │          │              │ (Link/Divider/ │
       │          │              │  Image/Template│
       │          │              │  Apply image)  │
       └──────────┘              └────────────────┘
            ▲ tap outside;        │ tap item: closes
            │ tap any item        │ + opens linked
            └────────────────────┘  drawer/dialog
```

Only one panel open at a time. Opening any panel while another is open closes the previous one. `Keyboard.dismiss()` does NOT close panels (bar persists with keyboard).

### §4.9 Template drawer behaviour

- Triggered from `overflow-open → From template…`
- Slides in from right at ≥768px viewport; slides up from bottom at <768px.
- Loads templates via existing `useTemplates` hook (no new hook).
- Live preview rendered via `marketingRenderingService.renderEmailPreview(template.body_template, previewVariables, brandName, brandHeader)` — debounced 250ms on template index change; in-flight preview render is cancelled when operator swipes again before previous resolves.
- Two CTAs: `Apply` (full replace; confirmation `"Replace current draft?"` if `isDirty || body.length > 0`); `Apply at cursor` (insert template body fragment at current cursor position; subject untouched).
- Drawer dismiss: swipe right / tap outside / Escape on web. Dismiss does NOT apply.
- Drawer respects `is_starter_pack`: starter templates apply normally (read-only is about EDITING templates, not USING them).

### §4.10 Selection formatting tooltip

When `from !== to` (selection exists) and body editor has focus: floating tooltip appears above selection with `[B] [I] [Link]`.

- `[B]` toggles bold mark on selection.
- `[I]` toggles italic mark on selection.
- `[Link]` opens inline link editor (URL field + Apply button).

Tooltip hides on collapse selection or blur. Tooltip MUST NOT overlap the insertion bar (anchor above selection; if selection near bottom of screen, anchor below).

### §4.11 Subject row

Subject is a SINGLE-LINE text input above body editor. Implementor decides:

(Option A) Native RN `<TextInput>` for subject; the `[{ } Personalize]` mini-button right of the subject label injects tokens via existing `insertVariableAtCursor` helper (V1 already supports this for subject).

(Option B) TenTap single-line region for subject (no rich text, only personalization chips).

Either is acceptable. Implementor must justify pick in implementation report. SC-16 carve-out permits `<TextInput>` for subject.

---

## §5 — Numbered success criteria

(Reproduced from §0 for canonical reference — each is independently testable.)

SC-01 through SC-18 as listed in §0.

Each SC's test mapping is in §8.

---

## §6 — File manifest

### New files

| Path | Purpose |
|---|---|
| `mingla-business/src/services/marketing/tenTapTokenBridge.ts` | Pure parser/serializer between `body_html` token strings and TenTap doc JSON |
| `mingla-business/src/services/marketing/__tests__/tenTapTokenBridge.test.ts` | Round-trip + adversarial token preservation tests (implementor happy-path) |
| `mingla-business/src/hooks/marketing/useTenTapEditor.ts` | Hook wrapping TenTap `useEditorBridge` with Mingla node extensions |
| `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx` | Top-level editor canvas (subject + body + selection tooltip + InputAccessoryView mount) |
| `mingla-business/src/components/marketing/ComposerV2/InsertionBar.tsx` | Persistent bar + state machine + inline panels |
| `mingla-business/src/components/marketing/ComposerV2/EventChipNode.tsx` | Tiptap node view for block event chips |
| `mingla-business/src/components/marketing/ComposerV2/PersonalizationChipNode.tsx` | Tiptap node view for inline personalization chips |
| `mingla-business/src/components/marketing/ComposerV2/TemplatePreviewDrawer.tsx` | Side drawer with template swiper + live preview + Apply CTAs |
| `mingla-business/src/components/marketing/ComposerV2/SelectionFormattingTooltip.tsx` | Floating B/I/Link tooltip |
| `mingla-business/src/components/marketing/ComposerV2/__tests__/composerV2Roundtrip.test.tsx` | Tester adversarial round-trip + state-machine tests |
| `mingla-business/maestro/orch-0864-composer-v2-ios.yaml` | iOS sim live-fire flow |
| `mingla-business/maestro/orch-0864-composer-v2-android.yaml` | Android emu live-fire flow |
| `mingla-business/playwright/orch-0864-composer-v2-web.spec.ts` | Web preview Playwright flow |
| `.github/scripts/strict-grep/orch-0864-composer-v2.mjs` | CI gate enforcing 4 new invariants |

### Modified files

| Path | Change |
|---|---|
| `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` | Swap `<ComposerStepWhat>` → `<ComposerV2Editor>`; delete `<EmbeddedEventChips>` + `handleInsertEventCard` + cursor-tracking state (now lives in `useTenTapEditor`); keep all other handlers/effects |
| `mingla-business/package.json` | Add `react-native-webview` + `@10play/tentap-editor` deps |
| `mingla-business/package-lock.json` | Regenerated by npm install |
| `mingla-business/ios/Podfile.lock` | Regenerated by `pod install` (native module) |
| `.github/workflows/strict-grep-mingla-business.yml` | Register `orch-0864-composer-v2.mjs` per `feedback_strict_grep_registry_pattern.md` |
| `Mingla_Artifacts/WORLD_MAP.md` | Status open → closed at CLOSE time (orchestrator step) |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Flip 4 DRAFT → ACTIVE at CLOSE |
| `Mingla_Artifacts/MASTER_BUG_LIST.md` | Move ORCH-0864 entry on CLOSE |
| `Mingla_Artifacts/AGENT_HANDOFFS.md` | Update dispatch chain |

### Deleted files

| Path | Reason |
|---|---|
| `mingla-business/src/components/marketing/ComposerStepWhat.tsx` | Replaced by `ComposerV2Editor` + `InsertionBar` |
| `mingla-business/src/components/marketing/EventCardInserter.tsx` | Replaced by inline event scroller in `InsertionBar` |
| `mingla-business/src/components/marketing/EmbeddedEventChips.tsx` | Chips now inline in body via `EventChipNode` |
| `mingla-business/src/components/marketing/__tests__/EmbeddedEventChips.test.tsx` (if exists) | Subject under test deleted |

---

## §7 — Implementation order

1. **Native deps + pod install** — Add `react-native-webview` + `@10play/tentap-editor` to `package.json`; `npm install`; `cd ios && pod install`. Verify `npx expo prebuild --clean` succeeds (no native conflicts). Commit lockfiles.
2. **Token bridge service** — Build `tenTapTokenBridge.ts` with `bodyHtmlToTenTapDoc` + `toBodyHtml`. Write `tenTapTokenBridge.test.ts` round-trip cases FIRST (test-driven), then implement until all pass. This is the foundation — no UI work until round-trip is lossless.
3. **Custom Tiptap node views** — `EventChipNode.tsx` + `PersonalizationChipNode.tsx`. Register as Tiptap extensions in the bridge config.
4. **Hook** — `useTenTapEditor.ts` wiring the bridge + node extensions + bridge-method exposure.
5. **Editor canvas** — `ComposerV2Editor.tsx` mounts the TenTap WebView, wires subject + selection tooltip + initial hydration via `bodyHtmlToTenTapDoc`.
6. **Insertion bar** — `InsertionBar.tsx` with state machine + three inline panels (events horiz scroller / personalization grid / overflow menu).
7. **Selection tooltip** — `SelectionFormattingTooltip.tsx` shown on `onSelectionChange` when `from !== to`.
8. **Template drawer** — `TemplatePreviewDrawer.tsx` with swiper + live preview + Apply CTAs.
9. **Wire into compose.tsx** — swap V1 components for V2; delete `EmbeddedEventChips` + `handleInsertEventCard`; preserve everything else.
10. **iOS InputAccessoryView keyboard pinning** — verify bar stays above keyboard on iOS sim live-fire.
11. **Android keyboard listener** — implement keyboard-event listener + 16pt margin; verify on Android emu live-fire.
12. **Web responsive** — sticky-bottom <1024px, sticky-right ≥1024px; verify in `expo --web`.
13. **Strict-grep gate** — write `orch-0864-composer-v2.mjs` with 4 invariant checks + `--self-test` mode. Register in workflow YAML.
14. **Maestro flows** — write iOS + Android Maestro YAML flows asserting end-to-end composer usage.
15. **Playwright flow** — write web Playwright flow.
16. **Operator-attested live-fire** — Implementor produces dev build, operator runs through Maestro flow plus manual edge cases on real device (iPhone + Android).
17. **Implementation report** — receipts table + spec traceability + invariant verification + parity check + regression test citations + EAS-build instructions (NOT OTA).

---

## §8 — Regression-test plan

Per ORCH-0840 §0.5 — implementor happy-path + tester adversarial, both fails-on-revert verified, both ship in same PR as the fix.

### Implementor happy-path tests

| Test ID | File | Scenario | Layer |
|---|---|---|---|
| **T-01** | `tenTapTokenBridge.test.ts` | Empty body → doc → body equals `""` | Service |
| **T-02** | `tenTapTokenBridge.test.ts` | Body with all 11 personalization tokens → doc → body byte-identical | Service |
| **T-03** | `tenTapTokenBridge.test.ts` | Body with 3 event-card tokens + interleaved personalization → doc → body byte-identical | Service |
| **T-04** | `tenTapTokenBridge.test.ts` | Body with `<strong>` + `<em>` + `<a href>` + token mix → doc → body byte-identical (HAPPY PATH for SC-11 + SC-12; **fails-on-revert verification required** by stripping the token-preservation regex in the parser) | Service |
| **T-05** | `tenTapTokenBridge.test.ts` | V1 draft fixture (`"Hi {first_name}, see ya at {{event:abc-uuid}}"`) parses + serializes byte-identical | Service |
| **T-06** | `composerV2Roundtrip.test.tsx` (component) | Mount `<ComposerV2Editor value="…" />` with token body, call `getBody()` via ref, assert byte-identical | Component |
| **T-07** | `composerV2Roundtrip.test.tsx` | Insertion bar state machine: open events panel, open personalize panel, assert previous closes | Component |

T-04 is the designated fails-on-revert test (most likely to catch a regression in the parser). Implementor MUST verify by reverting the token-preservation regex and confirming T-04 FAILS, then restoring and confirming PASS. Cite the commit hash in implementation report.

### Tester adversarial tests

| Test ID | File | Adversarial angle |
|---|---|---|
| **TA-01** | `composerV2Adversarial.test.tsx` | Malformed token in body (`{firstname}` with no underscore; `{{event:not-a-uuid}}`) → bridge MUST throw, not silently coerce |
| **TA-02** | `composerV2Adversarial.test.tsx` | 4KB body with 50 interleaved tokens + Unicode + emoji → round-trip byte-identical (stress) |
| **TA-03** | `composerV2Adversarial.test.tsx` | Chip removal via `onChipRemoveRequest`: assert orphaned token cleaned from body string + no double-space residue |
| **TA-04** | `composerV2Adversarial.test.tsx` | Concurrent `setBody` while `onChange` debounce in flight → final body matches latest `setBody` (no race that loses operator edits) |
| **TA-05** | `composerV2Adversarial.test.tsx` | `EventChipNode` with missing `coverUrl` renders fallback calendar icon (not crash, not blank) |
| **TA-06** | `composerV2Adversarial.test.tsx` | Insertion bar `accessibilityRole="toolbar"` + every pill has explicit `accessibilityLabel` (no defaults) |

TA-03 is the designated tester fails-on-revert test (attacks chip removal — a different angle than T-04's parser path). Tester MUST verify fails-on-revert by injecting a regression that leaves orphan tokens.

### Strict-grep gate (CI block)

`.github/scripts/strict-grep/orch-0864-composer-v2.mjs` enforces:

| Check ID | Rule |
|---|---|
| C1 | No `react-native-pell-rich-editor` dep in package.json (I-PROPOSED-MKT-COMPOSER-V2-SINGLE-RENDERER-TENTAP) |
| C2 | No raw `<TextInput` JSX inside body region of `compose.tsx` (I-PROPOSED-MKT-COMPOSER-V2-NO-DIRECT-TEXTINPUT-IN-BODY) — heuristic: between `// V2 BODY START` and `// V2 BODY END` markers |
| C3 | No `display: none` / `pointerEvents: "none"` on `InsertionBar` styles (I-PROPOSED-MKT-COMPOSER-V2-INSERTION-BAR-ALWAYS-VISIBLE) |
| C4 | Token-preservation comment + regex literal present in `tenTapTokenBridge.ts` (I-PROPOSED-MKT-COMPOSER-V2-TOKEN-ROUNDTRIP-LOSSLESS — structural marker) |
| C5 | No `mcp__supabase__apply_migration` in implementor commits |
| C6 | New ComposerV2 components live under `mingla-business/src/components/marketing/ComposerV2/` namespace (organizational hygiene) |
| C7 | Self-test mode (`--self-test`) with inlined fixtures proving each rule (per `feedback_strict_grep_registry_pattern.md`) |

### Live-fire flows (tester runs these)

| Flow | Path | Surface |
|---|---|---|
| **LF-iOS** | `mingla-business/maestro/orch-0864-composer-v2-ios.yaml` | iPhone 17 Pro sim UDID `17091E60-C3B6-4167-980D-60C348E177F6` |
| **LF-Android** | `mingla-business/maestro/orch-0864-composer-v2-android.yaml` | Pixel emu (operator's default AVD) |
| **LF-Web** | `mingla-business/playwright/orch-0864-composer-v2-web.spec.ts` | `expo --web` at localhost |

Each flow asserts: open composer → tap `[+ Event]` → pick first event → assert block chip in body → tap `[{ } Personalize]` → tap `first_name` → assert inline pill in body at cursor → type "hello" → assert insertion bar still visible → save draft → close composer → reopen via `?draft=<id>` → assert chips re-render identically (round-trip on live device).

---

## §9 — Hard guards

1. NO touching audience picker, footer, send/schedule, review sheet, sent confirmation, dirty-back-block, draft auto-save.
2. NO touching `marketingRenderingService.renderEmail()` or any send-side renderer.
3. NO new DB tables, migrations, RPCs, edge functions.
4. NO touching `channel_payload` JSONB shape.
5. NO `mcp__supabase__apply_migration` (per skill rule).
6. NO swapping TenTap for pell or custom renderer mid-flight — if TenTap fails on Expo SDK 54, STOP and surface to operator.
7. NO using `osascript` for sim driving — Maestro only.
8. NO claiming "fails-on-revert verified" without actually doing the revert + re-run cycle and citing the commit hash.
9. NO EAS OTA at CLOSE — full EAS build required for both platforms (native dep added).
10. NO promoting `react-native-webview` usage to the Stripe Connect onboarding flow (per-feature ban unchanged).
11. NO bundling this ORCH with another ORCH at CLOSE — solo PR per `feedback_one_pr_per_close.md` unless operator authorizes.
12. NO breaking the V1 draft format — every existing draft in DB must open cleanly in V2 (SC-12 covers this; implementor must run T-05 on real production draft fixtures pulled via Supabase Management API).
13. NO removing token-bridge round-trip tests once landed — append-only enforcement via `.github/workflows/tests-append-only.yml`.
14. NO `any` types, no `@ts-ignore`, no `as unknown as X` in new code.

---

## §10 — Live-fire smoke flows (tester executes)

### LF-iOS — Maestro flow contract

```yaml
appId: com.mingla.business
---
- launchApp
- runFlow: ../maestro/_shared/login-as-test-operator.yaml
- tapOn: "Marketing"
- tapOn: "Campaigns"
- tapOn: "New campaign"
- assertVisible: "New campaign"
- assertVisible: { id: "insertion-bar" }
- assertVisible: { text: "+ Event" }
- tapOn: "+ Event"
- assertVisible: { id: "inline-events-scroller" }
- tapOn: { index: 0, id: "event-card-option" }
- assertVisible: { id: "event-chip-block" }
- tapOn: { id: "{ } Personalize" }
- tapOn: { text: "first_name" }
- assertVisible: { id: "personalization-chip-first_name" }
- inputText: " hello"
- assertVisible: { id: "insertion-bar" }  # bar still visible after typing
- tapOn: "Save draft"
- assertVisible: { text: "Saved" }
# Round-trip check
- tapOn: { text: "Back" }
- tapOn: { text: "Untitled campaign" }   # or whatever the just-saved row is
- assertVisible: { id: "event-chip-block" }
- assertVisible: { id: "personalization-chip-first_name" }
```

### LF-Android — same flow, executed via `~/.maestro/bin/maestro --device <emu-id>`.

### LF-Web — Playwright equivalent at `playwright/orch-0864-composer-v2-web.spec.ts` driving against `expo --web` localhost.

---

## §11 — Confirmed out-of-scope (do NOT pull into this ORCH)

- Phase 0 marketing consent foundation (DISC-4 from ORCH-0863 — re-surfaces when Twilio toll-free verification clears)
- SMS / RCS composer affordances (separate channel work)
- Image upload to body (Phase C / future ORCH-0865 candidate)
- A/B testing two subject lines (separate ORCH)
- Send-time optimization (Phase G)
- AI-assisted copy generation (Phase H — Brain)
- Audience picker redesign (V1 picker stays)
- Template CRUD redesign (Templates tab stays as ORCH-0863 shipped)
- Migration of historical sent campaigns to V2 doc format (sent campaigns are immutable; V2 only opens drafts)

---

## §12 — Pipeline next

Operator-elected implementor (Claude `mingla-implementor` vs Codex `implementor-mingla` — operator decides at dispatch time) consumes this spec. Per [[implementor-uses-ui-ux-pro-max]], the implementor MUST invoke `/ui-ux-pro-max` as a pre-flight design step before writing TenTap node view JSX. Implementor produces `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0864_MARKETING_COMPOSER_V2.md` + the 14 new files + the modified `compose.tsx` + dep additions, in a single PR. Then Claude `mingla-tester` (canonical TEST owner per [[tester-canonical-and-platform-parity]]) verifies against this spec on all three surfaces (iOS sim + Android emu + web preview). Operator-attested live-fire on real iOS device + real Android device is mandatory for PASS (native dep added means dev build, not OTA). Then orchestrator CLOSE.
