/**
 * #3380 tester-owned adversarial proof for useOwnProfilePhoneOnFile.
 *
 * The implementor tested the fetcher in isolation. This suite mounts the REAL
 * hook under a real QueryClient and attacks the states that decide whether a
 * guest is wrongly asked for a phone (or wrongly blocked):
 *
 *   - auth not ready     → no read at all, answer null (never "no phone")
 *   - signed out (null)  → no read at all, answer null
 *   - disabled           → no read at all, answer null
 *   - read error         → null (unknown), never false, and audible (console.warn)
 *   - loading            → null until the answer lands (no flash of the field)
 *   - user switch        → the second user's answer is read under their own key,
 *                          never the first user's cached one
 */
/* eslint-disable import/first -- Jest must install boundary mocks before real hooks load. */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

interface RendererInstance {
  unmount(): void;
  update(element: React.ReactElement): void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create(element: React.ReactElement): RendererInstance;
  act(callback: () => void | Promise<void>): Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = { isAuthReady: true };
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => auth,
}));

type Row = { data: unknown; error: unknown };
const pending: Array<{ userId: string; resolve: (row: Row) => void }> = [];
const fromMock = jest.fn();
jest.mock("../../services/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => {
      fromMock(...args);
      return {
        select: () => ({
          eq: (_col: string, userId: string) => ({
            maybeSingle: () =>
              new Promise<Row>((resolve) => {
                pending.push({ userId, resolve });
              }),
          }),
        }),
      };
    },
  },
}));

import { useOwnProfilePhoneOnFile } from "../useOwnProfilePhoneOnFile";

const seen: Array<boolean | null> = [];
const Probe: React.FC<{ userId: string | null; enabled: boolean }> = ({ userId, enabled }) => {
  seen.push(useOwnProfilePhoneOnFile(userId, enabled));
  return null;
};

const flush = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

let client: QueryClient;
const mount = async (userId: string | null, enabled = true): Promise<RendererInstance> => {
  let r!: RendererInstance;
  await TestRenderer.act(async () => {
    r = TestRenderer.create(
      <QueryClientProvider client={client}>
        <Probe userId={userId} enabled={enabled} />
      </QueryClientProvider>,
    );
  });
  await flush();
  return r;
};

let warnSpy: jest.SpyInstance;
beforeEach(() => {
  auth.isAuthReady = true;
  pending.length = 0;
  seen.length = 0;
  fromMock.mockClear();
  // retry:0 here would hide the hook's own retry; keep defaults but no delay.
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  warnSpy.mockRestore();
  client.clear();
});

describe("#3380 adversarial — useOwnProfilePhoneOnFile never reads too early", () => {
  it("auth not ready: no read, answer null", async () => {
    auth.isAuthReady = false;
    await mount("user-a");
    expect(fromMock).not.toHaveBeenCalled();
    expect(seen.every((v) => v === null)).toBe(true);
  });

  it("signed out (no user id): no read, answer null", async () => {
    await mount(null);
    expect(fromMock).not.toHaveBeenCalled();
    expect(seen.every((v) => v === null)).toBe(true);
  });

  it("disabled: no read, answer null", async () => {
    await mount("user-a", false);
    expect(fromMock).not.toHaveBeenCalled();
    expect(seen.every((v) => v === null)).toBe(true);
  });
});

describe("#3380 adversarial — slow and failing reads", () => {
  it("stays null while loading, then reports false only once the row says so", async () => {
    await mount("user-a");
    expect(pending).toHaveLength(1);
    expect(seen.every((v) => v === null)).toBe(true);
    await TestRenderer.act(async () => {
      pending[0].resolve({ data: { phone: null }, error: null });
    });
    await flush();
    expect(seen[seen.length - 1]).toBe(false);
  });

  it("a read error (after its one retry) is null, never false, and is logged", async () => {
    await mount("user-a");
    await TestRenderer.act(async () => {
      pending[0].resolve({ data: null, error: { message: "boom" } });
    });
    await flush();
    await flush();
    // retry: 1 → exactly one more read.
    expect(pending).toHaveLength(2);
    await TestRenderer.act(async () => {
      pending[1].resolve({ data: null, error: { message: "boom again" } });
    });
    await flush();
    expect(seen).not.toContain(false);
    expect(seen[seen.length - 1]).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "[rsvp] own profile phone read failed",
      expect.any(String),
    );
  });
});

describe("#3380 adversarial — account switch", () => {
  it("reads the second user under their own key; the first user's 'has phone' never leaks", async () => {
    const r = await mount("user-a");
    await TestRenderer.act(async () => {
      pending[0].resolve({ data: { phone: "+15551234567" }, error: null });
    });
    await flush();
    expect(seen[seen.length - 1]).toBe(true);

    seen.length = 0;
    await TestRenderer.act(async () => {
      r.update(
        <QueryClientProvider client={client}>
          <Probe userId="user-b" enabled />
        </QueryClientProvider>,
      );
    });
    await flush();
    expect(pending.map((p) => p.userId)).toEqual(["user-a", "user-b"]);
    // Until user-b's row lands the answer is unknown, never user-a's true.
    expect(seen).not.toContain(true);
    await TestRenderer.act(async () => {
      pending[1].resolve({ data: { phone: "  " }, error: null });
    });
    await flush();
    expect(seen[seen.length - 1]).toBe(false);
  });
});
