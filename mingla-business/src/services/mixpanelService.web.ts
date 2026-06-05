const noop = (..._args: unknown[]): void => {};

export const mixpanelService = {
  initialize: async (): Promise<void> => {},
  identify: noop,
  reset: noop,
  track: noop,
  setUserProperties: noop,
  setUserPropertyOnce: noop,
  incrementUserProperty: noop,
  registerSuperProperties: noop,
  timeEvent: noop,
  trackLogin: noop,
  trackLogout: noop,
};
