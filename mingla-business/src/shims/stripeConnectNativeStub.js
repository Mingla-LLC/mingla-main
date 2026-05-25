const React = require("react");

const NullStripeComponent = () => null;

const loadConnectAndInitialize = () => ({
  __minglaNativeStub: true,
});

module.exports = {
  ConnectAccountManagement: NullStripeComponent,
  ConnectAccountOnboarding: NullStripeComponent,
  ConnectComponentsProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  ConnectNotificationBanner: NullStripeComponent,
  ConnectTaxRegistrations: NullStripeComponent,
  ConnectTaxSettings: NullStripeComponent,
  loadConnectAndInitialize,
};
