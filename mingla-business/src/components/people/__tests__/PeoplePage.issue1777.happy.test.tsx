import { describe,expect,test } from "@jest/globals";
import { readFileSync } from "node:fs";import path from "node:path";
const read=(name:string)=>readFileSync(path.resolve(__dirname,name),"utf8");
describe("#1777 People Circle composition",()=>{
  test("Book remains first and the right stack is Followers, Extended, Groups",()=>{const page=read("../PeoplePage.tsx"),followers=page.indexOf('ring="follower" openerRef={followerCircleOpenerRef} query={circleFollowers}'),extended=page.indexOf('ring="extended" openerRef={extendedCircleOpenerRef} query={circleExtended}');expect(page.indexOf('title="Your book"')).toBeLessThan(followers);expect(followers).toBeLessThan(extended);expect(extended).toBeLessThan(page.indexOf('title="Groups"'))});
  test("ring previews query independently so a full Followers page cannot hide Extended",()=>{const page=read("../PeoplePage.tsx");expect(page).toContain('useBrandCircleReach(brand?.id??null,"follower"');expect(page).toContain('useBrandCircleReach(brand?.id??null,"extended"');expect(page).toContain('query={circleFollowers}');expect(page).toContain('query={circleExtended}')});
  test("only server hook data can feed Circle and modal inerting includes the sheet",()=>{const page=read("../PeoplePage.tsx");expect(page).toContain('circleOpen!==null');expect(page).toContain("followerCircleOpenerRef");expect(page).toContain("extendedCircleOpenerRef");expect(page).toContain("focus?.()");expect(page).not.toMatch(/followersCount|extendedCircleCount|estimatedReach/)});
});
