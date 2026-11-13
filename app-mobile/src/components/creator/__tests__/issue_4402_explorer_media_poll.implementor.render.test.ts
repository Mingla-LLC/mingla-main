/**
 * #4402 item 1 — the processing poll and the resume read.
 * waitForMediaReady checks every 4 s (up to 10 minutes) until ready; pendingDeliveryMedia finds the newest delivery
 * video of the contract that no delivery uses.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 */
const mockEdge = jest.fn();
const mockFrom = jest.fn();

jest.mock("expo-image-picker", () => ({ MediaTypeOptions: { Videos: "Videos" }, launchImageLibraryAsync: jest.fn() }));
jest.mock("../../../services/supabase", () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) }, from: (...args: unknown[]) => mockFrom(...args) },
}));
jest.mock("../../../services/programApi", () => ({ programEdge: (...args: unknown[]) => mockEdge(...args) }));

const { waitForMediaReady, pendingDeliveryMedia } = require("../../../services/creatorMediaService");

describe("#4402 waitForMediaReady", () => {
  it("polls processing, processing, ready and stops there, one read per 4 s tick", async () => {
    const statuses = ["processing", "processing", "ready"];
    const fetchStatus = jest.fn(async () => ({ status: statuses.shift() as string }));
    const sleeps: number[] = [];
    const result = await waitForMediaReady("j1", { fetchStatus, sleep: async (ms: number) => { sleeps.push(ms); } });
    expect(result).toEqual({ status: "ready" });
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([4000, 4000]);
  });

  it("returns failed with the failure code", async () => {
    const result = await waitForMediaReady("j1", { fetchStatus: async () => ({ status: "failed", failureCode: "transcode_failed" }), sleep: async () => undefined });
    expect(result).toEqual({ status: "failed", failureCode: "transcode_failed" });
  });

  it("keeps polling through a missed read and times out after the limit, which is not a failure", async () => {
    let clock = 0;
    const fetchStatus = jest.fn(async () => { throw new Error("network request failed"); });
    const result = await waitForMediaReady("j1", { fetchStatus, sleep: async (ms: number) => { clock += ms; }, now: () => clock, maxMs: 600_000 });
    expect(result).toEqual({ status: "timeout" });
    expect(fetchStatus.mock.calls.length).toBeGreaterThan(100);
  });

  it("stops at once when cancelled", async () => {
    const fetchStatus = jest.fn(async () => ({ status: "processing" }));
    const result = await waitForMediaReady("j1", { fetchStatus, sleep: async () => undefined, isCancelled: () => true });
    expect(result).toEqual({ status: "cancelled" });
    expect(fetchStatus).not.toHaveBeenCalled();
  });
});

describe("#4402 pendingDeliveryMedia", () => {
  const rows = [
    { id: "used", status: "ready", created_at: "2026-12-10T12:00:00Z" },
    { id: "free", status: "ready", created_at: "2026-12-10T10:00:00Z" },
  ];
  const chain = (data: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order"]) q[m] = jest.fn(() => q);
    q.limit = jest.fn(async () => ({ data, error: null }));
    return q;
  };

  it("reads this owner's undeleted delivery videos of the contract and skips the ones a delivery uses", async () => {
    const q = chain(rows);
    mockFrom.mockReturnValue(q);
    const pending = await pendingDeliveryMedia("c1", ["used"]);
    expect(pending).toEqual(rows[1]);
    expect(mockFrom).toHaveBeenCalledWith("creator_media_jobs");
    expect(q.eq).toHaveBeenCalledWith("owner_id", "u1");
    expect(q.eq).toHaveBeenCalledWith("purpose", "delivery");
    expect(q.eq).toHaveBeenCalledWith("contract_id", "c1");
    expect(q.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("is null when every video is already used", async () => {
    mockFrom.mockReturnValue(chain(rows));
    expect(await pendingDeliveryMedia("c1", ["used", "free"])).toBeNull();
  });
});
