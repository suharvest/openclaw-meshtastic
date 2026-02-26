import { randomUUID } from "node:crypto";
import { resolveMeshtasticAccount } from "./accounts.js";
import { hexToNodeNum, normalizeMeshtasticMessagingTarget } from "./normalize.js";
import { getMeshtasticRuntime } from "./runtime.js";
import type { CoreConfig } from "./types.js";

type SendMeshtasticOptions = {
  accountId?: string;
  channelIndex?: number;
  channelName?: string;
};

export type SendMeshtasticResult = {
  messageId: string;
  target: string;
};

// Active transport handles set by monitor.ts for reuse.
let activeSerialSend:
  | ((text: string, destination?: number, channelIndex?: number) => Promise<number>)
  | null = null;
let activeMqttSend:
  | ((text: string, destination?: string, channelName?: string) => Promise<void>)
  | null = null;

export function setActiveSerialSend(
  fn: ((text: string, destination?: number, channelIndex?: number) => Promise<number>) | null,
) {
  activeSerialSend = fn;
}

export function setActiveMqttSend(
  fn: ((text: string, destination?: string, channelName?: string) => Promise<void>) | null,
) {
  activeMqttSend = fn;
}

export async function sendMessageMeshtastic(
  to: string,
  text: string,
  opts: SendMeshtasticOptions = {},
): Promise<SendMeshtasticResult> {
  const runtime = getMeshtasticRuntime();
  const cfg = runtime.config.loadConfig() as CoreConfig;
  const account = resolveMeshtasticAccount({
    cfg,
    accountId: opts.accountId,
  });

  if (!account.configured) {
    throw new Error(
      `Meshtastic is not configured for account "${account.accountId}". ` +
        `Set channels.meshtastic.transport and connection details.`,
    );
  }

  const target = normalizeMeshtasticMessagingTarget(to);
  if (!target) {
    throw new Error(`Invalid Meshtastic target: ${to}`);
  }

  const tableMode = runtime.channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "meshtastic",
    accountId: account.accountId,
  });
  const prepared = runtime.channel.text.convertMarkdownTables(text.trim(), tableMode);
  if (!prepared.trim()) {
    throw new Error("Message must be non-empty for Meshtastic sends");
  }

  const transport = account.transport;

  if (transport === "mqtt") {
    if (activeMqttSend) {
      await activeMqttSend(prepared, target, opts.channelName);
    } else {
      throw new Error("No active MQTT connection. Start the gateway first.");
    }
  } else {
    // Serial or HTTP: use active transport if available.
    if (activeSerialSend) {
      const destination = target.startsWith("!") ? hexToNodeNum(target) : undefined;
      await activeSerialSend(prepared, destination, opts.channelIndex);
    } else {
      throw new Error(`No active ${transport} connection. Start the gateway first.`);
    }
  }

  runtime.channel.activity.record({
    channel: "meshtastic",
    accountId: account.accountId,
    direction: "outbound",
  });

  return {
    messageId: randomUUID(),
    target,
  };
}
