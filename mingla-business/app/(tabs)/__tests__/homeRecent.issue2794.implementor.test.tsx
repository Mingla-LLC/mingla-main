import fs from "node:fs";
import path from "node:path";

test("#2794 mobile Home has one vertical owner and desktop keeps a bounded Recent pane", () => {
  const home = fs.readFileSync(path.join(__dirname, "..", "home.tsx"), "utf8");
  const todo = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "src",
      "components",
      "home",
      "BusinessTodoToggle.tsx",
    ),
    "utf8",
  );
  expect(home).toContain('presentation="page-flow"');
  expect(home).toContain('testID="home-mobile-scroll"');
  expect(home).toContain('testID="home-desktop-recent-scroll"');
  expect(home).toContain('router.push("/recent"');
  expect(todo).toContain('presentation === "page-flow"');
  expect(todo).toContain("style={styles.list}");
});
