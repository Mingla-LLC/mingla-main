import React from "react";
import { describe,expect,jest,test } from "@jest/globals";
import { Text,View } from "react-native";
jest.mock("../../ui/Avatar",()=>({Avatar:({name}:any)=><Text>{name}</Text>}));
jest.mock("../../ui/EmptyState",()=>({EmptyState:(props:any)=><View><Text>{props.title}</Text>{props.description?<Text>{props.description}</Text>:null}</View>}));
jest.mock("../../ui/GlassCard",()=>({GlassCard:({children}:any)=><View>{children}</View>}));
jest.mock("../../ui/Icon",()=>({Icon:()=>null}));
jest.mock("../../ui/Skeleton",()=>({Skeleton:()=>null}));
import { PersonDetailView } from "../PersonDetailView";
const TR=require("react-test-renderer") as {create:(node:React.ReactElement)=>any;act:(callback:()=>void)=>void};
const person={personId:"person-1",displayName:"Ada",avatarUrl:null,updatedAt:"now",contacts:[{id:"contact-1",channel:"email" as const,value:"ada@example.test",isPrimary:true}],suppressions:[{channel:"email" as const,scope:"marketing" as const}]};
const textOf=(json:any):string=>typeof json==="string"?json:Array.isArray(json)?json.map(textOf).join(" "):json&&typeof json==="object"?textOf(json.children??[]):"";
const render=(props:Partial<React.ComponentProps<typeof PersonDetailView>>={})=>{let tree:any;TR.act(()=>{tree=TR.create(<PersonDetailView person={person} loading={false} error={null} status={null} onRetry={()=>{}} {...props}/>)});return textOf(tree.toJSON())};
describe("#1774 read-only detail presentation",()=>{
  test("cached offline detail remains visible with explicit stale label",()=>expect(render({status:"Offline — showing saved contact details."})).toMatch(/Offline.*Ada.*ada@example\.test.*Email marketing suppressed/));
  test("forbidden and not-found states expose no cached contact",()=>{expect(render({person:null,error:"forbidden"})).not.toMatch(/Ada|ada@example/);expect(render({person:null,error:"not_found"})).toContain("This person isn’t in your book.")});
  test("offline without exact-brand cache is terminal and non-fabricated",()=>expect(render({person:null,error:"offline"})).toBe("You’re offline. Connect to load this person’s details."));
});
