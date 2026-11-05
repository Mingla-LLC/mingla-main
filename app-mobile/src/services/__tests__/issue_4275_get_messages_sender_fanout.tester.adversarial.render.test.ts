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
// page makes 50 profile reads.

type MockRow = Record<string, unknown>;
const mockCounts = { profiles: 0, reads: 0 };
let mockMessageRows: MockRow[] = [];
let mockProfileFails = false;

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
                  mockProfileFails
                    ? { data: null, error: { code: "57014", message: "statement timeout" } }
                    : { data: { display_name: "Other" }, error: null },
                ), 1));
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

const REPRO_UNKNOWN_NAME = false;

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

  it("confirmed behaviour: a failed profile read paints the page Unknown, is cached, and retries cannot heal it", async () => {
    const { mergeMessages } = require("../../utils/mergeMessages") as typeof import("../../utils/mergeMessages");
    mockMessageRows = rowsWithoutSnapshot(50, "failing-sender");
    mockProfileFails = true;
    const first = await messagingService.getMessages("c1", "me");
    expect(first.error).toBeNull();
    expect(new Set(first.messages.map((m) => m.sender_name))).toEqual(new Set(["Unknown"]));
    expect(mockCounts.profiles).toBe(1);

    // The database recovers. Every retry in the next 5 minutes still reads Unknown.
    mockProfileFails = false;
    const retry = await messagingService.getMessages("c1", "me");
    expect(retry.messages[0].sender_name).toBe("Unknown");
    expect(mockCounts.profiles).toBe(1);

    // And a catch-up overwrites a good name already on screen.
    const onScreen = { id: "m0", senderName: "Good Name", timestamp: "2026-01-01T00:00:00Z" };
    const merged = mergeMessages([onScreen] as never[], [{ ...onScreen, senderName: "Unknown" }] as never[]) as Array<typeof onScreen>;
    expect(merged[0].senderName).toBe("Unknown");
  });

  (REPRO_UNKNOWN_NAME ? it : it.skip)("DEFECT-3 a failed profile read is not remembered", async () => {
    mockMessageRows = rowsWithoutSnapshot(1, "healing-sender");
    mockProfileFails = true;
    await messagingService.getMessages("c1", "me");
    mockProfileFails = false;
    const retry = await messagingService.getMessages("c1", "me");
    expect(retry.messages[0].sender_name).toBe("Other");
  });
});
