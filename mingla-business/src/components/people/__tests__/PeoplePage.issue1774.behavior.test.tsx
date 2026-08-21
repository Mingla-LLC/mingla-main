import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Text, View } from "react-native";

const router={push:jest.fn(),replace:jest.fn()};
let brand:any={id:"brand-a"},role:any={isLoading:false,isError:false,accepted:true,rank:20},auth:any={isAuthReady:true,user:{id:"user-1"}},online=true,flag:any={isPending:false,isFetching:false,isError:false,data:false},forcedKind:string|null=null;
let groupState:any,openSwitcher=jest.fn();
const refetch=jest.fn(async()=>{}),fetchNextPage=jest.fn(async()=>{});
const person={personId:"person-1",displayName:"Ada",avatarUrl:null,updatedAt:"now",contacts:[{id:"contact-1",channel:"email",value:"ada@example.test",isPrimary:true}],suppressions:[]};
const peopleHook=jest.fn((_brand:string|null,_search:string|null,resolved:boolean,accepted:boolean,rank:number)=>({kind:forcedKind??(!resolved?"roleLoading":!accepted||rank<20?"forbidden":"success"),rows:[person],bookTotal:1,filteredTotal:1,hasResolved:true,isError:false,isFetchingNextPage:false,isFetchNextPageError:false,hasNextPage:false,refetch,fetchNextPage}));

jest.mock("expo-router",()=>({useRouter:()=>router}));
jest.mock("../../../context/AuthContext",()=>({useAuth:()=>auth}));
jest.mock("../../../hooks/useCurrentBrand",()=>({useCurrentBrand:()=>brand}));
jest.mock("../../../hooks/useCurrentBrandRole",()=>({useCurrentBrandRole:()=>role}));
jest.mock("../../../hooks/useFeatureFlag",()=>({useFeatureFlag:()=>flag}));
jest.mock("../../../hooks/useResponsiveLayout",()=>({useResponsiveLayout:()=>({isWideDesktop:false,width:390})}));
jest.mock("../../../hooks/useStickyFooterOffset",()=>({useStickyFooterOffset:()=>120}));
jest.mock("../../../hooks/marketing/useBrandPeople",()=>({useBrandPeople:(...args:any[])=>peopleHook(args[0],args[1],args[2],args[3],args[4])}));
jest.mock("../../../hooks/marketing/useAudienceList",()=>({useAudienceList:()=>groupState}));
// #2305 — the conflict queue hook uses React Query like useBrandPeople above, so it
// is stubbed for the same reason: this suite renders PeoplePage without a QueryClient.
// An empty queue is the #1774 baseline — the strip renders null at zero.
jest.mock("../../../hooks/marketing/useBrandPersonConflicts",()=>({useBrandPersonConflicts:()=>({kind:"success",openCount:0,rows:[],refetch:()=>Promise.resolve()}),useResolveBrandPersonConflict:()=>({mutateAsync:()=>Promise.resolve({personId:null,mergedPersonIds:[]})})}));
jest.mock("../../ui/useShareNetworkState",()=>({useShareNetworkState:()=>online}),{virtual:true});
jest.mock("../MarketingBrandSwitcherContext",()=>({useMarketingBrandSwitcher:()=>openSwitcher}));
jest.mock("../../../features/people/peopleAnalytics",()=>({capturePeople:jest.fn()}));
jest.mock("../../../services/marketing/marketingCampaignService",()=>({ensureBrandBuyersAudience:jest.fn(),ensureEventBuyersAudience:jest.fn()}));
jest.mock("../../ui/Button",()=>({Button:(props:any)=>React.createElement("MockButton",props)}));
jest.mock("../../ui/EmptyState",()=>({EmptyState:(props:any)=><View><Text>{props.title}</Text>{props.description?<Text>{props.description}</Text>:null}{props.cta?React.createElement("MockButton",{label:props.cta.label,onPress:props.cta.onPress}):null}</View>}));
jest.mock("../../ui/Skeleton",()=>({Skeleton:()=>React.createElement("MockSkeleton")}));
jest.mock("../../ui/Icon",()=>({Icon:()=>React.createElement("MockIcon")}));
jest.mock("../../ui/Toast",()=>({Toast:(props:any)=>props.visible?<Text>{props.message}</Text>:null}));
jest.mock("../../marketing/AudienceCard",()=>({AudienceCard:({entry}:any)=><Text>{entry.display_name}</Text>}));
jest.mock("../AddPersonSheet",()=>({AddPersonSheet:({visible}:any)=>visible?<Text>ADD SHEET</Text>:null}));
jest.mock("../ManualGroupsLoader",()=>({ManualGroupsLoader:()=>null}));
// #2305 — the conflict review sheet is a sibling of AddPersonSheet in PeoplePage's
// module graph and pulls the same reanimated-backed ConfirmDialog, so it is stubbed
// here for the identical reason the Add sheet is.
jest.mock("../ConflictReviewSheet",()=>({ConflictReviewSheet:()=>null,ConflictReviewStrip:()=>null}));
jest.mock("../PeoplePrimitives",()=>({
  PeopleBlock:({title,count,children}:any)=><View><Text>{title}</Text>{count?<Text>{count}</Text>:null}{children}</View>,
  DependencyStatus:({status,body}:any)=><View><Text>{status}</Text><Text>{body}</Text></View>,
  PeopleRow:({person,onPress}:any)=>React.createElement("MockPersonRow",{onPress,name:person.displayName,summary:person.contacts[0]?.value},<Text>{person.displayName}</Text>,<Text>{person.contacts[0]?.value}</Text>),
  BookSheet:({visible,query}:any)=>visible?<View><Text>BOOK SHEET</Text>{query.rows.map((row:any)=><Text key={row.personId}>{row.displayName}</Text>)}</View>:null,
  GroupsSheet:({visible}:any)=>visible?<Text>GROUPS SHEET</Text>:null,
}));

// Jest requires dependency mocks to be declared before loading this component.
// eslint-disable-next-line import/first
import { PeoplePage } from "../PeoplePage";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TR=require("react-test-renderer") as {create:(node:React.ReactElement)=>any;act:(callback:()=>void|Promise<void>)=>void|Promise<void>};
const textOf=(json:any):string=>{if(typeof json==="string")return json;if(Array.isArray(json))return json.map(textOf).join(" ");if(json&&typeof json==="object")return textOf(json.children??[]);return ""};
let tree:any;
const render=()=>{TR.act(()=>{tree=TR.create(<PeoplePage/>)})};
const update=()=>{TR.act(()=>tree.update(<PeoplePage/>))};

beforeEach(()=>{brand={id:"brand-a"};role={isLoading:false,isError:false,accepted:true,rank:20};auth={isAuthReady:true,user:{id:"user-1"}};online=true;flag={isPending:false,isFetching:false,isError:false,data:false};forcedKind=null;openSwitcher=jest.fn();router.push.mockClear();router.replace.mockClear();peopleHook.mockClear();groupState={hasResolved:true,isError:false,entries:[{client_key:"group-1",display_name:"Buyers",kind:"brand_buyers",brand_id:"brand-a",event_id:null,audience_id:"audience-1"}],reach:new Map(),refetch:jest.fn(async()=>{})};});

describe("#1774 rendered People state machine",()=>{
  test("server 403 atomically clears cached PII, Groups, actions, and an open Book sheet",()=>{
    render(); const seeAll=tree.root.findAllByType("MockButton").find((node:any)=>node.props.label==="See all"); TR.act(()=>seeAll.props.onPress());
    expect(textOf(tree.toJSON())).toMatch(/BOOK SHEET.*Ada/); forcedKind="forbidden"; update(); const output=textOf(tree.toJSON());
    expect(output).toContain("You don’t have access to People."); expect(output).not.toMatch(/Ada|ada@example|Buyers|BOOK SHEET|Add person|Your book/);
  });

  test("pending membership and scanner are terminal forbidden while accepted rank20 renders",()=>{
    role={...role,accepted:false,rank:50}; render(); expect(textOf(tree.toJSON())).toContain("You don’t have access");
    role={...role,accepted:true,rank:10}; update(); expect(textOf(tree.toJSON())).toContain("You don’t have access");
    role={...role,rank:20}; update(); expect(textOf(tree.toJSON())).toMatch(/Your book.*Ada.*Groups.*Buyers/);
  });

  test("role lookup failure clears cached PII and ends in a terminal privacy-safe state",()=>{
    render(); expect(textOf(tree.toJSON())).toMatch(/Ada.*ada@example\.test.*Buyers/);
    role={...role,isError:true}; update(); const output=textOf(tree.toJSON());
    expect(output).toContain("You don’t have access to People.");
    expect(output).not.toMatch(/Ada|ada@example|Buyers|Your book|People you can reach/);
    expect(tree.root.findAllByType("MockSkeleton")).toHaveLength(0);
  });

  test("no-brand recovery invokes the existing Marketing switcher owner",()=>{
    brand=null; render(); const choose=tree.root.findAllByType("MockButton").find((node:any)=>node.props.label==="Choose brand"); expect(choose).toBeDefined(); TR.act(()=>choose.props.onPress()); expect(openSwitcher).toHaveBeenCalledTimes(1);
  });

  test("Import remains a dead-state label until settled literal true",()=>{
    render(); expect(tree.root.findAllByType("MockButton").some((node:any)=>node.props.label==="Import")).toBe(false);
    flag={isPending:false,isFetching:false,isError:false,data:true}; update(); const button=tree.root.findAllByType("MockButton").find((node:any)=>node.props.label==="Import"); expect(button).toBeDefined(); TR.act(()=>button.props.onPress()); expect(router.push).toHaveBeenCalledWith(expect.stringContaining("brandId=brand-a"));
  });

  test("Book and Groups errors stay independent",()=>{
    groupState={...groupState,isError:true,entries:[]}; render(); const output=textOf(tree.toJSON()); expect(output).toContain("Ada"); expect(output).toContain("Couldn’t load groups.");
    forcedKind="error"; groupState={...groupState,isError:false,entries:[{client_key:"group-1",display_name:"Buyers",kind:"brand_buyers",brand_id:"brand-a",event_id:null,audience_id:"audience-1"}]}; update(); const next=textOf(tree.toJSON()); expect(next).toContain("Couldn’t load your book."); expect(next).toContain("Buyers");
  });
});
