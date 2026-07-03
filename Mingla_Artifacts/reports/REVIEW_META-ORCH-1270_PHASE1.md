# REVIEW — META-ORCH-1270 Phase 1 (Bunny provider branch)

**Reviewer:** orchestrator (hand-review; the dispatched review agent aborted 3× with 0 tool calls — infra flakiness, not a code signal).
**Commit reviewed:** `e19854b1c9bdc162f20decb2991110b13f596b58` on `META-ORCH-1270-bunny-migration`.
**Verdict: APPROVED — proceed to Phase 2.**

## Checks

1. **Cloudinary untouched — CONFIRMED-GOOD.** `upload-intent` gates the Bunny path on `provider === "bunny"` (index.ts:316) and falls through to the original Cloudinary signing (`cloudName`, `api.cloudinary.com/v1_1/...`, index.ts:381+) otherwise. `source-uploaded` gates the new real-byte-cap on `coverVideoProvider() === "bunny"` (index.ts:153) — Cloudinary jobs keep their exact prior behavior. Webhook keeps the Cloudinary notification path (`verifyCloudinaryNotificationSignature`). Existing Cloudinary tests stay green (38 passed).
2. **TUS presign signature — CONFIRMED-GOOD.** `sha256Hex(libraryId + apiKey + authorizationExpire + videoId)`, no delimiters, expiry in UNIX seconds (bunnyStream.ts:141-158) — matches the docs recipe. The library AccessKey is NEVER returned to the client; only `{authorizationSignature, authorizationExpire, libraryId, videoId, tusEndpoint}` cross the wire.
3. **Webhook fail-closed — CONFIRMED-GOOD (notably robust).** Dual-path auth: a PRESENT `x-bunnystream-signature` is HMAC-SHA256 constant-time verified, mismatch → hard 403; an ABSENT signature falls back to an authenticated `bunnyGetVideo` re-fetch (our AccessKey), failure → 403. Job lookup keys on `source_asset_id = VideoGuid` (`maybeSingle`); unknown guid / cancelled / already-applied all short-circuit. Crucially the final `processed_url` is derived from the authenticated `bunnyGetVideo` + `bunnyBestMp4`, NOT the webhook payload — so a spoofed callback cannot plant a fake cover (an unencoded video yields no ≤720p rendition → null → no apply). This pre-empts the "is Bunny's HMAC scheme real?" risk.
4. **Real byte cap — CONFIRMED-GOOD.** Enforced against Bunny's reported `storageSize` (provider truth), not the client-declared bytes (source-uploaded.ts:153-167). Cloudinary path unchanged (retirement is Phase 4; moot).
5. **Client TUS leg — SUSPECTED-OK, live-blocked.** Source structurally correct (create→presign→TUS PATCH, `Upload-Metadata` base64, native+web branches). Its jest test is source-structural because the RN service can't be imported under the worktree ts-jest — verified this artifact also fails on pristine HEAD, so it is pre-existing, not a Phase-1 regression. Real handshake requires live creds.
6. **Provider dispatch + migration — CONFIRMED-GOOD.** `cloudinary|bunny` dispatch is total; migration `20261205000000` extends the provider CHECK to allow `bunny` and indexes `source_asset_id`; prefix strictly exceeds all local + sibling-worktree migrations.
7. **Secrets hygiene — CONFIRMED-GOOD.** All Bunny values via `Deno.env`; nothing hardcoded; no signature/secret logged.

## Pristine-HEAD pre-existing issues (NOT this phase)
- Two strict-grep gates (`orch-0770...`, `orch-0776a`) fail on pristine HEAD (grep a literal that exists nowhere) and are not wired to any CI workflow — stale; flag for separate cleanup.
- `platformFileSystem` web/native stub signature mismatch makes the existing client jest test un-runnable in a shared-node_modules worktree — pre-existing.

## Live-blocked — retest at cutover (with real Bunny creds)
1. Confirm whether Bunny sends `X-BunnyStream-Signature` (if not, the re-fetch fallback carries it — verify live).
2. Live TUS create→upload handshake (`Upload-Metadata` base64, chunking) on native AND web.
3. **MP4 Fallback must be ON** on the library or `bunnyBestMp4` returns null (no cover URL) — already item #6 on Seth's setup list.
4. Run `supabase migration list --linked` drift check from the anchor (linked ref) before applying the migration.
