import { registerRootComponent } from "expo";
import { assertCaptureRuntime } from "../shared/captureIdentity";
import { installNetworkDeny } from "../shared/networkDeny";
import App from "./App";

const captureRuntime = globalThis as typeof globalThis & { __MINGLA_CAPTURE_HARNESS__?: string; __MINGLA_CAPTURE_BASELINE__?: string };
assertCaptureRuntime({ enabled: captureRuntime.__MINGLA_CAPTURE_HARNESS__ === "1", baseline: captureRuntime.__MINGLA_CAPTURE_BASELINE__ ?? "" });
installNetworkDeny();
registerRootComponent(App);
