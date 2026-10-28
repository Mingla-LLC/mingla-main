import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const root = new URL("../", import.meta.url);
const read = (relative: string) => Deno.readTextFileSync(new URL(relative, root));

Deno.test("#3720 Admin gives scoped Support staff the Brand groups tab", () => {
  const access = read("lib/communitySupportAccess.js");
  const page = read("pages/CommunitySupportPage.jsx");
  assertStringIncludes(access, 'allowed.add("brand-groups")');
  // #4130 Wave 6: the tab lists live in lib/supportCommunityTabs.js.
  assertStringIncludes(read("lib/supportCommunityTabs.js"), '{ id: "brand-groups", label: "Brand groups" }');
  assertStringIncludes(page, '<BrandGroupsPanel />');
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
  assertStringIncludes(panel, "Create product signal");
  assertStringIncludes(panel, "your real staff name · Mingla Support");
});

Deno.test("#3720 Brand-message Product signals remain private RPC workflow records", () => {
  const workflow = read("services/supportProductWorkflowService.js");
  assertStringIncludes(workflow, 'input.sourceKind === "brand_group_message"');
  assertStringIncludes(workflow, '"issue_3720_create_brand_message_product_signal"');
  assertStringIncludes(workflow, '"issue_3720_link_brand_message_product_signal"');
  assert(!/github(_|\s)*(token|issue|repository|installation)/i.test(workflow));
});
