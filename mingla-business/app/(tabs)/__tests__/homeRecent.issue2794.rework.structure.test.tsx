import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";

test("desktop ids identify the correct vertical Recent list and horizontal Live carousel", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "home.tsx"), "utf8");
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  const found = new Map<string, { tag: string; horizontal: boolean }>();
  traverse(ast, {
    JSXOpeningElement(p) {
      const id = p.node.attributes.find(
        (a) => a.type === "JSXAttribute" && a.name.name === "testID",
      );
      if (id?.type !== "JSXAttribute" || id.value?.type !== "StringLiteral") return;
      if (
        id.value.value !== "home-desktop-recent-scroll" &&
        id.value.value !== "home-live-carousel"
      ) return;
      found.set(id.value.value, {
        tag: p.node.name.type === "JSXIdentifier" ? p.node.name.name : "",
        horizontal: p.node.attributes.some(
          (a) => a.type === "JSXAttribute" && a.name.name === "horizontal",
        ),
      });
    },
  });
  expect(found.get("home-desktop-recent-scroll")).toEqual({
    tag: "ScrollView",
    horizontal: false,
  });
  expect(found.get("home-live-carousel")).toEqual({
    tag: "ScrollView",
    horizontal: true,
  });
});

test("mobile no-brand branch retains the one FlatList owner and page-flow Todo", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "home.tsx"), "utf8");
  expect(source).toMatch(
    /currentBrand === null[\s\S]{0,500}<FlatList[\s\S]{0,500}presentation="page-flow"/,
  );
});
