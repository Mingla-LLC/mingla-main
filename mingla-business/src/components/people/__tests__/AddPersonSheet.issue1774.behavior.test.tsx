import React from "react";
import { beforeEach,describe,expect,jest,test } from "@jest/globals";
import { Text,View } from "react-native";

const mutateAsync=jest.fn<(...args:any[])=>Promise<any>>(),reset=jest.fn(); let mutation:any,uuidCount=0;
jest.mock("../../../hooks/marketing/useAddBrandPerson",()=>({useAddBrandPerson:()=>mutation}));
jest.mock("../peopleRequestId",()=>({createPeopleRequestId:()=>`17740000-0000-4000-8000-${String(++uuidCount).padStart(12,"0")}`}));
jest.mock("@mingla/phone-input",()=>({PhoneInput:(props:any)=>React.createElement("MockPhone",props)}));
jest.mock("../../ui/Sheet",()=>({Sheet:({visible,children,onClose,dismissOnScrimTap}:any)=>visible?React.createElement("MockSheet",{onClose,dismissOnScrimTap},children):null}));
jest.mock("../../../wrappers/SmartScrollView",()=>({ScrollView:({children}:any)=><View>{children}</View>}));
jest.mock("../../ui/Input",()=>({Input:(props:any)=>React.createElement("MockInput",props)}));
jest.mock("../../ui/Button",()=>({Button:(props:any)=>React.createElement("MockButton",props)}));
jest.mock("../../ui/ConfirmDialog",()=>({ConfirmDialog:(props:any)=>props.visible?React.createElement("MockConfirm",props):null}));
jest.mock("../../ui/Icon",()=>({Icon:()=>null}));
jest.mock("../../../services/peopleService",()=>{class P extends Error{constructor(public code:string,public retryable:boolean){super(code)}}return{PeopleServiceError:P}});
jest.mock("@mingla/card-identity/phone.mjs",()=>({resolveUserPhoneE164:()=>null}));

import { AddPersonSheet } from "../AddPersonSheet";
import { PeopleServiceError } from "../../../services/peopleService";
const TR=require("react-test-renderer") as {create:(node:React.ReactElement)=>any;act:(callback:()=>void|Promise<void>)=>void|Promise<void>};
let tree:any,onClose=jest.fn(),onCompleted=jest.fn();
const render=()=>TR.act(()=>{tree=TR.create(<AddPersonSheet visible onClose={onClose} brandId="brand-a" online authorized onCompleted={onCompleted}/>) });
const input=(placeholder:string)=>tree.root.findAllByType("MockInput").find((node:any)=>node.props.placeholder===placeholder);
const button=(label:string)=>tree.root.findAllByType("MockButton").find((node:any)=>node.props.label===label);
const textOf=(json:any):string=>typeof json==="string"?json:Array.isArray(json)?json.map(textOf).join(" "):json&&typeof json==="object"?textOf(json.children??[]):"";
const validEmail=()=>{TR.act(()=>input("Full name").props.onChangeText("Ada"));TR.act(()=>input("name@example.com").props.onChangeText("ada@example.test"))};

beforeEach(()=>{uuidCount=0;mutateAsync.mockReset();reset.mockReset();onClose=jest.fn();onCompleted=jest.fn();mutation={mutateAsync,reset,isPending:false,error:null};});

describe("#1774 Add person interaction state",()=>{
  test("blur announces field validation before submit",()=>{render();TR.act(()=>input("Full name").props.onBlur());expect(textOf(tree.toJSON())).toContain("Enter a name.")});
  test("dirty close requires explicit discard",()=>{render();TR.act(()=>input("Full name").props.onChangeText("Ada"));TR.act(()=>tree.root.findByType("MockSheet").props.onClose());expect(tree.root.findByType("MockConfirm")).toBeDefined();expect(onClose).not.toHaveBeenCalled();TR.act(()=>tree.root.findByType("MockConfirm").props.onConfirm());expect(onClose).toHaveBeenCalledTimes(1)});
  test("in-flight close is blocked and duplicate submit does not rotate the UUID",async()=>{mutation.isPending=false;mutateAsync.mockImplementation(()=>new Promise(()=>{}));render();validEmail();await TR.act(async()=>{button("Add person").props.onPress();button("Add person").props.onPress()});expect(mutateAsync).toHaveBeenCalledTimes(1);expect(mutateAsync.mock.calls[0][0].clientRequestId).toMatch(/^1774/);mutation.isPending=true;TR.act(()=>tree.update(<AddPersonSheet visible onClose={onClose} brandId="brand-a" online authorized onCompleted={onCompleted}/>));TR.act(()=>tree.root.findByType("MockSheet").props.onClose());expect(onClose).not.toHaveBeenCalled();expect(tree.root.findByType("MockSheet").props.dismissOnScrimTap).toBe(false)});
  test("retry reuses one request ID and review becomes a terminal state",async()=>{mutateAsync.mockRejectedValueOnce(new PeopleServiceError("people_temporarily_unavailable",true)).mockResolvedValueOnce({outcome:"review",person:null,conflictId:"conflict-1"});render();validEmail();await TR.act(async()=>{await button("Add person").props.onPress()});const first=mutateAsync.mock.calls[0][0].clientRequestId;mutation.error=new PeopleServiceError("people_temporarily_unavailable",true);TR.act(()=>tree.update(<AddPersonSheet visible onClose={onClose} brandId="brand-a" online authorized onCompleted={onCompleted}/>));await TR.act(async()=>{await button("Try again").props.onPress()});expect(mutateAsync.mock.calls[1][0].clientRequestId).toBe(first);expect(textOf(tree.toJSON())).toContain("Possible match found");expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({outcome:"review"}))});
  test("idempotency conflict exposes Done only, never another submit",()=>{mutation.error=new PeopleServiceError("people_idempotency_conflict",false);render();validEmail();expect(button("Done")).toBeDefined();expect(button("Add person")).toBeUndefined();expect(textOf(tree.toJSON())).toContain("This add request changed")});
});
