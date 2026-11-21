// MINGLA-INVARIANT: I-4420-ARI-VIDEO-FROM-CATALOGUE | issue #4420 | Ari shows a help-video card only for a slug in supabase/functions/_shared/generated/ariHelpVideos.json (exactly what scripts/ari/build-help-videos.ts builds from packages/help-content, videos with a Bamboo entry only), the card's URL is built on the server from that catalogue, and show_help_video is offered and runnable only on a help_support turn.
//
// Issue #4420 (Host polish pass, part 2 §4.4-4.5, §6, §8).
// Regenerate after editing packages/help-content:
//   deno run --allow-read --allow-write scripts/ari/build-help-videos.ts
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_4420_ari_help_videos.implementor.test.ts

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { HELP_VIDEOS } from "../../../../packages/help-content/index.ts";
import {
  buildAriHelpVideoCatalogue,
  renderAriHelpVideoCatalogue,
} from "../../../../scripts/ari/build-help-videos.ts";
import {
  ARI_HELP_SUPPORT_CONTEXT,
  ariHelpSupportToolAllowed,
  HELP_VIDEO_BASE_URL,
  HELP_VIDEOS_FOR_ARI,
  helpVideoForAri,
  SHOW_HELP_VIDEO_TOOL,
  withAriHelpSupportTools,
} from "../ariHelpVideos.ts";
import {
  AGENT_TOOLS,
  findTool,
  isReadOnlyAgentToolCall,
} from "../agentTools.ts";
import { ToolError } from "../agentToolHelpers.ts";
import {
  ariHelpSupportPromptBlock,
  buildSystemPrompt,
} from "../agentSystemPrompt.ts";
import { ariTurnAgentTools } from "../ariRolloutTurn.ts";
import { type AriToolsetKey, selectAriTools } from "../agentToolsets.ts";

const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));
const CATALOGUE_PATH =
  "supabase/functions/_shared/generated/ariHelpVideos.json";

const ALL_TOOLSETS: AriToolsetKey[] = [
  "core",
  "brand",
  "listings",
  "money",
  "marketing",
  "people",
  "sites",
  "venues",
  "research",
  "memory",
  "onboarding",
];

async function callShowHelpVideo(args: Record<string, unknown>) {
  const tool = findTool(SHOW_HELP_VIDEO_TOOL);
  assert(tool, "show_help_video is registered");
  return await tool.executor(
    args,
    null as never,
    "00000000-0000-4000-8000-000000000001",
    { operationId: null },
  ) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Parity: the checked-in catalogue is exactly what the generator builds.
// ---------------------------------------------------------------------------

Deno.test("parity: ariHelpVideos.json is what build-help-videos.ts writes from packages/help-content", () => {
  assert(
    renderAriHelpVideoCatalogue(HELP_VIDEOS) === read(CATALOGUE_PATH),
    "ariHelpVideos.json is stale — run: deno run --allow-read --allow-write scripts/ari/build-help-videos.ts",
  );
});

Deno.test("parity: any source change (new video, renamed slug, title edit, losing a Bamboo entry) changes the output", () => {
  const base = renderAriHelpVideoCatalogue(HELP_VIDEOS);
  const withVideo = HELP_VIDEOS.findIndex((v) => v.bambooEntryId !== null);
  const withoutVideo = HELP_VIDEOS.findIndex((v) => v.bambooEntryId === null);
  assert(withVideo >= 0 && withoutVideo >= 0);
  const edits = [
    (i: number) => i === withoutVideo ? { bambooEntryId: "0_new" } : {},
    (i: number) => i === withVideo ? { slug: "renamed-slug" } : {},
    (i: number) => i === withVideo ? { title: "A new title" } : {},
    (i: number) => i === withVideo ? { bambooEntryId: null } : {},
  ];
  for (const edit of edits) {
    const changed = HELP_VIDEOS.map((v, i) => ({ ...v, ...edit(i) }));
    assertNotEquals(renderAriHelpVideoCatalogue(changed), base);
  }
});

Deno.test("catalogue: only videos that exist (Bamboo entry set), sorted by episode, schema 1, base URL fixed", () => {
  const built = buildAriHelpVideoCatalogue(HELP_VIDEOS);
  const existing = HELP_VIDEOS.filter((v) => v.bambooEntryId !== null);
  assertEquals(built.schema_version, 1);
  assertEquals(built.base_url, "https://usemingla.com/help/");
  assertEquals(built.videos.length, existing.length);
  assertEquals(
    built.videos.map((v) => v.slug).sort(),
    existing.map((v) => v.slug).sort(),
  );
  for (const missing of HELP_VIDEOS.filter((v) => v.bambooEntryId === null)) {
    assertEquals(helpVideoForAri(missing.slug), null, missing.slug);
  }
  const episodes = built.videos.map((v) => v.episode);
  assertEquals(episodes, [...episodes].sort((a, b) => a - b));
  // No timestamps or player ids leak into the edge bundle.
  const text = read(CATALOGUE_PATH);
  assert(!/uploadedAt|bambooEntryId|durationIso/.test(text));
  // The runtime loader serves the same list.
  assertEquals(
    HELP_VIDEOS_FOR_ARI.map((v) => v.slug),
    built.videos.map((v) => v.slug),
  );
});

// ---------------------------------------------------------------------------
// The tool: a card only for a catalogue slug, URL from the catalogue.
// ---------------------------------------------------------------------------

Deno.test("show_help_video: a catalogue slug returns the card built from the catalogue", async () => {
  assert(HELP_VIDEOS_FOR_ARI.length > 0);
  for (const video of HELP_VIDEOS_FOR_ARI) {
    const card = await callShowHelpVideo({ slug: video.slug });
    assertEquals(card, {
      slug: video.slug,
      title: video.title,
      blurb: video.blurb,
      duration: video.duration,
      chapter: video.chapter,
      url: `https://usemingla.com/help/${video.slug}`,
    });
  }
  assertEquals(HELP_VIDEO_BASE_URL, "https://usemingla.com/help/");
  assert(
    isReadOnlyAgentToolCall(SHOW_HELP_VIDEO_TOOL, {}),
    "a read, no card to confirm",
  );
});

Deno.test("show_help_video (adversarial): a slug outside the catalogue is refused HELP_VIDEO_UNKNOWN, no card", async () => {
  const real = HELP_VIDEOS_FOR_ARI[0].slug;
  const hostile: unknown[] = [
    "how-to-hack-mingla",
    real.toUpperCase(),
    `${real}-2`,
    `${real}?x=1`,
    `../${real}`,
    `${real}/../../admin`,
    `https://evil.example/${real}`,
    `//evil.example/help/${real}`,
    `javascript:alert(1)`,
    "__proto__",
    "constructor",
    "toString",
    "",
    "   ",
    null,
    42,
    ["getting-the-apps"],
    { slug: real },
    // A record that exists in help-content but has no video yet.
    ...HELP_VIDEOS.filter((v) => v.bambooEntryId === null).map((v) => v.slug),
  ];
  for (const slug of hostile) {
    const error = await assertRejects(
      () => callShowHelpVideo({ slug }),
      ToolError,
    );
    // A well-formed string is looked up and refused by the catalogue; a
    // non-string never reaches the lookup (schema check, INVALID_ARGS).
    assertEquals(
      (error as ToolError).code,
      typeof slug === "string" && slug.length > 0
        ? "HELP_VIDEO_UNKNOWN"
        : "INVALID_ARGS",
      String(slug),
    );
  }
  // The model cannot hand the card its own URL or title.
  const steered = await assertRejects(
    () =>
      callShowHelpVideo({
        slug: real,
        url: "https://evil.example/",
        title: "Injected",
      }),
    ToolError,
  );
  assertEquals((steered as ToolError).code, "INVALID_ARGS");
  // And the catalogue check itself refuses anything not in it.
  assertEquals(helpVideoForAri("how-to-hack-mingla"), null);
  assertEquals(helpVideoForAri("__proto__"), null);
  assertEquals(helpVideoForAri(undefined), null);
});

// ---------------------------------------------------------------------------
// The gate: only a help_support turn sees the tool (old Host builds never send
// it, so their turns are offered and may call exactly what they were before).
// ---------------------------------------------------------------------------

Deno.test("old clients: without help_support the tool is never offered and never runnable; every other tool is untouched", () => {
  assertEquals(ARI_HELP_SUPPORT_CONTEXT, "help_support");
  assertEquals(ariHelpSupportToolAllowed(SHOW_HELP_VIDEO_TOOL, false), false);
  for (const tool of AGENT_TOOLS) {
    if (tool.name === SHOW_HELP_VIDEO_TOOL) continue;
    assert(ariHelpSupportToolAllowed(tool.name, false), tool.name);
    assert(ariHelpSupportToolAllowed(tool.name, true), tool.name);
  }
  for (const understandFirst of [true, false]) {
    const registry = ariTurnAgentTools(understandFirst);
    // No toolset (not even every toolset at once, with any wording) picks it.
    const everything = selectAriTools(
      registry,
      ALL_TOOLSETS,
      1000,
      "show me the help video for show_help_video please",
    );
    assert(!everything.some((t) => t.name === SHOW_HELP_VIDEO_TOOL));
    // Whatever else selected it (e.g. the intent read naming it), the gate
    // removes it and leaves the rest of the turn's tools in order.
    const withIt = [...everything, findTool(SHOW_HELP_VIDEO_TOOL)!];
    assertEquals(
      withAriHelpSupportTools(withIt, registry, false).map((t) => t.name),
      everything.map((t) => t.name),
    );
    assertEquals(
      withAriHelpSupportTools(everything, registry, false),
      everything,
    );
  }
});

Deno.test("old clients: the system prompt without help_support has no help rules and no catalogue", () => {
  const prompt = buildSystemPrompt(null, [], { injectStrictReminder: false });
  assert(!prompt.includes("HELP & SUPPORT"));
  assert(!prompt.includes("HELP VIDEOS"));
  assert(!prompt.includes(SHOW_HELP_VIDEO_TOOL));
  assert(!prompt.includes("usemingla.com/help"));
});

Deno.test("help_support: the tool is always offered, once, and the prompt lists the catalogue", () => {
  const registry = ariTurnAgentTools(true);
  const core = selectAriTools(registry, ["core"], 12, "how do I scan tickets");
  const gated = withAriHelpSupportTools(core, registry, true);
  assertEquals(
    gated.filter((t) => t.name === SHOW_HELP_VIDEO_TOOL).length,
    1,
  );
  assertEquals(
    withAriHelpSupportTools(gated, registry, true).length,
    gated.length,
  );
  const block = ariHelpSupportPromptBlock();
  assertStringIncludes(block, "HELP & SUPPORT");
  assertStringIncludes(block, "Talk to a person");
  for (const video of HELP_VIDEOS_FOR_ARI) {
    assertStringIncludes(block, `- ${video.slug} — ${video.title}`);
  }
});

Deno.test("agent-chat wiring: help_support accepted, tool and prompt gated, unknown off the context", () => {
  const src = read("supabase/functions/agent-chat/index.ts");
  assertStringIncludes(
    src,
    "body.workflow_context !== ARI_HELP_SUPPORT_CONTEXT",
  );
  assertStringIncludes(
    src,
    "const helpSupport = body.workflow_context === ARI_HELP_SUPPORT_CONTEXT;",
  );
  assertStringIncludes(
    src,
    ') + (helpSupport ? ariHelpSupportPromptBlock() : "");',
  );
  // Gated after every selection step: the turn's tools and request_tools.
  assertEquals(
    src.split("withAriHelpSupportTools(").length - 1,
    2,
    "both tool selections pass the gate",
  );
  assertStringIncludes(
    src,
    'if (!ariHelpSupportToolAllowed(call.name, helpSupport)) {\n            return "unknown";',
  );
  // Every place agent-chat turns a model tool call into a tool is gated.
  assertEquals(
    src.split("findAriTurnTool(").length - 1,
    src.split("ariHelpSupportToolAllowed(").length - 1,
    "each findAriTurnTool lookup is behind the help_support gate",
  );
});
