/**
 * #4398 (Work board v3) — Host app > Mingla team > Work updates.
 *
 *   H-1  the due label matches the Admin board: "Overdue 4 days", "Due today",
 *        "Due tomorrow", "Due <weekday> <date>" within six days, "Due <date>"
 *        later, "Done <date>"
 *   H-2  filters All / Needs you / Mentions, with unread counts; Needs you is
 *        a card waiting for your confirm or a card sent back to you
 *   H-3  the screen: the tab is "Work updates", the filter chips and Mark all
 *        read are there, a tap opens the read-only card sheet (no Confirm on
 *        the phone, Q1 default) with Open in Mingla Admin, and Mark all read
 *        marks mentions and work updates read through team_inbox_mark_read
 *   H-4  every Host app language has the new words
 *
 * FAILS-ON-REVERT: on origin/main (eb1f1c058c) workUpdates.ts does not exist,
 * the tab says Mentions, a tap opens Admin straight away and no language has
 * team.tab_updates; every block reds.
 */
import fs from "node:fs";
import path from "node:path";

import { filterWorkUpdates, needsYou, workDueLabel, workUpdateCounts, type WorkUpdate } from "../workUpdates";

const t = ((key: string, values?: Record<string, unknown>) => {
  const words: Record<string, string> = {
    "team.due_overdue_one": "Overdue 1 day", "team.due_overdue": "Overdue {{n}} days", "team.due_today": "Due today",
    "team.due_tomorrow": "Due tomorrow", "team.due_on": "Due {{date}}", "team.done_on": "Done {{date}}",
  };
  return (words[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(values?.[k] ?? ""));
}) as never;
const TODAY = "2026-11-11";
const card = (due_on: string | null, status = "todo", closed_at: string | null = null) => ({ status, due_on, closed_at });

describe("H-1 the due label", () => {
  test("overdue, today, tomorrow, this week, later and done", () => {
    expect(workDueLabel(card("2026-11-07"), TODAY, t, "en-GB")).toEqual({ text: "Overdue 4 days", tone: "over" });
    expect(workDueLabel(card("2026-11-10"), TODAY, t, "en-GB").text).toBe("Overdue 1 day");
    expect(workDueLabel(card(TODAY), TODAY, t, "en-GB").text).toBe("Due today");
    expect(workDueLabel(card("2026-11-12"), TODAY, t, "en-GB").text).toBe("Due tomorrow");
    expect(workDueLabel(card("2026-11-13"), TODAY, t, "en-GB")).toEqual({ text: "Due Fri 13 Nov", tone: "week" });
    expect(workDueLabel(card("2026-11-21"), TODAY, t, "en-GB")).toEqual({ text: "Due 21 Nov", tone: "later" });
    expect(workDueLabel(card("2026-11-02", "done", "2026-11-11T12:00:00Z"), TODAY, t, "en-GB")).toEqual({ text: "Done 11 Nov", tone: "done" });
    expect(workDueLabel(null, TODAY, t, "en-GB").tone).toBe("none");
  });
});

describe("H-2 filters", () => {
  const row = (id: string, event_kind: string, read: boolean): WorkUpdate => ({
    id, kind: event_kind === "mention" ? "mention" : "work_update", source_kind: "work_card", card_id: "c", action: null, thread_id: null,
    message_id: null, actor_name: "Abimbola", body_excerpt: id, deep_link: null, created_at: "2026-11-11T10:00:00Z", read_at: read ? "2026-11-11T11:00:00Z" : null,
    event_kind, needs_you: event_kind === "review" || event_kind === "sent_back",
  });
  const list = [row("a", "review", false), row("b", "mention", false), row("c", "sent_back", true), row("d", "assigned", false), row("e", "status", true)];
  test("Needs you is a review ask or a send back; Mentions are mentions", () => {
    expect(filterWorkUpdates(list, "needs").map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterWorkUpdates(list, "mentions").map((r) => r.id)).toEqual(["b"]);
    expect(filterWorkUpdates(list, "all")).toHaveLength(5);
    expect(needsYou({ event_kind: "status", needs_you: false })).toBe(false);
    // #4398 retest (P3): a resolved review stops asking, read or not.
    expect(needsYou({ event_kind: "review", needs_you: false })).toBe(false);
    expect(needsYou({ event_kind: "sent_back", needs_you: false })).toBe(false);
    expect(needsYou({ event_kind: "review" })).toBe(true);
  });
  test("the chips count what is unread", () => {
    expect(workUpdateCounts(list)).toEqual({ all: 3, needs: 1, mentions: 1 });
  });
});

describe("H-3 the screen", () => {
  const screen = fs.readFileSync(path.resolve(__dirname, "../TeamScreens.tsx"), "utf8");
  const service = fs.readFileSync(path.resolve(__dirname, "../../../services/teamChatService.ts"), "utf8");
  test("the tab is Work updates, with the filters and Mark all read", () => {
    expect(screen).toContain('t("team.tab_updates")');
    expect(screen).toContain('testID={`team-filter-${key}`}');
    expect(screen).toContain('testID="team-mark-all-read"');
  });
  test("a tap opens the read-only card sheet; Admin opens from the sheet", () => {
    expect(screen).toMatch(/const openMention = useCallback\(async \(mention: WorkUpdate\) => \{\n\s+setSheet\(mention\);/);
    expect(screen).toContain('testID="team-card-sheet-admin"');
    expect(screen).not.toMatch(/ops_work_confirm|confirmWork|sendBackWork/);
  });
  test("Mark all read marks mentions and work updates, not support alerts", () => {
    expect(service).toContain('rpc<unknown>("team_inbox_mark_read", { p_scope: "mentions", p_alert_types: null }');
    expect(service).toContain('rpc<unknown>("team_inbox_mark_read", { p_scope: "work_updates", p_alert_types: null }');
  });
});

describe("H-4 every language has the new words", () => {
  const keys = ["tab_updates", "filter_all", "filter_needs", "mark_all_read", "due_overdue_one", "due_overdue", "due_today", "due_tomorrow",
    "due_on", "done_on", "card_people", "what_changed", "sheet_read_only", "empty_filter"];
  test("English and the other 28", () => {
    const root = path.resolve(__dirname, "../../../i18n/locales");
    const en = JSON.parse(fs.readFileSync(path.join(root, "en/teamChat.json"), "utf8")).team as Record<string, string>;
    for (const k of keys) expect(en[k]).toBeTruthy();
    const langs = fs.readdirSync(root).filter((l) => l !== "en");
    expect(langs).toHaveLength(28);
    for (const l of langs) {
      const team = JSON.parse(fs.readFileSync(path.join(root, l, "brandGroupMedia.json"), "utf8")).team as Record<string, string>;
      for (const k of keys) {
        expect(team[k]).toBeTruthy();
        expect(team[k]).not.toBe(en[k]);
      }
    }
  });
});
