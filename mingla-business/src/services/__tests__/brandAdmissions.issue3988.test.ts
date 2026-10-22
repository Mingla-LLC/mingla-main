import { activeAdmissionCount } from '../../utils/compOrders';

describe('#3988 brand attendee aggregation', () => {
  it('sums active admissions and excludes refunded passes', () => {
    expect(activeAdmissionCount(
      [
        { status: 'valid', admitsCount: 2 },
        { status: 'used', admitsCount: 5 },
        { status: 'refunded', admitsCount: 4 },
      ],
      3,
    )).toBe(7);
  });

  it('falls back to pass quantity for orders without admission snapshots', () => {
    expect(activeAdmissionCount([], 3)).toBe(3);
  });
});
