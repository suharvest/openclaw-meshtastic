import {
  addWildcardAllowFrom,
  DEFAULT_ACCOUNT_ID,
  formatDocsLink,
  promptAccountId,
  promptChannelAccessConfig,
  type ChannelOnboardingAdapter,
  type ChannelOnboardingDmPolicy,
  type DmPolicy,
  type WizardPrompter,
} from "openclaw/plugin-sdk";
import {
  listMeshtasticAccountIds,
  resolveDefaultMeshtasticAccountId,
  resolveMeshtasticAccount,
} from "./accounts.js";
import { normalizeMeshtasticAllowEntry } from "./normalize.js";
import type {
  CoreConfig,
  MeshtasticAccountConfig,
  MeshtasticRegion,
  MeshtasticTransport,
} from "./types.js";

const channel = "meshtastic" as const;

function parseListInput(raw: string): string[] {
  return raw
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function updateMeshtasticAccountConfig(
  cfg: CoreConfig,
  accountId: string,
  patch: Partial<MeshtasticAccountConfig>,
): CoreConfig {
  const current = cfg.channels?.meshtastic ?? {};
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        meshtastic: {
          ...current,
          ...patch,
        },
      },
    };
  }
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      meshtastic: {
        ...current,
        accounts: {
          ...current.accounts,
          [accountId]: {
            ...current.accounts?.[accountId],
            ...patch,
          },
        },
      },
    },
  };
}

function setMeshtasticDmPolicy(cfg: CoreConfig, dmPolicy: DmPolicy): CoreConfig {
  const allowFrom =
    dmPolicy === "open" ? addWildcardAllowFrom(cfg.channels?.meshtastic?.allowFrom) : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      meshtastic: {
        ...cfg.channels?.meshtastic,
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

function setMeshtasticAllowFrom(cfg: CoreConfig, allowFrom: string[]): CoreConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      meshtastic: {
        ...cfg.channels?.meshtastic,
        allowFrom,
      },
    },
  };
}

function setMeshtasticGroupAccess(
  cfg: CoreConfig,
  accountId: string,
  policy: "open" | "allowlist" | "disabled",
  entries: string[],
): CoreConfig {
  if (policy !== "allowlist") {
    return updateMeshtasticAccountConfig(cfg, accountId, {
      enabled: true,
      groupPolicy: policy,
    });
  }
  const normalizedEntries = [...new Set(entries.map((e) => e.trim()).filter(Boolean))];
  const channels = Object.fromEntries(normalizedEntries.map((entry) => [entry, {}]));
  return updateMeshtasticAccountConfig(cfg, accountId, {
    enabled: true,
    groupPolicy: "allowlist",
    channels,
  });
}

async function noteMeshtasticSetupHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "Meshtastic connects to LoRa mesh devices.",
      "Transport options: serial (USB), http (WiFi), mqtt (broker).",
      "Serial needs a device port (e.g. /dev/ttyUSB0).",
      "HTTP needs a device IP/hostname (e.g. meshtastic.local).",
      "MQTT needs a broker address (default: mqtt.meshtastic.org).",
      "Env vars: MESHTASTIC_TRANSPORT, MESHTASTIC_SERIAL_PORT, MESHTASTIC_HTTP_ADDRESS, MESHTASTIC_MQTT_BROKER.",
    ].join("\n"),
    "Meshtastic setup",
  );
}

async function promptMeshtasticAllowFrom(params: {
  cfg: CoreConfig;
  prompter: WizardPrompter;
  accountId?: string;
}): Promise<CoreConfig> {
  const existing = params.cfg.channels?.meshtastic?.allowFrom ?? [];

  await params.prompter.note(
    [
      "Allowlist Meshtastic DMs by node ID.",
      "Format: !aabbccdd (hex node ID)",
      "Multiple entries: comma-separated.",
    ].join("\n"),
    "Meshtastic allowlist",
  );

  const raw = await params.prompter.text({
    message: "Meshtastic allowFrom (node IDs)",
    placeholder: "!aabbccdd, !11223344",
    initialValue: existing[0] ? String(existing[0]) : undefined,
    validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
  });

  const parsed = parseListInput(String(raw));
  const normalized = [
    ...new Set(parsed.map((entry) => normalizeMeshtasticAllowEntry(entry)).filter(Boolean)),
  ];
  return setMeshtasticAllowFrom(params.cfg, normalized);
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "Meshtastic",
  channel,
  policyKey: "channels.meshtastic.dmPolicy",
  allowFromKey: "channels.meshtastic.allowFrom",
  getCurrent: (cfg) => (cfg as CoreConfig).channels?.meshtastic?.dmPolicy ?? "pairing",
  setPolicy: (cfg, policy) => setMeshtasticDmPolicy(cfg as CoreConfig, policy),
  promptAllowFrom: promptMeshtasticAllowFrom,
};

export const meshtasticOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const coreCfg = cfg as CoreConfig;
    const configured = listMeshtasticAccountIds(coreCfg).some(
      (accountId) => resolveMeshtasticAccount({ cfg: coreCfg, accountId }).configured,
    );
    return {
      channel,
      configured,
      statusLines: [`Meshtastic: ${configured ? "configured" : "needs transport config"}`],
      selectionHint: configured ? "configured" : "needs transport config",
      quickstartScore: configured ? 1 : 0,
    };
  },
  configure: async ({
    cfg,
    prompter,
    accountOverrides,
    shouldPromptAccountIds,
    forceAllowFrom,
  }) => {
    let next = cfg as CoreConfig;
    const meshOverride = accountOverrides.meshtastic?.trim();
    const defaultAccountId = resolveDefaultMeshtasticAccountId(next);
    let accountId = meshOverride || defaultAccountId;
    if (shouldPromptAccountIds && !meshOverride) {
      accountId = await promptAccountId({
        cfg: next,
        prompter,
        label: "Meshtastic",
        currentId: accountId,
        listAccountIds: listMeshtasticAccountIds,
        defaultAccountId,
      });
    }

    const resolved = resolveMeshtasticAccount({ cfg: next, accountId });

    if (!resolved.configured) {
      await noteMeshtasticSetupHelp(prompter);
    }

    // Transport selection.
    const transportChoice = await prompter.select({
      message: "Meshtastic transport",
      options: [
        { value: "serial", label: "Serial (USB device)" },
        { value: "http", label: "HTTP (WiFi device)" },
        { value: "mqtt", label: "MQTT (broker, no local hardware)" },
      ],
      initialValue: resolved.transport || "serial",
    });
    const transport = String(transportChoice) as MeshtasticTransport;

    if (transport === "serial") {
      const serialPort = String(
        await prompter.text({
          message: "Serial port path",
          placeholder: "/dev/ttyUSB0 or /dev/tty.usbmodem*",
          initialValue: resolved.serialPort || undefined,
          validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
        }),
      ).trim();

      next = updateMeshtasticAccountConfig(next, accountId, {
        enabled: true,
        transport: "serial",
        serialPort,
      });
    } else if (transport === "http") {
      const httpAddress = String(
        await prompter.text({
          message: "Device IP or hostname",
          placeholder: "meshtastic.local or 192.168.1.100",
          initialValue: resolved.httpAddress || undefined,
          validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
        }),
      ).trim();

      const httpTls = await prompter.confirm({
        message: "Use HTTPS?",
        initialValue: resolved.httpTls,
      });

      next = updateMeshtasticAccountConfig(next, accountId, {
        enabled: true,
        transport: "http",
        httpAddress,
        httpTls,
      });
    } else {
      const broker = String(
        await prompter.text({
          message: "MQTT broker hostname",
          initialValue: resolved.config.mqtt?.broker || "mqtt.meshtastic.org",
          validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
        }),
      ).trim();

      const port = Number.parseInt(
        String(
          await prompter.text({
            message: "MQTT broker port",
            initialValue: String(resolved.config.mqtt?.port ?? 1883),
          }),
        ),
        10,
      );

      const username = String(
        await prompter.text({
          message: "MQTT username",
          initialValue: resolved.config.mqtt?.username || "meshdev",
        }),
      ).trim();

      const password = String(
        await prompter.text({
          message: "MQTT password",
          initialValue: resolved.config.mqtt?.password || "large4cats",
        }),
      ).trim();

      const topic = String(
        await prompter.text({
          message: "MQTT subscribe topic",
          initialValue: resolved.config.mqtt?.topic || "msh/US/2/json/#",
          validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
        }),
      ).trim();

      const mqttTls = await prompter.confirm({
        message: "Use TLS for MQTT?",
        initialValue: resolved.config.mqtt?.tls ?? false,
      });

      next = updateMeshtasticAccountConfig(next, accountId, {
        enabled: true,
        transport: "mqtt",
        mqtt: {
          broker,
          port: Number.isFinite(port) ? port : 1883,
          username: username || undefined,
          password: password || undefined,
          topic,
          tls: mqttTls,
        },
      });
    }

    // LoRa region (serial/HTTP only — applied to device on connect).
    if (transport !== "mqtt") {
      const regionChoice = await prompter.select({
        message: "LoRa region",
        options: [
          { value: "UNSET", label: "UNSET (keep device default)" },
          { value: "US", label: "US (902-928 MHz)" },
          { value: "EU_433", label: "EU_433 (433 MHz)" },
          { value: "EU_868", label: "EU_868 (869 MHz)" },
          { value: "CN", label: "CN (470-510 MHz)" },
          { value: "JP", label: "JP (920 MHz)" },
          { value: "ANZ", label: "ANZ (915-928 MHz)" },
          { value: "KR", label: "KR (920-923 MHz)" },
          { value: "TW", label: "TW (920-925 MHz)" },
          { value: "RU", label: "RU (868 MHz)" },
          { value: "IN", label: "IN (865-867 MHz)" },
          { value: "TH", label: "TH (920-925 MHz)" },
          { value: "LORA_24", label: "LORA_24 (2.4 GHz)" },
        ],
        initialValue: resolved.config.region ?? "UNSET",
      });
      const region = String(regionChoice) as MeshtasticRegion;
      if (region !== "UNSET") {
        next = updateMeshtasticAccountConfig(next, accountId, { region });
      }
    }

    // Device display name — also used as a mention pattern so users can
    // @NodeName the bot in group channels.
    const currentNodeName = resolveMeshtasticAccount({ cfg: next, accountId }).config.nodeName;
    const nodeNameInput = String(
      await prompter.text({
        message: "Device display name (also used as @mention trigger)",
        placeholder: "e.g. OpenClaw",
        initialValue: currentNodeName || undefined,
      }),
    ).trim();
    if (nodeNameInput) {
      next = updateMeshtasticAccountConfig(next, accountId, { nodeName: nodeNameInput });
    }

    // Channel access config.
    const afterConfig = resolveMeshtasticAccount({ cfg: next, accountId });
    const accessConfig = await promptChannelAccessConfig({
      prompter,
      label: "Meshtastic channels",
      currentPolicy: afterConfig.config.groupPolicy ?? "disabled",
      currentEntries: Object.keys(afterConfig.config.channels ?? {}),
      placeholder: "LongFast, Emergency, *",
      updatePrompt: Boolean(afterConfig.config.channels),
    });
    if (accessConfig) {
      next = setMeshtasticGroupAccess(next, accountId, accessConfig.policy, accessConfig.entries);

      const wantsMentions = await prompter.confirm({
        message: "Require mention to reply in Meshtastic channels?",
        initialValue: true,
      });
      if (!wantsMentions) {
        const resolvedAfter = resolveMeshtasticAccount({ cfg: next, accountId });
        const channels = resolvedAfter.config.channels ?? {};
        const patched = Object.fromEntries(
          Object.entries(channels).map(([key, value]) => [
            key,
            { ...value, requireMention: false },
          ]),
        );
        next = updateMeshtasticAccountConfig(next, accountId, { channels: patched });
      }
    }

    if (forceAllowFrom) {
      next = await promptMeshtasticAllowFrom({ cfg: next, prompter, accountId });
    }

    await prompter.note(
      [
        "Next: restart gateway and verify status.",
        "Command: openclaw channels status --probe",
      ].join("\n"),
      "Meshtastic next steps",
    );

    return { cfg: next, accountId };
  },
  dmPolicy,
  disable: (cfg) => ({
    ...(cfg as CoreConfig),
    channels: {
      ...(cfg as CoreConfig).channels,
      meshtastic: {
        ...(cfg as CoreConfig).channels?.meshtastic,
        enabled: false,
      },
    },
  }),
};
