import React from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { glass, spacing, text, typography } from "../../constants/designSystem";
import { capturePeople } from "../../features/people/peopleAnalytics";
import type { useBrandCircleReach } from "../../hooks/marketing/useBrandCircleReach";
import { useReducedMotionNative } from "../../hooks/useReducedMotionNative";
import type { BrandCircleMember, BrandCircleRing } from "../../types/brandCircleReach";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { PeopleBlock } from "./PeoplePrimitives";

export const CIRCLE_PREVIEW_LIMIT=3;
type CircleQuery=ReturnType<typeof useBrandCircleReach>;
const label=(ring:BrandCircleRing)=>ring==="follower"?"Followers":"Extended circle";
const count=(n:number)=>`${n} ${n===1?"person":"people"}`;
export function CirclePersonRow({member,last=false}:{member:BrandCircleMember;last?:boolean}):React.ReactElement{return <View accessible accessibilityRole="text" accessibilityLabel={`${member.displayName}. ${member.reasonLabel}`} style={[styles.row,!last&&styles.divider]}><Avatar name={member.displayName} size="row" photo={member.avatarUrl??undefined} accessibilityLabel=" "/><View style={styles.copy}><Text maxFontSizeMultiplier={2} style={styles.name}>{member.displayName}</Text><Text maxFontSizeMultiplier={2} style={styles.reason}>{member.reasonLabel}</Text></View></View>}
export function CircleReachLoading():React.ReactElement{return <View accessibilityLiveRegion="polite" style={styles.loading}><Text style={styles.status}>Checking current reach…</Text>{[0,1,2].map((row)=><View key={row} style={styles.row}><Skeleton width={40} height={40} radius="full"/><View style={styles.copy}><Skeleton width="48%" height={16}/><Skeleton width="68%" height={12}/></View></View>)}</View>}
export function CircleReachBlock({ring,query,width,onSeeAll,openerRef}:{ring:BrandCircleRing;query:CircleQuery;width:number;onSeeAll:()=>void;openerRef?:React.Ref<React.ElementRef<typeof Button>>}):React.ReactElement{
  const [retrying,setRetrying]=React.useState(false),reduceMotion=useReducedMotionNative();
  const title=label(ring),availability=query.safeAvailability?.[ring==="follower"?"followers":"extended"],ringCount=query.counts?.[ring==="follower"?"followers":"extended"]??null;
  const rows=query.rows.filter((row)=>row.ring===ring).slice(0,CIRCLE_PREVIEW_LIMIT),ready=availability?.state==="ready"&&query.hasCurrentTruth;
  const fade=React.useRef(new Animated.Value(reduceMotion?1:0)).current;React.useEffect(()=>{if(!ready){fade.setValue(0);return}if(reduceMotion){fade.setValue(1);return}fade.setValue(0);Animated.timing(fade,{toValue:1,duration:200,useNativeDriver:true}).start()},[fade,ready,reduceMotion]);
  React.useEffect(()=>{if(ready)capturePeople("people_circle_block_viewed",{surface:"page",circleRing:ring,dependencyState:ringCount===0?"empty":query.currentPage?.state==="partial"?"partial":"ready"})},[query.currentPage?.state,ready,ring,ringCount]);
  const retry=async():Promise<void>=>{if(retrying)return;capturePeople("people_circle_retry_selected",{surface:"page",circleRing:ring,dependencyState:"unavailable"});setRetrying(true);try{await query.refetch()}finally{setRetrying(false)}};
  const loading=!retrying&&["loading","refreshing","cursorRefreshing"].includes(query.kind);
  const offline=query.kind==="offlineUnavailable";
  const gated=ring==="extended"&&availability?.reason==="controls_not_live";
  const unavailable=retrying||!ready&&!loading;
  return <PeopleBlock title={title} caption={ring==="follower"?"People who follow your brand.":"People who opted into extended brand reach."} count={ready&&ringCount!==null?count(ringCount):undefined} icon={ring==="follower"?"users":"branch"} testID={`people-circle-${ring}-block`}>
    {loading?<CircleReachLoading/>:ready&&ringCount===0?<View style={[styles.empty,width>0&&width<352&&styles.centered]}><Text style={styles.status}>{ring==="follower"?"No followers to show yet.":"No one is in your extended circle yet."}</Text><Text style={styles.reason}>{ring==="follower"?"When eligible people follow your brand, they’ll appear here.":"People appear here only after they opt into extended brand reach."}</Text></View>:ready?<Animated.View style={{opacity:fade}}>{rows.map((member,index)=><CirclePersonRow key={member.memberId} member={member} last={index===rows.length-1}/>)}{ringCount!==null&&ringCount>CIRCLE_PREVIEW_LIMIT?<Button ref={openerRef} label="See all" accessibilityLabel={`See all ${title}`} trailingIcon="chevR" variant="secondary" fullWidth onPress={onSeeAll}/>:null}</Animated.View>:unavailable?<View style={[styles.empty,width>0&&width<352&&styles.centered]}><Text accessibilityLiveRegion="polite" style={styles.status}>{offline?"You’re offline. Connect to check current reach.":gated?"Extended circle isn’t available yet.":"Reach is temporarily unavailable."}</Text>{!offline?<Text style={styles.reason}>{gated?"This stays off until people can control extended brand reach in the Mingla app.":"Mingla couldn’t verify who is currently reachable."}</Text>:null}{!offline&&!gated?<Button label="Try again" variant="secondary" loading={retrying} disabled={retrying} onPress={retry}/>:null}</View>:null}
  </PeopleBlock>;
}
const styles=StyleSheet.create({row:{minHeight:64,flexDirection:"row",alignItems:"center",gap:spacing.sm,paddingVertical:10},divider:{borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:glass.border.profileBase},copy:{flex:1,minWidth:0,gap:spacing.xs},name:{...typography.body,fontWeight:"600",color:text.primary},reason:{...typography.bodySm,color:text.secondary},status:{...typography.caption,fontWeight:"600",color:text.secondary},loading:{gap:spacing.xs},empty:{minHeight:96,justifyContent:"center",alignItems:"flex-start",gap:spacing.xs},centered:{alignItems:"center"}});
