#!/usr/bin/env node
// #3872: Door Sales remain an in-person list-price rail. Online sale fields and
// promo codes must never leak into the door cart.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith(".github")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const forbidden = [
  "saleAllInGbp",
  "salePriceGbp",
  "saleBaseCents",
  "saleAllInCents",
  "discountCode",
  "issue_3872_",
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function violations(entries) {
  return entries.flatMap(({ file, source }) =>
    forbidden.filter((needle) => source.includes(needle)).map((needle) =>
      `${file} contains ${needle}`
    )
  );
}

if (process.argv.includes("--self-test")) {
  if (violations([{ file: "good.ts", source: "const unit = tier.priceGbp;" }]).length !== 0) {
    throw new Error("list-price fixture was rejected");
  }
  for (const needle of forbidden) {
    if (violations([{ file: "revert.ts", source: `const bad = ${JSON.stringify(needle)};` }]).length !== 1) {
      throw new Error(`revert fixture was not rejected: ${needle}`);
    }
  }
  console.log("issue-3872 door-full-price self-test passed");
  process.exit(0);
}

const targets = [
  ...walk(path.join(root, "mingla-business/src/components/door")),
  path.join(root, "mingla-business/src/store/doorSalesStore.ts"),
  path.join(root, "mingla-business/src/utils/expandDoorTickets.ts"),
].filter((file) => fs.existsSync(file) && fs.statSync(file).isFile());
const found = violations(targets.map((file) => ({
  file: path.relative(root, file),
  source: fs.readFileSync(file, "utf8"),
})));
if (found.length > 0) {
  console.error(`I-3872-DOOR-FULL-PRICE FAIL:\n  ${found.join("\n  ")}`);
  process.exit(1);
}
console.log("I-3872-DOOR-FULL-PRICE passed");
