/**
 * #4389 Door mode — every new string on the door sale screen (design screen
 * "DM", approved 2026-11-11). The words live in src/i18n/locales/<lang>/
 * (English: doorMode.json, next to this module; other languages:
 * hostSetup.json). Each property reads the current language when read.
 *
 * Apple naming: the device-facing Tap to Pay name always comes from
 * tapToPayName(os) ("Tap to Pay on iPhone" on iOS, in every language). These
 * strings never name a card reader, a terminal or hardware, and never call
 * the app the business app.
 *
 * MINGLA-INVARIANT: I-4389-DOOR-MODE-APPLE-NAMING | issue #4389 | Door mode copy names Tap to Pay only through tapToPayName(os) and never says reader, terminal, hardware or business; pinned by issue_4389_door_mode.implementor.test.ts.
 */
import { tapToPayName } from "../../constants/tapToPayName";
import english from "../../i18n/locales/en/doorMode.json";
import { businessT, registerBusinessEnglish } from "../../i18n";

registerBusinessEnglish(english);

const t = (key: string, variables?: Record<string, string | number>): string =>
  businessT(`doorMode.${key}`, variables);

/** The chip labels, in buildDoorPaymentOptions order. */
export const doorModeChipLabel = (method: "tap_to_pay" | "pay_code" | "cash", os: string): string => {
  switch (method) {
    case "tap_to_pay":
      return tapToPayName(os);
    case "pay_code":
      return t("chipPayCode");
    case "cash":
      return t("chipCash");
    default: {
      const exhaustive: never = method;
      return exhaustive;
    }
  }
};

export const DOOR_MODE_COPY = {
  get closeLabel(): string { return t("closeLabel"); },
  get menuLabel(): string { return t("menuLabel"); },
  soldTonight: (n: number): string => t("soldTonight", { n }),
  get howTheyPay(): string { return t("howTheyPay"); },
  ticketCount: (n: number): string => t("ticketCount", { count: n }),
  tileLabel: (name: string, price: string, qty: number): string =>
    qty > 0 ? t("tileLabelInSale", { name, price, qty }) : t("tileLabel", { name, price }),
  removeOne: (name: string): string => t("removeOne", { name }),
  remembered: (method: string): string => t("remembered", { method }),
  // The button follows the method.
  charge: (total: string | null): string => (total === null ? t("chargeNoTotal") : t("charge", { total })),
  showCode: (total: string | null): string => (total === null ? t("showCodeNoTotal") : t("showCode", { total })),
  cashTaken: (total: string): string => t("cashTaken", { total }),
  manualTaken: (total: string): string => t("manualTaken", { total }),
  get charging(): string { return t("charging"); },
  get finalTotalHint(): string { return t("finalTotalHint"); },
  // Cash confirm.
  cashConfirmTitle: (total: string): string => t("cashConfirmTitle", { total }),
  get cashConfirmBody(): string { return t("cashConfirmBody"); },
  get confirmCash(): string { return t("confirmCash"); },
  get back(): string { return t("back"); },
  // Scan to pay.
  scanToPay: (total: string): string => t("scanToPay", { total }),
  get waitingForPayment(): string { return t("waitingForPayment"); },
  get guestPaying(): string { return t("guestPaying"); },
  get cancelSale(): string { return t("cancelSale"); },
  get codeChecking(): string { return t("codeChecking"); },
  get codeLanding(): string { return t("codeLanding"); },
  get codeAlreadyPaid(): string { return t("codeAlreadyPaid"); },
  get codeCancelFailed(): string { return t("codeCancelFailed"); },
  get codeStillOpen(): string { return t("codeStillOpen"); },
  get codeLoadFailed(): string { return t("codeLoadFailed"); },
  // Paid overlay.
  paid: (total: string): string => t("paid", { total }),
  paidLine: (n: number, how: string): string => t("paidLine", { count: n, how }),
  get paidByPhone(): string { return t("paidByPhone"); },
  get paidByCash(): string { return t("paidByCash"); },
  get paidManual(): string { return t("paidManual"); },
  get nextSaleHint(): string { return t("nextSaleHint"); },
  get sendReceipt(): string { return t("sendReceipt"); },
  cashReceipt: (args: { brand: string | null; event: string | null; total: string; tickets: number; when: string }): string =>
    [
      [args.brand, args.event].filter((part): part is string => part !== null && part.length > 0).join(" · "),
      t("cashReceiptLine", { total: args.total, count: args.tickets }),
      args.when,
    ]
      .filter((line) => line.length > 0)
      .join("\n"),
  // Banners.
  get offline(): string { return t("offline"); },
  get noTiers(): string { return t("noTiers"); },
  get pickTicket(): string { return t("pickTicket"); },
  get saleFailed(): string { return t("saleFailed"); },
  get capacity(): string { return t("capacity"); },
  get wrongDate(): string { return t("wrongDate"); },
  get noSharedDate(): string { return t("noSharedDate"); },
  get checkingDates(): string { return t("checkingDates"); },
  get dateHeading(): string { return t("dateHeading"); },
  // Menu.
  get menuTitle(): string { return t("menuTitle"); },
  get recentSales(): string { return t("recentSales"); },
  get noRecentSales(): string { return t("noRecentSales"); },
  get allSales(): string { return t("allSales"); },
  get addBuyer(): string { return t("addBuyer"); },
  get addBuyerSub(): string { return t("addBuyerSub"); },
  get manual(): string { return t("manual"); },
  get manualSub(): string { return t("manualSub"); },
  get manualPicked(): string { return t("manualPicked"); },
  // Add buyer.
  get buyerTitle(): string { return t("buyerTitle"); },
  get buyerBody(): string { return t("buyerBody"); },
  get buyerName(): string { return t("buyerName"); },
  get buyerPhone(): string { return t("buyerPhone"); },
  get buyerEmail(): string { return t("buyerEmail"); },
  get buyerEmailInvalid(): string { return t("buyerEmailInvalid"); },
  get buyerPhoneInvalid(): string { return t("buyerPhoneInvalid"); },
  get buyerSave(): string { return t("buyerSave"); },
  get buyerClear(): string { return t("buyerClear"); },
  buyerSet: (label: string): string => t("buyerSet", { label }),
  // Which event.
  get whichEvent(): string { return t("whichEvent"); },
  get liveNow(): string { return t("liveNow"); },
  get today(): string { return t("today"); },
  // Not found / loading.
  get loading(): string { return t("loading"); },
  get notFound(): string { return t("notFound"); },
  get notFoundBody(): string { return t("notFoundBody"); },
  // #4389 S-i — Tap to Pay setup with no card-payment address (T1 entry).
  get addressMissing(): string { return t("addressMissing"); },
  get addAddress(): string { return t("addAddress"); },
};
