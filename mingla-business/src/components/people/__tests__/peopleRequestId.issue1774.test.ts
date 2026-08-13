import { describe,expect,jest,test } from "@jest/globals";
import { createPeopleRequestId } from "../peopleRequestId";

describe("#1774 secure manual-add request identity",()=>{
  test("uses platform randomUUID when present",()=>{const original=globalThis.crypto;Object.defineProperty(globalThis,"crypto",{configurable:true,value:{randomUUID:jest.fn(()=>"17740000-0000-4000-8000-000000000001")}});expect(createPeopleRequestId()).toBe("17740000-0000-4000-8000-000000000001");Object.defineProperty(globalThis,"crypto",{configurable:true,value:original})});
  test("never falls back to Math.random when secure randomness is absent",()=>{const original=globalThis.crypto;Object.defineProperty(globalThis,"crypto",{configurable:true,value:undefined});expect(()=>createPeopleRequestId()).toThrow("secure_random_unavailable");Object.defineProperty(globalThis,"crypto",{configurable:true,value:original})});
});
