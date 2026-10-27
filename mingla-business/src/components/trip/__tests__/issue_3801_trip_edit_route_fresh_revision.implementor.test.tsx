/**
 * Issue #3801 rework (tester P1-2) — reopening a draft trip never seeds the
 * editor from a cached revision the server has moved past.
 *
 * BEFORE. `useUpsertTripIntakeSchema` invalidated `["trip", id]`, a key that
 * matches nothing (`tripKeys.detail` is `["trips","detail",id]`), so after a
 * Step 6 (Traveler info) save the cached trip kept the old `updatedAt`. The
 * edit route then mounted the wizard from that cached copy at once (it gated
 * on `isLoading` only) while it refetched, and the wizard's session seeded
 * its revision from it. The first save after reopening was refused as "This
 * trip was changed somewhere else" although nobody else had touched it. The
 * same held for any server change made while the wizard was closed (a cover
 * video applied).
 *
 * HOW. The REAL `/trip/[id]/edit` route source is compiled and mounted against
 * an explicit module boundary, with the REAL `useTrips` / `useIntakeSchema`
 * hooks and a REAL React Query client. Only the network services are fakes,
 * modelling the server's revision. The wizard is a probe that records the
 * trip (and so the revision) each editing session is mounted with.
 *
 * Fails on revert: put back `["trip", id]` in useIntakeSchema -> (a) red;
 * drop `refetchOnMount: "always"` and the `isFetchedAfterMount` gate from the
 * route -> (b) red.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import ts from "typescript";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// the server, as the services see it
// ---------------------------------------------------------------------------

const EVENT_ID = "38010000-0000-4000-8000-0000000000e1";
const BRAND_ID = "brand-3801-route";
const REV_LOADED = "2027-03-01T10:00:00.000001+00:00";
const REV_AFTER_INTAKE = "2027-03-01T10:01:00.000001+00:00";
const REV_AFTER_VIDEO = "2027-03-01T10:02:00.000001+00:00";

const server = { revision: REV_LOADED, tripReads: 0 };

const tripRow = (): Record<string, unknown> => ({
  id: EVENT_ID,
  brandId: BRAND_ID,
  brandSlug: "issue-3801",
  status: "draft",
  updatedAt: server.revision,
  title: "Lisbon long weekend",
  coverMediaUrl: null,
  coverMediaPosterUrl: null,
  coverMediaType: null,
  days: [{ ordinal: 1 }],
  inclusions: [],
  pricingTiers: [],
});

jest.mock("../../../services/tripsService", () => ({
  getTrip: jest.fn(async () => {
    server.tripReads += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return tripRow();
  }),
  TRIP_DRAFT_PLACEHOLDER_TITLE: "Untitled trip",
}));
jest.mock("../../../services/intakeSchemaService", () => ({
  getTripIntakeSchemasByEvent: jest.fn(async () => new Map()),
  // A draft intake save moves `events.updated_at` (the graph command bumps
  // it) and the editor's held revision adopts the new one.
  upsertTripIntakeSchema: jest.fn(
    async (input: { revision?: { current: string | null } }) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      server.revision = REV_AFTER_INTAKE;
      if (input.revision !== undefined) input.revision.current = server.revision;
    },
  ),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true, user: { id: "user-3801" } }),
}));
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
jest.mock("../../../analytics/searchOutcome", () => ({
  captureHostSearchOutcome: jest.fn(),
}));
jest.mock("../../../services/draftCurrencySync", () => ({
  publishWithDraftCurrencySync: jest.fn(),
}));
jest.mock("../../../hooks/upcomingKeys", () => ({
  upcomingKeys: { all: ["upcoming"] },
}));

// Imported AFTER the mocks are registered.
// eslint-disable-next-line import/first
import * as useTripsModule from "../../../hooks/useTrips";
// eslint-disable-next-line import/first
import { useUpsertTripIntakeSchema } from "../../../hooks/useIntakeSchema";
// eslint-disable-next-line import/first
import { tripKeys } from "../../../hooks/tripKeys";

interface Renderer {
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

// ---------------------------------------------------------------------------
// module boundary for the route
// ---------------------------------------------------------------------------

/** The revision every editing session was mounted with, in order. */
const sessions: string[] = [];
const WizardProbe = (props: { trip: { updatedAt: string } }): null => {
  const seeded = React.useRef<string | null>(null);
  if (seeded.current === null) {
    seeded.current = props.trip.updatedAt;
    sessions.push(props.trip.updatedAt);
  }
  return null;
};
const leaf = (name: string) => {
  const Leaf = (props: Record<string, unknown>): React.ReactElement =>
    React.createElement(name, props, props.children as React.ReactNode);
  Leaf.displayName = name;
  return Leaf;
};

const BOUNDARY: Record<string, () => unknown> = {
  react: () => React,
  "react-native": () => ({
    ActivityIndicator: leaf("ActivityIndicator"),
    ScrollView: leaf("ScrollView"),
    Text: leaf("Text"),
    View: leaf("View"),
    StyleSheet: { create: <T,>(styles: T): T => styles },
  }),
  "expo-router": () => ({
    useLocalSearchParams: () => ({ id: EVENT_ID }),
    useRouter: () => ({
      push: jest.fn(),
      back: jest.fn(),
      replace: jest.fn(),
      canGoBack: () => true,
    }),
  }),
  designSystem: () => ({
    spacing: { xl: 24, md: 12 },
    text: { primary: "#fff", secondary: "#ccc" },
    typography: {
      h3: { fontSize: 20, lineHeight: 24, fontWeight: "600" },
      body: { fontSize: 14, lineHeight: 20 },
    },
  }),
  useCurrentBrand: () => ({
    useCurrentBrand: () => ({
      id: BRAND_ID,
      displayName: "Issue 3801",
      paymentProvider: "stripe",
    }),
  }),
  AuthContext: () => ({ useAuth: () => ({ user: { id: "user-3801" } }) }),
  useBusinessRecent: () => ({
    discardBusinessRecentDraft: jest.fn(),
    promoteBusinessRecentDraft: jest.fn(),
    useSuccessfulBusinessRecentOpen: (): void => undefined,
  }),
  useTrips: () => useTripsModule,
  TripCreatorWizard: () => ({ TripCreatorWizard: WizardProbe }),
  EditPublishedTripScreen: () => ({ EditPublishedTripScreen: leaf("EditPublishedTripScreen") }),
  Button: () => ({ Button: leaf("Button") }),
  tripsService: () => ({ TRIP_DRAFT_PLACEHOLDER_TITLE: "Untitled trip" }),
  justPublishedSignal: () => ({ markJustPublished: jest.fn() }),
};

const ROUTE_FILE = path.resolve(__dirname, "..", "..", "..", "..", "app", "trip", "[id]", "edit.tsx");

function loadRoute(): React.ComponentType {
  const output = ts.transpileModule(fs.readFileSync(ROUTE_FILE, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const boundaryRequire = (specifier: string): unknown => {
    const key = specifier.split("/").pop() as string;
    const supply = BOUNDARY[specifier] ?? BOUNDARY[key];
    if (supply === undefined) {
      throw new Error(`Unclassified trip edit route boundary: ${specifier}`);
    }
    return supply();
  };
  const module = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", output)(
    boundaryRequire,
    module,
    module.exports,
  );
  return module.exports.default as React.ComponentType;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

let queryClient: QueryClient;
const mounted: Renderer[] = [];
const settle = async (ms = 40): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};
const openEditor = async (): Promise<Renderer> => {
  const Route = loadRoute();
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <QueryClientProvider client={queryClient}>
        <Route />
      </QueryClientProvider>,
    );
  });
  mounted.push(tree);
  await settle();
  return tree;
};
const closeEditor = async (tree: Renderer): Promise<void> => {
  await act(async () => {
    tree.unmount();
  });
  mounted.splice(mounted.indexOf(tree), 1);
};

/** The Step 6 save, through the REAL intake mutation hook. */
let saveIntake: ((revision: { current: string | null }) => Promise<void>) | null = null;
const IntakeSaver = (): null => {
  const mutation = useUpsertTripIntakeSchema();
  saveIntake = (revision) =>
    mutation.mutateAsync({
      eventId: EVENT_ID,
      ticketTypeId: "tt-a",
      schema: null,
      skipStatusProbe: true,
      revision,
    });
  return null;
};

/** The server's compare-and-swap, as in biz_apply_trip_draft_graph. */
const firstSaveIsRefused = (seededRevision: string): boolean =>
  seededRevision !== server.revision;

beforeEach(() => {
  server.revision = REV_LOADED;
  server.tripReads = 0;
  sessions.length = 0;
  saveIntake = null;
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
  queryClient.clear();
});

// ---------------------------------------------------------------------------

describe("issue #3801 — reopening a draft trip seeds the editor from the server", () => {
  test("(a) Step 6 save, close, reopen: the first save is not a conflict", async () => {
    const first = await openEditor();
    expect(sessions).toEqual([REV_LOADED]);

    // Step 6 save while the editor is open (the session's cursor adopts it).
    let saver!: Renderer;
    await act(async () => {
      saver = TestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <IntakeSaver />
        </QueryClientProvider>,
      );
    });
    mounted.push(saver);
    const cursor = { current: REV_LOADED as string | null };
    await act(async () => {
      await (saveIntake as NonNullable<typeof saveIntake>)(cursor);
    });
    await settle();
    expect(cursor.current).toBe(REV_AFTER_INTAKE);
    // The intake save marks the cached trip detail stale, so it is read again.
    const cached = queryClient.getQueryData<{ updatedAt: string }>(tripKeys.detail(EVENT_ID));
    expect(cached?.updatedAt).toBe(REV_AFTER_INTAKE);

    // Close, then reopen well inside the 60 s detail stale time.
    await closeEditor(first);
    await openEditor();

    expect(sessions).toHaveLength(2);
    expect(sessions[1]).toBe(REV_AFTER_INTAKE);
    expect(firstSaveIsRefused(sessions[1])).toBe(false);
  });

  test("(b) the server moved on while the editor was closed: reopen waits for a fresh read", async () => {
    const first = await openEditor();
    await closeEditor(first);
    const readsBeforeReopen = server.tripReads;

    // A cover video applied while closed: the server moved the revision and
    // nothing on this device marked the cached trip stale.
    server.revision = REV_AFTER_VIDEO;
    await openEditor();

    expect(server.tripReads).toBe(readsBeforeReopen + 1);
    // The second session was never mounted from the cached copy.
    expect(sessions).toEqual([REV_LOADED, REV_AFTER_VIDEO]);
    expect(firstSaveIsRefused(sessions[1])).toBe(false);
  });
});
