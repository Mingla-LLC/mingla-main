import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { BrandCircleReachError, listBrandCircleReach } from "../../services/brandCircleReachService";
import type { BrandCircleCursor, BrandCircleReachPage, BrandCircleRequestRing } from "../../types/brandCircleReach";
import { useFeatureFlag } from "../useFeatureFlag";
import { marketingKeys } from "./marketingKeys";

const retry=(count:number,error:Error)=>count<1&&error instanceof BrandCircleReachError&&error.retryable&&error.code!=="circle_cursor_stale";
export function useBrandCircleReach(brandId:string|null,ring:BrandCircleRequestRing,roleResolved:boolean,accepted:boolean,rank:number,online=true,active=true){
  const {isAuthReady,user}=useAuth(),flag=useFeatureFlag("brand_circle_followers_v1"),client=useQueryClient();
  const [expired,setExpired]=useState(false),previousBrand=useRef<string|null>(brandId);
  const allowed=roleResolved&&accepted&&rank>=20,flagReady=!flag.isPending&&!flag.isFetching&&!flag.isError;
  const enabled=active&&isAuthReady&&user!==null&&brandId!==null&&allowed&&online&&flagReady&&flag.data===true;
  const query=useInfiniteQuery<BrandCircleReachPage,Error,InfiniteData<BrandCircleReachPage,BrandCircleCursor|null>,readonly unknown[],BrandCircleCursor|null>({queryKey:brandId?marketingKeys.people.circle(brandId,ring):marketingKeys.all,queryFn:({pageParam})=>listBrandCircleReach({brandId:brandId!,ring,cursor:pageParam,limit:50}),initialPageParam:null,getNextPageParam:(page)=>page.nextCursor,enabled,staleTime:0,gcTime:0,refetchOnMount:"always",refetchOnWindowFocus:"always",refetchOnReconnect:"always",retry});
  const pages=useMemo(()=>query.data?.pages??[],[query.data?.pages]),first=pages[0],error=query.error instanceof BrandCircleReachError?query.error:null;
  const expiresAt=useMemo(()=>{const values=pages.flatMap((page)=>[page.availability.followers.expiresAt,page.availability.extended.expiresAt]).filter((v):v is string=>v!==null);return values.length?Math.min(...values.map(Date.parse)):null},[pages]);
  useEffect(()=>{setExpired(false);if(expiresAt===null)return;const delay=Math.min(2_147_483_647,Math.max(0,expiresAt-Date.now()));const timer=setTimeout(()=>setExpired(true),delay);return()=>clearTimeout(timer)},[expiresAt]);
  useEffect(()=>{if(previousBrand.current&&previousBrand.current!==brandId)void client.removeQueries({queryKey:marketingKeys.people.circle(previousBrand.current,ring)});previousBrand.current=brandId},[brandId,client,ring]);
  useEffect(()=>{if((!enabled||expired)&&brandId){void client.cancelQueries({queryKey:marketingKeys.people.circle(brandId,ring)});if(!online||expired||!allowed||!isAuthReady||user===null)client.removeQueries({queryKey:marketingKeys.people.circle(brandId,ring)});}},[allowed,brandId,client,enabled,expired,isAuthReady,online,ring,user]);
  useEffect(()=>{if(error?.code==="circle_cursor_stale"&&brandId){client.removeQueries({queryKey:marketingKeys.people.circle(brandId,ring)});void client.refetchQueries({queryKey:marketingKeys.people.circle(brandId,ring),type:"active"});}},[brandId,client,error,ring]);
  const checkingCurrent=query.isFetching&&!query.isFetchingNextPage;
  const current=!expired&&online&&!checkingCurrent&&first!==undefined&&(!query.isError||query.isFetchNextPageError);
  const rows=current?pages.flatMap((page)=>page.rows):[];
  const kind=!active?"featureOff":!isAuthReady||user===null?"authLoading":!roleResolved?"roleLoading":!allowed||error?.code==="circle_forbidden"?"forbidden":flag.isError||flagReady&&flag.data!==true?"featureOff":!flagReady?"featureLoading":!online?"offlineUnavailable":error?.code==="circle_cursor_stale"?"cursorRefreshing":query.isLoading?"loading":query.isFetchingNextPage?"loadingMore":query.isFetching?"refreshing":query.isFetchNextPageError?"paginationError":expired||query.isError||first?.state==="unavailable"?"unavailable":rows.length===0?"empty":first?.state==="partial"?"partial":"ready";
  return {...query,kind,rows,currentPage:current?first:undefined,counts:current?first?.counts:undefined,hasCurrentTruth:current};
}
