#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0897-A [Group Chat follow-up polish] structural regression check.
 *
 * Asserts the 5 surgical fixes shipped in commits c6ca00bd → bc345463 stay
 * structurally present:
 *
 *   T-A01 — events JOIN by title (not name) in getEventGroupChat — events.title
 *           is the live column (events.name does not exist; verified against
 *           supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:7796)
 *   T-A02 — EventGroupConversation type exposes event_name (live event title,
 *           not stale conversation.name snapshot)
 *   T-A03 — GroupChatPanel header reads event_name (not name) — auto-rename-safe
 *   T-A04 — Composer wrapped in KeyboardAvoidingView from react-native-keyboard-controller
 *           (library-recommended sticky-composer-above-keyboard pattern;
 *           inline orch-strict-grep-allow orch-0892 comment documents intent)
 *   T-A05 — Composer uses useSafeAreaInsets + insets.bottom + spacing.lg for
 *           floating bottom padding; borderTopWidth + borderTopColor dropped
 *           (kills the backdrop line per operator screenshot)
 *   T-A06 — Image attachment send path: postPlannerMessage accepts optional
 *           attachment, uploads to messages bucket at <conv_id>/<userId>_<ts>.<ext>,
 *           inserts message row with message_type='image' + file_url + file_name + file_size
 *   T-A07 — Image render branch: GroupChatPanel renders <Image> when
 *           message.message_type === 'image' && file_url !== null
 *   T-A08 — Caption-with-image: composer placeholder swaps to "Add a caption (optional)"
 *           when attachment is set
 *   T-A09 — EventGroupMessage type extended with message_type + file_url + file_name + file_size
 *   T-A10 — listMessages SELECT includes the new media columns
 *
 * FAILS-ON-REVERT key: T-A03 (event_name in header) — reverting commit c6ca00bd
 * flips header back to chat.conversation?.name (the stale snapshot) and this
 * check fails.
 *
 * Status: structural-only check authored by orchestrator at CLOSE time as
 * Step 0.5 deferred-tester replacement. Operator-accepted deferral cites
 * follow-up ORCH-0897-A-TEST for proper Claude mingla-tester adversarial
 * regression test. See CLOSE banner.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch {
    return null;
  }
};

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

const groupChatService = read("mingla-business/src/services/groupChatService.ts");
const groupChatPanel = read("mingla-business/src/components/groupChat/GroupChatPanel.tsx");
const useEventGroupChat = read("mingla-business/src/hooks/useEventGroupChat.ts");

check(
  "T-A01 getEventGroupChat JOINs events!event_id(title) — not events.name (which doesn't exist)",
  groupChatService !== null &&
    /events!event_id\(title\)/.test(groupChatService) &&
    !/events!event_id\(name\)/.test(groupChatService),
  "Service must JOIN by title; events.name is invented and triggers SQLSTATE 42703 (verified against baseline migration:7796).",
);

check(
  "T-A02 EventGroupConversation type exposes event_name field",
  groupChatService !== null &&
    /event_name:\s*string/.test(groupChatService) &&
    /interface EventGroupConversation/.test(groupChatService),
  "Type must surface event_name so the header can read live title without depending on the trigger-time conversation.name snapshot.",
);

check(
  "T-A03 [FAILS-ON-REVERT KEY] GroupChatPanel header reads event_name (live), not name (stale)",
  groupChatPanel !== null &&
    /chat\.conversation\?\.event_name\s*\?\?\s*"Group chat"/.test(groupChatPanel),
  "Header must use event_name — reverting to conversation.name shows the stale 'Untitled draft' snapshot per operator screenshot.",
);

check(
  "T-A04 Composer wrapped in KeyboardAvoidingView from react-native-keyboard-controller",
  groupChatPanel !== null &&
    /import\s*\{\s*KeyboardAvoidingView\s*\}\s*from\s*["']react-native-keyboard-controller["']/.test(groupChatPanel) &&
    /<KeyboardAvoidingView\s+behavior="padding"/.test(groupChatPanel) &&
    /orch-strict-grep-allow orch-0892/.test(groupChatPanel),
  "KAV from the canonical Mingla keyboard library lifts composer above keyboard; orch-strict-grep-allow comment documents the I-PROPOSED-KEYBOARD-LIBRARY-ONLY allowance.",
);

check(
  "T-A05 Composer floats: uses insets.bottom + spacing.lg for paddingBottom; top border dropped",
  groupChatPanel !== null &&
    /useSafeAreaInsets/.test(groupChatPanel) &&
    /Math\.max\(insets\.bottom,\s*0\)\s*\+\s*spacing\.lg/.test(groupChatPanel) &&
    !/borderTopWidth:\s*1[\s\S]{0,200}borderTopColor:\s*glass\.border\.profileBase[\s\S]{0,400}composer:/.test(groupChatPanel),
  "Composer must apply safe-area + breathing room and have NO top border (the 'backdrop' line per operator screenshot).",
);

check(
  "T-A06 postPlannerMessage accepts optional attachment + uploads to messages bucket",
  groupChatService !== null &&
    /attachment\?:\s*PlannerImageAttachment\s*\|\s*null/.test(groupChatService) &&
    /supabase\.storage\s*\n?\s*\.from\(["']messages["']\)\s*\n?\s*\.upload\(filePath,\s*formData/.test(groupChatService) &&
    /\$\{conversationId\}\/\$\{userId\}_\$\{Date\.now\(\)\}/.test(groupChatService) &&
    /message_type:\s*messageType/.test(groupChatService),
  "Service must accept attachment + upload to messages bucket at <conv_id>/<userId>_<ts>.<ext> path (storage RLS path format).",
);

check(
  "T-A07 GroupChatPanel renders <Image> when message_type === 'image' && file_url !== null",
  groupChatPanel !== null &&
    /message\.message_type === "image"/.test(groupChatPanel) &&
    /<Image[\s\S]{0,200}source=\{\{\s*uri:\s*message\.file_url\s*\?\?\s*undefined\s*\}\}/.test(groupChatPanel),
  "Image messages must render via React Native <Image> sourced from message.file_url.",
);

check(
  "T-A08 Composer placeholder swaps to caption mode when attachment is set",
  groupChatPanel !== null &&
    /placeholder=\{attachment \? "Add a caption \(optional\)" : "Write a reply"\}/.test(groupChatPanel),
  "Caption-with-image UX requires placeholder swap so the planner knows the field is optional.",
);

check(
  "T-A09 EventGroupMessage type extended with media columns",
  groupChatService !== null &&
    /message_type:\s*string/.test(groupChatService) &&
    /file_url:\s*string\s*\|\s*null/.test(groupChatService) &&
    /file_name:\s*string\s*\|\s*null/.test(groupChatService) &&
    /file_size:\s*number\s*\|\s*null/.test(groupChatService),
  "Render path needs these 4 fields to discriminate text vs image and source the asset.",
);

check(
  "T-A10 listMessages SELECT includes media columns",
  groupChatService !== null &&
    /\.select\([\s\S]{0,200}message_type[\s\S]{0,200}file_url[\s\S]{0,200}file_name[\s\S]{0,200}file_size/.test(groupChatService),
  "Service SELECT must fetch the new columns or render falls back to text-only.",
);

check(
  "T-A11 useEventGroupChat hook passes attachment through to postPlannerMessage",
  useEventGroupChat !== null &&
    /attachment\?:\s*PlannerImageAttachment\s*\|\s*null/.test(useEventGroupChat) &&
    /postPlannerMessage\(conversation\.id,\s*content,\s*attachment\)/.test(useEventGroupChat),
  "Hook must thread the attachment through to the service call.",
);

const failed = checks.filter((c) => !c.pass);
for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"} ${c.name}`);
  if (!c.pass) console.log(`     ${c.detail}`);
}
console.log("");
if (failed.length === 0) {
  console.log(`ORCH-0897-A regression check passed: ${checks.length}/${checks.length}`);
  process.exit(0);
} else {
  console.log(`ORCH-0897-A regression check FAILED: ${failed.length} failure(s) out of ${checks.length}`);
  process.exit(1);
}
