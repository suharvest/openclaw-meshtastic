import {
  DmPolicySchema,
  GroupPolicySchema,
  MarkdownConfigSchema,
  ReplyRuntimeConfigSchemaShape,
  ToolPolicySchema,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk";
import { z } from "zod";

const MeshtasticGroupSchema = z
  .object({
    requireMention: z.boolean().optional(),
    tools: ToolPolicySchema,
    toolsBySender: z.record(z.string(), ToolPolicySchema).optional(),
    skills: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    allowFrom: z.array(z.string()).optional(),
    systemPrompt: z.string().optional(),
  })
  .strict();

const MeshtasticMqttSchema = z
  .object({
    broker: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    topic: z.string().optional(),
    publishTopic: z.string().optional(),
    tls: z.boolean().optional(),
  })
  .strict();

const MeshtasticTransportSchema = z.enum(["serial", "http", "mqtt"]).optional().default("serial");

const MeshtasticRegionSchema = z
  .enum([
    "UNSET",
    "US",
    "EU_433",
    "EU_868",
    "CN",
    "JP",
    "ANZ",
    "KR",
    "TW",
    "RU",
    "IN",
    "NZ_865",
    "TH",
    "UA_433",
    "UA_868",
    "MY_433",
    "MY_919",
    "SG_923",
    "LORA_24",
  ])
  .optional();

export const MeshtasticAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    transport: MeshtasticTransportSchema,
    region: MeshtasticRegionSchema,
    nodeName: z.string().optional(),
    serialPort: z.string().optional(),
    httpAddress: z.string().optional(),
    httpTls: z.boolean().optional(),
    mqtt: MeshtasticMqttSchema.optional(),
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z.array(z.string()).optional(),
    defaultTo: z.string().optional(),
    groupPolicy: GroupPolicySchema.optional().default("disabled"),
    groupAllowFrom: z.array(z.string()).optional(),
    channels: z.record(z.string(), MeshtasticGroupSchema.optional()).optional(),
    mentionPatterns: z.array(z.string()).optional(),
    markdown: MarkdownConfigSchema,
    ...ReplyRuntimeConfigSchemaShape,
  })
  .strict();

export const MeshtasticAccountSchema = MeshtasticAccountSchemaBase.superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.meshtastic.dmPolicy="open" requires channels.meshtastic.allowFrom to include "*"',
  });
});

export const MeshtasticConfigSchema = MeshtasticAccountSchemaBase.extend({
  accounts: z.record(z.string(), MeshtasticAccountSchema.optional()).optional(),
}).superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.meshtastic.dmPolicy="open" requires channels.meshtastic.allowFrom to include "*"',
  });
});
