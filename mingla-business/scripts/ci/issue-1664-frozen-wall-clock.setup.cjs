const originalDateNow = Date.now;

// #1664 [event-cover-timing-flake] — freezing the external clock turns the
// historical real-timer arrangement into deterministic third-poll mock
// exhaustion. The repaired test owns its fake clock and advances it to 2 ms.
Date.now = () => 0;

afterAll(() => {
  Date.now = originalDateNow;
});
