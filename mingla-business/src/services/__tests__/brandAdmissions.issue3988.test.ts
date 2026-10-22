import { attendeeCountForOrderStats } from '../brandsService';

describe('#3988 brand attendee aggregation', () => {
  it('sums active admissions and excludes refunded passes', () => {
    expect(attendeeCountForOrderStats({
      order_line_items: [{ quantity: 3 }],
      tickets: [
        { status: 'valid', admits_count: 2 },
        { status: 'used', admits_count: 5 },
        { status: 'refunded', admits_count: 4 },
      ],
    })).toBe(7);
  });

  it('falls back to pass quantity for orders without admission snapshots', () => {
    expect(attendeeCountForOrderStats({
      order_line_items: [{ quantity: 2 }, { quantity: 1 }],
      tickets: [],
    })).toBe(3);
  });
});
