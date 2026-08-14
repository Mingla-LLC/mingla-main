/**
 * #1719 implementor happy path — Business Share is synchronous single-flight.
 *
 * The test invokes the real ShareModal handler twice in the same React turn,
 * before busy state can rerender. Exactly one platform-share adapter call may
 * start. Copy is intentionally outside this test and retains its own behavior.
 *
 * FAILS-ON-REVERT: deleting ShareModalContent's shareFlightRef guard makes the
 * adapter call count become two; restoring it returns this test to green.
 */
import React from 'react';
import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const prepareBusinessContentShare = jest.fn(async () => ({
  shortCode: 'Aa0Bb1Cc2Dd3Ee4F',
  version: 1,
  url: 'https://usemingla.com/s/Aa0Bb1Cc2Dd3Ee4F',
  title: 'Yonder Coffee',
  message: 'How about Yonder Coffee?\n\nhttps://usemingla.com/s/Aa0Bb1Cc2Dd3Ee4F',
  media: null,
  facts: { kind: 'place', status: null },
}));
const sharePublicUrl = jest.fn<() => Promise<void>>();

jest.mock('../../../services/contentShareAdapter', () => ({
  prepareBusinessContentShare,
  trackBusinessShareEvent: () => undefined,
}));
jest.mock('../../../utils/sharePublicUrl', () => ({
  sharePublicUrl,
  copyPublicUrl: jest.fn(async () => undefined),
}));
jest.mock('@mingla/sharing', () => ({
  checkContentShareReadiness: jest.fn(async () => 'ready'),
  selectCompactPreviewFacts: () => [],
  shareKindLabel: () => 'Place',
  statusLabel: () => '',
}));
jest.mock('../useShareNetworkState', () => ({
  useShareNetworkState: () => true,
}), { virtual: true });
jest.mock('../Sheet', () => ({
  Sheet: ({ children }: { children: React.ReactNode }): React.ReactElement =>
    React.createElement('Sheet', null, children),
}));

type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (predicate: (node: HostNode) => boolean) => HostNode[] };
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer') as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

beforeAll(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { share: () => undefined },
  });
});

afterAll(() => {
  if (originalNavigatorDescriptor) Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
  else delete (globalThis as { navigator?: unknown }).navigator;
});

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
};

test('two Share presses in one turn start one platform-share call', async () => {
  let releaseShare: (() => void) | undefined;
  sharePublicUrl.mockImplementation(() => new Promise<void>((resolve) => { releaseShare = resolve; }));

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ShareModal } = require('../ShareModalContent') as {
    ShareModal: React.FC<Record<string, unknown>>;
  };
  let tree: Tree | undefined;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(React.createElement(ShareModal, {
      visible: true,
      onClose: () => undefined,
      url: 'https://host.usemingla.com/b/yonder',
      title: 'Yonder Coffee',
      contentKind: 'place',
    }));
    await flush();
  });

  const shareButtons = tree!.root.findAll((node) =>
    node.type === 'Pressable' && node.props.accessibilityLabel === 'Share elsewhere');
  expect(shareButtons).toHaveLength(1);
  expect(shareButtons[0].props.disabled).toBe(false);

  await TestRenderer.act(async () => {
    const press = shareButtons[0].props.onPress as () => void;
    press();
    press();
    await flush();
    expect(sharePublicUrl).toHaveBeenCalledTimes(1);
    releaseShare?.();
    await flush();
  });

  await TestRenderer.act(() => { tree!.unmount(); });
});
