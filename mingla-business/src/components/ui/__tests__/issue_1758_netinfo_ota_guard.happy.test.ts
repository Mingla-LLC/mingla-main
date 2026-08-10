/**
 * #1758 [netinfo-ota-guard] — implementor happy-path regression suite.
 *
 * BUG CLASS: #1719 shipped a bare static `import { useNetInfo } from
 * '@react-native-community/netinfo'` in `useShareNetworkState.native.ts`.
 * Every shipped business binary predates the dependency (prod 2026-07-14,
 * dev-sim 2026-07-20 — zero RNCNetInfo symbols), and the package throws
 * "NativeModule.RNCNetInfo is null" at MODULE EVAL, so any OTA published from
 * main hard-crashed every install during Expo Router's eager route load
 * (COMMS-0138, tester evidence on #1735).
 *
 * FIX UNDER TEST: `src/lib/netinfoSafe.ts` — a guarded dynamic require that
 * degrades to "assume online" when the native module is absent, and is a
 * referential passthrough to the package's own `useNetInfo` when present.
 *
 * Direction (a) of the #1758 contract: route-eval survives netinfo-null.
 * Direction (b) — no bare static import may return — lives in
 * `mingla-business/__tests__/issue1758NetinfoSoleOwner.test.ts`.
 */

const NETINFO_PKG = '@react-native-community/netinfo';
const RNC_NULL_MESSAGE =
  '@react-native-community/netinfo: NativeModule.RNCNetInfo is null. To fix this issue try these steps: ...';

type ShareHookModule = typeof import('../useShareNetworkState.native');
type NetinfoSafeModule = typeof import('../../../lib/netinfoSafe');

describe('#1758 netinfo OTA guard', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('native module ABSENT (every currently shipped business binary)', () => {
    const mockNetinfoThrowing = (): void => {
      jest.doMock(NETINFO_PKG, () => {
        throw new Error(RNC_NULL_MESSAGE);
      });
    };

    it('route-eval survives: requiring useShareNetworkState.native does NOT throw when the netinfo require throws RNCNetInfo-null', () => {
      mockNetinfoThrowing();
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../useShareNetworkState.native');
      }).not.toThrow();
    });

    it('degrades gracefully: the share hook reports online=true and availability is false', () => {
      mockNetinfoThrowing();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useShareNetworkState } = require('../useShareNetworkState.native') as ShareHookModule;
      // The absent branch calls ZERO React hooks (useNetInfoSafe is a stable
      // `() => null`), so the hook is callable as a plain function here.
      expect(useShareNetworkState()).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { isNetInfoAvailable, useNetInfoSafe } = require('../../../lib/netinfoSafe') as NetinfoSafeModule;
      expect(isNetInfoAvailable()).toBe(false);
      expect(useNetInfoSafe()).toBeNull();
    });

    it('the degrade is NOT silent: one boot-time console.warn names the missing native module', () => {
      mockNetinfoThrowing();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../lib/netinfoSafe');
      const warned = warnSpy.mock.calls.some((call: unknown[]) =>
        typeof call[0] === 'string' && call[0].includes('RNCNetInfo native module unavailable'),
      );
      expect(warned).toBe(true);
    });

    it('LIVE-FIRE: the REAL netinfo package throws at require under a native-module-less react-native, and the guard contains exactly that throw', () => {
      // No jest.doMock here — the real package resolves. This suite maps
      // `react-native` to __manual_mocks__/react-native.js whose NativeModules
      // is `{}` — byte-for-byte the condition inside a binary built before the
      // dependency existed. This proves the #1719 bare import really was
      // route-eval-fatal, not just that our mock says so.
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require(NETINFO_PKG);
      }).toThrow(/RNCNetInfo is null/);
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../useShareNetworkState.native');
      }).not.toThrow();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useShareNetworkState } = require('../useShareNetworkState.native') as ShareHookModule;
      expect(useShareNetworkState()).toBe(true);
    });
  });

  describe('native module PRESENT (future native builds) — zero behavior change', () => {
    const mockNetinfoPresent = (state: { isConnected: boolean | null; isInternetReachable: boolean | null }): void => {
      jest.doMock(NETINFO_PKG, () => ({ useNetInfo: () => state }));
    };

    it.each<[{ isConnected: boolean | null; isInternetReachable: boolean | null }, boolean]>([
      [{ isConnected: true, isInternetReachable: true }, true],
      [{ isConnected: true, isInternetReachable: null }, true],
      [{ isConnected: true, isInternetReachable: false }, false],
      [{ isConnected: false, isInternetReachable: true }, false],
      [{ isConnected: null, isInternetReachable: null }, false],
    ])('maps %o -> %s exactly as the pre-guard #1719 hook did (isConnected === true && isInternetReachable !== false)', (state, expected) => {
      mockNetinfoPresent(state);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useShareNetworkState } = require('../useShareNetworkState.native') as ShareHookModule;
      expect(useShareNetworkState()).toBe(expected);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { isNetInfoAvailable } = require('../../../lib/netinfoSafe') as NetinfoSafeModule;
      expect(isNetInfoAvailable()).toBe(true);
    });

    it('useNetInfoSafe IS the package useNetInfo (referential passthrough — no wrapper can drift behavior)', () => {
      const theHook = (): { isConnected: boolean | null; isInternetReachable: boolean | null } => ({
        isConnected: true,
        isInternetReachable: true,
      });
      jest.doMock(NETINFO_PKG, () => ({ useNetInfo: theHook }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useNetInfoSafe } = require('../../../lib/netinfoSafe') as NetinfoSafeModule;
      expect(useNetInfoSafe).toBe(theHook);
    });
  });
});
