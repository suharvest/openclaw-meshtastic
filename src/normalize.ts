import type { MeshtasticInboundMessage } from "./types.js";

/** Convert numeric node ID to !hex format (e.g. 2882400001 -> "!abcd0001"). */
export function nodeNumToHex(nodeNum: number): string {
  return `!${nodeNum.toString(16).padStart(8, "0")}`;
}

/** Convert !hex node ID to numeric (e.g. "!abcd0001" -> 2882400001). */
export function hexToNodeNum(hex: string): number {
  const cleaned = hex.startsWith("!") ? hex.slice(1) : hex;
  const parsed = Number.parseInt(cleaned, 16);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid Meshtastic node ID: ${hex}`);
  }
  return parsed;
}

/** Normalize a node ID to !hex format. Accepts !hex or numeric string. */
export function normalizeMeshtasticNodeId(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("!")) {
    const hex = trimmed.slice(1);
    if (/^[0-9a-f]{1,8}$/i.test(hex)) {
      return `!${hex.padStart(8, "0")}`;
    }
    return trimmed;
  }
  const num = Number.parseInt(trimmed, 10);
  if (Number.isFinite(num) && num >= 0) {
    return nodeNumToHex(num);
  }
  return trimmed;
}

/** Check if a string looks like a Meshtastic node ID (!hex or numeric). */
export function looksLikeMeshtasticNodeId(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith("!") && /^![0-9a-f]{1,8}$/i.test(trimmed)) {
    return true;
  }
  const num = Number.parseInt(trimmed, 10);
  return Number.isFinite(num) && num >= 0 && String(num) === trimmed;
}

/** Normalize a messaging target. Strips "meshtastic:" prefix, resolves channel: prefix. */
export function normalizeMeshtasticMessagingTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  let target = trimmed;
  if (target.toLowerCase().startsWith("meshtastic:")) {
    target = target.slice("meshtastic:".length).trim();
  }
  if (target.toLowerCase().startsWith("channel:")) {
    return target.slice("channel:".length).trim() || undefined;
  }
  if (target.toLowerCase().startsWith("user:")) {
    target = target.slice("user:".length).trim();
  }
  if (!target) {
    return undefined;
  }
  if (looksLikeMeshtasticNodeId(target)) {
    return normalizeMeshtasticNodeId(target);
  }
  return target;
}

/** Normalize an allowlist entry (lowercase, strip meshtastic: prefix). */
export function normalizeMeshtasticAllowEntry(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (!value) {
    return "";
  }
  if (value.startsWith("meshtastic:")) {
    value = value.slice("meshtastic:".length);
  }
  if (value.startsWith("user:")) {
    value = value.slice("user:".length);
  }
  return normalizeMeshtasticNodeId(value.trim());
}

/** Normalize a list of allowlist entries. */
export function normalizeMeshtasticAllowlist(entries?: string[]): string[] {
  return (entries ?? []).map((entry) => normalizeMeshtasticAllowEntry(entry)).filter(Boolean);
}

/** Check if sender matches an allowlist. */
export function resolveMeshtasticAllowlistMatch(params: {
  allowFrom: string[];
  message: MeshtasticInboundMessage;
}): { allowed: boolean; source?: string } {
  const allowFrom = new Set(
    params.allowFrom.map((entry) => entry.trim().toLowerCase()).filter(Boolean),
  );
  if (allowFrom.has("*")) {
    return { allowed: true, source: "wildcard" };
  }
  const nodeId = normalizeMeshtasticNodeId(params.message.senderNodeId).toLowerCase();
  if (nodeId && allowFrom.has(nodeId)) {
    return { allowed: true, source: nodeId };
  }
  return { allowed: false };
}
