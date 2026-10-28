// #4137 Wave 4 — Admin Blog placement, role gates, editor reducer and link-target parity.
// MINGLA-INVARIANT: I-4137-BLOG-WRITES-VIA-RPC-ROLE-GUARDED | issue #4137 | the Blog tab follows the Support area while publisher controls remain server-authorized.
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { blogBlockReducer, convertBlogBlock } from "../lib/blogEditorState.js";
import { BLOG_CITY_TARGETS, BLOG_MARKETING_PAGE_TARGETS } from "../lib/blogLinkTargets.js";
import { communitySupportTabsForAccess } from "../lib/communitySupportAccess.js";
import { COMMUNITY_SUPPORT_TAB_CONTRACT } from "../lib/communitySupportCapabilityContract.js";
import { SUPPORT_PAGE_TABS } from "../lib/supportCommunityTabs.js";
import { AREA, SUPPORT_OPERATIONS_AREA } from "../lib/access.js";

const read = (relative: string) => Deno.readTextFile(new URL(`../${relative}`, import.meta.url));

Deno.test("#4137 Blog sits beside Email and follows the Support capability", () => {
  assertEquals(SUPPORT_PAGE_TABS.map((tab) => tab.id), ["support", "email", "blog", "team"]);
  assertEquals(COMMUNITY_SUPPORT_TAB_CONTRACT.blog.area, SUPPORT_OPERATIONS_AREA);
  assertEquals(COMMUNITY_SUPPORT_TAB_CONTRACT.blog.panel, "components/blog/BlogPanel.jsx");
  assertEquals(COMMUNITY_SUPPORT_TAB_CONTRACT.blog.functions, ["admin-blog"]);
  const support = { status: "active", role: "growth", areas: [SUPPORT_OPERATIONS_AREA] };
  const community = { status: "active", role: "growth", areas: ["community_support_community"] };
  const admin = { status: "active", role: "admin", areas: [AREA.ADMIN_CONSOLE] };
  assertEquals(communitySupportTabsForAccess(support, SUPPORT_PAGE_TABS).map((tab: { id: string }) => tab.id), ["support", "blog"]);
  assertEquals(communitySupportTabsForAccess(community, SUPPORT_PAGE_TABS), []);
  assertEquals(communitySupportTabsForAccess(admin, SUPPORT_PAGE_TABS).map((tab: { id: string }) => tab.id), ["support", "email", "blog", "team"]);
});

Deno.test("#4137 block reducer inserts, moves, removes and restores without mutation", () => {
  const a = { id: "block_a", type: "paragraph", html: "A" };
  const b = { id: "block_b", type: "paragraph", html: "B" };
  let state = { past: [], present: [a], future: [] };
  state = blogBlockReducer(state, { type: "insert", block: b, afterId: a.id });
  assertEquals(state.present.map((block: { id: string }) => block.id), ["block_a", "block_b"]);
  state = blogBlockReducer(state, { type: "move", blockId: b.id, direction: -1 });
  assertEquals(state.present.map((block: { id: string }) => block.id), ["block_b", "block_a"]);
  state = blogBlockReducer(state, { type: "remove", blockId: a.id });
  assertEquals(state.present.map((block: { id: string }) => block.id), ["block_b"]);
  state = blogBlockReducer(state, { type: "undo" });
  assertEquals(state.present.map((block: { id: string }) => block.id), ["block_b", "block_a"]);
  assertEquals(convertBlogBlock({ id: "block_c", type: "paragraph", html: "<strong>Hello</strong>" }, "heading-2"), { id: "block_c", type: "heading", level: 2, text: "Hello" });
  assertEquals(convertBlogBlock({ id: "block_c", type: "paragraph", html: "Hello" }, "numbered-list"), { id: "block_c", type: "list", ordered: true, items: ["Hello"] });
});

Deno.test("#4137 admin link targets are search-ready marketing routes", async () => {
  const registry = await read("../../mingla-marketing/lib/search/route-registry.ts");
  const core = await read("../../mingla-marketing/content/core-pages.ts");
  const cities = await read("../../mingla-marketing/content/cities/registry.ts");
  const help = await read("../../mingla-marketing/content/help/registry.ts");
  for (const target of BLOG_MARKETING_PAGE_TARGETS) {
    if (target.path.startsWith("/cities/")) {
      const slug = target.path.slice("/cities/".length);
      assertMatch(cities, new RegExp(`slug:\\s*['\"]${slug}['\"]`), target.path);
    } else if (target.path.startsWith("/help/")) {
      const slug = target.path.slice("/help/".length);
      assertMatch(help, new RegExp(`slug:\\s*['\"]${slug}['\"]`), target.path);
    } else if (target.path.startsWith("/blog/category/")) {
      assertMatch(registry, /BLOG_CATEGORY_ROUTE_CONTRACTS/, target.path);
    } else {
      assert(
        registry.includes(`pathname: '${target.path}'`) || registry.includes(`pathname: "${target.path}"`) ||
          core.includes(`pathname: '${target.path}'`) || core.includes(`pathname: "${target.path}"`),
        `${target.path} is not in the search-ready registry`,
      );
    }
  }
  assertEquals(BLOG_CITY_TARGETS.length, 10);
});

Deno.test("#4137 UI exposes the approved editor states and never client-grants publish", async () => {
  const editor = await read("components/blog/BlogEditor.jsx");
  const service = await read("services/blogService.js");
  assertMatch(editor, /Someone else changed this post\. Reload/);
  assertMatch(editor, /1\.2|scheduleBlogAutosave/);
  assertMatch(editor, /permissions\.can_publish/);
  assertMatch(service, /p_expected_revision/);
  assertMatch(service, /"admin-blog"/);
  assertEquals(/service_role|SUPABASE_SERVICE_ROLE/.test(service), false);
});
