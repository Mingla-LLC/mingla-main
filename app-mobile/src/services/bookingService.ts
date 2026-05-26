/**
 * Booking Service - Surfaces booking CTAs (website / phone) on expanded place cards.
 *
 * Historical note: this service originally proxied OpenTable, Eventbrite, and Viator
 * but those integrations never had API keys provisioned and were removed 2026-05-25.
 * If a future ORCH revives provider integrations, route through a Supabase edge
 * function so keys stay server-side.
 */

export interface BookingOption {
  provider: 'website' | 'phone';
  available: boolean;
  url?: string;
  phone?: string;
  message: string;
}

export interface BookingData {
  hasBooking: boolean;
  options: BookingOption[];
  primaryOption?: BookingOption;
}

class BookingService {
  async getBookingOptions(
    _venueName: string,
    _category: string,
    _lat: number,
    _lng: number,
    website?: string,
    phone?: string
  ): Promise<BookingData> {
    const options: BookingOption[] = [];

    if (website) {
      options.push({
        provider: 'website',
        available: true,
        url: website,
        message: 'Visit website to book',
      });
    }

    if (phone) {
      options.push({
        provider: 'phone',
        available: true,
        phone: phone,
        message: 'Call to make a reservation',
      });
    }

    return {
      hasBooking: options.length > 0,
      options,
      primaryOption: options[0],
    };
  }
}

export const bookingService = new BookingService();
