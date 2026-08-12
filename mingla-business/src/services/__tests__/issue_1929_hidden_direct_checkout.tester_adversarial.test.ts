import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const rpcMock = jest.fn() as ReturnType<typeof jest.fn>;
const fromMock = jest.fn() as ReturnType<typeof jest.fn>;
jest.mock("../supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a), from: (...a: unknown[]) => fromMock(...a) } }));
jest.mock("@mingla/offering-rendering", () => ({ isThemeAnimationSlug: () => false, isThemeColor: () => false, isThemeFontSlug: () => false }), { virtual: true });
import { getPublicEventById, getPublicEventBySlug } from "../publicEventsService";

const bundle = (patch: Record<string, unknown> = {}) => ({ id:"event-a",brandId:"brand-a",brandSlug:"brand",eventSlug:"event",name:"Exact",status:"ended",currency:"NGN",tickets:[],brand:{id:"brand-a",slug:"brand",name:"Brand"},...patch });
const query = (data: unknown, error: unknown = null) => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({data,error}) }), maybeSingle: async () => ({data,error}) }) }) });

beforeEach(() => { rpcMock.mockReset(); fromMock.mockReset(); });
describe("#1929 tester Business exact-reader security composition", () => {
  test.each([
    ["slug", () => getPublicEventBySlug("brand","event")],
    ["uuid", () => getPublicEventById("event-a")],
  ])("%s valid historical standard bundle never touches RSVP fallback", async (_mode, read) => {
    rpcMock.mockResolvedValue({data:bundle(),error:null});
    await expect(read()).resolves.toMatchObject({event:{id:"event-a"}});
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  test.each(["event","trip","experience","private",null])("NULL bundle fallback type %p cannot hydrate", async (event_type) => {
    rpcMock.mockResolvedValue({data:null,error:null});
    fromMock.mockReturnValue(query({event_type,id:"forged"}));
    await expect(getPublicEventById("absent")).resolves.toBeNull();
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  test("forged RSVP discriminator inside a valid standard bundle stays on bundle authority", async () => {
    rpcMock.mockResolvedValue({data:bundle({event_type:"rsvp"}),error:null});
    await expect(getPublicEventBySlug("brand","event")).resolves.toMatchObject({event:{id:"event-a"}});
    expect(fromMock).not.toHaveBeenCalled();
  });

  test.each([[{message:"db-down"},null],[null,[]]])("error/malformed payload never opens fallback", async (error,data) => {
    rpcMock.mockResolvedValue({data,error});
    await expect(getPublicEventById("event-a")).rejects.toBeTruthy();
    expect(fromMock).not.toHaveBeenCalled();
  });
});
