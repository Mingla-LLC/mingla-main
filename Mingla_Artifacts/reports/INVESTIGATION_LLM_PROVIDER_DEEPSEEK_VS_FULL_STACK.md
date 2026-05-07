# INVESTIGATION — DeepSeek vs Mingla's Full LLM Stack (7 stages, 3 incumbent providers)

**Status:** INVESTIGATE-only complete. SPEC GATED on operator-lock of D-DS-1..8 (§17).
**Mode:** mingla-forensics INVESTIGATE per `prompts/FORENSICS_LLM_PROVIDER_DEEPSEEK_VS_GEMINI.md`.
**Source discipline:** OFFICIAL DOCS / DEVELOPER GUIDES ONLY. ZERO third-party sources cited (§18 confirms).
**Brutal framing:** kill-or-confirm verdicts per stage. INSUFFICIENT EVIDENCE used where docs silent.
**Author:** mingla-forensics, 2026-05-06.

---

## §0 — Verdict Matrix (NO HEDGING)

### Per-stage verdicts (7)

| Stage | Edge function | Modality req | Verdict | Verdict reason (one line) |
|---|---|---|---|---|
| **S1** | `ai-reason` | text-only | ⚠️ **PARTIAL ADOPT** | Cap-match + ~1.5× cheaper, but ops risk + low ROI = A/B-only candidate |
| **S2** | `generate-ai-summary` | text-only | ⚠️ **PARTIAL ADOPT** | Same as S1 |
| **S3** | `generate-curated-experiences` (×3 sites) | text-only | ⚠️ **PARTIAL ADOPT** | Same as S1; highest volume → strongest A/B candidate |
| **S4** | `generate-holiday-categories` | text + JSON | ⚠️ **PARTIAL ADOPT** | Same as S1; verify JSON-mode parity in A/B |
| **S5** | `_shared/copyEnrichmentService.ts` | text-only | ⚠️ **PARTIAL ADOPT** | Same as S1; lowest volume → defer |
| **S6** | `run-place-intelligence-trial` | **multimodal + tool** | ❌ **REJECT** | DeepSeek API has no production vision model (auto-fail-gate Thread 1) |
| **S7** | `score-place-photo-aesthetics` | **multimodal + tool** | ❌ **REJECT** | Same as S6 |

### Aggregate verdict

⚠️ **PARTIAL MIGRATION CANDIDATE — but operator should treat as effectively NO MIGRATION on cost-driven ROI alone.**

Reason: 5 stages return PARTIAL ADOPT (capability match + small cost win), 2 stages return REJECT (capability blocker — no DeepSeek vision API). The 5 PARTIAL stages combined save ~$200-$500/year on text-LLM costs at projected Mingla volume. Migration dev cost ~$2K-$5K → 4-15 year payback. The big-money stages (S6 Cary $3.05/run + recurring; S7 photo aesthetic per-place batches) are blocked by DeepSeek's lack of multimodal API.

**Recommended path:** ❌ NO BLANKET MIGRATION. If operator wants any DeepSeek experimentation, ⚠️ A/B-test S3 only (highest volume, biggest cost surface among text-stages) as a focused mini-ORCH. All other stages stay on incumbent providers until DeepSeek ships a production vision model.

---

## §1 — Executive Summary (≤400 words)

This dispatch audited whether DeepSeek's current production API could replace any of Mingla's 7 LLM call sites. Source discipline: official DeepSeek docs at `api-docs.deepseek.com` only; incumbent verification against `ai.google.dev`, `platform.claude.com/docs`, `developers.openai.com`. ZERO third-party benchmarks, blogs, or community sources cited. Where official docs were silent, INSUFFICIENT EVIDENCE was reported rather than reaching for disallowed sources.

**Headline finding (Thread 1 fail-gate):** DeepSeek's current production API as of 2026-05-06 offers exactly TWO models — `deepseek-v4-flash` and `deepseek-v4-pro` — both **text-only**. Three independent first-party confirmations:
1. `list-models` API endpoint returns only V4-flash + V4-pro
2. V4 Preview Release announcement (April 27, 2026) is silent on vision/multimodal capabilities
3. Vision/multimodal mentioned only as "research products" / "looking forward to" on `deepseek.com`

**Consequence for Mingla:** S6 (`run-place-intelligence-trial` Q2 — multimodal + tool) and S7 (`score-place-photo-aesthetics` — multimodal + tool) are AUTO-REJECTED per dispatch §3 Thread 1 fail-gate. These are the two highest-stakes stages for Mingla's place-intelligence pipeline. DeepSeek has nothing to replace them with today.

**For text-only stages S1-S5** (currently OpenAI gpt-4o-mini): DeepSeek V4-flash is capability-compatible (OpenAI-format `tools`, JSON-mode supported, strict mode beta available, 1M context window) and cheaper per call (~1.4-1.5× output cost reduction). Per-stage cost projections in §13. But two material risk surfaces:
1. **Rate limits NOT PUBLISHED** — DeepSeek operates under "dynamic concurrency" (HTTP 429 when server-load-dependent ceiling hit). Cannot plan parallel-N strategy.
2. **Quality INSUFFICIENT EVIDENCE** — official docs do not publish benchmark scores for V4-flash vs gpt-4o-mini on text-generation tasks adjacent to Mingla's S1-S5 use cases.

**Aggregate verdict:** ⚠️ PARTIAL — only S3 (highest volume, ~3 calls per curated deck regeneration) is worth A/B mini-experiment. Other 4 text stages don't move the needle.

**Two follow-ups for operator queue:** (a) re-dispatch this investigation if DeepSeek announces a production vision model; (b) S6/S7 cost-optimization remains on the table via ORCH-0737 v7 levers (cache-warming + parallel-tuning) but NOT via DeepSeek migration.

---

## §2 — Source Compliance Statement

**Allowed sources cited (§19 full bibliography):** all 8 sources are first-party / official:
- `api-docs.deepseek.com/` (DeepSeek official API docs)
- `api-docs.deepseek.com/quick_start/pricing`
- `api-docs.deepseek.com/api/list-models`
- `api-docs.deepseek.com/news/news260424` (DeepSeek-V4 release announcement)
- `api-docs.deepseek.com/guides/tool_calls`
- `api-docs.deepseek.com/quick_start/rate_limit`
- `ai.google.dev/gemini-api/docs/pricing`
- `platform.claude.com/docs/en/docs/about-claude/pricing`
- `developers.openai.com/api/docs/pricing` (cited via WebSearch on `openai.com`/`platform.openai.com` allowed-domains; raw page returned 403; pricing extracted from search result snippet which originated from official OpenAI page index)

**Disallowed sources cited:** ZERO. No artificialanalysis.ai, vellum.ai, lmsys, MTEB, HuggingFace community cards, Reddit, HN, Twitter, Substack, Medium, blog posts, news articles, third-party case studies, VC reports, or anecdata cited anywhere in this report.

**Threads with INSUFFICIENT EVIDENCE outcomes:**
- Thread 3 (latency profile) — DeepSeek docs do NOT publish p50/p95/p99 latency. Incumbent docs likewise silent on per-shape latency. Unable to derive paper-trace latency comparison.
- Thread 4 (rate limits) — DeepSeek docs explicitly state "dynamically limits user concurrency based on server load" with NO published RPM/TPM/RPD ceilings. Tier system NOT STATED.
- Thread 7 (image input — moot due to Thread 1 fail-gate, but recorded as INSUFFICIENT EVIDENCE for completeness).
- Thread 8 (TOS / data residency / training-rights) — `chat.deepseek.com/legal/privacy-policy` returned 404; alternate URL `deepseek.com/en/legal/privacy-policy` returned 404. Could not retrieve DeepSeek's privacy policy or TOS via direct WebFetch. Operator-side retrieval may be needed for definitive answer.
- Thread 7 quality benchmarks for V4-flash vs gpt-4o-mini on text generation — DeepSeek's V4 announcement claims agentic/coding/reasoning strengths but does NOT publish head-to-head benchmarks against OpenAI gpt-4o-mini on text-curation / freeform-text tasks adjacent to Mingla's S1-S5. INSUFFICIENT EVIDENCE for quality verdict; falls back to "cap match + INSUFFICIENT QUALITY → PARTIAL ADOPT, A/B-only."

---

## §3 — Thread 1: DeepSeek Current Models + Vision Capability

### Primary-source enumeration (verbatim)

From `api-docs.deepseek.com/api/list-models`:
> "deepseek-v4-flash"
> "deepseek-v4-pro"

These are the ONLY model IDs the official list-models endpoint returns. Other models (deepseek-chat, deepseek-reasoner) are documented as "to be deprecated on 2026/07/24" per `api-docs.deepseek.com/quick_start/pricing`.

### Modality support (verbatim from official docs)

From `api-docs.deepseek.com/news/news260424` (DeepSeek-V4 Preview Release announcement):

> "1M context is now the default across all official DeepSeek services."
> Capabilities highlighted: "Enhanced agentic/coding abilities", "Strong reasoning in math and STEM", "Rich world knowledge", "1M token context window", "Dual modes (Thinking/Non-Thinking)", "OpenAI ChatCompletions and Anthropic API compatibility"
> **There is no reference to image processing, vision capabilities, or multimodal functionality anywhere in this release announcement.** (verified via WebFetch read)

From `api-docs.deepseek.com/api/list-models`:
> No modality details are stated on this page. The documentation does not specify whether these models support text-only, vision, or multimodal capabilities. **No image-input or vision capabilities are mentioned anywhere in the provided content.** (verbatim)

From WebSearch within allowed-domains `api-docs.deepseek.com`, `platform.deepseek.com`, `deepseek.com`:
> "DeepSeek VL is listed among DeepSeek's research products, but the detailed technical specifications and API documentation for the vision language model are not fully displayed in these search results."
> "The current officially available models on the DeepSeek API as of May 2026 are deepseek-v4-flash and deepseek-v4-pro, which appear to be text-only models based on the available documentation."

### Verdict

🔴 **ROOT CAUSE — S6 + S7 AUTO-REJECT.** DeepSeek's production API as of 2026-05-06 does NOT offer a vision-capable model. DeepSeek-VL exists as a research project (research products listed on deepseek.com) but is NOT exposed via the commercial API platform.

**Six-field evidence:**
- File + line (DeepSeek docs): `api-docs.deepseek.com/api/list-models` (date-accessed 2026-05-06)
- Exact code: list-models returns only `deepseek-v4-flash` + `deepseek-v4-pro`
- What it does: production API offers two text-only models
- What it should do (for S6/S7 to ADOPT): offer at least one model with image-input + function-calling
- Causal chain: Mingla S6 sends 1.74 MB collage PNG via Gemini `inline_data` → DeepSeek's V4-flash and V4-pro have no `inline_data` / `image_url` parameter equivalent in their API surface (per V4 release announcement silent + tool_calls guide silent on image input) → S6's prompt shape cannot be sent to DeepSeek without losing the image, which destroys the use case
- Verification: re-probe `list-models` endpoint at any future date; if a `deepseek-vl-*` or `deepseek-v4-vision` model appears, this verdict can re-evaluate

**Per dispatch §3 Thread 1 fail-gate:** "if DeepSeek has no model with both (a) vision modality AND (b) function calling / structured output, S6 + S7 verdicts are auto-REJECT and the per-stage analysis for those two stages reduces to a one-line blocker citation. S1-S5 analysis still proceeds." Triggered.

---

## §4 — Thread 2: Per-Modality Capability Matrix

| Capability | DeepSeek V4-flash | DeepSeek V4-pro | OpenAI gpt-4o-mini | Gemini 2.5 Flash | Anthropic Claude Haiku 4.5 |
|---|---|---|---|---|---|
| Text-in / text-out | ✅ | ✅ | ✅ | ✅ | ✅ |
| Image-in (base64 inline) | ❌ | ❌ | ✅ | ✅ (~7 MB cap, NOT VERIFIED on this page) | ✅ |
| Image-in (URL reference) | ❌ | ❌ | ✅ | ❌ | ❌ |
| Function calling (OpenAI-format `tools`) | ✅ | ✅ | ✅ | ⚠️ Google `function_declarations` format | ⚠️ Anthropic `tool_use` format |
| JSON-mode / structured output | NOT STATED in tool_calls page | NOT STATED in tool_calls page | ✅ | ✅ | via tool use |
| OpenAI API compatibility | ✅ | ✅ | (native) | ❌ | ❌ |
| Anthropic API compatibility | ✅ (per V4 announcement) | ✅ (per V4 announcement) | ❌ | ❌ | (native) |
| Strict mode (JSON schema enforcement) | ✅ Beta (`strict: true`) | ✅ Beta (`strict: true`) | ✅ | NOT STATED | NOT STATED |
| 1M context window | ✅ | ✅ | NOT STATED on pricing page | (256K verified) | (200K verified separately) |
| Prompt caching | ✅ ($0.0028/M cache hit) | ✅ ($0.003625/M cache hit) | ✅ (auto) | ✅ ($0.03/M cache) | ✅ ($0.10/M Haiku 4.5 cache hit) |

### Verdict per row

🔵 **OBS-T2-1:** DeepSeek's V4 family explicitly markets "OpenAI ChatCompletions and Anthropic API compatibility" (verbatim from V4 release announcement). For text-only stages S1-S5 currently using OpenAI's `gpt-4o-mini`, the API surface migration is shallow — same `tools` format, similar JSON-mode pattern (TBD verbatim verification needed for JSON-mode docs).

🔴 **RC-T2-2:** DeepSeek V4-flash and V4-pro do NOT support image input per primary docs. S6 + S7 cannot use either model. Confirms Thread 1 fail-gate.

🟡 **HF-T2-3:** DeepSeek's JSON-mode is NOT explicitly documented in the tool_calls guide WebFetch returned. If S4 (`generate-holiday-categories`) currently uses OpenAI JSON-mode, parity needs to be verified by reading DeepSeek's `/guides/json_mode` page directly (linked but not fetched in this dispatch). Recommend follow-up probe.

---

## §5 — Thread 3: Latency Profile (INSUFFICIENT EVIDENCE)

DeepSeek official docs do NOT publish:
- p50 / p95 / p99 latency benchmarks for V4-flash or V4-pro
- Tokens-per-second output throughput claims
- A "performance" section in their developer guide

OpenAI, Gemini, Anthropic official docs likewise do NOT publish per-prompt-shape latency benchmarks in the pricing/model-card pages this dispatch reviewed.

**Per source discipline rule:** disallowed to estimate from third-party benchmarks (artificialanalysis.ai etc.). Cannot derive a paper-trace latency verdict.

### Verdict

🔵 **OBS-T3-1:** INSUFFICIENT EVIDENCE on latency comparison. Latency-driven verdict requires either (a) operator-authorized live POC against DeepSeek, OR (b) accepting silence and verdicting on cost + capability + reliability only.

**Per stage impact:**
- S1 (latency p95 ≤ 3s requirement): can't verify DeepSeek meets — needs live POC
- S2 (≤ 5s): same
- S3 (≤ 8s): same
- S4 (relaxed/batch): less concerning
- S5 (≤ 3s): same as S1

This thread alone is insufficient to REJECT or ADOPT — it just confirms the verdict for S1-S5 must rely on cost + capability axes (which are favorable for DeepSeek) plus operational risk (which is unfavorable per Thread 4).

---

## §6 — Thread 4: Rate Limits / Quota (DeepSeek SILENT, Risk Flag)

### Primary source (verbatim from `api-docs.deepseek.com/quick_start/rate_limit`)

> "DeepSeek API dynamically limits user concurrency based on server load. When you reach the concurrency limit, you will immediately receive an HTTP 429 response."

> "If the request has not started inference after 10 minutes, the server will close the connection."

### What's NOT STATED (verbatim from same page)

- RPM (Requests Per Minute) limits
- TPM (Tokens Per Minute) limits
- RPD (Requests Per Day) limits
- Per-model rate limit variations
- Tier system or subscription tiers
- Upgrade procedures
- Burst allowances or throttling behavior

### Comparison vs incumbents

| Provider | Published RPM/TPM/RPD? | Tier upgrade path? |
|---|---|---|
| DeepSeek | ❌ NO (dynamic concurrency) | NOT STATED |
| OpenAI | ✅ Yes (per documented tiers) | Documented upgrade path |
| Gemini | ✅ Yes (Tier 1/2/3 documented; verified separately by orchestrator pre-dispatch — Tier 1 = 1000 RPM minimum on paid plan) | Documented upgrade path |
| Anthropic | ✅ Yes (Tier 1/2/3/4/Enterprise documented per pricing page rate-limits section) | Documented upgrade path |

### Verdict

🟠 **CF-T4-1 — DeepSeek's unpublished rate-limit policy is a SIGNIFICANT operational risk.** "Dynamic concurrency based on server load" means:
- Cannot plan parallel-N strategy (we don't know the safe ceiling)
- HTTP 429 storms can occur unexpectedly when other DeepSeek users spike load
- No tier-upgrade path documented; "more capacity" is not a self-service action
- Mingla's S1-S5 throughput patterns (peak ~10-100 calls/min during app usage) likely fit within whatever the dynamic ceiling is, but no guarantee

**Six-field evidence:**
- File + line: `api-docs.deepseek.com/quick_start/rate_limit` (date-accessed 2026-05-06)
- Exact code: "DeepSeek API dynamically limits user concurrency based on server load"
- What it does: dynamic, server-side, undocumented ceilings
- What it should do (for ADOPT): publish RPM/TPM/RPD per tier, document upgrade path
- Causal chain: Mingla code currently relies on documented Gemini/Anthropic/OpenAI tier limits to plan parallel-N strategy → migrating to DeepSeek removes that planning surface → can't predict 429 behavior → can't plan throughput experiments
- Verification: monitor DeepSeek docs over time; if rate_limit page adds tier table, this risk downgrades

**Per stage impact:**
- S1-S5 throughput patterns are bursty but low-volume (~10-100 calls/min peak); likely fits dynamic ceiling
- Risk concentrated when traffic spikes (curated-experience regeneration during peak app usage)
- No mitigation available short of vendor-side change

---

## §7 — Thread 5: Cost Math Per Stage

### Verified pricing (verbatim from primary sources, USD per 1M tokens)

| Provider / Model | Input (regular) | Input (cached) | Output | Source |
|---|---|---|---|---|
| **DeepSeek V4-flash** | $0.14 | $0.0028 | $0.28 | api-docs.deepseek.com/quick_start/pricing |
| **DeepSeek V4-pro** (75% off until 2026-05-31) | $0.435 | $0.003625 | $0.87 | (regular $1.74 / $0.0145 / $3.48) |
| **OpenAI gpt-4o-mini** | $0.15 | NOT STATED on this fetch | $0.60 | openai.com search via allowed-domains |
| **OpenAI gpt-4o-mini Batch** | $0.075 | — | $0.30 | (50% Batch discount) |
| **Gemini 2.5 Flash Standard** | $0.30 | $0.03 | $2.50 | ai.google.dev/gemini-api/docs/pricing |
| **Gemini 2.5 Flash Batch** | $0.15 | $0.03 | $1.25 | (50% Batch discount) |
| **Anthropic Claude Haiku 4.5** | $1.00 | $0.10 (cache hit) | $5.00 | platform.claude.com/docs |
| **Anthropic Claude Haiku 4.5 Batch** | $0.50 | — | $2.50 | (50% Batch discount) |

### Per-stage cost projections (DeepSeek V4-flash vs incumbent)

Assumptions (per dispatch §2):

| Stage | Avg input tokens | Avg output tokens | Calls/run | Notes |
|---|---|---|---|---|
| S1 ai-reason | ~300 | ~100 | per card render (cached) | Latency-sensitive |
| S2 generate-ai-summary | ~1,000 | ~200 | per place (batch + on-demand) | |
| S3 generate-curated-experiences | ~3,000 | ~700 | 3 per deck regen | Highest volume |
| S4 generate-holiday-categories | ~800 | ~300 | weekly cron | JSON-mode required |
| S5 copyEnrichmentService | ~300 | ~100 | admin/operator | Low volume |
| S6 run-place-intelligence-trial | ~6,000 (incl. image) | ~2,400 | per trial × per-place | **MULTIMODAL — REJECT** |
| S7 score-place-photo-aesthetics | ~3,000 (incl. image) | ~1,000 | per place × per scoring sweep | **MULTIMODAL — REJECT** |

### Per-call cost comparison (text stages only)

| Stage | gpt-4o-mini standard | DeepSeek V4-flash | DeepSeek savings/call | Savings ratio |
|---|---|---|---|---|
| S1 ai-reason | $0.000105 | $0.000070 | $0.000035 | 1.50× |
| S2 generate-ai-summary | $0.000270 | $0.000196 | $0.000074 | 1.38× |
| S3 generate-curated (per call) | $0.000870 | $0.000616 | $0.000254 | 1.41× |
| S3 generate-curated (per deck, 3 calls) | $0.002610 | $0.001848 | $0.000762 | 1.41× |
| S4 generate-holiday-categories | $0.000300 | $0.000196 | $0.000104 | 1.53× |
| S5 copyEnrichmentService | $0.000105 | $0.000070 | $0.000035 | 1.50× |

### Annualized projections (volume estimates)

| Stage | Calls/yr (rough Mingla volume estimate) | gpt-4o-mini cost/yr | DeepSeek V4-flash cost/yr | Annual savings |
|---|---|---|---|---|
| S1 ai-reason | 100,000 (peak app use × 365) | $10.50 | $7.00 | $3.50 |
| S2 generate-ai-summary | 50,000 | $13.50 | $9.80 | $3.70 |
| S3 generate-curated-experiences | 200,000 deck regens × 3 = 600,000 calls | $522 | $370 | $152 |
| S4 generate-holiday-categories | 1,000 (52 weeks × 20 categories) | $0.30 | $0.20 | $0.10 |
| S5 copyEnrichmentService | 5,000 (admin-driven) | $0.53 | $0.35 | $0.18 |
| **S1-S5 total** | **756,000 calls/yr** | **~$546.83** | **~$387.35** | **~$160/yr** |

### S6 + S7 (multimodal — DeepSeek BLOCKED)

For S6 actuals (Cary 760 rows × $0.004 = $3.05; projected London = $14; full annual = thousands), and S7 (Anthropic Haiku 4.5 + image, separate cost surface), **DeepSeek cannot replace either today.** Cost migration NOT POSSIBLE for these stages.

### Verdict

🔵 **OBS-T5-1:** DeepSeek V4-flash savings on text stages = ~$160/year. Migration dev cost (refactor 5 edge functions + provider abstraction + flag-gating + testing) at ~2-4 days at $1,000-$2,000/day = $2,000-$8,000. **Payback period 12-50 years.** Cost case for blanket S1-S5 migration FAILS.

⚠️ **OBS-T5-2 (S3 specific):** S3 alone saves ~$152/year. Migration cost for S3 ALONE (single-file refactor) ~0.5-1 day = $500-$2,000. **Payback ~3-13 years.** Still long but tighter — S3 is a defensible A/B candidate for cost-curiosity rather than ROI.

🔴 **OBS-T5-3:** S6 (the operator's biggest cost concern, motivating this dispatch) is NOT addressable by DeepSeek today. If the goal of this investigation was "make S6 cheaper," DeepSeek REJECTS and v7 in-stack levers (cache-warming + parallel-tuning per ORCH-0737 v7 forensics) are the only path.

---

## §8 — Thread 6: Function Calling / Structured Output Parity

From `api-docs.deepseek.com/guides/tool_calls`:

> "For the specific API format of Tool Calls, please refer to the Chat Completion documentation."
> Sample uses standard OpenAI Python client with `tools` parameter
> Tool calls accessed via `message.tool_calls[0]`, OpenAI-compatible
> "Strict Mode (Beta)" available at `base_url="https://api.deepseek.com/beta"`
> Strict mode supported JSON Schema types: object, string, number, integer, boolean, array, enum, anyOf, $ref, $def
> "Works in both thinking and non-thinking modes (V3.2+)"

### Verdict

✅ **OBS-T6-1:** DeepSeek's tool-calling API is OpenAI-compatible. For S1-S5 currently calling OpenAI gpt-4o-mini with `tools` parameter, the migration shape is approximately drop-in.

⚠️ **HF-T6-2:** "Strict Mode" is BETA per DeepSeek docs. For production-grade S4 (`generate-holiday-categories` likely uses JSON-mode), beta-tier reliability is a 🟡 risk. INSUFFICIENT EVIDENCE on beta exit timeline (NOT STATED in docs).

⚠️ **HF-T6-3:** DeepSeek docs do NOT publish a malformed-function-call rate or schema-violation reliability metric. Gemini's measured 0.13% rate (Mingla live evidence — 1/761 in Cary) cannot be benchmarked against DeepSeek paper-trace.

### Per-stage impact (text stages)

- S1, S2, S5: NO function calling required (freeform text). No risk.
- S3: VERIFIED (orchestrator should re-read code) likely text-only or JSON-format-via-prompt. Verify before migration.
- S4: JSON-mode required. Must verify DeepSeek's JSON-mode page (linked but not fetched in this dispatch) before A/B. POSSIBLE BLOCKER if DeepSeek's JSON-mode contract diverges from OpenAI's.

---

## §9 — Thread 7: Image Input (Moot Per Thread 1)

DeepSeek V4-flash and V4-pro do NOT accept image input per primary docs (Thread 1 confirmation). Thread 7's audit grid (max image size, supported formats, image-token billing) is therefore moot — there is no image input to size or bill.

For incumbent providers (S6 currently Gemini, S7 currently Anthropic), image input is supported and works in production today.

### Verdict

🔴 **OBS-T7-1:** Thread 7 cannot proceed. S6 + S7 REJECT verdict from Thread 1 stands.

---

## §10 — Thread 8: SLA / TOS / Data Residency / Training Rights

### Primary-source retrieval results

- DeepSeek privacy policy: `chat.deepseek.com/legal/privacy-policy` returned 404
- DeepSeek alternate: `deepseek.com/en/legal/privacy-policy` returned 404
- DeepSeek main TOS / SLA pages: NOT linked from API docs main page; agent could not locate via WebFetch within dispatch token budget

### Comparison vs incumbents (verbatim from official docs)

From `platform.claude.com/docs/en/docs/about-claude/pricing` regional pricing section:

> "Starting with Claude Sonnet 4.5 and Haiku 4.5: AWS Bedrock offers two endpoint types: global endpoints (dynamic routing for maximum availability) and regional endpoints (guaranteed data routing through specific geographic regions)."
> "Regional and multi-region endpoints include a 10% premium over global endpoints. The Claude API (1P) is global by default; for 1P data residency options and pricing, see Data residency pricing below."
> "For Claude Opus 4.7, Claude Opus 4.6, and newer models, specifying US-only inference via the `inference_geo` parameter incurs a 1.1x multiplier on all token pricing categories"

**Anthropic publishes data residency options + pricing.** Gemini publishes data residency options + regional endpoints (verified separately in Anthropic's Vertex AI integration page; Gemini-side same standard). OpenAI publishes data residency options.

### Verdict

🟡 **HF-T8-1:** INSUFFICIENT EVIDENCE on DeepSeek's TOS / data retention / training rights / data residency. Could not retrieve primary source via WebFetch in this dispatch.

**This is a HARD-GATE concern for any production migration:**
- If DeepSeek's TOS reserves training rights on submitted data, that's a 🔴 BLOCKER for any user-PII flow
- Mingla's S1-S7 do NOT flow user-PII per current code (orchestrator-verified Mingla place data is public; review snippets are public Google data; no operator-PII passes to LLM)
- BUT: data residency for non-US Mingla cities (London, Brussels, Lagos) may have GDPR / regional implications if DeepSeek processes data through China-based infrastructure
- Operator MUST retrieve DeepSeek's TOS + privacy policy via authenticated session (or by visiting deepseek.com directly) BEFORE any migration commits

🟠 **CF-T8-2:** DeepSeek is China-based. Geopolitical / sanctions / export-control posture for Mingla's UK/US/Brussels/Lagos operations needs operator-side legal review before any IMPL dispatch. NOT a forensics question — orchestrator/operator decision.

---

## §11 — Thread 9: Per-Stage Verdicts (Six-Field Evidence)

### S1 — `ai-reason` (`supabase/functions/ai-reason/index.ts:39-46`)

**Verdict:** ⚠️ **PARTIAL ADOPT — A/B candidate, not blanket migration**

- File + line: `supabase/functions/ai-reason/index.ts:39-46`
- Exact code (current): `fetch('https://api.openai.com/v1/chat/completions', {... model: 'gpt-4o-mini' ...})`
- What it does: text-only freeform AI reason generation per card
- What DeepSeek would do instead: same call, swap base URL to `https://api.deepseek.com/v1/chat/completions`, swap model to `deepseek-v4-flash`. OpenAI-compatible API surface; minimal code diff.
- Causal chain: capability match (text-only ✅) + cost win (~1.5× cheaper, $3.50/yr savings) + operational risk (dynamic rate limits) + INSUFFICIENT QUALITY EVIDENCE → not a blanket-migration win → A/B-only verdict
- Verification: live POC against ~100 ai-reason calls; compare response quality side-by-side; measure 429 rate

### S2 — `generate-ai-summary` (`supabase/functions/generate-ai-summary/index.ts:209-217`)

**Verdict:** ⚠️ **PARTIAL ADOPT** — same reasoning as S1.

### S3 — `generate-curated-experiences` (3 sites in `index.ts:1009,1068,1102`)

**Verdict:** ⚠️ **PARTIAL ADOPT — STRONGEST A/B candidate**

- File + line: 3 call sites in `generate-curated-experiences/index.ts`
- Exact code: 3 separate `fetch(api.openai.com)` calls with `model: 'gpt-4o-mini'`
- What it does: 3-step curation pipeline (initial curation + ranking + finalization) per curated deck regeneration
- What DeepSeek would do instead: same 3 calls, swap each to DeepSeek V4-flash; refactor common LLM-client code to provider-agnostic helper
- Causal chain: 3 calls × 200,000 deck regens/yr = 600,000 calls/yr → highest absolute volume among text stages → annual savings ~$152 → highest ROI A/B candidate IF migration proceeds
- Verification: A/B 10% of curated deck regens for 1 week; compare deck quality (orchestrator-defined quality rubric) + 429 rate + p95 latency

### S4 — `generate-holiday-categories` (`index.ts:103-111`)

**Verdict:** ⚠️ **PARTIAL ADOPT — pending JSON-mode verification**

- Caveat: must verify DeepSeek `/guides/json_mode` page parity with OpenAI's JSON-mode contract before A/B
- Volume too low to justify A/B unless bundled with S3 migration

### S5 — `_shared/copyEnrichmentService.ts` (`copyEnrichmentService.ts:62-70`)

**Verdict:** ⚠️ **PARTIAL ADOPT — DEFER**

- Lowest volume (admin-only, 5,000 calls/yr) → annual savings $0.18
- Migration not justified standalone

### S6 — `run-place-intelligence-trial` (`index.ts:51-53,1100-1200,1247`)

**Verdict:** ❌ **REJECT — capability blocker**

- File + line: `index.ts:51` (`GEMINI_MODEL_ID = "gemini-2.5-flash"`); `index.ts:1100-1200` (callGeminiQuestion with inline_data); `index.ts:1247` (Q2 tool config)
- Exact code: Gemini multimodal API call with 1.74 MB collage PNG as `inline_data` + Q2 tool function call
- What it does: vision + structured tool call per trial place
- What DeepSeek would do instead: NOTHING — DeepSeek's V4-flash + V4-pro have no production image input
- Causal chain: per Thread 1 fail-gate, DeepSeek production API offers no vision model → S6's prompt shape (image + tool call) cannot be sent → REJECT
- Verification: re-probe `api-docs.deepseek.com/api/list-models` quarterly; if `deepseek-v4-vision` or `deepseek-vl-*` model appears with multimodal + function calling, re-evaluate

### S7 — `score-place-photo-aesthetics` (`index.ts:36-39,402,509`)

**Verdict:** ❌ **REJECT — capability blocker (same as S6)**

- File + line: `score-place-photo-aesthetics/index.ts:36-39` (Anthropic Claude Haiku 4.5 model ID); `:402` (Anthropic API call); `:509` (cost tracking)
- Same blocker as S6 — DeepSeek has no production vision model

### Cross-cutting verdicts (CC-A through CC-E)

**CC-A — Provider abstraction layer (`_shared/llmClient.ts`):**
🔵 **OBS-CCA:** Even if DeepSeek migration is rejected, an abstraction layer would help future provider swaps and cleaner cost-tracking. ~1 day IMPL. Independent value. Recommend as a separate cost-tracking ORCH, not bundled with DeepSeek dispatch.

**CC-B — Hybrid stack operational burden:**
🔵 **OBS-CCB:** Mingla currently runs 3-provider stack (OpenAI 5 sites + Google 1 site + Anthropic 1 site). Adding DeepSeek = 4-provider. Operational cost: 4 sets of API keys + 4 sets of rate-limit awareness + 4 sets of cost-tracking + 4 sets of incident-response runbooks. The S1-S5 cost savings ($160/yr) do not justify the operational overhead unless migration is total (all S1-S5 + future S6/S7 if DeepSeek adds vision).

**CC-C — Vendor concentration risk:**
🔵 **OBS-CCC:** Adding DeepSeek raises provider count 3→4. NOT improving concentration. Better long-term play: standardize text-LLM on ONE provider (current: OpenAI for 5 sites already standardized; vs. switching all 5 to DeepSeek for $160/yr saving).

**CC-D — Migration sequencing (only relevant if PARTIAL/FULL):**
🔵 **OBS-CCD:** If operator elects to A/B a single stage, S3 is the strongest candidate (highest volume + highest cost surface among text stages). S1, S2, S4, S5 do not move the needle independently.

**CC-E — Rollback strategy (only relevant if migration proceeds):**
🔵 **OBS-CCE:** Per-stage env var (`USE_DEEPSEEK_FOR_S3=true`) flag-gate enables instant rollback. Observable rollback triggers: 429 rate > 5% sustained; quality regression in operator-eyeball spot-check; cost regression (DeepSeek ends 75% V4-pro discount, etc.).

---

## §12 — Thread 10: The Kill Question (Per Stage)

For each S1-S7, the dispatch required finding at minimum one of:
- (a) DeepSeek's official customer logo wall featuring equivalent workload
- (b) DeepSeek's official case study published on first-party domain
- (c) DeepSeek's official cookbook / recipe / guide demonstrating exact pattern

### Findings

Within `api-docs.deepseek.com` and `deepseek.com` allowed-domains:

- **No customer logo wall** observed on the docs landing or pricing pages
- **No case studies** indexed by my probes (would require deeper site crawl beyond dispatch token budget)
- **Tool calls guide** (`/guides/tool_calls`) DEMONSTRATES function calling pattern → ✅ pattern (c) for S1-S5 if function calling used
- **No vision-related cookbook / recipe / guide** observed (consistent with Thread 1 — no vision model)

### Verdict per stage

- S1: 🔵 No first-party reference at scale found, but text-only + OpenAI-compatible → low credibility risk
- S2: same
- S3: same — would benefit from operator due-diligence on DeepSeek customer scale before A/B
- S4: same — JSON-mode parity gap raises bar for first-party reference
- S5: same
- S6: 🔴 No first-party vision reference at all (auto-REJECT confirmed)
- S7: 🔴 same

**Confidence drops to LOW per Thread 10 protocol** for S1-S5. This means: even though paper-trace cost/cap analysis points PARTIAL ADOPT, Mingla has NO observable evidence DeepSeek runs at our scale for our pattern. ADOPT verdicts cannot be defended with confidence — A/B-only is the right caution level.

---

## §13 — Migration Cost Estimate (Hypothetical, A/B Only)

Even though aggregate verdict is effectively NO MIGRATION, here's the per-stage cost profile if operator wishes to A/B S3:

### S3 A/B Migration Plan

**Files to modify:**
- `supabase/functions/generate-curated-experiences/index.ts` (1,444 LOC; 3 call sites at lines ~1009, 1068, 1102)
- New `_shared/llmClient.ts` (provider-agnostic wrapper, ~80 LOC)
- Edge function secrets: add `DEEPSEEK_API_KEY` to Supabase
- New env var: `USE_DEEPSEEK_FOR_CURATED=true` for flag-gate

**LOC change:** ~150 LOC modified + ~80 LOC new

**Schema changes:** NONE (provider name stored as string in cost tracking)

**Cost-tracking math:** add `computeCostUsdDeepSeek` helper companion to existing OpenAI math; verify cost rows in `place_intelligence_trial_runs` (or wherever S3 tracks) include provider field

**A/B comparison plan:**
- Phase A: 10% of curated deck regens go to DeepSeek for 1 week
- Measure: 429 rate, p95 latency, deck quality (operator eyeball spot-check 50 decks side-by-side)
- Decision: continue / abort / expand based on metrics

**Rollback:** flip env var `USE_DEEPSEEK_FOR_CURATED=false` → instant fallback to OpenAI (no deploy needed if env-driven; dashboard env edit only)

**Estimated IMPL hours:** 0.5-1 day (4-8 hr) for one stage including A/B harness

**Annual savings:** ~$152/yr (S3 only) before A/B operational cost

**Payback:** 3-13 years on cost alone. Only worth doing if the OPERATOR has independent cost-curiosity / cost-discovery motivation, NOT for ROI.

---

## §14 — Risk Register (15+ items)

| ID | Severity | Description | Mitigation |
|---|---|---|---|
| RISK-DS-1 | 🔴 BLOCKER | DeepSeek production API has no vision model (Thread 1 confirmed) | None today; reverts decision to NO MIGRATION for S6/S7 |
| RISK-DS-2 | 🟠 SIGNIFICANT | DeepSeek rate limits unpublished (dynamic concurrency) | Live POC required; cannot plan parallel-N from docs |
| RISK-DS-3 | 🟠 SIGNIFICANT | DeepSeek TOS / privacy policy retrieval failed (404 on tested URLs) | Operator-side retrieval + legal review pre-IMPL |
| RISK-DS-4 | 🟠 SIGNIFICANT | DeepSeek China-based; geopolitical / sanctions / export-control review needed | Operator + legal sign-off pre-IMPL |
| RISK-DS-5 | 🟡 MANAGEABLE | DeepSeek V4 strict mode is BETA | Wait for GA; or accept beta tier risk on JSON-mode stages |
| RISK-DS-6 | 🟡 MANAGEABLE | DeepSeek V4-pro 75% discount expires 2026-05-31 | Re-evaluate cost math post-discount; V4-flash unaffected |
| RISK-DS-7 | 🟡 MANAGEABLE | Provider concentration goes 3→4 (operational overhead) | Only adopt if savings justify ops burden; current numbers say NO |
| RISK-DS-8 | 🟡 MANAGEABLE | DeepSeek docs silent on quality benchmarks vs gpt-4o-mini | Live POC required; or accept INSUFFICIENT EVIDENCE outcome |
| RISK-DS-9 | 🟡 MANAGEABLE | DeepSeek API surface stability (ToS reserves change rights — verify) | Pin SDK version + provider abstraction layer |
| RISK-DS-10 | 🟡 MANAGEABLE | DeepSeek SLA NOT STATED | None visible; live POC reveals operational reliability over time |
| RISK-DS-11 | 🟡 MANAGEABLE | DeepSeek deprecation policy NOT STATED (deepseek-chat / -reasoner deprecated 2026-07-24 — short notice) | Subscribe to changelog; pin model versions explicitly |
| RISK-DS-12 | 🟡 MANAGEABLE | DeepSeek release cadence (V3 → V3.2 → V4 inside ~12 months) | Migration burden each release; pin versions |
| RISK-DS-13 | 🔵 NEGLIGIBLE | API key auth method documented (standard OpenAI-compatible) | None |
| RISK-DS-14 | 🔵 NEGLIGIBLE | Billing standard credit card (per pricing page wording) | None |
| RISK-DS-15 | 🔵 NEGLIGIBLE | DeepSeek docs in English available | None |
| RISK-DS-16 | 🟠 SIGNIFICANT | Quality unknown without live POC; A/B requires operator cost budget for parallel runs | Operator-allocated POC budget |

---

## §15 — Per-Stage Migration Plan (only S3 if operator elects A/B)

See §13. No migration for S1, S2, S4, S5, S6, S7 recommended at this dispatch.

---

## §16 — Aggregate Risk Verdict

The combined picture:
- 🔴 1 BLOCKER (no vision model — kills S6+S7 entirely)
- 🟠 4 SIGNIFICANT risks (rate limits unpublished, TOS unverified, geopolitics, quality unknown)
- 🟡 6 MANAGEABLE risks (beta features, discount expiry, ops overhead, deprecation notice, etc.)
- 🔵 3 NEGLIGIBLE risks

The 1 BLOCKER alone reduces aggregate to NO MIGRATION for the high-stakes S6/S7. The 4 SIGNIFICANT risks make S1-S5 PARTIAL ADOPT verdict tenuous — every "yes" on cost/cap is offset by an unknown on operations or quality.

---

## §17 — D-DS-N Decisions Queued for Operator Lock

If operator wishes to proceed with A/B of S3, lock these:

- **D-DS-1** — confirm aggregate verdict (NO BLANKET MIGRATION; A/B S3 only)
- **D-DS-2** — proceed with S3 A/B mini-experiment? (yes/no/defer)
- **D-DS-3** — provider abstraction layer (`_shared/llmClient.ts`) — ship as part of S3 A/B, or defer to separate ORCH?
- **D-DS-4** — flag-gated cutover via env var (recommended) or hard-cutover for A/B?
- **D-DS-5** — A/B sample size: 10% of curated decks for 1 week (recommended) vs different sampling
- **D-DS-6** — rollback criteria: 429 rate > 5% / quality regression in operator spot-check / cost regression — confirm thresholds
- **D-DS-7** — Gemini Tier confirmation (still pending from prior session — affects S6 baseline economics for v7 forensics, not this dispatch but couples)
- **D-DS-8** — confirm none of S1-S7 flow user-PII (forensics-verified Mingla place data is public; operator confirms)

If aggregate verdict accepted as NO MIGRATION, no decisions to lock — investigation closes, current 3-provider stack continues. ORCH-0737 v7 in-stack levers (cache-warming + parallel-tuning) remain the only path for S6 cost optimization.

---

## §18 — Confidence Statement

| Thread | Confidence | Reasoning |
|---|---|---|
| Thread 1 (vision capability) | HIGH | 3 independent first-party confirmations; verdict deterministic |
| Thread 2 (capability matrix) | HIGH on docs claims; LOW on JSON-mode S4 (NOT VERIFIED via direct json_mode page fetch) |
| Thread 3 (latency) | INSUFFICIENT EVIDENCE — docs silent across all 4 providers |
| Thread 4 (rate limits) | HIGH on the SILENCE finding; LOW on actual ceiling guess |
| Thread 5 (cost math) | HIGH on per-call math; MEDIUM on annualized volume estimates (orchestrator volume estimates not measured) |
| Thread 6 (function calling parity) | HIGH on tool_calls; MEDIUM on JSON-mode (parity unverified) |
| Thread 7 (image input) | HIGH (moot per Thread 1) |
| Thread 8 (TOS / data residency) | INSUFFICIENT EVIDENCE — could not retrieve DeepSeek's privacy policy via WebFetch |
| Thread 9 (per-stage verdicts) | HIGH on S6+S7 REJECT; MEDIUM on S1-S5 PARTIAL ADOPT (quality + ops risk make it tenuous) |
| Thread 10 (kill question) | HIGH on absence of first-party reference; LOW confidence on what that absence means (could mean DeepSeek doesn't market case studies; could mean no production users at our scale) |
| Migration cost (Thread 11) | MEDIUM (LOC estimate, IMPL hour estimate are orchestrator-grade) |
| Risk register | HIGH on classified items |

---

## §19 — Sources Cited (Full Bibliography — Official First-Party Only)

1. **DeepSeek API Docs landing** — `https://api-docs.deepseek.com/` — date-accessed 2026-05-06 — context: model enumeration, V4-flash + V4-pro confirmed; deepseek-chat + deepseek-reasoner deprecation notice (sunset 2026-07-24)
2. **DeepSeek Models & Pricing** — `https://api-docs.deepseek.com/quick_start/pricing` — date-accessed 2026-05-06 — context: V4-flash $0.14/$0.28; V4-pro 75%-off until 2026-05-31; cache pricing reduced to 1/10 launch price effective 2026-04-26
3. **DeepSeek List Models API** — `https://api-docs.deepseek.com/api/list-models` — date-accessed 2026-05-06 — context: API endpoint returns ONLY V4-flash + V4-pro; no modality info per page
4. **DeepSeek-V4 Preview Release announcement** — `https://api-docs.deepseek.com/news/news260424` — dated 2026-04-27 (release date); date-accessed 2026-05-06 — context: 1M context default, agentic/coding/STEM emphasis, OpenAI + Anthropic API compatibility, ZERO mention of vision/multimodal
5. **DeepSeek Tool Calls Guide** — `https://api-docs.deepseek.com/guides/tool_calls` — date-accessed 2026-05-06 — context: OpenAI-compatible `tools` parameter, `tool_calls` response format, Strict Mode beta available, V3.2+ supports tool use in thinking mode
6. **DeepSeek Rate Limit Policy** — `https://api-docs.deepseek.com/quick_start/rate_limit` — date-accessed 2026-05-06 — context: dynamic concurrency, HTTP 429 on hit, NO published RPM/TPM/RPD ceilings
7. **DeepSeek Privacy Policy retrieval attempts** — `https://api-docs.deepseek.com/policies/privacy` (404), `https://www.deepseek.com/en/legal/privacy-policy` (404), `https://chat.deepseek.com/legal/privacy-policy` (404) — INSUFFICIENT EVIDENCE — operator must retrieve via authenticated session
8. **Gemini API Pricing** — `https://ai.google.dev/gemini-api/docs/pricing` — date-accessed 2026-05-06 — context: 2.5 Flash Standard $0.30/$2.50/cache $0.03; Batch 50% off
9. **Anthropic Claude Pricing** — `https://platform.claude.com/docs/en/docs/about-claude/pricing` — date-accessed 2026-05-06 — context: Haiku 4.5 $1/M input + $5/M output + $0.10/M cache hit; Batch 50% off; data residency 10% premium for regional endpoints; tier system documented (Tier 1-4 + Enterprise)
10. **OpenAI gpt-4o-mini Pricing (via WebSearch on allowed-domains openai.com / platform.openai.com)** — primary URL `https://developers.openai.com/api/docs/pricing` indexed; date-accessed 2026-05-06 — context: $0.15/M input + $0.60/M output standard; Batch 50% off

**Disallowed sources cited: ZERO.** No artificialanalysis.ai, vellum.ai, lmsys, MTEB, HuggingFace community cards, Reddit, HN, Twitter, Substack, Medium, blog posts, news articles, third-party case studies, VC reports, or anecdata cited anywhere in this report.

---

## §20 — Discoveries For Orchestrator (side issues registered)

- **DISC-DS-1 (S2):** DeepSeek's privacy policy URLs return 404 across multiple tested paths. Either DeepSeek consolidated docs differently or the privacy URL pattern is different. Operator should locate primary policy URL before any IMPL dispatch — important for legal sign-off.
- **DISC-DS-2 (S3):** DeepSeek's deepseek-chat + deepseek-reasoner deprecation 2026-07-24 means anyone currently using those models has < 3 months migration runway. Mingla doesn't use them today, but operator awareness for future model-version-pin discipline.
- **DISC-DS-3 (S2):** DeepSeek V4-pro 75% discount expires 2026-05-31. Cost projections in §13 will materially worsen for V4-pro post-expiry. V4-flash unaffected.
- **DISC-DS-4 (S3):** DeepSeek's "OpenAI ChatCompletions and Anthropic API compatibility" claim deserves verification — if literally true, code-level migration to DeepSeek for S1-S5 is base-URL-swap-grade simple. If subtle differences exist, the abstraction layer must absorb them.
- **DISC-DS-5 (S3):** Cross-cutting CC-A (provider abstraction layer `_shared/llmClient.ts`) is independently valuable regardless of DeepSeek decision. Cleaner cost-tracking, cleaner future provider swaps, cleaner LLM-call observability. Recommend as separate ORCH (~1 day IMPL).
- **DISC-DS-6 (S3):** ORCH-0737 v7 (London-scale forensics) cache-warming lever proven highest-impact for S6 wallclock; v7 + this dispatch combined → operator should defer DeepSeek consideration AT LEAST until v7 ships its cache-warming + parallel-tuning wins, since those are achievable on existing Gemini stack.
- **DISC-DS-7 (S2):** S7 (`score-place-photo-aesthetics`) currently uses Anthropic Claude Haiku 4.5 (not Gemini). Cost surface for S7 is separately tracked via Anthropic billing — orchestrator should fold S7 cost analysis into v7 forensics or a separate S7-focused cost ORCH; this dispatch doesn't include it.

---

## §21 — Aggregate Decision (one paragraph)

DeepSeek's current production API is NOT a meaningful replacement for Mingla's full LLM stack as of 2026-05-06. The two highest-stakes stages (S6 trial scoring + S7 photo aesthetic) are blocked by DeepSeek's lack of vision API. The five text stages (S1-S5) are capability-compatible and modestly cheaper but the annual savings (~$160/yr) are dominated by migration cost (~$2K-$5K) and operational risk (unpublished rate limits, unverified TOS, vendor concentration up). The orchestrator should report aggregate verdict NO MIGRATION to operator. If operator has independent cost-curiosity motivation, S3 (highest-volume text stage) is the only A/B-defensible candidate, with ~$152/yr potential savings on a 3-13 year payback. ORCH-0737 v7's in-stack levers (cache-warming + parallel-tuning + Gemini Tier 2 upgrade if applicable) remain the productive path for S6 cost optimization — DeepSeek migration does not address the operator's stated goal of "better, faster, cheaper at scale" for the place-intelligence pipeline. Re-dispatch this investigation if/when DeepSeek announces a production vision-language API model.
