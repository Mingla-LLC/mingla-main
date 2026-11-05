// Issue #4275 T-A12 and T-A10 — the real messagingService over a fake client.
//
// getMessages used to make one `.single()` message_reads request per row (up to 50
// a page, each answering 406 with no row). Recovery reads this on every reconnect.
//
// FAILS-ON-REVERT: map back to enrichMessage and T-A12 fails on the request count.
// Move channels.delete after removeChannel and T-A10 fails: the deliberate CLOSED
// reaches onStatus.

type MockRow = Record<string, unknown>;

const mockReadRequests: Array<{ kind: "in" | "single"; ids: unknown }> = [];
let mockMessageRows: MockRow[] = [];
let mockReadRows: MockRow[] = [];
let mockReadError: { message: string } | null = null;
type MockChannelEntry = {
  name: string;
  statusCallback: ((status: string) => void) | null;
  systemCallback: ((payload: MockRow) => void) | null;
};
const mockChannels: MockChannelEntry[] = [];

function mockThenable(result: unknown) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "lte", "order", "limit", "neq"]) {
    query[method] = () => query;
  }
  query.in = () => query;
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return query;
}

jest.mock("../supabase", () => ({
  supabase: {
    from(table: string) {
      if (table === "messages") return mockThenable({ data: mockMessageRows, error: null });
      if (table === "message_reads") {
        const query = mockThenable({ data: mockReadRows, error: mockReadError }) as Record<string, unknown>;
        query.in = (_column: string, ids: unknown) => {
          mockReadRequests.push({ kind: "in", ids });
          return query;
        };
        query.single = () => {
          mockReadRequests.push({ kind: "single", ids: null });
          return Promise.resolve({ data: null, error: { code: "PGRST116" } });
        };
        return query;
      }
      return mockThenable({ data: [], error: null });
    },
    channel(name: string) {
      const entry: MockChannelEntry = { name, statusCallback: null, systemCallback: null };
      mockChannels.push(entry);
      const channel: Record<string, unknown> = {
        on(type: string, _filter: unknown, callback: NonNullable<MockChannelEntry["systemCallback"]>) {
          if (type === "system") entry.systemCallback = callback;
          return channel;
        },
        subscribe(callback: NonNullable<MockChannelEntry["statusCallback"]>) {
          entry.statusCallback = callback;
          return channel;
        },
        entry,
      };
      return channel;
    },
    removeChannel(channel: { entry: MockChannelEntry }) {
      // As the library does: CLOSED fires synchronously inside the call.
      channel.entry.statusCallback?.("CLOSED");
      return Promise.resolve("ok");
    },
  },
  trackedInvoke: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { messagingService } = require("../messagingService") as typeof import("../messagingService");

function rows(count: number): MockRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    conversation_id: "c1",
    sender_id: "other",
    sender_display_name_snapshot: "Other",
    content: "hello",
    created_at: `2026-01-01T00:00:${String(index).padStart(2, "0")}Z`,
    is_read: true,
  }));
}

describe("#4275 messagingService", () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    mockReadRequests.length = 0;
    mockChannels.length = 0;
    mockReadError = null;
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("T-A12 a 50-row page makes one read-status read, with no .single(), and is_read is per row", async () => {
    mockMessageRows = rows(50);
    mockReadRows = [{ message_id: "m3" }, { message_id: "m7" }];
    const { messages, error, hasMore } = await messagingService.getMessages("c1", "me", 50);
    expect(error).toBeNull();
    expect(hasMore).toBe(true);
    expect(mockReadRequests).toEqual([{ kind: "in", ids: mockMessageRows.map((row) => row.id) }]);
    const read = messages.filter((message) => message.is_read).map((message) => message.id).sort();
    expect(read).toEqual(["m3", "m7"]);
    expect(messages.length).toBe(50);
  });

  it("T-A12 a read failure warns and shows the page as unread, and the page still loads", async () => {
    mockMessageRows = rows(3);
    mockReadError = { message: "overloaded" };
    mockReadRows = [];
    const { messages, error } = await messagingService.getMessages("c1", "me", 50);
    expect(error).toBeNull();
    expect(messages.map((message) => message.is_read)).toEqual([false, false, false]);
    expect(warn).toHaveBeenCalled();
  });

  it("T-A12 an empty page makes no read-status read", async () => {
    mockMessageRows = [];
    await messagingService.getMessages("c1", "me", 50);
    expect(mockReadRequests).toEqual([]);
  });

  it("T-A10 a deliberate leave reports nothing; a server close reports CLOSED", () => {
    const onStatus = jest.fn();
    messagingService.subscribeToConversation("leave-1", "me", { onStatus });
    mockChannels[0].statusCallback?.("SUBSCRIBED");
    expect(onStatus).toHaveBeenCalledWith("SUBSCRIBED");
    onStatus.mockClear();

    mockChannels[0].statusCallback?.("CLOSED"); // server phx_close: still the current channel
    expect(onStatus).toHaveBeenCalledWith("CLOSED");
    onStatus.mockClear();

    messagingService.unsubscribeFromConversation("leave-1");
    expect(onStatus).not.toHaveBeenCalled();
  });

  it("T-A10 re-subscribing the same chat does not report the old channel closing", () => {
    const first = jest.fn();
    const second = jest.fn();
    messagingService.subscribeToConversation("resub-1", "me", { onStatus: first });
    messagingService.subscribeToConversation("resub-1", "me", { onStatus: second });
    expect(first).not.toHaveBeenCalled();
    mockChannels[0].statusCallback?.("CHANNEL_ERROR"); // the old instance, late
    expect(first).not.toHaveBeenCalled();
    mockChannels[1].statusCallback?.("SUBSCRIBED");
    expect(second).toHaveBeenCalledWith("SUBSCRIBED");
    messagingService.unsubscribeFromConversation("resub-1");
  });

  it("R4 only a postgres_changes system error reports, only for the current channel", () => {
    const onSystemError = jest.fn();
    messagingService.subscribeToConversation("system-1", "me", { onSystemError });
    const system = mockChannels[0].systemCallback;
    system?.({ extension: "postgres_changes", status: "ok" });
    system?.({ extension: "other", status: "error" });
    expect(onSystemError).not.toHaveBeenCalled();
    system?.({ extension: "postgres_changes", status: "error" });
    expect(onSystemError).toHaveBeenCalledTimes(1);
    messagingService.unsubscribeFromConversation("system-1");
    system?.({ extension: "postgres_changes", status: "error" });
    expect(onSystemError).toHaveBeenCalledTimes(1);
  });
});
