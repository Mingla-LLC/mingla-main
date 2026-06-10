# SPEC — ORCH-1103 [Ari smart brand CRUD + in-chat media]

**Mode:** SPEC (contracts only — no product code, no migrations, no deploys)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1103-[ari-brand-crud-smart]/` on branch `ORCH-1103-ari-brand-crud-smart` (rebased onto origin/main)
**Date:** 2026-06-08
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1103_ARI_BRAND_CRUD.md` (High confidence; read in full before implementing)
**Surface:** `mingla-business` ONLY (Ari lives there) + `supabase/functions` edge layer. No consumer-app surface.

> Ari can already create brands. This spec makes Ari a complete brand manager: it can **edit** and **delete** brands conversationally, attach a **cover image/video** to a brand it proposes, stop forcing GBP, set the new brand as the user's default, and recognize "you have no brand yet" when you ask for an event and offer to create one first. Delete routes through the EXISTING owner-protection process with zero bypass.

---

## Comms ledger (read on entry)

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`. Active table scanned. **No `BLOCK` rows.** No row targets `ORCH-1103`, `mingla-forensics`, `ARI`, or `BrandCoverPickerSheet`. `ALL`/general `WARN` rows factored into this spec:
- **COMMS-0002** (ORCH-0863 strict-grep gate on any `supabase/functions` PR) — applies; both new tools live in `supabase/functions/_shared/agentTools.ts`. Implementor must pass the strict-grep gate.
- **COMMS-0003** (cite external-API docs at SPEC for provider integrations) — N/A: this spec adds no new provider call. The cover picker (Pexels edge-proxy / GIPHY client-direct) is the **existing** ORCH-0989 path, unchanged.
- **COMMS-0015 / COMMS-0018** (deploy edge fns from MERGED main, never a dirty worktree; apply migrations via Management API) — applies at CLOSE. **This spec adds NO migration** (see §1 — the `agent_pending_actions` state machine + `brands` schema already support delete). If the implementor finds it needs a column, it must be flagged back, not silently added.

No new cross-ORCH discovery requiring a ledger write was produced by this SPEC. The BrandCoverPickerSheet dead-orphan note (investigation Discovery #1) remains an orchestrator cleanup item, not a blocker.

---

## 1. Scope & Non-Goals

### In scope (LOCKED)
1. **New Ari tool `update_brand`** — sparse owner-editable update of a brand, in `_shared/agentTools.ts`, registered in `AGENT_TOOLS` AND named in the system-prompt `CAPABILITIES` list.
2. **New Ari tool `delete_brand`** — owner soft-delete that replicates `softDeleteBrand`'s exact guard order with ZERO bypass and NO hard-delete; registered in registry AND prompt.
3. **`create_brand` extension** — (a) optional cover (image/video/gif/Pexels/GIPHY via the CoverPicker result), (b) stop hard-defaulting currency to GBP (use user's/Stripe default per [[orch-1034 de-GBP]]), (c) set `default_brand_id` when this is the user's first brand (wizard parity).
4. **System-prompt brand awareness** — inject richer per-brand context (beyond `id : name`) so Ari can disambiguate "edit my coffee brand" and know which brands are deletable vs blocked by future events.
5. **Conversational flows wired into the ORCH-1101 presentational components** — (i) create-brand proposal card with Add-cover; (ii) "which brand?" disambiguation for ambiguous edit/delete; (iii) delete confirmation surfacing cascade preview + type-to-confirm + future-events refusal as a clear Ari message; (iv) created/updated-brand ResponseCard receipt; (v) the no-brand → "want me to create one?" handoff prompt.
6. **Media "Add cover" button** on Ari's brand proposal card (create + edit) opening the EXISTING `CoverPickerSheet` with `target.kind="brand"`.

### Non-goals (LOCKED — do NOT build)
- **Ari chaining into event creation after brand creation.** Deliberate follow-on ORCH. This spec covers ONLY the recognize-no-brand → guide-brand-creation → hand-back POINT (§6.v). After the brand exists, Ari stops; the user re-asks for the event in a fresh turn.
- **Hard delete of brands.** Forbidden everywhere. Only `softDeleteBrand` semantics.
- **The admin `admin_suspend_listing` path (ORCH-1073).** That is admin listing-moderation, NOT owner-delete. Must NOT be referenced by `delete_brand`.
- **Brand address/geo collection in the Ari create flow.** The wizard collects it (Mapbox Step 2); Ari's `update_brand` MAY carry address fields (they are owner-editable), but the Ari **create** proposal does not run a Mapbox picker. Address-on-create stays a wizard affordance.
- **`create_experience` prompt/registry drift fix** (investigation Discovery #2). FLAGGED for a separate cleanup ORCH (§12). Out of scope here.
- **Phone-web `/ari`.** Blocked / out of scope (Ari runtime is the native business app).
- **Brand-cover provider attribution persistence beyond url+type.** The brand path persists only `cover_media_url` + `cover_media_type` (matches existing `useBrandCoverUpload`); the 7-field `CoverPatch` is emitted but only those two persist for brand. Do not add provider-attribution columns to `brands`.

### Assumptions
- `agent_pending_actions` state machine (pending→executing→executed/failed/cancelled/expired) and `agent-confirm-action`'s generic `findTool` → `tool.executor` dispatch already support arbitrary new write tools with NO edge-fn change beyond registering the tool. **Verified in investigation §a.** New tools are picked up automatically.
- `brands.deleted_at` (soft-delete), `brands.cover_media_url`, `brands.cover_media_type`, `creator_accounts.default_brand_id` all already exist. **No migration required.**
- `CoverPickerSheet` + `CoverPicker` already support `target.kind="brand"` with device image/gif/**video**/Pexels/GIPHY and persist live to `brands.cover_media_url`. **Verified investigation §e.**

---

## 2. Cross-Surface Impact (MANDATORY)

| # | Surface | Covered? | Behaviour / why not |
|---|---------|----------|---------------------|
| 1 | Consumer iOS (`app-mobile`) | **NO** | Ari does not exist in the consumer app. No brand-CRUD UI there. |
| 2 | Consumer Android (`app-mobile`) | **NO** | Same. |
| 3 | Buyer/anon Web (`mingla-business` public routes) | **NO** | No Ari, no brand authoring on buyer routes. |
| 4 | **Business iOS** (`mingla-business` iOS) | **YES** | Ari chat + proposal cards + Add-cover + delete confirm render here. Primary target. |
| 5 | **Business Android** (`mingla-business` Android) | **YES** | Parity is AUTOMATIC (shared RN component code: MessageList / ToolProposalCard / CoverPickerSheet / the ORCH-1101 cards). Android glass-opaque fallback already handled by existing tokens. |
| 6 | Admin Web (`mingla-admin`) | **NO** | Admin doesn't render Ari or owner brand CRUD. The admin `admin_suspend_listing` path is explicitly NOT this delete. |
| 7 | **Business Web preview** (`mingla-business` dev/web build) | **PARTIAL / out of scope** | The Ari edge tools work web-side, but the dispatch BLOCKS phone-web `/ari`. CoverPicker video capture is native-only. Treat web as best-effort, NOT a success-criterion surface. |

**Backend edge functions (`supabase/functions`)** are surface-agnostic and IN scope: `_shared/agentTools.ts` (both new tools + create_brand extension), `_shared/agentSystemPrompt.ts` (capabilities + brand context), `agent-chat/index.ts` (brand-summary select widening). `agent-confirm-action/index.ts` needs only a `buildFollowupText` case addition (no dispatch change).

**Parity:** Business iOS + Android share one code path → parity is automatic. No per-platform success-criteria split is required EXCEPT the CoverPicker video-capture leg, which is native-only and already gated by the existing ORCH-0989 component (not re-specced here).

---

## 3. Backend layer — `_shared/agentTools.ts`

### 3.0 Shared helpers (reuse, do not duplicate)
- `deriveSlug`, `isString`, `isUuid`, `assertBrandOwned(client, brandId, userId)`, `ToolError(code, message)` — all exist (`agentTools.ts:31-91`). Reuse verbatim. `assertBrandOwned` already filters `deleted_at IS NULL` and checks `account_id = userId`.

### 3.1 `create_brand` — EXTENDED (touch existing tool `agentTools.ts:97-155`)

**New/changed parameters (JSON Schema — Gemini OpenAPI subset, re-validated in executor):**

```
parameters: {
  type: "object",
  required: ["name"],
  properties: {
    name:             { type:"string", description:"Public-facing brand name (1-80 chars)" },
    slug:             { type:"string", description:"URL slug, lowercase hyphenated. Auto-derived from name if omitted." },
    description:      { type:"string", description:"Optional short description (<=500 chars)" },
    contact_email:    { type:"string", description:"Optional brand contact email" },
    default_currency: { type:"string", description:"3-letter ISO currency code (e.g. USD, GBP, NGN). If omitted, uses the user's preferred currency." },
    cover_media_url:  { type:"string", description:"Cover media URL — set by the Add cover picker, NOT by the model. Leave unset; the user attaches it via the card." },
    cover_media_type: { type:"string", enum:["image","gif","video"], description:"Cover media type. Set by the picker alongside cover_media_url." }
  }
}
```

**Executor changes (LOCKED behaviour):**
1. **Currency de-GBP (Discovery #3 / [[orch-1034]]):** REPLACE the `: "GBP"` hard default at `agentTools.ts:131`. Resolution order: (a) `args.default_currency` if a valid 3-letter ISO string → `.toUpperCase().slice(0,3)`; else (b) the user's `agent_user_profile.preferred_currency` (the executor receives only `userId` — it must read it: `client.from("agent_user_profile").select("preferred_currency").eq("user_id", userId).maybeSingle()`); else (c) the column default — **insert with `default_currency` OMITTED from the row so the DB/`brands` default applies** rather than writing a literal `"GBP"`. Mirror the `create_experience` precedent (`agentTools.ts:418-420`) which already does `brand.default_currency ?? "GBP"` only as a final fallback — but for create there is no brand row yet, so the fallback is "omit and let the column default decide." **Do NOT write the string `"GBP"` anywhere in this executor.** (Strict-grep target — see Regression §11.)
2. **Cover (LOCKED):** if `args.cover_media_url` is a valid `https://` string AND `args.cover_media_type ∈ {image,gif,video}`, include `cover_media_url` + `cover_media_type` in the insert row. If only one is present, ignore both (atomic pair). The model is instructed NOT to fabricate these (prompt §5.1) — they arrive only from the Add-cover picker via `edited_args`.
3. **`default_brand_id` on first brand (LOCKED — Discovery #5, wizard parity `BrandCreationFlow.tsx:310-318`):** AFTER a successful insert, count the user's non-deleted brands: `client.from("brands").select("id", {count:"exact", head:true}).eq("account_id", userId).is("deleted_at", null)`. If count === 1 (this is the only brand), set it as default: `client.from("creator_accounts").update({ default_brand_id: <newBrandId> }).eq("id", userId)` (or whatever the creator-account PK/owner column is — confirm against `softDeleteBrand`'s clear-default write which targets `creator_accounts … WHERE default_brand_id = brandId`). This is **non-fatal fire-and-forget** (mirror `softDeleteBrand` step 3 / I-PROPOSED-B): a failure here must NOT fail the create — log and continue, brand is already created.
4. **23505 → SLUG_TAKEN** unchanged (`agentTools.ts:145-150`).
5. **Return shape (EXTENDED):** `{ brand: { id, name, slug, default_currency, cover_media_url, cover_media_type, created_at }, set_as_default: boolean }`. Add `cover_media_url`, `cover_media_type` to the `.select(...)` and `set_as_default` to the return so the receipt card (§6.iv) can render the cover thumbnail and "set as your current brand."

### 3.2 `update_brand` — NEW tool

Mirror `update_event`'s sparse-patch shape (`agentTools.ts:300-348`). Editable field set = the owner-editable subset of `updateBrand()` (`brandsService.ts` `mapUiToBrandUpdatePatch`).

**Declaration:**
```
{
  name: "update_brand",
  description: "Modify fields on a brand owned by the user. Only the provided fields are updated. Cover media is set via the Add cover button, not by you.",
  parameters: {
    type: "object",
    required: ["brand_id"],
    properties: {
      brand_id:         { type:"string", description:"UUID of the brand to update" },
      name:             { type:"string", description:"New public-facing brand name (1-80 chars)" },
      description:      { type:"string", description:"New short description (<=500 chars)" },
      contact_email:    { type:"string", description:"New brand contact email" },
      default_currency: { type:"string", description:"New 3-letter ISO currency code" },
      cover_media_url:  { type:"string", description:"Cover media URL — set by the Add cover picker, NOT by you." },
      cover_media_type: { type:"string", enum:["image","gif","video"], description:"Cover media type, set by the picker alongside cover_media_url." }
    }
  }
}
```

**Executor (LOCKED):**
1. `if (!isUuid(args.brand_id)) throw new ToolError("INVALID_ARGS", "brand_id must be a uuid")`.
2. `await assertBrandOwned(client, args.brand_id, userId)` — FK/ownership pre-check under the user JWT (mirrors `update_event` `:323`). RLS is the final wall (I-ARI-USER-JWT-ONLY).
3. Build a sparse `updates` object — only keys present in `args`:
   - `name` → trimmed, ≤80, else `INVALID_ARGS`.
   - `description` → ≤500, else `INVALID_ARGS`.
   - `contact_email` → non-empty string (light shape check; the column has no constraint to mirror).
   - `default_currency` → valid 3-letter ISO → `.toUpperCase().slice(0,3)`.
   - `cover_media_url` + `cover_media_type` → set as an **atomic pair** only (both present, url is `https://`, type ∈ enum); else ignore both.
   - Map `description` → the SAME column the app's `updateBrand` writes for the brand short description. **The investigation notes `updateBrand` maps "description" to a tagline+bio split via `mapUiToBrandUpdatePatch`.** The Ari tool CANNOT import the RN service into Deno (§c), so the implementor MUST confirm by reading `mapUiToBrandUpdatePatch` which physical column(s) the app writes for the short description and write the SAME column(s) directly. 🎨 OPEN micro-decision (see §10 Q3): whether Ari's single `description` maps to `bio`, `tagline`, or both — resolve against the column the wizard's bio field persists, so an Ari edit and a wizard edit are interchangeable.
4. `if (Object.keys(updates).length === 0) throw new ToolError("INVALID_ARGS", "No fields provided to update")`.
5. `updates.updated_at = new Date().toISOString()`.
6. Write under the user JWT, filtering soft-deleted rows:
   ```
   client.from("brands").update(updates)
     .eq("id", args.brand_id).is("deleted_at", null)
     .select("id, name, slug, default_currency, cover_media_url, cover_media_type, updated_at")
     .single()
   ```
   On error → `ToolError("WRITE_FAILED", error.message)`. (No 23505 path unless `name`/`slug` collide — if `name` change can collide on the unique slug, map 23505 → `SLUG_TAKEN` like create.)
7. Return `{ brand: data }`.

### 3.3 `delete_brand` — NEW tool (HIGHEST RIGOR — zero-bypass owner soft-delete)

Replicates `softDeleteBrand(brandId)` (`brandsService.ts:673-753`) guard order EXACTLY, under the user JWT. **No hard delete. No admin RPC. No skip of any guard.**

**Declaration:**
```
{
  name: "delete_brand",
  description: "Delete a brand the user owns. Soft-delete only — recoverable for 30 days via support. REFUSED if the brand has any scheduled or live future-dated event/trip/experience; the user must cancel or transfer those first. The user must type the brand name to confirm.",
  parameters: {
    type: "object",
    required: ["brand_id"],
    properties: {
      brand_id: { type:"string", description:"UUID of the brand to delete" }
    }
  }
}
```

**Executor (LOCKED — exact guard order; deviation is a P0):**
1. `if (!isUuid(args.brand_id)) throw new ToolError("INVALID_ARGS", "brand_id must be a uuid")`.
2. `await assertBrandOwned(client, args.brand_id, userId)` — ownership + not-already-deleted.
3. **GUARD — blocking-events count (the core customer protection, `softDeleteBrand` step 1 `brandsService.ts:688-707`):** count `events` rows for this brand with `status IN ('scheduled','live')` (constant `BRAND_DELETE_BLOCKING_EVENT_STATUSES`) joined `event_dates!inner` where `end_at > now()`. This is intentionally **type-agnostic** (also blocks scheduled trips/experiences — keep the `orch-strict-grep-allow events-type-filter` rationale; do NOT add an `event_type` filter). If `count > 0` → throw `ToolError("DELETE_BLOCKED_BY_EVENTS", "This brand has N upcoming or live event(s). Cancel or transfer them before deleting.")` carrying the count in the message. **This is a recoverable refusal — surfaced as a clear Ari message (§6.iii), NOT a crash.** NOTE: `softDeleteBrand` returns `{rejected:true,...}` rather than throwing; the Ari tool MUST throw a `ToolError` instead, because `agent-confirm-action` maps `ToolError` → a `failed` tool_result + HTTP code, which is how the refusal reaches the chat. Add `DELETE_BLOCKED_BY_EVENTS` to the HTTP-code map (§4) as 409 (conflict) — a recoverable, user-actionable state.
4. **Soft-delete (step 2 `:709-731`):** `client.from("brands").update({ deleted_at: new Date().toISOString() }).eq("id", args.brand_id).is("deleted_at", null).select("id").single()`. **Rowcount-verified:** if no row returns (RLS denial / already-deleted / race) → `ToolError("WRITE_FAILED", "Brand could not be deleted (already removed or not permitted).")`. Idempotent by construction (the `.is("deleted_at", null)` filter).
5. **Clear `default_brand_id` (step 3 `:733-750`, I-PROPOSED-B):** `client.from("creator_accounts").update({ default_brand_id: null }).eq("default_brand_id", args.brand_id)`. **Non-fatal fire-and-forget** — a failure here must NOT fail the delete (the brand is already soft-deleted); log and continue.
6. Return `{ brand: { id: args.brand_id }, deleted: true, recovery_window_days: 30 }`.

**Forbidden in this executor (strict-grep / review gates §11):** `.delete()`, `DELETE FROM`, `admin_suspend_listing`, any service-role client, any path that stamps `deleted_at` BEFORE the blocking-events count returns, any `event_type=` filter on the blocking count.

### 3.4 Registry + READ_ONLY sets
- Add `updateBrand` and `deleteBrand` to `AGENT_TOOLS` (`agentTools.ts:533-540`).
- Do NOT add either to `READ_ONLY_TOOL_NAMES` (`:547`) — both are WRITE tools and MUST flow through the propose→confirm path.

---

## 4. Edge function layer — `agent-confirm-action/index.ts`

**No dispatch change** — `findTool` + `tool.executor` already handles new tools generically (investigation §a, verified). Two LOCKED additions:

1. **HTTP-code map (`index.ts:223-233`):** add `DELETE_BLOCKED_BY_EVENTS` → **409**. Keep existing: `OWNERSHIP_DENIED`→403, `INVALID_ARGS`/`SLUG_TAKEN`→400, else 500. (`OWNERSHIP_CHECK_FAILED` falls through to 500, unchanged.)
2. **`buildFollowupText` (`index.ts:288-309`):** add cases:
   - `update_brand` → `result?.brand?.name ? \`Updated "${name}". Anything else?\` : "Updated. Anything else?"`.
   - `delete_brand` → `\`Deleted that brand. It's recoverable for 30 days through support if you change your mind.\``.
   - `create_brand` (EXTENDED) → keep the existing copy BUT do not promise event chaining as an auto-step; current copy "Want to schedule an event under it?" is acceptable as a SUGGESTION (the user must re-ask — non-goal chaining). If `set_as_default` was true, optionally append "It's now your current brand." 🎨 OPEN copy polish (§10 Q5).

`agent-chat/index.ts` brand-summary select (`:197-203`) is widened in §5.

---

## 5. System-prompt layer — `_shared/agentSystemPrompt.ts` + brand-context source

### 5.1 CAPABILITIES list (LOCKED — registry↔prompt sync, fixes the drift class from Discovery #2)
Add to the `CAPABILITIES` block (`agentSystemPrompt.ts:77-82`):
```
- update_brand — modify fields on a brand the user owns
- delete_brand — delete a brand the user owns (soft-delete, recoverable 30 days; refused if it has upcoming/live events)
```
Add a one-line cover note under WRITE DISCIPLINE: "Cover images/videos for a brand are attached by the user via the Add cover button on the proposal card — never invent a cover_media_url; leave it unset and the user will attach one if they want."

**(Out of scope but FLAGGED:** `create_experience` is in the registry yet absent from CAPABILITIES — same drift class. Do NOT fix here; §12.)

### 5.2 Richer brand context (LOCKED — enables edit/delete targeting & disambiguation)
The prompt currently injects only `id : name` (`agentSystemPrompt.ts:43-45`, fed by `agent-chat/index.ts:197-203` selecting `id, name`).

**Widen the `agent-chat` brand-summary select** to: `id, name, slug, default_currency, cover_media_url`. Additionally, to mark deletable vs blocked, the brand summary must carry a **`has_blocking_events` boolean** per brand. Two acceptable implementations (🎨 OPEN Q1, implementor picks the cheaper correct one):
   - (a) a single grouped query: count `events` (status IN scheduled,live, `event_dates!inner end_at > now()`) grouped by `brand_id`, mapped onto the brand list; OR
   - (b) one lightweight RPC. Prefer (a) — no migration, mirrors the delete guard's own count semantics so the prompt's "deletable" hint and the executor's actual guard cannot drift.

**Update `BrandSummary` interface** (`agentSystemPrompt.ts:22-25`) to:
```
interface BrandSummary {
  id: string;
  name: string;
  slug: string;
  defaultCurrency: string | null;
  hasCover: boolean;          // cover_media_url != null
  hasBlockingEvents: boolean; // upcoming/live events exist → not deletable
}
```

**Update the injected block** (`agentSystemPrompt.ts:43-45`) from `- ${id} : ${name}` to a richer one-line-per-brand form, names still escaped via `escapeForPrompt` (200-char cap, `<>` stripped). Proposed line:
```
- ${id} : "${escapeForPrompt(name)}" (currency ${defaultCurrency ?? "default"}, ${hasCover ? "has cover" : "no cover"}, ${hasBlockingEvents ? "has upcoming events — NOT deletable yet" : "deletable"})
```
Keep the empty-state line. This lets Gemini: resolve "edit my coffee brand" to the right UUID by name; answer "is X deletable?" without a round-trip; and avoid proposing a `delete_brand` it knows will be refused (it should instead tell the user to cancel/transfer first). The executor guard remains the source of truth — the prompt hint is advisory.

**Currency note in prompt:** under KNOWN CONTEXT, the existing `Preferred currency` line already feeds the de-GBP default. No new prompt line needed for currency on create beyond "if the user doesn't specify a currency, omit it — their account default applies."

`PROMPT_VERSION` (`:13`): bump `"v2"` → `"v3"` (rules changed: new tools, brand-context shape, currency/cover discipline). Persisted on every message via `prompt_version` (`agent_messages`).

---

## 6. Component layer — conversational flows wired to ORCH-1101 components

Host: `MessageList.tsx` renders the live `ToolProposalCard` for a pending action and renders the ORCH-1101 cards as Ari-lane items under the single-live-at-tail rule (verified `MessageList.tsx:1-57`). The ORCH-1101 components (`ClarifyingCard`, `QuickReplyChips` CHOICE, `MultiSelectPrompt`, `ResponseCard`) are shipped, finished visuals with **zero production wiring** (investigation §g). This spec defines their FUNCTIONAL wiring + UX acceptance bar; the granular visual contract is OWNED by the required `mingla-designer` pass (§9, §13).

### 6.i Create-brand proposal card WITH Add-cover (LOCKED functional contract)
- When `pendingAction.tool_name === "create_brand"`, `ToolProposalCard` renders as today PLUS an **"Add cover"** affordance.
- **`humanizeToolName`** (`ToolProposalCard.tsx:52-59`): add `update_brand` → "Update brand", `delete_brand` → "Delete brand".
- **`primaryIdentity`** (`:61-66`): add `update_brand` → resolve the brand name from the richer prompt-known brands if available, else "Brand update"; `delete_brand` → the brand name being deleted.
- **`fieldsFor`** (`:68-103`): for `create_brand`/`update_brand` also surface a Cover row when `args.cover_media_url` is set (label "Cover", value = type, e.g. "video"/"image"). Keep Currency + Slug rows.
- **Add-cover button (NEW, on the card, create + edit):** opens the EXISTING `CoverPickerSheet` with `target.kind="brand"`. For **create_brand** there is no `brandId` yet — see §6.vi for the deferred-persist contract. On the sheet's "Use this cover" confirm, thread the resulting `CoverPatch.coverMediaUrl` + `coverMediaType` into the card's `editedArgs` (`ToolProposalCard` already holds `editedArgs` state `:113`); they flow to the executor via `onConfirm(editedArgs)`.
- **`ToolEditForm`** (`ToolEditForm.tsx:30-48`): extend the `create_brand` branch and add an `update_brand` branch. Editable inline text fields: Name, Description, Currency (free-text 3-letter, or 🎨 a `QuickReplyChips` currency picker — §10 Q4). The cover is NOT a text field — it is the Add-cover button. Currency field MUST be editable here (closes the §b hidden-flaw that currency/cover were uneditable).

### 6.ii "Which brand?" disambiguation (LOCKED)
When the user says "edit/delete my brand" and the prompt-known brand list has ≥2 brands and Gemini cannot resolve a single target by name, Ari asks via **`QuickReplyChips` CHOICE mode** (`options = {id: brandId, label: brandName}[]`, single-select). On select, the chosen `brandId` becomes the `brand_id` arg for the subsequent `update_brand`/`delete_brand` proposal. If exactly one brand exists, no disambiguation — Ari targets it directly. `ClarifyingCard` is the fallback when a free-text answer is more natural ("which one?").
- **Wiring mechanics (🎨 OPEN Q2):** how the chip selection feeds back into a tool proposal — either (a) the selection sends a follow-up user message naming the brand, Gemini re-proposes; or (b) a client-side shortcut that pre-fills `brand_id`. Prefer (a) — keeps Gemini as the single proposer, no new client tool-call path. Designer + implementor resolve.

### 6.iii Delete confirmation surfacing cascade + type-to-confirm + refusal (LOCKED)
The Ari delete confirmation MUST present the same protections the `BrandDeleteSheet` shows (investigation §d), inside the Ari proposal/confirm UX:
- **Future-events refusal:** if the brand has blocking events, Ari does NOT show a deletable proposal. It states plainly (driven by prompt §5.2 `hasBlockingEvents` hint and, if the user forces a proposal, by the executor's `DELETE_BLOCKED_BY_EVENTS` 409 → `failed` tool_result): "Can't delete <brand> — it has N upcoming/live event(s). Cancel or transfer those first." (clear Ari message, surfaced via the failure-reason path the prompt already handles `agentSystemPrompt.ts:86-89`).
- **Cascade preview:** the delete proposal card surfaces the same cascade facts the sheet shows — recoverable 30 days, data preserved (events/orders/refunds/audit logs), Stripe Connect unlinks. 🎨 OPEN Q6: whether to reuse `useBrandCascadePreview` to show live counts in the card or show a static copy block. Prefer showing live counts (reuse the hook) for parity with the sheet.
- **Type-to-confirm:** the delete proposal MUST require the user to **type the brand's `displayName`** (case-insensitive match, mirroring `BrandDeleteSheet` `canConfirm` `:110-116`) before Confirm is enabled. This is an ADDITIONAL gate ON TOP of the normal proposal Confirm. Implement as a typed field on the delete-variant proposal card (or a `ClarifyingCard`-style typed confirm). Confirm stays disabled until the typed string matches. This is LOCKED — Ari must never soft-delete without the typed-name match.

### 6.iv Created/updated-brand receipt (LOCKED)
After a successful `create_brand`/`update_brand`, render a **`ResponseCard`** receipt (in addition to / replacing the prose followup): `title = "Created <brand>"` / `"Updated <brand>"`, `rows = [{label:"Currency", value}, {label:"Slug", value}]`, `thumbnail = cover_media_url` (REAL URI only — omit if none; anti-slop), `actions = [{id:"edit", label:"Edit"}]` (NO "Add event" auto-chain action that executes — a label that merely seeds a user message is fine, but it must NOT auto-create an event; non-goal). `showOrb` per ORCH-1101 default.
- **Wiring (🎨 OPEN):** the receipt can be derived from the `executed` tool_result message already persisted (`agent-confirm-action` writes a `role:"tool"` message with `tool_results.result`). `MessageList` can render a `ResponseCard` for an executed brand tool_result instead of / alongside the plain success ribbon. Designer resolves whether the receipt replaces or supplements the existing ribbon.

### 6.v No-brand → "want me to create one?" handoff (LOCKED — the ONLY handoff point in scope)
- This is driven by the prompt's empty-brands line ("the user has no brands yet — they may want to create one first", `agentSystemPrompt.ts:45`) PLUS a new explicit rule: "If the user asks to create an event/experience/trip and they have NO brands, do NOT call create_event. First explain they need a brand, then propose create_brand. After the brand is created, tell them it's ready and ask them to tell you about the event — do NOT auto-create the event."
- **UX:** Ari offers a **`QuickReplyChips` CHOICE** or `ClarifyingCard` "Want me to create a brand first?" → on yes, Ari proposes `create_brand` (the §6.i card). On success (§6.iv receipt), Ari STOPS at the hand-back: a prose line "Your brand <name> is ready — tell me about the event and I'll set it up." **No event tool is called.** (The event-creation chaining is the deliberate follow-on ORCH.)
- This must work whether the user reached Ari directly OR was bounced from the `app/event/create.tsx` `no_brand` dead-end (that route is NOT modified by this spec — it remains a dead-end; ORCH-1103 only gives Ari the capability; routing the dead-end INTO Ari is a separate concern flagged in §12).

### 6.vi Deferred cover persist on CREATE (LOCKED — the brandId-doesn't-exist-yet problem)
The `CoverPicker` `kind:"brand"` target persists LIVE to `brands.cover_media_url` and requires a `brandId` (investigation §e). On **create**, there is no brand row yet. Therefore:
- For **create_brand**, the Add-cover button MUST NOT persist live. It opens the CoverPicker in a "pick, don't persist" manner and returns the chosen media as a `CoverPatch` (url + type) WITHOUT writing any brand row. Those values ride in `create_brand`'s `cover_media_url`/`cover_media_type` args and are written by the executor's insert (§3.1.2).
  - **Provider media (Pexels/GIPHY) and remote URLs** are already public URLs — they can be threaded directly into args with no upload step.
  - **Device uploads (image/gif/video)** are the hard case: the existing brand upload path writes to the `brand_covers` bucket at `{brandId}/{token}.ext` and needs a brandId. 🎨 **OPEN Q7 (designer + implementor MUST resolve):** for a device upload chosen before the brand exists, either (a) upload to a brandId-less staging path then move on create, (b) defer device-upload-on-create — i.e. on create, Add-cover offers ONLY Pexels/GIPHY/remote (no device upload), and device upload becomes available via "Edit cover" after the brand exists (when `update_brand` + a real brandId enable the live CoverPicker), or (c) create the brand first then attach cover as a second step. **Recommended: (b)** — simplest, no staging-bucket plumbing, and device upload is fully supported on EDIT where a brandId exists. The dispatch's "Add cover on create + edit" is satisfied: create offers provider/remote covers; edit offers the full picker incl. device video. Implementor confirms feasibility; if (b) is taken, the create proposal's Add-cover sheet hides the Library (device) tab.
- For **update_brand**, a real `brandId` exists → the Add-cover button opens the FULL `CoverPickerSheet` (`target.kind="brand"`, all tabs incl. device video) which persists live to `brands.cover_media_url`. In that case the cover is already persisted by the picker; `update_brand`'s `cover_media_url` arg is then redundant for the write but SHOULD still be threaded so the proposal card + receipt reflect the chosen cover. (Persisting twice is idempotent — same URL.)

---

## 7. Hook / service layer

- **No new RN service.** Ari tools write directly under the JWT in Deno (they cannot import `brandsService` — investigation §c). The RN `updateBrand`/`softDeleteBrand` services are the REFERENCE for column mapping + guard order, replicated in the Deno executor.
- **`useBrandCoverUpload` / `useEventCoverVideoUpload` / `CoverPickerSheet`** — reused AS-IS for the EDIT cover path (real brandId). No changes unless §6.vi(b) requires hiding the device tab on create (a prop on the sheet open, not a hook change).
- **`useBrandCascadePreview`** (`useBrands.ts:497-580`) — reused read-only IF §6.iii shows live cascade counts (🎨 Q6).
- **`useAgentChat`** (`useAgentChat.ts`) — the `pendingAction` state + confirm/cancel handlers are reused. The Add-cover → `editedArgs` threading happens inside `ToolProposalCard` (already holds `editedArgs`), so no `useAgentChat` change is strictly required; if the cover threading needs to survive an Edit-mode toggle, that's a `ToolProposalCard` state concern, not a hook change.

---

## 8. Success Criteria (observable, testable, unambiguous)

Parity is automatic across Business iOS + Android (shared code); criteria apply to both unless noted.

- **SC-1** Ari can edit a brand: user says "rename my brand to X" → Ari proposes `update_brand` with `{brand_id, name:"X"}` → on Confirm the brand row's `name` changes and a "Updated <X>" receipt renders. The `default_currency`, `description`, `contact_email`, and cover are all editable via the same tool.
- **SC-2** Ari can delete a brand with NO future events: proposes `delete_brand` → type-to-confirm (name match) → Confirm → `brands.deleted_at` is stamped, `creator_accounts.default_brand_id` cleared if it pointed here, receipt says "recoverable 30 days." The brand disappears from `list_brands` (filters `deleted_at IS NULL`).
- **SC-3 (delete guard — no bypass)** When the brand HAS a scheduled/live future-dated event (or trip/experience), `delete_brand` is REFUSED: `deleted_at` is NOT stamped, and Ari surfaces "Can't delete — N upcoming events; cancel or transfer first." The executor returns 409 `DELETE_BLOCKED_BY_EVENTS`. There is NO code path that stamps `deleted_at` before the blocking-events count returns 0.
- **SC-4** `create_brand` no longer writes the literal `"GBP"`: a brand created by a user whose `preferred_currency="USD"` has `default_currency="USD"`; a user with no preferred currency gets the column default (NOT a hard "GBP" string written by the executor).
- **SC-5** First brand becomes default: when a user with zero brands creates their first via Ari, `creator_accounts.default_brand_id` is set to it. A user with existing brands creating a 2nd does NOT have their default changed.
- **SC-6 (ownership)** `update_brand`/`delete_brand` against a brand the caller does not own returns 403 `OWNERSHIP_DENIED`; nothing is written. RLS denies even if `assertBrandOwned` were bypassed.
- **SC-7 (media create)** Tapping "Add cover" on a create-brand proposal, picking a Pexels/GIPHY/remote cover, and confirming → the created brand has `cover_media_url` + `cover_media_type` set from the picker, and the receipt shows the cover thumbnail. (Device-upload-on-create per the §6.vi(b) decision: device tab hidden on create.)
- **SC-8 (media edit)** Tapping "Add cover" on an update-brand proposal opens the full CoverPicker (device image/gif/**video** + Pexels + GIPHY); choosing a video persists `brands.cover_media_url` (the processed video URL) + `cover_media_type="video"`.
- **SC-9 (registry↔prompt sync)** Both `update_brand` and `delete_brand` appear in `AGENT_TOOLS` AND in the system-prompt CAPABILITIES list. A test asserts every registered WRITE tool name appears in the CAPABILITIES block.
- **SC-10 (disambiguation)** With ≥2 brands and an ambiguous "edit my brand", Ari presents a `QuickReplyChips` CHOICE of the user's brands; selecting one targets that `brand_id`.
- **SC-11 (no-brand handoff)** A user with zero brands who asks "create an event" gets, from Ari: an explanation + a `create_brand` proposal (NOT a `create_event` call). After the brand is created, Ari hands back with a prose prompt and does NOT auto-create the event.
- **SC-12 (no hard delete)** Grep proves `delete_brand`'s executor contains no `.delete()`, no `DELETE FROM`, no `admin_suspend_listing`, no service-role client.
- **SC-13 (type-to-confirm)** The delete proposal's Confirm is disabled until the user types the brand's display name (case-insensitive match).

---

## 9. Visual & UX Granularity Contract

The functional contract above is LOCKED here. The **granular visual contract** (exact tokens, all 9 states with Mingla-voice copy, motion, haptics, contrast ratios, no-AI-slop bans, safe-area/edge, the Add-cover button placement on the proposal card, the type-to-confirm field styling, the disambiguation chip styling, the receipt card layout) is OWNED by a **required `mingla-designer` DESIGN pass** (§13 handoff). This SPEC REQUIRES that design contract to exist and be referenced before implementation; it must NOT ship with visuals undefined.

The ORCH-1101 components (`ToolProposalCard`, `ClarifyingCard`, `QuickReplyChips` CHOICE, `MultiSelectPrompt`, `ResponseCard`) already carry the locked visual system (glass tokens, ariThread density, warm `userBubble` accent, AriOrb). The designer's job is the NET-NEW surfaces: the Add-cover button on the proposal card, the delete-variant proposal (cascade preview + type-to-confirm field), the disambiguation chip flow, and the brand receipt card population. No-slop bans (no generic gradients, no stock/AI imagery, no emoji icons, real cover thumbnails only) carry over from premium-craft.

**References examined:** existing ARI ORCH-1101 cards (in-repo), `BrandDeleteSheet.tsx` (the protection UX being mirrored), `BrandCreationFlow.tsx` Step 3 cover (the picker being reused). Designer to add competitor references for conversational CRUD-with-confirm moments.

---

## 10. Open design questions (designer/implementor MUST resolve before/at IMPLEMENT)

- **Q1 (impl):** brand `hasBlockingEvents` source — grouped count query vs RPC. Prefer the grouped query (no migration; semantics identical to the delete guard).
- **Q2 (design+impl):** disambiguation chip → tool proposal feedback path — follow-up user message (preferred, keeps Gemini the sole proposer) vs client pre-fill of `brand_id`.
- **Q3 (impl):** which physical column(s) Ari's single `description` arg maps to for `update_brand`/`create_brand` so it's interchangeable with the wizard's bio field (read `mapUiToBrandUpdatePatch`).
- **Q4 (design):** currency input in `ToolEditForm` — free-text 3-letter field vs a `QuickReplyChips` currency picker (USD/GBP/NGN/EUR…). De-GBP direction favors NOT defaulting visually to GBP.
- **Q5 (design):** create/update/delete `buildFollowupText` + receipt copy in Ari voice; whether the create followup keeps "Want to schedule an event?" as a non-executing suggestion.
- **Q6 (design+impl):** delete proposal — live cascade counts (reuse `useBrandCascadePreview`) vs static protection copy. Prefer live counts for sheet-parity.
- **Q7 (design+impl):** device-upload cover on CREATE (no brandId yet) — recommended resolution (b): hide the Library/device tab on the create proposal's Add-cover sheet; device upload + video available on EDIT. Confirm feasibility of (b) and the sheet prop to hide the device tab.

---

## 11. Invariants & Regression Prevention

### Invariants this change MUST preserve
- **I-ARI-USER-JWT-ONLY** (`agentTools.ts:9-10`) — both new executors use ONLY the passed user-scoped client; NEVER service role. Test: grep the executors for `service` / `SERVICE_ROLE` → must be empty.
- **I-ARI-USER-DATA-WRAP** — brand names injected into the prompt stay escaped via `escapeForPrompt` (`agentSystemPrompt.ts:98-100`); the richer brand line must route names through `escapeForPrompt`.
- **I-PROPOSED-A (deleted_at IS NULL filters)** — every brand read/write in the new tools uses `.is("deleted_at", null)` (never `.neq`); `list_brands` already does. `assertBrandOwned` already does.
- **I-PROPOSED-B / R-3 (`default_brand_id` cleanup)** — `delete_brand` clears `default_brand_id` non-fatally; `create_brand` sets it on first brand non-fatally.
- **Customer-protection (NEW invariant — name it `I-ARI-BRAND-DELETE-GUARD`):** Ari can NEVER soft-delete a brand that has any `status IN ('scheduled','live')` event with `event_dates.end_at > now()`. The blocking count runs BEFORE the `deleted_at` stamp, type-agnostically. Mirrors `softDeleteBrand` step 1. Register this invariant in `INVARIANT_REGISTRY.md` at IMPLEMENT.
- **No-hard-delete (NEW invariant — `I-ARI-NO-HARD-DELETE`):** no Ari code path issues `.delete()` / `DELETE FROM` against `brands`, and `delete_brand` never calls `admin_suspend_listing`.
- **Atomic confirm (`agent-confirm-action:171-180`)** — the existing `UPDATE … status='executing' WHERE status='pending'` replay guard is unchanged and protects double-delete.
- **Mingla-business pk_live / Android-glass / TopSheet** invariants — untouched (no payment/glass/sheet contract changes).

### Regression prevention (structural safeguards — strict-grep gates the implementor adds)
- **G-1:** assert `create_brand`'s executor does NOT contain the literal `"GBP"` (de-GBP enforcement, SC-4).
- **G-2:** assert `delete_brand`'s executor contains NONE of `.delete(`, `DELETE FROM`, `admin_suspend_listing`, `serviceRole`/`SERVICE_ROLE` (SC-12).
- **G-3:** assert every WRITE tool name in `AGENT_TOOLS` (minus `READ_ONLY_TOOL_NAMES`) appears in the `agentSystemPrompt.ts` CAPABILITIES block (kills the registry↔prompt drift class; SC-9). NOTE: this gate will ALSO flag the pre-existing `create_experience` omission — see §12; the implementor should either include `create_experience` in the prompt as a trivial side-fix UNDER orchestrator sign-off, or scope the gate to the ORCH-1103 tools. Flag, don't silently widen.
- **G-4:** a unit/contract test that `delete_brand` with a seeded blocking event does NOT stamp `deleted_at` and returns 409.

---

## 12. Flagged for separate cleanup (do NOT fix here)
1. **`create_experience` prompt/registry drift** (Discovery #2): it's in `AGENT_TOOLS` but absent from CAPABILITIES. The G-3 gate will surface it. Orchestrator to spawn a 1-line cleanup ORCH (or accept it under ORCH-1103 with sign-off).
2. **`app/event/create.tsx` `no_brand` dead-end** (Discovery #4): the route tells the user to make a brand but offers no path. ORCH-1103 gives Ari the capability; routing the dead-end INTO Ari (a "Set up with Ari" CTA on that card) is a separate UX follow-on.
3. **`BrandCoverPickerSheet.tsx` dead orphan** (Discovery #1): untracked in the anchor, retired by ORCH-0989. Orchestrator cleanup note; not touched here.

---

## 13. Implementation order & handoff

**Order (DB→edge→service→hook→component):**
1. `_shared/agentTools.ts` — extend `create_brand`; add `update_brand` + `delete_brand`; register both. (no migration)
2. `_shared/agentSystemPrompt.ts` — CAPABILITIES + richer `BrandSummary` + bump `PROMPT_VERSION` to v3.
3. `agent-chat/index.ts` — widen brand-summary select + `hasBlockingEvents` computation.
4. `agent-confirm-action/index.ts` — `DELETE_BLOCKED_BY_EVENTS`→409 map + `buildFollowupText` cases.
5. `ToolProposalCard.tsx` / `ToolEditForm.tsx` — brand verbs, Add-cover button, cover/currency editable, delete-variant type-to-confirm + cascade.
6. `MessageList.tsx` — render brand `ResponseCard` receipt for executed brand tool_results; wire disambiguation `QuickReplyChips` CHOICE + no-brand handoff prompt.
7. Tests + strict-grep gates G-1..G-4.

**New files:** none required (all wiring lands in existing files; the ORCH-1101 cards already exist).
**Touched files:** `supabase/functions/_shared/agentTools.ts`, `supabase/functions/_shared/agentSystemPrompt.ts`, `supabase/functions/agent-chat/index.ts`, `supabase/functions/agent-confirm-action/index.ts`, `mingla-business/src/components/ari/ToolProposalCard.tsx`, `mingla-business/src/components/ari/ToolEditForm.tsx`, `mingla-business/src/components/ari/MessageList.tsx`, plus `__tests__` for the gates. (Reused unchanged: `CoverPickerSheet`/`CoverPicker`, `useBrandCoverUpload`, `useEventCoverVideoUpload`, `useBrandCascadePreview`, `useAgentChat`, the 4 ORCH-1101 cards.)

**Next phase:** `mingla-designer` for the in-chat brand-flow visuals (Add-cover button placement, delete-variant card with cascade + type-to-confirm, disambiguation chips, brand receipt card, the 9 states + copy), then `mingla-implementor`.

---

## 14. Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Edit brand name | "rename brand to Lumen" on owned brand | `update_brand` proposal → Confirm → `brands.name='Lumen'`, "Updated Lumen" receipt | Full stack |
| T-02 | Edit currency | update_brand `{default_currency:"USD"}` | row currency=USD; no GBP written | Tool + DB |
| T-03 | Delete, no future events | owned brand, no scheduled/live dated events, type name, Confirm | `deleted_at` stamped, default cleared, 200 | Full stack |
| T-04 | **Delete refused — future event** | owned brand WITH a scheduled future-dated event | 409 `DELETE_BLOCKED_BY_EVENTS`, `deleted_at` NULL, Ari "N upcoming events" msg | Tool + DB |
| T-05 | Delete refused — future trip/experience | brand with scheduled future-dated experience | 409, NOT deleted (type-agnostic guard) | Tool + DB |
| T-06 | Ownership rejection (update) | `update_brand` on a brand owned by another account | 403 `OWNERSHIP_DENIED`, no write | Tool + RLS |
| T-07 | Ownership rejection (delete) | `delete_brand` on another's brand | 403, no `deleted_at` change | Tool + RLS |
| T-08 | Currency no longer GBP-forced | create_brand, no currency, user pref=USD | brand currency=USD | Tool + DB |
| T-09 | Currency falls to column default | create_brand, no currency, no user pref | currency = column default, no literal "GBP" string in executor | Tool + DB |
| T-10 | default_brand_id set on first brand | user with 0 brands creates one | `default_brand_id` = new brand | Tool + DB |
| T-11 | default NOT changed on 2nd brand | user with 1 brand creates a 2nd | `default_brand_id` unchanged | Tool + DB |
| T-12 | Cover on create (provider) | Add-cover → Pexels pick → confirm create | brand `cover_media_url`+`cover_media_type` set; receipt thumbnail | Component + Tool + DB |
| T-13 | Cover on edit (video) | Add-cover on update → device video → ready | `brands.cover_media_url`=processed video URL, type=video | Component + hook + DB |
| T-14 | Registry↔prompt sync | static gate G-3 | update_brand + delete_brand in BOTH registry and CAPABILITIES | Static |
| T-15 | No hard delete | static gate G-2 | no `.delete()`/`DELETE FROM`/`admin_suspend_listing`/service-role in delete_brand | Static |
| T-16 | Type-to-confirm gate | delete proposal, wrong typed name | Confirm disabled; correct name enables it | Component |
| T-17 | Disambiguation | ≥2 brands, "edit my brand" | QuickReplyChips CHOICE of brands; select targets brand_id | Component + prompt |
| T-18 | No-brand handoff | 0 brands, "create an event" | Ari proposes create_brand (NOT create_event); after create, hands back without auto-event | Prompt + component |
| T-19 | Idempotent delete | delete an already-soft-deleted brand | rowcount-0 → `WRITE_FAILED`, no crash | Tool + DB |
| T-20 | Atomic replay guard | confirm same pending delete twice | 2nd is no-op (status already executing/executed) | Edge fn |

---

## Confidence
**High.** Every contract is grounded in source read in full this turn: `agentTools.ts` (create_brand / create_event / update_event / create_experience / registry / helpers), `agentSystemPrompt.ts` (full), `agent-confirm-action/index.ts` (dispatch + HTTP map + buildFollowupText), `ToolProposalCard.tsx` + `ToolEditForm.tsx` (full), `MessageList.tsx` (host wiring), plus the investigation's verified §a–§g. No migration needed (schema confirmed present in investigation). The only un-pinned items are deliberately tagged 🎨 OPEN for the designer/implementor (§10), chiefly the device-upload-on-create path (Q7) and the disambiguation feedback mechanics (Q2).
