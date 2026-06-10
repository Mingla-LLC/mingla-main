# INVESTIGATION — ORCH-1103 [Ari smart brand CRUD + in-chat media]

**Mode:** INVESTIGATE (read-only; no code, no migrations, no deploys, no fixes)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1103-[ari-brand-crud-smart]/` on branch `ORCH-1103-ari-brand-crud-smart` (rebased onto origin/main)
**Date:** 2026-06-08
**Confidence:** High (source fully read; backend-only/architecture-mapping investigation, sim-repro exempt per Prime-Directive-7 backend exemption — no described UI runtime bug, this is a capability-gap + blast-radius map for SPEC grounding)

> Scope note: this grounds the SPEC for Ari-driven brand **create / edit / delete** + in-chat cover media (business app only — Ari lives in `mingla-business`). It documents the no-brand→brand-creation handoff POINT only; it does NOT spec event-creation chaining (deliberate follow-on ORCH).

---

## Comms ledger (read on entry)

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`. No `BLOCK` rows and no rows target `ORCH-1103`, `BrandCoverPickerSheet`, `ORCH-0805`, `mingla-forensics`, or `ARI` specifically. Open `ALL`-targeted `WARN` rows are general process guards factored into this read-only turn but none block: COMMS-0002 (ORCH-0863 strict-grep gate on `supabase/functions` PRs), COMMS-0015 (deploy edge fns from MERGED main, not a dirty worktree), COMMS-0018 (two backend deploys whose source was not on main — deploy-hygiene reminder), COMMS-0003 (external-API docs must be cited at SPEC for any provider integration — relevant to a future SPEC's Gemini/GIPHY/Pexels claims). No new cross-ORCH discovery requiring a ledger write was found EXCEPT the BrandCoverPickerSheet orphan clarification (see §E — this is a stale-orphan, not in-flight WIP, so it warrants a documentation note rather than a BLOCK; orchestrator decision).

---

## (a) Ari agent architecture — the spine

### Message → proposal → execution flow

1. **Client send.** `mingla-business/src/hooks/useAgentChat.ts:128` `sendMessage` → `agentChatService.sendAgentMessage` (`mingla-business/src/services/agentChatService.ts:101`) → `supabase.functions.invoke("agent-chat")`.
2. **`agent-chat` edge fn** (`supabase/functions/agent-chat/index.ts`):
   - Auth: requires Bearer JWT, builds a **user-scoped** Supabase client (anon key + caller Authorization header) — `index.ts:106-115`. Service role is used ONLY for rate-limit reads (`index.ts:117-125`, via `_shared/agentRateLimit.ts`).
   - Loads/creates `agent_conversations` (`index.ts:151-177`), last 10 `agent_messages` (`HISTORY_WINDOW=10`, `index.ts:22,180-186`), the `agent_user_profile` (`index.ts:189-194`), and a brands summary (`index.ts:197-203`).
   - Wraps every user-stored string in `<user_data>…</user_data>` delimiters before sending to Gemini (I-ARI-USER-DATA-WRAP, `index.ts:242-281`).
   - Calls Gemini via `_shared/agentGemini.ts` `callGemini`, passing the tool registry's name/description/parameters (`index.ts:283-294`).
   - **Branches on the Gemini result** (`index.ts:324`):
     - READ-ONLY tools (`list_brands`, `list_events` — `agentTools.ts:547`) execute **inline** in `agent-chat`, then a follow-up Gemini call summarizes (`index.ts:331-410`).
     - WRITE tools register an `agent_pending_actions` row with `status='pending'` (NOT executed) and persist an assistant message carrying `tool_calls={tool_name,args,pending_action_id}` (`index.ts:412-456`). Returns `{kind:"pending_action", pending_action_id, tool_name, tool_args, …}`.
3. **Client renders the proposal.** `useAgentChat` stores `pendingAction` (`useAgentChat.ts:105-127`); the chat thread renders `ToolProposalCard` (Cancel / Edit / Confirm). On Confirm → `agentChatService.confirmAgentAction` (`agentChatService.ts:115`) → `supabase.functions.invoke("agent-confirm-action", {action:"confirm", pending_action_id, edited_args})`.
4. **`agent-confirm-action` edge fn** (`supabase/functions/agent-confirm-action/index.ts`) — the **ONLY** function that executes a WRITE tool:
   - Loads the pending action scoped to `user_id` (`index.ts:97-105`); the row also carries `source` + `related_brand_id` (Hub-proposal columns from META-ORCH-1009).
   - CANCEL: `pending → cancelled` (`index.ts:108-137`).
   - Expiry: `expires_at < now` → lazy-flips `pending → expired` and returns an in-Hub `expired_regenerate` contract (`index.ts:143-168`) — Ari conversation path never triggers that branch except via a stale card.
   - CONFIRM: **atomic** `UPDATE … SET status='executing' WHERE status='pending'` (`index.ts:171-180`) blocks replay/double-execute. Resolves final args (`edited_args` override model args, `index.ts:182-185`). Runs `tool.executor(finalArgs, userClient, userId)` (`index.ts:200`). On success marks `executed`; on `ToolError` marks `failed` + maps codes to HTTP (`OWNERSHIP_DENIED`→403, `INVALID_ARGS`/`SLUG_TAKEN`→400, else 500; `index.ts:223-233`). Writes a `role='tool'` audit message + an optional assistant `followup_text` (`index.ts:250-285`, `buildFollowupText` at `index.ts:288-309`).

### Tool declaration shape (`supabase/functions/_shared/agentTools.ts`)

Each `AgentTool` (`agentTools.ts:16-25`) = `{ name, description, parameters (JSON Schema), executor(args, userClient, userId) }`. Defense-in-depth pattern (`agentTools.ts:1-10`): (1) JSON Schema scoped to Gemini's OpenAPI subset — type/description/properties/required/enum only, **length/pattern re-validated in the executor** (`agentTools.ts:101-103`); (2) executor re-validates args; (3) FK ownership pre-check via the caller's JWT (`assertBrandOwned` `agentTools.ts:48-62`, `assertEventOwned` `agentTools.ts:64-84`); (4) the actual DB write uses the **user JWT** — RLS is the final wall (I-ARI-USER-JWT-ONLY, `agentTools.ts:9-10`). `ToolError(code,message)` is the typed failure carrier (`agentTools.ts:86-91`).

Registry (`agentTools.ts:533-540`): `create_brand`, `create_event`, `create_experience`, `list_brands`, `list_events`, `update_event`. **There is NO `update_brand` and NO `delete_brand`.**

### System-prompt context injection (`supabase/functions/_shared/agentSystemPrompt.ts`)

- `buildSystemPrompt(profile, brandsList, options)` (`agentSystemPrompt.ts:27`). Brands are injected ONLY as `id : name` (`agentSystemPrompt.ts:43-45`, fed by `agent-chat/index.ts:197-203` which selects only `id, name`). **No currency, slug, description, cover, or address is in the prompt context.** Empty-state line: "the user has no brands yet — they may want to create one first" (`agentSystemPrompt.ts:45`).
- `CAPABILITIES` block lists only `create_brand / create_event / list_brands / list_events / update_event` (`agentSystemPrompt.ts:77-82`). 🔵 **Observation/discrepancy:** `create_experience` IS in the registry (so Gemini receives its tool schema at `index.ts:289`) but is NOT named in the prompt's CAPABILITIES list — a pre-existing prompt/registry drift, not in ORCH-1103 scope but worth noting for the SPEC author so a new `update_brand`/`delete_brand` are added to BOTH the registry and the prompt.
- `PROMPT_VERSION="v2"` (`agentSystemPrompt.ts:13`). Brand names are escaped (`<`/`>` stripped, 200-char cap, `agentSystemPrompt.ts:98-100`).

### Data model (`supabase/migrations/20260603000001_orch_0821_ari_agent_tables.sql`)

- `agent_conversations` (`:25-35`): `user_id`, optional `brand_id` (FK `ON DELETE SET NULL`), `title`, summary fields (Phase-2 unused). RLS owner-only on all 4 verbs (`:45-60`).
- `agent_messages` (`:66-77`): `role CHECK IN ('user','assistant','tool')`, `content jsonb`, `tool_calls jsonb`, `tool_results jsonb`, `prompt_version`, `model_version`. `user_id` denormalised for RLS. Owner-only RLS (`:90-105`).
- `agent_pending_actions` (`:111-124`): `tool_name`, `tool_args jsonb`, `status CHECK IN ('pending','executing','executed','cancelled','expired','failed')` default `pending`, `expires_at` default `now()+5min`, `executed_at`, `executed_result jsonb`, `failure_reason`. Owner-only RLS (`:134-149`). **Note:** the base migration has NO `source` / `related_brand_id` columns — those were added by a later META-ORCH-1009 migration (the confirm fn selects them at `agent-confirm-action/index.ts:99`). For a brand-delete tool the existing state machine is reusable as-is.
- `agent_user_profile` (`:155-169`): `display_name`, `preferred_timezone`, `preferred_currency char(3)`, `communication_style`, `autopilot_tools text[]`, spend caps (Phase-2), `ai_disclosure_acknowledged_at`. Owner-only RLS (`:176-191`).

### Client wiring

- `useAgentChat.ts` — `sendMessage` mutation + `pendingAction` state (`:33-35,70,105-127`); the confirm/cancel handlers call `agentChatService`.
- `agentChatService.ts` — typed wrappers `sendAgentMessage` (`:101`), `confirmAgentAction` (`:115`), `cancelAgentAction` (`:130`); also `fetchConversations/fetchMessages/fetchProfile/upsertProfile/acknowledgeDisclosure` (`:184-230`).
- `ToolProposalCard.tsx` — renders the proposal (humanized verb, identity, fields, Cancel/Edit/Confirm); `onConfirm(editedArgs?)` passes edits through (`:38-44,105-203`). Field render is hardcoded per tool (`fieldsFor` `:68-103`).
- `ToolEditForm.tsx` — inline edit; for `create_brand` it edits **only Name + Description** (`:30-48`); for `create_event`/`update_event` Title/When(ISO)/Where/Description (`:50-81`). 🟡 Hidden flaw for parity: currency, slug, and cover are NOT editable in the proposal card today.

---

## (b) `create_brand` — current shape vs the non-Ari wizard (the field gap)

### Ari `create_brand` (`agentTools.ts:97-155`)

Accepts: `name` (required, ≤80), `slug` (optional, auto-derived via `deriveSlug` `:31-37`), `description` (optional ≤500), `contact_email` (optional), `default_currency` (optional, **defaults to `"GBP"`** `:112,131`). Inserts directly into `brands` with `account_id=userId` (`:125-138`). On 23505 unique-violation → `SLUG_TAKEN` ToolError matching the manual flow's `SlugCollisionError` (`:139-152`). Returns `{brand:{id,name,slug,default_currency,created_at}}`.

**It handles NO cover media at all.** No `cover_media_url`, `cover_media_type`, `cover_hue`, address, lat/lng, city, country_code, tagline, links, or partner_setup. It also does NOT call any service/RPC — it's a raw `client.from("brands").insert(...)`.

### Non-Ari wizard `BrandCreationFlow.tsx` (the parity target)

`mingla-business/src/components/brand/BrandCreationFlow.tsx` — a 0–5 step flow (`:68`, steps gated by partner mode):
- **Step 0 (partner only):** mode self/client (`:507-576`).
- **Step 1 Identity:** `name` + `bio` (≤200) (`:578-626`). Calls `useCreateBrand` → `createBrand(input,"owner")` service with `{accountId, name, slug: slugify(name), address:null, coverHue:25, bio, partnerSetup}` (`:320-353`). Sets the new brand as `default_brand_id` (`:310-318`).
- **Step 2 Address (optional/skippable):** Mapbox autocomplete → persists `address, lat, lng, city, countryCode` (googlePlaceId forced null, ORCH-1079) via `useUpdateBrand` (`:355-402,628-674`).
- **Step 3 Cover (optional/skippable):** opens `CoverPickerSheet` with `target.kind="brand"` (`:676-712,869-916`) — full image/GIF/video/Pexels/GIPHY picker; cover persists live to `brands.cover_media_url`.
- **Step 4 Offering chooser** (self) OR **Step 5 Invite owner** (client) (`:714-797`).

Service `createBrand` (`brandsService.ts:263-311`) maps UI→insert via `mapUiToBrandInsert`, sets `partner_setup`, fires `mingla_brand_created` AppsFlyer event. The wizard does **NOT** collect `default_currency`, `contact_email`, or a hand-typed slug (slug is `slugify(name)` `:213-217`).

### The gap table (Ari create_brand vs wizard)

| Field | Ari `create_brand` | Wizard | Notes |
|---|---|---|---|
| name | ✅ required | ✅ Step 1 | parity |
| description/bio | ✅ `description` | ✅ `bio` Step 1 | parity (different arg name) |
| slug | ✅ (auto/optional) | ✅ auto from name | parity |
| default_currency | ✅ (defaults GBP) | ❌ not collected | Ari has it, wizard doesn't; GBP default conflicts w/ [[orch-1034 de-GBP]] direction |
| contact_email | ✅ optional | ❌ | Ari-only |
| **cover media (image/gif/video/pexels/giphy)** | ❌ **NONE** | ✅ Step 3 (full picker) | **THE gap ORCH-1103 fills (the "Add cover" button)** |
| address / lat / lng / city / country | ❌ | ✅ Step 2 (Mapbox) | wizard-only; not in ORCH-1103 brand-create scope unless SPEC adds |
| cover_hue | ❌ (DB default) | ✅ `25` | wizard sets a fallback hue |
| partner_setup | ❌ | ✅ Step 0/5 | wizard-only |

---

## (c) Brand EDIT — the exact path (no Ari tool exists)

- **Service:** `updateBrand(brandId, patch, existingDescription)` (`brandsService.ts:623-655`). Maps UI patch → column patch via `mapUiToBrandUpdatePatch`; empty patch is a no-op (returns existing). `UPDATE brands … WHERE id=? AND deleted_at IS NULL … RETURNING *` (`:640-647`). Editable fields = everything `mapUiToBrandUpdatePatch` understands (name/displayName, description=tagline+bio, address+geo, links, contact, cover_media_url/type, etc.).
- **Hook:** `useUpdateBrand` (`useBrands.ts:356-408`) — OPTIMISTIC; patches `brandKeys.detail(brandId)` + `brandKeys.list(accountId)`, invalidates `publicEventKeys.brandBySlug(slug)`; rolls back on error.
- **Ownership/RLS:** the write runs through the user-scoped client; RLS "Account owner can select/update own brands" gates it. `updateBrand` defensively filters `deleted_at IS NULL`.
- **What a new Ari `update_brand` tool would call:** mirror `create_event`'s pattern — `assertBrandOwned(client, brand_id, userId)` (`agentTools.ts:48-62`) then a scoped `client.from("brands").update(patch).eq("id", brand_id).is("deleted_at", null).select(...)`. It must accept a `brand_id` + a sparse patch (name/description/currency/contact_email/cover_media_url+type) and only set provided keys (mirror `updateEvent` `agentTools.ts:325-336`). Note the brand EDIT *service* used by the app (`updateBrand`) is a client service, not an edge fn or RPC, so the Ari tool would replicate the same column write directly under the JWT (it cannot import the RN service into Deno).

---

## (d) Brand DELETE — THE customer-protection process (highest priority; Ari MUST route through this with zero bypass)

There is **no hard delete of brands anywhere in product code** (grep for `DELETE FROM brands` / `.from("brands").delete()` returns only a test fixture). The single customer-facing path is a **soft delete** with a 4-step protective flow:

### Entry point — `BrandDeleteSheet.tsx` (`mingla-business/src/components/brand/BrandDeleteSheet.tsx`)
4-step state machine `warn → preview → confirm → submitting (→ rejected)` (`:64,79-429`):
1. **Warn** (`:181-227`): "Recoverable for 30 days" + "data preserved (events, orders, refunds, audit logs)" + "One-way action in-app" copy.
2. **Preview** (`:229-332`): cascade counts via `useBrandCascadePreview` — past events, **live events** (danger), upcoming events (danger), team members, Stripe Connect ("Linked (will unlink)"). If upcoming or live > 0 it shows "Active events block delete — cancel or transfer first."
3. **Confirm** (`:334-384`): **type-to-confirm** — the typed string must case-insensitively equal `brand.displayName` (`canConfirm` `:110-116`); Delete disabled until it matches.
4. **Submitting** (`:386-393`) → calls `useSoftDeleteBrand().mutateAsync({brandId, accountId})` (`:135-168`).
5. **Rejected** (`:395-425`): if the service returns `{rejected:true}` it renders an in-sheet block telling the user to cancel/transfer N upcoming events first.

### Hook — `useSoftDeleteBrand` (`useBrands.ts:422-475`)
PESSIMISTIC (no optimistic remove — avoids show-then-restore on rejection). On success it synchronously evicts the brand from the list cache, clears a stale `default_brand_id` in the creator-account cache, invalidates the list, removes detail/role/cascade-preview caches (`:429-466`) — this is the ORCH-1062 render-loop-crash fix for deleting the currently-selected brand.

### Cascade preview — `useBrandCascadePreview` (`useBrands.ts:497-580`)
5 parallel queries: past events (`status IN ('ended','cancelled')`, `event_type='event'`), upcoming (`status='scheduled' … event_dates.end_at > now`), live (`status='live' … end_at > now`), team members (`brand_team_members … removed_at IS NULL`), and Stripe via `pg_derive_brand_stripe_status` RPC (`hasStripeConnect` true only for `active`/`onboarding`).

### Service — `softDeleteBrand(brandId)` (`brandsService.ts:673-753`)
The **authoritative customer-protection guard**, 3 steps:
1. **Blocking-events count** (`:688-707`): counts `events` with `status IN ('scheduled','live')` (`BRAND_DELETE_BLOCKING_EVENT_STATUSES` `:248`) joined `event_dates!inner` with `end_at > now`. If `count > 0` → returns `{rejected:true, reason:"upcoming_events", upcomingEventCount}` (a workflow rejection, NOT thrown). **This is the core protection: a brand with active/upcoming dated events cannot be deleted.** Note it is intentionally type-agnostic (also blocks on scheduled trips/experiences; `orch-strict-grep-allow events-type-filter` comment at `:689`).
2. **Soft-delete** (`:709-731`): `UPDATE brands SET deleted_at = now() WHERE id=? AND deleted_at IS NULL RETURNING id`. Rowcount-verified (throws if 0 rows — RLS denial / already-deleted / wrong id). Idempotent.
3. **Clear `default_brand_id`** (`:733-750`): `UPDATE creator_accounts SET default_brand_id=NULL WHERE default_brand_id=brandId` — non-fatal fire-and-forget (I-PROPOSED-B / R-3).

### Side effects, retention, recovery
- **Soft-delete only** (`deleted_at` stamp). Brand's events/orders/tickets/refunds/audit-logs are **preserved** (warn copy `:189-193`; preview footer `:303-307`). Events are NOT cascaded/deleted — they remain rows with a soft-deleted parent (existing data hygiene relies on `deleted_at IS NULL` filters across reads).
- **Recovery window: 30 days, support-only** ("Recovery within 30 days requires support intervention", `:191-193`); no in-app undo.
- **Stripe Connect:** preview says "Linked (will unlink)" — actual unlink behavior is whatever downstream consumers do on a soft-deleted brand; no refund/payout side-effect is triggered by `softDeleteBrand` itself (it only stamps `deleted_at` + clears the default pointer). No buyer notification is sent by this path.
- **No refund/payout logic in the delete path** — protection is *prevention* (you can't delete while live/upcoming dated events exist), not refund-on-delete.

### RLS / role gating + invariants
- Writes run under the caller JWT; `brands` RLS "Account owner can select/update own brands" gates the soft-delete; reads filter `deleted_at IS NULL` everywhere (`feedback_supabase_neq_null` — use `.is("deleted_at", null)`, never `.neq()`).
- **Strict-grep / invariant context:** the `deleted_at IS NULL` discipline pervades the registry (e.g. I-PROPOSED-AZ EVENT_HAS_MANAGER_SCANNER guards `events`/`brands` with `deleted_at IS NULL`; `INVARIANT_REGISTRY.md:805`). `brand_covers` storage bucket policy (`INVARIANT_REGISTRY.md:719`) gates write/delete on `biz_brand_effective_rank_for_caller(...) >= brand_admin`.
- **Separate ADMIN path (NOT the owner path):** `supabase/migrations/20260909000000_orch_1073_admin_suspend_delete_listing.sql` adds `admin_suspend_listing` (suspend/soft_delete/restore) operating on `place_pool.deleted_at` + `brands.claim_status IN ('suspended','revoked')`. This is an **admin-only listing-moderation** lifecycle — do NOT confuse it with the brand-owner delete. Ari must use the `softDeleteBrand` equivalent, not the admin RPC.

**SPEC implication for Ari delete (zero-bypass):** Ari's `delete_brand` tool MUST replicate `softDeleteBrand`'s exact guard order under the user JWT — (1) run the same blocking-events count and refuse (return a recoverable `ToolError`/rejection, surfaced as a clarifying refusal) when active/upcoming dated events exist; (2) only then stamp `deleted_at` with rowcount verification; (3) clear `default_brand_id`. The Ari confirmation card already enforces an explicit user CONFIRM step (parity with type-to-confirm). It must NOT expose any hard-delete and must NOT skip the blocking-events count.

---

## (e) In-chat MEDIA infra + git/ownership status (cross-ORCH flag)

### The decided UX vs reality
The dispatch's premise references `mingla-business/src/components/brand/BrandCoverPickerSheet.tsx` (header cites ORCH-0805) as the picker to open from Ari's "Add cover" button. **That file is a stale orphan** — see git status below. The REAL, shipped, tracked unified picker is:
- `mingla-business/src/components/ui/CoverPickerSheet.tsx` (host Sheet) + `mingla-business/src/components/ui/CoverPicker.tsx` (the gallery body) + `coverTarget.ts` (the `CoverTarget` discriminated union).

### Capabilities (`CoverPicker.tsx`)
Three tabs (`TAB_DEFS` `:152-156`): **Library** (device image/GIF + **video**), **GIFs** (GIPHY trending+search), **Photos** (Pexels curated+search). Gallery-first (no typing required). It is **target-aware** via `CoverTarget` (`coverTarget.ts`):
- `kind:"brand"` → `{brandId, accountId, existingDescription}`. Device image/GIF + provider (Pexels/GIPHY) persist via `useBrandCoverUpload.uploadCover` (`CoverPicker.tsx:400-432,685-762`). **Video** persists via `useEventCoverVideoUpload("", brandId, "published_manual", "brand")` which writes `brands.cover_media_url` on ready (`CoverPicker.tsx:202-210,305-324`). So **brand covers DO support video** through the unified picker (the ORCH-0989 + ORCH-0978 path), even though the standalone `useBrandCoverUpload` hook only handles image/gif.
- `kind:"event"|"trip"|"experience"` → events-table `cover_media_*` via `uploadEventCoverMedia` + event-scoped video pipeline.
- Emits a **7-field `CoverPatch`** (`coverMediaUrl, coverMediaType, coverMediaProvider, coverMediaSourceUrl, coverMediaCredit, coverMediaCreditUrl, coverMediaAlt`) on every change (`CoverPicker.tsx:122-130`). `CoverPickerSheet` adds a bottom "Use this cover" confirm button.

### `useBrandCoverUpload` (`mingla-business/src/hooks/useBrandCoverUpload.ts`) — ORCH-0805, TRACKED
Source = device upload (`uploadBrandCover`) OR provider URL (`coverFromProviderRef`); writes `brands.cover_media_url`/`cover_media_type` via `useUpdateBrand`. **Maps mediaType to only `"image"` or `"gif"` (`:107`) — it does NOT handle video** (video for brand goes through `useEventCoverVideoUpload` inside CoverPicker, not this hook).

### Storage bucket + persistence
- Device-upload bucket: `brand_covers` (`brandCoverService.ts:37` `BRAND_COVERS_BUCKET`), path `{brandId}/{token}.{ext}` (`:105-109`), previous file removed after new upload verifies. Bucket policy (INVARIANT_REGISTRY.md:719): public read; brand-admin write/update/delete; 15MB; mime allowlist image/jpeg,png,webp,gif (**no video mime** — video covers go to the event/Cloudinary pipeline, surfaced via the processed URL on `brands.cover_media_url`).
- Persisted on the brand: `brands.cover_media_url` + `brands.cover_media_type` (image/gif/video). Provider attribution fields ride in the 7-field patch for events but the brand path persists only url+type (`useBrandCoverUpload.ts:101-109`).
- Providers: GIPHY is client-direct (ToS — proxying forbidden); Pexels is edge-proxied (`CoverPicker.tsx:21-25` LOCKED note). Services: `giphyEventCoverService`, `pexelsEventCoverService`, `coverProviderBrowseService` (`CoverPicker.tsx:86-97`). (There is no separate `giphyBrandCoverService`/`pexelsBrandCoverService` — brand reuses the event-cover provider services.)
- `EventCoverMedia` (`components/ui/EventCoverMedia`) is the shared renderer (image/gif/video, muted, audio control) and IS reusable for any Ari ResponseCard/preview that needs to render a brand cover. The ORCH-0978 video trim→upload→persist path is reused for brand via the `"brand"` target — relevant + reusable.

### GIT STATUS — the cross-ORCH coordination flag
- `mingla-business/src/components/brand/BrandCoverPickerSheet.tsx`: **UNTRACKED in the anchor** (`?? …BrandCoverPickerSheet.tsx`), and it does **NOT exist in this worktree at all** (not on this branch, not on `origin/main`, not in any branch history). It is a dead orphan from the ORCH-0805 era left in the anchor working tree.
- The actual shipped picker `mingla-business/src/components/ui/CoverPickerSheet.tsx` IS on `origin/main` (`git ls-tree origin/main` confirms) and was shipped by **ORCH-0989** ("[deploy] Close ORCH-0989: unified cover picker sheet (events/trips/brand) + brand/trip video", commit `f09494612`). ORCH-0989's close comment states it "Retires BrandCoverPickerSheet" (`CoverPickerSheet.tsx:7`).
- **Coordination conclusion:** there is NO in-flight parallel WIP owning the picker — ORCH-0989 already shipped the unification and superseded BrandCoverPickerSheet. The orphan in the anchor is leftover cruft (a `git status` artifact), not active WIP. **ORCH-1103 should open the existing `CoverPickerSheet` with `target.kind="brand"`, NOT BrandCoverPickerSheet.** Orchestrator action: a COMMS/cleanup note that the anchor's untracked `BrandCoverPickerSheet.tsx` is a dead orphan safe to delete; no other session owns it.

---

## (f) "Create an event without a brand" — current behavior

### (a) Business-app event-create flow (`mingla-business/app/event/create.tsx`)
The route resolves `currentBrandId` via `useCurrentBrandId` + `useCurrentBrandRecovery` (`:77-79`). When auth is ready, brand recovery is done, hydration is done, and `currentBrandId === null`, the route enters the `"no_brand"` terminal state (`:153-160`). It renders a **dead-end card** (`:204-242`): title "Create or select a brand before starting an event.", body "Use desktop or the Mingla Business app if brand setup is not available on this phone browser." (`terminalCopy.no_brand` `:296-300`), with a primary "Try again" button (re-runs the same route — does NOT open brand creation) and "Back to Home". **There is no in-flow handoff to brand creation** — the user is told to make a brand but given no path from here. (When a brand DOES exist, it mints a `d_<ts36>` draft and `router.replace`s to `/event/{id}/edit?step=0`.)

### (b) Ari `create_event` tool (`agentTools.ts:161-231`)
`create_event` **requires `brand_id` (UUID)** (`required:["brand_id","title","start_at"]` `:167`; `isUuid` guard `:181-183`) and runs `assertBrandOwned` (`:198`). A user with zero brands cannot satisfy this: Gemini sees the empty-brands prompt line ("they may want to create one first", `agentSystemPrompt.ts:45`) and would either ask or propose `create_brand` first, but there is **no built-in recognize→guide→handback chain** — if the model proposed `create_event` with a fabricated/empty `brand_id` it would fail `INVALID_ARGS`/`OWNERSHIP_DENIED` at confirm.

### The gap ORCH-1103 fills (handoff point only)
The no-brand state is a dead-end in BOTH surfaces. ORCH-1103's brand-create capability gives Ari the missing first step: recognize "no brand" → guide/propose `create_brand` (with the new cover button) → on success the user has a brand. **The actual event-creation chaining after brand creation is the deliberate follow-on ORCH and is OUT of ORCH-1103 scope** — this report documents only the handoff *point*: a freshly-created brand becomes `currentBrand`/`default_brand_id` (the wizard does this at `BrandCreationFlow.tsx:310-318`; Ari's `create_brand` does NOT currently set `default_brand_id` — a parity note for the SPEC).

---

## (g) ORCH-1101 presentational components — prop contracts (shipped wired-to-nothing)

Confirmed via grep: `ClarifyingCard`, `MultiSelectPrompt`, `ResponseCard`, and `QuickReplyChips` CHOICE-mode have **zero production imports outside `/components/ari/` and `__tests__`**. `AriChatScreen.tsx` imports only `QuickReplyChips` and uses it in LEGACY mode (`:42,253`). They are finished visuals awaiting wiring.

### `ClarifyingCard` (`components/ari/ClarifyingCard.tsx:36-47`)
Props: `eyebrow?` (default "ARI NEEDS A DETAIL"), `question`, `value` (controlled), `state: "default"|"typed"|"loading"|"disabled"|"submitted"`, `onChange?`, `onSubmit?`, `onSkip?`. Single free-text field + Skip/Send. `submitted` collapses to an "Answered: <value>" ribbon. **Use for ORCH-1103:** a typed clarifying question ("What should the brand be called?", "Pick a currency" if free-text).

### `MultiSelectPrompt` (`components/ari/MultiSelectPrompt.tsx:27-45`)
Props: `title`, `options: {id,label}[]`, `selectedIds: string[]`, `state: "default"|"loading"|"disabled"|"submitted"`, `onToggle?`, `onConfirm?`. Checkbox rows + sticky Confirm (≥1 required). `submitted` → "<n> selected: A, B, C" ribbon. **Use for ORCH-1103:** multi-pick (less likely for brand CRUD; more for intents).

### `ResponseCard` (`components/ari/ResponseCard.tsx:39-72`)
Props: `eyebrow?`, `title`, `rows: {label,value}[]`, `thumbnail?` (REAL photo URI ONLY — anti-slop; omit if none), `actions?: {id,label,primary?}[]`, `state: "default"|"loading"|"disabled"|"submitted"|"error"`, `showOrb?`, `onAction?`, `onRetry?`. Renders a glass data card with the Ari orb. **Use for ORCH-1103:** the created-brand receipt ("Created <brand>", rows = currency/slug, `thumbnail` = the chosen cover URL, actions = "Add event"/"Edit"); also the choice-target picker confirmation.

### `QuickReplyChips` CHOICE mode (`components/ari/QuickReplyChips.tsx:33-51`)
CHOICE props: `options: {id,label}[]`, `selectedId?`, `state: "default"|"loading"|"submitted"`, `onSelectId?`, `disabled?`. Single-select chip row; selected chip gets the ember `userBubble` fill + Check; `submitted` collapses to only the chosen chip. LEGACY mode (`chips: string[]` + `onSelect`) is unchanged and still used by AriChatScreen. **Use for ORCH-1103:** "which brand?" target selection for edit/delete, and edit/delete intent chips.

---

## Five-Layer Cross-Check (brand CRUD domain)

| Layer | Finding |
|---|---|
| Docs | ORCH-0821 SPEC/impl established the Ari spine + 5 tools (no update/delete brand). ORCH-0989 unified the cover picker (retires BrandCoverPickerSheet). ORCH-1101 shipped the 4 presentational cards unwired. |
| Schema | `brands` soft-delete via `deleted_at`; `agent_pending_actions` state machine (pending→executing→executed/failed/cancelled/expired); `brand_covers` bucket (image-only mime, video via Cloudinary). |
| Code | Ari `create_brand` = raw insert, no cover, GBP default; no `update_brand`/`delete_brand`. Owner delete = `softDeleteBrand` (blocking-events guard + soft delete + clear default). Event-create no-brand = dead-end terminal card. |
| Runtime | WRITE tools → pending_action → user confirm → `agent-confirm-action` atomic execute under JWT. Cover picker persists live to `brands.cover_media_url`. |
| Data | No hard-delete of brands in product code; everything filters `deleted_at IS NULL`. |

No layer contradictions for the documented current state.

---

## Blast Radius Map (for the eventual SPEC)

- A new `update_brand`/`delete_brand` Ari tool touches: `agentTools.ts` (registry + executor + prompt CAPABILITIES list in `agentSystemPrompt.ts`), `agent-confirm-action` (already generic — picks up new tools via `findTool`), `ToolProposalCard.fieldsFor`/`humanizeToolName`/`primaryIdentity` + `ToolEditForm` (per-tool render is hardcoded — must add brand-edit/delete cases), and `buildFollowupText`.
- Cover-from-Ari touches: `CoverPickerSheet`/`CoverPicker` (already brand-capable via `target.kind="brand"`), `useBrandCoverUpload`/`useEventCoverVideoUpload`, and the proposal-card UI (the "Add cover" button + how a chosen `cover_media_url` is threaded into the `create_brand` args before confirm).
- Delete-from-Ari MUST reuse `softDeleteBrand`'s guard semantics; any divergence risks I-PROPOSED-B (`default_brand_id` cleanup), the ORCH-1062 render-loop fix, and the customer-protection blocking-events rule.
- System-prompt brand context is currently `id : name` only — for edit/delete target disambiguation the SPEC may need richer brand context (currency/cover presence) injected.

---

## Discoveries for Orchestrator

1. 🔵 **BrandCoverPickerSheet is a dead orphan** in the anchor working tree (untracked, on no branch); ORCH-0989 already retired it with the unified `CoverPickerSheet`. Safe to delete; no parallel session owns it. ORCH-1103 must target `CoverPickerSheet` (`target.kind="brand"`), not BrandCoverPickerSheet. Consider a COMMS/cleanup note.
2. 🟡 **Prompt/registry drift:** `create_experience` is in the tool registry but missing from the system-prompt CAPABILITIES list (`agentSystemPrompt.ts:77-82`). New brand tools must be added to BOTH or Gemini won't reliably use them.
3. 🟡 **GBP default in Ari `create_brand`** (`agentTools.ts:112,131`) conflicts with the de-GBP direction ([[orch-1034 de-GBP]]); the wizard doesn't collect currency at all. SPEC should reconcile.
4. 🟡 **Event-create no-brand is a dead-end** on both surfaces (`app/event/create.tsx` `no_brand` card has no "create a brand" CTA; Ari `create_event` hard-requires a brand UUID). ORCH-1103 only owns the brand-creation handoff point; the chaining is a follow-on ORCH.
5. 🔵 **Ari `create_brand` does not set `default_brand_id`** (the wizard does); a brand created by Ari won't auto-become the current brand — parity gap for the SPEC.

---

## Confidence

**High.** Every pertinent file read in full (agent-chat, agent-confirm-action, agentTools, agentSystemPrompt, agentGemini surface, the 4 ORCH-1101 cards, ToolProposalCard/ToolEditForm, useAgentChat/agentChatService, brandsService, useBrands, BrandDeleteSheet, BrandCreationFlow, CoverPicker/CoverPickerSheet/coverTarget, useBrandCoverUpload, event/create route, the Ari tables migration). Git status of the cover picker verified across worktree filesystem + `origin/main` + branch history + anchor. Backend/architecture-mapping investigation — no described UI runtime bug to live-fire (Prime-Directive-7 backend/code-audit exemption applies).
