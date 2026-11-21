/**
 * #4514 live smoke test (21 Nov 2026): once a form was attached, the Host Forms
 * list and the event's Guest questions tile failed ("Couldn't load your forms",
 * "Unable to load"), because the page-name read asked `events` for a `name`
 * column. The column is `title`; PostgREST refused the select.
 *
 * FAILS-ON-REVERT: selecting `name` again, or mapping the page name from
 * `row.name`, turns a case red.
 */

const from = jest.fn();
jest.mock("../supabase", () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }));

import { fetchEventAttachment } from "../brandFormsService";

type Rows = { data: unknown; error: unknown };

const chain = (result: Rows, onSelect?: (cols: string) => void) => {
  const self: Record<string, unknown> = {};
  const ret = () => self;
  self.select = (cols: string) => {
    onSelect?.(cols);
    return self;
  };
  self.is = ret;
  self.eq = ret;
  self.in = () => Promise.resolve(result);
  self.maybeSingle = () => Promise.resolve(result);
  self.then = (res: (v: Rows) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return self;
};

beforeEach(() => from.mockReset());

it("reads the page title from events.title and shows it as the page name", async () => {
  const eventColumns: string[] = [];
  from.mockImplementation((table: string) => {
    if (table === "brand_form_attachments") {
      return chain({
        data: [{ id: "a1", form_id: "f1", event_id: "e1", mode: "required_step", auto_remind: false, auto_remind_channels: ["email"] }],
        error: null,
      });
    }
    if (table === "events") {
      return chain({ data: [{ id: "e1", title: "Detty December Weekend", event_type: "event" }], error: null }, (c) =>
        eventColumns.push(c),
      );
    }
    if (table === "brand_forms") {
      return chain({
        data: {
          id: "f1",
          brand_id: "b1",
          name: "Smoke test",
          status: "live",
          draft: { questions: [] },
          draft_rev: 1,
          live_version_id: "v1",
          door_full_answers: true,
          updated_at: "2026-11-21T03:00:00Z",
          closed_at: null,
        },
        error: null,
      });
    }
    throw new Error(`unexpected table ${table}`);
  });

  const out = await fetchEventAttachment("e1");

  expect(eventColumns).toEqual(["id, title, event_type"]);
  expect(eventColumns.join(" ")).not.toMatch(/\bname\b/);
  expect(out?.attachment.eventName).toBe("Detty December Weekend");
  expect(out?.attachment.eventType).toBe("event");
});
