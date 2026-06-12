#!/usr/bin/env node
/**
 * #426 G1 — Discover staging fixture IDs for load tests (read-only).
 *
 * Requires: SUPABASE_URL or LOAD_BASE_URL, SUPABASE_ANON_KEY
 * Prints export lines for LOAD_TEST_EVENT_ID / LOAD_TEST_TICKET_TYPE_ID.
 */

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

function supabaseUrl() {
  if (process.env.SUPABASE_URL) {
    return process.env.SUPABASE_URL.replace(/\/$/, "");
  }
  const base = process.env.LOAD_BASE_URL;
  if (base?.includes("/functions/v1")) {
    return base.replace(/\/functions\/v1\/?$/, "");
  }
  console.error("Set SUPABASE_URL or LOAD_BASE_URL");
  process.exit(1);
}

async function main() {
  const url = supabaseUrl();
  const anonKey = requireEnv("SUPABASE_ANON_KEY");

  const eventsRes = await fetch(
    `${url}/rest/v1/events?select=id,title,status&status=in.(live,scheduled)&order=created_at.desc&limit=5`,
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    },
  );
  const events = await eventsRes.json();
  if (!eventsRes.ok || !Array.isArray(events) || events.length === 0) {
    console.error("No live/scheduled events found:", events);
    process.exit(1);
  }

  const event = events[0];
  const typesRes = await fetch(
    `${url}/rest/v1/ticket_types?select=id,name&event_id=eq.${event.id}&limit=5`,
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    },
  );
  const types = await typesRes.json();
  if (!typesRes.ok || !Array.isArray(types) || types.length === 0) {
    console.error("No ticket types for event", event.id, types);
    process.exit(1);
  }

  console.log(`# Event: ${event.title ?? event.id} (${event.status})`);
  console.log(`export LOAD_TEST_EVENT_ID='${event.id}'`);
  console.log(`export LOAD_TEST_TICKET_TYPE_ID='${types[0].id}'`);
}

main();
