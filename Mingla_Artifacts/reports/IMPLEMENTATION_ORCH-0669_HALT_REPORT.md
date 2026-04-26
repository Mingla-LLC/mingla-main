# IMPLEMENTATION HALT — ORCH-0669

**Status:** `investigated only` — NO CODE CHANGES MADE
**Date:** 2026-04-25
**Implementor:** mingla-implementor
**Halt trigger:** Spec §13 pre-implementation re-verification gate 3 FAILED

---

## TL;DR

The spec assumed 5 consumers of `glass.chrome.border.hairline`. There are **7**. Three new consumers appeared in `MessageInterface.tsx` (chat input capsule + reply preview + hairline separator) since the investigation was written. One of those uses the token as a `backgroundColor`, not a `borderColor` — the spec's invariant `I-CHROME-HAIRLINE-SUB-PERCEPTIBLE` did not anticipate this, and lowering the alpha 0.12 → 0.06 may make the separator disappear. **Orchestrator decision required before implementor can proceed.**

---

## §13 Gate Results

| Gate | Spec requirement | Actual | Status |
|------|------------------|--------|--------|
| §13.1 | `glass.chrome.border.topHighlight` has 0 consumers | 0 consumers (sibling tokens `glass.badge.border.topHighlight`, `glass.profile.card.topHighlight`, `glass.profile.cardElevated.topHighlight` are different namespaces, OUT OF SCOPE — they have their own consumers in GlassBadge.tsx + GlassCard.tsx, but those are not the target token) | **PASS** |
| §13.2 | In-flight ORCH-0661 diff intact on `GlassSessionSwitcher.tsx` + `designSystem.ts` | `designSystem.ts` still modified (uncommitted). `GlassSessionSwitcher.tsx` is now CLEAN against HEAD — investigation-time line numbers (487, 578) shifted to current (519, 630), and `git log` shows recent commits including `3911b696 fix(home): pin Solo + create pills, scroll only collab sessions`. ORCH-0661 work appears to have been **committed** since investigation, not reverted. The work is preserved; the file is just no longer pending. | **PARTIAL — non-blocking.** Investigation's clearance ("ORCH-0661 work is unrelated, build fix on top") still holds because the work is preserved (committed instead of pending). |
| §13.3 | `glass.chrome.border.hairline` has exactly 5 consumers | **7 consumers across 4 files.** | **FAIL — STOP gate** |

---

## Gate 3 Detail — Consumer Audit

```
$ grep -rn "glass\.chrome\.border\.hairline" app-mobile/src/

app-mobile/src/components/GlassSessionSwitcher.tsx:519:  borderColor: glass.chrome.border.hairline,   ← container (investigation surface 1)
app-mobile/src/components/GlassSessionSwitcher.tsx:630:  borderColor: glass.chrome.border.hairline,   ← createPill (investigation surface 5 / D-4)
app-mobile/src/components/GlassBottomNav.tsx:281:        borderColor: glass.chrome.border.hairline,   ← bottom nav capsule (investigation D-3)
app-mobile/src/components/MessageInterface.tsx:2054:    borderColor: glass.chrome.border.hairline,   ← NEW: replyPreviewWrap (chat surface)
app-mobile/src/components/MessageInterface.tsx:2060:    borderColor: glass.chrome.border.hairline,   ← NEW: inputCapsule (chat surface)
app-mobile/src/components/MessageInterface.tsx:2077:    backgroundColor: glass.chrome.border.hairline, ← NEW: capsuleSeparator (DIFFERENT PROPERTY — backgroundColor, not borderColor)
app-mobile/src/components/ui/GlassIconButton.tsx:290:   borderColor: glass.chrome.border.hairline,   ← preferences chip + bell (investigation surfaces 2 + 3)
```

**4 home/bottom-nav chrome consumers (investigation scope) + 3 chat-surface consumers (new, ORCH-0600 chat input capsule).**

---

## Investigation-Time vs Current

The investigation report's manifest at §2 listed exactly 5 consumers of the token, all on Home + bottom-nav surfaces. The current state shows 5 of those 5 are still there (line numbers shifted on `GlassSessionSwitcher.tsx` because ORCH-0661 work was committed, adding lines above the styles block) — but **3 additional consumers in `MessageInterface.tsx` exist**. These are new since investigation, OR existed at investigation time and were missed. Either way, the spec's scope assumption ("5 surfaces, all Home chrome") is wrong by 3.

---

## Why this is a STOP condition (not a "just proceed" condition)

The spec's lock at §4 says `'rgba(255, 255, 255, 0.06)'` exactly — a 50% alpha reduction. Three concerns the spec did not address:

### Concern 1 — Cross-surface scope creep

The chat input capsule on `MessageInterface.tsx` is a SEPARATE design surface (chat / messaging) from the Home + bottom-nav chrome the spec was written for. The L2040 inline comment says "matching the home-chrome capsule language" — explicit design intent that chat input SHOULD share the treatment. **If founder agrees, this is a free wider win.** **If founder disagrees, lowering the alpha breaks the chat input edge definition.**

This is a founder design call that the spec did not contemplate.

### Concern 2 — Different property semantic (backgroundColor vs borderColor)

[MessageInterface.tsx:2074-2079](app-mobile/src/components/MessageInterface.tsx#L2074-L2079):
```ts
capsuleSeparator: {
  width: StyleSheet.hairlineWidth,
  height: 24,
  backgroundColor: glass.chrome.border.hairline,  // ← 1px-wide divider, NOT a border
  marginHorizontal: 4,
},
```

This is a **vertical 1px divider line** between the attach / text / send sections of the chat input capsule. It uses the token as a `backgroundColor` because it's a thin filled rectangle, not a stroke. At 12% white it's visible as a separator. **At 6% white it will be near-invisible — the separator effectively disappears.**

The spec's invariant `I-CHROME-HAIRLINE-SUB-PERCEPTIBLE` was written to apply to *perimeter `borderColor`* only (per §6 invariant statement). It explicitly did not consider `backgroundColor` semantic uses. Mechanically lowering the token affects this consumer in a way the spec author did not analyze.

### Concern 3 — Constitution #2 question

The token is currently shared across two design surfaces (Home chrome + chat input). Three options:

| Option | Action | Tradeoff |
|--------|--------|----------|
| **A** | Lower the shared token to 0.06 anyway | Accepts the chat separator near-disappearance. Aligns with the L2040 design-intent comment ("matching home-chrome capsule language"). Single owner of truth (Constitution #2 GREEN). |
| **B** | Introduce a new token `glass.chat.border.hairline` at the original 0.12, leave Home chrome on the lowered 0.06 | Splits ownership — Constitution #2 question (was one owner, now two). But preserves chat separator visibility. Requires 1 token addition + 3 line edits in MessageInterface.tsx to switch consumers. |
| **C** | Lower shared token AND patch the separator's `backgroundColor` to a slightly higher alpha or different token | Adds a special-case in MessageInterface.tsx — Constitution #8 violation (doesn't subtract before adding). Most surgical but most spec-deviating. |

The implementor cannot pick — the spec does not authorize any of these, and §13 gate 3 explicitly says STOP for this case.

---

## What I did NOT do

- **No code changes made.** designSystem.ts is untouched (the working-tree modification is the pre-existing Seth-branch ORCH-0661 token addition, not anything from this implementor session).
- **No CI gate added.**
- **No invariant registered.**
- **No tests run.**

The implementor halted at Step 3 of the 11-step spec §9 sequence (consumer audit gate). Steps 4-11 not started.

---

## Recommendation for Orchestrator

**Recommend Option A** (proceed with shared-token lowering to 0.06) for these reasons:

1. The L2040 comment is explicit design intent that chat input capsule shares home-chrome language. The original author wanted Constitution #2 single-owner — that decision should stand unless founder overrides.
2. The chat separator is a minor visual, not a primary edge. Even if it becomes near-invisible at 6% white, the chat input capsule still has clear edge definition via its `borderColor` (which uses the same token, but a perimeter stroke against the dark background reads differently than a 1px filled divider against the chat capsule's tint floor).
3. Splitting tokens (Option B) risks future drift — if someone adds a 4th chat surface and grabs the wrong token, we have a Constitution #2 incident in 6 months.
4. Patching the separator (Option C) violates "subtract before adding" (Constitution #8) — adds a special-case for one property.

But this is a founder design call. The orchestrator should:
1. Update the spec §2 SCOPE clause to acknowledge the 7 consumers (not 5), with explicit language about cross-surface implication.
2. Update the spec §6 invariant to either include or exclude chat-surface consumers (Option A includes, Option B excludes via new token, Option C special-case excludes the separator).
3. Re-confirm with founder that Option A's "chat separator becomes near-invisible at 6%" is acceptable. (It probably is — `StyleSheet.hairlineWidth` separators on both iOS and Android were already barely-visible at 12% white on dark backgrounds, and the chat input has clear shape from its border + shadow.)
4. Re-issue the implementor dispatch with the updated spec.

---

## Discoveries for Orchestrator

**ORCH-0669.D-7 — Spec scope undercounted by 3 consumers.** The investigation manifest at §2 listed 5 hairline consumers (4 home/bottom-nav + 1 create-pill). The actual count at implementation time is 7 (4 home/bottom-nav + 1 create-pill + 3 chat-surface). Either the investigator missed the 3 chat consumers (forensics bug — likely, given the investigation focused on top-bar surfaces and may have stopped grepping after finding the dispatched scope), OR the chat consumers were added between investigation (~2hr ago) and now (unlikely given recent commits don't touch MessageInterface.tsx). Most probable cause: the investigator's grep was not run with sufficient breadth — the file `MessageInterface.tsx` is large (~3000 lines, 92KB) and may have been deprioritized as "chat surface, not chrome surface." This is a forensic-thoroughness regression worth registering as a process improvement (not a fix discovery).

**ORCH-0669.D-8 — `backgroundColor` semantic use of border-named token.** [MessageInterface.tsx:2077](app-mobile/src/components/MessageInterface.tsx#L2077) uses `glass.chrome.border.hairline` as `backgroundColor`. The token name implies "border", but the property is `backgroundColor`. This is a Constitution #2-adjacent concern (semantic ambiguity in the token system). Whether this is a bug or just naming convention is a design-system call. Filing for orchestrator awareness; should NOT be fixed in this dispatch.

**ORCH-0669.D-9 — ORCH-0661 work was committed since investigation.** `git log` shows `3911b696 fix(home): pin Solo + create pills, scroll only collab sessions` and adjacent commits. Investigation's "+118 in-flight diff" caveat is no longer accurate — the work is on HEAD now. Spec §13 gate 2 wording should be updated for future ORCH-IDs ("verify the work is preserved" rather than "verify the diff is uncommitted"). Process improvement, not a bug.

---

## Next Step

Hand this halt report back to orchestrator. Orchestrator decides Option A / B / C, updates spec, re-dispatches implementor against updated spec.

**No code has been written. No artifacts have been corrupted. The Seth branch is in the same state it was when the implementor was dispatched** (one uncommitted change to `designSystem.ts` from prior ORCH-0661 work, no implementor-introduced changes).
