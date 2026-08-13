import { describe,expect,test } from "@jest/globals";
import { resolveBookSheetView } from "../bookSheetState";

describe("#1774 truthful Book sheet state resolver",()=>{
  test("search loading never announces a fabricated zero",()=>expect(resolveBookSheetView({kind:"loading",rowCount:0,hasSearch:true,bookTotal:null,filteredTotal:null})).toEqual({mode:"loading",subtitle:"Searching…",status:null}));
  test("terminal search error and offline-no-cache are recoverable states",()=>{
    expect(resolveBookSheetView({kind:"error",rowCount:0,hasSearch:true,bookTotal:null,filteredTotal:null}).mode).toBe("error");
    expect(resolveBookSheetView({kind:"offlineEmpty",rowCount:0,hasSearch:false,bookTotal:null,filteredTotal:null}).mode).toBe("offlineEmpty");
  });
  test.each([["refreshing","Updating…"],["offlineStale","Offline — showing saved contacts."],["staleError","Couldn’t update — showing saved contacts."]])("%s retains rows with truthful status",(kind,status)=>expect(resolveBookSheetView({kind,rowCount:3,hasSearch:false,bookTotal:9,filteredTotal:9})).toEqual({mode:"rows",subtitle:"9 contacts",status}));
  test("resolved empty alone can announce zero",()=>expect(resolveBookSheetView({kind:"success",rowCount:0,hasSearch:true,bookTotal:9,filteredTotal:0})).toEqual({mode:"empty",subtitle:"0 matches",status:null}));
  test.each([
    [{kind:"success",rowCount:1,hasSearch:false,bookTotal:1,filteredTotal:1},"1 contact"],
    [{kind:"success",rowCount:1,hasSearch:true,bookTotal:9,filteredTotal:1},"1 match"],
    [{kind:"success",rowCount:2,hasSearch:false,bookTotal:2,filteredTotal:2},"2 contacts"],
    [{kind:"success",rowCount:2,hasSearch:true,bookTotal:9,filteredTotal:2},"2 matches"],
  ])("uses truthful singular and plural count copy",(input,subtitle)=>expect(resolveBookSheetView(input)).toMatchObject({mode:"rows",subtitle}));
  test("resolved rows keep an unknown server count hidden",()=>expect(resolveBookSheetView({kind:"success",rowCount:1,hasSearch:false,bookTotal:null,filteredTotal:null}).subtitle).toBe(""));
});
