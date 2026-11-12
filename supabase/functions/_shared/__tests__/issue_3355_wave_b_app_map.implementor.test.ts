// Issue #3355 Wave B (B2) — the Host App Map, its drift check and the route gate.
//
// Invariant I-ARI-HANDOFF-FIXABLE (App Map half; declared in issue_3355_wave_a_handoff_fixable.implementor.test.ts): supabase/functions/_shared/generated/ariAppMap.json is exactly what scripts/ari/build-app-map.mjs writes from mingla-business/app/** and the checked-in Feature Guide seeds; every route Ari can hand a host (open_handoff destinations, flow routes, the readiness catalogue) matches an App Map pattern; and a route outside the map is dropped from the reply, which says how to get there instead.
//
// Regenerate after changing a Host screen: node scripts/ari/build-app-map.mjs
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_3355_wave_b_app_map.implementor.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { renderAppMap } from "../../../../scripts/ari/build-app-map.mjs";
import {
  ARI_APP_ROUTES,
  ariHandoffRoute,
  guardAriReplyRoutes,
  isAriAppRoute,
  matchAriAppRoute,
} from "../ariAppMap.ts";
import { HOME_TODO_ROUTE } from "../ariFlows/runner.ts";
import { AGENT_TOOLS } from "../agentTools.ts";

const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));
const BRAND = "4b7f6c1e-1d9a-4f43-9a6e-2d1f0c7b9e10";

Deno.test("B2 drift: the checked-in App Map is what the generator writes", () => {
  const generated = renderAppMap(new URL(".", ROOT).pathname);
  const checkedIn = read("supabase/functions/_shared/generated/ariAppMap.json");
  assert(
    generated === checkedIn,
    "ariAppMap.json is stale — run: node scripts/ari/build-app-map.mjs",
  );
});

Deno.test("B2: routes come from Expo Router files — groups dropped, layouts and helpers excluded, params named", () => {
  const patterns = new Map(ARI_APP_ROUTES.map((r) => [r.pattern, r]));
  assert(patterns.has("/home"), "(tabs)/home.tsx is /home");
  assert(patterns.has("/hub"), "(tabs)/hub/index.tsx is /hub");
  assertEquals(patterns.get("/brand/[id]/edit")?.params, ["id"]);
  assertEquals(patterns.get("/brand/[id]/website/[...path]")?.params, [
    "id",
    "path",
  ]);
  assert(
    !ARI_APP_ROUTES.some((r) =>
      r.file.includes("_layout") || r.file.includes("__tests__") ||
      r.pattern.includes("+")
    ),
  );
  assert(!patterns.has("/hub/eventCardStatus"), "a .ts helper is not a screen");
  // A platform variant is the same route, listed once with the base file.
  assertEquals(
    patterns.get("/brand/[id]/connect")?.file,
    "mingla-business/app/brand/[id]/connect.tsx",
  );
  // Sorted, so the output is deterministic.
  const sorted = [...ARI_APP_ROUTES].map((r) => r.pattern);
  assertEquals(sorted, [...sorted].sort((a, b) => a.localeCompare(b)));
});

Deno.test("B2: screen titles and Feature Guide links", () => {
  const byPattern = new Map(ARI_APP_ROUTES.map((r) => [r.pattern, r]));
  assertEquals(byPattern.get("/brand/[id]/payments")?.title, "Payments");
  assertEquals(byPattern.get("/brand/[id]/payments")?.title_source, "header");
  assertEquals(byPattern.get("/brand/[id]/discounts")?.title, "Discounts");
  // events-discount-codes says "open a brand, then Discounts" (#3872 seed).
  assert(
    byPattern.get("/brand/[id]/discounts")?.capability_keys.includes(
      "events-discount-codes",
    ),
  );
  // Staff-only (Mingla Admin) guide entries never link to a Host screen.
  assert(
    !ARI_APP_ROUTES.some((r) =>
      r.capability_keys.some((key) => key.startsWith("staff-"))
    ),
  );
});

Deno.test("B2: route matching — templates, groups, queries, catch-all, static before dynamic", () => {
  assertEquals(
    matchAriAppRoute(`/brand/${BRAND}/edit?section=timezone`)?.pattern,
    "/brand/[id]/edit",
  );
  assertEquals(
    matchAriAppRoute("/brand/{brand_id}/team")?.pattern,
    "/brand/[id]/team",
  );
  assertEquals(matchAriAppRoute(HOME_TODO_ROUTE)?.pattern, "/home");
  assertEquals(
    matchAriAppRoute(`/brand/${BRAND}/website/setup?step=publish`)?.pattern,
    "/brand/[id]/website/[...path]",
  );
  assertEquals(matchAriAppRoute("/brand/new")?.pattern, "/brand/new");
  assertEquals(matchAriAppRoute(`/brand/${BRAND}/time-zone`), null);
  assertEquals(matchAriAppRoute("/nowhere"), null);
  assertEquals(matchAriAppRoute("https://example.com/brand/x"), null);
  assertEquals(matchAriAppRoute("//example.com/home"), null);
});

Deno.test("I-ARI-HANDOFF-FIXABLE: every open_handoff destination and flow route is an App Map screen", async () => {
  const tool = AGENT_TOOLS.find((t) => t.name === "open_handoff");
  assert(tool, "open_handoff is registered");
  const destinations =
    ((tool!.parameters.properties as Record<string, { enum?: string[] }>)
      .destination.enum) ?? [];
  assert(destinations.length > 10);
  const source = read("supabase/functions/_shared/agentAri10xTools.ts");
  const table = source.match(
    /const HANDOFF_ROUTES = Object\.freeze\(\{([\s\S]*?)\}\);/,
  );
  assert(table);
  const templates = [...table![1].matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
  assertEquals(templates.length, destinations.length);
  for (const template of templates) {
    assert(
      isAriAppRoute(template.replace("{brand_id}", BRAND)),
      `open_handoff route ${template} is not an App Map screen`,
    );
  }
  for (
    const route of [
      "/(tabs)/home",
      `/brand/${BRAND}/website`,
      `/brand/${BRAND}/website/setup`,
      `/brand/${BRAND}/website/setup?step=publish`,
      `/brand/${BRAND}/team`,
      "/trip/create",
      "/experience/create",
    ]
  ) {
    assert(
      isAriAppRoute(route),
      `flow route ${route} is not an App Map screen`,
    );
  }
  // open_handoff keeps a mapped route and turns any other into words.
  assertStringIncludes(
    source,
    'destination,\n      ...ariHandoffRoute(\n        template.replace("{brand_id}", String(args.brand_id ?? "")),',
  );
  assertEquals(ariHandoffRoute(`/brand/${BRAND}/team`), {
    route: `/brand/${BRAND}/team`,
  });
  const unmapped = ariHandoffRoute(`/brand/${BRAND}/time-zone`, "Brand edit");
  assertEquals(unmapped.route, null);
  assert("how_to" in unmapped && unmapped.how_to.length > 0);
  // The executor itself returns a mapped route.
  const result = await tool!.executor(
    { destination: "brand_edit", brand_id: BRAND, reason: "Upload a logo" },
    {} as never,
    "user",
    { operationId: null },
  ).catch(() => null);
  if (result && typeof result === "object" && "route" in result) {
    const route = (result as { route: unknown }).route;
    assert(route === null || isAriAppRoute(String(route)));
  }
});

Deno.test("I-ARI-HANDOFF-FIXABLE runtime: a route outside the App Map is dropped and the reply says how to get there", () => {
  const bad = `/brand/${BRAND}/discount-codes`;
  const guarded = guardAriReplyRoutes({
    text: "Here you go.",
    handoffRoute: bad,
    choices: {
      options: [
        { id: "a", label: "Open", payload: { type: "handoff", route: bad } },
        {
          id: "b",
          label: "Open team",
          payload: { type: "handoff", route: `/brand/${BRAND}/team` },
        },
        { id: "c", label: "Later", payload: { type: "slot_patch" } },
      ],
    },
    flowArtefact: {
      options: [{ id: "x", label: "Fix", route: bad }],
      handoff: { route: bad, route_label: "Discounts" },
    },
  });
  assertEquals(guarded.handoffRoute, undefined);
  assertEquals(
    (guarded.choices!.options as Array<{ id: string }>).map((o) => o.id),
    ["b", "c"],
  );
  assertEquals(guarded.flowArtefact?.handoff?.route, null);
  assertEquals(guarded.flowArtefact?.options?.[0].route, undefined);
  assertEquals(guarded.dropped.length, 4);
  // The card names Discounts, so the guide's own words for it follow.
  assertStringIncludes(guarded.text, "Discounts");
  assert(guarded.text.startsWith("Here you go."));

  const fine = guardAriReplyRoutes({
    text: "Open Team.",
    handoffRoute: `/brand/${BRAND}/team`,
  });
  assertEquals(fine.handoffRoute, `/brand/${BRAND}/team`);
  assertEquals(fine.text, "Open Team.");
  assertEquals(fine.dropped, []);
});

Deno.test("I-ARI-HANDOFF-FIXABLE runtime: agent-chat runs every committed reply through the route gate", () => {
  const chat = read("supabase/functions/agent-chat/index.ts");
  // #3355 ship-prep: on the rollout switch's on path (unset = on); the off
  // path keeps origin/main's text.
  assertStringIncludes(chat, ": guardAriReplyRoutes({");
  assertStringIncludes(
    chat,
    "const legacyText = unguardedArgs.understandFirst === false;",
  );
  assert(
    /async function commitTextTurn\(\s*unguardedArgs: CommitTextTurnArgs,/.test(
      chat,
    ),
  );
});
