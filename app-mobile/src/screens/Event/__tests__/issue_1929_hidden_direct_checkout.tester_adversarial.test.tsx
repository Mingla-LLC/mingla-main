jest.mock("@mingla/offering-rendering", () => ({ isThemeAnimationSlug:()=>false,isThemeColor:()=>false,isThemeFontSlug:()=>false,forwardableAcquisitionState:()=>undefined }));
jest.mock("@tanstack/react-query", () => ({ useQuery:jest.fn() }));
jest.mock("../../../services/supabase", () => ({ supabase:{rpc:jest.fn()} }));
import { acceptRsvpLegacySeed, directEventColdReadPlan, mapRpcPayloadToPublicEvent } from "../../../hooks/usePublicEventBySlug";

const canonical = mapRpcPayloadToPublicEvent({id:"standard",brandId:"brand",brandSlug:"brand",eventSlug:"standard",name:"Standard",status:"scheduled",currency:"USD",tickets:[{id:"bundle-only",name:"Only",isFree:true,availableOnline:true}],brand:null});
describe("#1929 tester Consumer screen rail separation", () => {
  test("cold standard bundle disables both legacy seed and legacy ticket reads", () => {
    expect(directEventColdReadPlan(false,{isSuccess:true,data:canonical},true)).toEqual(expect.objectContaining({canonical,allowLegacySeedRead:false,allowLegacyTicketRead:false}));
  });
  test("transport/incomplete states cannot bootstrap any legacy reader", () => {
    expect(directEventColdReadPlan(false,{isSuccess:false,data:undefined},true)).toEqual(expect.objectContaining({canonical:null,allowLegacySeedRead:false}));
    expect(directEventColdReadPlan(false,{isSuccess:true,data:null},false)).toEqual(expect.objectContaining({canonical:null,allowLegacySeedRead:false}));
  });
  test.each([{eventType:"event"},{eventType:"trip"},{eventType:"experience"},{eventType:"RSVP"},{id:"missing-type"},null])("legacy candidate %p is not RSVP", (candidate) => {
    expect(acceptRsvpLegacySeed(candidate as any)).toBeNull();
  });
  test("exact lowercase RSVP remains separately preserved", () => {
    expect(acceptRsvpLegacySeed({eventType:"rsvp",eventId:"rsvp"})).toEqual({eventType:"rsvp",eventId:"rsvp"});
  });
});
