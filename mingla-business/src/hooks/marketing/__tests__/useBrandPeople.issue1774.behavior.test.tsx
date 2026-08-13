import React from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let auth={isAuthReady:true,user:{id:"user-1"} as {id:string}|null};
const listMock=jest.fn<(...args:any[])=>Promise<any>>();
const detailMock=jest.fn<(...args:any[])=>Promise<any>>();
jest.mock("../../../context/AuthContext",()=>({useAuth:()=>auth}));
jest.mock("../../../services/peopleService",()=>{
  class MockPeopleServiceError extends Error{constructor(public code:string,public retryable:boolean){super(code)}}
  return {PeopleServiceError:MockPeopleServiceError,listBrandPeople:(...args:any[])=>listMock(...args),getBrandPerson:(...args:any[])=>detailMock(...args)};
});

import { PeopleServiceError } from "../../../services/peopleService";
import { findCachedBrandPerson, useBrandPeople, useBrandPerson } from "../useBrandPeople";
import { marketingKeys } from "../marketingKeys";

const TR=require("react-test-renderer") as {create:(node:React.ReactElement)=>{unmount:()=>void};act:(callback:()=>void|Promise<void>)=>void|Promise<void>};
const person={personId:"person-1",displayName:"Ada",avatarUrl:null,updatedAt:"2026-08-13T00:00:00Z",contacts:[{id:"contact-1",channel:"email",value:"ada@example.test",isPrimary:true}],suppressions:[]};
const page={rows:[person],nextCursor:null,bookTotal:1,filteredTotal:1};
let client:QueryClient,tree:{unmount:()=>void}|null=null,latest:any;
function BookProbe(props:{accepted:boolean;rank:number;online?:boolean}){latest=useBrandPeople("brand-a",null,true,props.accepted,props.rank,props.online??true);return null}
function DetailProbe(props:{brandId:string;online?:boolean}){latest=useBrandPerson(props.brandId,"person-1",true,true,20,props.online??true);return null}
const mount=(node:React.ReactElement)=>{TR.act(()=>{tree=TR.create(<QueryClientProvider client={client}>{node}</QueryClientProvider>)})};
const flush=async()=>{await TR.act(async()=>{await new Promise((resolve)=>setTimeout(resolve,20))})};

beforeEach(()=>{auth={isAuthReady:true,user:{id:"user-1"}};listMock.mockReset();detailMock.mockReset();client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});latest=null});
afterEach(()=>{if(tree)TR.act(()=>tree?.unmount());tree=null;client.clear()});

describe("#1774 People hook state machine",()=>{
  test("resolved pending membership and scanner are terminal forbidden; accepted rank20 fetches",async()=>{
    mount(<BookProbe accepted={false} rank={50}/>); expect(latest.kind).toBe("forbidden"); expect(listMock).not.toHaveBeenCalled();
    TR.act(()=>tree?.unmount()); tree=null; mount(<BookProbe accepted rank={10}/>); expect(latest.kind).toBe("forbidden"); expect(listMock).not.toHaveBeenCalled();
    TR.act(()=>tree?.unmount()); tree=null; listMock.mockResolvedValue(page); mount(<BookProbe accepted rank={20}/>); await flush(); expect(latest.kind).toBe("success"); expect(latest.rows).toEqual([person]);
  });

  test("a server permission loss overrides cached rows with forbidden",async()=>{
    listMock.mockResolvedValueOnce(page); mount(<BookProbe accepted rank={20}/>); await flush(); expect(latest.rows[0].displayName).toBe("Ada");
    listMock.mockRejectedValueOnce(new PeopleServiceError("people_forbidden",false)); await TR.act(async()=>{await latest.refetch()}); await flush();
    expect(latest.kind).toBe("forbidden");
  });

  test("cached Book remains truthful offline and after a refresh failure",async()=>{
    listMock.mockResolvedValueOnce(page); mount(<BookProbe accepted rank={20} online/>); await flush();
    TR.act(()=>tree?.unmount()); tree=null; mount(<BookProbe accepted rank={20} online={false}/>); expect(latest.kind).toBe("offlineStale"); expect(latest.rows).toEqual([person]);
    TR.act(()=>tree?.unmount()); tree=null; listMock.mockRejectedValueOnce(new PeopleServiceError("people_temporarily_unavailable",false)); mount(<BookProbe accepted rank={20} online/>); await TR.act(async()=>{await latest.refetch()}); await flush(); expect(latest.kind).toBe("staleError"); expect(latest.rows).toEqual([person]);
  });

  test("detail cache seed is exact-brand only and server reconciliation replaces it",async()=>{
    client.setQueryData(marketingKeys.people.book("brand-a",null),{pages:[page],pageParams:[null]});
    expect(findCachedBrandPerson(client,"brand-a","person-1")).toEqual(person);
    expect(findCachedBrandPerson(client,"brand-b","person-1")).toBeUndefined();
    const reconciled={...person,displayName:"Ada Updated"}; detailMock.mockResolvedValue(reconciled); mount(<DetailProbe brandId="brand-a"/>);
    expect(latest.data).toEqual(person); expect(latest.isPlaceholderData).toBe(true); await flush(); expect(latest.data).toEqual(reconciled); expect(latest.kind).toBe("success");
  });

  test("detail hides wrong-brand cache, preserves exact cache offline, and clears it on 403",async()=>{
    client.setQueryData(marketingKeys.people.book("brand-a",null),{pages:[page],pageParams:[null]});
    detailMock.mockImplementation(()=>new Promise(()=>{})); mount(<DetailProbe brandId="brand-b"/>); expect(latest.data).toBeUndefined();
    TR.act(()=>tree?.unmount()); tree=null; detailMock.mockImplementation(()=>new Promise(()=>{})); mount(<DetailProbe brandId="brand-a" online={false}/>); expect(latest.data).toEqual(person); expect(latest.kind).toBe("offlineStale");
    TR.act(()=>tree?.unmount()); tree=null; await client.cancelQueries({queryKey:marketingKeys.people.detail("brand-a","person-1")});client.removeQueries({queryKey:marketingKeys.people.detail("brand-a","person-1")});detailMock.mockRejectedValue(new PeopleServiceError("people_forbidden",false)); mount(<DetailProbe brandId="brand-a"/>); await flush(); expect(latest.kind).toBe("forbidden");
  });
});
