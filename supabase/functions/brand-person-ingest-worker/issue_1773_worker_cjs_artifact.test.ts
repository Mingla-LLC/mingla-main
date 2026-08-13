const repositoryRoot = new URL("../../../", import.meta.url);
const workerRelativePath = "supabase/functions/brand-person-ingest-worker/index.ts";
const sharedRelativePath = "supabase/functions/_shared/brandPeople.ts";
const adapterRelativePath = "packages/card-identity/phone.cjs";
const expectedUploadedFiles = [
  adapterRelativePath,
  sharedRelativePath,
  workerRelativePath,
].sort();

type CommandResult = {
  code: number;
  stdout: Uint8Array;
  output: string;
};

async function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<CommandResult> {
  const result = await new Deno.Command(command, {
    args,
    cwd: options.cwd,
    env: options.env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    code: result.code,
    stdout: result.stdout,
    output: decoder.decode(result.stdout) + decoder.decode(result.stderr),
  };
}

async function assertSourceBoundary(): Promise<Uint8Array> {
  const adapterUrl = new URL(adapterRelativePath, repositoryRoot);
  const adapterInfo = await Deno.lstat(adapterUrl);
  if (!adapterInfo.isSymlink) throw new Error("phone.cjs is not a symlink");
  if (await Deno.readLink(adapterUrl) !== "phone.js") {
    throw new Error("phone.cjs does not point exactly to phone.js");
  }
  const gitMode = await run("git", ["ls-files", "-s", adapterRelativePath], {
    cwd: decodeURIComponent(repositoryRoot.pathname),
  });
  if (gitMode.code !== 0 || !gitMode.output.startsWith("120000 ")) {
    throw new Error(`phone.cjs is not recorded with Git mode 120000: ${gitMode.output}`);
  }
  const adapterBytes = await Deno.readFile(adapterUrl);
  const canonicalBytes = await Deno.readFile(
    new URL("packages/card-identity/phone.js", repositoryRoot),
  );
  if (adapterBytes.length !== canonicalBytes.length ||
    adapterBytes.some((byte, index) => byte !== canonicalBytes[index])) {
    throw new Error("phone.cjs did not dereference to the exact canonical phone.js bytes");
  }
  return canonicalBytes;
}

async function captureSupabaseUpload(
  artifactRoot: string,
  canonicalBytes: Uint8Array,
): Promise<string[]> {
  let resolveUpload!: (form: FormData) => void;
  let rejectUpload!: (error: unknown) => void;
  const upload = new Promise<FormData>((resolve, reject) => {
    resolveUpload = resolve;
    rejectUpload = reject;
  });
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, async (request) => {
    if (new URL(request.url).pathname.endsWith("/functions/deploy")) {
      try {
        resolveUpload(await request.formData());
      } catch (error) {
        rejectUpload(error);
      }
      return new Response('{"expected":"local proof stops before deployment"}', { status: 500 });
    }
    return new Response("not found", { status: 404 });
  });
  const profilePath = `${artifactRoot}/issue-1773-supabase-profile.toml`;
  await Deno.writeTextFile(
    profilePath,
    [
      'name = "issue-1773-local-proof"',
      `api_url = "http://127.0.0.1:${server.addr.port}"`,
      `dashboard_url = "http://127.0.0.1:${server.addr.port}"`,
      'docs_url = "https://supabase.com/docs"',
      'project_host = "localhost"',
      'pooler_host = "localhost"',
      "",
    ].join("\n"),
  );
  try {
    const version = await run("supabase", ["--version"]);
    if (version.code !== 0 || new TextDecoder().decode(version.stdout).trim() !== "2.98.2") {
      throw new Error(`Supabase CLI is not pinned to 2.98.2: ${version.output}`);
    }
    const cli = await run("supabase", [
      "--profile",
      profilePath,
      "--workdir",
      decodeURIComponent(repositoryRoot.pathname),
      "functions",
      "deploy",
      "brand-person-ingest-worker",
      "--project-ref",
      "abcdefghijklmnopqrst",
      "--use-api",
    ], {
      env: {
        SUPABASE_ACCESS_TOKEN: `sbp_${"0".repeat(40)}`,
        SUPABASE_TELEMETRY_DISABLED: "true",
      },
    });
    if (cli.code === 0 || !cli.output.includes("unexpected deploy status 500")) {
      throw new Error(`CLI did not stop at the local non-deploying endpoint:\n${cli.output}`);
    }
    const form = await upload;
    const uploaded = form.getAll("file");
    const names = uploaded.map((entry) => {
      if (!(entry instanceof File)) throw new Error("Supabase upload contained a non-file asset");
      return entry.name;
    }).sort();
    if (JSON.stringify(names) !== JSON.stringify(expectedUploadedFiles)) {
      throw new Error(`unexpected Supabase upload artifact: ${JSON.stringify(names)}`);
    }
    for (const entry of uploaded) {
      const file = entry as File;
      const destination = `${artifactRoot}/${file.name}`;
      await Deno.mkdir(destination.slice(0, destination.lastIndexOf("/")), {
        recursive: true,
      });
      await Deno.writeFile(destination, new Uint8Array(await file.arrayBuffer()));
    }
    const stagedAdapter = `${artifactRoot}/${adapterRelativePath}`;
    const stagedInfo = await Deno.lstat(stagedAdapter);
    if (!stagedInfo.isFile || stagedInfo.isSymlink) {
      throw new Error("uploaded phone.cjs is not a regular staged file");
    }
    const stagedBytes = await Deno.readFile(stagedAdapter);
    if (stagedBytes.length !== canonicalBytes.length ||
      stagedBytes.some((byte, index) => byte !== canonicalBytes[index])) {
      throw new Error("Supabase CLI did not upload canonical phone.js bytes as phone.cjs");
    }
    for (const forbidden of [
      `${artifactRoot}/packages/card-identity/phone.js`,
      `${artifactRoot}/packages/card-identity/package.json`,
    ]) {
      try {
        await Deno.stat(forbidden);
        throw new Error(`forbidden staged dependency exists: ${forbidden}`);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
    return names;
  } finally {
    await server.shutdown();
  }
}

Deno.test("issue #1773 Supabase upload and Deno artifact preserve the canonical CJS boundary", async () => {
  const artifactRoot = await Deno.makeTempDir({ prefix: "issue-1773-worker-artifact-" });
  const cleanCache = await Deno.makeTempDir({ prefix: "issue-1773-deno-cache-" });
  try {
    const denoVersion = await run(Deno.execPath(), ["--version"]);
    if (denoVersion.code !== 0 || !denoVersion.output.startsWith("deno 2.9.5 ")) {
      throw new Error(`Deno is not pinned to 2.9.5: ${denoVersion.output}`);
    }
    const canonicalBytes = await assertSourceBoundary();
    await captureSupabaseUpload(artifactRoot, canonicalBytes);

    const entrypoint = `${artifactRoot}/${workerRelativePath}`;
    const denoEnv = { DENO_DIR: cleanCache };
    const info = await run(Deno.execPath(), ["info", "--json", entrypoint], { env: denoEnv });
    if (info.code !== 0) throw new Error(`plain deno info failed:\n${info.output}`);
    const graph = JSON.parse(new TextDecoder().decode(info.stdout)) as {
      modules?: Array<{ specifier?: string; mediaType?: string }>;
    };
    const executableModules = (graph.modules ?? []).filter((module) =>
      ![undefined, "Dts", "Dmts"].includes(module.mediaType)
    );
    if (executableModules.length !== 26) {
      throw new Error(
        `unexpected executable worker graph size: ${executableModules.length} modules`,
      );
    }
    if (!(graph.modules ?? []).some((module) =>
      module.specifier?.endsWith("/packages/card-identity/phone.cjs")
    )) throw new Error("staged phone.cjs is absent from the Deno module graph");

    const checked = await run(Deno.execPath(), ["check", entrypoint], { env: denoEnv });
    if (checked.code !== 0) throw new Error(`plain deno check failed:\n${checked.output}`);

    const bundled = await run(Deno.execPath(), ["bundle", entrypoint], { env: denoEnv });
    if (bundled.code !== 0) throw new Error(`plain deno bundle failed:\n${bundled.output}`);
    const bundleSource = new TextDecoder().decode(bundled.stdout);
    if (!bundleSource.includes("resolveUserPhoneE164")) {
      throw new Error("canonical phone resolver is absent from the complete bundle");
    }
    const bundlePath = `${artifactRoot}/brand-person-ingest-worker.bundle.js`;
    await Deno.writeFile(bundlePath, bundled.stdout);
    const workerUrl = new URL(`file://${bundlePath}`).href;
    const loaded = await run(Deno.execPath(), [
      "eval",
      `const worker=await import(${JSON.stringify(workerUrl)});` +
      `if(typeof worker.normalizedPhoneForIngest!=="function")throw new Error("worker did not load");` +
      `const cases=[["(919) 419-9222","US","+19194199222"],["01279 942348","GB","+441279942348"],["0803 482 1689","NG","+2348034821689"],["+19194199222",null,"+19194199222"]];` +
      `const client=(raw,iso)=>({from:()=>({select:()=>({eq:()=>({maybeSingle:()=>Promise.resolve({data:{phone:raw,phoneCountryIso:iso},error:null})})})})});` +
      `for(const [raw,iso,want] of cases){const got=await worker.normalizedPhoneForIngest(client(raw,iso),{source_kind:"reservation",source_id:crypto.randomUUID(),operation:"upsert"});if(got!==want)throw new Error(raw+":"+got);}`,
    ], { env: denoEnv });
    if (loaded.code !== 0) throw new Error(`artifact load/probe failed:\n${loaded.output}`);
  } finally {
    await Deno.remove(artifactRoot, { recursive: true });
    await Deno.remove(cleanCache, { recursive: true });
  }
});
