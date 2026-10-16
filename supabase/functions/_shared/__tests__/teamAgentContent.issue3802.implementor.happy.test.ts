import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SERVER_INFO } from "../teamAgentMcp.ts";
import {
  checkArguments,
  findTool,
  TEAM_AGENT_TOOLS,
  toolsForRole,
} from "../teamAgentTools.ts";
import {
  AREA,
  canOpenPage,
  PAGE_AREA_OVERRIDES,
} from "../../../../mingla-admin/src/lib/access.js";
import { NAV_GROUPS } from "../../../../mingla-admin/src/lib/constants.js";
import {
  CONTENT_STAGES,
  CONTENT_VIEWS,
  monthWindow,
  movePrompt,
} from "../../../../mingla-admin/src/lib/contentCalendarModel.js";

const NAMES = [
  "list_content",
  "add_content",
  "update_content",
  "assign_content",
  "comment_content",
  "move_content",
];
const UUID = "38020000-0000-4000-c400-000000000001";

Deno.test("#3802 Wave 2: version 4.4.0 exposes exactly six content tools to every role", () => {
  assertEquals(SERVER_INFO.version, "4.4.0");
  assertEquals(
    TEAM_AGENT_TOOLS.filter((tool) => tool.group === "Content").map((tool) =>
      tool.name
    ),
    NAMES,
  );
  for (const role of ["owner", "admin", "growth", "partner"]) {
    assertEquals(
      toolsForRole(role).filter((tool) => tool.group === "Content").map((
        tool,
      ) => tool.name),
      NAMES,
      role,
    );
  }
  assert(!TEAM_AGENT_TOOLS.some((tool) => /delete_content/.test(tool.name)));
});

Deno.test("#3802 Wave 2: content writes require locks and replay keys", () => {
  const accepted = checkArguments(findTool("move_content")!, {
    id: UUID,
    to: "published",
    expected_revision: 7,
    publish_without_link: true,
    request_key: "wave2_move_01",
  });
  assert(accepted.ok);
  for (
    const [name, args] of [
      ["add_content", { items: [{ title: "One" }] }],
      ["update_content", {
        id: UUID,
        changes: { copy: "Words" },
        expected_revision: 1,
      }],
      ["assign_content", { id: UUID, owner_emails: [], expected_revision: 1 }],
      ["comment_content", { id: UUID, body: "Ready" }],
      ["move_content", { id: UUID, to: "writing", expected_revision: 1 }],
    ] as const
  ) {
    const result = checkArguments(findTool(name)!, args);
    assert(!result.ok, name);
    assertMatch(result.refusal.message, /request_key/);
  }
});

Deno.test("#3802 Wave 2: title-only batches and closed enums fail before the gateway", () => {
  const extra = checkArguments(findTool("add_content")!, {
    items: [{ title: "One", notes: "not here" }],
    request_key: "wave2_add_001",
  });
  assert(!extra.ok);
  const skip = checkArguments(findTool("move_content")!, {
    id: UUID,
    to: "live",
    expected_revision: 1,
    request_key: "wave2_move_02",
  });
  assert(!skip.ok);
  const valid = checkArguments(findTool("list_content")!, { id: UUID });
  assert(valid.ok);
});

const readAdmin = (relative: string) =>
  Deno.readTextFileSync(
    new URL(`../../../../mingla-admin/src/${relative}`, import.meta.url),
  );
const PAGE = readAdmin("pages/ContentCalendarPage.jsx");
const DRAWER = readAdmin("components/contentCalendar/ContentDrawer.jsx");
const CARD = readAdmin("components/contentCalendar/ContentCard.jsx");
const SERVICE = readAdmin("services/contentCalendarService.js");

Deno.test("#3802 Wave 2: Admin defaults to Calendar, with the six-stage Board and List", () => {
  assertEquals(CONTENT_VIEWS.map((view: { value: string }) => view.value), [
    "calendar",
    "board",
    "list",
  ]);
  assertEquals(CONTENT_STAGES.map((stage: { value: string }) => stage.value), [
    "idea",
    "writing",
    "design",
    "review",
    "scheduled",
    "published",
  ]);
  assertEquals(monthWindow("2026-10").days.length, 42);
  assertMatch(PAGE, /\? p\.get\("view"\) : "calendar"/);
  assertMatch(PAGE, /<CalendarView[\s\S]*<BoardView[\s\S]*<ListView/);
});

Deno.test("#3802 Wave 2: one simple add, approval prompts, autosave and explicit comments", () => {
  assertEquals(movePrompt({ stage: "writing" }, "design"), {
    flag: "approve_copy",
    title: "Approve copy?",
    action: "Approve and move",
  });
  assertEquals(movePrompt({ stage: "review" }, "scheduled"), {
    flag: "approve_design",
    title: "Approve design?",
    action: "Approve and schedule",
  });
  assertEquals(
    movePrompt({ stage: "scheduled", live_url: null }, "published"),
    {
      flag: "publish_without_link",
      title: "Add the live link?",
      action: "Publish without link",
    },
  );
  assertMatch(PAGE, /It starts in Idea and is assigned to you/);
  assertMatch(PAGE, /createContent\(title,/);
  for (
    const label of [
      "Title",
      "Stage",
      "Publish date and time",
      "Owners",
      "Channels",
      "Copy",
      "Notes",
      "Drive link",
      "Live link",
      "More details",
      "Comments",
    ]
  ) assert(DRAWER.includes(label), label);
  assertMatch(DRAWER, /onBlur=\{\(\) => save/);
  assertMatch(DRAWER, />Comment<\/Button>/);
  assertMatch(PAGE, /duration: 8000/);
});

Deno.test("#3802 Wave 2: route, separate area, RPC boundary and responsive controls stay exact", () => {
  assertEquals(PAGE_AREA_OVERRIDES["content-calendar"], AREA.CONTENT_CALENDAR);
  for (const role of ["owner", "admin", "growth", "partner"]) {
    assert(
      canOpenPage(
        { role, status: "active", areas: ["content_calendar"] },
        "content-calendar",
      ),
      role,
    );
  }
  const pipeline =
    NAV_GROUPS.find((group: { label: string | null }) =>
      group.label === "Pipeline"
    )!.items;
  assertEquals(
    pipeline.findIndex((item: { id: string }) =>
      item.id === "content-calendar"
    ),
    pipeline.findIndex((item: { id: string }) => item.id === "tool-leads") + 1,
  );
  assertEquals(
    [...SERVICE.matchAll(/call\("(content_calendar_[a-z_]+)"/g)].map((match) =>
      match[1]
    ).length,
    10,
  );
  assertMatch(CARD, /text\/x-mingla-content-id/);
  for (const source of [PAGE, DRAWER, CARD]) assertMatch(source, /min-h-11/);
  assertMatch(CARD, /focus-visible:ring-\[var\(--color-brand-700\)\]/);
  assert(!/animate-\[/.test(PAGE + DRAWER + CARD));
});
