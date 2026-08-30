#!/usr/bin/env node
/** ORCH-1308 + #2715 — picked-source durability guard. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PICKER_REL = "mingla-business/src/components/ui/CoverPicker.tsx";
const HOOK_REL = "mingla-business/src/hooks/useEventCoverVideoUpload.ts";
const normalize = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "").replace(/\s+/g, " ");

function scan(sources) {
  const failures = [];
  const picker = normalize(sources.picker ?? "");
  const hook = normalize(sources.hook ?? "");
  if (!/pickedVideoAssetsRef\.current\s*=\s*result\.assets/.test(picker)) {
    failures.push("A: CoverPicker no longer retains result.assets through preparation.");
  }
  if (!/revokeCoverPickedAssets\(\s*pickedVideoAssetsRef\.current\s*\)/.test(picker)) {
    failures.push("B: CoverPicker no longer cleans the retained blob on replacement/unmount.");
  }
  const pickerFunction = picker.match(/const pickVideoCover[\s\S]*?const cancelVideoCoverUpload/)?.[0] ?? "";
  const finalBlock = pickerFunction.match(/finally\s*\{([\s\S]*?)\}/)?.[1] ?? null;
  if (finalBlock === null || !finalBlock.includes("setUploading(false)")) {
    failures.push("C: cannot prove pickVideoCover finally settles its uploading projection.");
  } else if (finalBlock.includes("revokeCoverPickedAssets")) {
    failures.push("C: pickVideoCover finally revokes the source before durable recovery can use it.");
  }
  const uploadBlock = hook.match(/const uploadPrepared[\s\S]*?const startInternal/)?.[0] ?? "";
  const startBlock = hook.match(/const startInternal[\s\S]*?const start\s*=/)?.[0] ?? "";
  const resumeBlock = hook.match(/const resume[\s\S]*?useEffect/)?.[0] ?? "";
  const persistIndex = uploadBlock.indexOf("persist(userId, prepared, operationId");
  const allocationIndex = uploadBlock.indexOf("createEventCoverVideoUploadIntent");
  const prepareIndex = startBlock.indexOf("prepareEventCoverVideoSource");
  const uploadPreparedIndex = startBlock.indexOf("uploadPrepared(");
  if (persistIndex < 0 || allocationIndex < 0 || persistIndex > allocationIndex ||
      prepareIndex < 0 || uploadPreparedIndex < 0 || prepareIndex > uploadPreparedIndex ||
      !hook.includes("readPersistedCoverVideoJob") ||
      !/await uploadPrepared\(prepared,persisted\.clientOperationId,persisted\)/.test(resumeBlock)) {
    failures.push("D: upload hook must prepare/persist before allocation and resume the exact durable operation/source.");
  }
  return failures;
}

if (process.argv.includes("--self-test")) {
  const goodPicker = `
    const pickedVideoAssetsRef = useRef([]);
    useEffect(() => () => revokeCoverPickedAssets(pickedVideoAssetsRef.current), []);
    const pickVideoCover = async () => {
      try {
        const result = await launchCoverVideoPicker();
        pickedVideoAssetsRef.current = result.assets;
        await videoUpload.start(uploadFile);
      } catch (error) { handle(error); }
      finally { setUploading(false); }
    };
    const cancelVideoCoverUpload = () => {};`;
  const goodHook = `
    const uploadPrepared = async (prepared, operationId) => {
      await persist(userId, prepared, operationId, null);
      await createEventCoverVideoUploadIntent({ clientOperationId: operationId });
    };
    const startInternal = async () => {
      const prepared = await prepareEventCoverVideoSource(input);
      await uploadPrepared(prepared, operationId);
    };
    const start = () => {};
    const resume = async () => {
      const persisted = await readPersistedCoverVideoJob(userId, persistenceKey);
      await uploadPrepared(prepared,persisted.clientOperationId,persisted);
    };
    useEffect(() => {});`;
  const badFinally = goodPicker.replace("finally { setUploading(false); }", "finally { revokeCoverPickedAssets(pickedVideoAssetsRef.current); setUploading(false); }");
  const badRetention = goodPicker.replace("pickedVideoAssetsRef.current = result.assets;", "const picked = result.assets;");
  const badOrder = goodHook.replace(
    "await persist(userId, prepared, operationId, null);\n      await createEventCoverVideoUploadIntent",
    "await createEventCoverVideoUploadIntent({ clientOperationId: operationId });\n      await persist(userId, prepared, operationId, null);\n      await ignoredIntent",
  );
  const badOperation = goodHook.replace(
    "uploadPrepared(prepared,persisted.clientOperationId,persisted)",
    "uploadPrepared(prepared,newOperationId(),persisted)",
  );
  const cases = [
    ["GOOD durable source", scan({ picker: goodPicker, hook: goodHook }), false],
    ["BAD revoke in finally", scan({ picker: badFinally, hook: goodHook }), true],
    ["BAD no retention", scan({ picker: badRetention, hook: goodHook }), true],
    ["BAD persist after allocation", scan({ picker: goodPicker, hook: badOrder }), true],
    ["BAD mismatched resume operation", scan({ picker: goodPicker, hook: badOperation }), true],
  ];
  for (const [label, failures, shouldFail] of cases) {
    if ((failures.length > 0) !== shouldFail) {
      console.error(`ORCH-1308 self-test FAIL: ${label}: ${failures.join("; ")}`);
      process.exit(1);
    }
  }
  console.log("ORCH-1308 retry-source gate self-test PASS (5/5).");
  process.exit(0);
}

const read = (rel) => readFileSync(join(REPO_ROOT, rel), "utf8");
const failures = scan({ picker: read(PICKER_REL), hook: read(HOOK_REL) });
if (failures.length > 0) {
  console.error("ORCH-1308 retry-source gate FAIL:\n\n  - " + failures.join("\n  - "));
  process.exit(1);
}
console.log("ORCH-1308 retry-source gate PASS — blob preparation and exact durable-source resume are pinned.");
