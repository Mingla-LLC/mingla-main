import type { OrderRecord } from '../../store/orderStore';
import { getEventOrderRevenue } from '../eventOrdersService';

const baseOrder = {
  id: 'order-1', eventId: 'event-1', brandId: 'brand-1',
  buyer: { name: 'Guest', email: 'guest@example.com', phone: '', marketingOptIn: false },
  lines: [{ ticketTypeId: 'couple', ticketNameAtPurchase: 'Couple', unitPriceGbpAtPurchase: 50, isFreeAtPurchase: false, quantity: 1, refundedQuantity: 0, refundedAmountGbp: 0 }],
  totalGbpAtPurchase: 50, currency: 'GBP', paymentMethod: 'card', paidAt: '2026-10-22T10:00:00Z',
  status: 'paid', refundedAmountGbp: 0, refunds: [], cancelledAt: null, lastSeenEventUpdatedAt: '',
} as OrderRecord;

describe('#3988 attendee semantics', () => {
  it('counts people admitted rather than passes sold in revenue headlines', () => {
    const couple = { ...baseOrder, ticketDays: [{ ticketId: 'ticket-1', ticketTypeId: 'couple', admitsCount: 2, eventDateIds: [], status: 'valid', usedAt: null }] };
    const group = { ...baseOrder, id: 'order-2', ticketDays: [{ ticketId: 'ticket-2', ticketTypeId: 'group', admitsCount: 5, eventDateIds: [], status: 'used', usedAt: '2026-10-22T12:00:00Z' }] };
    expect(getEventOrderRevenue([couple, group], 'GBP').soldCount).toBe(7);
  });

  it('keeps line-quantity fallback for legacy cached orders', () => {
    expect(getEventOrderRevenue([{ ...baseOrder, ticketDays: [] }], 'GBP').soldCount).toBe(1);
  });
});
