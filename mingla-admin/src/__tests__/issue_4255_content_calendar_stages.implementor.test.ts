// toward #4255: the content calendar follows Seth's model (10 Nov 2026).
// Idea -> Writing -> Designed -> Approved -> Scheduled -> Published. The Board
// shows every stage; the Calendar shows only Approved (dashed amber, never
// mistaken for Scheduled), Scheduled and Published. Designed needs a Drive link.
import { assert, assertEquals, assertMatch, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CALENDAR_STAGES,
  CONTENT_STAGES,
  contentErrorWords,
  moveNeedsFields,
  movePrompt,
  onCalendar,
  stageLabel,
} from "../lib/contentCalendarModel.js";

const PAGE = Deno.readTextFileSync(new URL("../pages/ContentCalendarPage.jsx", import.meta.url));
const CARD = Deno.readTextFileSync(new URL("../components/contentCalendar/ContentCard.jsx", import.meta.url));

Deno.test("#4255: stages read Designed and Approved; stored keys are unchanged", () => {
  assertEquals(CONTENT_STAGES.map((s: { value: string }) => s.value), ["idea", "writing", "design", "review", "scheduled", "published"]);
  assertEquals(CONTENT_STAGES.map((s: { label: string }) => s.label), ["Idea", "Writing", "Designed", "Approved", "Scheduled", "Published"]);
  assertEquals(stageLabel("design"), "Designed");
  assertEquals(stageLabel("review"), "Approved");
  assertMatch(CARD, /<Badge>\{stageLabel\(item\.stage\)\}<\/Badge>/);
});

Deno.test("#4255: only Approved, Scheduled and Published belong to the Calendar", () => {
  assertEquals(CALENDAR_STAGES, ["review", "scheduled", "published"]);
  for (const stage of ["idea", "writing", "design"]) assertEquals(onCalendar({ stage }), false, stage);
  for (const stage of ["review", "scheduled", "published"]) assertEquals(onCalendar({ stage }), true, stage);
  // The month grid and the undated count both use the filter.
  assertMatch(PAGE, /item\.publish_at && onCalendar\(item\) && localDateKey\(item\.publish_at\) === key/);
  assertMatch(PAGE, /calendar\.items\.filter\(\(item\) => !item\.publish_at && onCalendar\(item\)\)/);
});

Deno.test("#4255: Approved chips look different from Scheduled and are in the legend", () => {
  const tone = PAGE.slice(PAGE.indexOf("const POST_TONE = {"), PAGE.indexOf("};", PAGE.indexOf("const POST_TONE = {")));
  const line = (stage: string) => (tone.match(new RegExp(`${stage}: "([^"]+)"`)) || [])[1] || "";
  assert(line("review").includes("border-dashed"), "Approved is dashed");
  assert(line("review").includes("warning"), "Approved is amber");
  assertNotEquals(line("review"), line("scheduled"));
  assertNotEquals(line("published"), line("scheduled"));
  assertMatch(PAGE, /data-post-stage=\{e\.item\.stage\}/);
  assertMatch(PAGE, /\$\{POST_TONE\[e\.item\.stage\] \|\| POST_TONE\.scheduled\}/);
  assertMatch(PAGE, /\["review", "Approved post"\]/);
});

Deno.test("#4255: Designed needs a Drive link; Approved records the go; Scheduled needs date and channel only", () => {
  assertEquals(moveNeedsFields({ stage: "writing", drive_url: "" }, "design")?.field, "content-drive");
  assertEquals(moveNeedsFields({ stage: "writing", drive_url: "https://drive.google.com/x" }, "design"), null);
  assertEquals(moveNeedsFields({ stage: "design", drive_url: null }, "review")?.field, "content-drive");
  assertEquals(movePrompt({ stage: "design" }, "review")?.flag, "approve_design");
  assertEquals(movePrompt({ stage: "review" }, "scheduled"), null);
  assertEquals(moveNeedsFields({ stage: "review", publish_at: null, channels: ["instagram"] }, "scheduled")?.field, "content-publish");
  assertMatch(contentErrorWords({ token: "drive_required" }), /Drive link/);
  assertMatch(contentErrorWords({ token: "design_approval_required" }), /Ray and Abimbola/);
});
