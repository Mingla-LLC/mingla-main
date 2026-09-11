import React from "react";
import { AccessibilityInfo, findNodeHandle, FlatList, Platform, StyleSheet, Text, View } from "react-native";
import { spacing, text, typography } from "../../constants/designSystem";
import { capturePeople } from "../../features/people/peopleAnalytics";
import type { useBrandCircleReach } from "../../hooks/marketing/useBrandCircleReach";
import type { BrandCircleRing } from "../../types/brandCircleReach";
import { Button } from "../ui/Button";
import { CirclePersonRow, CircleReachLoading } from "./CircleReachBlock";

type CircleQuery=ReturnType<typeof useBrandCircleReach>;
type FocusNode={focus?:()=>void};
export function CircleReachSheet({visible,ring,query,onClose}:{visible:boolean;ring:BrandCircleRing;query:CircleQuery;onClose:()=>void}):React.ReactElement|null{
  const [retrying,setRetrying]=React.useState(false);
  const paginationFailureReported=React.useRef(false);
  const title=ring==="follower"?"Followers":"Extended circle",count=query.counts?.[ring==="follower"?"followers":"extended"]??null;
  const ready=query.hasCurrentTruth&&query.currentPage?.availability[ring==="follower"?"followers":"extended"].state==="ready";
  const sheetRef=React.useRef<View|null>(null),titleRef=React.useRef<Text|null>(null),closeRef=React.useRef<View|null>(null);
  React.useEffect(()=>{
    if(!visible)return;
    const timer=setTimeout(()=>{
      if(Platform.OS==="web")(closeRef.current as unknown as FocusNode)?.focus?.();
      else{const handle=findNodeHandle(titleRef.current);if(handle!==null)AccessibilityInfo.setAccessibilityFocus(handle)}
    },0);
    return()=>clearTimeout(timer);
  },[visible,ring]);
  React.useEffect(()=>{
    if(!visible||Platform.OS!=="web"||typeof document==="undefined")return;
    const onKeyDown=(event:KeyboardEvent):void=>{
      if(event.key==="Escape"){event.preventDefault();onClose();return}
      if(event.key!=="Tab")return;
      const root=sheetRef.current as unknown as HTMLElement|null;
      const controls=root?Array.from(root.querySelectorAll<HTMLElement>('button,[href],[tabindex]:not([tabindex="-1"])')).filter((node)=>!node.hasAttribute("disabled")):[];
      if(controls.length===0)return;
      const first=controls[0],last=controls[controls.length-1],active=document.activeElement;
      if(event.shiftKey&&active===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&active===last){event.preventDefault();first.focus()}
    };
    document.addEventListener("keydown",onKeyDown);
    return()=>document.removeEventListener("keydown",onKeyDown);
  },[onClose,visible]);
  React.useEffect(()=>{
    if(!visible||!query.isFetchNextPageError){paginationFailureReported.current=false;return}
    if(paginationFailureReported.current)return;
    paginationFailureReported.current=true;
    capturePeople("people_circle_pagination_failed",{surface:"circle_sheet",circleRing:ring,dependencyState:"unavailable"});
  },[query.isFetchNextPageError,ring,visible]);
  const retry=async():Promise<void>=>{if(retrying)return;capturePeople("people_circle_retry_selected",{surface:"circle_sheet",circleRing:ring,dependencyState:"unavailable"});setRetrying(true);try{await query.refetch()}finally{setRetrying(false)}};
  if(!visible)return null;
  const {Sheet}=require("../ui/Sheet") as typeof import("../ui/Sheet"),{Spinner}=require("../ui/Spinner") as typeof import("../ui/Spinner"),{IconChrome}=require("../ui/IconChrome") as typeof import("../ui/IconChrome");
  return <Sheet visible={visible} onClose={onClose} snapPoint="full" testID={`people-circle-${ring}-sheet`}><View ref={sheetRef} accessibilityViewIsModal accessibilityLabel={title} style={styles.sheet}><View style={styles.header}><View style={styles.headerCopy}><Text ref={titleRef} accessible accessibilityRole="header" style={styles.title}>{title}</Text>{ready&&count!==null?<Text style={styles.subtitle}>{count} {count===1?"person":"people"}</Text>:null}</View><IconChrome ref={closeRef} icon="close" size={36} accessibilityLabel={`Close ${title}`} onPress={onClose}/></View>
    {!retrying&&["loading","refreshing","cursorRefreshing"].includes(query.kind)?<CircleReachLoading/>:query.kind==="offlineUnavailable"?<Text accessibilityLiveRegion="polite" style={styles.subtitle}>You’re offline. Connect to check current reach.</Text>:!ready?<View style={styles.failure}><Text accessibilityLiveRegion="polite" style={styles.status}>Reach is temporarily unavailable.</Text><Text style={styles.subtitle}>Mingla couldn’t verify who is currently reachable.</Text><Button label="Try again" variant="secondary" loading={retrying} disabled={retrying} onPress={retry}/></View>:<FlatList data={query.rows.filter((row)=>row.ring===ring)} keyExtractor={(row)=>row.memberId} renderItem={({item,index})=><CirclePersonRow member={item} last={index===query.rows.length-1}/>} onEndReached={()=>{if(query.hasNextPage&&!query.isFetchingNextPage)void query.fetchNextPage()}} onEndReachedThreshold={0.4} ListFooterComponent={query.isFetchingNextPage?<View style={styles.footer}><Spinner size={24}/><Text style={styles.subtitle}>Loading more people…</Text></View>:query.isFetchNextPageError?<View style={styles.footer}><Text style={styles.subtitle}>Couldn’t load more people.</Text><Button label="Try again" variant="secondary" onPress={()=>void query.fetchNextPage()}/></View>:query.hasNextPage&&Platform.OS==="web"?<View style={styles.footer}><Button label="Load more" variant="secondary" fullWidth onPress={()=>void query.fetchNextPage()}/></View>:null}/>}
  </View></Sheet>;
}
const styles=StyleSheet.create({sheet:{flex:1,paddingHorizontal:spacing.md,paddingBottom:spacing.lg,gap:spacing.sm},header:{minHeight:44,flexDirection:"row",alignItems:"flex-start",gap:spacing.sm},headerCopy:{flex:1,gap:spacing.xs},title:{...typography.h3,color:text.primary},subtitle:{...typography.bodySm,color:text.tertiary},status:{...typography.caption,fontWeight:"600",color:text.secondary},failure:{minHeight:96,justifyContent:"center",alignItems:"flex-start",gap:spacing.sm},footer:{minHeight:44,alignItems:"center",justifyContent:"center",gap:spacing.xs}});
