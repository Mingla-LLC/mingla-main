import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");
const businessRoot = path.join(repoRoot, "mingla-business");

const nativeResolutionCandidates = (basePath: string): string[] => [
  `${basePath}.native.tsx`,
  `${basePath}.native.ts`,
  `${basePath}.tsx`,
  `${basePath}.ts`,
  `${basePath}.jsx`,
  `${basePath}.js`,
  path.join(basePath, "index.native.tsx"),
  path.join(basePath, "index.native.ts"),
  path.join(basePath, "index.tsx"),
  path.join(basePath, "index.ts"),
  path.join(basePath, "index.jsx"),
  path.join(basePath, "index.js"),
];

const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

const importSpecifiers = (source: string): string[] => {
  const stripped = stripComments(source);
  const specs: string[] = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?[^'"]*?\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(stripped)) !== null) {
      specs.push(match[1]);
    }
  }

  return specs;
};

const resolveNativeRelativeImport = (
  fromFile: string,
  specifier: string,
): string | null => {
  if (!specifier.startsWith(".")) return null;
  const basePath = path.resolve(path.dirname(fromFile), specifier);
  return (
    nativeResolutionCandidates(basePath).find((candidate) =>
      fs.existsSync(candidate),
    ) ?? null
  );
};

const collectNativeRelativeGraph = (entryRelativePath: string): string[] => {
  const entry = path.join(businessRoot, entryRelativePath);
  const visited = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const filePath = queue.shift();
    if (filePath === undefined || visited.has(filePath)) continue;
    visited.add(filePath);

    const source = fs.readFileSync(filePath, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveNativeRelativeImport(filePath, specifier);
      if (resolved !== null && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return [...visited].sort();
};

const rel = (absolutePath: string): string =>
  path.relative(repoRoot, absolutePath).replaceAll(path.sep, "/");

describe("META-ORCH-0972 Sub-B Android root native Stripe transitive graph", () => {
  it("does not let the native root layout import the Stripe checkout boundary transitively", () => {
    const graph = collectNativeRelativeGraph("app/_layout.tsx");
    const graphRel = graph.map(rel);

    expect(graphRel).not.toContain(
      "mingla-business/src/payments/StripeProviderWrapper.native.tsx",
    );
    expect(graphRel).not.toContain(
      "mingla-business/src/payments/NativeCheckoutPaymentBoundary.native.tsx",
    );
    expect(graphRel).not.toContain(
      "mingla-business/src/payments/nativeCheckoutFlow.native.ts",
    );

    const nativeStripeImporters = graphRel.filter((relativePath, index) => {
      const source = stripComments(fs.readFileSync(graph[index], "utf8"));
      return /from\s+["'](?:@stripe\/stripe-react-native|@mingla\/payments-native)["']/.test(
        source,
      );
    });

    expect(nativeStripeImporters).toEqual([]);
  });
});

// fails-on-revert verified at c9741eb52: app/_layout.tsx imported
// StripeProviderWrapper, so native platform resolution pulled
// StripeProviderWrapper.native.tsx and @mingla/payments-native into the root
// startup graph.
