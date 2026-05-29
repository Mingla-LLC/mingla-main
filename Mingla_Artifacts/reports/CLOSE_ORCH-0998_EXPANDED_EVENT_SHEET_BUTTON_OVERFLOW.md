# CLOSE — ORCH-0998 [Ticketmaster expanded event sheet — text bleeds out of buttons; make them premium + compact]

- **Verdict:** CLOSED PASS — operator-confirmed live on dev build (physical iPhone, LAN Metro `:8101`): "works perfect now. Looks great."
- **Severity / Class:** S3-low / `ux` + `design-debt`
- **Affected Surfaces:** consumer-iOS + consumer-Android. NOT in scope: Mingla business ticketed events (`PublicEventPage`, full-width footer button — no bleed), buyer-web, business-iOS/Android, admin-web.
- **Surface area:** frontend-only — 1 component + 29 locale files + 2 regression tests. Zero backend, zero migration, no new dependency.

## Root cause (proven)

`app-mobile/src/components/expandedCard/EventDetailLayout.tsx` — the secondary action row (Save / Share / Add to Calendar) rendered three `flex: 1`, fixed `height: 40` chips. Their `<Text>` label style `secondaryChipText` had **no overflow protection** (no `numberOfLines`, no `adjustsFontSizeToFit`, no `flexShrink`). The English "Add to Calendar" (15 chars) exceeded its ~1/3-of-row width and bled past the rounded chip border; longer translations (de "Zum Kalender hinzufügen", pt "Adicionar ao calendário", it "Aggiungi al calendario") bled worse.

Confirmation the contract was intentional: the primary "Get Tickets" CTA in the same component (lines ~248-255) already used `numberOfLines={1}` + `adjustsFontSizeToFit` + `minimumFontScale` — the secondary chips simply never got it.

Mounted via `app-mobile/src/components/ExpandedCardModal.tsx:1935` (event branch).

## Fix (operator-chosen: "compact icon + short label")

1. **No-bleed clamp (the bug fix, locale-proof):** all three chip labels now `numberOfLines={1}` + `adjustsFontSizeToFit` + `minimumFontScale={0.85}`. A long label shrinks a hair instead of overflowing — guaranteed in all 29 languages.
2. **Short localized label:** new i18n key `cards:expanded.calendar` ("Calendar") added to ALL 29 locale `cards.json` files with a real localized noun (no English-fallback regression). It is the calendar chip's VISIBLE label; the full localized `cards:expanded.add_to_calendar` is preserved as the `accessibilityLabel` (a11y not sacrificed for compactness).
3. **Premium-compact styling:** `secondaryChipText` → `flexShrink:1` + `minWidth:0` + `textAlign:center` + 13px + 600 + `letterSpacing:0.2`; chips tightened — icon 18→16, gap 6→5, `secondaryRow` gap 8→6, `secondaryChip` height 40→38 + `paddingHorizontal:6`.

## Regression-test gate (Step 0.5) — SATISFIED

- **Implementor happy-path:** `app-mobile/src/components/__tests__/orch-0998-event-sheet-button-overflow.test.tsx` — 6 source assertions (3× `minimumFontScale={0.85}`, short-key visible label, full-phrase a11y preserved, `flexShrink`/`textAlign`/`height:38` contract). **Fails-on-revert VERIFIED:** run against `main`'s pre-fix component (`ORCH_0998_LAYOUT_SRC` override) → exit 1; against the fixed worktree → exit 0.
- **Tester adversarial (different angle — localization layer):** `…/orch-0998-event-sheet-button-overflow.tester-adversarial.test.tsx` — INV-1 every locale defines a non-empty `expanded.calendar`; INV-2 the short label is never LONGER than that locale's `add_to_calendar` (guards against a "fix" that re-points to the bleeding long phrase). **Fails-on-revert VERIFIED:** run against a key-stripped locales tree (`ORCH_0998_LOCALES_DIR` override) → exit 1; against the fixed worktree → exit 0 (29 locales).
- Both are `node:assert` source-assertion tests (app-mobile has no jest — established repo convention, see orch-0994).

## Close mechanics

- **DIAG reap:** `grep "[ORCH-0998-DIAG]"` → ZERO matches.
- **`[deploy]` tag:** NOT required (app-mobile only — no Vercel web surface).
- **EAS OTA:** NOT published — OTA deferred until the next native build per operator standing rule; the fix rides the build.
- **COMMS ledger:** read on entry (no BLOCK to this skill / ID / ALL). COMMS-0002 N/A (no `supabase/functions`), COMMS-0003 N/A (no external API), COMMS-0004 INTAKE-scan performed.
- **Temp test artifact:** the fix was copied onto the anchor checkout to serve an isolated LAN Metro for the live-fire (the worktree symlink breaks Metro entry resolution under Expo SDK 54); reverted from the anchor after operator PASS. The committed fix lives on branch `ORCH-0998-expanded-event-button-overflow`.

## SYNC

WORLD_MAP banner is canonical (recent-close precedent). MASTER_BUG_LIST / COVERAGE_MAP / PRODUCT_SNAPSHOT / PRIORITY_BOARD / AGENT_HANDOFFS sync deferred (S3 cosmetic close does not move grade distributions or the top-20).
