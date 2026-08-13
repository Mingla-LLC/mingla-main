import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { getBrandPerson, listBrandPeople, PeopleServiceError } from "../../services/peopleService";
import type { BrandPersonSummary } from "../../types/people";
import { marketingKeys } from "./marketingKeys";

const retry = (count:number,error:Error):boolean => count<2 && error instanceof PeopleServiceError && error.retryable;
export function useBrandPeople(brandId:string|null,search:string|null,roleResolved:boolean,rank:number,online=true){
  const {isAuthReady,user}=useAuth(); const allowed=roleResolved&&rank>=20;
  const enabled=isAuthReady&&user!==null&&brandId!==null&&allowed;
  const query=useInfiniteQuery({queryKey:brandId?marketingKeys.people.book(brandId,search):marketingKeys.all,
    queryFn:({pageParam})=>listBrandPeople({brandId:brandId!,search:search?.trim()||null,cursor:pageParam,limit:50}),
    initialPageParam:null as {updatedAt:string;personId:string}|null,getNextPageParam:(page)=>page.nextCursor,
    enabled,staleTime:30_000,retry});
  const rows=query.data?.pages.flatMap((p)=>p.rows)??[]; const first=query.data?.pages[0];
  const kind=!isAuthReady||user===null?"authLoading":!roleResolved?"roleLoading":!allowed?"forbidden":!online&&query.data?"offlineStale":query.isLoading?"loading":query.isError?"error":query.isFetchingNextPage?"loadingMore":query.isFetching?"refreshing":"success";
  return {...query,kind,rows,bookTotal:first?.bookTotal??null,filteredTotal:first?.filteredTotal??null,hasResolved:query.isFetched};
}
export function useBrandPerson(brandId:string|null,personId:string|null,roleResolved:boolean,rank:number){
  const {isAuthReady,user}=useAuth(); const enabled=isAuthReady&&user!==null&&brandId!==null&&personId!==null&&roleResolved&&rank>=20;
  return useQuery<BrandPersonSummary>({queryKey:brandId&&personId?marketingKeys.people.detail(brandId,personId):marketingKeys.all,
    queryFn:()=>getBrandPerson({brandId:brandId!,personId:personId!}),enabled,staleTime:30_000,retry});
}
