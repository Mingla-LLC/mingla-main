import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { purchaseReminderDeepLink } from "../index.ts";

const ORDER_ID = "40630000-0000-4000-8000-000000000101";
const RESERVATION_ID = "40630000-0000-4000-8000-000000000401";

Deno.test("#4063 reminder pushes open the owned purchase in door mode", () => {
  assertEquals(
    purchaseReminderDeepLink({
      category_key: "buyer_event_reminder",
      payload: { order_id: ORDER_ID },
    }),
    `com.mingla.app.v2://purchases/order/${ORDER_ID}?door=1`,
  );
  assertEquals(
    purchaseReminderDeepLink({
      category_key: "buyer_reservation_reminder",
      payload: { reservation_id: RESERVATION_ID },
    }),
    `com.mingla.app.v2://purchases/reservation/${RESERVATION_ID}?door=1`,
  );
});

Deno.test("#4063 reminder routing fails closed outside the two purchase categories", () => {
  assertEquals(
    purchaseReminderDeepLink({
      category_key: "buyer_purchase_confirmation",
      payload: { order_id: ORDER_ID },
    }),
    null,
  );
  assertEquals(
    purchaseReminderDeepLink({
      category_key: "buyer_event_reminder",
      payload: { order_id: "../../messages" },
    }),
    null,
  );
  assertEquals(
    purchaseReminderDeepLink({
      category_key: "buyer_reservation_reminder",
      payload: {},
    }),
    null,
  );
});
