// #2829 W7b — stand-in for `payload`: hands the seed the in-memory recorder.
export async function getPayload() {
  const recorder = globalThis.__payloadSeedRecorder;
  if (!recorder) throw new Error("PAYLOAD_SEED_RECORDER_MISSING");
  return recorder;
}
export function buildConfig(config) {
  return config;
}
