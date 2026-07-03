# SPEC — META-ORCH-1281 [marketing SMS wave 2]

**Worktree:** `~/Desktop/mingla-orchs/1281-[marketing-sms-wave2]/` on branch `1281-marketing-sms-wave2` (rebased on origin/main; ORCH-1270 SMS quiet-hours defer already present).
**Cluster:** three related composer features, ONE eventual PR — ORCH-1281 (SMS preview), ORCH-1282 (SMS photo/MMS), ORCH-1283 (remove RCS tab).
**Author phase:** SPEC (mingla-forensics). No product code written here; this is the binding contract.
**Comms:** COMMS ledger read on entry. No OPEN BLOCK targets this ORCH. Relevant WARN acknowledged: **COMMS-0063** — business-app OTA (`eas update`) empirically BRICKS launch → every change in this cluster ships to users via a **native business build**, never OTA. Factored into Downstream Routing.

---

## 1. Layman summary

Three fixes to the business "text/email your customers" composer:

1. **SMS blast preview is wrong today.** When you pick the SMS channel and hit Preview (or look at the desktop preview panel, or the "Ready to send?" review card), it shows an *email* mock-up — brand banner, subject line, "Unsubscribe" footer — none of which is what a text looks like. This builds a real **phone-text-bubble preview** that shows your actual SMS wording, the "Reply STOP to opt out." line we add, and a live character/segment count.

2. **You can't attach a photo to a text.** This adds a "Add photo" button to the SMS composer. The photo is uploaded to Mingla's public image store, and the text goes out as an **MMS** (picture message) to US numbers. The cost box updates because picture messages cost more. Nigerian numbers can't receive MMS through our provider, so they get the words only — the composer says so plainly.

3. **The "RCS" tab is dead weight.** There's a greyed-out "RCS" tab that does nothing and a CI rule that forces it to stay. This removes the tab and rewrites the CI rule so the build stays green.

Non-negotiable: **email behavior is untouched** except that the preview now branches by channel, and the **ORCH-1270 quiet-hours/anti-double-send machinery is left exactly as-is.**

---

## 2. Scope, affected surfaces, non-goals

### In scope
- SMS-channel preview across all three preview surfaces in the composer.
- SMS single-photo → MMS attach, upload, payload, send-path (Twilio US), and cost estimate.
- Removal of the RCS composer tab + the CI gate assertions that require the `rcs` literal.

### Affected surfaces (Cross-Surface Impact Declaration)

| # | Surface | Covered? | User-visible behavior | Files touched here | Parity |
|---|---------|----------|-----------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NO | — | none | Not a consumer feature |
| 2 | Consumer Android | NO | — | none | Not a consumer feature |
| 3 | Buyer/anon Web (`mingla-business` public routes) | NO | — | none | Composer is authed-only |
| 4 | Business iOS | YES | SMS preview + MMS attach + no RCS tab | shared RN (see allowlist) | Automatic (shared code) |
| 5 | Business Android | YES | same | shared RN | Automatic (shared code); glass = opaque fallback policy already global |
| 6 | Admin Web | NO | — | none | No marketing composer in admin |
| 7 | Business Web preview (adjacent) | YES (capped) | same, but authed composer runtime is unreachable in QA → claims capped at "suspected" for web (`feedback_biz_web_authed_runtime_unreachable_cap_claims.md`) | shared RN + web picker path | Manual (web picker path differs) |
| — | Backend `marketing-send` + `smsAdapter` (1282 only) | YES | Twilio `MediaUrl` on MMS; NG drops media | `supabase/functions/**` | N/A (single backend) |
| — | CI gate (1283 only) | YES | gate no longer requires `rcs` | `.github/scripts/strict-grep/**` | N/A |

### Non-goals (explicitly OUT)
- No change to email compose/preview/send behavior beyond the channel-branch at the three preview sites.
- No change to the ORCH-1270 defer state machine, `mkt_finalize_campaign`, the idempotency/double-send guards (`shouldSkipDispatchedRecipient`, provider-id gate), or the SMS timing info-note.
- No multi-image MMS (v1 = exactly ONE photo; payload shape is an array for forward-compat).
- No video/GIF-animation MMS (still images only; GIF allowed as a still).
- No RCS re-enable, no new RCS infrastructure.
- No DB migration (see §7 — payload is JSON; the DB CHECK only inspects `kind`).
- No change to the `MarketingChannel` *channel-column* string union or the unsubscribe/consent `'all'→email+sms+rcs` resolver (see §6.3 decision — leaving `rcs` in the channel-column type is intentional).
- No consumer/admin/buyer-web work.

---

## 3. ORCH-1281 — SMS blast preview (phone-bubble mock)

### 3.1 Current behavior (proven)
`mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` renders `EmailPreviewPane` **unconditionally** at BOTH preview sites, always passing the EMAIL `subject`/`body`:
- Wide-desktop right rail: lines **826–841** (`preview={ isWideDesktop ? <EmailPreviewPane .../> : undefined }`).
- "Inbox preview" modal: lines **892–929** (`<EmailPreviewPane .../>` inside the pageSheet modal, header title literal `"Inbox preview"`).

The SMS body lives in separate state `smsBody` (line 155) and is NEVER previewed. `ComposerReviewSheet` (line 855–869) always renders a hard-coded **SUBJECT** section (`ComposerReviewSheet.tsx` lines 83–88) — for an SMS blast this shows "(no subject)", which is meaningless.

### 3.2 Required behavior
When `channel === 'sms'`, all three surfaces render an **SMS preview**, not the email pane. `channel === 'email'` is unchanged (still `EmailPreviewPane`).

### 3.3 New component — `SmsPreviewPane`
**Create:** `mingla-business/src/components/marketing/SmsPreviewPane.tsx`

**Props (exact):**
```ts
export interface SmsPreviewPaneProps {
  body: string;            // raw smsBody as typed (no footer)
  brandName: string | null;
  reachableSms: number | null;   // for the count line; may be null
  currencyCode: string;          // brand default currency for cost line
  hasMedia?: boolean;            // 1282 — draw the MMS image tile + MMS label
  mediaUri?: string | null;      // 1282 — local/remote uri for the thumbnail
}
```

**Behavior + layout (design — build exactly):**
- Reuse tokens from `../../constants/designSystem` (`accent, glass, radius, spacing, text as textTokens, typography`). Reuse `estimateSmsCost` + `bodyWithFooter` from `../../utils/smsCost` (do NOT recompute segmentation locally — single source of truth).
- Root: a `ScrollView` (`host`), dark "phone screen" canvas: `backgroundColor: "#0B0D12"`, `flex: 1`, content padded `spacing.md`, `gap: spacing.sm`, `showsVerticalScrollIndicator={false}`, `keyboardShouldPersistTaps="handled"`.
- **Sender header row** (top): a small circular avatar placeholder (36×36, `borderRadius: 18`, `backgroundColor: glass.tint.profileBase`, centered first-letter of `brandName` in `typography.bodySm` weight 700) + a two-line label:
  - Line 1: `brandName ?? "Your brand"` — `typography.bodySm`, `color: textTokens.primary`, weight 700, `numberOfLines={1}`.
  - Line 2: caption `"Text message · SMS"` (or `"Picture message · MMS"` when `hasMedia`) — `typography.labelCap`, `color: textTokens.tertiary`.
  - This is honest: the recipient sees the brand identity in the body; we do NOT fabricate a verified-sender number. Do NOT hardcode the toll-free number (it is infra and region-dependent).
- **Received bubble** (left-aligned, the buyer's inbound view):
  - Container: `alignSelf: "flex-start"`, `maxWidth: "84%"`, `backgroundColor: "#26282E"` (neutral iOS-received grey on dark), `borderRadius: 20`, `borderBottomLeftRadius: 6` (tail corner), `paddingHorizontal: 14`, `paddingVertical: 10`, `gap: 8`.
  - **When `hasMedia && mediaUri`:** an `Image` tile at the top of the bubble — `width: "100%"`, `aspectRatio: 4/3`, `maxHeight: 220`, `borderRadius: 12`, `resizeMode: "cover"`, `backgroundColor: "#1A1C22"`. Below it, the text.
  - **Text:** render `bodyWithFooter(body)` (so the previewed text includes the auto-appended "Reply STOP to opt out." exactly as sent), `typography.body`, `color: "#F2F3F5"`, `lineHeight: 21`. Links (any `https?://…` substring) render inline in `accent.warm` with `textDecorationLine: "underline"` (split the string on the URL regex and wrap matched spans). Below the bubble, a muted caption: `"Links become trackable Mingla links."` — `typography.labelCap`, `color: textTokens.tertiary`.
  - **Empty state** (`body.trim().length === 0` AND no media): render a placeholder bubble with italic text `"Start typing your text to preview it."` (`color: textTokens.tertiary`, `fontStyle: "italic"`) and SKIP the count line.
- **Count line** (below the bubble, only when `body.trim().length > 0` OR `hasMedia`): compute `const est = estimateSmsCost(body, reachableSms ?? 0, undefined, hasMedia)` (see §4.4 for the extended signature). Render `${est.encoding} · ${est.charCount} chars · ${est.segmentsPerRecipient} ${plural}`. For MMS `est.encoding === "MMS"` and `segmentsPerRecipient === 1` → renders "MMS · N chars · 1 message". `typography.bodySm`, `color: textTokens.secondary`, centered.
- **Footer note** (always, bottom): italic `"Preview only — carriers render texts slightly differently. The send loop is the source of truth."` — mirrors `EmailPreviewPane`'s honesty note. `typography.bodySm`, `color: textTokens.tertiary`, centered.
- **Accessibility (I-39):** the bubble `Text` gets `accessibilityLabel` = the full wire body; the image tile gets `accessibilityLabel="Attached photo preview"`. No interactive elements (preview is read-only).

### 3.4 Branch points (exact edits in `compose.tsx`)
- **Import:** add `import { SmsPreviewPane } from "../../../../src/components/marketing/SmsPreviewPane";` alongside the existing marketing imports (after the `EmailPreviewPane` import, line 63).
- **Wide-desktop rail** (lines 826–841): wrap the `preview={…}` expression so that when `isWideDesktop`, it renders `channel === "sms" ? <SmsPreviewPane body={smsBody} brandName={brandName} reachableSms={reach?.reachable_sms ?? null} currencyCode={currentBrand?.defaultCurrency ?? "USD"} hasMedia={mmsMediaUrls.length > 0} mediaUri={mmsLocalUri} /> : <EmailPreviewPane .../>` (existing email props unchanged). `mmsMediaUrls` / `mmsLocalUri` are the 1282 state (§4.3); if 1281 lands before 1282 in the same PR, gate on the state that exists — but since this is ONE PR, both exist.
- **Inbox-preview modal** (lines 892–929): keep the `<Modal>`, keep the header `<Pressable>`/Done. Make the title dynamic: `channel === "sms" ? "Message preview" : "Inbox preview"`. Inside the modal body, render `channel === "sms" ? <SmsPreviewPane .../> : <EmailPreviewPane .../>`. The modal's light `previewModal` background (`#F5F5F7`) is fine as the outer chrome; `SmsPreviewPane` brings its own dark phone-canvas.

### 3.5 Review sheet (`ComposerReviewSheet.tsx`) branch
The review sheet currently always shows a SUBJECT row (lines 83–88). Add channel-awareness WITHOUT breaking the ORCH-1270 info-note contract:
- **New props (additive, optional):** `channelKind?: "email" | "sms"` and `messagePreview?: string` (the SMS wire body first ~140 chars) and `hasMedia?: boolean`.
- When `channelKind === "sms"`: replace the SUBJECT section with a **MESSAGE** section — label `"MESSAGE"`, value = `messagePreview` (`numberOfLines={4}`), and when `hasMedia` a small caption line `"+ 1 photo (MMS)"`. When `channelKind !== "sms"` (or undefined), render the existing SUBJECT section verbatim (email unchanged).
- `compose.tsx` passes `channelKind={channel === "sms" ? "sms" : "email"}`, `messagePreview={bodyWithFooter(smsBody).slice(0, 160)}`, `hasMedia={mmsMediaUrls.length > 0}`. The existing `subject`, `smsInfoNote`, `nextWindowLabel`, `onScheduleForNextWindow` props stay wired exactly as today (do not touch the ORCH-1270 note logic at lines 62–116 of the sheet).

---

## 4. ORCH-1282 — SMS photo / MMS attachment (end-to-end)

### 4.1 Current behavior (proven)
No attach affordance exists in `SmsComposeCard.tsx`. `buildPayload` (`compose.tsx` line 305–316) emits `{ kind: "sms", body: smsBody }`. `sendSms` (`marketing-send/index.ts` line 802–1051) reads only `channel_payload.body`. `twilioSend` (`smsAdapter.ts` line 123–172) posts only `To`, `MessagingServiceSid`, `Body`, `StatusCallback` — **no `MediaUrl`**. Toll-free `+18882505351` in messaging service `MG1942…` is MMS-capable (confirmed via Twilio API by the dispatcher).

### 4.2 MMS storage decision (with evidence) — reuse the public `brand_covers` bucket

**Chosen path:** upload the picked image to the existing **public** Supabase Storage bucket `brand_covers`, under a new key prefix `${brandId}/marketing-mms/${token}.${ext}`, and use the `getPublicUrl` result as the Twilio `MediaUrl`.

**Evidence it is publicly fetchable (Twilio fetches server-side):**
- `supabase/migrations/20260529000000_orch_0805_brand_covers_storage.sql` lines 82–85 create policy `brand_covers_public_read` `FOR SELECT USING (bucket_id = 'brand_covers')` — **anonymous public read on every object**. Brand cover images from this bucket are already fetched server-side by Resend/email clients (`brandHeaderImageUrl` in `sendEmail`), proving the public URL is reachable by third-party fetchers.
- The proven upload mechanic is `experienceStopImageService.uploadExperienceStopImage` (`mingla-business/src/services/experienceStopImageService.ts`): size-guard → `readBrandCoverFileBytes` → `supabase.storage.from('brand_covers').upload(path, bytes, {contentType, upsert:true})` → `getPublicUrl(path)` → `verifyBrandCoverPublicUrl(url)` (HEAD/GET reachability check). `verifyBrandCoverPublicUrl` is exactly the guarantee MMS needs.
- Bucket write RLS is keyed on `split_part(name,'/',1) = brandId`, so the `${brandId}/marketing-mms/…` prefix inherits the brand-admin write gate for free.

**Why not Cloudinary:** Cloudinary in `mingla-business` is video-only (`eventCoverVideoProcessingService.ts`); no image upload path exists there. Reusing `brand_covers` reuses proven, already-public infra and needs **no new bucket, no new policy, no migration**.

**New service:** `mingla-business/src/services/marketingMmsImageService.ts` — `export const uploadMarketingMmsImage = async (brandId: string, input: BrandCoverAssetInput): Promise<string>` — a thin mirror of `uploadExperienceStopImage` with:
- Prefix `${brandId}/marketing-mms/${token}.${ext}`.
- **MMS-specific limits (stricter than covers, carrier-honest):** accept only `image/jpeg`, `image/png`, `image/gif`; cap **5 MB** (`const MMS_MAX_BYTES = 5 * 1024 * 1024` — Twilio reliably fetches ≤5 MB; `webp` is dropped because carrier/handset MMS support is inconsistent). Reject others with `BrandCoverError("unsupported_type", "Add a JPEG, PNG, or GIF under 5 MB.")` / `("file_too_large", "That photo is too large — pick one under 5 MB.")`.
- Reuse `resolveBrandCoverContentType`, `generateBrandCoverPathToken`, `readBrandCoverFileBytes`, `verifyBrandCoverPublicUrl` from the existing `brandCoverRules`/`brandCoverFileReader` modules. Return the verified public URL.

### 4.3 Composer UI (`SmsComposeCard.tsx` + `compose.tsx`)

**State in `compose.tsx`:** add `const [mmsMediaUrls, setMmsMediaUrls] = useState<string[]>([]);` (the verified public URLs — persisted into the payload) and `const [mmsLocalUri, setMmsLocalUri] = useState<string | null>(null);` (the local preview uri for the thumbnail) and `const [mmsUploading, setMmsUploading] = useState(false);`. Reset all three when `channel` switches away from `sms` in `handleChannelChange`.

**`SmsComposeCard` new props (additive):**
```ts
brandId: string | null;
mediaUrl?: string | null;          // verified public URL (or null)
mediaLocalUri?: string | null;     // for the thumbnail before/after upload
uploading?: boolean;
onPickMedia: () => void;           // parent owns pick+upload
onRemoveMedia: () => void;
hasMedia?: boolean;                // = mediaUrl != null
```

**Attach control (design — build exactly):** below the `estimateBox`, add an **Attach row**:
- When no media: a full-width ghost button, `minHeight: 44`, `borderRadius: radius.md`, `borderWidth: hairline`, `borderColor: glass.border.profileBase`, `backgroundColor: glass.tint.profileBase`, row layout with an `Icon` (image/paperclip glyph from the existing `Icon` set) + label `"Add photo"` (`typography.bodySm`, weight 600, `textTokens.primary`). `accessibilityRole="button"`, `accessibilityLabel="Add a photo to this text"`. `disabled` while `uploading` or `brandId === null`.
- While uploading: replace the button label with an `ActivityIndicator` (small, `textTokens.secondary`) + `"Uploading…"`.
- When media present: a **thumbnail chip** — 64×64 `Image` (`borderRadius: radius.sm`, `resizeMode: "cover"`) using `mediaLocalUri ?? mediaUrl`, a filename/"Photo attached" label, and a **Remove** pressable (`accessibilityLabel="Remove photo"`, ×-icon, `hitSlop:8`) that calls `onRemoveMedia`.
- **Persistent MMS caption** (shown whenever `hasMedia`): `"Photos send as a picture message (MMS) to US numbers — costs more than a text. Nigerian numbers get the words only."` — `typography.labelCap`, `color: textTokens.tertiary`. This is the per-market honesty note (§4.6); the composer cannot know per-recipient country at compose time (audience resolves server-side), so this static caption is the honest disclosure.

**Pick + upload handler (in `compose.tsx`, passed as `onPickMedia`):** mirror `ExperienceStopPhotoSheet.pickFromLibrary` cross-platform acquisition exactly:
- Native (`Platform.OS !== "web"`): `requestMediaLibraryPermissionsAsync()` → on deny toast `"Photo library permission is needed to add a photo."`; else `launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1, allowsMultipleSelection: false, selectionLimit: 1 })` (from `../../src/utils/platformImagePicker`). On `canceled` / empty → return.
- Web: `pickBrowserFiles({ accept: "image/jpeg,image/png,image/gif", maxFiles: 1, multiple: false, validate: false })` (from `../../src/utils/browserFilePicker`); map the single `BrowserPickedFile` → `{uri, mimeType, fileName, fileSize}`; call `revokeBrowserPickedFiles` in `finally`.
- Then: `setMmsLocalUri(asset.uri)`, `setMmsUploading(true)`, `const url = await uploadMarketingMmsImage(brandId, {uri, mimeType, fileName, fileSize})`, `setMmsMediaUrls([url])`, `setIsDirty(true)`. Catch `BrandCoverError` → `setErrorBanner(err.message)` and clear `mmsLocalUri`. `finally { setMmsUploading(false) }`.
- `onRemoveMedia`: `setMmsMediaUrls([])`, `setMmsLocalUri(null)`, `setIsDirty(true)`.

Wire `SmsComposeCard` at `compose.tsx` line 760–770 with the new props.

### 4.4 Cost estimate (`smsCost.ts`)
Extend `estimateSmsCost` **additively** (append a param; existing 2-arg callers unaffected):
```ts
const DEFAULT_MMS_COST_MINOR = 2; // ~US MMS $0.02/msg, conservative whole-cent
export function estimateSmsCost(
  message: string,
  reachableSms: number,
  segmentCostMinor: number = DEFAULT_SEGMENT_COST_MINOR,
  hasMedia: boolean = false,
): SmsEstimate { … }
```
- Extend `SmsEstimate.encoding` union to `"GSM-7" | "UCS-2" | "MMS"`.
- When `hasMedia`: `encoding = "MMS"`, `segmentsPerRecipient = 1` (MMS billed per message, not per segment), `totalSegments = safeReach` (i.e. message count), `estimatedCostMinor = safeReach * DEFAULT_MMS_COST_MINOR`. `charCount` still reflects `bodyWithFooter(message).length` (text still rides the MMS).
- `SmsComposeCard`'s existing `estimate` call becomes `estimateSmsCost(value, reachableSms ?? 0, undefined, hasMedia)`. The estimate box's "Encoding" row then shows "MMS", "Per recipient" shows "N chars · 1 message", "Est. cost" reflects the MMS rate. `SmsPreviewPane` uses the same call.

### 4.5 Payload + type (`types/marketing.ts`) + build (`compose.tsx`)
- `ChannelPayloadSms` (line 73–77): add `media_urls?: string[];` (array for forward-compat; composer sets exactly one). Keep `body` and `short_url_token`.
- `buildPayload` (line 305–316): the SMS branch becomes `return { kind: "sms", body: smsBody, ...(mmsMediaUrls.length > 0 ? { media_urls: mmsMediaUrls } : {}) };`.
- Draft rehydration (line 277–279): when `row.channel_payload.kind === "sms"`, also `setMmsMediaUrls(row.channel_payload.media_urls ?? [])` and `setMmsLocalUri(row.channel_payload.media_urls?.[0] ?? null)` so a reopened MMS draft shows its attachment.
- `useComposerDraft` state object (line 362): add `mmsMediaUrls` so autosave re-fires when media changes (dirty already set by handlers, but include for completeness).

### 4.6 Send path (backend)
- **`marketing-send/index.ts` `CampaignRow.channel_payload`** (lines 193–203): add `media_urls?: string[];`.
- **`sendSms`** (line 802–1051): after `const rawBody = …` (line 830), read `const mediaUrls = Array.isArray(campaign.channel_payload.media_urls) ? campaign.channel_payload.media_urls.filter((u) => typeof u === "string" && u.length > 0) : [];`. In the live-send `smsAdapter.send({...})` call (line 978–988), add `mediaUrls,`. **Everything else in `sendSms` is UNCHANGED** — the ORCH-1270 idempotency read (`shouldSkipDispatchedRecipient`), `decideSmsDisposition` defer/fail branches, the retry-and-throw terminal write, batching/pacing, clicks, and `mkt_finalize_campaign` finalize all stay byte-for-byte. Media is a passenger on the existing send; it does not alter disposition or dedupe.
- **`smsAdapter.ts` `SmsSendInput`** (line 35–51): add `mediaUrls?: string[];` (docstring: "US/Twilio only; the NG/Termii path IGNORES media — SMS-only").
- **`smsAdapter.send`** (line 234): pass `input.mediaUrls` into `twilioSend` (add a 4th arg). The **NG branch** (`termiiSend`, line 257–258) is left unchanged and never receives media → **NG silently sends SMS-only** (Termii `/api/sms/send` `type:"plain"` carries no media param; confirmed from the payload shape at `smsAdapter.ts` lines 197–204). This is the per-market rule: **media only rides the Twilio `MediaUrl` param; NG drops it.**
- **`twilioSend`** (line 123–172): add param `mediaUrls?: string[]`. After building `params` (line 144–148), before the fetch: `if (mediaUrls) for (const u of mediaUrls) { if (u && u.length > 0) params.append("MediaUrl", u); }`. Twilio's `MediaUrl` param may repeat for multiple media; single-image v1 appends one. Everything else (MessagingServiceSid, StatusCallback, no-raw-`From`, error handling, 21610 blacklist mapping) unchanged — the ORCH-1161 CI gate (no raw From, MessagingServiceSid, kill-switch) still passes.
- **Segment recording:** unchanged. `segments` stored on `marketing_messages` continues to be the text segment count; MMS cost is a client-side estimate only. No server cost accounting change.

### 4.7 Twilio API reference (external-docs verification, I-EXTERNAL-API-DOCS-VERIFIED)
Twilio Programmable Messaging — Create Message: `MediaUrl` (optional, repeatable) is a publicly accessible URL Twilio fetches and attaches; presence of `MediaUrl` promotes the message to MMS. Ref: `https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource` (param `MediaUrl`). Cite inline in the implementation.

---

## 5. ORCH-1283 — Remove the RCS tab (CI-green)

### 5.1 Current behavior (proven)
- `ChannelTabs.tsx` `TABS` (line 40–48) includes `{ kind: "rcs", label: "RCS", enabled: false, caption: "pending" }`; type `MarketingChannelKind = "email" | "sms" | "rcs"` (line 26).
- `marketing-send/index.ts` dispatcher (line 414–434) has `case "rcs": throw new Error("rcs_not_yet_enabled");`, with the local `CampaignRow.channel_payload.kind: "email" | "sms" | "rcs"` (line 194) and the exhaustiveness sentinel `const _exhaustive: never = kind` (line 429).
- CI gate `.github/scripts/strict-grep/orch-0815-b-composer-and-send.mjs` FORCES the `rcs` literal: **check-1** requires `case "rcs"` in marketing-send (line 114); **check-2/12** require `kind: "rcs"` in ChannelTabs (line 132). Runner: `.github/workflows/strict-grep-mingla-business.yml` line 1420–1429.
- App-side payload union has `ChannelPayloadRcs` (`types/marketing.ts` line 79–90, `| ChannelPayloadRcs` line 95); orphaned branch `else if (payload.kind === "rcs")` in `marketingRenderingService.ts` line 98–99.

### 5.2 Required removals (exact)
1. **`ChannelTabs.tsx`:** delete the `rcs` entry from `TABS` (line 47). Narrow `MarketingChannelKind` (line 26) → `"email" | "sms"`. Update the file doc comment (lines 2, 5–8) to drop RCS mentions. (`MarketingChannelKind` is only used as the composer channel-selector type — `compose.tsx` `channel` state, `handleChannelChange` — and is never compared against `"rcs"`; safe narrowing.)
2. **`marketing-send/index.ts`:** delete `case "rcs": throw new Error("rcs_not_yet_enabled");` (line 424–425). Narrow the LOCAL `CampaignRow.channel_payload.kind` union (line 194) → `"email" | "sms"`. This is REQUIRED so `const _exhaustive: never = kind` (line 429) still type-checks after the `email`/`sms` cases (with `rcs` still in the union but no case, `kind` would be `"rcs"` in `default`, not `never`, and the sentinel would fail to compile). Keep the `default:` throw + sentinel. Update the header doc comment (lines 12–14) to say "SMS is live; unknown kinds throw".
3. **`types/marketing.ts`:** delete `ChannelPayloadRcs` (line 79–90) and its `| ChannelPayloadRcs` member (line 95). This is the app payload union used by `buildPayload`/`CampaignChannelPayload`. **Do NOT** touch `MarketingChannel` (line 19) — see §6.3.
4. **`marketingRenderingService.ts`:** delete the now-uncompilable branch `else if (payload.kind === "rcs") { issues.push("RCS channel not yet enabled"); }` (line 98–99). Leaves `email` / `sms` / `else (never)` — `const _exhaustive: never = payload` (line 101) still compiles. (This function's `sms` branch text "SMS channel not yet enabled" is pre-existing stale copy but is OUT OF SCOPE — flagged as Discovery D-1; do not touch it.)
5. **CI gate `orch-0815-b-composer-and-send.mjs`:**
   - **check-1** (line 114): delete `if (!/case\s+["']rcs["']/.test(src)) fail("check-1", MARKETING_SEND, "missing rcs case");`. KEEP the email + sms case assertions (lines 112–113), the `switch (kind)` assertion, the `default: throw` assertion, and the `_exhaustive: never = kind` assertion.
   - **check-2/12** (line 132): delete `if (!/kind:\s*["']rcs["']/.test(src)) fail("check-2", CHANNEL_TABS, "literal rcs tab missing");`. KEEP the email + sms literal assertions (lines 130–131).
   - Update the gate header comment (lines 20–29) and the check-list docstring so it describes a **2-channel (email + sms)** contract, and update the final "12 checks" tallies if the maintainer wants precision (optional; the count string on line 261 is cosmetic).

### 5.3 What stays green
After these edits: `tsc` compiles (both `_exhaustive: never` sentinels intact); the gate runs `node …orch-0815-b-composer-and-send.mjs` → exit 0 (no rcs assertions left, email+sms still present); the composer shows a **2-tab** selector (Email · SMS). No prod campaign carries `kind:"rcs"` (SMS/RCS shipped text-dark; DB was wiped 2026-06-22), so removing the app-side rcs payload type cannot orphan live rows.

---

## 6. Decisions & migration assessment

### 6.1 Migration needed? — NO
`marketing_campaigns.channel_payload` is `jsonb` and its CHECK (`20260602000003_orch_0815_marketing_hub_phase_a.sql` line 213–216) validates ONLY: `jsonb_typeof = 'object'` AND `channel_payload->>'kind' IN ('email','sms','rcs')` AND `channel_payload->>'kind' = channel`. Adding a `media_urls` JSON key does NOT touch `kind`, so it passes the CHECK unchanged. **No schema change for 1282.**

### 6.2 RCS DB CHECK left permissive — intentional, NO migration
The `channel` column CHECK still lists `'rcs'` (`IN ('email','sms','rcs')`, lines 139/202/276/368) and the unsubscribe/consent resolver still expands `'all' → email+sms+rcs`. Leaving these is correct: a permissive superset costs nothing (no row will ever be `'rcs'`), and narrowing the DB CHECK would require a migration for zero user benefit and risk fighting the unsubscribe resolver.

### 6.3 `MarketingChannel` union keeps `'rcs'` — intentional scope boundary
Removing `'rcs'` from the *channel-column* type `MarketingChannel` (`types/marketing.ts` line 19 AND backend `_shared/marketingAudience.ts` line 23) cascades into consent/unsubscribe comparisons (`marketingAudienceService.ts` lines 367/372; `_shared/marketingAudience.ts` lines 363–364; `self-serve-unsubscribe/suppress.ts` `'all'→…rcs`) which are tied to the DB CHECK above. That is a large blast radius for a "remove a dead tab" task. **Decision:** narrow only the two composer-facing type surfaces (`MarketingChannelKind` and the app payload union `ChannelPayloadRcs`) + the dispatcher's local `kind` union; LEAVE `MarketingChannel` and the consent/unsubscribe channel logic untouched. The RCS tab is gone from the UI; the channel-string plumbing that the DB and unsubscribe resolver depend on is preserved.

---

## 7. DRAFT invariants (flip ACTIVE on CLOSE — orchestrator owns the flip)

- **I-PROPOSED-1281-SMS-PREVIEW-CHANNEL-BRANCHED (DRAFT):** When `channel === 'sms'`, all three composer preview surfaces (wide-desktop rail, inbox-preview modal, review sheet) render the SMS preview (`SmsPreviewPane` / MESSAGE row) and NEVER `EmailPreviewPane` / the email SUBJECT row. Verified by the 1281 component test (§8).
- **I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE (DRAFT):** Any `media_urls` entry on an SMS payload MUST be an `https://` URL on the public `brand_covers` bucket, obtained via `getPublicUrl` and proven reachable via `verifyBrandCoverPublicUrl` before it is written into the payload. No local `file://`/blob URIs ever reach the payload or Twilio.
- **I-PROPOSED-1282-MMS-NG-DROPS-MEDIA (DRAFT):** Media is transmitted ONLY via the Twilio `MediaUrl` param. The NG/Termii send path never carries media (SMS-only). Verified by the adapter test (§8) asserting `termiiSend` receives no media and the NG branch produces an SMS.
- **I-PROPOSED-1283-NO-RCS-TAB (DRAFT):** The composer channel selector exposes exactly `{email, sms}`; the `TABS` array contains no `rcs` entry; the ORCH-0815-B gate contains no assertion requiring the `rcs` literal. Verified by the 1283 component test + a gate self-run.

---

## 8. Test requirements (implementor happy-path fails-on-revert + tester adversarial)

**Append-only gate:** append to EXISTING test files where one exists; create NEW test files for new units. Existing files to append to: `mingla-business/src/utils/__tests__/smsCost.test.ts`. New files below.

### ORCH-1281
- **Implementor (fails-on-revert):** NEW `mingla-business/src/components/marketing/__tests__/metaOrch1281SmsPreview.test.tsx` — render the composer preview surfaces (or `SmsPreviewPane` + the branch selector) with `channel='sms'`; assert `SmsPreviewPane` renders (unique text: the STOP footer / "Text message · SMS") and `EmailPreviewPane`'s "Unsubscribe"/"FROM" chrome is ABSENT; assert the review sheet shows a MESSAGE row (not SUBJECT). Reverting the branch (forcing `EmailPreviewPane`) MUST fail this test. Also assert `channel='email'` still renders `EmailPreviewPane` (email untouched).
- **Tester (adversarial):** switch channel email↔sms repeatedly and confirm the preview + review swap each time; UCS-2 body (emoji) shows correct encoding/segment count via the shared util; empty `smsBody` shows the empty-state bubble and no count line; long body wraps in the bubble. Runtime: drive iOS sim; web review capped at "suspected" (authed composer runtime unreachable).

### ORCH-1282
- **Implementor (fails-on-revert):**
  - APPEND to `smsCost.test.ts`: `estimateSmsCost(msg, 100, undefined, true)` → `encoding === "MMS"`, `segmentsPerRecipient === 1`, `totalSegments === 100`, `estimatedCostMinor === 100 * DEFAULT_MMS_COST_MINOR`; and `hasMedia=false` path unchanged (regression pin). Reverting the MMS branch fails these.
  - NEW `supabase/functions/__tests__/marketing_send_mms_adapter.test.ts` — unit-test `twilioSend` (or `smsAdapter.send` with a stubbed `fetch`): with `mediaUrls:["https://…/x.jpg"]` and US country + kill-switch ON, the POST body contains `MediaUrl=https%3A…`; with NG country, the Termii path is taken and NO `MediaUrl` is sent (SMS-only). Reverting the `params.append("MediaUrl", …)` fails the US assertion.
  - NEW `mingla-business/src/services/__tests__/marketingMmsImageService.test.ts` — reject >5 MB and non-jpeg/png/gif with the correct `BrandCoverError`; on success return the verified `getPublicUrl`. (Mock storage + `verifyBrandCoverPublicUrl`.)
- **Tester (adversarial):** oversized/wrong-type image → toast, no payload mutation; upload failure → toast, attach cleared, send still possible as plain SMS; the payload `media_urls` is a verified public URL and a real HEAD returns 200 (I-PROPOSED-1282-…-FETCHABLE); a mixed US/NG audience → US gets MMS, NG gets SMS-only (trace `sendSms`→adapter→`termiiSend`); ORCH-1270 defer/idempotency untouched (re-run cron over an MMS campaign → no double-send, deferred rows still defer). Runtime: iOS sim for pick+preview; backend via unit + a live `curl` against `marketing-send` in preview-gate mode (no real Twilio) confirming payload threading. **Native-module check:** confirm `expo-image-picker@17` is present in the shipped business native binary (it already backs shipped experience-stop photos → low risk, but verify; if added post-last-build, MMS attach needs a native rebuild — see §10).

### ORCH-1283
- **Implementor (fails-on-revert):** NEW `mingla-business/src/components/marketing/__tests__/metaOrch1283NoRcsTab.test.tsx` — assert the exported `TABS`/rendered selector contains exactly `email` + `sms` and NO `rcs`; re-adding the rcs tab MUST fail it. Plus a CI self-check: `node .github/scripts/strict-grep/orch-0815-b-composer-and-send.mjs` exits 0 after removal (run in the implementor's verification). Confirm `tsc` compiles (both `_exhaustive: never` sentinels).
- **Tester (adversarial):** run the full ORCH-0815-B gate → green; confirm the `marketing-send` switch still throws on an unknown `kind` (default branch); confirm a (hypothetical) legacy `kind:"rcs"` draft does not crash the composer rehydration (falls through the email/sms branches harmlessly — none exist in prod); confirm no other file references the removed `ChannelPayloadRcs` type (tsc).

---

## 9. Implementation order + scoped allowlist + DO-NOT-TOUCH

### Order (subtract-before-adding, then features)
1. **1283 first** (smallest, de-risks the switch/gate): edit `ChannelTabs.tsx`, `marketing-send/index.ts` (case + local union), `types/marketing.ts` (`ChannelPayloadRcs`), `marketingRenderingService.ts` (orphan branch), the gate `.mjs`. Run `tsc` + the gate → green.
2. **1282 backend + util**: `types/marketing.ts` (`media_urls`), `smsCost.ts` (MMS), `smsAdapter.ts` (`mediaUrls` + `MediaUrl`), `marketing-send/index.ts` (`sendSms` thread-through + `CampaignRow`).
3. **1282 client**: `marketingMmsImageService.ts` (new), `SmsComposeCard.tsx` (attach UI), `compose.tsx` (state + handlers + payload + rehydrate).
4. **1281**: `SmsPreviewPane.tsx` (new), `compose.tsx` (three branch points), `ComposerReviewSheet.tsx` (MESSAGE row).
5. Tests (per §8). Run business + backend gates.

### Scoped allowlist (implementor MAY edit ONLY these)
```
mingla-business/app/(tabs)/marketing/campaigns/compose.tsx
mingla-business/src/components/marketing/SmsComposeCard.tsx
mingla-business/src/components/marketing/ChannelTabs.tsx
mingla-business/src/components/marketing/ComposerReviewSheet.tsx
mingla-business/src/components/marketing/SmsPreviewPane.tsx                (NEW)
mingla-business/src/services/marketingMmsImageService.ts                  (NEW)
mingla-business/src/services/marketing/marketingRenderingService.ts       (rcs-branch delete ONLY)
mingla-business/src/types/marketing.ts
mingla-business/src/utils/smsCost.ts
supabase/functions/marketing-send/index.ts
supabase/functions/_shared/adapters/smsAdapter.ts
.github/scripts/strict-grep/orch-0815-b-composer-and-send.mjs
mingla-business/src/utils/__tests__/smsCost.test.ts                       (APPEND)
mingla-business/src/components/marketing/__tests__/metaOrch1281SmsPreview.test.tsx      (NEW)
mingla-business/src/components/marketing/__tests__/metaOrch1283NoRcsTab.test.tsx        (NEW)
mingla-business/src/services/__tests__/marketingMmsImageService.test.ts   (NEW)
supabase/functions/__tests__/marketing_send_mms_adapter.test.ts           (NEW)
```

### DO-NOT-TOUCH (stop-and-amend before editing)
- ORCH-1270 logic: `shouldSkipDispatchedRecipient`, `decideSmsDisposition`, the retry-and-throw terminal write, batching/pacing, `mkt_finalize_campaign` call, the SMS timing info-note block in `ComposerReviewSheet.tsx` (lines 62–116) and its `compose.tsx` drivers (`captureSmsSendWindow`, `handleScheduleForNextWindow`, `nextGlobalSendWindowOpen`).
- `EmailPreviewPane.tsx` (email preview) — unchanged.
- `MarketingChannel` union + consent/unsubscribe rcs logic: `types/marketing.ts` line 19, `_shared/marketingAudience.ts`, `marketingAudienceService.ts` consent lines, `self-serve-unsubscribe/suppress.ts` (§6.3).
- All DB migrations + the `channel_payload`/`channel` CHECK constraints (no migration).
- `sendEmail` and the Resend path.
- `venue-reservation-create` `rcs=` query param (unrelated — reservation checkout session, NOT the RCS channel).
- `send-venue-sms` / transactional SMS.

---

## 10. Risks & open decisions

- **R-1 (native-module presence):** `expo-image-picker@17.0.11` is in `mingla-business/package.json` and backs the SHIPPED experience-stop photo picker, so it is almost certainly in the current native binary — but per COMMS-0035-class risk, tester MUST confirm it's in the live build; if it was added after the last business native build, MMS attach fails at runtime and needs a native rebuild+release. Business OTA is bricked (COMMS-0063) → this cluster ships via a native build regardless.
- **R-2 (Twilio media fetch failure):** if Twilio can't fetch the `MediaUrl` (transient storage 404), Twilio returns an error → the existing `twilioSend` non-ok path marks the message `failed` honestly (no silent drop). `verifyBrandCoverPublicUrl` at upload time makes this rare. Acceptable; no retry-media logic in v1.
- **R-3 (biz-web authed runtime cap):** web MMS attach uses the `browserFilePicker` path; the authed composer runtime is unreachable in automated QA, so web claims are capped at "suspected" — the implementor should reuse the exact `ExperienceStopPhotoSheet` acquisition so web parity follows the already-shipped pattern.
- **OQ-1 (MMS per-message rate):** `DEFAULT_MMS_COST_MINOR = 2` (US ~$0.02) is an operator-tunable estimate, consistent with the existing "estimate only, carrier meters authoritatively" copy. Confirm the whole-cent value is acceptable or make it env/settings-driven later (out of scope now).
- **OQ-2 (sender label honesty):** `SmsPreviewPane` labels the sender by brand name (not a hardcoded toll-free), because plain-SMS recipients see the sending *number* (region-dependent, infra) and the brand identity lives in the body. If Seth wants the literal toll-free shown, that's a one-line copy change — flagged, not assumed.

### Discoveries for orchestrator
- **D-1:** `marketingRenderingService.validateChannelPayload` pushes "SMS channel not yet enabled" (line 96–97) — STALE (SMS is live since META-ORCH-1161). Left untouched (out of scope). Register as a cleanup ORCH; also verify whether the function is dead code (no composer path uses it — inline validation in `compose.tsx` supersedes it).

---

## 11. Downstream routing
- **Next:** mingla-implementor (this worktree/branch). Build in the §9 order; run business jest + the ORCH-0815-B gate + `tsc` + backend deno tests; prove all §8 fails-on-revert tests.
- **Then:** mingla-tester — iOS-sim runtime for preview + attach; backend unit/live-fire for the adapter `MediaUrl` + NG-drop; full ORCH-0815-B gate green; ORCH-1270 regression (no double-send over an MMS campaign).
- **Then:** orchestrator CLOSE — flip the four I-PROPOSED-* invariants ACTIVE; ONE PR for the cluster; ship via **native business build** (not OTA, COMMS-0063). Edge functions (`marketing-send`, `smsAdapter` is bundled with it) deploy via the orchestrator's edge-deploy step; verify with one `curl` in preview-gate mode.
