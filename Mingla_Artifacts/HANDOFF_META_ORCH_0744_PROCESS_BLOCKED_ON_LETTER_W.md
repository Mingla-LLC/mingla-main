# Handoff Brief — META-ORCH-0744-PROCESS implementor blocked on letter-W collision

**Date:** 2026-05-07
**From chat:** Mac, Seth branch, post-ORCH-0743 CLOSE (commit `22fe5507` + later)
**To chat:** fresh session
**Blocked at:** mingla-implementor Pre-Flight, refused to proceed past Step 4 (Check Invariants) per Prime Directive #2 ("If the spec is wrong, stop and say so").

---

## 0. One-paragraph state

ORCH-0742 + ORCH-0743 are CLOSED, committed, and pushed (EAS OTAs for 0743 still pending — operator hasn't run the two `eas update` commands yet). Forensics wrote `Mingla_Artifacts/specs/SPEC_META_ORCH_0744_PROCESS_HARDENING.md` (1243 lines, 5 CI/process gates, 5 new invariants K/L/M/N/W). Orchestrator REVIEWed → APPROVED. I dispatched implementor → implementor halted at Pre-Flight because **letter W is taken** by a same-day B2a Path C V3 hotfix that landed AFTER the META SPEC was authored. Operator chose "hand back to orchestrator/forensics" rather than implementor patching the SPEC inline. Next chat picks up by dispatching `/mingla-forensics take over` to patch the SPEC, then `/mingla-orchestrator take over` to re-REVIEW, then re-dispatch implementor.

---

## 1. The blocker (be specific)

### Letter W collision

`Mingla_Artifacts/INVARIANT_REGISTRY.md:2201` already registers:
> `### I-PROPOSED-W — NOTIFICATIONS-FILTERED-BY-APP-TYPE-PREFIX (DRAFT — flips ACTIVE on B2a Path C V3 CLOSE)`

This was added 2026-05-06 by B2a Path C V3 Sub-dispatch A hotfix per DEC-121. The META SPEC §1.4 listed W as "Open" — that inventory is stale by hours.

**Verified letter inventory at handoff time (Bash grep of `INVARIANT_REGISTRY.md`):**
- **Reserved:** A, B, C, D, E, H, I, J, O, P, Q, R, S, T, U, V, W
- **Free:** F, G, K, L, M, N, X, Y, Z

**SPEC's META gate assignment:**
| Gate | Assigned | Status |
|---|---|---|
| M-1 (require-cycles) | I-PROPOSED-K | ✅ free |
| M-2 (DIAG reaping) | I-PROPOSED-L | ✅ free |
| M-3 (persist-key sync) | I-PROPOSED-M | ✅ free |
| M-4 (TRANSITIONAL exit-condition) | I-PROPOSED-N | ✅ free |
| M-5 (web-deprecation) | **I-PROPOSED-W** | ❌ **collision** |

### Recommended new letter for M-5

**`I-PROPOSED-X`** — alphabetically next free letter, keeps META gates as a near-contiguous K/L/M/N/X block (only one letter skip vs. original K/L/M/N/W block). Operator did not pre-confirm X — when the SPEC is patched, forensics should propose X with rationale and get a final operator vote if needed.

---

## 2. The other drift to fix in the same SPEC patch (D-IMPL-PRE-3)

**File:** `mingla-business/src/utils/reapOrphanStorageKeys.ts:23` says:
> `// META-ORCH-0744-PROCESS will codify the workspace-wide CI gate as I-PROPOSED-L (PERSIST-KEY-WHITELIST-SYNC).`

**SPEC §6.2** assigns:
- I-PROPOSED-L → DIAG-MARKERS-REAPED-AT-CLOSE (M-2)
- I-PROPOSED-M → PERSIST-KEY-WHITELIST-SYNC (M-3)

The reaper comment is wrong vs. SPEC. Fix during the SPEC patch:
- **Option A (preferred):** update the comment in `reapOrphanStorageKeys.ts:23` from "I-PROPOSED-L" to "I-PROPOSED-M" — implementor does this as part of the META IMPL.
- **Option B:** swap the SPEC's L/M assignments so the existing comment is correct (NOT recommended — DIAG-reaping is a process invariant that more naturally precedes persist-sync).

**Recommend Option A.** Add a new step to SPEC §8 implementation order to update the reaper comment.

---

## 3. Verified Pre-Flight findings the next chat does NOT need to redo

| Finding | Status |
|---|---|
| Existing strict-grep workflow YAML | Read at `.github/workflows/strict-grep-mingla-business.yml` — 13 gates currently registered (I-37, I-38, I-39, I-PROPOSED-A/C/H/I/O/P/Q/R/S). Pattern matches SPEC. |
| Strict-grep README | Read at `.github/scripts/strict-grep/README.md` — 4-step add-a-gate procedure documented. SPEC §3.6.1 update format matches existing table. |
| Existing scripts | `ls .github/scripts/strict-grep/` returned 13 `.mjs` files matching the registered gates. No name collisions for k/m/n/w-prefixed scripts (the planned `i-proposed-w-web-deprecation.mjs` filename doesn't exist; the existing W-letter invariant has script `i-proposed-w-notifications-app-type-prefix.mjs` per the entry text — but it's not in the workflow YAML yet, search confirmed). |
| SKILL.md insertion site | Read `.claude/skills/mingla-orchestrator/SKILL.md:175-254` — Mode: CLOSE Step 1 ends at line 199, Step 2 starts at line 201. SPEC §3.2.1 insertion between them is correct. |
| Reaper whitelist | Read `mingla-business/src/utils/reapOrphanStorageKeys.ts:24-36` — 11 entries, all `mingla-business.<store>.v<N>` literals. Matches SPEC A-5 assertion. |
| INVARIANT_REGISTRY template | Existing entries (e.g., `I-PROPOSED-J`, `I-PROPOSED-W`) use header `### I-PROPOSED-X — NAME (status)` followed by Status / Statement / Why / Enforcement / Source / EXIT condition sections. SPEC §6.2 long-form already matches this template. |

**`madge` cycle count not yet verified at IMPL time** — sandbox `npx`/`node` not on PATH, would need `/opt/homebrew/Cellar/node@22/22.22.2_2/bin/npx --yes madge --circular --extensions ts,tsx src/ app/` from `mingla-business/`. SPEC §1.3 captured 14 cycles at `22fe5507`; implementor (when re-dispatched) verifies count at IMPL time.

---

## 4. What the next chat does

### Step 1 — Dispatch forensics SPEC-patch

`/mingla-forensics take over` with this prompt:

> Patch `Mingla_Artifacts/specs/SPEC_META_ORCH_0744_PROCESS_HARDENING.md` to resolve letter-W collision discovered at implementor Pre-Flight. Read `Mingla_Artifacts/HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md` for full context.
>
> Required edits:
> 1. **§1.4** — update letter inventory: reserved letters now include W (added by B2a Path C V3 hotfix per DEC-121); reassign M-5 to I-PROPOSED-X. Update the table.
> 2. **§3.5 header** — `M-5 Web-deprecation parser (I-PROPOSED-X)`
> 3. **§3.5.1** — script filename `i-proposed-x-web-deprecation.mjs` everywhere (header, docblock comment `// I-PROPOSED-X — WEB-EXPORT-CLEAN`, default stderr path comment if any)
> 4. **§3.5.2** — workflow job rename `i-proposed-x-web-deprecation` + name `"I-PROPOSED-X: web-export deprecation parser"` + script path
> 5. **§3.6.1** — README table row `I-PROPOSED-X` not W
> 6. **§5** — SC-15..SC-18 + SC-20 cross-references updated
> 7. **§6.2** — full long-form invariant header changes from `I-PROPOSED-W — WEB-EXPORT-CLEAN` to `I-PROPOSED-X — WEB-EXPORT-CLEAN`; statement, authority, enforcement, established, caveats all reference X not W; cross-references to script filename updated
> 8. **§7** — T-13 through T-16 if any cite "W" should now cite "X"
> 9. **§8 implementation order** — add new bullet under Step 7: "7.3 — Update `mingla-business/src/utils/reapOrphanStorageKeys.ts:23` comment from `I-PROPOSED-L (PERSIST-KEY-WHITELIST-SYNC)` to `I-PROPOSED-M (PERSIST-KEY-WHITELIST-SYNC)` — fixes drift D-IMPL-PRE-3 surfaced at implementor Pre-Flight."
> 10. **§10 discoveries** — amend D-META-FOR-2 to mention the W-collision specifically, add D-META-FOR-7 noting the reaper comment drift was caught at IMPL Pre-Flight (D-IMPL-PRE-3)
> 11. **§0 layman summary** — replace "K, L, M, N, W (skipping O)" with "K, L, M, N, X (skipping O which is taken by Stripe-no-webview-wrap and W which is taken by B2a Path C V3 notifications-prefix)"
> 12. **§12 hand-back protocol** — re-state that orchestrator must re-REVIEW after this patch
>
> Mode: SPEC-PATCH (no investigate; the contradiction is already documented in the handoff). Output: edited SPEC file. Confirm in chat which sections were touched.

### Step 2 — Orchestrator re-REVIEW

`/mingla-orchestrator take over` — re-runs 10-point REVIEW against patched SPEC, primarily verifies:
- Letter X is genuinely free (re-grep INVARIANT_REGISTRY)
- All §3.5 / §5 / §6.2 / §7 / §10 / §0 references swapped W → X consistently
- Step 7.3 reaper comment edit added
- No new letter collisions introduced

### Step 3 — Re-dispatch implementor

Update `Mingla_Artifacts/prompts/IMPL_META_ORCH_0744_PROCESS_HARDENING.md` to swap W → X references, then `/mingla-implementor take over`.

---

## 5. Other in-flight context the next chat should know

### Pending operator action (separate, non-blocking)

**ORCH-0743 EAS OTAs not yet published.** Two commands queued in the prior CLOSE:
```bash
cd /Users/sethogieva/Desktop/mingla-main/mingla-business
eas update --branch production --platform ios --message "ORCH-0743: cold-start polish + ORCH-0742 fallout"
eas update --branch production --platform android --message "ORCH-0743: cold-start polish + ORCH-0742 fallout"
```
These ship the persisted-state cold-start polish to existing users without an App Store review. Independent of META work — operator runs when ready.

### Other chat work (do NOT touch)

- **B2a Path C V3** — owned by another chat; introduced I-PROPOSED-T/U/V/W on 2026-05-06. Don't touch any of its files (Stripe edge functions, notification-prefix work, V3 SPEC).
- **ORCH-0737 v7** — owned by another chat; pipeline redesign. Don't touch.
- **Cycles B5 / B6 epics** — owned by another chat; don't touch.

### Priority board next-after-META

Per orchestrator standing queue:
1. META-ORCH-0744-PROCESS (this — currently blocked)
2. B2a IMPL Phases 3-5 (other chat)
3. ORCH-0746 (AuthContext require-cycles structural refactor — **note: 14 cycles, NOT 4 as original ORCH-0744 forensics estimated; D-META-FOR-1 documented**)
4. ORCH-0747 (8 form-input typecast)
5. ORCH-0737 v7 forensics (other chat)
6. Cycle 3 (Realtime push), Cycle 4 (Zustand classification audit), ORCH-0734 RLS audit, Cycle 17e-A close-pending, ORCH-0736 + ORCH-0738
7. ORCH-0748 (TRANSITIONAL audit cycle — fixes the 9 known violators; once closed, M-4 gate promotes from WARN-mode to FAIL-mode)

---

## 6. Files touched in this chat (none)

No code or artifact files written. The only file produced is **THIS handoff brief**. The implementor halted before any edits.

---

## 7. Memory rules the next chat should honor

- **No co-authored-by lines** in commits
- **Sequential pace** — one step at a time, wait for approval
- **Layman first** — plain English before technical detail
- **No popup questions unless decision-fork** — propose-and-act when there's a clear recommendation
- **Detail in files, summary in chat** — max 20 lines chat + file link
- **Forensics SPEC mode is allowed** — this is a patch dispatch, not a fresh investigate

---

## 8. Quick-paste prompt for next chat

```
Read Mingla_Artifacts/HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md
then dispatch /mingla-forensics take over with the SPEC-patch task documented in §4 Step 1.
After forensics returns, dispatch /mingla-orchestrator take over for re-REVIEW.
After APPROVED, update Mingla_Artifacts/prompts/IMPL_META_ORCH_0744_PROCESS_HARDENING.md
to swap W→X references, then /mingla-implementor take over to execute.
```

---

**Standing by — handoff complete.**
