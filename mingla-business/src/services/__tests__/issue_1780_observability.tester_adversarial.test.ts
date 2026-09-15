/**
 * #1780 tester-owned adversarial regression: operational observability.
 *
 * Mingla has two established alert patterns: the scheduled API-health state
 * machine, and a durable deduplicated alert outbox drained through the shared
 * sendOpsAlertEmail helper. This guard accepts either pattern, but it requires
 * the #1780 owner to be scheduled/reachable and to calculate every signal the
 * binding SPEC names. A comment or an unscheduled read helper is not an alert.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const MIGRATION_PATH = path.join(
  ROOT,
  "supabase/migrations/20270709001780_issue_1780_wizard_invite_plans.sql",
);
const WORKER_PATH = path.join(
  ROOT,
  "supabase/functions/offering-invite-dispatch/index.ts",
);
const HEALTH_PROBE_PATH = path.join(
  ROOT,
  "supabase/functions/api-health-probe/index.ts",
);

const migration = fs.readFileSync(MIGRATION_PATH, "utf8");
const worker = fs.readFileSync(WORKER_PATH, "utf8");
const healthProbe = fs.readFileSync(HEALTH_PROBE_PATH, "utf8");

function withoutComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .replace(/\/\/.*$/gm, "");
}

const executableMigration = withoutComments(migration);
const executableWorker = withoutComments(worker);
const executableHealthProbe = withoutComments(healthProbe);
const executableIssueSurface = `${executableMigration}\n${executableWorker}`;

const SIGNALS = [
  /(?:expired[_ -]lease|lease[_ -]expired)/i,
  /(?:retry(?:able)?[_ -]backlog[_ -](?:age|aged)|aged[_ -]retry)/i,
  /terminal[_ -]failure[_ -]rate/i,
  /duplicate[_ -]constraint/i,
  /publish[_ -]without[_ -]job/i,
  /provider[_ -]attempt[\s\S]{0,100}dispatch[_ -](?:off|disabled)/i,
] as const;

function sqlFunctionBlocks(value: string): Array<{ name: string; body: string }> {
  const starts = [...value.matchAll(
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([a-z0-9_.]+)\s*\(/gi,
  )];
  return starts.map((match, index) => ({
    name: match[1],
    body: value.slice(
      match.index,
      starts[index + 1]?.index ?? value.length,
    ),
  }));
}

function healthOwner(): { name: string; body: string } | null {
  return sqlFunctionBlocks(executableMigration).find(({ body }) =>
    SIGNALS.every((signal) => signal.test(body))) ?? null;
}

describe("#1780 operational observability", () => {
  test("atomic enqueue emits the required aggregate event after its outbox insert", () => {
    const helper = sqlFunctionBlocks(executableMigration).find(({ name }) =>
      name === "private.enqueue_wizard_invites_on_publish_v1");
    expect(helper).toBeDefined();
    const insertAt = helper!.body.indexOf(
      "INSERT INTO private.brand_offering_invite_publish_outbox",
    );
    const eventAt = helper!.body.indexOf("wizard_invite_outbox_enqueued");

    expect(insertAt).toBeGreaterThanOrEqual(0);
    expect(eventAt).toBeGreaterThan(insertAt);
    const eventPayload = helper!.body.slice(eventAt, eventAt + 900);
    expect(eventPayload).toMatch(/selection[_A-Za-z]*revision/i);
    expect(eventPayload).toMatch(/selected[_A-Za-z]*count/i);
    expect(eventPayload).not.toMatch(
      /person[_A-Za-z]*ids|group[_A-Za-z]*ids|email|phone|destination|raw[_A-Za-z]*payload|search[_A-Za-z]*text|auth[_A-Za-z]*token/i,
    );
  });

  test("one aggregate health owner detects all six required failure classes", () => {
    const owner = healthOwner();
    expect(owner).not.toBeNull();
    const body = owner!.body;

    expect(body).toMatch(/brand_offering_invite_publish_outbox/i);
    expect(body).toMatch(/leased_until[\s\S]{0,120}(?:now\s*\(|current_timestamp)/i);
    expect(body).toMatch(/(?:available_at|created_at)[\s\S]{0,180}interval/i);
    expect(body).toMatch(/state[\s\S]{0,80}terminal/i);
    expect(body).toMatch(/(?:23505|unique_violation|duplicate)/i);
    expect(body).toMatch(/brand_offering_invite_plans/i);
    expect(body).toMatch(/(?:NOT\s+EXISTS|LEFT\s+JOIN)[\s\S]{0,300}brand_offering_invite_publish_outbox/i);
    expect(body).toMatch(/business_wizard_invite_dispatch_v1/i);
    expect(body).toMatch(/brand_offering_invite_delivery_attempts/i);
    expect(body).toMatch(/count\s*\(/i);
  });

  test("the health owner is scheduled and reaches Mingla's canonical alert transport", () => {
    const owner = healthOwner();
    expect(owner).not.toBeNull();
    const unqualified = owner!.name.split(".").at(-1)!;
    const references = executableIssueSurface.match(
      new RegExp(`\\b${unqualified}\\b`, "g"),
    )?.length ?? 0;
    const scheduledWorkerOwnsHealth =
      executableMigration.includes("issue_1780_wizard_invite_dispatch") &&
      executableWorker.includes(unqualified);
    const directlyScheduled = new RegExp(
      `cron\\.schedule\\([\\s\\S]{0,1600}\\b${unqualified}\\b`,
      "i",
    ).test(executableMigration);

    expect(references).toBeGreaterThan(1);
    expect(scheduledWorkerOwnsHealth || directlyScheduled).toBe(true);

    const apiHealthPattern =
      /wizard[_ -]invite/i.test(`${executableMigration}\n${executableHealthProbe}`) &&
      /api_health_services/i.test(executableMigration) &&
      /api_health_alert_state/i.test(executableMigration) &&
      /api_health_(?:checks|observations)/i.test(
        `${executableMigration}\n${executableHealthProbe}`,
      );
    const durableAlertOutboxPattern =
      /wizard[\s\S]{0,80}alert_(?:outbox|state)/i.test(executableMigration) &&
      /(?:ON\s+CONFLICT|UNIQUE\s*\()/i.test(executableMigration) &&
      /sendOpsAlertEmail/i.test(executableWorker);

    expect(apiHealthPattern || durableAlertOutboxPattern).toBe(true);
  });

  test("health output remains aggregate and excludes recipient data", () => {
    const owner = healthOwner();
    expect(owner).not.toBeNull();
    expect(owner!.body).not.toMatch(
      /brand_person_ids|person_ids|group_ids|display_name|recipient_email|recipient_phone|normalized_contact|contact_method_id|recipient_user_id|provider_message_id|raw_payload|search_text|auth_token/i,
    );
  });
});
