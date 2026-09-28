/**
 * #3583 [website workspace never fails silently] — IMPLEMENTOR HAPPY PATH.
 *
 * One suite per defect, each driving the REAL route, the REAL hooks and the
 * REAL service down to the edge-function envelope, so a test cannot pass over
 * a fix that does not actually run. Business iOS, Business Android and
 * Business web render this one codebase, so one suite covers all three.
 *
 * D1 A refused editor handoff surfaces a real, actionable message instead of
 *    a one-frame "You're offline" followed by nothing.
 * D2 A refused first publish records NO operation, so the workspace cannot be
 *    stranded on "Publishing your website" by an operation Core never made.
 * D3 With no website, the desktop rail offers only Overview, every other
 *    destination resolves to setup, and nothing claims a website is live.
 * D4 The website context renders when the owner is not on wide desktop —
 *    which is every native build.
 */

import React from "react";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const mockInvoke = jest.fn();
jest.mock("../../services/supabase", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } },
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({ id: "00000000-0000-4000-8000-00000000000b" }),
  Redirect: () => null,
}));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));

const viewProps: Record<string, unknown>[] = [];
jest.mock("../../components/sites/BrandWebsiteView", () => ({
  BrandWebsiteView: (props: Record<string, unknown>) => {
    viewProps.push(props);
    return null;
  },
}));
jest.mock("../../components/ui/SafeScreen", () => ({
  SafeScreen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../../components/ui/TopBar", () => ({ TopBar: () => null }));
jest.mock("../../config/featureFlags", () => ({ isFeatureEnabled: () => true }));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "00000000-0000-4000-8000-00000000000a" },
    isAuthReady: true,
  }),
}));
jest.mock("../../hooks/useBrands", () => ({
  useBrand: () => ({ data: { displayName: "Gogi" } }),
}));
jest.mock("../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({
    isLoading: false,
    isError: false,
    rank: 60,
    refetch: jest.fn(),
  }),
}));
jest.mock("../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));
jest.mock("../../lib/netinfoSafe", () => ({ useNetInfoSafe: () => null }));
jest.mock("../websiteExternalOpen", () => ({ openWebsiteUrl: jest.fn() }));
jest.mock("../studioHandoff", () => ({
  openStudioHandoff: jest.fn(),
  studioReturnSurface: () => "native",
}));
jest.mock("../../components/ui/Button", () => ({
  Button: ({ label }: { label: string }) =>
    require("react").createElement("mock-button", null, label),
}));
jest.mock("../../components/ui/GlassCard", () => ({
  GlassCard: ({
    children,
    testID,
  }: {
    children: React.ReactNode;
    testID?: string;
  }) => require("react").createElement("mock-card", { testID }, children),
}));
jest.mock("../../components/ui/Icon", () => ({ Icon: () => null }));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Route from "../../../app/brand/[id]/website";
/*
 * The ROUTE suites replace the view with a prop recorder (above), so the real
 * component has to be pulled past that mock. Its own children — Button,
 * GlassCard, Icon — stay mocked, exactly as the #2830 view suites render it.
 */
const { BrandWebsiteView } = jest.requireActual(
  "../../components/sites/BrandWebsiteView",
) as typeof import("../../components/sites/BrandWebsiteView");
import { deriveBusinessWebsiteState, websiteFailureNotice } from "../websiteJourney";
import type { WorkspaceNoticeDetail } from "../websiteJourney";
import type { BrandSiteOverview } from "../contracts";

const { act, create } = require("react-test-renderer") as {
  act: (run: () => void | Promise<void>) => Promise<void>;
  create: (node: React.ReactElement) => {
    toJSON: () => unknown;
    unmount: () => void;
  };
};

/*
 * Every mounted route is tracked and UNMOUNTED after its test. A tree left
 * mounted keeps re-rendering on its own React Query timers and keeps pushing
 * into `viewProps`, so the next test reads the previous test's props — which
 * is exactly the kind of cross-test bleed that makes a suite lie.
 */
const mounted: { unmount: () => void }[] = [];

const BRAND = "00000000-0000-4000-8000-00000000000b";
const SITE_ID = "00000000-0000-4000-8000-00000000000c";
const DIGEST = "a".repeat(64);

const SITE: BrandSiteOverview = {
  id: SITE_ID,
  brand_id: BRAND,
  renderer_key: "restaurant-website-v1",
  renderer_version: 1,
  status: "draft",
  active_publication_id: null,
  last_successful_publication_id: null,
  provisioning_error_code: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  brand_site_hosts: [],
  latest_provision_operation: null,
};

/** The exact envelope `sitesFailure` writes for a refused Core operation. */
function refusal(code: string, message: string) {
  return {
    data: { ok: false, error: { code, message, retryable: false } },
    error: null,
  };
}

function ok(data: unknown) {
  return { data: { ok: true, data }, error: null };
}

interface Envelope {
  data: unknown;
  error: null;
}

type Handler = (route: string, body: Record<string, unknown>) =>
  | Envelope
  | null;

function serve(extra: Handler): void {
  mockInvoke.mockImplementation(
    (_fn: string, opts: { body: Record<string, unknown> }) => {
      const route = String(opts.body.route ?? "");
      const custom = extra(route, opts.body);
      if (custom !== null) return Promise.resolve(custom);
      if (route.endsWith("/site-availability")) {
        return Promise.resolve(ok({ available: true, site: SITE }));
      }
      if (route.endsWith("/site")) return Promise.resolve(ok(SITE));
      return Promise.resolve(ok([]));
    },
  );
}

function latest(): Record<string, unknown> {
  return viewProps[viewProps.length - 1] ?? {};
}

function notice(): WorkspaceNoticeDetail | null {
  return (latest().notice ?? null) as WorkspaceNoticeDetail | null;
}

async function mountRoute(): Promise<void> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    mounted.push(
      create(
        <QueryClientProvider client={client}>
          <Route />
        </QueryClientProvider>,
      ),
    );
  });
  await settle();
}

/**
 * Flush until the tree is quiet.
 *
 * A MACROTASK per pass, not just a microtask: React Query batches its
 * notifications through `setTimeout(…, 0)` (`notifyManager`), so awaiting
 * `Promise.resolve()` can return before a resolved query has told React
 * anything. A microtask-only flush happens to work for the first mount in a
 * file and then starts returning a tree that has rendered exactly once —
 * a false negative that looks like a broken fix.
 */
async function settle(passes = 12): Promise<void> {
  for (let pass = 0; pass < passes; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Every testID in a rendered tree. `toJSON` nests them under `props`. */
function testIds(node: React.ReactElement): string[] {
  let tree: { toJSON: () => unknown } | null = null;
  const renderer = require("react-test-renderer") as {
    act: (run: () => void) => void;
    create: (node: React.ReactElement) => { toJSON: () => unknown };
  };
  renderer.act(() => {
    tree = renderer.create(node);
  });
  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as {
      props?: Record<string, unknown>;
      children?: unknown;
    };
    const id = record.props?.testID;
    if (typeof id === "string") found.push(id);
    if (record.children !== undefined) walk(record.children);
  };
  walk((tree as unknown as { toJSON: () => unknown }).toJSON());
  return found;
}

/** Every rendered string in a tree, joined. */
function renderedText(node: React.ReactElement): string {
  let tree: { toJSON: () => unknown } | null = null;
  const renderer = require("react-test-renderer") as {
    act: (run: () => void) => void;
    create: (node: React.ReactElement) => { toJSON: () => unknown };
  };
  renderer.act(() => {
    tree = renderer.create(node);
  });
  const parts: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    walk((value as { children?: unknown }).children);
  };
  walk((tree as unknown as { toJSON: () => unknown }).toJSON());
  return parts.join(" ");
}

const VIEW_BASE = {
  brandName: "Gogi Lagos",
  site: SITE,
  rank: 60,
  isWideDesktop: false,
  journeyState: 5 as const,
  panel: "overview" as const,
  notice: null,
  isLoading: false,
  isError: false,
  isProvisioning: false,
  isOpeningStudio: false,
  isPreviewing: false,
  isPublishing: false,
  isRollingBack: false,
  isValidating: false,
  versions: [],
  analytics: null,
  validation: null,
  validationFailure: null,
  selectedVersion: null,
  provisionOperationId: null,
  provisionOperation: null,
  provisionPollingTimedOut: false,
  publicationOperationId: null,
  publicationOperation: null,
  publicationPollingTimedOut: false,
  isReconciling: false,
  onRetry: jest.fn(),
  onSetPanel: jest.fn(),
  onProvision: jest.fn(),
  onReconcileProvision: jest.fn(),
  onOpenStudio: jest.fn(),
  onPreview: jest.fn(),
  onViewLive: jest.fn(),
  onOpenAri: jest.fn(),
  onValidatePublish: jest.fn(),
  onPublish: jest.fn(),
  onSelectRollback: jest.fn(),
  onRollback: jest.fn(),
  onReconcilePublication: jest.fn(),
  onResetFailedPublication: jest.fn(),
};

beforeEach(async () => {
  viewProps.length = 0;
  mockInvoke.mockReset();
  await AsyncStorage.clear();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  for (const tree of mounted.splice(0)) {
    await act(async () => {
      tree.unmount();
    });
  }
  jest.restoreAllMocks();
});

describe("#3583 D1 — a refused step surfaces a real, actionable message", () => {
  it("names what happened and what to do, and never blames the network", async () => {
    serve((route) =>
      route.endsWith("/editor-session")
        ? refusal("INVALID_STATE", "The website is not ready for that action.")
        : null,
    );
    await mountRoute();

    await act(async () => {
      (latest().onOpenStudio as () => void)();
    });
    await settle();

    const shown = notice();
    expect(shown).not.toBeNull();
    // The old mapper answered "offline" here and the network effect then wiped
    // it on the next render, leaving the owner a screen that looked fine.
    expect(shown?.kind).toBe("failed");
    expect(shown?.title.length).toBeGreaterThan(2);
    expect(shown?.body).toContain("The website is not ready for that action.");
    expect(shown?.body.length).toBeGreaterThan(
      "The website is not ready for that action.".length,
    );
    expect(shown?.reference).toBe("INVALID_STATE");
    expect(shown?.body).not.toMatch(/offline/i);
  });

  it("the owner can see it: the workspace renders the failure with its reference", () => {
    const failed = websiteFailureNotice({
      code: "SERVICE_TEMPORARILY_UNAVAILABLE",
      message: "Website tools are temporarily unavailable. Please try again.",
    });
    const node = <BrandWebsiteView {...VIEW_BASE} notice={failed} />;
    expect(testIds(node)).toContain("website-failure");
    const text = renderedText(node);
    expect(text).toContain(
      "Website tools are temporarily unavailable. Please try again.",
    );
    expect(text).toContain("SERVICE_TEMPORARILY_UNAVAILABLE");
  });
});

describe("#3583 D2 — a refused first publish records nothing", () => {
  it("leaves no persisted operation and no publishing state to be stuck in", async () => {
    serve((route) => {
      if (route.endsWith("/ari")) {
        return ok({
          site_id: SITE_ID,
          valid: true,
          renderer: "Restaurant Website v1",
          home_revision: "rev-1",
          draft_digest: DIGEST,
          checked_pages: 3,
        });
      }
      if (route.endsWith("/publications")) {
        // Core's answer when the first-publish readiness gate refuses: the
        // authorize function RAISES, so the whole transaction — receipt row
        // included — rolls back and no operation exists anywhere.
        return refusal(
          "INVALID_STATE",
          "The website is not ready for that action.",
        );
      }
      return null;
    });
    await mountRoute();

    await act(async () => {
      (latest().onSetPanel as (p: string) => void)("publish_review");
    });
    await act(async () => {
      (latest().onValidatePublish as () => void)();
    });
    await settle();
    expect(latest().validation).not.toBeNull();

    await act(async () => {
      (latest().onPublish as () => void)();
    });
    await settle();

    const keys = await AsyncStorage.getAllKeys();
    expect(
      keys.filter((key) => key.startsWith("mingla:brand-site-publication:")),
    ).toEqual([]);
    expect(latest().publicationOperationId).toBeNull();
    // 14 is "Publishing your website" — the state the workspace used to sit on
    // forever, following an operation Core never created.
    expect(latest().journeyState).not.toBe(14);
    expect(notice()?.kind).toBe("failed");
  });

  it("records the operation once — and only once — Core accepts it", async () => {
    serve((route) => {
      if (route.endsWith("/ari")) {
        return ok({
          site_id: SITE_ID,
          valid: true,
          renderer: "Restaurant Website v1",
          home_revision: "rev-1",
          draft_digest: DIGEST,
          checked_pages: 3,
        });
      }
      if (route.endsWith("/publications")) return ok({ status: "executing" });
      if (route.includes("/operations/")) {
        return ok({
          operation_id: String(route.split("/operations/")[1]),
          site_id: SITE_ID,
          kind: "publish",
          status: "executing",
          error_code: null,
          authorized_at: "2026-09-01T00:00:00Z",
          updated_at: "2026-09-01T00:00:00Z",
          result_summary: null,
        });
      }
      return null;
    });
    await mountRoute();

    await act(async () => {
      (latest().onSetPanel as (p: string) => void)("publish_review");
    });
    await act(async () => {
      (latest().onValidatePublish as () => void)();
    });
    await settle();
    await act(async () => {
      (latest().onPublish as () => void)();
    });
    await settle();

    const keys = await AsyncStorage.getAllKeys();
    expect(
      keys.filter((key) => key.startsWith("mingla:brand-site-publication:")),
    ).toHaveLength(1);
    expect(latest().publicationOperationId).not.toBeNull();
    expect(latest().journeyState).toBe(14);
    expect(notice()).toBeNull();
  });
});

describe("#3583 D3 — no website means no sections", () => {
  const panels = [
    "publish_review",
    "versions",
    "analytics",
    "address",
    "rollback_review",
  ] as const;

  it("every site-requiring destination resolves to setup when there is no site", () => {
    for (const panel of panels) {
      expect(
        deriveBusinessWebsiteState({
          site: null,
          panel,
          operation: null,
          operationPending: false,
          isOpeningStudio: false,
          isPreviewing: false,
          studioReturnResult: null,
        }),
      ).toBe(2);
    }
    // The one panel that is site-less BY DESIGN is how a website gets made.
    expect(
      deriveBusinessWebsiteState({
        site: null,
        panel: "setup_review",
        operation: null,
        operationPending: false,
        isOpeningStudio: false,
        isPreviewing: false,
        studioReturnResult: null,
      }),
    ).toBe(3);
  });

  it("the desktop rail offers only Overview before a website exists", () => {
    const ids = testIds(
      <BrandWebsiteView
        {...VIEW_BASE}
        site={null}
        journeyState={2}
        isWideDesktop
      />,
    );
    expect(ids).toContain("website-rail-overview");
    for (const dead of ["publish", "versions", "analytics", "address"]) {
      expect(ids).not.toContain(`website-rail-${dead}`);
    }
  });

  it("an unreadable analytics panel never claims the website is live", () => {
    const text = renderedText(
      <BrandWebsiteView {...VIEW_BASE} journeyState={23} analytics={null} />,
    );
    expect(text).not.toMatch(/remains live/i);
    expect(text).toMatch(/analytics/i);
  });
});

describe("#3583 D4 — Edit with Ari says so on a phone", () => {
  /*
   * A parsed assertion, not a substring one. A source-text match passes over
   * an identifier that no longer exists and over a condition that changed
   * shape around it; this reads the actual JSX guard node.
   */
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../screens/ari/AriChatScreen.tsx"),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "AriChatScreen.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  function guardFor(testID: string): ts.Expression | null {
    let guard: ts.Expression | null = null;
    const namesPane = (node: ts.Node): boolean =>
      ts.isJsxAttribute(node) &&
      node.name.getText(ast) === "testID" &&
      node.initializer !== undefined &&
      ts.isStringLiteral(node.initializer) &&
      node.initializer.text === testID;
    const hasPane = (node: ts.Node): boolean => {
      if (namesPane(node)) return true;
      return node.getChildren(ast).some(hasPane);
    };
    const visit = (node: ts.Node): void => {
      if (
        ts.isConditionalExpression(node) &&
        hasPane(node.whenTrue) &&
        guard === null
      ) {
        guard = node.condition;
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    return guard;
  }

  it("the website context is not gated on wide desktop", () => {
    const guard = guardFor("ari-website-draft");
    expect(guard).not.toBeNull();
    // `isWideDesktop` is false on every native build, so a conjunction here is
    // exactly what made "Edit with Ari" land in a generic conversation.
    expect(ts.isIdentifier(guard as ts.Expression)).toBe(true);
    expect((guard as ts.Expression).getText(ast)).toBe("websiteSplit");
  });
});
