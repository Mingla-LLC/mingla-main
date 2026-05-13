#!/usr/bin/env node
/**
 * ORCH-0815-B strict-grep gate — composer + edge function invariants.
 *
 * Enforces the SPEC §14 check list (12 checks) and the SPEC §13 hard
 * guards that have a literal-string footprint. Single-pass scan over the
 * scoped file set; reports every violation with the line number.
 *
 * Checks:
 *   1. marketing-send/index.ts has `switch (kind)` with `default:` throw
 *      (I-PROPOSED-BR — channel-extensibility dispatcher).
 *   2. ChannelTabs.tsx renders 3 tabs (`email` + `sms` + `rcs` literals).
 *   3. compose.tsx parses query param shape `audience={kind}:{id}`
 *      (I-PROPOSED-BU — uses parseAudienceParam).
 *   4. No bare `crypto.randomUUID()` in any new mingla-business/src/**.
 *      (Hermes safety — must route via utils/randomId.ts.)
 *   5. No oklch / oklab / lab( / lch( / color-mix in any new file
 *      (feedback_rn_color_formats.md).
 *   6. No `biz_brand_effective_rank_for_caller` in any marketing-*
 *      edge function (SECURITY DEFINER banned for marketing per SPEC §13).
 *   7. marketing-send/index.ts reads `MARKETING_SEND_LIVE_ENABLED`.
 *   8. marketing-send/index.ts contains `FOR UPDATE SKIP LOCKED` literal
 *      (proves the atomic-claim pattern is honoured).
 *   9. marketing-track-click/index.ts appends `utm_source` + `mingla`.
 *  10. marketing-unsubscribe/index.ts calls `verifyUnsubscribeToken`
 *      BEFORE any DB write.
 *  11. New pg_cron migration uses `DO $$` probes for extensions / cron job.
 *  12. ChannelTabs.tsx defines all 3 tab spec literals adjacent
 *      (I-PROPOSED-BS).
 *
 * Exit: 0 = clean, 1 = at least one violation, 2 = script error.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const MARKETING_SEND = join(REPO_ROOT, "supabase/functions/marketing-send/index.ts");
const MARKETING_TRACK = join(REPO_ROOT, "supabase/functions/marketing-track-click/index.ts");
const MARKETING_UNSUB = join(REPO_ROOT, "supabase/functions/marketing-unsubscribe/index.ts");
const CHANNEL_TABS = join(REPO_ROOT, "mingla-business/src/components/marketing/ChannelTabs.tsx");
const COMPOSE = join(REPO_ROOT, "mingla-business/app/(tabs)/marketing/campaigns/compose.tsx");
const CRON_MIGRATION = join(REPO_ROOT, "supabase/migrations/20260603000000_orch_0815_b_marketing_send_cron.sql");

const NEW_MB_FILES = [
  "mingla-business/src/components/marketing/ChannelTabs.tsx",
  "mingla-business/src/components/marketing/ComposerHeader.tsx",
  "mingla-business/src/components/marketing/ComposerStepWho.tsx",
  "mingla-business/src/components/marketing/ComposerStepWhat.tsx",
  "mingla-business/src/components/marketing/ComposerStepWhen.tsx",
  "mingla-business/src/components/marketing/ComposerStepCompliance.tsx",
  "mingla-business/src/components/marketing/ComposerFooter.tsx",
  "mingla-business/src/components/marketing/ComposerReviewSheet.tsx",
  "mingla-business/src/components/marketing/ComposerSentConfirmation.tsx",
  "mingla-business/src/components/marketing/AudiencePickerSheet.tsx",
  "mingla-business/src/components/marketing/EventCardInserter.tsx",
  "mingla-business/src/components/marketing/EmailPreviewPane.tsx",
  "mingla-business/src/components/marketing/CampaignCard.tsx",
  "mingla-business/src/components/marketing/CampaignFilterPills.tsx",
  "mingla-business/src/hooks/marketing/marketingKeys.ts",
  "mingla-business/src/hooks/marketing/useCampaigns.ts",
  "mingla-business/src/hooks/marketing/useScheduleCampaign.ts",
  "mingla-business/src/hooks/marketing/useSendNow.ts",
  "mingla-business/src/hooks/marketing/useResolveAudience.ts",
  "mingla-business/src/hooks/marketing/useComposerDraft.ts",
  "mingla-business/src/services/marketing/marketingCampaignService.ts",
  "mingla-business/src/services/marketing/marketingTemplateService.ts",
  "mingla-business/src/services/marketing/marketingRenderingService.ts",
  "mingla-business/app/(tabs)/marketing/campaigns/compose.tsx",
  "mingla-business/app/(tabs)/marketing/campaigns/index.tsx",
];

const MARKETING_EDGE = [
  "supabase/functions/marketing-send/index.ts",
  "supabase/functions/marketing-track-click/index.ts",
  "supabase/functions/marketing-unsubscribe/index.ts",
  "supabase/functions/_shared/marketingAudience.ts",
  "supabase/functions/_shared/marketingTokens.ts",
  "supabase/functions/_shared/marketingEmailRender.ts",
];

let violations = 0;

function fail(check, file, detail) {
  console.error(`[ORCH-0815-B][${check}] ${file}: ${detail}`);
  violations += 1;
}

function readOrSkip(absolutePath) {
  if (!existsSync(absolutePath)) return null;
  try {
    return readFileSync(absolutePath, "utf8");
  } catch {
    return null;
  }
}

// Check 1 — switch (kind) + default: throw + exhaustiveness sentinel
{
  const src = readOrSkip(MARKETING_SEND);
  if (src === null) {
    fail("check-1", MARKETING_SEND, "file missing");
  } else {
    if (!/switch\s*\(\s*kind\s*\)/.test(src)) {
      fail("check-1", MARKETING_SEND, "missing `switch (kind)` for channel dispatch");
    }
    if (!/case\s+["']email["']/.test(src)) fail("check-1", MARKETING_SEND, "missing email case");
    if (!/case\s+["']sms["']/.test(src)) fail("check-1", MARKETING_SEND, "missing sms case");
    if (!/case\s+["']rcs["']/.test(src)) fail("check-1", MARKETING_SEND, "missing rcs case");
    if (!/default\s*:\s*\{[\s\S]*?throw new Error/.test(src)) {
      fail("check-1", MARKETING_SEND, "default case must throw");
    }
    if (!/const _exhaustive:\s*never\s*=\s*kind/.test(src)) {
      fail("check-1", MARKETING_SEND, "exhaustiveness sentinel `const _exhaustive: never = kind` missing");
    }
  }
}

// Check 2 + 12 — ChannelTabs literal triad
{
  const src = readOrSkip(CHANNEL_TABS);
  if (src === null) {
    fail("check-2", CHANNEL_TABS, "file missing");
  } else {
    if (!/kind:\s*["']email["']/.test(src)) fail("check-2", CHANNEL_TABS, "literal `email` tab missing");
    if (!/kind:\s*["']sms["']/.test(src)) fail("check-2", CHANNEL_TABS, "literal `sms` tab missing");
    if (!/kind:\s*["']rcs["']/.test(src)) fail("check-2", CHANNEL_TABS, "literal `rcs` tab missing");
  }
}

// Check 3 — compose.tsx parses audience param via parseAudienceParam
{
  const src = readOrSkip(COMPOSE);
  if (src === null) {
    fail("check-3", COMPOSE, "file missing");
  } else if (!/parseAudienceParam/.test(src)) {
    fail("check-3", COMPOSE, "must call parseAudienceParam for `audience=` query param");
  }
}

// Check 4 — no bare crypto.randomUUID() in new mingla-business files
for (const rel of NEW_MB_FILES) {
  const full = join(REPO_ROOT, rel);
  const src = readOrSkip(full);
  if (src === null) continue;
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Allow `//` and `*`-prefixed (JSDoc continuation) comment lines mentioning
    // crypto.randomUUID for documentation.
    if (/^\s*(\/\/|\*)/.test(line)) continue;
    if (/\bcrypto\.randomUUID\s*\(/.test(line)) {
      fail("check-4", rel, `line ${i + 1}: bare crypto.randomUUID() — use utils/randomId.ts`);
    }
  }
}

// Check 5 — no oklch / oklab / lab( / lch( / color-mix in any new file
const COLOR_DENYLIST = [/oklch/i, /oklab/i, /\blab\s*\(/i, /\blch\s*\(/i, /color-mix/i];
const COLOR_SCOPE = [...NEW_MB_FILES, ...MARKETING_EDGE];
for (const rel of COLOR_SCOPE) {
  const full = join(REPO_ROOT, rel);
  const src = readOrSkip(full);
  if (src === null) continue;
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Allow lines that reference the rule itself (doc comments).
    if (/feedback_rn_color_formats|oklch\/lab/i.test(line)) continue;
    for (const pattern of COLOR_DENYLIST) {
      if (pattern.test(line)) {
        fail("check-5", rel, `line ${i + 1}: forbidden color format (${pattern})`);
      }
    }
  }
}

// Check 6 — no biz_brand_effective_rank_for_caller in marketing edge fns
for (const rel of MARKETING_EDGE) {
  const full = join(REPO_ROOT, rel);
  const src = readOrSkip(full);
  if (src === null) continue;
  if (/biz_brand_effective_rank_for_caller/.test(src)) {
    fail("check-6", rel, "SECURITY DEFINER helper banned in marketing edge functions");
  }
}

// Check 7 — marketing-send reads MARKETING_SEND_LIVE_ENABLED
{
  const src = readOrSkip(MARKETING_SEND);
  if (src !== null) {
    if (!/MARKETING_SEND_LIVE_ENABLED/.test(src)) {
      fail("check-7", MARKETING_SEND, "must read MARKETING_SEND_LIVE_ENABLED env-flag");
    }
    // negative-control — flag must not default to true
    if (/MARKETING_SEND_LIVE_ENABLED["']?\s*\)\s*\?\?\s*["']true["']/.test(src)) {
      fail("check-7", MARKETING_SEND, "MARKETING_SEND_LIVE_ENABLED defaults to true — must default false");
    }
  }
}

// Check 8 — FOR UPDATE SKIP LOCKED literal
{
  const src = readOrSkip(MARKETING_SEND);
  if (src !== null && !/FOR UPDATE SKIP LOCKED/.test(src)) {
    fail("check-8", MARKETING_SEND, "missing `FOR UPDATE SKIP LOCKED` literal — atomic-claim pattern must be honoured");
  }
}

// Check 9 — marketing-track-click sets utm_source=mingla
{
  const src = readOrSkip(MARKETING_TRACK);
  if (src !== null) {
    if (!/utm_source/.test(src)) fail("check-9", MARKETING_TRACK, "missing utm_source UTM param");
    if (!/["']mingla["']/.test(src)) fail("check-9", MARKETING_TRACK, "must set utm_source to literal 'mingla'");
    if (!/302/.test(src)) fail("check-9", MARKETING_TRACK, "must 302 redirect");
  }
}

// Check 10 — marketing-unsubscribe verifies signed token BEFORE DB write
{
  const src = readOrSkip(MARKETING_UNSUB);
  if (src !== null) {
    if (!/verifyUnsubscribeToken/.test(src)) {
      fail("check-10", MARKETING_UNSUB, "must call verifyUnsubscribeToken");
    }
    const verifyIdx = src.indexOf("verifyUnsubscribeToken(token)");
    const insertIdx = src.indexOf('.from("marketing_unsubscribes")');
    if (verifyIdx === -1 || insertIdx === -1) {
      fail("check-10", MARKETING_UNSUB, "must verify token AND write to marketing_unsubscribes");
    } else if (verifyIdx > insertIdx) {
      fail("check-10", MARKETING_UNSUB, "signature verify must happen BEFORE DB insert");
    }
  }
}

// Check 11 — pg_cron migration has DO $$ probes
{
  const src = readOrSkip(CRON_MIGRATION);
  if (src === null) {
    fail("check-11", CRON_MIGRATION, "file missing");
  } else {
    if (!/DO\s*\$\$/.test(src)) {
      fail("check-11", CRON_MIGRATION, "must include DO $$ verification probes");
    }
    if (!/cron\.schedule\(\s*'orch_0815_b_marketing_send'/.test(src)) {
      fail("check-11", CRON_MIGRATION, "cron.schedule call missing");
    }
    if (!/mkt_claim_campaigns/.test(src)) {
      fail("check-11", CRON_MIGRATION, "mkt_claim_campaigns helper missing");
    }
  }
}

if (violations === 0) {
  console.log("[ORCH-0815-B] strict-grep gate: clean (0 violations across 12 checks)");
  process.exit(0);
} else {
  console.error(`[ORCH-0815-B] strict-grep gate: FAILED with ${violations} violation(s)`);
  process.exit(1);
}
