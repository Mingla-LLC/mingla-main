#!/usr/bin/env node
/**
 * ORCH-1282 — I-PROPOSED-1282-MMS-NG-DROPS-MEDIA (DRAFT until CLOSE).
 *
 * Rule: MMS media rides ONLY the Twilio `MediaUrl` param. The NG/Termii send
 * path never carries media (SMS-only).
 *
 *   (1) smsAdapter.ts: twilioSend appends `MediaUrl`; send() passes
 *       input.mediaUrls INTO twilioSend; the NG termiiSend(...) call receives
 *       NO media argument.
 *   (2) marketing-send/index.ts (sendSms): reads channel_payload.media_urls and
 *       threads `mediaUrls` into the smsAdapter.send() call.
 *
 * Mirrors the modular self-testing gate pattern.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ADAPTER = "supabase/functions/_shared/adapters/smsAdapter.ts";
const SEND = "supabase/functions/marketing-send/index.ts";

const stripLineComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const evaluateAdapter = (rawCode) => {
  const code = stripLineComments(rawCode);
  const failures = [];
  if (!/params\.append\(\s*["']MediaUrl["']/.test(code)) {
    failures.push(`${ADAPTER}: twilioSend must append the Twilio \`MediaUrl\` param for media. I-PROPOSED-1282-MMS-NG-DROPS-MEDIA.`);
  }
  if (!/twilioSend\([^)]*input\.mediaUrls/.test(code)) {
    failures.push(`${ADAPTER}: the US path (twilioSend) must receive input.mediaUrls. I-PROPOSED-1282-MMS-NG-DROPS-MEDIA.`);
  }
  // The NG branch must NOT pass media into termiiSend (SMS-only).
  if (/termiiSend\([^)]*mediaUrls/.test(code)) {
    failures.push(`${ADAPTER}: termiiSend must NOT receive media — NG is SMS-only. I-PROPOSED-1282-MMS-NG-DROPS-MEDIA.`);
  }
  return failures;
};

const evaluateSend = (rawCode) => {
  const code = stripLineComments(rawCode);
  const failures = [];
  if (!/channel_payload\.media_urls/.test(code)) {
    failures.push(`${SEND}: sendSms must read campaign.channel_payload.media_urls. I-PROPOSED-1282-MMS-NG-DROPS-MEDIA.`);
  }
  if (!/mediaUrls,/.test(code)) {
    failures.push(`${SEND}: sendSms must thread mediaUrls into smsAdapter.send(). I-PROPOSED-1282-MMS-NG-DROPS-MEDIA.`);
  }
  return failures;
};

const SELF_TEST = process.argv.includes("--self-test");
if (SELF_TEST) {
  const AD_GOOD = `
    if (mediaUrls) { for (const u of mediaUrls) { if (u) params.append("MediaUrl", u); } }
    const result = cc === "NG"
      ? await termiiSend(to, body, ch)
      : await twilioSend(to, body, input.messagingServiceSid, input.mediaUrls);
  `;
  // BAD_A: MediaUrl append removed.
  const AD_BAD_A = `
    const result = cc === "NG"
      ? await termiiSend(to, body, ch)
      : await twilioSend(to, body, input.messagingServiceSid, input.mediaUrls);
  `;
  // BAD_B: NG gets media.
  const AD_BAD_B = `
    if (mediaUrls) { params.append("MediaUrl", mediaUrls[0]); }
    const result = cc === "NG"
      ? await termiiSend(to, body, ch, input.mediaUrls)
      : await twilioSend(to, body, input.messagingServiceSid, input.mediaUrls);
  `;
  const SEND_GOOD = `
    const mediaUrls = Array.isArray(campaign.channel_payload.media_urls) ? campaign.channel_payload.media_urls : [];
    const result = await smsAdapter.send({ to, brandName, message, mediaUrls, });
  `;
  const SEND_BAD = `
    const result = await smsAdapter.send({ to, brandName, message, });
  `;
  const ag = evaluateAdapter(AD_GOOD), aa = evaluateAdapter(AD_BAD_A), ab = evaluateAdapter(AD_BAD_B);
  const sg = evaluateSend(SEND_GOOD), sb = evaluateSend(SEND_BAD);
  const ok = ag.length === 0 && aa.length >= 1 && ab.length >= 1 && sg.length === 0 && sb.length >= 1;
  if (!ok) {
    console.error("ORCH-1282 ng-drops-media SELF-TEST failed:", { ag, aa, ab, sg, sb });
    process.exit(1);
  }
  console.log("ORCH-1282 ng-drops-media gate self-test passed.");
  process.exit(0);
}

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();
const failures = [];
const adAbs = join(root, ADAPTER);
const sendAbs = join(root, SEND);
if (!existsSync(adAbs)) failures.push(`${ADAPTER}: not found.`);
else failures.push(...evaluateAdapter(readFileSync(adAbs, "utf8")));
if (!existsSync(sendAbs)) failures.push(`${SEND}: not found.`);
else failures.push(...evaluateSend(readFileSync(sendAbs, "utf8")));

if (failures.length > 0) {
  console.error("ORCH-1282 ng-drops-media gate FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("ORCH-1282 ng-drops-media gate passed.");
