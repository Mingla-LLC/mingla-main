import { currencyCodeOrNull } from "./currency";

export type OrderCurrencyContractErrorCode =
  | "order_currency_missing_for_money"
  | "refund_currency_missing_for_money"
  | "refund_currency_mismatch";

export class OrderCurrencyContractError extends Error {
  constructor(public readonly code: OrderCurrencyContractErrorCode) {
    super(code);
    this.name = "OrderCurrencyContractError";
  }
}

export const orderCurrencyOrNull = (
  currency?: string | null,
): string | null => currencyCodeOrNull(currency);

export const assertOrderCurrencyForMoney = (
  currency: string | null,
  hasMoney: boolean,
): void => {
  if (hasMoney && currency === null) {
    throw new OrderCurrencyContractError(
      "order_currency_missing_for_money",
    );
  }
};

export const assertRefundCurrencyForMoney = (
  orderCurrency: string | null,
  refundCurrency: string | null,
  hasMoney: boolean,
): void => {
  if (!hasMoney) return;
  if (refundCurrency === null) {
    throw new OrderCurrencyContractError(
      "refund_currency_missing_for_money",
    );
  }
  if (orderCurrency !== refundCurrency) {
    throw new OrderCurrencyContractError("refund_currency_mismatch");
  }
};
