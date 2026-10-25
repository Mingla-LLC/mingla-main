// MINGLA-INVARIANT: I-3988-SESSION-PILLS-SINGLE-OWNER | issue #3988 | The Explorer Home route mounts one session-management controller; RecommendationsProvider, SwipeableCards, and onboarding consumers read it from context and cannot independently subscribe to session_pills.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function repoRoot() {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "app-mobile/app/index.tsx"))) return cwd;
  if (fs.existsSync(path.join(cwd, "app/index.tsx"))) return path.dirname(cwd);
  throw new Error(`cannot locate repository root from ${cwd}`);
}

const ROOT = repoRoot();
const read = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const CONSUMERS = [
  "app-mobile/src/contexts/RecommendationsContext.tsx",
  "app-mobile/src/components/SwipeableCards.tsx",
  "app-mobile/src/components/OnboardingFlow.tsx",
  "app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx",
];

test("#3988 Home owns one session controller above provider and deck consumers", () => {
  const index = read("app-mobile/app/index.tsx");
  const context = read("app-mobile/src/contexts/SessionManagementContext.tsx");
  const controller = read("app-mobile/src/hooks/useSessionManagement.ts");

  assert.match(
    index,
    /<SessionManagementProvider key=\{sessionOwnerId\}>\s*<AppContent\s*\/>\s*<\/SessionManagementProvider>/s,
    "the Home route must mount one provider around AppContent",
  );
  assert.match(
    index,
    /state\.user\?\.id \?\? "signed-out"/,
    "the shared controller must remount when authenticated account ownership changes",
  );
  assert.match(
    index,
    /export default Sentry\.wrap\(SessionManagedAppContent\)/,
    "the exported route must be the provider-owned wrapper",
  );
  assert.equal(
    (context.match(/useSessionManagementController\(\)/g) ?? []).length,
    1,
    "the provider must instantiate exactly one controller",
  );
  assert.match(
    controller,
    /`session_pills:\$\{userId\}:\$\{controllerInstanceRef\.current\}:\$\{channelEpoch\}`/,
    "the controller channel must be unique to its mount and lifecycle epoch",
  );
  assert.match(
    controller,
    /realtimeLoadUserSessionsRef\.current\(\)/,
    "the channel must call the latest loader without rebuilding for callback identity",
  );
  assert.match(
    controller,
    /\}, \[user\?\.id\]\);/,
    "the realtime lifecycle must change only when the authenticated user changes",
  );
});

test("#3988 collaboration pills survive asynchronous same-user channel replacement", () => {
  const index = read("app-mobile/app/index.tsx");

  assert.match(
    index,
    /`collaboration_pill_changes_\$\{userId\}:\$\{collaborationPillOwnerRef\.current\}:\$\{channelEpoch\}`/,
    "each AppContent lifecycle must own a collision-free collaboration-pill topic",
  );
  assert.match(
    index,
    /void supabase\.removeChannel\(channel\)/,
    "cleanup must retire the exact lifecycle-owned channel",
  );
});

test("#3988 global board and social subscriptions survive keyed realtime remounts", () => {
  const boards = read("app-mobile/src/hooks/useBoardQueries.ts");
  const social = read("app-mobile/src/hooks/useSocialRealtime.ts");

  assert.match(
    boards,
    /`board_changes_rq_\$\{userId\}:\$\{ownerRef\.current\}:\$\{channelEpoch\}`/,
    "board realtime must not reuse an asynchronously-removing topic",
  );
  assert.match(
    social,
    /`social-realtime-\$\{userId\}:\$\{ownerRef\.current\}:\$\{channelEpoch\}`/,
    "social realtime must not reuse an asynchronously-removing topic",
  );
  assert.match(boards, /void supabase\.removeChannel\(channel\)/);
  assert.match(social, /void supabase\.removeChannel\(channel\)/);
});

test("#3988 every session consumer reads context instead of mounting a controller", () => {
  for (const relativePath of CONSUMERS) {
    const source = read(relativePath);
    assert.match(
      source,
      /import\s*\{\s*useSessionManagement\s*\}\s*from\s*["'][^"']*SessionManagementContext["']/,
      `${relativePath} must import the shared context hook`,
    );
    assert.doesNotMatch(
      source,
      /import\s*\{[^}]*useSessionManagement[^}]*\}\s*from\s*["'][^"']*hooks\/useSessionManagement["']/,
      `${relativePath} must not instantiate the controller hook directly`,
    );
  }
});

test("#3988 only SessionManagementContext may instantiate the controller", () => {
  const sourceRoots = [
    path.join(ROOT, "app-mobile/app"),
    path.join(ROOT, "app-mobile/src"),
  ];
  const offenders = [];

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const source = fs.readFileSync(absolutePath, "utf8");
        if (
          source.includes("useSessionManagementController(") &&
          !absolutePath.endsWith("SessionManagementContext.tsx") &&
          !absolutePath.endsWith("useSessionManagement.ts")
        ) {
          offenders.push(path.relative(ROOT, absolutePath));
        }
      }
    }
  }

  sourceRoots.forEach(walk);
  assert.deepEqual(offenders, []);
});
