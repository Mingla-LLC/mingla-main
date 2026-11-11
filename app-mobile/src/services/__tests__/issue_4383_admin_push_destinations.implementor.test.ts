// Issue #4383 — every Explorer-app destination an Admin push may open is fed
// through the app's REAL router (parseDeepLink + executeDeepLink) and must
// land on the bottom-nav tab whose on-screen name is the one the Admin screen
// shows. Executed proof, not declared proof (lesson of #2245): adding
// mingla://connections (the internal id of Chats) or any link that falls back
// to Home turns this red.
//
// Run: deno test --allow-read app-mobile/src/services/__tests__/issue_4383_admin_push_destinations.implementor.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { executeDeepLink, parseDeepLink } from "../deepLinkService.ts";
import { ADMIN_PUSH_DESTINATIONS } from "../../../../supabase/functions/_shared/adminPushDestinations.ts";

const APP_ROOT = new URL("../../../", import.meta.url);

// The bottom nav's labels, read from the app: page id -> i18n key
// (app/index.tsx tabLabels) -> English words (navigation.json).
async function tabLabels(): Promise<Record<string, string>> {
  const shell = await Deno.readTextFile(new URL("app/index.tsx", APP_ROOT));
  const block = shell.match(/const tabLabels = useMemo\(\s*\(\) => \(\{([\s\S]*?)\}\),/);
  assert(block, "tabLabels map found in app/index.tsx");
  const words = JSON.parse(await Deno.readTextFile(new URL("src/i18n/locales/en/navigation.json", APP_ROOT)));
  const out: Record<string, string> = {};
  for (const m of block[1].matchAll(/(\w+): t\('navigation:([\w.]+)'\)/g)) out[m[1]] = words[m[2]];
  return out;
}

function land(link: string) {
  const calls: { page: string | null; params: Record<string, string> | null; route: string | null } = { page: null, params: null, route: null };
  const dest = parseDeepLink(link);
  executeDeepLink(dest, {
    setCurrentPage: (page: string) => { calls.page = page; },
    setDeepLinkParams: (params: Record<string, string>) => { calls.params = params; },
    openRouterPath: (path: string) => { calls.route = path; },
  });
  return { dest, ...calls };
}

const EXPLORER = ADMIN_PUSH_DESTINATIONS.filter((row) => row.app === "explorer");
// The only broadcast destinations: Explore (home), Discover, Likes.
const BROADCAST_TABS = new Set(["home", "discover", "likes"]);

Deno.test("#4383 every Explorer destination is a real tab, reached by its own link (no Home fallback)", async () => {
  assertEquals(EXPLORER.length, 3);
  const labels = await tabLabels();
  for (const row of EXPLORER) {
    const result = land(row.deepLink);
    assert(result.dest !== null, `${row.deepLink} parses (a null would fall back by type)`);
    assertEquals(result.dest?.kind, "page", row.deepLink);
    assert(result.page !== null && BROADCAST_TABS.has(result.page), `${row.deepLink} opened ${result.page}`);
    assertEquals(result.route, null, `${row.deepLink} opens a tab, not a route`);
    assertEquals(labels[result.page!], row.label, `${row.deepLink}: the tab is called ${labels[result.page!]} on screen`);
  }
});

Deno.test("#4383 Explore, Discover and Likes each open a different tab", () => {
  const pages = EXPLORER.map((row) => land(row.deepLink).page);
  assertEquals(new Set(pages).size, EXPLORER.length);
  assertEquals(land("mingla://home").page, "home");
  assertEquals(land("mingla://discover").page, "discover");
  assertEquals(land("mingla://likes").page, "likes");
});

Deno.test("#4383 links that are not offered stay out of the table", () => {
  for (const link of ["mingla://connections", "mingla://saved", "mingla://profile"]) {
    assertEquals(EXPLORER.some((row) => row.deepLink === link), false, link);
  }
  // mingla://connections is Chats, not a Connections screen.
  assertEquals(land("mingla://connections").page, "connections");
});

Deno.test("#4383 the Explorer bell shows explorer.* rows (only stripe, business and admin are filtered)", async () => {
  const hook = await Deno.readTextFile(new URL("src/hooks/useNotifications.ts", APP_ROOT));
  const filters = [...hook.matchAll(/\.not\('type', 'like', '([^']+)'\)/g)].map((m) => m[1]);
  assertEquals([...new Set(filters)].sort(), ["admin.%", "business.%", "stripe.%"]);
});
