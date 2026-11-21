import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const root = new URL("../", import.meta.url);
const read = (relative: string) => Deno.readTextFileSync(new URL(relative, root));

Deno.test("#3720 Admin gives scoped Support staff the Brand groups tab", () => {
  const access = read("lib/communitySupportAccess.js");
  // [TEST-MOD #4420] Community is retired (pages/SupportPage.jsx replaced the
  // shared frame); Brand groups is gated by its screen's area in lib/access.js.
  const page = read("pages/SupportPage.jsx");
  assert(!access.includes('allowed.add("brand-groups")'), "no console tab any more");
  // #4452 §7.2: Brand groups is its own Communications screen, for the same
  // Support area (lib/access.js); Community no longer draws it.
  assertStringIncludes(read("lib/access.js"), '"brand-groups": Object.freeze([SUPPORT_OPERATIONS_AREA]),');
  assertStringIncludes(read("pages/communications/BrandGroupsPage.jsx"), "<BrandGroupsPanel onCounts={publishBrandGroupWaiting} />");
  assert(!page.includes("<BrandGroupsPanel"), "Community no longer draws the panel");
});

Deno.test("#3720 Admin Brand groups use guarded RPCs and realtime read/message sync", () => {
  const service = read("services/communityService.js");
  const panel = read("components/community/BrandGroupsPanel.jsx");
  for (const rpc of [
    "issue_3720_list_brand_groups",
    "issue_3720_list_brand_group_messages",
    "issue_3720_mark_brand_group_read",
    "issue_3720_set_brand_group_watch",
    "issue_3720_send_brand_group_message",
  ]) assertStringIncludes(service, rpc);
  assertStringIncludes(panel, 'table: "messages"');
  assertStringIncludes(panel, 'table: "brand_group_reads"');
  // #4270 W7: the actions and the composer's words live in their own components.
  const thread = read("components/community/BrandGroupThread.jsx");
  const composer = read("components/community/BrandGroupComposer.jsx");
  // [TEST-MOD #4420] Send to Product became Create ticket (Product board retired).
  assertStringIncludes(thread, "Create ticket");
  assertStringIncludes(composer, "Create ticket");
  assertStringIncludes(composer, "Replying as <strong");
  assertStringIncludes(composer, "{replyingAs} · Mingla Support</strong> · the brand team gets a push");
  assertStringIncludes(panel, 'replyingAs={myName || "you"}');
});

Deno.test("#3720 Brand-message Product signals remain private RPC workflow records", () => {
  const workflow = read("services/supportProductWorkflowService.js");
  assertStringIncludes(workflow, 'input.sourceKind === "brand_group_message"');
  assertStringIncludes(workflow, '"issue_3720_create_brand_message_product_signal"');
  assertStringIncludes(workflow, '"issue_3720_link_brand_message_product_signal"');
  assert(!/github(_|\s)*(token|issue|repository|installation)/i.test(workflow));
});
