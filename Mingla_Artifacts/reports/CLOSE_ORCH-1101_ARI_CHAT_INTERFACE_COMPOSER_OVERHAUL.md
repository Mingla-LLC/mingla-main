# CLOSE — ORCH-1101 · Ari Chat Interface + Composer Design Overhaul

**Date:** 2026-06-08
**Verdict:** CLOSED PASS — Grade A
**Surfaces:** `mingla-business` Ari assistant — business iOS, business Android, desktop business web (phone web `/ari` is blocked per ORCH-1095, out of scope)

## What shipped

- **Compactness redesign** (premium-glass soul retained): density spine tokens (`ariThread`), speaker grouping, redesigned user/assistant bubbles, tool-proposal card retune.
- **Two desktop-web defects fixed at root:**
  - Bug A — composer bottom dead-space: input pins to one line (web `rows=1`/`resize:none`/explicit lineHeight); phantom 80px bottom-nav clearance removed on web only.
  - Bug B — send-icon "blob": deleted the SVG/RadialGradient/Circle; flat brand disc + single lucide `ArrowUp`, crisp + identical on web/iOS/Android. iOS ember glow + send micro-interaction preserved.
- **Brand color (operator decision 2026-06-08):** `ariPalette.userBubble → accent.warm` (#eb7825) + white text on send button, user bubble, Confirm, and §5 cards — matches every app-wide brand action button. Accepted trade-off: white-on-#eb7825 ≈ 2.9:1 (the established brand pairing); dark-ink fallback offered if needed.
- **Future smart-reply vocabulary (presentational; wired to nothing):** choice chips, `ClarifyingCard`, `MultiSelectPrompt`, `ResponseCard` — all states rendered, ready for the downstream smart-Ari ORCH.

## Device rework — 6 bugs Seth found on his physical iPhone (source/DOM QA missed them)

1. Send-time crash — FlatList `ItemSeparatorComponent` read an undefined `trailingItem` (SectionList-only prop). Fixed: guard `speakerOf` + derive the group gap from the precomputed `tail` flag. (`87d6e6cd3`)
2. Send lag — no optimistic insert. Fixed: synchronous crash-safe optimistic user message, reconciled on server return, dropped on error. (`3e0695aaf`)
3. Missing thinking indicator — empty-state mount gap (the list wasn't mounted on first message). Fixed by #2's optimistic mount. (`3e0695aaf`)
4. Transparent composer / hint bleed-through — host used a semi-transparent glass tint. Fixed: opaque `ariThread.composerSurface` (#191c21). (`d1d67a742`)
5. Hint copy — now renders an inline bordered ＋ chip ("Tap [＋] for things to try"). (`d1d67a742`)
6. First-open disclosure CTA dead — dismissal waited on a profile refetch. Fixed: local dismiss flag decoupled from the network; ack still persists; ack error surfaced via toast. (`3e0695aaf`)

## Verification

- 85/85 Ari tests green.
- Regression tests (immutable, append-only): implementor happy-path (fails-on-revert verified) + tester adversarial — for BOTH the original work and the rework. Brand-color assertions realigned to guard the brand-token linkage under `[TEST-MOD-APPROVED ORCH-1101]`.
- Web bugs proven via react-native-web DOM render (send button has zero SVG nodes; composer is a one-line `<textarea>` with no phantom gap; composer surface is fully opaque).
- Operator device confirmation: all six rework bugs + the brand color, on his physical iPhone via the live dev build.

## Close mechanics

- Step 0.5 regression gate: PASS (happy-path fails-on-revert + adversarial, different angles).
- Step 1.5 DIAG reap: zero `[ORCH-1101-DIAG]` markers.
- Dev-preview scaffolding (`AriDevPreview.tsx` + the `ari.tsx` dev toggle) removed before close — never committed.
- Deploy: PR carries `[deploy]` (mingla-business web is Vercel-gated); squash body carries `[TEST-MOD-APPROVED ORCH-1101]`. Business-app native OTA published after merge.

## Follow-on

The originally-requested work — making Ari genuinely smarter (clarifying questions, choice pop-ups, complex multi-step task execution) — is a separate downstream ORCH that renders into the interface + the four presentational components shipped here.
