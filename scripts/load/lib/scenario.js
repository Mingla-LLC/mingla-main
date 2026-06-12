/**
 * k6 scenario helper — ramp VUs for Phase 2+ (avoids instant connection storms).
 *
 * LOAD_VUS >= 100: ramping-vus (LOAD_RAMP_DURATION default 2m, then LOAD_DURATION sustain).
 * Otherwise: constant-vus.
 */

export function vuScenario(name) {
  const vus = Number(__ENV.LOAD_VUS || 5);
  const duration = __ENV.LOAD_DURATION || "30s";
  const ramp = __ENV.LOAD_RAMP_DURATION || "2m";

  if (vus >= 100) {
    return {
      scenarios: {
        [name]: {
          executor: "ramping-vus",
          startVUs: 0,
          stages: [
            { duration: ramp, target: vus },
            { duration, target: vus },
          ],
          gracefulRampDown: "30s",
        },
      },
    };
  }

  return {
    scenarios: {
      [name]: {
        executor: "constant-vus",
        vus,
        duration,
      },
    },
  };
}
