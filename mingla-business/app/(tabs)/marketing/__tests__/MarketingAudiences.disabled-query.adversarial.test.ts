/**
 * #1774 authorized in-place retarget of the ORCH-0889 disabled-query guard.
 * People now owns the route, while Groups keeps the original audience hook.
 */
import fs from "node:fs";
import path from "node:path";

const PAGE = path.resolve(__dirname,"..","..","..","..","src","components","people","PeoplePage.tsx");
const PEOPLE_HOOK = path.resolve(__dirname,"..","..","..","..","src","hooks","marketing","useBrandPeople.ts");
const GROUPS_HOOK = path.resolve(__dirname,"..","..","..","..","src","hooks","marketing","useAudienceList.ts");

describe("#1774 — People disabled-query loading and independent Groups",()=>{
  const page=fs.readFileSync(PAGE,"utf8"),people=fs.readFileSync(PEOPLE_HOOK,"utf8"),groups=fs.readFileSync(GROUPS_HOOK,"utf8");
  it("(T-02a) keeps auth/role unresolved Book in loading, never false-empty",()=>{
    expect(page).toContain('book.kind==="authLoading"||book.kind==="roleLoading"||book.kind==="loading"');
    expect(people).toContain('!isAuthReady||user===null?"authLoading"');
    expect(people).toContain('!roleResolved?"roleLoading"');
    expect(people).toContain("hasResolved:query.isFetched");
  });
  it("(T-02b) preserves the original audience hook and disabled-query-safe Groups guard",()=>{
    expect(page).toContain("const groups=useAudienceList(user?.id??null)");
    expect(page).toContain('title="Groups"');
    expect(page).toContain("!groups.hasResolved&&!groups.isError");
    expect(groups).toContain("hasResolved: query.isFetched");
  });
  it("(T-02c) does not restore the brittle isLoading plus empty-list guard",()=>{
    expect(page).not.toMatch(/groups\.isLoading\s*&&\s*groups\.entries\.length\s*===\s*0/);
  });
  it("(T-02d) declares the Groups skeleton before the real empty state",()=>{
    const skeleton=page.indexOf('testID="people-groups-skeleton"');
    const empty=page.indexOf('title="No buyer groups yet."');
    expect(skeleton).toBeGreaterThan(-1);
    expect(empty).toBeGreaterThan(-1);
    expect(skeleton).toBeLessThan(empty);
  });
  it("(T-02e) retains real Groups error and empty terminal states",()=>{
    expect(page).toContain("Couldn’t load groups.");
    expect(page).toContain("No buyer groups yet.");
  });
  it("(T-02f) the compatibility route is renderless and cannot execute either query",()=>{
    const redirect=fs.readFileSync(path.resolve(__dirname,"..","audiences","index.tsx"),"utf8");
    expect(redirect).toContain('<Redirect href="/(tabs)/marketing/people" />');
    expect(redirect).not.toContain("useAudienceList");
    expect(redirect).not.toContain("useBrandPeople");
  });
});
