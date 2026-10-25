import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { composeSmsBody } from "../../adapters/smsAdapter.ts";
import {
  finalSmsLength,
  renderBuyerSms,
  type SmsTemplateKey,
  toGsm7Text,
} from "../buyerSms.ts";

const ALL_KEYS: SmsTemplateKey[] = [
  "S1",
  "S1G",
  "S2",
  "S3",
  "S4",
  "S4G",
  "S5",
  "S5H",
  "S6",
  "S7",
  "S8",
  "S8H",
  "S9",
  "S9V",
  "S9B",
  "S10V",
  "S11",
  "S11F",
  "S11V",
  "S12",
  "S13",
  "S14",
  "S14N",
  "S15",
  "S16",
  "S17",
  "S18",
  "S18A",
  "S18N",
];

const TYPICAL = {
  title: "Bachata Takeover Dance Social",
  venue: "The Waterside",
  brand: "Bachata Lagos",
  lead: "Amara",
  sender: "Tobi",
  date: "Sat 25 Oct",
  time: "7:30 PM",
  dayWord: "tonight" as const,
  party: 4,
  amount: "NGN 25,000.00",
  expiry: "9:00 PM",
  link: "usemingla.com/c/8KQ2ABCD7Z",
  noun: "ticket" as const,
  claimed: false,
  stateWord: "processed",
  subjectLabel: "Bachata Takeover Dance Social",
};

Deno.test("#4063 pins contract buyer text examples", () => {
  assertEquals(
    renderBuyerSms("S1", TYPICAL),
    "Mingla: You're in: Bachata Takeover Dance Social, Sat 25 Oct 7:30 PM. Get your ticket using this number: usemingla.com/c/8KQ2ABCD7Z",
  );
  assertEquals(
    renderBuyerSms("S8", { ...TYPICAL, noun: "booking", claimed: true }),
    "Mingla: Booked: The Waterside, Sat 25 Oct 7:30 PM, 4 people. Your booking: usemingla.com/c/8KQ2ABCD7Z",
  );
  assertEquals(
    renderBuyerSms("S17", { ...TYPICAL, claimed: true }),
    "Mingla: Thanks for ordering at The Waterside. Your receipt is in the Mingla app. Your receipt: usemingla.com/c/8KQ2ABCD7Z",
  );
});

Deno.test("#4063 every buyer template fits one GSM-7 segment at worst-case bounds", () => {
  for (const key of ALL_KEYS) {
    const body = renderBuyerSms(key, {
      title: "T".repeat(120),
      venue: "V".repeat(60),
      brand: "B".repeat(40),
      lead: "L".repeat(30),
      sender: "S".repeat(30),
      date: "Wed 30 Sep",
      time: "10:30 PM",
      dayWord: "tomorrow",
      party: 12,
      amount: "NGN 9,999,999.00",
      expiry: "Sun 10:30 PM",
      link: "usemingla.com/c/1234567890",
      noun: key === "S4" || key === "S4G" || key === "S13"
        ? "pass"
        : key.startsWith("S8") || key === "S9B" || key === "S10V"
        ? "booking"
        : "ticket",
      stateWord: "under review",
      subjectLabel: "T".repeat(120),
    });
    assert(
      finalSmsLength(body) <= 160,
      `${key} overflowed: ${finalSmsLength(body)} ${composeSmsBody(body)}`,
    );
    assert(body.startsWith("Mingla: "), `${key} lost the Mingla prefix`);
    assertEquals(
      composeSmsBody(body).match(/Reply STOP to opt out\./g)?.length,
      1,
      `${key} footer count`,
    );
  }
});

Deno.test("#4063 normalizes user-controlled slots without losing GSM-7 letters", () => {
  assertEquals(toGsm7Text("Café Ñoño"), "Café Ñoño");
  assertEquals(toGsm7Text("Zoë"), "Zoe");
  assertEquals(toGsm7Text("東京 🎟️"), "");
  assertEquals(toGsm7Text("{[]}"), "{[]}");
  assertEquals(
    finalSmsLength("Mingla: {[]}"),
    composeSmsBody("Mingla: {[]}").length + 4,
  );
  assertEquals(
    renderBuyerSms("S1", { ...TYPICAL, title: "東京 🎟️" }),
    "Mingla: You're in: your event, Sat 25 Oct 7:30 PM. Get your ticket using this number: usemingla.com/c/8KQ2ABCD7Z",
  );
});

Deno.test("#4063 a title containing Reply Stop never suppresses the footer", () => {
  const final = composeSmsBody(
    renderBuyerSms("S1", { ...TYPICAL, title: "Reply Stop live" }),
  );
  assertStringIncludes(final, "Reply Stop live");
  assertEquals(final.match(/Reply STOP to opt out\./g)?.length, 1);
});

Deno.test("#4063 reminder copy handles tomorrow, tonight and DST-null wording", () => {
  assertStringIncludes(
    renderBuyerSms("S6", { ...TYPICAL, dayWord: "tomorrow" }),
    "is tomorrow, 7:30 PM",
  );
  assertStringIncludes(
    renderBuyerSms("S7", { ...TYPICAL, dayWord: "tonight" }),
    "starts 7:30 PM tonight",
  );
  assertStringIncludes(
    renderBuyerSms("S7", { ...TYPICAL, dayWord: null }),
    "starts Sat 25 Oct 7:30 PM",
  );
});
