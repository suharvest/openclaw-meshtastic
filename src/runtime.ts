import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setMeshtasticRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getMeshtasticRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Meshtastic runtime not initialized");
  }
  return runtime;
}
