import type { BaseProbeResult } from "openclaw/plugin-sdk";
import type {
  BlockStreamingCoalesceConfig,
  DmConfig,
  DmPolicy,
  GroupPolicy,
  GroupToolPolicyBySenderConfig,
  GroupToolPolicyConfig,
  MarkdownConfig,
  OpenClawConfig,
} from "openclaw/plugin-sdk";

export type MeshtasticChannelConfig = {
  requireMention?: boolean;
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig;
  skills?: string[];
  enabled?: boolean;
  allowFrom?: string[];
  systemPrompt?: string;
};

export type MeshtasticMqttConfig = {
  broker?: string;
  port?: number;
  username?: string;
  password?: string;
  topic?: string;
  publishTopic?: string;
  tls?: boolean;
};

export type MeshtasticTransport = "serial" | "http" | "mqtt";

/** LoRa region codes matching meshtastic.Config.LoRaConfig.RegionCode. */
export type MeshtasticRegion =
  | "UNSET"
  | "US"
  | "EU_433"
  | "EU_868"
  | "CN"
  | "JP"
  | "ANZ"
  | "KR"
  | "TW"
  | "RU"
  | "IN"
  | "NZ_865"
  | "TH"
  | "UA_433"
  | "UA_868"
  | "MY_433"
  | "MY_919"
  | "SG_923"
  | "LORA_24";

export type MeshtasticAccountConfig = {
  name?: string;
  enabled?: boolean;
  transport?: MeshtasticTransport;
  /** LoRa region — applied to device on connect (serial/HTTP only). */
  region?: MeshtasticRegion;
  /** Device display name — sets the node's longName and auto-adds as mention pattern. */
  nodeName?: string;
  serialPort?: string;
  httpAddress?: string;
  httpTls?: boolean;
  mqtt?: MeshtasticMqttConfig;
  dmPolicy?: DmPolicy;
  allowFrom?: string[];
  defaultTo?: string;
  groupPolicy?: GroupPolicy;
  groupAllowFrom?: string[];
  channels?: Record<string, MeshtasticChannelConfig>;
  mentionPatterns?: string[];
  markdown?: MarkdownConfig;
  dms?: Record<string, DmConfig>;
  textChunkLimit?: number;
  blockStreaming?: boolean;
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;
  responsePrefix?: string;
};

export type MeshtasticConfig = MeshtasticAccountConfig & {
  accounts?: Record<string, MeshtasticAccountConfig>;
};

export type CoreConfig = OpenClawConfig & {
  channels?: OpenClawConfig["channels"] & {
    meshtastic?: MeshtasticConfig;
  };
};

export type MeshtasticInboundMessage = {
  messageId: string;
  senderNodeId: string;
  senderName?: string;
  channelIndex: number;
  channelName?: string;
  text: string;
  timestamp: number;
  isGroup: boolean;
};

export type MeshtasticProbe = BaseProbeResult<string> & {
  transport: MeshtasticTransport;
  address?: string;
};
