import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import type { CoreConfig, MeshtasticAccountConfig, MeshtasticTransport } from "./types.js";

export type ResolvedMeshtasticAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  configured: boolean;
  transport: MeshtasticTransport;
  serialPort: string;
  httpAddress: string;
  httpTls: boolean;
  config: MeshtasticAccountConfig;
};

function listConfiguredAccountIds(cfg: CoreConfig): string[] {
  const accounts = cfg.channels?.meshtastic?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [];
  }
  const ids = new Set<string>();
  for (const key of Object.keys(accounts)) {
    if (key.trim()) {
      ids.add(normalizeAccountId(key));
    }
  }
  return [...ids];
}

function resolveAccountConfig(
  cfg: CoreConfig,
  accountId: string,
): MeshtasticAccountConfig | undefined {
  const accounts = cfg.channels?.meshtastic?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  const direct = accounts[accountId] as MeshtasticAccountConfig | undefined;
  if (direct) {
    return direct;
  }
  const normalized = normalizeAccountId(accountId);
  const matchKey = Object.keys(accounts).find((key) => normalizeAccountId(key) === normalized);
  return matchKey ? (accounts[matchKey] as MeshtasticAccountConfig | undefined) : undefined;
}

function mergeMeshtasticAccountConfig(cfg: CoreConfig, accountId: string): MeshtasticAccountConfig {
  const { accounts: _ignored, ...base } = (cfg.channels?.meshtastic ??
    {}) as MeshtasticAccountConfig & {
    accounts?: unknown;
  };
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  const merged: MeshtasticAccountConfig = { ...base, ...account };
  if (base.mqtt || account.mqtt) {
    merged.mqtt = {
      ...base.mqtt,
      ...account.mqtt,
    };
  }
  return merged;
}

export function listMeshtasticAccountIds(cfg: CoreConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultMeshtasticAccountId(cfg: CoreConfig): string {
  const ids = listMeshtasticAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

export function resolveMeshtasticAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedMeshtasticAccount {
  const hasExplicitAccountId = Boolean(params.accountId?.trim());
  const baseEnabled = params.cfg.channels?.meshtastic?.enabled !== false;

  const resolve = (accountId: string) => {
    const merged = mergeMeshtasticAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const enabled = baseEnabled && accountEnabled;

    const envTransport =
      accountId === DEFAULT_ACCOUNT_ID
        ? (process.env.MESHTASTIC_TRANSPORT?.trim() as MeshtasticTransport | undefined)
        : undefined;
    const transport: MeshtasticTransport = merged.transport ?? envTransport ?? "serial";

    const envSerialPort =
      accountId === DEFAULT_ACCOUNT_ID ? process.env.MESHTASTIC_SERIAL_PORT?.trim() : undefined;
    const serialPort = merged.serialPort?.trim() || envSerialPort || "";

    const envHttpAddress =
      accountId === DEFAULT_ACCOUNT_ID ? process.env.MESHTASTIC_HTTP_ADDRESS?.trim() : undefined;
    const httpAddress = merged.httpAddress?.trim() || envHttpAddress || "";

    const httpTls = merged.httpTls ?? false;

    // Apply env vars to MQTT config
    if (accountId === DEFAULT_ACCOUNT_ID && merged.mqtt) {
      const envBroker = process.env.MESHTASTIC_MQTT_BROKER?.trim();
      const envTopic = process.env.MESHTASTIC_MQTT_TOPIC?.trim();
      if (envBroker && !merged.mqtt.broker) {
        merged.mqtt.broker = envBroker;
      }
      if (envTopic && !merged.mqtt.topic) {
        merged.mqtt.topic = envTopic;
      }
    }

    // For MQTT transport, also check env vars even without mqtt config block
    if (transport === "mqtt" && !merged.mqtt && accountId === DEFAULT_ACCOUNT_ID) {
      const envBroker = process.env.MESHTASTIC_MQTT_BROKER?.trim();
      const envTopic = process.env.MESHTASTIC_MQTT_TOPIC?.trim();
      if (envBroker || envTopic) {
        merged.mqtt = {
          broker: envBroker,
          topic: envTopic,
        };
      }
    }

    const configured = resolveIsConfigured(transport, serialPort, httpAddress, merged);

    const config: MeshtasticAccountConfig = {
      ...merged,
      transport,
      serialPort: serialPort || undefined,
      httpAddress: httpAddress || undefined,
      httpTls,
    };

    return {
      accountId,
      enabled,
      name: merged.name?.trim() || undefined,
      configured,
      transport,
      serialPort,
      httpAddress,
      httpTls,
      config,
    } satisfies ResolvedMeshtasticAccount;
  };

  const normalized = normalizeAccountId(params.accountId);
  const primary = resolve(normalized);
  if (hasExplicitAccountId) {
    return primary;
  }
  if (primary.configured) {
    return primary;
  }

  const fallbackId = resolveDefaultMeshtasticAccountId(params.cfg);
  if (fallbackId === primary.accountId) {
    return primary;
  }
  const fallback = resolve(fallbackId);
  if (!fallback.configured) {
    return primary;
  }
  return fallback;
}

function resolveIsConfigured(
  transport: MeshtasticTransport,
  serialPort: string,
  httpAddress: string,
  config: MeshtasticAccountConfig,
): boolean {
  switch (transport) {
    case "serial":
      return Boolean(serialPort);
    case "http":
      return Boolean(httpAddress);
    case "mqtt":
      return Boolean(config.mqtt?.broker);
    default:
      return false;
  }
}

export function listEnabledMeshtasticAccounts(cfg: CoreConfig): ResolvedMeshtasticAccount[] {
  return listMeshtasticAccountIds(cfg)
    .map((accountId) => resolveMeshtasticAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
