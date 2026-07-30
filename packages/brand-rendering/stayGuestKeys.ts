export const stayGuestKeys = {
  all: ["stayGuest"] as const,
  detail: (venueId: string) => [...stayGuestKeys.all, "detail", venueId] as const,
  search: (
    venueId: string,
    checkIn: string,
    checkOut: string,
    adults: number,
    children: number,
  ) =>
    [
      ...stayGuestKeys.all,
      "search",
      venueId,
      checkIn,
      checkOut,
      adults,
      children,
    ] as const,
  group: (groupId: string) => [...stayGuestKeys.all, "group", groupId] as const,
  mine: (userId: string) => [...stayGuestKeys.all, "mine", userId] as const,
};
