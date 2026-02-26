import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { meshtasticPlugin } from "./src/channel.js";
import { setMeshtasticRuntime } from "./src/runtime.js";

const plugin = {
  id: "meshtastic",
  name: "Meshtastic",
  description: "Meshtastic LoRa mesh channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setMeshtasticRuntime(api.runtime);
    api.registerChannel({ plugin: meshtasticPlugin as ChannelPlugin });
  },
};

export default plugin;
