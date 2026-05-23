declare const module: any;
declare const process: any;
declare const require: any;

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function resolveRepoFile(relPath: string): string {
  const appMobilePath = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(appMobilePath)) return appMobilePath;
  return path.resolve(process.cwd(), "app-mobile", relPath);
}

function readSource(relPath: string): string {
  return fs.readFileSync(resolveRepoFile(relPath), "utf8");
}

export function runOrch0943PrefsApplyCoordCoherenceTest() {
  const prefs = readSource("src/components/PreferencesSheet.tsx");
  const context = readSource("src/contexts/RecommendationsContext.tsx");

  const applyStart = prefs.indexOf("const handleApplyPreferences = useCallback(async () => {");
  const applyEnd = prefs.indexOf("  }, [", applyStart);
  const applyBlock = prefs.slice(applyStart, applyEnd);
  const autoResolveStart = applyBlock.indexOf("ORCH-0943 Fix B1");
  const customLocationIdx = applyBlock.indexOf("const customLocationValue");
  const autoResolveBlock = applyBlock.slice(autoResolveStart, customLocationIdx);

  assert.match(autoResolveBlock, /geocodingService\.autocomplete\(searchLocation\)/);
  assert.match(autoResolveBlock, /resolvedSuggestion\.fullAddress\s*\|\|\s*resolvedSuggestion\.displayName/);
  assert.match(autoResolveBlock, /effectiveSelectedCoords\s*=\s*resolvedCoords/);
  assert.match(autoResolveBlock, /setSelectedCoords\(effectiveSelectedCoords\)/);

  assert.match(applyBlock, /custom_lat:\s*effectiveSelectedCoords\?\.lat\s*\?\?\s*null/);
  assert.match(applyBlock, /custom_lng:\s*effectiveSelectedCoords\?\.lng\s*\?\?\s*null/);
  assert.match(
    applyBlock,
    /let\s+collabLat:\s*number\s*\|\s*null\s*=\s*effectiveSelectedCoords\?\.lat\s*\?\?\s*null/,
  );
  assert.match(
    applyBlock,
    /let\s+collabLng:\s*number\s*\|\s*null\s*=\s*effectiveSelectedCoords\?\.lng\s*\?\?\s*null/,
  );

  assert.match(autoResolveBlock, /toastManager\.warning\(\s*['"]Tap a suggestion to set your location\.['"]\s*,\s*3000/);
  assert.match(autoResolveBlock, /console\.warn\(\s*['"]\[ORCH-0943\] auto-resolve failed['"]\s*,\s*err\s*\)/);

  const r38Start = context.indexOf("ORCH-0446 R3.8 + ORCH-0943 Fix A");
  const r38End = context.indexOf("// immediately kicks back to solo", r38Start);
  const r38Block = context.slice(r38Start, r38End);
  assert.match(r38Block, /const\s+participantUseGps\s*=\s*boardSessionResult\.preferences\?\.use_gps_location/);
  assert.match(r38Block, /if\s*\(\s*participantUseGps\s*!==\s*true\s*\)\s*return;/);
  assert.match(r38Block, /custom_lat:\s*userLocation\.lat/);
  assert.match(r38Block, /custom_lng:\s*userLocation\.lng/);
}

if (require.main === module) {
  try {
    runOrch0943PrefsApplyCoordCoherenceTest();
    console.log("PASS T-01..T-06 ORCH-0943 prefs apply coord coherence");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
