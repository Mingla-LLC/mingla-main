import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { getBrandPerson, listBrandPeople, PeopleServiceError } from "../../services/peopleService";
import type { BrandPersonDetail, BrandPersonSummary } from "../../types/people";
import { marketingKeys } from "./marketingKeys";

const retry = (count:number,error:Error):boolean => count<2 && error instanceof PeopleServiceError && error.retryable;
export function isPeopleForbidden(error:unknown):boolean{return error instanceof PeopleServiceError&&error.code==="people_forbidden"}
export function findCachedBrandPerson(queryClient:QueryClient,brandId:string,personId:string):BrandPersonSummary|undefined{
  for(const [,value] of queryClient.getQueriesData({queryKey:marketingKeys.people.all(brandId)})){
    const pages=(value as {pages?:{rows?:BrandPersonSummary[]}[]}|undefined)?.pages;
    const found=pages?.flatMap((page)=>page.rows??[]).find((person)=>person.personId===personId);
    if(found)return found;
  }
  return undefined;
}
export function useBrandPeople(brandId:string|null,search:string|null,roleResolved:boolean,accepted:boolean,rank:number,online=true){
  const {isAuthReady,user}=useAuth(),queryClient=useQueryClient(); const allowed=roleResolved&&accepted&&rank>=20;
  const enabled=isAuthReady&&user!==null&&brandId!==null&&allowed;
  useEffect(()=>{if(!enabled&&brandId!==null)void queryClient.cancelQueries({queryKey:marketingKeys.people.all(brandId)})},[brandId,enabled,queryClient]);
  const query=useInfiniteQuery({queryKey:brandId?marketingKeys.people.book(brandId,search):marketingKeys.all,
    queryFn:({pageParam})=>listBrandPeople({brandId:brandId!,search:search?.trim()||null,cursor:pageParam,limit:50}),
    initialPageParam:null as {updatedAt:string;personId:string}|null,getNextPageParam:(page)=>page.nextCursor,
    enabled,staleTime:30_000,retry});
  const rows=query.data?.pages.flatMap((p)=>p.rows)??[]; const first=query.data?.pages[0];
  const hasData=query.data!==undefined;
  const kind=!isAuthReady||user===null?"authLoading":!roleResolved?"roleLoading":!allowed||isPeopleForbidden(query.error)?"forbidden":!online&&hasData?"offlineStale":!online&&!hasData?"offlineEmpty":query.isLoading?"loading":query.isError&&hasData?"staleError":query.isError?"error":query.isFetchingNextPage?"loadingMore":query.isFetching?"refreshing":"success";
  return {...query,kind,rows,bookTotal:first?.bookTotal??null,filteredTotal:first?.filteredTotal??null,hasResolved:query.isFetched};
}
export function useBrandPerson(brandId:string|null,personId:string|null,roleResolved:boolean,accepted:boolean,rank:number,online=true){
  const {isAuthReady,user}=useAuth(),queryClient=useQueryClient(); const allowed=roleResolved&&accepted&&rank>=20; const enabled=isAuthReady&&user!==null&&brandId!==null&&personId!==null&&allowed;
  useEffect(()=>{if(!enabled&&brandId!==null)void queryClient.cancelQueries({queryKey:marketingKeys.people.all(brandId)})},[brandId,enabled,queryClient]);
  const query=useQuery<BrandPersonDetail|BrandPersonSummary>({queryKey:brandId&&personId?marketingKeys.people.detail(brandId,personId):marketingKeys.all,
    queryFn:()=>getBrandPerson({brandId:brandId!,personId:personId!}),enabled,staleTime:30_000,retry,
    placeholderData:()=>brandId&&personId?findCachedBrandPerson(queryClient,brandId,personId):undefined});
  const hasData=query.data!==undefined,error=query.error instanceof PeopleServiceError?query.error.code:null;
  const kind=!isAuthReady||user===null?"authLoading":!roleResolved?"roleLoading":!allowed||error==="people_forbidden"?"forbidden":error==="people_not_found"?"notFound":!online&&hasData?"offlineStale":!online?"offlineEmpty":query.isLoading?"loading":query.isError&&hasData?"staleError":query.isError?"error":query.isFetching?"refreshing":"success";
  return {...query,kind};
}
