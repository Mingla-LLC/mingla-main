# DEPLOY ORCH-0978 IMPLEMENT-3

Result: **SUCCESS**

Date: 2026-05-27
Operator: Claude `mingla-orchestrator` (per `feedback_orchestrator_deploys_edge_functions.md`)
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/`
Branch HEAD: `4d2896d3293fcc2767a4729d94f462cd709efa10`
Source commits: `7728cddee` (webhook fix), `4d2896d3` (Deno tests + allowlist)

## Edge function version bumps

| Function | Before | After | verify_jwt | Notes |
|---|---|---|---|---|
| event-cover-video-webhook | v120 | **v121** | false (preserved) | Carries the `recoverJobIdFromPayload` fix and `stage: "job_id_extraction_failed"` diagnostic |
| event-cover-video-upload-intent | v95 | **v95** (no bundle change) | true | Source byte-identical; Supabase CLI skipped deploy — F-6 discipline honored via attempted deploy |
| event-cover-video-source-uploaded | v81 | **v82** | true | Bundle rebuilt against shared `_shared/eventCoverVideo.ts` updates from prior phases |
| event-cover-video-status | v93 | **v94** | true | Bundle rebuilt against shared lib |
| event-cover-video-apply | v91 | **v92** | true | Bundle rebuilt against shared lib |
| event-cover-video-cancel | v91 | **v92** | true | Bundle rebuilt against shared lib |

Deploy command pattern:
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]"
/Users/sethogieva/bin/supabase functions deploy <slug> --project-ref gqnoajqerqhnvulmnyvv
```

`verify_jwt` settings come from `supabase/config.toml:48-49` (`[functions.event-cover-video-webhook]\nverify_jwt = false`); all others default to `true`. Config file was not touched in IMPLEMENT-3.

## Verify-first-call probe (per `feedback_supabase_edge_deploy_verify_first_call.md`)

```bash
curl -sS -o /tmp/webhook_probe.json -w "HTTP %{http_code} | time %{time_total}s\n" \
  -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/event-cover-video-webhook" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Result:
```text
HTTP 403 | time 0.321957s
{"error":"forbidden","detail":"missing_signature","message":"Cloudinary signature is missing."}
```

Interpretation:
- **Non-404 confirms bundle is live** (verify-first-call gate satisfied).
- **403 missing_signature confirms `verify_jwt = false` preserved**: if Supabase gateway had enforced JWT verification, the call would have returned 401 before reaching function code. Instead, the function ran, hit `verifyCloudinaryNotificationSignature`, and returned the expected 403 error shape.
- **Signature verification path is alive**: the new `recoverJobIdFromPayload` branch downstream of signature verification cannot be probed without the `CLOUDINARY_API_SECRET`. Live happy-path exercise of the new branch is delegated to tester live-fire (real Cloudinary eager callback).

## Hard-guard recap

| Guard | Result |
|---|---|
| Six event-cover-video functions attempted deploy | PASS |
| Webhook `verify_jwt = false` preserved | PASS (probe returned 403, not 401) |
| No `supabase db push` | PASS (no migrations changed) |
| No PR opened | PASS |
| No client touches | PASS (IMPLEMENT-3 commits diff already verified backend-only in REVIEW) |
| Local Supabase CLI (not MCP deploy) | PASS (used `/Users/sethogieva/bin/supabase functions deploy` per memory rule) |

## Next step

Route to Codex `tester-mingla` for RETEST per SPEC §D Item 7 plus Seth's physical iPhone. Tester dispatch will reference this deploy report and `Mingla_Artifacts/reports/REVIEW_ORCH-0978_IMPLEMENT_3.md`.
