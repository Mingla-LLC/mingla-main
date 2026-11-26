/* eslint-disable @typescript-eslint/no-require-imports, import/first -- jest doubles are declared before the modules they replace */
/**
 * #4541 R2.2 / R2.3 (T-28) — the Explorer form screen, mounted for real with
 * React Query and the shared renderer; only the network, the router and the
 * store are doubles.
 *
 *   - Every state in R2.3 renders with its testID and its exact copy (read
 *     from the real en/forms.json, so a missing key fails as a raw key).
 *   - Send stays off until the required visible questions are answered; a
 *     signed-in held item submits as that item (R2.2); a personal link submits
 *     with its token and no held item, even when another account is signed in.
 *   - Refusals: invalid answers, questions changed, updated elsewhere, offline,
 *     too many tries, not a holder, link replaced, paused.
 *   - Editing sends `expectedEditCount`; Back with typing asks first.
 *
 * Red on revert of any state's copy key, the Send gate, or the credential
 * rules. Runs under app-mobile/jest.issue2774.render.cjs.
 */
import React from "react";

const TestRenderer = require("react-test-renderer") as typeof import("react-test-renderer");
const { act } = TestRenderer;

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

jest.mock("react-i18next", () => {
  const forms = jest.requireActual("../../../i18n/locales/en/forms.json");
  const t = (key: string, options: Record<string, unknown> = {}): string => {
    const value = forms[key];
    if (typeof value !== "string") return key;
    return value.replace(/{{\s*(\w+)\s*}}/g, (m: string, name: string) => (name in options ? String(options[name]) : m));
  };
  return { initReactI18next: { type: "3rdParty", init: () => undefined }, useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../../../services/supabase", () => ({ supabase: { rpc: jest.fn(), functions: { invoke: jest.fn() } } }));
jest.mock("../RsvpFormWebDateInput", () => ({ RsvpFormWebDateInput: () => null }), { virtual: true });
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
// react-native-web's TextInput reaches for `document`; this lane is node-env.
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const ReactActual = jest.requireActual("react");
  const TextInput = ReactActual.forwardRef((props: Record<string, unknown>, _ref: unknown) =>
    ReactActual.createElement("TextInput", props));
  return { ...actual, TextInput };
});
jest.mock("../../ui/BaseBottomSheet", () => {
  const ReactActual = jest.requireActual("react");
  return {
    BaseBottomSheet: (props: Record<string, unknown>) =>
      props.visible === true ? ReactActual.createElement("SheetHost", null, props.children) : null,
  };
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockListeners: ((ev: { preventDefault: () => void; data: { action: unknown } }) => void)[] = [];
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useNavigation: () => ({
    addListener: (_e: string, cb: (ev: { preventDefault: () => void; data: { action: unknown } }) => void) => {
      mockListeners.push(cb);
      return () => undefined;
    },
    dispatch: jest.fn(),
  }),
}));
const mockStore: { user: { id: string } | null; profile: { first_name?: string; last_name?: string } | null } = {
  user: { id: "user-a" },
  profile: { first_name: "Ada", last_name: "Okafor" },
};
jest.mock("../../../store/appStore", () => ({
  useAppStore: (select: (s: typeof mockStore) => unknown) => select(mockStore),
}));
jest.mock("../../../services/postHogService", () => ({ postHogService: { capture: jest.fn() } }));
jest.mock("../../../utils/authCleanup", () => ({ signOutWithPrivateCleanup: jest.fn(async () => ({ error: null })) }));
const mockApi = {
  fetchLinkForm: jest.fn(),
  fetchMyForm: jest.fn(),
  fetchBlastForm: jest.fn(),
  fetchMyPendingBrandForms: jest.fn(async () => [] as unknown[]),
  submitBrandForm: jest.fn(),
};
jest.mock("../../../services/brandFormService", () => {
  const actual = jest.requireActual("../../../services/brandFormService");
  return {
    ...actual,
    fetchLinkForm: (...a: unknown[]) => mockApi.fetchLinkForm(...a),
    fetchMyForm: (...a: unknown[]) => mockApi.fetchMyForm(...a),
    fetchBlastForm: (...a: unknown[]) => mockApi.fetchBlastForm(...a),
    fetchMyPendingBrandForms: () => mockApi.fetchMyPendingBrandForms(),
    submitBrandForm: (...a: unknown[]) => mockApi.submitBrandForm(...a),
  };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrandFormScreen } from "../BrandFormScreen";
import { parseFormRouteParams } from "../formRoute";
import { BrandFormError, type FormScreenRead } from "../../../services/brandFormService";

const forms = require("../../../i18n/locales/en/forms.json") as Record<string, string>;
const FORM = "45410000-0000-4000-8000-000000000004";
const VERSION = "45410000-0000-4000-8000-000000000005";
const EVENT = "45410000-0000-4000-8000-0000000000e1";
const ORDER = "45410000-0000-4000-8000-0000000000a1";
const GUEST = "45410000-0000-4000-8000-0000000000b2";
const CAMPAIGN = "45410000-0000-4000-8000-0000000000c1";
const TOKEN = "ab".repeat(32);
const Q1 = "45410000-0000-4000-8000-0000000000f1";
const mountedRoots = new Set<import("react-test-renderer").ReactTestRenderer>();

const read = (over: Partial<FormScreenRead> = {}): FormScreenRead => ({
  state: "unanswered",
  form: {
    id: FORM,
    name: "Guest details",
    status: "live",
    versionId: VERSION,
    definition: { title: "Guest details", questions: [{ id: Q1, position: 1, type: "short_text", label: "Dietary needs", required: true }] },
    doorFullAnswers: true,
  },
  brand: { displayName: "Harmattan Club" },
  identity: null,
  eventId: EVENT,
  response: null,
  editable: true,
  botTicket: null,
  ...over,
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

async function mount(raw: Record<string, string>): Promise<import("react-test-renderer").ReactTestRenderer> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } });
  let root!: import("react-test-renderer").ReactTestRenderer;
  await act(async () => {
    root = TestRenderer.create(
      <QueryClientProvider client={client}>
        <BrandFormScreen params={parseFormRouteParams({ formId: FORM, ...raw })} routePath={`/form/${FORM}`} />
      </QueryClientProvider>,
    );
    mountedRoots.add(root);
  });
  await flush();
  return root;
}

const text = (root: import("react-test-renderer").ReactTestRenderer): string => {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object" && "children" in (node as object)) walk((node as { children: unknown }).children);
  };
  walk(root.toJSON());
  return out.join(" ");
};
const byTestId = (root: import("react-test-renderer").ReactTestRenderer, id: string) =>
  root.root.findAll((n) => n.props.testID === id && typeof n.type !== "string");
const has = (root: import("react-test-renderer").ReactTestRenderer, id: string): boolean => byTestId(root, id).length > 0;
const press = async (root: import("react-test-renderer").ReactTestRenderer, id: string): Promise<void> => {
  await act(async () => {
    byTestId(root, id)[0].props.onPress();
  });
  await flush();
};
const type = async (root: import("react-test-renderer").ReactTestRenderer, value: string): Promise<void> => {
  const input = root.root.findAll((n) => typeof n.props.onChangeText === "function" && typeof n.type !== "string")[0];
  await act(async () => {
    input.props.onChangeText(value);
  });
  await flush();
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockListeners.length = 0;
  mockStore.user = { id: "user-a" };
  mockStore.profile = { first_name: "Ada", last_name: "Okafor" };
  mockApi.fetchMyPendingBrandForms.mockResolvedValue([]);
  const storage = require("@react-native-async-storage/async-storage");
  await storage.clear();
});

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots) root.unmount();
  });
  mountedRoots.clear();
  const storage = require("@react-native-async-storage/async-storage");
  await storage.clear();
});

describe("#4541 T-28 — fill, send, saved", () => {
  it("shows the door line, keeps Send off until required questions are answered, and submits as the held order", async () => {
    mockApi.fetchMyForm.mockResolvedValue(read());
    mockApi.submitBrandForm.mockResolvedValue({ responseId: "r1", editCount: 0, versionId: VERSION, created: true });
    const root = await mount({ event: EVENT, as: "order", sid: ORDER, from: "ticket" });
    expect(has(root, "form-screen-fill")).toBe(true);
    expect(text(root)).toContain(forms.doorLine);
    expect(text(root)).toContain(forms.needsAnswers);
    expect(byTestId(root, "form-screen-send")[0].props.disabled).toBe(true);
    expect(mockApi.fetchMyForm).toHaveBeenCalledWith(FORM, EVENT);

    await type(root, "Vegan");
    expect(byTestId(root, "form-screen-send")[0].props.disabled).toBe(false);
    await press(root, "form-screen-send");
    expect(mockApi.submitBrandForm).toHaveBeenCalledWith(expect.objectContaining({
      formId: FORM, versionId: VERSION, eventId: EVENT, orderId: ORDER, rsvpId: null, token: null, answers: { [Q1]: "Vegan" },
    }));
    expect(has(root, "form-screen-saved")).toBe(true);
    expect(text(root)).toContain(forms.savedTitle);
    expect(text(root)).toContain("You can change them until Harmattan Club closes the form.");
  });

  it("a personal link answers as the link's person even when another account is signed in (scenario 16)", async () => {
    mockApi.fetchLinkForm.mockResolvedValue(read({ identity: "Bola A." }));
    mockApi.submitBrandForm.mockResolvedValue({ responseId: "r1", editCount: 0, versionId: VERSION, created: true });
    const root = await mount({ t: TOKEN, as: "order", sid: ORDER });
    expect(mockApi.fetchLinkForm).toHaveBeenCalledWith(FORM, TOKEN);
    expect(text(root)).toContain("This link is just for one person");
    expect(text(root)).toContain("It was sent to Bola A.");
    await press(root, "form-link-sheet-secondary");
    expect(text(root)).toContain("Answering as Bola A.");
    expect(text(root)).toContain(forms.notYou);
    await type(root, "Halal");
    await press(root, "form-screen-send");
    const body = mockApi.submitBrandForm.mock.calls[0][0];
    expect(body.token).toBe(TOKEN);
    expect(body.orderId).toBeNull();
  });
});

describe("#4541 T-28 — refusals", () => {
  const setup = async (error: BrandFormError) => {
    mockApi.fetchMyForm.mockResolvedValue(read());
    mockApi.submitBrandForm.mockRejectedValue(error);
    const root = await mount({ event: EVENT, as: "order", sid: ORDER });
    await type(root, "Vegan");
    await press(root, "form-screen-send");
    return root;
  };

  it("invalid answers: banner and the question's own error", async () => {
    const root = await setup(new BrandFormError("form_answers_invalid", 422, { errors: [{ questionId: Q1, code: "too_long" }] }));
    expect(has(root, "form-screen-err")).toBe(true);
    expect(text(root)).toContain(forms.errBanner);
    expect(text(root)).toContain(forms.fieldTooLong);
  });

  it("questions changed: refetch and keep the typed answer", async () => {
    const root = await setup(new BrandFormError("form_changed", 409));
    expect(has(root, "form-screen-changed")).toBe(true);
    expect(text(root)).toContain(forms.changedTitle);
    expect(mockApi.fetchMyForm.mock.calls.length).toBeGreaterThanOrEqual(2);
    const input = root.root.findAll((n) => typeof n.props.onChangeText === "function" && typeof n.type !== "string")[0];
    expect(input.props.value).toBe("Vegan");
  });

  it("updated elsewhere: Reload", async () => {
    const root = await setup(new BrandFormError("response_stale", 409));
    expect(has(root, "form-screen-stale")).toBe(true);
    expect(text(root)).toContain(forms.staleTitle);
    expect(text(root)).toContain(forms.reload);
  });

  it.each([
    ["network", forms.offline],
    ["rate_limited", forms.rateLimited],
    ["open_reply_limit", forms.openReplyLimit],
    ["bot_check_failed", forms.botCheckFailed],
  ])("%s keeps the answers and shows its line", async (code, line) => {
    const root = await setup(new BrandFormError(code, null));
    expect(has(root, "form-screen-fill")).toBe(true);
    expect(text(root)).toContain(line);
    if (code === "network") expect(text(root)).toContain(forms.offlineKept);
  });

  it("not a holder of this event", async () => {
    mockApi.fetchMyPendingBrandForms.mockResolvedValue([]);
    const root = await setup(new BrandFormError("not_holder", 403));
    expect(has(root, "form-screen-notholder")).toBe(true);
    expect(text(root)).toContain("This form is for guests of this event");
  });
});

describe("#4541 T-28 — whole-screen states", () => {
  it.each([
    ["form_not_found", "notfound", forms.notFoundTitle],
    ["link_revoked", "replaced", forms.replacedTitle],
    ["forms_paused", "paused", forms.pausedTitle],
    ["network", "loadfail", forms.loadFailTitle],
  ])("a read refused with %s shows %s", async (code, state, title) => {
    mockApi.fetchMyForm.mockRejectedValue(new BrandFormError(code, null));
    const root = await mount({ event: EVENT, as: "order", sid: ORDER });
    expect(has(root, `form-screen-${state}`)).toBe(true);
    expect(text(root)).toContain(title);
  });

  it("signed out on a page form: sign in, holding the route", async () => {
    mockStore.user = null;
    const root = await mount({ event: EVENT });
    expect(has(root, "form-screen-signin")).toBe(true);
    expect(text(root)).toContain(forms.signInTitle);
    expect(text(root)).toContain(forms.signInLinkHint);
    expect(mockApi.fetchMyForm).not.toHaveBeenCalled();
  });

  it("a link that needs a code in the app asks to sign in (Q7); signed in, it reopens without the token", async () => {
    mockApi.fetchLinkForm.mockResolvedValue(read({ state: "code_required" }));
    const root = await mount({ t: TOKEN, event: EVENT });
    expect(has(root, "form-screen-signin")).toBe(true);
    await press(root, "form-screen-signin-action-0");
    expect(mockRouter.replace).toHaveBeenCalledWith(`/form/${FORM}`);
  });

  it("signed out, Sign in holds the route for after sign-in and goes to the welcome screen", async () => {
    mockStore.user = null;
    const root = await mount({ event: EVENT });
    await press(root, "form-screen-signin-action-0");
    expect(mockRouter.replace).toHaveBeenCalledWith("/");
    const storage = require("@react-native-async-storage/async-storage");
    expect(await storage.getItem("mingla_pending_form_route_v1")).toContain(`/form/${FORM}`);
  });

  it("closed with an answer shows the last answers", async () => {
    mockApi.fetchMyForm.mockResolvedValue(read({
      form: { ...read().form, status: "closed" },
      response: { id: "r1", versionId: VERSION, definition: null, isCurrentVersion: true, answers: { [Q1]: "Vegan" }, editCount: 0, updatedAt: null },
    }));
    const root = await mount({ event: EVENT, as: "order", sid: ORDER });
    expect(has(root, "form-screen-closed")).toBe(true);
    expect(text(root)).toContain(forms.closedLast);
    expect(text(root)).toContain("Vegan");
  });

  it("an ended or cancelled event closes the questions", async () => {
    mockApi.fetchMyForm.mockResolvedValue(read());
    mockApi.fetchMyPendingBrandForms.mockResolvedValue([{
      eventId: EVENT, eventTitle: "Detty", eventStatus: "cancelled", subject: { kind: "order", id: ORDER },
      mode: "required_step", required: true, formId: FORM, formName: "Guest details", formStatus: "live",
      answered: false, answeredSource: null, brand: { displayName: "Harmattan Club" },
    }]);
    const root = await mount({ event: EVENT, as: "order", sid: ORDER });
    expect(has(root, "form-screen-ended")).toBe(true);
    expect(text(root)).toContain(forms.cancelledTitle);
    expect(text(root)).toContain(forms.endedBody);
  });

  it("answered: view, then edit sends the edit count", async () => {
    mockApi.fetchMyForm.mockResolvedValue(read({
      state: "answered",
      response: { id: "r1", versionId: "old", definition: null, isCurrentVersion: false, answers: { [Q1]: "Vegan" }, editCount: 3, updatedAt: "2026-11-01T10:00:00Z" },
    }));
    mockApi.submitBrandForm.mockResolvedValue({ responseId: "r1", editCount: 4, versionId: VERSION, created: false });
    const root = await mount({ event: EVENT, as: "order", sid: ORDER });
    expect(has(root, "form-screen-view")).toBe(true);
    expect(text(root)).toContain(forms.viewTitle);
    expect(text(root)).toContain(forms.earlierVersion);
    await press(root, "form-screen-edit-answers");
    expect(has(root, "form-screen-edit")).toBe(true);
    expect(text(root)).toContain(forms.saveChanges);
    await press(root, "form-screen-send");
    expect(mockApi.submitBrandForm.mock.calls[0][0].expectedEditCount).toBe(3);
  });

  it("a claimed plus-one answers for themselves", async () => {
    mockApi.fetchMyForm.mockResolvedValue(read());
    const root = await mount({ event: EVENT, as: "rsvp_guest", sid: GUEST });
    expect(has(root, "form-screen-plusone")).toBe(true);
    expect(text(root)).toContain("Answering for yourself, Ada O.");
  });

  it("a Blast form signed out answers as Unknown (Q8)", async () => {
    mockStore.user = null;
    mockApi.fetchBlastForm.mockResolvedValue(read({ eventId: null, editable: false, botTicket: "ticket" }));
    mockApi.submitBrandForm.mockResolvedValue({ responseId: "r1", editCount: 0, versionId: VERSION, created: true });
    const root = await mount({ campaign: CAMPAIGN, from: "blast" });
    expect(has(root, "form-screen-unknown")).toBe(true);
    expect(text(root)).toContain("You're answering without signing in. Harmattan Club won't see your name");
    await type(root, "Hi");
    await press(root, "form-screen-send");
    expect(mockApi.submitBrandForm.mock.calls[0][0]).toMatchObject({ campaignId: CAMPAIGN, botTicket: "ticket", website: "" });
  });
});

describe("#4541 T-28 — leaving", () => {
  it("Back with unsent typing asks first; Leave goes back", async () => {
    mockApi.fetchMyForm.mockResolvedValue(read());
    const root = await mount({ event: EVENT, as: "order", sid: ORDER });
    await type(root, "Vegan");
    await press(root, "form-screen-back");
    expect(text(root)).toContain(forms.leaveTitle);
    expect(mockRouter.back).not.toHaveBeenCalled();
    await press(root, "form-leave-sheet-secondary");
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("a swipe or Android back with typing is held by the same sheet", async () => {
    mockApi.fetchMyForm.mockResolvedValue(read());
    const root = await mount({ event: EVENT, as: "order", sid: ORDER });
    await type(root, "Vegan");
    const preventDefault = jest.fn();
    await act(async () => {
      mockListeners[mockListeners.length - 1]({ preventDefault, data: { action: { type: "GO_BACK" } } });
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(text(root)).toContain(forms.leaveTitle);
  });
});
