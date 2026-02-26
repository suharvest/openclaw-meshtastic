import { randomUUID } from "node:crypto";
import { createLoggerBackedRuntime, type RuntimeEnv } from "openclaw/plugin-sdk";
import { resolveMeshtasticAccount } from "./accounts.js";
import { connectMeshtasticClient, type MeshtasticClient } from "./client.js";
import { handleMeshtasticInbound } from "./inbound.js";
import { connectMeshtasticMqtt, type MeshtasticMqttClient } from "./mqtt-client.js";
import { nodeNumToHex } from "./normalize.js";
import { getMeshtasticRuntime } from "./runtime.js";
import { setActiveSerialSend, setActiveMqttSend } from "./send.js";
import type { CoreConfig, MeshtasticInboundMessage } from "./types.js";

export type MeshtasticMonitorOptions = {
  accountId?: string;
  config?: CoreConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

export async function monitorMeshtasticProvider(
  opts: MeshtasticMonitorOptions,
): Promise<{ stop: () => void }> {
  const core = getMeshtasticRuntime();
  const cfg = opts.config ?? (core.config.loadConfig() as CoreConfig);
  const account = resolveMeshtasticAccount({
    cfg,
    accountId: opts.accountId,
  });

  const runtime: RuntimeEnv =
    opts.runtime ??
    createLoggerBackedRuntime({
      logger: core.logging.getChildLogger(),
      exitError: () => new Error("Runtime exit not available"),
    });

  if (!account.configured) {
    throw new Error(
      `Meshtastic is not configured for account "${account.accountId}". ` +
        `Set channels.meshtastic.transport and connection details.`,
    );
  }

  const logger = core.logging.getChildLogger({
    channel: "meshtastic",
    accountId: account.accountId,
  });

  const transport = account.transport;

  // Auto-inject nodeName into mentionPatterns so "@NodeName" triggers replies.
  // buildMentionRegexes reads from cfg.messages.groupChat.mentionPatterns, so
  // we merge nodeName there (not in channel-specific config).
  const nodeName = account.config.nodeName?.trim();
  const mentionPattern = nodeName ? `@${nodeName}` : undefined;
  const existingPatterns =
    (cfg as Record<string, unknown> & { messages?: { groupChat?: { mentionPatterns?: string[] } } })
      .messages?.groupChat?.mentionPatterns ?? [];
  const effectiveCfg =
    mentionPattern && !existingPatterns.includes(mentionPattern)
      ? {
          ...cfg,
          messages: {
            ...(cfg as Record<string, unknown>).messages as Record<string, unknown> | undefined,
            groupChat: {
              ...((cfg as Record<string, unknown>).messages as Record<string, unknown> | undefined)
                ?.groupChat as Record<string, unknown> | undefined,
              mentionPatterns: [...existingPatterns, mentionPattern],
            },
          },
        }
      : cfg;

  if (transport === "mqtt") {
    return monitorMqtt({ account, cfg: effectiveCfg, runtime, logger, opts });
  }
  return monitorDevice({ account, cfg: effectiveCfg, runtime, logger, opts, transport });
}

async function monitorDevice(params: {
  account: ReturnType<typeof resolveMeshtasticAccount>;
  cfg: CoreConfig;
  runtime: RuntimeEnv;
  logger: ReturnType<ReturnType<typeof getMeshtasticRuntime>["logging"]["getChildLogger"]>;
  opts: MeshtasticMonitorOptions;
  transport: "serial" | "http";
}): Promise<{ stop: () => void }> {
  const { account, cfg, runtime, logger, opts, transport } = params;
  const core = getMeshtasticRuntime();

  let client: MeshtasticClient | null = null;

  client = await connectMeshtasticClient({
    transport,
    serialPort: account.serialPort,
    httpAddress: account.httpAddress,
    httpTls: account.httpTls,
    region: account.config.region,
    nodeName: account.config.nodeName,
    abortSignal: opts.abortSignal,
    onStatus: (status) => {
      logger.info(`[${account.accountId}] device ${status}`);
    },
    onError: (error) => {
      logger.error(`[${account.accountId}] error: ${error.message}`);
    },
    onText: async (event) => {
      if (!client) {
        return;
      }

      const channelName =
        client.getChannelName(event.channelIndex) ?? `channel-${event.channelIndex}`;

      const message: MeshtasticInboundMessage = {
        messageId: randomUUID(),
        senderNodeId: event.senderNodeId,
        senderName: event.senderName ?? client.getNodeName(event.senderNodeNum),
        channelIndex: event.channelIndex,
        channelName,
        text: event.text,
        timestamp: event.rxTime,
        isGroup: !event.isDirect,
      };

      core.channel.activity.record({
        channel: "meshtastic",
        accountId: account.accountId,
        direction: "inbound",
        at: message.timestamp,
      });

      await handleMeshtasticInbound({
        message,
        account,
        config: cfg,
        runtime,
        sendReply: async (target, text) => {
          if (!client) {
            return;
          }
          // For DM replies, resolve node number from hex ID.
          // For group replies, broadcast to the same channel.
          if (message.isGroup) {
            // Broadcast: fire-and-forget.  The SDK's sendText promise waits
            // for internal queue confirmation which may time out for broadcasts.
            // The radio sends the packet regardless, so we don't await.
            client.sendText(text, undefined, false, message.channelIndex).catch(() => {});
          } else {
            // DM: fire-and-forget.  The SDK's sendText awaits ACK from the
            // target node; if ACK times out the promise rejects, but the radio
            // has already transmitted the packet.  Awaiting would block
            // subsequent reply chunks.
            const { hexToNodeNum } = await import("./normalize.js");
            const destNum = hexToNodeNum(target);
            client.sendText(text, destNum, true).catch(() => {});
          }
          opts.statusSink?.({ lastOutboundAt: Date.now() });
          core.channel.activity.record({
            channel: "meshtastic",
            accountId: account.accountId,
            direction: "outbound",
          });
        },
        statusSink: opts.statusSink,
      });
    },
  });

  // Register active send function for `openclaw message send`.
  setActiveSerialSend((text, destination, channelIndex) =>
    client ? client.sendText(text, destination, true, channelIndex) : Promise.resolve(0),
  );

  const address =
    transport === "serial"
      ? account.serialPort
      : `${account.httpAddress}${account.httpTls ? " (tls)" : ""}`;
  logger.info(
    `[${account.accountId}] connected via ${transport} (${address}), node ${nodeNumToHex(client.myNodeNum)}`,
  );

  // Block until the gateway aborts or the device disconnects.
  // Returning from startAccount signals "channel exited" to the framework,
  // which triggers auto-restart.  We must stay alive so the serial port
  // remains open and isn't double-locked on reconnect.
  await new Promise<void>((resolve) => {
    if (opts.abortSignal) {
      opts.abortSignal.addEventListener("abort", () => resolve(), { once: true });
    }
    client!.device.events.onDeviceStatus.subscribe((status: number) => {
      if (status === 2 /* DeviceDisconnected */) {
        logger.info(`[${account.accountId}] device disconnected, exiting monitor`);
        resolve();
      }
    });
  });

  // Cleanup: release the serial port so the next start can open it.
  setActiveSerialSend(null);
  client?.close();
  client = null;

  // Give the OS time to release the serial port lock before the framework
  // restarts the channel (which would immediately try to reopen it).
  await new Promise<void>((r) => setTimeout(r, 3_000));

  return { stop: () => {} };
}

async function monitorMqtt(params: {
  account: ReturnType<typeof resolveMeshtasticAccount>;
  cfg: CoreConfig;
  runtime: RuntimeEnv;
  logger: ReturnType<ReturnType<typeof getMeshtasticRuntime>["logging"]["getChildLogger"]>;
  opts: MeshtasticMonitorOptions;
}): Promise<{ stop: () => void }> {
  const { account, cfg, runtime, logger, opts } = params;
  const core = getMeshtasticRuntime();
  const mqttConfig = account.config.mqtt;

  if (!mqttConfig?.broker) {
    throw new Error("MQTT broker not configured");
  }

  let mqttClient: MeshtasticMqttClient | null = null;

  mqttClient = await connectMeshtasticMqtt({
    mqtt: mqttConfig,
    abortSignal: opts.abortSignal,
    onStatus: (status) => {
      logger.info(`[${account.accountId}] mqtt: ${status}`);
    },
    onError: (error) => {
      logger.error(`[${account.accountId}] mqtt error: ${error.message}`);
    },
    onText: async (event) => {
      const message: MeshtasticInboundMessage = {
        messageId: randomUUID(),
        senderNodeId: event.senderNodeId,
        senderName: event.senderName,
        channelIndex: event.channelIndex,
        channelName: event.channelName ?? `channel-${event.channelIndex}`,
        text: event.text,
        timestamp: event.rxTime,
        isGroup: !event.isDirect,
      };

      core.channel.activity.record({
        channel: "meshtastic",
        accountId: account.accountId,
        direction: "inbound",
        at: message.timestamp,
      });

      await handleMeshtasticInbound({
        message,
        account,
        config: cfg,
        runtime,
        sendReply: async (target, text) => {
          if (!mqttClient) {
            return;
          }
          const channelName = message.isGroup ? message.channelName : undefined;
          await mqttClient.sendText(text, message.isGroup ? undefined : target, channelName);
          opts.statusSink?.({ lastOutboundAt: Date.now() });
          core.channel.activity.record({
            channel: "meshtastic",
            accountId: account.accountId,
            direction: "outbound",
          });
        },
        statusSink: opts.statusSink,
      });
    },
  });

  // Register active send function for `openclaw message send`.
  setActiveMqttSend((text, destination, channelName) =>
    mqttClient ? mqttClient.sendText(text, destination, channelName) : Promise.resolve(),
  );

  logger.info(
    `[${account.accountId}] connected via mqtt (${mqttConfig.broker}:${mqttConfig.port ?? 1883})`,
  );

  // Block until the gateway aborts.  Same pattern as monitorDevice.
  await new Promise<void>((resolve) => {
    if (opts.abortSignal) {
      opts.abortSignal.addEventListener("abort", () => resolve(), { once: true });
    }
  });

  setActiveMqttSend(null);
  mqttClient?.close();
  mqttClient = null;

  return { stop: () => {} };
}
