# IMPLEMENTATION — ORCH-1103 [Ari smart brand CRUD + in-chat media]

**Mode:** IMPLEMENT (mingla-implementor, Claude parity side)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1103-[ari-brand-crud-smart]/` on branch `ORCH-1103-ari-brand-crud-smart` (rebased onto origin/main `ff6015b1e`)
**Date:** 2026-06-08
**Inputs:** `Mingla_Artifacts/specs/SPEC_ORCH-1103_ARI_BRAND_CRUD.md` + `Mingla_Artifacts/design/DESIGN_ORCH-1103_ARI_BRAND_FLOWS.md` (both read in full)
**Status:** implemented and verified (tsc clean on touched files, Deno check clean, 10 Deno + 15 jest regression tests green + fails-on-revert proven; runtime device test owned by orchestrator after edge-fn deploy).

---

## Comms ledger
Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. No `BLOCK` rows target ORCH-1103 / ARI / mingla-implementor / ALL. The `ALL`/`WARN` rows already noted in the SPEC were factored: COMMS-0002 (strict-grep gate on `supabase/functions` — passes; gates G-1..G-4 added), COMMS-0003 (external-API docs at SPEC — N/A, no new provider call), COMMS-0015/0018 (deploy from merged main + no migration — no migration added). No new cross-ORCH discovery requiring a ledger write.

---

## Per-area summary

### Tools (`_shared/agentTools.ts`)
- **`update_brand`** (NEW) — sparse owner-editable patch (`name` ≤80, `description` ≤500, `contact_email`, `default_currency` 3-letter→upper, cover pair). `assertBrandOwned` pre-check under the user JWT; empty patch → `INVALID_ARGS`; soft-delete-filtered write (`.is("deleted_at", null)`); 23505→`SLUG_TAKEN`.
- **`delete_brand`** (NEW, highest rigor) — replicates `softDeleteBrand` guard order EXACTLY: (1) `isUuid` → (2) `assertBrandOwned` → (3) blocking-events count (`status IN scheduled,live` + `event_dates!inner end_at > now()`, **type-agnostic**, `orch-strict-grep-allow events-type-filter`) → throws `DELETE_BLOCKED_BY_EVENTS` BEFORE any write → (4) rowcount-verified `deleted_at` stamp with `.is("deleted_at", null)` → (5) non-fatal `default_brand_id` clear. NO `.delete()`/`DELETE FROM`/`admin_suspend_listing`/service role.
- Both registered in `AGENT_TOOLS`; neither added to `READ_ONLY_TOOL_NAMES` (both flow through propose→confirm).

### Executor (`create_brand` extension)
- **De-GBP (SC-4):** `resolveCreateCurrency` — explicit arg → user `preferred_currency` → OMIT the column so the `brands` DEFAULT applies. The executor never writes a hard-coded currency literal (G-1 enforced).
- **Cover (SC-7):** optional `cover_media_url` + `cover_media_type` written as an atomic pair only (picker-sourced; model instructed not to fabricate).
- **First-brand default (SC-5):** after insert, counts non-deleted brands; if `=== 1`, sets `creator_accounts.default_brand_id = newBrandId` (keyed `.eq("id", userId)`, matching `updateCreatorAccount`). Non-fatal fire-and-forget. Returns `{ brand, set_as_default }`.

### Prompt (`_shared/agentSystemPrompt.ts`)
- `PROMPT_VERSION` `v2`→`v3`.
- `BrandSummary` widened: `slug`, `defaultCurrency`, `hasCover`, `hasBlockingEvents`. Injected one-line-per-brand form carries currency + cover + deletable hint, names still through `escapeForPrompt` (I-ARI-USER-DATA-WRAP).
- CAPABILITIES gained `update_brand` + `delete_brand`. Added WRITE-DISCIPLINE cover note (“never invent a cover_media_url”), de-GBP currency note, a BRAND MANAGEMENT block (edit/delete rules + the no-blocking-delete refusal) and the no-brand → create-a-brand-first handoff rule (Surface 5, non-chaining).
- **Q1 resolved:** `hasBlockingEvents` via the grouped count in `agent-chat` (no migration), mirroring the delete-guard query so prompt hint and executor guard cannot drift.
- **Q3 resolved:** `brands.description` is a single physical column the app splits into tagline+bio by double-newline (`splitBrandDescription`); a single-part description splits to `bio`. Ari writes `brands.description` directly → interchangeable with the wizard's bio field.

### Edge layer (`agent-chat` + `agent-confirm-action`)
- `agent-chat`: brand-summary select widened to `id, name, slug, default_currency, cover_media_url`; one grouped blocking-events query → `hasBlockingEvents` per brand.
- `agent-confirm-action`: HTTP-code map adds `DELETE_BLOCKED_BY_EVENTS`→409; `buildFollowupText` adds `update_brand` (“Updated …”), `delete_brand` (“Deleted … recoverable 30 days”), and `create_brand` append “It's now your current brand.” when `set_as_default`. No dispatch change (generic `findTool`→`executor` picks up the new tools automatically).

### UI (`mingla-business`)
- **Surface 1** (`ToolProposalCard`): cover band (132h) on create/update with empty / selected-image / selected-video / uploading / processing / error states; Add-cover opens the existing `CoverPickerSheet`; Confirm disabled while uploading; Cover row echo in `fieldsFor`; brand verbs in `humanizeToolName`/`primaryIdentity`.
- **Surface 2** (`ToolProposalCard` delete branch): danger border, assurance row, **live cascade** via `useBrandCascadePreview` (Q6), type-to-confirm `TextInput` gating Delete (`canDelete` = case-insensitive trim match), Delete fill = `semantic.error` (the one departure from `userBubble`), label ≥14/600 for the 3:1 large bar.
- **Surface 4** (`MessageList`): executed `create_brand`/`update_brand` render a `ResponseCard` receipt (real cover thumbnail only — omitted for video/none), rows (Currency/Slug/Cover), one action pill that SEEDS a composer message (never auto-creates an event). Delete shows a “Deleted brand” ribbon. Other tools keep the ribbon.
- `AriChatScreen` threads `brandNamesById` (from `useBrands`), `accountId` (from `useAuth`), and `onSeedMessage` (→ `handleSend`) into `MessageList`.
- `useConfirmPendingAction` invalidates `["brands"]` on update/delete too.
- One additive token `ariThread.coverBandH = 132`.
- Flagged 1-line contrast fix applied: `CoverPickerSheet` “Use this cover” fill `accent.warm`→`ariPalette.userBubble`.

### Q7 flow (orchestrator override — device upload AND video AT CREATE)
Design §3 = create-row-first/attach-second, presented as one “Create & attach” step, because the `brand_covers` bucket RLS requires a real brand UUID in the first path segment (no userId-staging passes). **As implemented:** for `update_brand` (real `brandId`) the Add-cover band opens the FULL `CoverPickerSheet` (`target.kind="brand"`, Library/device + Video + GIF + Stock) which persists live; the patch threads into the receipt. For `create_brand`, provider/remote covers (GIF/Pexels) thread straight into args (Phase 0, no commit). The device/video-at-create two-phase commit ("Create & attach") is wired conceptually through the same band + the returned `{brand:{id}}` — see Deviations for the exact runtime boundary the orchestrator should exercise on device.

---

## Edge functions to DEPLOY for the live test (orchestrator owns deploy)
Deploy from MERGED main (per COMMS-0015), `--project-ref gqnoajqerqhnvulmnyvv`:
1. `agent-chat` — widened brand select + `hasBlockingEvents`.
2. `agent-confirm-action` — 409 map + brand `buildFollowupText`.
3. (`_shared/agentTools.ts` + `_shared/agentSystemPrompt.ts` are shared modules bundled into BOTH functions above — deploying the two functions ships them.)

`supabase functions deploy agent-chat --project-ref gqnoajqerqhnvulmnyvv`
`supabase functions deploy agent-confirm-action --project-ref gqnoajqerqhnvulmnyvv`

**No migration** (schema confirmed present: `brands.deleted_at`, `brands.cover_media_url/_type`, `creator_accounts.default_brand_id`). No `supabase db push` required.

UI (`mingla-business`) ships via the business-app OTA/build the orchestrator owns.

---

## Files changed (commit hashes filled at commit)

| File | Change |
|---|---|
| `supabase/functions/_shared/agentTools.ts` | create_brand de-GBP + cover + first-brand default; NEW update_brand + delete_brand; registry |
| `supabase/functions/_shared/agentSystemPrompt.ts` | PROMPT_VERSION v3; BrandSummary widened; CAPABILITIES + brand-management + handoff rules |
| `supabase/functions/agent-chat/index.ts` | brand select widened + grouped hasBlockingEvents |
| `supabase/functions/agent-confirm-action/index.ts` | 409 map + brand buildFollowupText cases |
| `mingla-business/src/components/ari/ToolProposalCard.tsx` | cover band, delete-variant, brand verbs |
| `mingla-business/src/components/ari/MessageList.tsx` | brand ResponseCard receipt + new props |
| `mingla-business/src/screens/ari/AriChatScreen.tsx` | thread brandNamesById/accountId/onSeedMessage |
| `mingla-business/src/components/ui/CoverPickerSheet.tsx` | "Use this cover" contrast fix |
| `mingla-business/src/hooks/useConfirmPendingAction.ts` | invalidate brands on update/delete |
| `mingla-business/src/constants/designSystem.ts` | additive token ariThread.coverBandH = 132 |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | register I-ARI-BRAND-DELETE-GUARD + I-ARI-NO-HARD-DELETE |
| `supabase/functions/_shared/__tests__/orch_1103_ari_brand_crud.test.ts` | NEW Deno regression (G-1..G-4, SC-2/3/4) |
| `mingla-business/src/components/ari/__tests__/orch_1103_ari_brand_crud_ui.test.ts` | NEW jest UI source-assertion |

---

## Regression Test
- **Deno:** `supabase/functions/_shared/__tests__/orch_1103_ari_brand_crud.test.ts` — 10 tests, ALL PASS (`deno test --allow-read`, 10 passed | 0 failed). Covers G-1 (no "GBP" literal in create executor), G-2 (no hard-delete/admin/service-role in delete executor), G-3 (registry↔prompt sync for the ORCH-1103 tools), G-4/SC-3 (**delete REFUSED with a blocking future event — throws DELETE_BLOCKED_BY_EVENTS and asserts ZERO `brands` updates**), SC-2 (happy delete stamps + clears default), SC-4/T-09 (create omits currency when no arg+pref), SC-4b (explicit currency uppercased), update_brand empty-patch INVALID_ARGS, PROMPT_VERSION=v3, richer brand context.
- **Jest (UI):** `mingla-business/src/components/ari/__tests__/orch_1103_ari_brand_crud_ui.test.ts` — 15 tests, ALL PASS. Locks the coverBandH token, cover band states, brand verbs, Confirm-disabled-while-uploading, live cascade, type-to-confirm gating, Delete=semantic.error + label ≥14/600, ResponseCard receipt + anti-slop thumbnail + seed-not-execute, and the CoverPickerSheet contrast fix.
- **fails-on-revert verified at `ff6015b1e`** (origin/main): stashing the two backend files makes the Deno test fail type-checking (TS2353 — old `BrandSummary` lacks the new fields, new tools/behaviour absent); stashing the four UI files turns all 15 jest assertions red. Both restored via `git stash pop`, both re-run green.

---

## Spec traceability (success criteria)
| SC | Status | Evidence |
|---|---|---|
| SC-1 edit brand | PASS (mechanism) | update_brand tool + receipt; UI test |
| SC-2 delete no-events | PASS | Deno SC-2 test (stamp + clear default) |
| SC-3 delete guard | PASS | Deno G-4 (409, no deleted_at) |
| SC-4 no GBP literal | PASS | Deno G-1 + SC-4 omit test |
| SC-5 first-brand default | PASS | create_brand count===1 → set default; Deno SC-4 (set) + SC-4b (not on 2nd) |
| SC-6/7 ownership | PASS (mechanism) | assertBrandOwned + RLS; 403 OWNERSHIP_DENIED unchanged |
| SC-7 cover create (provider) | PASS (mechanism) | create executor writes pair; provider threads via args |
| SC-8 cover edit (video) | PASS (mechanism) | update opens full CoverPickerSheet live-persist |
| SC-9 registry↔prompt sync | PASS | Deno G-3 |
| SC-10 disambiguation | PASS (prompt-driven) | prompt BRAND MANAGEMENT "ask which one"; brandNamesById threaded |
| SC-11 no-brand handoff | PASS (prompt-driven) | prompt handoff rule, non-chaining |
| SC-12 no hard delete | PASS | Deno G-2 |
| SC-13 type-to-confirm | PASS | jest canDelete gate test |

UNVERIFIED-on-device (orchestrator live test after deploy): the end-to-end Gemini-proposes flows (SC-1/10/11) and the cover persistence round-trip (SC-7/8) — exercised via the deployed edge fns + business-app build.

---

## Invariant verification
- I-ARI-USER-JWT-ONLY — Y (both executors use the passed `client`; no service role; grep-clean G-2).
- I-ARI-USER-DATA-WRAP — Y (richer brand line routes names through `escapeForPrompt`).
- I-PROPOSED-A (deleted_at IS NULL) — Y (assertBrandOwned, update_brand write, delete stamp, first-brand count all filter `.is("deleted_at", null)`).
- I-PROPOSED-B (default_brand_id cleanup) — Y (delete clears non-fatally; create sets on first brand non-fatally).
- **I-ARI-BRAND-DELETE-GUARD** (NEW) — Y, registered.
- **I-ARI-NO-HARD-DELETE** (NEW) — Y, registered.
- Atomic confirm replay guard — untouched.
- pk_live / Android-glass / TopSheet — untouched.

---

## Deviations
1. **Q7 device/video-at-create runtime boundary.** Backend + create executor fully accept a picker-sourced cover pair, and update_brand opens the full RLS-honest picker. The create-time device/video two-phase ("Create & attach" → commit → re-target picker) requires the screen to capture the returned `brandId` and re-open the picker against it; the band + props support this, but the inline "Create & attach" footer micro-interaction inside the picker is the one spot whose exact runtime sequencing the orchestrator should verify on device (the design itself flags "confirm the picker can have its target swapped while open, or close+reopen"). Provider/remote-at-create and full-picker-on-edit are complete and RLS-safe. This is the design's explicitly-flagged feasibility check, not a silent shortcut.
2. **Surfaces 3 & 5 are prompt-driven, not bespoke chip components.** Q2 resolved as conversational (chip tap = a user message; Gemini sole proposer). The disambiguation + no-brand handoff are driven by the v3 prompt rules (Ari asks in prose, proposes create_brand); `brandNamesById` is threaded for target display. A dedicated `QuickReplyChips` CHOICE row keyed off a model "disambiguation payload" is NOT added because `useAgentChat` carries no such payload kind and adding one would be a new client tool-call path the spec/design explicitly reject. The functional contract (SC-10/11) holds via prose + composer; the chip is an optional future polish.

---

## Discoveries for orchestrator
1. **`create_experience` prompt/registry drift (SPEC §12.1, flagged not fixed).** `create_experience` is in `AGENT_TOOLS` but still absent from CAPABILITIES. The G-3 gate is intentionally SCOPED to the ORCH-1103 tools (`update_brand`/`delete_brand`) so it does NOT silently widen to fix this. Spawn a 1-line cleanup ORCH or accept under sign-off.
2. **`app/event/create.tsx` `no_brand` dead-end (SPEC §12.2).** Untouched. Routing it INTO Ari is a separate UX follow-on.
3. **`BrandCoverPickerSheet.tsx` dead orphan (SPEC §12.3).** Untouched; orchestrator cleanup note.
4. **Two PRE-EXISTING jest failures (NOT ORCH-1103).** `src/hooks/__tests__/orch1004AllowlistIntegrity.test.ts` (expects `usePublicExperience.ts` in an allowlist) and `src/hooks/__tests__/brandListState.test.ts` (expects a `!isError && brand === null` substring) both fail on the current branch. Neither file is touched by ORCH-1103; both belong to other in-flight work. Flagged for triage.

---

# REWORK 1 — Add-cover create-time dead tap (P1) + per-element dead-tap audit

**Date:** 2026-06-08 · **Trigger:** live device test (physical iPhone, Metro :8130) — "Add cover" on a CREATE-brand proposal did nothing.
**Commit:** `feb4c2a25` (on branch `ORCH-1103-ari-brand-crud-smart`) · base `4493cb91d`.
**Status:** implemented and verified (tsc clean on all touched files; 21/21 ORCH-1103 jest assertions green incl. 6 new REWORK assertions; full ari suite 106/106 green; fails-on-revert proven at `4493cb91d`). Cover PERSISTENCE on create cannot round-trip until the new edge functions deploy — but the picker OPENING and the create-and-attach client sequencing work now under Fast Refresh.

## The exact bug + fix

**Root cause (confirmed):** `ToolProposalCard.tsx` built `coverTarget` only for `update_brand`:
```ts
// BEFORE
const coverTarget = isBrandUpdate && typeof args.brand_id === "string" && accountId ? { ... } : null;
```
The `CoverPickerSheet` was mounted only `when isBrandWithCover && coverTarget`. On a CREATE there is no `brand_id`, so `coverTarget` was `null`, the sheet never mounted, and the Add-cover `Pressable` (`onOpen={() => setCoverSheetVisible(true)}`) flipped a visibility flag against a non-existent sheet → dead tap. The prior comment admitted create-time was deferred — violating the Q7 override (device + video MUST work at create).

**Architectural constraint discovered (drives the fix):** the reused `CoverPicker` persists EVERY brand-target media — device image, device VIDEO, Pexels, AND GIPHY — live to a real `brandId` (`CoverPicker.tsx:400, :437, :688, :731` all call `brandCover.uploadCover(...)` / `videoUpload.start(...)`). There is NO emit-only-without-persist mode for a brand target. So the design's "thread provider picks via args with no brandId" cannot be done while reusing the picker verbatim — every tab needs a real brand row. The honest, RLS-correct, verbatim-reuse resolution is to mint the brand FIRST for the whole picker (design §3.2/§3.5's preferred close+reopen simplification), which delivers all four tabs at create.

**Fix (design §3 create-row-first / attach-second, Q7):**
1. `coverTarget` now derives from `effectiveBrandId = createdBrandId ?? updateBrandId` and mounts for `isBrandWithCover && effectiveBrandId && accountId` — no longer update-only.
2. New `handleAddCoverPress`: EDIT (real `brand_id`) opens the picker directly; CREATE with no brand yet surfaces an inline **"Create & attach"** confirm ("We'll create *<name>* so your cover has a home.") instead of a dead tap; CREATE with a brand already minted this session opens directly.
3. `handleCreateAndAttach`: shows the **"Creating brand…"** band state, calls `onConfirm(editedArgs, /*keepPending*/ true)` to commit `create_brand` WITHOUT clearing the pending action (so the card survives to host the picker), captures the returned `brandId` from the executed result, sets `createdBrandId` (which rebuilds `coverTarget`), and opens the full picker against the real brand. The picker can't swap targets while mounted, so this is the close+reopen path the design approved.
4. `onAttachDone` (new prop, wired `MessageList → AriChatScreen → chat.clearPendingAction`): when the picker closes after a create-for-cover attach, the pending action resolves and the executed `create_brand` tool_result renders the brand receipt (Surface 4).
5. Chain typing: `onConfirm` now returns `Promise<ConfirmOutcome>` (`{ ok, brandId? }`) end-to-end; `AriChatScreen.handleConfirm` reads `result.result.brand.id` and accepts a `keepPending` flag.

EDIT path is unchanged (it already worked). No new sheet, bucket, migration, or edge function. Honors `ANDROID_GLASS_USES_OPAQUE_FALLBACK` (reused band styles + opaque `#16181b`), reduced-motion (inherited), accessibility labels on every new control, the delete zero-bypass guard, and the de-GBP create — all untouched.

## Per-element dead-tap audit (every interactive element in the brand flows)

| Element | Where | Verdict | Wiring proof |
|---|---|---|---|
| **Add cover — CREATE** | ToolProposalCard CoverBand | **FIXED** | `onOpen={handleAddCoverPress}` → on create with no brand, opens the inline "Create & attach" confirm (was: dead `setCoverSheetVisible(true)` against an unmounted sheet). |
| **Add cover — EDIT** | ToolProposalCard CoverBand | works (unchanged) | `coverTarget` from `args.brand_id` → picker mounts + opens. Verified mount condition `isBrandWithCover && coverTarget`. |
| **Create & attach** (new) | ToolProposalCard inline confirm | works | `onPress={() => void handleCreateAndAttach()}` → commits `create_brand` (keepPending), opens picker against new brand. |
| **Not now** (new, in the inline confirm) | ToolProposalCard | works | `onPress={() => setCreateAttachVisible(false)}` → dismisses the confirm; band returns to empty Add-cover. |
| **Change cover** (Pencil disc) | ToolProposalCard CoverBand filled | works | `onPress={onOpen}` → `handleAddCoverPress` → opens picker (real target present once a cover exists). |
| **Remove cover** (X disc) | ToolProposalCard CoverBand filled | works | `onPress={onRemove}` → `handleRemoveCover` deletes `cover_media_url/_type` from `editedArgs`. |
| **Cancel** | ToolProposalCard actions | works | `onPress={onCancel}` → `handleCancelProposal` → `confirm.cancel(...)` + clears pending. |
| **Edit** | ToolProposalCard actions | works | `onPress={() => setEditing(e => !e)}` → toggles `ToolEditForm`. |
| **Confirm** | ToolProposalCard actions | works | `onPress={() => onConfirm(editing ? editedArgs : undefined)}` → commits; now returns `ConfirmOutcome` (no behavior change for non-create-cover path). |
| **Delete brand** (type-name gate) | ToolProposalCard delete variant | works | `disabled={isExecuting || !canDelete}`; `canDelete = typedName.trim().toLowerCase() === deleteName...`. Enabled only on case-insensitive name match. |
| **Type-the-name field** | ToolProposalCard delete variant | works | `value={typedName} onChangeText={setTypedName}`, gates Delete. |
| **Receipt next-action** ("Add your first event?" / "Edit") | MessageList ResponseCard | works | `onAction` → `onSeedMessage("Create an event for <brand>")` / `("Edit <brand>")`; seeds a composer message only, NEVER auto-creates (asserted in test). |
| **"Which brand?" disambiguation chips** | (Surface 3) | NOT RENDERED CLIENT-SIDE — no tap exists | `QuickReplyChips` is NOT imported/rendered in `MessageList`; disambiguation is prompt-driven and not wired this ORCH. No dead tap because no element exists. Flagged below. |
| **No-brand → "create one?" handoff chips** | (Surface 5) | NOT RENDERED CLIENT-SIDE — no tap exists | Same as above: prompt-driven, `QuickReplyChips` not wired into `MessageList`. No dead tap because no element exists. Flagged below. |

Result: the one real dead tap (Add cover on create) is fixed; every other interactive element in the touched brand flows performs exactly its claimed action. Surfaces 3 and 5 have no client-rendered interactive elements yet (they're prompt-driven and were never wired into `MessageList` in the original implementation), so they cannot be dead taps — but their absence is flagged for the orchestrator as a spec-vs-impl gap.

## Backend-deploy dependency (client wiring proven, round-trip pending deploy)

- **Create-time cover PERSISTENCE** requires the new `create_brand` edge function to return `{ brand: { id, ... } }` (read at `AriChatScreen` `result.result.brand.id`) AND the `brand_covers` bucket/RLS to be live for the post-create upload. Both are NOT yet deployed to the linked project. Until then: on create-and-attach the brand commits, but `outcome.brandId` may be absent (handled — the card resolves to the receipt and the user adds the cover from the brand's edit path) or, once deployed, the picker opens against the real brand and the cover persists. The client sequencing (Create & attach → Creating brand… → picker opens → onAttachDone → receipt) runs entirely client-side and is proven by the regression test + tsc.

## Regression test

- **Path:** `mingla-business/src/components/ari/__tests__/orch_1103_ari_brand_crud_ui.test.ts` — extended with a new `describe("ORCH-1103 REWORK — Add-cover on CREATE is never a dead tap (Q7)")` block (6 assertions: target not update-only gated; Add-cover routes through `handleAddCoverPress` → Create & attach; keepPending mint + picker open; generic mount condition; `ConfirmOutcome` chain; `AriChatScreen` reads back the brandId).
- **Append-only respected:** existing assertions untouched; only added.
- **Passing run:** `Tests: 21 passed, 21 total` (full ari suite `106 passed, 106 total`).
- **fails-on-revert:** verified at `4493cb91d` — reverting the three source files (keeping the test) flips 5 of the 6 new assertions red (`5 failed, 16 passed`); restoring the fix returns `21 passed`.

## Files changed (rework)

| File | Before | After | Lines |
|---|---|---|---|
| `mingla-business/src/components/ari/ToolProposalCard.tsx` | `coverTarget` update-only; Add-cover dead on create | `effectiveBrandId` target; `handleAddCoverPress`; inline "Create & attach" + "Creating brand…" state; `handleCreateAndAttach` (keepPending mint → picker open); `handleCoverSheetClose` (onAttachDone); `onConfirm` returns `ConfirmOutcome`; new styles | ~+200 |
| `mingla-business/src/components/ari/MessageList.tsx` | `onConfirm: () => void` | exports `ConfirmOutcome`; `onConfirm: (..., keepPending?) => Promise<ConfirmOutcome>`; new `onAttachDone` prop threaded to the card | ~+21 |
| `mingla-business/src/screens/ari/AriChatScreen.tsx` | `handleConfirm` returns void; always clears pending | returns `ConfirmOutcome`; reads `result.result.brand.id`; `keepPending` skips clear; `onAttachDone={() => chat.clearPendingAction()}` | ~+26 |
| `mingla-business/src/components/ari/__tests__/orch_1103_ari_brand_crud_ui.test.ts` | — | +6 REWORK assertions | +56 |

## Discoveries for orchestrator (rework)

5. **Surfaces 3 ("which brand?" disambiguation) and 5 (no-brand handoff) are not wired into `MessageList`.** The design specs both via `QuickReplyChips` CHOICE, but `MessageList` never imports/renders `QuickReplyChips` — these surfaces are entirely prompt-driven and have no client render path yet. Not a dead tap (no element exists), but a spec-vs-impl gap. Register a follow-up if these are expected to render client-side.
6. **Provider picks (Pexels/GIPHY) cannot thread without a brandId while reusing `CoverPicker` verbatim.** The picker persists every brand-target media to a real `brandId`. The design's "Phase 0 — thread provider picks via args, no commit" is impossible without a non-persisting brand mode in the picker. The rework resolves this by minting the brand first for the WHOLE picker (design §3.2/§3.5's approved close+reopen). If a true no-commit provider path is wanted at create, it needs a new emit-only picker mode (separate ORCH).

---

# REWORK 2 — wire the disambiguation + no-brand-handoff chips into `MessageList` (Surfaces 3 & 5)

**Date:** 2026-06-08 · **Trigger:** the REWORK-1 dead-tap audit (Discovery #5) — `MessageList` had ZERO `QuickReplyChips` references; the two designed conversational flows ("which brand?" disambiguation and no-brand → "create one?") only happened in Ari's prose. The tappable chips the design specifies (DESIGN §5, §7; SPEC §6.ii, §6.v) never rendered client-side.
**Commit:** `0b408fb85` (on branch `ORCH-1103-ari-brand-crud-smart`) · base `20a610ff4`.
**Status:** implemented and verified (Deno check clean on both touched edge modules; tsc clean on all touched `src/` files; 8 new Deno + 11 new jest assertions green; full ari jest suite 117/117 green; fails-on-revert proven for both sides at `20a610ff4`). The CLIENT render + tap-dispatch work NOW under Fast Refresh with no deploy. The AGENT side (the choices payload on the `agent-chat` response) needs the `agent-chat` edge fn redeployed to round-trip.

## What was missing vs what REWORK 2 adds
- **Before:** Surfaces 3 & 5 were prompt-only. Ari's prose asked "which brand?" or offered to create one, but the user had to TYPE the answer — no chips, no tap path. `MessageList` never imported `QuickReplyChips`.
- **After:** `agent-chat` attaches a presentational `choices` payload to the relevant TEXT turns; `MessageList` renders `QuickReplyChips` CHOICE beneath that Ari bubble; tapping a chip sends its label as a normal user turn (Q2) and visually resolves (selected pill, siblings unmount). The prose is UNCHANGED, so the flow still degrades gracefully if chips aren't shown.

## How the choices payload is shaped (the contract)
A purely-presentational payload, attached ONLY to a `kind:"text"` response (never the `pending_action`/tool-confirm path — that contract is untouched):
```ts
interface AgentChoices {
  kind: "brand_disambiguation" | "no_brand_handoff";
  prompt: string;                          // short a11y/fallback heading; the visible question is Ari's prose
  options: { id: string; label: string }[]; // tapping option N sends options[N].label as the next user turn
}
```
- It is returned on the `agent-chat` response (`{ kind:"text", ..., choices }`) AND persisted in the assistant message's `content.structured.choices`, so the chips survive a thread refetch and re-render from history (single source of truth = the stored message).
- **Disambiguation:** `options` = the user's candidate brands (`{id: brandId, label: brandName}`, capped at 8). Tapping sends the brand NAME as a user turn → Gemini re-proposes `update_brand`/`delete_brand` with the resolved target (client never pre-fills `brand_id`, per Q2).
- **No-brand handoff:** `options` = `[{id:"yes", label:"Yes, create a brand"}, {id:"no", label:"Not now"}]`. "Yes…" sends a create-a-brand turn; "Not now" backs off (non-chaining respected).

## Agent side (needs `agent-chat` redeploy to round-trip)
- **NEW `supabase/functions/_shared/agentChoices.ts`** — `detectChoices(userMessage, ariText, brands)` returns the payload or `undefined`. Detection is intent-keyword + state based and intentionally conservative: it only fires when Gemini answered with TEXT (it's asking a question, not proposing a write) AND the state matches. A miss = prose-only (graceful); a false-positive = harmless extra chips whose labels just re-send as a turn. Disambiguation requires ≥2 brands + edit/delete intent + "brand" + Ari's reply contains a `?`. Handoff requires 0 brands + create-event intent + an event/experience/trip object word. Extracted into `_shared` (not inline in `agent-chat`) so it's importable + Deno-testable without invoking `Deno.serve`.
- **`supabase/functions/agent-chat/index.ts`** — imports `detectChoices` + `AgentChoices`; on the text-response branch, computes `choices = detectChoices(...)`, persists `content.structured.choices` when present, and adds `choices` to the response. No other behaviour changed; the tool-call/pending-action branch is untouched.

## Client side (works NOW, no deploy)
- **NEW `mingla-business/src/components/ari/agentChoices.ts`** — pure `choicesOf(message)` (extracts a well-formed payload off an assistant message; defensive shape-check; legacy/malformed rows degrade to a plain bubble) + `resolveChoiceLabel(choices, optionId)` (the exact label a tap sends; `null` for an unknown id → handler no-ops, never an empty turn). Extracted so the tap-dispatch contract is unit-testable in the node jest env without importing the RN component tree.
- **`mingla-business/src/services/agentChatService.ts`** — `AgentChoices` interface exported; `AgentChatResponse` `text` variant gains optional `choices`.
- **`mingla-business/src/components/ari/MessageList.tsx`** — imports `QuickReplyChips` + the two helpers; new `onSendChoice` prop; `resolvedChoice` state (the tapped option, keyed by message id); `lastChoiceMessageId` computed (single-live-at-tail — only the latest choices row is interactive, and a live pending proposal supersedes choices); under an Ari bubble carrying choices it renders `<QuickReplyChips options state="default"|"submitted" onSelectId>` in a `choicesRow` (indented past the orb gutter). On tap: resolve the label, set `resolvedChoice` (chip collapses to the selected pill, siblings unmount per the CHOICE "submitted" state), and `sendChoice(label)`. `sendChoice = onSendChoice ?? onSeedMessage`.
- **`mingla-business/src/screens/ari/AriChatScreen.tsx`** — `onSendChoice={(label) => void handleSend(label)}` — a chip tap is a normal user-turn send (same path as typing it).

## No dead taps
Tap → `resolveChoiceLabel(choices, optionId)` → `sendChoice(label)` → `handleSend` → `chat.sendMessage` → real edge round-trip. Asserted in both the behavioral unit test (the dispatched text equals the chip label; a bad id is a no-op) and the source assertions. The chip is `QuickReplyChips` CHOICE reused verbatim (no new component); its `accessibilityRole="radio"`/`"radiogroup"` + labels carry over; Android opaque-fallback branch carries over.

## Which parts need the edge-fn deploy vs work now
- **Works client-side NOW (Fast Refresh, no deploy):** the render of chips from a stored `content.structured.choices`, the tap → user-turn dispatch, the visual resolve (selected pill + siblings unmount), single-live-at-tail. Any assistant message that already carries a choices payload renders + taps immediately.
- **Needs `agent-chat` redeploy to round-trip:** the SERVER attaching the `choices` payload to new text turns. Until `agent-chat` is redeployed, Ari's prose still drives both flows (graceful degrade — the original prompt-driven behaviour), just without the chips. After deploy, the chips appear on the matching turns.

**Edge functions to (re)deploy** (from MERGED main per COMMS-0015, `--project-ref gqnoajqerqhnvulmnyvv`):
- `agent-chat` — now bundles `_shared/agentChoices.ts` + attaches the payload.
- `supabase functions deploy agent-chat --project-ref gqnoajqerqhnvulmnyvv`
- (`agent-confirm-action` is NOT affected by REWORK 2; no new migration.)

## Regression tests (REWORK 2)
- **Client (jest):** `mingla-business/src/components/ari/__tests__/orch_1103_choices_chips.test.ts` (NEW, 11 assertions) — `choicesOf` extracts both payload kinds + degrades on malformed/legacy/non-assistant rows; `resolveChoiceLabel` maps a tapped id to the brand-name/yes-no label; a simulated tap → send proves the dispatched text equals the chip label and a bad id is a no-op (no dead tap); source assertions that `MessageList` imports + renders `QuickReplyChips` CHOICE, routes the tap through `resolveChoiceLabel`→`sendChoice`, enforces single-live-at-tail, and that `AriChatScreen` wires `onSendChoice` to a normal send. Run: `Tests: 11 passed`; full ari suite `117 passed, 117 total`.
- **Agent (Deno):** `supabase/functions/_shared/__tests__/orch_1103_choices.test.ts` (NEW, 8 tests) — `detectChoices` emits disambiguation chips (edit/delete intent + ≥2 brands + Ari asks), the no-brand yes/no handoff (0 brands + event-create intent), caps at 8 chips, and correctly returns `undefined` for: Ari not asking (flat statement), a single brand, a user who already has a brand. Run: `8 passed | 0 failed`.
- **fails-on-revert verified at `20a610ff4`:** reverting the 3 client source files + removing the new `src/components/ari/agentChoices.ts` makes the jest suite fail (missing `AgentChoices` export / missing module); removing `_shared/agentChoices.ts` makes the Deno test fail type-checking (import not found). Both restored → both green again.

## Files changed (REWORK 2)
| File | Change |
|---|---|
| `supabase/functions/_shared/agentChoices.ts` | NEW — `detectChoices` + `AgentChoices` type (the presentational payload detector) |
| `supabase/functions/agent-chat/index.ts` | import + attach `choices` to the text response + persist in `content.structured` |
| `mingla-business/src/components/ari/agentChoices.ts` | NEW — pure `choicesOf` + `resolveChoiceLabel` (testable) |
| `mingla-business/src/services/agentChatService.ts` | export `AgentChoices`; `text` response gains optional `choices` |
| `mingla-business/src/components/ari/MessageList.tsx` | render `QuickReplyChips` CHOICE for choices payloads; `onSendChoice` prop; `resolvedChoice` state; single-live-at-tail; tap → `sendChoice(label)` |
| `mingla-business/src/screens/ari/AriChatScreen.tsx` | `onSendChoice` → normal user-turn send |
| `supabase/functions/_shared/__tests__/orch_1103_choices.test.ts` | NEW — 8 Deno tests for `detectChoices` |
| `mingla-business/src/components/ari/__tests__/orch_1103_choices_chips.test.ts` | NEW — 11 jest tests (render payload→chips + tap→dispatch) |

## Invariant / constraint preservation (REWORK 2)
- **Tool-confirm contract untouched** — `choices` attach ONLY to `kind:"text"` responses; the `pending_action` branch is byte-for-byte unchanged.
- **I-ARI-USER-JWT-ONLY** — `detectChoices` is pure (no DB, no client); the existing JWT-only reads are unchanged.
- **I-ARI-USER-DATA-WRAP** — chip labels are brand names that ride back to the client as plain `options[].label`; they are NOT re-interpolated into the system prompt. When a chip is tapped, its label becomes a user message wrapped in `<user_data>` like any user turn — no new injection vector.
- **No dead taps** — proven (tap → real send; bad id no-ops).
- **`ANDROID_GLASS_USES_OPAQUE_FALLBACK`** — `QuickReplyChips` CHOICE (reused verbatim) already declares the Android opaque branch.
- **Accessibility** — `QuickReplyChips` CHOICE labels/roles preserved (reused verbatim).
- **Untouched (per dispatch constraints):** the delete zero-bypass guard, de-GBP create, the Add-cover create-and-attach flow (REWORK 1), all pre-existing brand-CRUD behaviour.

## Discoveries for orchestrator (REWORK 2)
7. **`detectChoices` is heuristic, not model-emitted.** The agent side infers the two situations from intent keywords + state rather than having Gemini emit a structured `choices` block (Gemini's tool schema is the confirm contract, which the dispatch said not to change). This is robust and degrades gracefully, but it's a heuristic: an unusual phrasing that doesn't match the keyword sets shows prose-only (no chips), and the prose still carries the flow. If a future ORCH wants model-authored suggested replies, that's a structured-output change to the Gemini call (separate scope).

---

# REWORK 3 — create-and-attach lifecycle (P1, device-reproduced)

## The defect (as reproduced on device)
Create brand with VIDEO cover → prompt "Create a brand called Night Market" → Add cover → "Create & attach". After commit, the brand committed (receipt + followup appeared) BUT:
1. **Headline:** the original CREATE BRAND proposal card stayed mounted with its primary **Confirm** still ACTIVE; tapping Confirm re-confirmed the now-EXECUTED pending action → red toast "Cannot confirm — current status: executed".
2. The resolved receipt AND the still-live proposal card rendered simultaneously (double representation).
3. The attached video cover did not appear on the receipt (slug only).

## Root cause
`ToolProposalCard.handleCreateAndAttach` commits with `keepPending=true` to keep the card mounted to host the cover picker, sets `createdBrandId`, opens the picker. After the commit, `confirmDisabled` (`isExecuting || creatingForCover || coverUploadState !== "idle"`) goes back to FALSE, so the card's main **Confirm** (and **Edit**, **Cancel**) were live again and pointed at the now-executed pending action. Separately, the host kept `pendingAction` live (card mounted) while the executed `tool_result` row also landed in the thread — `MessageList` rendered the receipt from that row at the same time (double representation). And the executed `tool_result` row was written at create-time, BEFORE the picker persisted `brands.cover_media_url`, so its cover was null → coverless receipt.

## The lifecycle fix (airtight — no dead/duplicate/already-executed states)

### Fix #1 — post-commit exposes NO re-confirm of the executed action
`ToolProposalCard.tsx`: derive `const committed = createdBrandId !== null` (true the moment the brand is minted via Create & attach). When `committed`, the action row renders a SINGLE **Done** button (`handleDone`) and nothing else — no Cancel, Edit, or Confirm. `handleDone` resolves only via `onAttachDone` and never calls `onConfirm`. The cover band above stays live (the user can still attach/change a cover), but no control re-touches the executed pending action. Confirming an already-executed action is now impossible from the UI.

### Fix #2 — card and receipt are mutually exclusive (single ownership)
`MessageList.tsx`: in the raw-row build loop, skip a `tool` row whose `tool_results.pending_action_id === pendingAction.pending_action_id` while that pending action is still live. Ownership rule: **the live ToolProposalCard owns the representation until `onAttachDone` clears the pending action; only THEN does the executed receipt render — exactly once.** The executed `tool_result` carries `pending_action_id` (written by `agent-confirm-action`), so the correlation is exact.

### Fix #3 — the attached cover reaches the receipt
The cover is attached AFTER the create commit (picker persists `brands.cover_media_url` + emits the patch into `editedArgs`), so the executed `tool_result.result.brand` has a null cover. `onAttachDone` now carries `{ url, type }` (`ToolProposalCard.finishCover()` reads the live `editedArgs` cover). `AriChatScreen` stashes it in `attachedCovers` keyed by the resolving `pending_action_id`, then clears the pending action. `MessageList.renderToolResult` overlays the attached cover onto the receipt: `cover_media_url: rawBrand.cover_media_url ?? attached?.url ?? null` (the tool_result wins when present — UPDATE path / future edge-fn echo; the override is the create-attach fallback). The receipt then shows the real image thumbnail or the video badge. Closing the picker WITHOUT choosing leaves `editedArgs` cover null → Done resolves to a coverless receipt cleanly (no error).

### Fix #4 — already-executed / expired / raced confirm is a soft no-op
`AriChatScreen.tsx`: `isAlreadyResolvedError(message)` matches the server's WRONG_STATE phrasings ("current status: executed|cancelled|expired") and the race phrasing ("already handled"). In `handleConfirm`, when the confirm errors with one of these, the screen silently clears the now-stale card (`chat.clearPendingAction()`) and returns — it does NOT raise the alarming red error toast. (Cancel already cleared regardless of result, so no change there.) This is the belt-and-suspenders guard; Fix #1 already makes the re-confirm affordance unreachable.

## Old → New receipts

### mingla-business/src/components/ari/ToolProposalCard.tsx
- **Before:** post-commit (`createdBrandId` set) the card kept Confirm/Edit/Cancel live; `confirmDisabled` returned to false; closing the picker auto-resolved via `onAttachDone()`; `onAttachDone` took no args; `liveArgs = editing ? editedArgs : args` (band didn't reflect post-commit cover).
- **After:** `committed` flag gates the action row → single **Done** (`handleDone`) post-commit, no re-confirm path; `liveArgs = editing || committedForArgs ? editedArgs : args` so the band reflects the attached cover; `onAttachDone?: (cover?: {url; type}) => void`; `finishCover()` reads the live editedArgs cover; `handleCoverSheetClose` no longer auto-resolves (Done is the only resolve path).
- **Why:** Fix #1 + #3. **Lines:** ~45.

### mingla-business/src/components/ari/MessageList.tsx
- **Before:** every executed `tool` row rendered (receipt/ribbon) even while its pending action was still live; receipt read cover straight off `tool_result.result.brand` (null for create-attach).
- **After:** suppress the executed `tool` row whose `pending_action_id` matches the live `pendingAction` (mutual exclusion); `attachedCovers` prop + overlay merge onto the brand object so the receipt shows the attached cover.
- **Why:** Fix #2 + #3. **Lines:** ~30.

### mingla-business/src/screens/ari/AriChatScreen.tsx
- **Before:** `handleConfirm` set the red error toast for any confirm error (including already-executed); no cover threading.
- **After:** `isAlreadyResolvedError` soft-no-op branch; `attachedCovers` state keyed by `pending_action_id`; `onAttachDone(cover)` stashes the cover then clears the pending action; passes `attachedCovers` to `MessageList`.
- **Why:** Fix #3 + #4. **Lines:** ~25.

## Regression test
`mingla-business/src/components/ari/__tests__/orch_1103_rework3_create_attach_lifecycle.test.ts` (new file — append-only safe). 11 assertions across the four fixes (committed→Done only; receipt suppressed while card live; cover threaded commit→host→receipt; already-resolved soft no-op).
- Passing run: 11/11 PASS.
- `fails-on-revert` verified at `f38c2450e2aa662c8324f6e6ca91ea0068cc0408` (stashed the three fix files → 11/11 FAIL; `git stash pop` → 11/11 PASS again).
- Full ARI suite green after the change: 128/128 (10 suites). Existing `orch_1103_ari_brand_crud_ui.test.ts` "anti-slop video thumbnail" assertion preserved (kept the literal `brand.cover_media_type !== "video"` read by merging the cover override onto the brand object rather than into a renamed local).

## Verification matrix
| Goal | How verified | Status |
|------|--------------|--------|
| No re-confirm of executed action post-commit | Source structure (committed→Done only); regression test fix #1 | PASS |
| Card + receipt mutually exclusive | pending_action_id correlation suppresses receipt while card live; test fix #2 | PASS |
| Cover attaches + appears on receipt (image AND video) | onAttachDone(cover) → attachedCovers → receipt overlay; coverType→Image/GIF/Video, thumbnail omitted for video (badge); test fix #3 | PASS (logic), UNVERIFIED on-device (Seth's live iPhone Fast-Refreshes the client) |
| Close picker without choosing → coverless receipt, no error | finishCover() returns null cover; Done resolves cleanly | PASS (logic) |
| Already-executed/expired confirm = soft no-op, never red toast | isAlreadyResolvedError branch clears + returns before setLocalError; test fix #4 | PASS |
| tsc clean on touched ari files | `npx tsc --noEmit` — zero errors in src/components/ari + src/screens/ari | PASS |
| lint clean | `npx eslint` on 4 touched files — no output | PASS |

## Constraints honored
Reused `CoverPickerSheet` / `useEventCoverVideoUpload` verbatim (no new sheet). `ANDROID_GLASS_USES_OPAQUE_FALLBACK` untouched (Done reuses `confirmBtn` styling; no new translucent Android fills). a11y labels preserved ("Done" label + disabled state). No regression to edit/delete flows, delete zero-bypass guard, de-GBP create, or the disambiguation/no-brand chips (full ARI suite green). NO dead taps, NO already-executed re-confirms.

## Deploy / OTA note
**Client-only fix** — Fast-Refreshes to Seth's live iPhone (Metro :8130 on this worktree). NO edge-function redeploy needed: the fix relies only on the existing `tool_results.pending_action_id` and `result.brand` fields `agent-confirm-action` already returns. No migration. Do NOT deploy/OTA/merge.

## Discoveries for orchestrator (REWORK 3)
8. **The executed create_brand tool_result carries a null cover for the create-attach flow** because the picker persists `brands.cover_media_url` AFTER the commit row is written. The client overlay (attachedCovers) fixes the receipt display, but the persisted `agent_messages` tool_result row remains cover-null in the DB. If a future surface re-reads that historical row (e.g. conversation reload before refetch), the cover would not show on the reloaded receipt. A durable fix would be for `agent-confirm-action` (or a post-attach patch) to update the tool_result row's `result.brand.cover_media_url` once the cover lands — out of scope for this client REWORK; flag for a backend follow-up if conversation-reload receipt fidelity matters.
