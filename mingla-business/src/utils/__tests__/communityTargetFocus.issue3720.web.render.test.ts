/**
 * #3720 — Community notification targets must use DOM focus on Host web.
 *
 * This suite runs with react-native mapped to react-native-web. Its
 * findNodeHandle implementation throws the exact production error that sent
 * Seth to the global error fallback, so this is a fails-on-revert proof of the
 * platform split rather than a source-text assertion.
 */

import { focusCommunityTargetNode } from "../communityTargetFocus";

describe("#3720 — Community notification target focus on web", () => {
  it("focuses the target DOM node without calling native findNodeHandle", () => {
    const focus = jest.fn();

    expect(() =>
      focusCommunityTargetNode({ focus } as never),
    ).not.toThrow();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("does nothing while a target ref is not mounted", () => {
    expect(() => focusCommunityTargetNode(null)).not.toThrow();
  });
});
