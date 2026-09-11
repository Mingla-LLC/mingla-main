import { beforeEach,describe,expect,jest,test } from "@jest/globals";
const rpc=jest.fn<(...args:unknown[])=>Promise<{data:any;error:any}>>();
jest.mock("../supabase",()=>({supabase:{rpc:(...args:unknown[])=>rpc(...args)}}));
jest.mock("../../diagnostics/reportNonFatal",()=>({reportNonFatal:jest.fn()}));
import { BrandCircleReachError,listBrandCircleReach,parseBrandCircleReach } from "../brandCircleReachService";
const availability={followers:{state:"ready",reason:null,refreshedAt:"2026-09-11T12:00:00Z",expiresAt:"2026-09-11T12:05:00Z"},extended:{state:"unavailable",reason:"controls_not_live",refreshedAt:null,expiresAt:null}};
const row={memberId:"17770000-0000-4000-8000-000000000010",ring:"follower",displayName:"Amina Cole",avatarUrl:null,reasonCode:"follows_brand",reasonLabel:"Follows your brand."};
const payload={schemaVersion:1,state:"partial",snapshotVersion:7,counts:{followers:1,extended:null,total:null},availability,rows:[row],nextCursor:null};
beforeEach(()=>{rpc.mockReset()});
describe("#1777 Brand Circle service boundary",()=>{
  test("forwards exact RPC arguments and parses the privacy-safe response",async()=>{rpc.mockResolvedValue({data:payload,error:null});await expect(listBrandCircleReach({brandId:"brand-1",ring:"all",cursor:null,limit:50})).resolves.toEqual(payload);expect(rpc).toHaveBeenCalledWith("get_brand_circle_reach",{p_brand_id:"brand-1",p_ring:"all",p_cursor:null,p_limit:50})});
  test.each(["email","phone","contact","address","device","appsflyer","eventId","path","relationship"])("rejects forbidden or extra row key %s",(key)=>expect(()=>parseBrandCircleReach({...payload,rows:[{...row,[key]:"secret"}]})).toThrow(BrandCircleReachError));
  test("rejects connector reasons and fabricated unavailable data",()=>{expect(()=>parseBrandCircleReach({...payload,rows:[{...row,ring:"extended",reasonCode:"connected_through_person",reasonLabel:"Connected through Pat."}]})).toThrow();expect(()=>parseBrandCircleReach({...payload,state:"unavailable",snapshotVersion:7})).toThrow()});
  test("maps only stable errors and hides raw failures",async()=>{rpc.mockResolvedValueOnce({data:null,error:{message:"circle_forbidden: private"}});await expect(listBrandCircleReach({brandId:"b",ring:"all",cursor:null,limit:50})).rejects.toEqual(expect.objectContaining({code:"circle_forbidden",retryable:false}));rpc.mockResolvedValueOnce({data:null,error:{message:"SQL leaked"}});await expect(listBrandCircleReach({brandId:"b",ring:"all",cursor:null,limit:50})).rejects.toEqual(expect.objectContaining({code:"circle_temporarily_unavailable",retryable:true}))});
});
