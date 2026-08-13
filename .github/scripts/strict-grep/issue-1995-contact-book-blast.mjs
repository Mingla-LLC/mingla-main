#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const files = {
  migration:
    "supabase/migrations/20270401001995_issue_1995_contact_book_blast.sql",
  send: "supabase/functions/marketing-send/index.ts",
  audience: "supabase/functions/_shared/marketingAudience.ts",
  quote: "supabase/functions/_shared/marketingBookQuote.ts",
  picker: "mingla-business/src/components/marketing/AudiencePickerSheet.tsx",
  compose: "mingla-business/app/(tabs)/marketing/campaigns/compose.tsx",
  hook: "mingla-business/src/hooks/marketing/useBookBlastPreview.ts",
  behavior:
    "mingla-business/src/components/marketing/__tests__/issue_1995_contact_book_blast.happy.test.tsx",
};

export function audit(base) {
  const failures = [];
  const read = (key) => {
    const target = path.join(base, files[key]);
    if (!fs.existsSync(target)) {
      failures.push(`${files[key]} missing`);
      return "";
    }
    return fs.readFileSync(target, "utf8");
  };
  const m = read("migration"),
    s = read("send"),
    a = read("audience");
  const q = read("quote"),
    p = read("picker"),
    c = read("compose");
  const h = read("hook"),
    b = read("behavior");
  for (const needle of [
    "brand_book_blast_v1",
    "marketing_book_send_executions",
    "marketing_book_send_targets",
    "biz_confirm_marketing_book_send_v1",
    "biz_marketing_book_send_audience",
  ])
    if (!m.includes(needle)) failures.push(`migration missing ${needle}`);
  if (
    !/all_brand_people[\s\S]*campaignId/.test(a) ||
    !a.includes("biz_marketing_book_send_audience")
  ) {
    failures.push("Book resolver can bypass campaign seal");
  }
  if (
    !s.includes('action === "preview_book_v1"') ||
    !s.includes('action === "confirm_book_v1"') ||
    !s.includes("BOOK_BLAST_PREVIEW_STALE")
  ) {
    failures.push("marketing-send lacks preview/confirm contract");
  }
  if (
    !s.includes("parseBookQuotedAt(body.quotedAt)") ||
    !s.includes("requestedQuotedAt")
  ) {
    failures.push("confirmation does not reproduce the preview timestamp");
  }
  if (
    !m.includes("contact_value_digest") ||
    !m.includes("'normalizedContact',x->>'normalizedContact'") ||
    !m.includes("t.contact_value_digest=encode")
  ) {
    failures.push("contact changes can redirect a sealed target");
  }
  if (
    !m.includes(
      "v_campaign.channel_payload IS DISTINCT FROM p_quote_snapshot->'content'",
    ) ||
    !q.includes("content: input.content") ||
    !q.includes("content: _content")
  ) {
    failures.push("Edge and PostgreSQL content identity can diverge");
  }
  if (
    !s.includes("dispatchConfirmedBookSend(") ||
    !s.includes("body.scheduledFor == null") ||
    !s.includes("processClaimedCampaigns")
  ) {
    failures.push("Book send-now can wait for cron instead of direct dispatch");
  }
  for (const exact of [
    'error: "BOOK_BLAST_AUDIENCE_NOT_FOUND", status: 404',
    'error: "BOOK_BLAST_FLAG_DISABLED", status: 503',
    'error: "BOOK_BLAST_FORBIDDEN", status: 403',
  ])
    if (!s.includes(exact))
      failures.push(`exact error envelope missing: ${exact}`);
  if (/estimatedCostMinor:\s*0[\s,}]/.test(q))
    failures.push("email/provider cost is fabricated as zero");
  if (
    !q.includes("rewriteMarketingSmsLinks") ||
    !q.includes("const wireBody = marketingBookSmsWireBody(") ||
    !s.includes("rewriteMarketingSmsLinks(") ||
    s.includes("function rewriteSmsLinks(")
  ) {
    failures.push("Book quote and dispatch do not share SMS wire-link semantics");
  }
  if (
    !p.includes('name: "Your Book"') ||
    p.includes(".catch(() => null)") ||
    !c.includes("bookPreviewMutation.mutateAsync") ||
    !c.includes("bookConfirmMutation.mutate") ||
    !c.includes("refreshedPreview") ||
    !c.includes("const id = await flushDraft()")
  ) {
    failures.push("Business Book review flow incomplete");
  }
  if (
    !c.includes('setIsSendNowConfirmation(result.mode !== "scheduled")') ||
    !c.includes("deferredRecipientCount={bookDeferredConfirmationCount}") ||
    !c.includes(
      "dismissDisabled={isBookAudience && bookConfirmMutation.isPending}",
    ) ||
    !b.includes("BOOK_BLAST_DISPATCH_FAILED") ||
    !b.includes("dismissOnScrimTap")
  ) {
    failures.push("Book direct confirmation can celebrate or dismiss an unproven send");
  }
  if (
    !c.includes(
      'import { useShareNetworkState } from "../../../../src/components/ui/useShareNetworkState";',
    ) ||
    !c.includes("isBookBlastFeatureReady") ||
    !h.includes("!importFlag.isFetching") ||
    !h.includes("!bookFlag.isFetching")
  ) {
    failures.push("connectivity or feature resolution does not fail closed");
  }
  if (
    !b.includes("TestRenderer.create") ||
    !b.includes("Confirm updated send") ||
    !b.includes("isFetching: true")
  ) {
    failures.push("load-bearing Business transitions are not behavior-tested");
  }
  return failures;
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "issue-1995-"));
  try {
    for (const rel of Object.values(files)) {
      const dst = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(root, rel), dst);
    }
    if (audit(tmp).length)
      throw new Error(`clean fixture failed: ${audit(tmp).join("; ")}`);
    const mutations = [
      [
        "audience",
        "biz_marketing_book_send_audience",
        "unsafe_live_people",
        "bypass campaign seal",
      ],
      [
        "migration",
        "t.contact_value_digest=encode",
        "true /* digest removed */",
        "redirect a sealed target",
      ],
      [
        "migration",
        "v_campaign.channel_payload IS DISTINCT FROM p_quote_snapshot->'content'",
        "false",
        "content identity",
      ],
      ["send", "body.scheduledFor == null", "false", "wait for cron"],
      [
        "send",
        'error: "BOOK_BLAST_AUDIENCE_NOT_FOUND", status: 404',
        'error: "BOOK_BLAST_FORBIDDEN", status: 403',
        "exact error envelope missing",
      ],
      ["hook", "!importFlag.isFetching", "true", "does not fail closed"],
      [
        "compose",
        'import { useShareNetworkState } from "../../../../src/components/ui/useShareNetworkState";',
        'import { useUnsafeNavigatorState } from "unsafe";',
        "does not fail closed",
      ],
      [
        "behavior",
        '"Confirm updated send"',
        '"Send now again"',
        "not behavior-tested",
      ],
      [
        "quote",
        "const wireBody = marketingBookSmsWireBody(",
        "const wireBody = composeSmsBody(",
        "do not share SMS wire-link semantics",
      ],
      [
        "compose",
        'setIsSendNowConfirmation(result.mode !== "scheduled")',
        "setIsSendNowConfirmation(true)",
        "can celebrate or dismiss an unproven send",
      ],
      [
        "behavior",
        '"BOOK_BLAST_DISPATCH_FAILED"',
        '"BOOK_BLAST_FAILED"',
        "can celebrate or dismiss an unproven send",
      ],
    ];
    for (const [key, from, to, expected] of mutations) {
      const target = path.join(tmp, files[key]);
      const clean = fs.readFileSync(target, "utf8");
      fs.writeFileSync(target, clean.replace(from, to));
      if (!audit(tmp).some((failure) => failure.includes(expected))) {
        throw new Error(`true mutation escaped: ${key}:${expected}`);
      }
      fs.writeFileSync(target, clean);
    }
    console.log("[issue-1995-contact-book-blast] self-test PASS (11 mutations)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const failures = audit(root);
  if (failures.length) {
    failures.forEach((failure) =>
      console.error(`[issue-1995-contact-book-blast] FAIL: ${failure}`),
    );
    process.exit(1);
  }
  console.log("[issue-1995-contact-book-blast] PASS");
}
