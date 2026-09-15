/**
 * RSVP Step 5 turnout card forecast a capacity nobody chose.
 *
 * Found filming the RSVP tutorial on the iOS simulator: turning on "Limit the
 * guest list" seeds Max guests with 1, the draft became eligible that instant,
 * and the one metered automatic run spent itself on it — "EXPECTED TURNOUT
 * 1–1 of 1". Raising the limit to 80 then showed "Inputs changed" and needed
 * a manual "Update forecast" tap to get 25–45 of 80.
 *
 * Now: a one-seat guest limit is not forecastable (missing_capacity), and the
 * automatic run waits for the inputs to settle, so stepping the limit up
 * spends the run once, on the number the host lands on.
 *
 * Mounts the REAL useTurnoutForecast with only the network edge (the growth
 * tool call, analytics, connectivity) stubbed.
 *
 * Fails on revert: restore `capacity < 1` in buildTurnoutInput, or the
 * immediate `run("auto")` effect, and the first expectation sees a run with
 * capacity 1.
 */
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { buildDraftEvent, type DraftEvent } from "../../store/draftEventStore";
import type { TurnoutReport } from "../../types/growthTools";
import type { TurnoutInputSource } from "../../utils/turnoutInput";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockRunGrowthTool = jest.fn<
  (tool: string, brandId: string, input: { capacity: number }) => Promise<unknown>
>();

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native") as Record<string, unknown>;
  return {
    ...actual,
    AccessibilityInfo: { announceForAccessibility: () => undefined },
  };
});
jest.mock("../../services/postHogService", () => ({
  postHogService: { capture: () => undefined },
}));
jest.mock("../../components/ui/useShareNetworkState", () => ({
  useShareNetworkState: () => true,
}));
jest.mock("../../services/growthToolsService", () => {
  class GrowthToolsAppError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    GrowthToolsAppError,
    mintClientRef: () => "client-ref",
    readRunByClientRef: () => Promise.reject(new Error("unused")),
    runGrowthTool: (tool: string, brandId: string, input: { capacity: number }) =>
      mockRunGrowthTool(tool, brandId, input),
  };
});

// eslint-disable-next-line import/first
import {
  TURNOUT_AUTO_RUN_SETTLE_MS,
  useTurnoutForecast,
  type TurnoutForecastController,
} from "../useTurnoutForecast";

type Tree = { update: (node: React.ReactElement) => void; unmount: () => void };
// The repository intentionally omits @types/react-test-renderer.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (work: () => void | Promise<void>) => void | Promise<void>;
  create: (node: React.ReactElement) => Tree;
};

const day = (offset: number): string => {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + offset);
  return value.toISOString().slice(0, 10);
};

const rsvpDraft = (rsvpCapacity: number | null): DraftEvent => ({
  ...buildDraftEvent("brand-1", "draft-1", "2026-09-01T00:00:00.000Z"),
  name: "Neighbors Night on Wythe",
  partyTypes: ["networking-event"],
  city: "Brooklyn",
  venueName: "Lantern Room",
  date: day(11),
  doorsOpen: "19:00",
  currency: "USD",
  isRsvp: true,
  rsvpCapacity,
});

const source = (capacity: number | null): TurnoutInputSource => ({
  kind: "rsvp",
  draft: rsvpDraft(capacity),
  brandDefaultCurrency: "USD",
});

const reportFor = (capacity: number): TurnoutReport =>
  ({
    forecast: { total_low: 25, total_high: 45, capacity, confidence: "medium" },
    meta: { research_source: "grounded", generated_at: new Date().toISOString() },
  }) as unknown as TurnoutReport;

let latest: TurnoutForecastController | null = null;
const Probe: React.FC<{ source: TurnoutInputSource }> = ({ source: s }) => {
  latest = useTurnoutForecast({
    brandId: "brand-1",
    source: s,
    wizard: "rsvp",
    surface: "rsvp_setup",
    previewActive: false,
  });
  return null;
};

const client = (): QueryClient =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const tree = (qc: QueryClient, s: TurnoutInputSource): React.ReactElement => (
  <QueryClientProvider client={qc}>
    <Probe source={s} />
  </QueryClientProvider>
);

const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await advance(1);
};

describe("turnout forecast never runs on a placeholder guest limit", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    latest = null;
    mockRunGrowthTool.mockReset();
    mockRunGrowthTool.mockImplementation(async (_tool, _brand, input) => ({
      runId: `run-${input.capacity}`,
      report: reportFor(input.capacity),
      cached: false,
    }));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("toggle on (Max guests 1) → no run, no card; stepping to 80 → ONE run, for 80", async () => {
    const qc = client();
    let mounted: Tree | null = null;
    await act(async () => {
      mounted = create(tree(qc, source(null)));
    });
    expect(latest?.state).toBe("idle");
    expect(latest?.blockReason).toBe("unlimited_capacity");

    // "Limit the guest list" ON seeds Max guests = 1.
    await act(async () => {
      mounted!.update(tree(qc, source(1)));
    });
    await advance(TURNOUT_AUTO_RUN_SETTLE_MS * 3);
    expect(mockRunGrowthTool).not.toHaveBeenCalled();
    expect(latest?.state).toBe("idle"); // TurnoutForecastCard renders nothing
    expect(latest?.blockReason).toBe("missing_capacity");

    // The host steps the limit up toward 80, a change every 250 ms.
    for (const capacity of [2, 3, 4, 5, 10, 20, 40, 60, 79, 80]) {
      await act(async () => {
        mounted!.update(tree(qc, source(capacity)));
      });
      await advance(250);
    }
    expect(mockRunGrowthTool).not.toHaveBeenCalled();

    await advance(TURNOUT_AUTO_RUN_SETTLE_MS);
    await flush();
    expect(mockRunGrowthTool).toHaveBeenCalledTimes(1);
    expect(mockRunGrowthTool.mock.calls[0][2].capacity).toBe(80);
    expect(latest?.state).toBe("result");
    expect(latest?.report?.forecast?.capacity).toBe(80);

    await act(async () => {
      mounted!.unmount();
    });
  });

  test("re-renders with an equal source do not keep postponing the settled run", async () => {
    const qc = client();
    let mounted: Tree | null = null;
    await act(async () => {
      mounted = create(tree(qc, source(80)));
    });
    // The wizard builds `source` inline, so every render hands the hook a new
    // object with the same content.
    for (let i = 0; i < 3; i += 1) {
      await advance(500);
      await act(async () => {
        mounted!.update(tree(qc, source(80)));
      });
    }
    await advance(TURNOUT_AUTO_RUN_SETTLE_MS - 1_500);
    await flush();
    expect(mockRunGrowthTool).toHaveBeenCalledTimes(1);
    await act(async () => {
      mounted!.unmount();
    });
  });

  test("the manual Update forecast still runs immediately", async () => {
    const qc = client();
    let mounted: Tree | null = null;
    await act(async () => {
      mounted = create(tree(qc, source(80)));
    });
    await act(async () => {
      await latest!.run("update");
    });
    await flush();
    expect(mockRunGrowthTool).toHaveBeenCalledTimes(1);
    expect(latest?.state).toBe("result");
    await act(async () => {
      mounted!.unmount();
    });
  });
});
