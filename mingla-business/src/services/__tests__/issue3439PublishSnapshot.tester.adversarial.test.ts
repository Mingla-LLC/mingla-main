/** Independent #3439: unknown authority and concurrent/explicit-clear snapshots.
 * Real publish service + mapper/base owner; refund and RPC boundaries mocked.
 * The RPC deliberately rejects after capture: no provider or database writes.
 */
import { publishBusinessEventDraft } from "../businessEvents";
import { useDraftEventStore } from "../../store/draftEventStore";
import { forgetServerCoverBase, recordServerCoverBase } from "../../utils/draftCoverBase";
import { EVENT_STANDARD_POLICY } from "../refundPolicyModel";

const mockRpc = jest.fn();
const mockRefund = jest.fn();
jest.mock("../supabase", () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
jest.mock("../refundPolicyWrites", () => ({ setOfferingRefundPolicy: (...args: unknown[]) => mockRefund(...args) }));
jest.mock("../appsFlyerService", () => ({ logAppsFlyerEvent: jest.fn() }));

function deferred() {
  let resolve!: (value: { ok: true }) => void;
  const promise = new Promise<{ ok: true }>(done => { resolve = done; });
  return { promise, finish: () => resolve({ ok: true }) };
}
function draft() {
  return { ...useDraftEventStore.getState().createDraft("qa3439-brand"), refundPolicy: EVENT_STANDARD_POLICY };
}
beforeEach(() => {
  forgetServerCoverBase();
  mockRpc.mockReset().mockResolvedValue({ data: null, error: new Error("captured-publish") });
  mockRefund.mockReset();
});

test("unknown-at-capture authority stays omitted even when a poll learns a cover during refund save", async () => {
  const source = draft();
  const refund = deferred();
  mockRefund.mockReturnValue(refund.promise);
  const result = publishBusinessEventDraft(source).catch(error => error);
  expect(mockRpc).not.toHaveBeenCalled();
  recordServerCoverBase(source.id, "https://example.invalid/new.mp4");
  refund.finish();
  expect(await result).toEqual(new Error("captured-publish"));
  expect(mockRpc.mock.calls[0][1].p_draft_payload).not.toHaveProperty("__coverBase");
  expect(mockRpc.mock.calls[0][1].p_draft_payload.cover_media_url).toBeNull();
});

test("a deliberate removal remains paired with its seen cover when a newer echo arrives during refund save", async () => {
  const source = draft();
  recordServerCoverBase(source.id, "https://example.invalid/seen.jpg");
  const refund = deferred();
  mockRefund.mockReturnValue(refund.promise);
  const result = publishBusinessEventDraft(source).catch(error => error);
  recordServerCoverBase(source.id, "https://example.invalid/concurrent.mp4");
  refund.finish();
  expect(await result).toEqual(new Error("captured-publish"));
  expect(mockRpc.mock.calls[0][1].p_draft_payload).toEqual(expect.objectContaining({
    __coverBase: "https://example.invalid/seen.jpg", cover_media_url: null,
  }));
});

test("overlapping publishes keep each draft's original base despite reversed refund completion and echo order", async () => {
  const first = draft();
  const second = draft();
  const firstRefund = deferred();
  const secondRefund = deferred();
  recordServerCoverBase(first.id, null);
  recordServerCoverBase(second.id, "https://example.invalid/second.jpg");
  mockRefund.mockImplementation((id: string) => id === first.id ? firstRefund.promise : secondRefund.promise);
  const one = publishBusinessEventDraft(first).catch(error => error);
  const two = publishBusinessEventDraft(second).catch(error => error);
  recordServerCoverBase(first.id, "https://example.invalid/first-new.mp4");
  recordServerCoverBase(second.id, "https://example.invalid/second-new.mp4");
  secondRefund.finish();
  expect(await two).toEqual(new Error("captured-publish"));
  firstRefund.finish();
  expect(await one).toEqual(new Error("captured-publish"));
  expect(mockRpc).toHaveBeenNthCalledWith(1, "issue_1719_publish_event_with_poster", expect.objectContaining({
    p_event_id: second.id, p_draft_payload: expect.objectContaining({ __coverBase: "https://example.invalid/second.jpg" }),
  }));
  expect(mockRpc).toHaveBeenNthCalledWith(2, "issue_1719_publish_event_with_poster", expect.objectContaining({
    p_event_id: first.id, p_draft_payload: expect.objectContaining({ __coverBase: null }),
  }));
});

test("a rejected refund write prevents publication rather than using a captured cover as fallback permission", async () => {
  const source = draft();
  recordServerCoverBase(source.id, null);
  mockRefund.mockResolvedValue({ ok: false, reason: "requires_reason", affectedOrderCount: 2 });
  await expect(publishBusinessEventDraft(source)).rejects.toThrow();
  expect(mockRpc).not.toHaveBeenCalled();
});
