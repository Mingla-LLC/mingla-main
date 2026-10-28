import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AREA,
  COMMUNITY_OPERATIONS_AREA,
  COMMUNITY_SUPPORT_AREA,
  SUPPORT_OPERATIONS_AREA,
} from "../lib/access.js";
import {
  COMMUNITY_SUPPORT_TAB_CAPABILITY,
  communitySupportTabsForAccess,
} from "../lib/communitySupportAccess.js";
import { COMMUNITY_SUPPORT_TAB_CONTRACT } from "../lib/communitySupportCapabilityContract.js";
import { COMMUNITY_PAGE_TABS, SUPPORT_PAGE_TABS } from "../lib/supportCommunityTabs.js";

// #3988 — every Community & Support tab is shown by exactly the area whose
// server predicate also guards that tab's RPCs (I-3988-TAB-AREA-EQUALS-RPC-GUARD,
// declared in the #3988 pg17 suite). This file keeps the client half honest:
// the contract lists every RPC a panel reaches, and each tab maps to one area.

const SRC = new URL("../", import.meta.url);
const read = (relative: string) => Deno.readTextFile(new URL(relative, SRC));

type Reached = { rpcs: Set<string>; functions: Set<string> };

function callsIn(source: string, into: Reached) {
  for (const m of source.matchAll(/\.rpc\(\s*"([a-z0-9_]+)"/g)) into.rpcs.add(m[1]);
  for (const m of source.matchAll(/(?:invokeWithRefresh|functions\.invoke|invokeSupportFn)\(\s*"([a-z0-9-]+)"/g)) {
    into.functions.add(m[1]);
  }
  for (const m of source.matchAll(/TEAM_INVITE_FUNCTION\b/g)) {
    void m;
    into.functions.add("admin-team-invite");
  }
}

function exportedBody(service: string, name: string): string | null {
  const start = service.search(new RegExp(`export (?:async )?function ${name}\\(`));
  if (start < 0) return null;
  const rest = service.slice(start + 1);
  const end = rest.search(/\nexport /);
  return end < 0 ? service.slice(start) : service.slice(start, start + 1 + end);
}

/** RPCs and Edge Functions a panel reaches directly or via imported service / lib functions. */
async function reachedBy(panel: string): Promise<Reached> {
  const reached: Reached = { rpcs: new Set(), functions: new Set() };
  let source = await read(panel);
  // #4137: Blog is a component family. Walking the whole directory keeps the
  // contract accurate as editor/list/media components grow, instead of making
  // BlogPanel import implementation details it never renders itself.
  if (panel.startsWith("components/blog/")) {
    const directory = new URL("components/blog/", SRC);
    for await (const entry of Deno.readDir(directory)) {
      if (entry.isFile && entry.name.endsWith(".jsx") && entry.name !== panel.split("/").at(-1)) {
        source += `\n${await Deno.readTextFile(new URL(entry.name, directory))}`;
      }
    }
  }
  callsIn(source, reached);
  const panelDir = new URL(panel, SRC);
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]*(?:services|lib)\/[A-Za-z]+)"/g)) {
    const module = await Deno.readTextFile(new URL(`${m[2]}.js`, panelDir)).catch(() => null);
    if (module === null) continue;
    if (m[2].endsWith("/blogService")) {
      callsIn(module, reached);
      for (const rpcCall of module.matchAll(/\brpc\(\s*"([a-z0-9_]+)"/g)) reached.rpcs.add(rpcCall[1]);
      continue;
    }
    for (const name of m[1].split(",").map((part) => part.trim()).filter(Boolean)) {
      const body = exportedBody(module, name);
      if (body) callsIn(body, reached);
    }
  }
  return reached;
}

// #4130 Wave 6: the tabs are split over the Support and Community pages
// (lib/supportCommunityTabs.js, which both pages render); Overview was
// retired, so its row went with it.
Deno.test("every rendered tab has exactly one contract row, and no row is orphaned", () => {
  const tabIds = [...SUPPORT_PAGE_TABS, ...COMMUNITY_PAGE_TABS].map((tab) => tab.id);
  assert(tabIds.length >= 12, "tab list parsed");
  assertEquals(new Set(tabIds).size, tabIds.length, "no tab is on both pages");
  assertEquals([...tabIds].sort(), Object.keys(COMMUNITY_SUPPORT_TAB_CONTRACT).sort());
});

Deno.test("each tab's contract lists exactly the RPCs and Edge Functions its panel reaches", async () => {
  for (const [tab, row] of Object.entries(COMMUNITY_SUPPORT_TAB_CONTRACT)) {
    const reached = await reachedBy(row.panel);
    assertEquals([...reached.rpcs].sort(), [...row.rpcs].sort(), `${tab}: rpcs drifted from ${row.panel}`);
    assertEquals([...reached.functions].sort(), [...row.functions].sort(), `${tab}: functions drifted from ${row.panel}`);
  }
});

Deno.test("each tab maps to one known area and the access filter honours it", () => {
  const known = new Set([AREA.ADMIN_CONSOLE, COMMUNITY_OPERATIONS_AREA, SUPPORT_OPERATIONS_AREA]);
  const tabs = Object.keys(COMMUNITY_SUPPORT_TAB_CONTRACT).map((id) => ({ id, label: id }));
  assertEquals(COMMUNITY_SUPPORT_TAB_CAPABILITY, Object.fromEntries(
    Object.entries(COMMUNITY_SUPPORT_TAB_CONTRACT).map(([tab, row]) => [tab, row.area]),
  ));
  for (const [tab, row] of Object.entries(COMMUNITY_SUPPORT_TAB_CONTRACT)) {
    assert(known.has(row.area), `${tab}: unknown area ${row.area}`);
    const access = (areas: string[]) => ({ email: "t@example.test", role: "growth", status: "active", areas });
    const shown = (areas: string[]) =>
      communitySupportTabsForAccess(access(areas), tabs).some((t: { id: string }) => t.id === tab);
    if (row.area === AREA.ADMIN_CONSOLE) {
      // A Support teammate (both operational areas) never sees an Admin-only tab.
      assertEquals(shown([COMMUNITY_SUPPORT_AREA, COMMUNITY_OPERATIONS_AREA, SUPPORT_OPERATIONS_AREA]), false, tab);
      assertEquals(shown([AREA.ADMIN_CONSOLE]), true, tab);
    } else {
      assertEquals(shown([COMMUNITY_SUPPORT_AREA, row.area]), true, `${tab} hidden from its own area`);
      const other = row.area === COMMUNITY_OPERATIONS_AREA ? SUPPORT_OPERATIONS_AREA : COMMUNITY_OPERATIONS_AREA;
      assertEquals(shown([COMMUNITY_SUPPORT_AREA, other]), false, `${tab} shown without its area`);
    }
  }
});

Deno.test("the server derives each operational area from its tab RPC guard predicate", async () => {
  const sql = (await Deno.readTextFile(
    new URL("../../../supabase/migrations/20271120003988_issue_3988_operational_permissions.sql", import.meta.url),
  )).replace(/\s+/g, " ");
  const areas = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.admin_team_my_operational_areas()"));
  const caps = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.issue_3988_capabilities()"));
  // Community tabs: list_posts / update_idea / question_action / moderation_* guard on community_can('moderate').
  assert(caps.includes("IF public.community_can('moderate', v_uid) THEN v_caps := array_append(v_caps, 'community.moderate')"));
  // Support tabs: tickets RLS, brand groups and Feature Guide guard on is_support_staff OR is_admin_user.
  assert(caps.includes("v_support := public.is_support_staff(v_uid) OR v_admin;"));
  assert(areas.includes("v_caps := public.issue_3988_capabilities();"));
  assert(areas.includes("IF 'community.moderate' = ANY(v_caps) THEN v_areas := array_append(v_areas, 'community_support_community')"));
  assert(areas.includes("IF 'support.work' = ANY(v_caps) THEN v_areas := array_append(v_areas, 'community_support_support')"));
  // The areas function never reads a staff table directly.
  const areasBody = areas.slice(0, areas.indexOf("$$; REVOKE"));
  assertEquals(/support_staff|community_staff/.test(areasBody), false);
});
