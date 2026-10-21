// PRIVATE (not committed: it fails at b70f9953d). GitHub's issueOrPullRequest returns the IssueOrPullRequest UNION;
// a union allows only __typename and inline fragments directly. GitHub answered the b70f9953d query with
// "Selections can't be made directly on unions" (follow_query_b70f.github_answer.json), so every follow batch fails.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildFollowQuery } from "../productAvengers.ts";

/** The selections written directly inside each issueOrPullRequest { ... }, outside any "... on X { }" fragment. */
function directSelections(q: string): string[][] {
  const out: string[][] = [];
  const re = /issueOrPullRequest\(number: \d+\) \{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    let i = m.index + m[0].length, depth = 1, inFragment = 0; const direct: string[] = []; let word = "";
    const stack: boolean[] = [];
    while (i < q.length && depth > 0) {
      const ch = q[i];
      if (ch === "{") { stack.push(/\.\.\. on \w+ $/.test(q.slice(Math.max(0, i - 40), i))); if (stack.at(-1)) inFragment++; depth++; }
      else if (ch === "}") { depth--; if (stack.pop()) inFragment--; }
      else if (depth === 1 && inFragment === 0) {
        if (/[A-Za-z_]/.test(ch)) word += ch;
        else { if (word && word !== "on") direct.push(word); word = ""; }
      }
      i++;
    }
    out.push(direct.filter((w) => !/^(Issue|PullRequest)$/.test(w)));
  }
  return out;
}

Deno.test("follow: only __typename is selected directly on the IssueOrPullRequest union", () => {
  const sel = directSelections(buildFollowQuery([3980, 3991]));
  assertEquals(sel.length, 2);
  for (const s of sel) assertEquals(s, ["__typename"]);
});
