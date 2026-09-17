import { publishBusinessEventDraft } from "../businessEvents";
import { useDraftEventStore } from "../../store/draftEventStore";
import { forgetServerCoverBase, recordServerCoverBase } from "../../utils/draftCoverBase";
import { EVENT_STANDARD_POLICY } from "../refundPolicyModel";

const mockRpc = jest.fn();
const mockTerms = jest.fn();
jest.mock("../supabase", () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
jest.mock("../refundPolicyWrites", () => ({ setOfferingRefundPolicy: (...args: unknown[]) => mockTerms(...args) }));
jest.mock("../appsFlyerService", () => ({ logAppsFlyerEvent: jest.fn() }));

beforeEach(() => {
  forgetServerCoverBase();
  mockRpc.mockReset().mockResolvedValue({ data: null, error: new Error("probe reached publish") });
  mockTerms.mockReset();
});

test.each([null, "https://images.example.test/seen.jpg"])("publish transports the snapshot base %s", async base => {
  const draft = useDraftEventStore.getState().createDraft("3439-brand");
  recordServerCoverBase(draft.id, base);
  await expect(publishBusinessEventDraft(draft)).rejects.toThrow("probe reached publish");
  expect(mockRpc).toHaveBeenCalledWith("issue_1719_publish_event_with_poster", expect.objectContaining({
    p_draft_payload: expect.objectContaining({ __coverBase: base, cover_media_url: null }),
  }));
});

test("a poll during the awaited refund write cannot relabel the captured draft's base", async () => {
  const draft = { ...useDraftEventStore.getState().createDraft("3439-brand"), refundPolicy: EVENT_STANDARD_POLICY };
  recordServerCoverBase(draft.id, null);
  let finish: () => void = () => { throw new Error("refund write not started"); };
  mockTerms.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ ok: true }); }));
  const publishing = publishBusinessEventDraft(draft);
  expect(mockTerms).toHaveBeenCalledTimes(1);
  expect(mockRpc).not.toHaveBeenCalled();
  recordServerCoverBase(draft.id, "https://video.example.test/new.mp4");
  finish();
  await expect(publishing).rejects.toThrow("probe reached publish");
  expect(mockRpc).toHaveBeenCalledWith("issue_1719_publish_event_with_poster", expect.objectContaining({
    p_draft_payload: expect.objectContaining({ __coverBase: null, cover_media_url: null }),
  }));
});

test("unknown authority stays omitted for the SQL legacy guard, never invented as null", async () => {
  const draft = useDraftEventStore.getState().createDraft("3439-brand");
  await expect(publishBusinessEventDraft(draft)).rejects.toThrow("probe reached publish");
  expect(mockRpc.mock.calls[0][1].p_draft_payload).not.toHaveProperty("__coverBase");
});
