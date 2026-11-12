/**
 * #4389 — the delete-brand sheet's words, loaded with the sheet. The rows Ari's
 * delete card and the brand profile also show live in brandDeleteSharedCopy.ts.
 * English: brandSetup.delete.json; other languages: hostSetup.json.
 */
import english from "../../i18n/locales/en/brandSetup.delete.json";
import { BRAND_DELETE_SHARED_COPY } from "./brandDeleteSharedCopy";
import { businessT, registerBusinessEnglish } from "../../i18n";

registerBusinessEnglish(english);

const t = (key: string, variables?: Record<string, string | number>): string =>
  businessT(`brandSetup.${key}`, variables);

export const BRAND_DELETE_COPY = {
  delete: {
    get blockedBalance(): string { return t("delete.blockedBalance"); },
    get blockedEvents(): string { return t("delete.blockedEvents"); },
    get blockedPaying(): string { return t("delete.blockedPaying"); },
    get blockedPartner(): string { return t("delete.blockedPartner"); },
    get blockedPayout(): string { return t("delete.blockedPayout"); },
    get cantDeleteYet(): string { return t("delete.cantDeleteYet"); },
    get nothingDeleted(): string { return t("delete.nothingDeleted"); },
    get closeRefused(): string { return t("delete.closeRefused"); },
    get close(): string { return t("delete.close"); },
    get undoTitle(): string { return t("delete.undoTitle"); },
    get undoBody(): string { return t("delete.undoBody"); },
    get previewErrorTitle(): string { return t("delete.previewErrorTitle"); },
    get previewErrorBody(): string { return t("delete.previewErrorBody"); },
    get closedOnDelete(): string { return BRAND_DELETE_SHARED_COPY.delete.closedOnDelete; },
    get none(): string { return BRAND_DELETE_SHARED_COPY.delete.none; },
    get restoreTitle(): string { return BRAND_DELETE_SHARED_COPY.delete.restoreTitle; },
    get restoreBody(): string { return BRAND_DELETE_SHARED_COPY.delete.restoreBody; },
    get bankPayouts(): string { return BRAND_DELETE_SHARED_COPY.delete.bankPayouts; },
    get bankPayoutsSwitchedOff(): string { return BRAND_DELETE_SHARED_COPY.delete.bankPayoutsSwitchedOff; },
  },
};
