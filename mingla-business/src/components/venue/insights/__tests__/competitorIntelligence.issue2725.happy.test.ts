import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ReactLocal=require("react") as typeof React;
const mockWatch=jest.fn();const mockBrief=jest.fn();const mockMutation={mutate:jest.fn(),reset:jest.fn(),isPending:false,isError:false,error:null};
jest.mock("../../../../hooks/useGrowthTools",()=>({useCompetitorWatch:(...args:unknown[])=>mockWatch(...args),useCompetitorBrief:(...args:unknown[])=>mockBrief(...args),useAddCompetitor:()=>mockMutation,useRefreshCompetitor:()=>mockMutation,useRemoveCompetitor:()=>mockMutation}));
jest.mock("../../../../context/AuthContext",()=>({useAuth:()=>({loading:false,session:{user:{id:"u1"}}})}));
jest.mock("@tanstack/react-query",()=>({useQuery:()=>({data:[],isFetching:false,isFetched:false,isError:false,refetch:jest.fn()})}));
jest.mock("../../../../analytics/businessAnalyticsEvents",()=>({captureCompetitorIntelligenceEvent:jest.fn(),captureIntelCompetitorAdded:jest.fn()}));
jest.mock("../../../../services/guestFunnelLink",()=>({openExternal:jest.fn()}));
jest.mock("../../../ui/Button",()=>({Button:(props:Record<string,unknown>)=>ReactLocal.createElement("Button",props)}));
jest.mock("../../../ui/GlassCard",()=>({GlassCard:(props:Record<string,unknown>&{children?:unknown})=>ReactLocal.createElement("GlassCard",props,props.children as never)}));
jest.mock("../../../ui/Input",()=>({Input:(props:Record<string,unknown>)=>ReactLocal.createElement("Input",props)}));
jest.mock("../../../ui/Sheet",()=>({Sheet:(props:Record<string,unknown>&{children?:unknown})=>ReactLocal.createElement("Sheet",props,props.children as never)}));
jest.mock("../../../ui/ConfirmDialog",()=>({ConfirmDialog:(props:Record<string,unknown>)=>ReactLocal.createElement("ConfirmDialog",props)}));
jest.mock("../../../../wrappers/SmartScrollView",()=>({ScrollView:(props:Record<string,unknown>&{children?:unknown})=>ReactLocal.createElement("ScrollView",props,props.children as never)}));

import { CompetitorAddSheet } from "../CompetitorAddSheet";
import { CompetitorBriefSheet } from "../CompetitorBriefSheet";
import { CompetitorWatchSection } from "../CompetitorWatchSection";
import type { CompetitorWatchV2Row } from "../../../../types/growthTools";

interface Node{type?:unknown;props:Record<string,unknown>&{children?:unknown;testID?:string}}
interface Tree{root:{findAll:(predicate:(node:Node)=>boolean)=>Node[]};unmount:()=>void}
const Renderer=require("react-test-renderer") as {create:(element:React.ReactElement)=>Tree;act:(callback:()=>Promise<void>|void)=>Promise<void>};
const row:CompetitorWatchV2Row={schemaVersion:2,id:"watch-1",name:"Lantern Room",city:"Atlanta",website:"https://lantern.example",placePoolId:null,createdAt:"2026-08-01T00:00:00Z",updatedAt:"2026-08-27T00:00:00Z",freshness:"current",lastBriefUpdatedAt:"2026-08-27T00:00:00Z",checkedAt:"2026-08-27T00:00:00Z",nextRefreshAt:"2026-09-03T00:00:00Z",noMeaningfulChange:false,manualRefreshState:"available",sources:[{kind:"website",url:"https://lantern.example",capability:"analyzed_weekly",availability:"enabled",availabilityGeneration:1,health:"current",lastCheckedAt:"2026-08-27T00:00:00Z",safeReason:null},{kind:"tiktok",url:"https://www.tiktok.com/@lantern",capability:"link_only",availability:"enabled",availabilityGeneration:1,health:"current",lastCheckedAt:null,safeReason:null}],summary:{whatChanged:"A Friday tasting menu appeared.",primaryAction:"Test a weekday tasting offer."},activeJob:null,latest:null};
const trees:Tree[]=[];afterEach(()=>{trees.splice(0).forEach((tree)=>tree.unmount());jest.clearAllMocks();});
async function render(element:React.ReactElement):Promise<Tree>{let tree:Tree|null=null;await Renderer.act(async()=>{tree=Renderer.create(element);});trees.push(tree!);return tree!;}
const text=(tree:Tree)=>tree.root.findAll((node)=>typeof node.props.children==="string").map((node)=>String(node.props.children)).join(" ");
const byId=(tree:Tree,id:string)=>tree.root.findAll((node)=>typeof node.type==="string"&&node.props.testID===id);

describe("issue #2725 competitor intelligence behavior",()=>{
  it("renders weekly decisions and TikTok as link-only, never a grade",async()=>{mockWatch.mockReturnValue({data:[row],isLoading:false,isError:false,refetch:jest.fn()});const tree=await render(React.createElement(CompetitorWatchSection,{brandId:"b1",venueListingId:"v1",offline:false,onRequestAdd:jest.fn(),onOpenReport:jest.fn()}));const output=text(tree);for(const copy of ["THIS WEEK","A Friday tasting menu appeared.","WORTH DOING NEXT","Test a weekday tasting offer.","TikTok · Link only","Updated today","Checked today"])expect(output).toContain(copy);expect(output).not.toContain("Grade");});
  it("mounts the four sourced brief sections in decision order",async()=>{mockBrief.mockReturnValue({isLoading:false,isError:false,refetch:jest.fn(),data:{freshness:"current",noMeaningfulChange:false,brief:{whatChanged:[{id:"f1",text:"A menu appeared.",sourceId:"s1",evidenceId:"e1",confidence:"observed"}],whyItMatters:[{text:"Demand may shift.",evidenceIds:["e1"],confidence:"interpretation"}],worthDoing:[{id:"a1",text:"Test an offer.",kind:"experiment",confidence:"suggested_action",isPrimary:true}],evidence:[{id:"e1",sourceId:"s1",publicUrl:"https://lantern.example/menu",checkedAt:"2026-08-27T00:00:00Z",observation:"Menu copy appeared."}]}}});const tree=await render(React.createElement(CompetitorBriefSheet,{visible:true,onClose:jest.fn(),brandId:"b1",row}));const output=text(tree);let cursor=-1;for(const title of ["WHAT CHANGED","WHY IT MAY MATTER TO YOUR VENUE","WORTH DOING NEXT","EVIDENCE"]){const next=output.indexOf(title);expect(next).toBeGreaterThan(cursor);cursor=next;}for(const copy of ["Observed fact","Mingla interpretation","Suggested action"])expect(output).toContain(copy);expect(byId(tree,"competitor-brief-sheet-evidence-e1-open")).toHaveLength(1);});
  it("accepts one social link and explains TikTok's structural limitation",async()=>{const tree=await render(React.createElement(CompetitorAddSheet,{visible:true,onClose:jest.fn(),brandId:"b1",venueListingId:"v1",venueCity:"Atlanta",initialRow:{...row,website:null,sources:[row.sources[1]!]}}));const output=text(tree);expect(output).toContain("Saved as a link — weekly analysis isn't available");expect(byId(tree,"competitor-source-sheet-submit")[0]?.props.disabled).toBe(false);});
});
