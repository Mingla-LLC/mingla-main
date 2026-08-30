let options: Record<string, unknown>;
jest.mock("@tanstack/react-query", () => ({ useQuery: (o: Record<string, unknown>) => (options=o,o) }));
jest.mock("@mingla/offering-rendering", () => ({ isThemeAnimationSlug:()=>false,isThemeColor:()=>false,isThemeFontSlug:()=>false,forwardableAcquisitionState:()=>undefined }));
jest.mock("../../services/supabase", () => ({ supabase:{rpc:jest.fn()} }));
import { supabase } from "../../services/supabase";
import { mapRpcPayloadToPublicEvent, usePublicEventBySlug } from "../usePublicEventBySlug";
const rpc = supabase.rpc as jest.Mock;
const payload = {id:"hidden",brandId:"brand",brandSlug:"brand",eventSlug:"hidden",name:"Hidden",status:"cancelled",currency:"NGN",brand:null,tickets:[{id:"h",name:"Hidden",isHidden:true,isDisabled:false,availableOnline:true,remaining:2,capacity:9},{id:"d",name:"Disabled",isHidden:false,isDisabled:true,availableOnline:true,remaining:0,capacity:9}]};

describe("#1929 tester Consumer canonical bundle", () => {
  beforeEach(()=>rpc.mockReset());
  test("cold standard read makes one exact bundle call and preserves historical/tier truth", async () => {
    rpc.mockResolvedValue({data:payload,error:null});
    usePublicEventBySlug("brand","hidden");
    const result = await (options.queryFn as () => Promise<any>)();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("pg_direct_event_checkout_bundle",{p_event_id:null,p_brand_slug:"brand",p_event_slug:"hidden"});
    expect(result.event.status).toBe("cancelled");
    expect(result.event.tickets).toEqual(expect.arrayContaining([expect.objectContaining({id:"h",visibility:"hidden",capacity:2}),expect.objectContaining({id:"d",visibility:"disabled",capacity:0})]));
  });
  test.each([undefined,false,0,"",[payload],{...payload,brand:[]}])("malformed %p never fabricates a standard event", async (data) => {
    rpc.mockResolvedValue({data,error:null});
    usePublicEventBySlug("brand","hidden");
    await expect((options.queryFn as () => Promise<unknown>)()).rejects.toThrow("invalid_direct_event_checkout_bundle");
  });
  test("mapping does not expose visibility or seed/list cache data", () => {
    const mapped = mapRpcPayloadToPublicEvent({...payload,visibility:"hidden",business_draft:{secret:true}});
    expect(mapped).not.toHaveProperty("visibility");
    expect(mapped.event).not.toHaveProperty("visibility");
    expect(JSON.stringify(mapped)).not.toContain("business_draft");
  });
});
