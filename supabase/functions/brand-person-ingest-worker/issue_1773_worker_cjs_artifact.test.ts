const repositoryRoot = new URL("../../../", import.meta.url);
const workerRelativePath = "supabase/functions/brand-person-ingest-worker/index.ts";
const expectedArtifactFiles = [
  "packages/card-identity/package.json",
  "packages/card-identity/phone.js",
  "supabase/functions/_shared/brandPeople.ts",
  workerRelativePath,
].sort();

function localStaticImports(source: string): string[] {
  return [...source.matchAll(
    /^\s*import(?:\s+[^'";]+?\s+from\s+|\s*)["']([^"']+)["'](?:\s+with\s+\{[^}]+\})?;/gm,
  )].map((match) => match[1]).filter((specifier) => specifier.startsWith("."));
}

async function assembleDeploymentArtifact(artifactRoot: string): Promise<string[]> {
  const pending = [workerRelativePath];
  const copied = new Set<string>();
  while (pending.length > 0) {
    const relativePath = pending.pop()!;
    if (copied.has(relativePath)) continue;
    const sourceUrl = new URL(relativePath, repositoryRoot);
    const source = await Deno.readTextFile(sourceUrl);
    const destination = `${artifactRoot}/${relativePath}`;
    await Deno.mkdir(destination.slice(0, destination.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(destination, source);
    copied.add(relativePath);
    for (const specifier of localStaticImports(source)) {
      const dependencyUrl = new URL(specifier, sourceUrl);
      const dependencyPath = decodeURIComponent(dependencyUrl.pathname)
        .slice(decodeURIComponent(repositoryRoot.pathname).length);
      if (dependencyPath.startsWith("../") || dependencyPath.startsWith("/")) {
        throw new Error(`local import escaped repository: ${specifier}`);
      }
      pending.push(dependencyPath);
    }
  }
  return [...copied].sort();
}

async function runDeno(args: string[]): Promise<{ code: number; stdout: Uint8Array; output: string }> {
  const result = await new Deno.Command(Deno.execPath(), {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: result.code,
    stdout: result.stdout,
    output: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
  };
}

Deno.test("issue #1773 deployment-shaped artifact carries and executes the canonical CJS boundary", async () => {
  const artifactRoot = await Deno.makeTempDir({ prefix: "issue-1773-worker-artifact-" });
  try {
    const copied = await assembleDeploymentArtifact(artifactRoot);
    if (JSON.stringify(copied) !== JSON.stringify(expectedArtifactFiles)) {
      throw new Error(`unexpected deployment artifact: ${JSON.stringify(copied)}`);
    }

    const entrypoint = `${artifactRoot}/${workerRelativePath}`;
    const info = await runDeno(["info", "--json", entrypoint]);
    if (info.code !== 0) throw new Error(`deno info failed:\n${info.output}`);
    const graph = JSON.parse(info.output) as { modules?: Array<{ specifier?: string }> };
    const graphSpecifiers = (graph.modules ?? []).map((module) => module.specifier ?? "");
    if (!graphSpecifiers.some((specifier) => specifier.endsWith("/packages/card-identity/package.json"))) {
      throw new Error("package.json is absent from the worker module graph");
    }
    if (!graphSpecifiers.some((specifier) => specifier.endsWith("/packages/card-identity/phone.js"))) {
      throw new Error("canonical phone.js is absent from the worker module graph");
    }

    const checked = await runDeno(["check", entrypoint]);
    if (checked.code !== 0) throw new Error(`plain deno check failed:\n${checked.output}`);

    const bundlePath = `${artifactRoot}/brand-person-ingest-worker.bundle.js`;
    const bundled = await runDeno(["bundle", entrypoint]);
    if (bundled.code !== 0) throw new Error(`plain deno bundle failed:\n${bundled.output}`);
    await Deno.writeFile(bundlePath, bundled.stdout);
    const workerUrl = new URL(`file://${bundlePath}`).href;
    const loaded = await runDeno([
      "eval",
      `const worker=await import(${JSON.stringify(workerUrl)});` +
      `if(typeof worker.normalizedPhoneForIngest!=="function")throw new Error("worker did not load");` +
      `const cases=[["(919) 419-9222","US","+19194199222"],["01279 942348","GB","+441279942348"],["0803 482 1689","NG","+2348034821689"],["+19194199222",null,"+19194199222"]];` +
      `const client=(raw,iso)=>({from:()=>({select:()=>({eq:()=>({maybeSingle:()=>Promise.resolve({data:{phone:raw,phoneCountryIso:iso},error:null})})})})});` +
      `for(const [raw,iso,want] of cases){const got=await worker.normalizedPhoneForIngest(client(raw,iso),{source_kind:"reservation",source_id:crypto.randomUUID(),operation:"upsert"});if(got!==want)throw new Error(raw+":"+got);}`,
    ]);
    if (loaded.code !== 0) throw new Error(`artifact load/probe failed:\n${loaded.output}`);
  } finally {
    await Deno.remove(artifactRoot, { recursive: true });
  }
});
