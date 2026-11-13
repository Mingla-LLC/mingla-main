/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4402 — the creator's video delivery and the contract cards around it.
 *
 * Item 1: after "Choose video" the card waits for the video to finish processing, then sends it once; it never
 * asks for a second upload; a reopened screen resumes (Processing, or "Send this video to the host").
 * Items 2, 4, 7: the Shoot card (time in the listing zone, door pass), the posts-checked notices and the reason.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");
const { act } = TestRenderer;

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

const mockChoose = jest.fn();
const mockWait = jest.fn();
const mockPending = jest.fn();

jest.mock("../../../services/creatorMediaService", () => ({
  chooseAndUploadCreatorMedia: (...args: unknown[]) => mockChoose(...args),
  waitForMediaReady: (...args: unknown[]) => mockWait(...args),
  pendingDeliveryMedia: (...args: unknown[]) => mockPending(...args),
  isPickerCancel: (e: unknown) => (e as { code?: string } | null)?.code === "picker_cancelled",
}));
jest.mock("../../../services/creatorGigsService", () => ({
  gigZone: (w: { gig?: { timezone?: string | null } }) => w?.gig?.timezone ?? null,
}));
jest.mock("../../programs/VideoTile", () => ({ playOwnVideo: jest.fn() }));
jest.mock("../../programs/ProgramPickers", () => {
  const ReactActual = jest.requireActual("react");
  const h = ReactActual.createElement;
  const host = (name: string) => (props: Record<string, unknown>) => h(name, props);
  return { CalendarGrid: host("CalendarGrid"), CheckRow: host("CheckRow"), Chip: host("Chip"), StarsInput: host("StarsInput"), TimeChips: host("TimeChips") };
});
jest.mock("../../programs/ProgramUi", () => {
  const ReactActual = jest.requireActual("react");
  const h = ReactActual.createElement;
  const host = (name: string) => (props: Record<string, unknown>) => h(name, props, props.children as React.ReactNode);
  return {
    PROGRAM_COLORS: new Proxy({}, { get: () => "#000" }),
    programStyles: new Proxy({}, { get: () => ({}) }),
    ProgramButton: host("ProgramButton"), ProgramCard: host("ProgramCard"), ProgramField: host("ProgramField"), ProgramNotice: host("ProgramNotice"),
    ProgramPill: host("ProgramPill"), ProgramRow: host("ProgramRow"), ProgramSheet: host("ProgramSheet"),
  };
});

const { UploadCard, ShootCard, PostsStatus } = require("../contract/ContractSections");

type Renderer = import("react-test-renderer").ReactTestRenderer;
type Instance = import("react-test-renderer").ReactTestInstance;

const baseWorkspace = (over: Record<string, unknown> = {}) => ({
  contract: { id: "c1", state: "script_locked", state_deadline_at: null, fix_rounds_used: 0, current_terms_version: 1 },
  gig: { title_public: "Rooftop", brief_public: "", format_key: "night_out_30", post_by: "2026-12-15", timezone: "Africa/Lagos", place_name: "Tolu's Rooftop", place_address: "14 Admiralty Way" },
  terms: [{ version: 1, fee_minor: 4_000_000, booking_fee_minor: 600_000, currency: "NGN", post_by: "2026-12-15", video_due_at: "2026-12-13T22:59:00Z", shoot_passes: 2 }],
  deliveries: [], posts: [], events: [], proposals: [], scripts: [], shoot_plan: null, reveal: null, revealed: true,
  ...over,
});

function render(element: React.ReactElement): Renderer {
  let renderer: Renderer | null = null;
  act(() => { renderer = TestRenderer.create(element); });
  return renderer as unknown as Renderer;
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function mount(onSubmit: (id: string) => Promise<void>, workspace = baseWorkspace()): Promise<Renderer> {
  let renderer: Renderer | null = null;
  await act(async () => { renderer = TestRenderer.create(<UploadCard contractId="c1" workspace={workspace} onSubmit={onSubmit} />); });
  await settle();
  return renderer as unknown as Renderer;
}

const labels = (r: Renderer): string[] => r.root.findAll((n) => (n.type as unknown) === "ProgramButton").map((n) => String(n.props.label));
const button = (r: Renderer, label: string): Instance => r.root.find((n) => (n.type as unknown) === "ProgramButton" && n.props.label === label);
const text = (r: Renderer): string => JSON.stringify(r.toJSON()) + r.root.findAll((n) => (n.type as unknown) === "ProgramNotice").map((n) => `${n.props.title ?? ""} ${n.props.text}`).join(" ");
const notices = (r: Renderer, tone: string): Instance[] => r.root.findAll((n) => (n.type as unknown) === "ProgramNotice" && n.props.tone === tone);

beforeEach(() => {
  jest.clearAllMocks();
  mockPending.mockResolvedValue(null);
});

describe("#4402 item 1: the upload card waits, then sends once", () => {
  it("idle shows Choose video and no progress words before a video is picked", async () => {
    const r = await mount(jest.fn());
    expect(labels(r)).toEqual(["Choose video"]);
    expect(text(r)).not.toMatch(/Uploading/);
    expect(text(r)).toContain("Upload by Sun Dec 13");
  });

  it("uploads once, waits for ready, then sends the same job once", async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    let finish: (v: unknown) => void = () => undefined;
    mockChoose.mockImplementation(async (input: { onPicked: () => void; onProgress: (f: number) => void }) => { input.onPicked(); input.onProgress(0.42); return { jobId: "j1", aspectWarning: false }; });
    mockWait.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const r = await mount(onSubmit);
    await act(async () => { button(r, "Choose video").props.onPress(); });
    await settle();
    expect(text(r)).toContain("Processing your video");
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => { finish({ status: "ready" }); });
    await settle();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("j1");
    expect(mockChoose).toHaveBeenCalledTimes(1);
    expect(text(r)).toContain("Sent to the host");
  });

  it("a ready video found on reopening is sent by the primary button, with no new upload", async () => {
    mockPending.mockResolvedValue({ id: "j2", status: "ready", created_at: "2026-12-10T10:00:00Z" });
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const r = await mount(onSubmit);
    expect(labels(r)).toEqual(["Send this video to the host", "Choose a different video"]);
    await act(async () => { button(r, "Send this video to the host").props.onPress(); });
    await settle();
    expect(onSubmit).toHaveBeenCalledWith("j2");
    expect(mockChoose).not.toHaveBeenCalled();
  });

  it("a video still processing on reopening resumes polling", async () => {
    mockPending.mockResolvedValue({ id: "j3", status: "processing", created_at: "2026-12-10T10:00:00Z" });
    mockWait.mockImplementation(() => new Promise(() => undefined));
    const r = await mount(jest.fn());
    expect(mockWait).toHaveBeenCalledWith("j3", expect.anything());
    expect(text(r)).toContain("Processing your video");
  });

  it("a failed send keeps the video and shows the error beside the Send button; sending again never uploads", async () => {
    mockPending.mockResolvedValue({ id: "j4", status: "ready", created_at: "2026-12-10T10:00:00Z" });
    const onSubmit = jest.fn().mockRejectedValueOnce(new Error("network request failed")).mockResolvedValue(undefined);
    const r = await mount(onSubmit);
    await act(async () => { button(r, "Send this video to the host").props.onPress(); });
    await settle();
    expect(notices(r, "error")).toHaveLength(1);
    const send = button(r, "Send this video to the host");
    expect(send).toBeTruthy();
    await act(async () => { send.props.onPress(); });
    await settle();
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(mockChoose).not.toHaveBeenCalled();
  });

  it("the server's 'still processing' refusal goes back to Processing, never to a dead end", async () => {
    mockPending.mockResolvedValue({ id: "j5", status: "ready", created_at: "2026-12-10T10:00:00Z" });
    const { ProgramActionError } = require("../../../services/programResult");
    const onSubmit = jest.fn().mockRejectedValue(new ProgramActionError("ready_delivery_media_required"));
    mockWait.mockImplementation(() => new Promise(() => undefined));
    const r = await mount(onSubmit);
    await act(async () => { button(r, "Send this video to the host").props.onPress(); });
    await settle();
    expect(notices(r, "error")).toHaveLength(0);
    expect(text(r)).toContain("Processing your video");
    expect(mockWait).toHaveBeenCalledWith("j5", expect.anything());
  });

  it("a video that could not be processed offers Choose another video", async () => {
    mockPending.mockResolvedValue({ id: "j6", status: "processing", created_at: "2026-12-10T10:00:00Z" });
    mockWait.mockResolvedValue({ status: "failed", failureCode: null });
    const r = await mount(jest.fn());
    expect(text(r)).toContain("This video couldn’t be processed. Choose another video.");
    expect(labels(r)).toEqual(["Choose another video"]);
  });
});

describe("#4402 items 2, 4 and 7: shoot card and posts-checked cards", () => {
  it("shows the confirmed shoot in the listing zone and the text door pass", () => {
    const w = baseWorkspace({ contract: { id: "c1", state: "script_drafting", state_deadline_at: null, fix_rounds_used: 0, current_terms_version: 1 },
      shoot_plan: { shoot_at: "2026-12-05T18:30:00Z", arrival_note: "Ask for Tolu at the bar.", confirmed_at: "2026-12-02T10:00:00Z", proposed_by: "host" },
      reveal: { brand_name: "Tolu's Rooftop", place_name: "Tolu's Rooftop", place_address: "14 Admiralty Way" } });
    const r = render(<ShootCard workspace={w} state="script_drafting" creatorName="Ada Obi" />);
    const out = JSON.stringify(r.toJSON()).replace(/\",\"/g, "");
    expect(out).toContain("Shoot: Sat Dec 5, 7:30 PM Lagos time");
    expect(out).toContain("Arrival: Ask for Tolu at the bar.");
    expect(out).toContain("2 passes under Ada Obi");
    expect(out).toContain("Show this screen at the door.");
  });

  it("shows no Shoot card before the host confirms, or once the video is approved", () => {
    const unconfirmed = baseWorkspace({ shoot_plan: { shoot_at: "2026-12-05T18:30:00Z", confirmed_at: null } });
    expect(render(<ShootCard workspace={unconfirmed} state="accepted" />).toJSON()).toBeNull();
    const confirmed = baseWorkspace({ shoot_plan: { shoot_at: "2026-12-05T18:30:00Z", confirmed_at: "2026-12-02T10:00:00Z" } });
    expect(render(<ShootCard workspace={confirmed} state="approved" />).toJSON()).toBeNull();
  });

  it("Being checked: the posts card says Mingla's team is checking and when the creator is paid", () => {
    const w = baseWorkspace({ contract: { id: "c1", state: "posts_submitted", state_deadline_at: null, fix_rounds_used: 0 },
      posts: [{ id: "p1", platform: "instagram", url: "https://instagram.com/reel/x", check_status: "pending", submitted_at: "2026-12-15T09:12:00Z" }] });
    const out = JSON.stringify(render(<PostsStatus workspace={w} />).root.findAll((n) => (n.type as unknown) === "ProgramNotice").map((n) => n.props));
    expect(out).toContain("Mingla’s team is checking your links");
    expect(out).toContain("You’re paid 48 hours after they pass.");
  });

  it("Needs a fix: the reviewer's reason is shown", () => {
    const w = baseWorkspace({ contract: { id: "c1", state: "posts_failed", state_deadline_at: null, fix_rounds_used: 0 },
      posts: [{ id: "p1", platform: "instagram", url: "u", check_status: "failed", submitted_at: "2026-12-15T09:12:00Z", check_detail: { reason: "The post is missing @tolusrooftop." } }] });
    const notice = render(<PostsStatus workspace={w} />).root.find((n) => (n.type as unknown) === "ProgramNotice");
    expect(notice.props.title).toBe("One of your posts needs a fix");
    expect(notice.props.text).toBe("The post is missing @tolusrooftop.");
  });
});
