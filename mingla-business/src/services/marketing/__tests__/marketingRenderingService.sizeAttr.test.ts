/**
 * ORCH-0891 M1 fix-cycle — previewBlocks size-suffix tolerance.
 *
 * # The bug this catches
 * Operator-reported in the M1 checkpoint smoke: event tokens in the
 * composer body rendered as plain "slug" text in the preview pane (e.g.,
 * `{{event:UUID|medium}}` appeared verbatim instead of becoming an
 * event_card block). Root cause: `marketingRenderingService.EVENT_TOKEN_RE`
 * was the legacy strict regex `/\{\{event:([0-9a-fA-F-]{36})\}\}/g` —
 * NO support for the new `|size` suffix introduced by the Tiptap
 * composer + `tenTapTokenBridge` extension. Tokens with the suffix
 * never matched, so `previewBlocks` left them as plain paragraph text.
 *
 * # The fix
 * Extended `EVENT_TOKEN_RE` to optionally capture `(compact|medium|large)`
 * after `|`. Backwards-compatible: legacy size-less tokens still match
 * because the size group is optional.
 *
 * # Why source-grep
 * Repo precedent (`overview-no-revenue.test.ts`, M1's
 * `richEditor.tiptap.test.ts`) — Jest `testEnvironment: "node"`, no
 * jsdom/RTL. Source-grep covers the regex shape; the imported
 * `previewBlocks` is also called with sample tokens below to verify
 * runtime behavior end-to-end.
 *
 * # Fails-on-revert
 * Reverting `EVENT_TOKEN_RE` to the legacy strict form makes T-M1-PREV-01
 * (size-suffix token matches) fail because `previewBlocks` returns 1
 * paragraph block instead of 1 event_card block.
 */

import { previewBlocks, type PreviewBlock } from "../marketingRenderingService";

const UUID = "11111111-1111-4111-8111-111111111111";

const EMPTY_VARIABLES = {
  first_name: null,
  brand_name: null,
  event_name: null,
  event_date: null,
  event_time: null,
  doors_open: null,
  event_url: null,
  spots_left: null,
  previous_event_name: null,
  next_event_name: null,
  event_id: null,
};

describe("ORCH-0891 M1 fix — previewBlocks accepts |size suffix", () => {
  it("(T-M1-PREV-01) tokenizes `{{event:UUID|medium}}` as an event_card block", () => {
    const out = previewBlocks(`{{event:${UUID}|medium}}`, EMPTY_VARIABLES);
    expect(out).toEqual<PreviewBlock[]>([
      { kind: "event_card", content: UUID },
    ]);
  });

  it("(T-M1-PREV-02) tokenizes `{{event:UUID|compact}}` as an event_card block", () => {
    const out = previewBlocks(`{{event:${UUID}|compact}}`, EMPTY_VARIABLES);
    expect(out).toEqual<PreviewBlock[]>([
      { kind: "event_card", content: UUID },
    ]);
  });

  it("(T-M1-PREV-03) tokenizes `{{event:UUID|large}}` as an event_card block", () => {
    const out = previewBlocks(`{{event:${UUID}|large}}`, EMPTY_VARIABLES);
    expect(out).toEqual<PreviewBlock[]>([
      { kind: "event_card", content: UUID },
    ]);
  });

  it("(T-M1-PREV-04) tokenizes legacy size-less `{{event:UUID}}` as event_card block (backwards-compat)", () => {
    const out = previewBlocks(`{{event:${UUID}}}`, EMPTY_VARIABLES);
    expect(out).toEqual<PreviewBlock[]>([
      { kind: "event_card", content: UUID },
    ]);
  });

  it("(T-M1-PREV-05) sized event token nested in paragraph text splits correctly", () => {
    const body = `Hello — check out {{event:${UUID}|medium}} this weekend.`;
    const out = previewBlocks(body, EMPTY_VARIABLES);
    expect(out).toEqual<PreviewBlock[]>([
      { kind: "paragraph", content: "Hello — check out" },
      { kind: "event_card", content: UUID },
      { kind: "paragraph", content: "this weekend." },
    ]);
  });

  it("(T-M1-PREV-06) invalid size value (e.g. |huge) leaves token as literal text — does NOT match", () => {
    // The regex's alternation is strict: only `compact|medium|large` accepted.
    // Tokens with invalid sizes fall through to paragraph text — they do
    // NOT silently match as the legacy form (the `|huge}}` suffix would
    // need to be stripped, but the regex doesn't have that branch).
    const body = `{{event:${UUID}|huge}}`;
    const out = previewBlocks(body, EMPTY_VARIABLES);
    expect(out).toEqual<PreviewBlock[]>([
      { kind: "paragraph", content: `{{event:${UUID}|huge}}` },
    ]);
  });
});
