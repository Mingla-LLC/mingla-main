// Issue #4275 tester adversarial — the sender-name half of "a page is about 4 requests".
//
// The implementor's fixture gives every row a sender_display_name_snapshot, so its
// request count never reaches getSenderName. In production on 2026-11-05 most rows
// had no snapshot (a count only, no content read). With the 5-minute name cache cold,
// which is exactly the state after a long outage, getMessages asks for the same
// sender once per row, all at once.
//
// FAILS-ON-REVERT: delete the rememberSenderProfiles cache read from getSenderName
// and "a warm cache" fails.
//
// FAILS-ON-REVERT: remove the in-flight lookup from getSenderName and the 50-row cold
// page makes 50 profile reads. Cache a failed read again and the healing test fails.

// SN1 was a defect repro behind a flag; it runs as an ordinary test since the P3-C fix.
type MockRow = Record<string, unknown>;
const mockCounts = { profiles: 0, reads: 0 };
let mockMessageRows: MockRow[] = [];
let mockProfileFails = false;
let mockProfileDelayMs = 1;
let mockProfileMissing = false;

function mockThenable(result: unknown) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "lte", "order", "limit", "neq", "in"]) {
    query[method] = () => query;
  }
  query.single = () => Promise.resolve(result);
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return query;
}

jest.mock("../supabase", () => ({
  supabase: {
    from(table: string) {
      if (table === "messages") return mockThenable({ data: mockMessageRows, error: null });
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () => {
                mockCounts.profiles += 1;
                return new Promise((resolve) => setTimeout(() => resolve(
                  mockProfileMissing
                    ? { data: null, error: { code: "PGRST116", message: "no rows" } }
                    : mockProfileFails
                    ? { data: null, error: { code: "57014", message: "statement timeout" } }
                    : { data: { display_name: "Other" }, error: null },
                ), mockProfileDelayMs));
              },
            }),
          }),
        };
      }
      if (table === "message_reads") {
        mockCounts.reads += 1;
        return mockThenable({ data: [], error: null });
      }
      return mockThenable({ data: [], error: null });
    },
    channel: () => ({}),
    removeChannel: () => Promise.resolve("ok"),
  },
  trackedInvoke: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { messagingService } = require("../messagingService") as typeof import("../messagingService");

function rowsWithoutSnapshot(count: number, sender: string): MockRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    conversation_id: "c1",
    sender_id: sender,
    sender_display_name_snapshot: null,
    content: "hello",
    created_at: `2026-01-01T00:00:${String(index).padStart(2, "0")}Z`,
  }));
}

describe("#4275 tester: sender names in getMessages", () => {
  beforeEach(() => {
    mockCounts.profiles = 0;
    mockCounts.reads = 0;
    mockProfileFails = false;
    mockProfileMissing = false;
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("a warm cache makes no profile read for a page with no snapshots", async () => {
    mockMessageRows = rowsWithoutSnapshot(50, "warm-sender");
    messagingService.rememberSenderProfiles([{ id: "warm-sender", display_name: "Warm" }] as never);
    const { messages, error } = await messagingService.getMessages("c1", "me");
    expect(error).toBeNull();
    expect(messages).toHaveLength(50);
    expect(mockCounts.profiles).toBe(0);
    expect(mockCounts.reads).toBe(1);
    expect(messages[0].sender_name).toBe("Warm");
  });

  it("a cold cache asks for one sender once, not once per row", async () => {
    mockMessageRows = rowsWithoutSnapshot(50, "cold-sender");
    await messagingService.getMessages("c1", "me");
    expect(mockCounts.profiles).toBe(1);
  });

  it("a failed profile read is not remembered: the page says Unknown, and the next read heals it", async () => {
    mockMessageRows = rowsWithoutSnapshot(50, "failing-sender");
    mockProfileFails = true;
    const first = await messagingService.getMessages("c1", "me");
    expect(first.error).toBeNull();
    expect(new Set(first.messages.map((m) => m.sender_name))).toEqual(new Set(["Unknown"]));
    expect(mockCounts.profiles).toBe(1); // still one shared lookup for the page

    mockProfileFails = false;
    const retry = await messagingService.getMessages("c1", "me");
    expect(retry.messages[0].sender_name).toBe("Other");
    expect(mockCounts.profiles).toBe(2);

    const after = await messagingService.getMessages("c1", "me");
    expect(after.messages[0].sender_name).toBe("Other");
    expect(mockCounts.profiles).toBe(2); // a good answer is cached as before
  });

  it("no profile row is an answer, and is remembered", async () => {
    mockMessageRows = rowsWithoutSnapshot(1, "deleted-sender");
    mockProfileMissing = true;
    await messagingService.getMessages("c1", "me");
    const again = await messagingService.getMessages("c1", "me");
    expect(again.messages[0].sender_name).toBe("Unknown");
    expect(mockCounts.profiles).toBe(1);
  });

  it("a failed read does not replace an expired good name with Unknown", async () => {
    mockMessageRows = rowsWithoutSnapshot(1, "expired-sender");
    await messagingService.getMessages("c1", "me");
    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60 * 1000;
    try {
      mockProfileFails = true;
      const stale = await messagingService.getMessages("c1", "me");
      expect(stale.messages[0].sender_name).toBe("Other");
    } finally {
      Date.now = realNow;
    }
  });

  it("load: failed reads cost one lookup per sender per page read, not per row, and a page's bounded reads stay bounded", async () => {
    const rows = Array.from({ length: 50 }, (_, index) => ({
      ...rowsWithoutSnapshot(1, `group-sender-${index % 5}`)[0],
      id: `g${index}`,
    }));
    mockMessageRows = rows;
    mockProfileFails = true;
    try {
      const start = mockCounts.profiles;
      await messagingService.getMessages("c1", "me");
      expect(mockCounts.profiles - start).toBe(5);
      // One recovery episode's worth of page reads: the first plus 8 retries.
      for (let read = 0; read < 8; read += 1) await messagingService.getMessages("c1", "me");
      expect(mockCounts.profiles - start).toBe(45);
    } finally {
      mockProfileFails = false;
    }
  });

  it("a page whose names failed still counts as a good read, so recovery does not retry it", async () => {
    mockMessageRows = rowsWithoutSnapshot(3, "unhealed-sender");
    mockProfileFails = true;
    try {
      const { error, messages } = await messagingService.getMessages("c1", "me");
      expect(error).toBeNull();
      expect(messages[0].sender_name).toBe("Unknown");
    } finally {
      mockProfileFails = false;
    }
  });

  it("fixed in the P3-A rework (was \"reachable today\"): a stored good name with an empty name cache survives a failed read", async () => {
    const { mergeMessages } = require("../../utils/mergeMessages") as typeof import("../../utils/mergeMessages");
    mockMessageRows = rowsWithoutSnapshot(1, "stored-only-sender");
    const onScreen = { id: "m0", senderName: "Stored Name", timestamp: "2026-01-01T00:00:00Z" };
    mockProfileFails = true;
    const failed = await messagingService.getMessages("c1", "me");
    mockProfileFails = false;
    const afterFail = mergeMessages([onScreen] as never[], [{ ...onScreen, senderName: failed.messages[0].sender_name }] as never[]) as Array<typeof onScreen>;
    expect(failed.messages[0].sender_name).toBe("Unknown");
    expect(failed.degraded).toBe(true);
    expect(afterFail[0].senderName).toBe("Stored Name");
    const healed = await messagingService.getMessages("c1", "me");
    const afterGood = mergeMessages(afterFail as never[], [{ ...onScreen, senderName: healed.messages[0].sender_name }] as never[]) as Array<typeof onScreen>;
    expect(afterGood[0].senderName).toBe("Other");
  });

  it("a failed read marks the page degraded only while the failure stands: a later good read clears it", async () => {
    mockMessageRows = rowsWithoutSnapshot(2, "flaky-sender");
    mockProfileFails = true;
    expect((await messagingService.getMessages("c1", "me")).degraded).toBe(true);
    mockProfileFails = false;
    expect((await messagingService.getMessages("c1", "me")).degraded).toBe(false);
  });

  it("SN1 (fixed in the P3-C rework) a name the chat list warms after a failed read clears the failure, so good pages are not degraded", async () => {
    mockMessageRows = rowsWithoutSnapshot(3, "warmed-after-failure");
    mockProfileFails = true;
    await messagingService.getMessages("c1", "me");
    mockProfileFails = false;
    // The Chats list's profiles read (rememberSenderProfiles) now knows the name.
    messagingService.rememberSenderProfiles([{ id: "warmed-after-failure", display_name: "Warm Name" }] as never);
    const page = await messagingService.getMessages("c1", "me");
    expect(page.messages[0].sender_name).toBe("Warm Name");
    expect(page.degraded).toBe(false);
  });

  it("fixed in the P3-C rework (was \"pinned today\"): with a fresh name from the chat list, a failed sender is no longer degraded", async () => {
    mockMessageRows = rowsWithoutSnapshot(3, "pinned-warmed-after-failure");
    mockProfileFails = true;
    await messagingService.getMessages("c1", "me");
    mockProfileFails = false;
    messagingService.rememberSenderProfiles([{ id: "pinned-warmed-after-failure", display_name: "Warm Name" }] as never);
    const before = mockCounts.profiles;
    for (let read = 0; read < 3; read += 1) {
      const page = await messagingService.getMessages("c1", "me");
      expect(page.messages[0].sender_name).toBe("Warm Name");
      expect(page.degraded).toBe(false);
    }
    expect(mockCounts.profiles).toBe(before);
  });

  it("P3-C sign-out clears sender names, lookups and failure marks", async () => {
    mockMessageRows = rowsWithoutSnapshot(2, "signed-out-sender");
    mockProfileFails = true;
    const failed = await messagingService.getMessages("c1", "me");
    expect(failed.degraded).toBe(true);
    messagingService.clearSenderNames();
    const internals = messagingService as unknown as { failedSenderLookups: Set<string>; senderProfileCache: Map<string, unknown> };
    expect(internals.failedSenderLookups.size).toBe(0);
    expect(internals.senderProfileCache.size).toBe(0);
    const source = require("fs").readFileSync(require("path").join(__dirname, "../../utils/authCleanup.ts"), "utf8") as string;
    expect(source).toMatch(/messagingService\.clearSenderNames\(\)/);
  });

  it("P3-C confirm: a sender whose read keeps failing, with no name stored anywhere, stays degraded on every read", async () => {
    mockMessageRows = rowsWithoutSnapshot(2, "always-failing-sender");
    mockProfileFails = true;
    try {
      for (let read = 0; read < 9; read += 1) {
        expect((await messagingService.getMessages("c1", "me")).degraded).toBe(true);
      }
    } finally {
      mockProfileFails = false;
    }
  });

  it("pinned (P4): a name lookup in flight at sign-out still writes the old account's answer afterwards", async () => {
    messagingService.clearSenderNames();
    mockMessageRows = rowsWithoutSnapshot(1, "in-flight-at-sign-out");
    mockProfileFails = true;
    mockProfileDelayMs = 30;
    const internals = messagingService as unknown as { failedSenderLookups: Set<string>; senderProfileCache: Map<string, unknown> };
    try {
      const page = messagingService.getMessages("c1", "me");
      await new Promise((resolve) => setTimeout(resolve, 5));
      messagingService.clearSenderNames(); // sign-out while the lookup is on the wire
      await page;
      expect(internals.failedSenderLookups.has("in-flight-at-sign-out")).toBe(true);
    } finally {
      mockProfileFails = false;
      mockProfileDelayMs = 1;
      messagingService.clearSenderNames();
    }
  });
});
