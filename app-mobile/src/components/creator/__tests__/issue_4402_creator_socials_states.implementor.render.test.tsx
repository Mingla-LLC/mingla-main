/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4402 — Creator setup Socials and Showcase steps.
 *
 *   - Socials: every handle card is drawn from the server's saved outcome
 *     (last_check_status, review_required, expires_at), so it survives a
 *     reload. Seth, 12 Nov 2026: a person at Mingla verifies every handle, so
 *     a submitted handle reads "With Mingla for review" (never "checking
 *     automatically"), whatever the bio check saw; expired → Get a new code;
 *     rejected → fixed wording plus the reviewer's note and NO way to undo it
 *     (no new code, the sheet is locked); verified by Mingla leaves the
 *     pending list. X is not offered. A platform with no row starts from the
 *     Mingla Local application handle.
 *   - Showcase: a cancelled picker never shows "Uploading 0%"; the bar
 *     appears only after a video is picked.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");
const { act } = TestRenderer;

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

type QueryResult = { data?: unknown; isLoading: boolean; isError: boolean; error?: unknown; refetch: () => void };
const mockQueries: Record<string, QueryResult> = {};
const mockSaveHandle = jest.fn();
const mockVerifyHandle = jest.fn();
const mockUpload = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) =>
    mockQueries[queryKey.join("/")] ?? { data: undefined, isLoading: false, isError: false, refetch: jest.fn() },
  useQueryClient: () => ({ invalidateQueries: jest.fn(() => Promise.resolve()), fetchQuery: jest.fn() }),
}));

// The real platform list, read from the service source (the service itself
// pulls in the Supabase client, which a render test must not load).
function mockRealCreatorPlatforms(): string[] {
  const fs = jest.requireActual("fs") as typeof import("fs");
  const path = jest.requireActual("path") as typeof import("path");
  const source = fs.readFileSync(path.join(__dirname, "../../../services/creatorProgramService.ts"), "utf8");
  const match = source.match(/export const CREATOR_PLATFORMS = \[([^\]]+)\]/);
  if (!match) throw new Error("CREATOR_PLATFORMS not found");
  return match[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
}

jest.mock("../../../services/creatorProgramService", () => ({
  CREATOR_PLATFORMS: mockRealCreatorPlatforms(),
  creatorProgramService: {
    status: jest.fn(),
    saveHandle: (...args: unknown[]) => mockSaveHandle(...args),
    verifyHandle: (...args: unknown[]) => mockVerifyHandle(...args),
  },
}));

jest.mock("../../../services/creatorMediaService", () => ({
  chooseAndUploadCreatorMedia: (...args: unknown[]) => mockUpload(...args),
  isPickerCancel: (e: unknown) => (e as { code?: string })?.code === "picker_cancelled",
  myShowcaseMedia: jest.fn(),
}));

jest.mock("../../../utils/copyAddressText", () => ({ copyAddressText: jest.fn(() => Promise.resolve()) }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../programs/VideoTile", () => ({ playOwnVideo: jest.fn() }));

jest.mock("../setupNav", () => ({
  SETUP_STATUS_KEY: ["creator", "status"],
  goToNextStep: jest.fn(),
  stepTitle: (step: string) => step,
}));

jest.mock("../../programs/ProgramPickers", () => {
  const ReactActual = jest.requireActual("react");
  return { Chip: (props: Record<string, unknown>) => ReactActual.createElement("Chip", props) };
});

jest.mock("../../programs/ProgramUi", () => {
  const ReactActual = jest.requireActual("react");
  const h = ReactActual.createElement;
  const host = (name: string) => (props: Record<string, unknown>) => h(name, props, props.children as React.ReactNode);
  return {
    programStyles: {},
    PROGRAM_COLORS: {},
    ProgramScreen: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) =>
      h("Screen", null, h("ScreenBody", null, children), footer ? h("ScreenFooter", null, footer) : null),
    ProgramSheet: ({ visible, children, footer }: { visible: boolean; children: React.ReactNode; footer?: React.ReactNode }) =>
      visible ? h("Sheet", null, h("SheetBody", null, children), footer ? h("SheetFooter", null, footer) : null) : null,
    ProgramButton: host("ProgramButton"),
    ProgramField: host("ProgramField"),
    ProgramLoading: host("ProgramLoading"),
    ProgramNotice: host("ProgramNotice"),
    ProgramCard: host("ProgramCard"),
    ProgramRow: host("ProgramRow"),
    ProgramPill: host("ProgramPill"),
  };
});

const CreatorSocialsStep = require("../../../../app/creator/setup/socials").default;
const CreatorShowcaseStep = require("../../../../app/creator/setup/showcase").default;
const { REJECTED_STANDARD_COPY, REVIEW_COPY } = require("../handleCheckState");

type Renderer = import("react-test-renderer").ReactTestRenderer;
type Instance = import("react-test-renderer").ReactTestInstance;

const FUTURE = "2099-01-01T00:00:00Z";
const PAST = "2020-01-01T00:00:00Z";

function ok(data: unknown): QueryResult {
  return { data, isLoading: false, isError: false, refetch: jest.fn() };
}

function handle(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `h-${String(over.platform ?? "instagram")}`, platform: "instagram", handle: "uncledelena", verify_code: "MINGLA-3367",
    verified: false, review_required: false, expires_at: FUTURE, follower_band: "lt1k", follower_source: "self_reported",
    last_check_status: null, last_checked_at: null, rejected_note: null, ...over,
  };
}

async function mount(element: React.ReactElement): Promise<Renderer> {
  let renderer: Renderer | null = null;
  await act(async () => {
    renderer = TestRenderer.create(element);
  });
  if (!renderer) throw new Error("did not render");
  return renderer;
}

const typed = (root: Instance, type: string): Instance[] => root.findAll((n) => (n.type as unknown) === type);
const cards = (root: Instance): Instance[] => typed(root, "ProgramCard").filter((c) => typed(c, "ProgramRow").length === 0);
const buttons = (root: Instance): string[] => typed(root, "ProgramButton").map((b) => String(b.props.label));
const notices = (root: Instance): string[] => typed(root, "ProgramNotice").map((n) => String(n.props.text));
const pills = (root: Instance): string[] => typed(root, "ProgramPill").map((p) => String(p.props.label));

beforeEach(() => {
  for (const key of Object.keys(mockQueries)) delete mockQueries[key];
  mockSaveHandle.mockReset();
  mockVerifyHandle.mockReset();
  mockUpload.mockReset();
});

describe("#4402 socials step reads each handle's state from the server", () => {
  async function single(over: Record<string, unknown>): Promise<Instance> {
    mockQueries["creator/status"] = ok({ profile: true, handles: [handle(over)] });
    const r = await mount(React.createElement(CreatorSocialsStep));
    const list = cards(r.root);
    expect(list).toHaveLength(1);
    return list[0];
  }

  it("a new handle is with Mingla for review, never checked automatically", async () => {
    const card = await single({ review_required: true });
    expect(pills(card)).toEqual(["With Mingla"]);
    expect(notices(card)).toEqual([REVIEW_COPY]);
    expect(notices(card).join(" ")).not.toMatch(/automatic/i);
    expect(buttons(card)).toEqual(["I added the code"]);
  });

  it("whatever the bio check saw, the handle stays with Mingla for review", async () => {
    for (const [status, words] of [["code_seen", /We saw the code/], ["code_not_seen", /couldn’t see the code on your profile yet/], ["unreadable", /look for the code themselves/]] as const) {
      const card = await single({ review_required: true, last_check_status: status, last_checked_at: "2026-11-12T09:29:00Z" });
      expect(pills(card)).toEqual(["With Mingla"]);
      expect(notices(card)[0].startsWith(REVIEW_COPY)).toBe(true);
      expect(notices(card)[0]).toMatch(words);
      expect(pills(card)).not.toContain("Verified");
    }
  });

  it("a submitted handle lets setup continue", async () => {
    mockQueries["creator/status"] = ok({ profile: true, handles: [handle({ review_required: true })] });
    const r = await mount(React.createElement(CreatorSocialsStep));
    expect(buttons(r.root)).toContain("Continue");
  });

  it("expired (server status or past expiry): Get a new code re-saves the same handle", async () => {
    mockSaveHandle.mockResolvedValue({ id: "h-instagram", verify_code: "MINGLA-9999", expires_at: FUTURE });
    for (const over of [{ last_check_status: "expired", review_required: true }, { expires_at: PAST, review_required: true }]) {
      const card = await single(over);
      expect(pills(card)).toEqual(["Code expired"]);
      expect(buttons(card)).toEqual(["Get a new code"]);
      await act(async () => {
        typed(card, "ProgramButton")[0].props.onPress();
      });
    }
    expect(mockSaveHandle).toHaveBeenCalledTimes(2);
    expect(mockSaveHandle).toHaveBeenLastCalledWith({ platform: "instagram", handle: "uncledelena", followerBand: "lt1k" });
    expect(mockVerifyHandle).not.toHaveBeenCalled();
  });

  it("rejected: fixed wording plus the reviewer's short note, and it sticks", async () => {
    mockQueries["creator/status"] = ok({ profile: true, handles: [handle({ last_check_status: "rejected", rejected_note: "Not their account" })] });
    const r = await mount(React.createElement(CreatorSocialsStep));
    const card = cards(r.root)[0];
    expect(pills(card)).toEqual(["Not confirmed"]);
    expect(notices(card)).toEqual([`${REJECTED_STANDARD_COPY}\nNote from Mingla: Not their account`]);
    expect(buttons(card)).toEqual([]);
    expect(buttons(r.root)).toContain("Add one account to continue");
    // The platform sheet cannot ask for a new code either.
    await act(async () => {
      typed(r.root, "ProgramRow").find((x) => x.props.title === "Instagram")?.props.onPress();
    });
    const footer = typed(r.root, "SheetFooter")[0];
    expect(buttons(footer)).toEqual(["Not confirmed by Mingla"]);
    expect(typed(footer, "ProgramButton")[0].props.disabled).toBe(true);
    expect(mockSaveHandle).not.toHaveBeenCalled();
  });

  it("verified by Mingla leaves the pending list and says the band was checked by Mingla", async () => {
    mockQueries["creator/status"] = ok({ profile: true, handles: [handle({ verified: true, last_check_status: "verified", follower_band: "1k_10k", follower_source: "admin" })] });
    const r = await mount(React.createElement(CreatorSocialsStep));
    expect(cards(r.root)).toHaveLength(0);
    const row = typed(r.root, "ProgramRow").find((x) => x.props.title === "Instagram");
    expect(row?.props.subtitle).toBe("@uncledelena · audience 1k–10k · checked by Mingla");
    expect(buttons(r.root)).toContain("Continue");
  });

  it("X is not offered, and a new platform starts from the Mingla Local application", async () => {
    mockQueries["creator/status"] = ok({ profile: true, handles: [], suggested_handles: { tiktok: "ada.local" } });
    const r = await mount(React.createElement(CreatorSocialsStep));
    const titles = typed(r.root, "ProgramRow").map((x) => x.props.title);
    expect(titles).toEqual(["Instagram", "TikTok", "YouTube", "Snapchat"]);
    await act(async () => {
      typed(r.root, "ProgramRow").find((x) => x.props.title === "TikTok")?.props.onPress();
    });
    const field = typed(r.root, "ProgramField")[0];
    expect(field.props.value).toBe("ada.local");
    const sheet = typed(r.root, "SheetBody")[0];
    const texts = sheet.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);
    expect(texts).toContain("From your Mingla Local application");
  });
});

describe("#4402 showcase upload progress", () => {
  beforeEach(() => {
    mockQueries["creator/showcase"] = ok([]);
  });

  const uploadingViews = (root: Instance): Instance[] =>
    root.findAll((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Uploading"));

  it("a cancelled picker never shows the upload bar", async () => {
    let resolvePick: (() => void) | null = null;
    mockUpload.mockImplementation(() => new Promise((_resolve, reject) => {
      resolvePick = () => reject(Object.assign(new Error("picker_cancelled"), { code: "picker_cancelled" }));
    }));
    const r = await mount(React.createElement(CreatorShowcaseStep));
    await act(async () => {
      typed(r.root, "ProgramButton").find((b) => b.props.label === "Choose a video")?.props.onPress();
    });
    // The picker is open: no "Uploading 0%".
    expect(uploadingViews(r.root)).toHaveLength(0);
    await act(async () => {
      resolvePick?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(uploadingViews(r.root)).toHaveLength(0);
    expect(typed(r.root, "ProgramNotice").filter((n) => n.props.tone === "error")).toHaveLength(0);
  });

  it("the bar appears only after a video is picked", async () => {
    let picked: (() => void) | null = null;
    mockUpload.mockImplementation((input: { onPicked?: () => void }) => new Promise(() => {
      picked = () => input.onPicked?.();
    }));
    const r = await mount(React.createElement(CreatorShowcaseStep));
    await act(async () => {
      typed(r.root, "ProgramButton").find((b) => b.props.label === "Choose a video")?.props.onPress();
    });
    expect(uploadingViews(r.root)).toHaveLength(0);
    await act(async () => {
      picked?.();
    });
    expect(uploadingViews(r.root)).toHaveLength(1);
  });
});
