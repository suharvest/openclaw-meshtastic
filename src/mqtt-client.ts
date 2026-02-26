import mqtt from "mqtt";
import { nodeNumToHex } from "./normalize.js";
import type { MeshtasticMqttConfig } from "./types.js";

export type MeshtasticMqttTextEvent = {
  senderNodeId: string;
  senderName?: string;
  text: string;
  channelIndex: number;
  channelName?: string;
  isDirect: boolean;
  rxTime: number;
};

export type MeshtasticMqttClientOptions = {
  mqtt: MeshtasticMqttConfig;
  myNodeId?: string;
  abortSignal?: AbortSignal;
  onText?: (event: MeshtasticMqttTextEvent) => void | Promise<void>;
  onStatus?: (status: string) => void;
  onError?: (error: Error) => void;
};

export type MeshtasticMqttClient = {
  sendText: (text: string, destination?: string, channelName?: string) => Promise<void>;
  close: () => void;
};

/**
 * Meshtastic MQTT JSON message format.
 * Messages on the JSON topic contain: sender, from, type, payload, channel.
 */
type MqttJsonMessage = {
  sender?: string;
  from?: number;
  to?: number;
  type?: string;
  payload?: { text?: string };
  channel?: number;
  channel_name?: string;
};

/** Connect to a Meshtastic mesh via MQTT broker. */
export async function connectMeshtasticMqtt(
  options: MeshtasticMqttClientOptions,
): Promise<MeshtasticMqttClient> {
  const mqttConfig = options.mqtt;
  const broker = mqttConfig.broker ?? "mqtt.meshtastic.org";
  const port = mqttConfig.port ?? 1883;
  const username = mqttConfig.username ?? "meshdev";
  const password = mqttConfig.password ?? "large4cats";
  const topic = mqttConfig.topic ?? "msh/US/2/json/#";
  const publishTopic = mqttConfig.publishTopic ?? topic.replace("/#", "/mqtt");
  const protocol = mqttConfig.tls ? "mqtts" : "mqtt";
  const myNodeId = options.myNodeId?.toLowerCase();

  const client = mqtt.connect(`${protocol}://${broker}:${port}`, {
    username,
    password,
    clean: true,
    reconnectPeriod: 5000,
  });

  client.on("connect", () => {
    options.onStatus?.("connected");
    client.subscribe(topic, (err) => {
      if (err) {
        options.onError?.(new Error(`MQTT subscribe failed: ${err.message}`));
      } else {
        options.onStatus?.(`subscribed to ${topic}`);
      }
    });
  });

  client.on("error", (err) => {
    options.onError?.(err);
  });

  client.on("reconnect", () => {
    options.onStatus?.("reconnecting");
  });

  client.on("message", async (_topic, payload) => {
    if (!options.onText) {
      return;
    }

    let msg: MqttJsonMessage;
    try {
      msg = JSON.parse(payload.toString()) as MqttJsonMessage;
    } catch {
      return;
    }

    // Only handle text messages.
    if (msg.type !== "sendtext" || !msg.payload?.text) {
      return;
    }

    // Skip own messages.
    const senderNodeId = msg.sender
      ? msg.sender.toLowerCase()
      : msg.from
        ? nodeNumToHex(msg.from)
        : undefined;
    if (!senderNodeId) {
      return;
    }
    if (myNodeId && senderNodeId === myNodeId) {
      return;
    }

    // Determine DM vs broadcast.
    // MQTT JSON doesn't clearly distinguish DM; if `to` is a specific node and matches our ID, it's direct.
    const isDirect = myNodeId
      ? msg.to !== undefined && nodeNumToHex(msg.to).toLowerCase() === myNodeId
      : false;

    const event: MeshtasticMqttTextEvent = {
      senderNodeId: senderNodeId.startsWith("!") ? senderNodeId : `!${senderNodeId}`,
      text: msg.payload.text,
      channelIndex: msg.channel ?? 0,
      channelName: msg.channel_name,
      isDirect,
      rxTime: Date.now(),
    };

    try {
      await options.onText(event);
    } catch (err) {
      options.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  });

  if (options.abortSignal) {
    options.abortSignal.addEventListener(
      "abort",
      () => {
        client.end(true);
      },
      { once: true },
    );
  }

  return {
    sendText: async (text, destination, channelName) => {
      const outboundTopic = channelName
        ? publishTopic.replace(/\/[^/]*$/, `/${channelName}`)
        : publishTopic;
      const message: MqttJsonMessage = {
        sender: myNodeId ?? options.myNodeId,
        type: "sendtext",
        payload: { text },
        ...(destination ? { to: Number.parseInt(destination.replace("!", ""), 16) } : {}),
      };
      client.publish(outboundTopic, JSON.stringify(message));
    },
    close: () => {
      client.end(true);
    },
  };
}
