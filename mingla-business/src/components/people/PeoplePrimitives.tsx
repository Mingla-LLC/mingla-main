import React from "react";
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { AudienceListEntry, AudienceReachSummary } from "../../types/marketing";
import type { BrandPersonSummary } from "../../types/people";
import { glass, spacing, text, typography } from "../../constants/designSystem";
import { AudienceCard } from "../marketing/AudienceCard";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";
import { Spinner } from "../ui/Spinner";
import { resolveBookSheetView } from "./bookSheetState";

export function PeopleBlock({title,caption,count,children,elevated=false,testID,icon,minHeight}:{title:string;caption?:string;count?:string;children:React.ReactNode;elevated?:boolean;testID?:string;icon?:"target"|"users"|"branch";minHeight?:number}):React.ReactElement{
  return <GlassCard variant={elevated?"elevated":"base"} radius={elevated?"xl":"lg"} contentStyle={[styles.block,minHeight?{minHeight}:undefined]} testID={testID}>
    <View style={styles.header}>{icon?<Icon name={icon} size={icon==="target"?24:20} color={text.tertiary}/>:null}<View style={styles.headerCopy}><Text accessibilityRole="header" style={styles.title}>{title}</Text>{caption?<Text style={styles.caption}>{caption}</Text>:null}</View>{count?<Text style={styles.count}>{count}</Text>:null}</View>{children}
  </GlassCard>;
}
export function DependencyStatus({status,body,testID}:{status:string;body:string;testID?:string}):React.ReactElement{return <View testID={testID} accessibilityRole="text" style={styles.dependency}><Text style={styles.status}>{status}</Text><Text style={styles.caption}>{body}</Text></View>}
const summary=(p:BrandPersonSummary):string=>p.contacts.find((c)=>c.isPrimary)?.value??p.contacts[0]?.value??"Contact details unavailable";
export function PeopleRow({person,onPress}:{person:BrandPersonSummary;onPress:()=>void}):React.ReactElement{return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${person.displayName}, ${summary(person)}`} accessibilityHint="Open read-only contact details" style={({pressed})=>[styles.personRow,pressed&&styles.pressed]}>
  <Avatar name={person.displayName} size="row" photo={person.avatarUrl??undefined} accessibilityLabel=" " /><View style={styles.personCopy}><Text style={styles.personName}>{person.displayName}</Text><Text style={styles.contact} numberOfLines={2}>{summary(person)}</Text></View><Icon name="chevR" size={16} color={text.tertiary}/>
  </Pressable>}
export function BookSheet({visible,onClose,query,onSelect,onSearch}:{visible:boolean;onClose:()=>void;query:ReturnType<typeof import("../../hooks/marketing/useBrandPeople").useBrandPeople>;onSelect:(p:BrandPersonSummary)=>void;onSearch:(search:string)=>void}):React.ReactElement{
  const [search,setSearch]=React.useState(""); const [debounced,setDebounced]=React.useState(""); React.useEffect(()=>{const t=setTimeout(()=>{const next=search.trim();setDebounced(next);onSearch(next)},300);return()=>clearTimeout(t)},[onSearch,search]);
  React.useEffect(()=>{if(!visible){setSearch("");setDebounced("");onSearch("")}},[onSearch,visible]);
  const view=resolveBookSheetView({kind:query.kind,rowCount:query.rows.length,hasSearch:debounced!=="",bookTotal:query.bookTotal,filteredTotal:query.filteredTotal});
  return <Sheet visible={visible} onClose={onClose} snapPoint="full" testID="people-book-sheet"><View style={styles.sheet}>
    <Text accessibilityRole="header" style={styles.title}>Your book</Text>{view.subtitle?<Text accessibilityLiveRegion="polite" style={styles.caption}>{view.subtitle}</Text>:null}
    <Input variant="search" value={search} onChangeText={setSearch} placeholder="Search name, email or phone" clearable accessibilityLabel="Search your book" />
    {view.mode==="forbidden"?null:view.mode==="loading"?<View accessibilityLiveRegion="polite" style={styles.loadingMore}><Spinner size={24}/><Text style={styles.caption}>{debounced?"Searching your book…":"Loading your book…"}</Text></View>:view.mode==="offlineEmpty"?<EmptyState title="You’re offline." description="Connect to load your book."/>:view.mode==="error"?<EmptyState title={debounced?"Couldn’t search your book.":"Couldn’t load your book."} cta={{label:"Try again",onPress:async()=>{await query.refetch()},variant:"secondary"}}/>:view.mode==="empty"?<EmptyState title={debounced?"No contacts match this search.":"No one is in your book yet."} description={debounced?undefined:"Add a person, import contacts, or Mingla will add customers as they book."} cta={debounced?{label:"Clear search",onPress:()=>setSearch("")}:undefined}/>:<>{view.status?<Text accessibilityLiveRegion="polite" style={styles.caption}>{view.status}</Text>:null}<FlatList data={query.rows} keyExtractor={(p)=>p.personId} renderItem={({item})=><PeopleRow person={item} onPress={()=>onSelect(item)}/>} onEndReached={()=>{if(query.hasNextPage&&!query.isFetchingNextPage)void query.fetchNextPage()}} onEndReachedThreshold={0.4} ListFooterComponent={query.isFetchNextPageError?<View style={styles.loadingMore}><Text style={styles.caption}>Couldn’t load more contacts.</Text><Button label="Try again" variant="secondary" onPress={()=>void query.fetchNextPage()}/></View>:query.isFetchingNextPage?<View style={styles.loadingMore}><Spinner size={24}/><Text style={styles.caption}>Loading more contacts…</Text></View>:query.kind==="offlineStale"&&query.hasNextPage?<Text style={styles.caption}>Connect to load more.</Text>:query.hasNextPage&&Platform.OS==="web"?<Button label="Load more" variant="secondary" onPress={()=>void query.fetchNextPage()}/>:null}/></>}
  </View></Sheet>;
}
export function GroupsSheet({visible,onClose,entries,reach,creatingKey,onPress}:{visible:boolean;onClose:()=>void;entries:AudienceListEntry[];reach:Map<string,AudienceReachSummary|null>;creatingKey:string|null;onPress:(e:AudienceListEntry)=>void}):React.ReactElement{return <Sheet visible={visible} onClose={onClose} snapPoint="full" testID="people-groups-sheet"><View style={styles.sheet}><Text accessibilityRole="header" style={styles.title}>Groups</Text><FlatList data={entries} keyExtractor={(e)=>e.client_key} renderItem={({item})=><AudienceCard entry={item} reach={reach.has(item.client_key)?reach.get(item.client_key):undefined} onPress={onPress} isCreating={creatingKey===item.client_key}/>} contentContainerStyle={styles.listGap}/></View></Sheet>}
const styles=StyleSheet.create({block:{gap:spacing.md},header:{flexDirection:"row",alignItems:"flex-start",gap:spacing.sm},headerCopy:{flex:1,gap:spacing.xs},title:{...typography.h3,color:text.primary},caption:{...typography.bodySm,color:text.tertiary},count:{...typography.caption,color:text.secondary},dependency:{minHeight:64,justifyContent:"center",gap:spacing.xs},status:{...typography.caption,fontWeight:"600",color:text.secondary},personRow:{minHeight:64,flexDirection:"row",alignItems:"center",gap:spacing.sm,paddingVertical:10,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:glass.border.profileBase},pressed:{opacity:.78},personCopy:{flex:1},personName:{...typography.body,fontWeight:"600",color:text.primary},contact:{...typography.bodySm,color:text.secondary},sheet:{flex:1,paddingHorizontal:spacing.md,paddingBottom:spacing.lg,gap:spacing.sm},loadingMore:{minHeight:44,alignItems:"center",justifyContent:"center",gap:spacing.xs},listGap:{gap:spacing.sm}});
