import { normalizeMeshtasticAllowlist, resolveMeshtasticAllowlistMatch } from "./normalize.js";
import type { MeshtasticAccountConfig, MeshtasticChannelConfig } from "./types.js";
import type { MeshtasticInboundMessage } from "./types.js";

export type MeshtasticGroupMatch = {
  allowed: boolean;
  groupConfig?: MeshtasticChannelConfig;
  wildcardConfig?: MeshtasticChannelConfig;
  hasConfiguredGroups: boolean;
};

export type MeshtasticGroupAccessGate = {
  allowed: boolean;
  reason: string;
};

export function resolveMeshtasticGroupMatch(params: {
  groups?: Record<string, MeshtasticChannelConfig>;
  target: string;
}): MeshtasticGroupMatch {
  const groups = params.groups ?? {};
  const hasConfiguredGroups = Object.keys(groups).length > 0;

  const direct = groups[params.target];
  if (direct) {
    return {
      allowed: true,
      groupConfig: direct,
      wildcardConfig: groups["*"],
      hasConfiguredGroups,
    };
  }

  // Case-insensitive match for channel names.
  const targetLower = params.target.toLowerCase();
  const directKey = Object.keys(groups).find((key) => key.toLowerCase() === targetLower);
  if (directKey) {
    const matched = groups[directKey];
    if (matched) {
      return {
        allowed: true,
        groupConfig: matched,
        wildcardConfig: groups["*"],
        hasConfiguredGroups,
      };
    }
  }

  const wildcard = groups["*"];
  if (wildcard) {
    return {
      allowed: true,
      wildcardConfig: wildcard,
      hasConfiguredGroups,
    };
  }
  return {
    allowed: false,
    hasConfiguredGroups,
  };
}

export function resolveMeshtasticGroupAccessGate(params: {
  groupPolicy: MeshtasticAccountConfig["groupPolicy"];
  groupMatch: MeshtasticGroupMatch;
}): MeshtasticGroupAccessGate {
  const policy = params.groupPolicy ?? "disabled";
  if (policy === "disabled") {
    return { allowed: false, reason: "groupPolicy=disabled" };
  }

  if (policy === "allowlist") {
    if (!params.groupMatch.hasConfiguredGroups) {
      return {
        allowed: false,
        reason: "groupPolicy=allowlist and no channels configured",
      };
    }
    if (!params.groupMatch.allowed) {
      return { allowed: false, reason: "not allowlisted" };
    }
  }

  if (
    params.groupMatch.groupConfig?.enabled === false ||
    params.groupMatch.wildcardConfig?.enabled === false
  ) {
    return { allowed: false, reason: "disabled" };
  }

  return { allowed: true, reason: policy === "open" ? "open" : "allowlisted" };
}

export function resolveMeshtasticRequireMention(params: {
  groupConfig?: MeshtasticChannelConfig;
  wildcardConfig?: MeshtasticChannelConfig;
}): boolean {
  if (params.groupConfig?.requireMention !== undefined) {
    return params.groupConfig.requireMention;
  }
  if (params.wildcardConfig?.requireMention !== undefined) {
    return params.wildcardConfig.requireMention;
  }
  return true;
}

export function resolveMeshtasticMentionGate(params: {
  isGroup: boolean;
  requireMention: boolean;
  wasMentioned: boolean;
  hasControlCommand: boolean;
  allowTextCommands: boolean;
  commandAuthorized: boolean;
}): { shouldSkip: boolean; reason: string } {
  if (!params.isGroup) {
    return { shouldSkip: false, reason: "direct" };
  }
  if (!params.requireMention) {
    return { shouldSkip: false, reason: "mention-not-required" };
  }
  if (params.wasMentioned) {
    return { shouldSkip: false, reason: "mentioned" };
  }
  if (params.hasControlCommand && params.allowTextCommands && params.commandAuthorized) {
    return { shouldSkip: false, reason: "authorized-command" };
  }
  return { shouldSkip: true, reason: "missing-mention" };
}

export function resolveMeshtasticGroupSenderAllowed(params: {
  groupPolicy: MeshtasticAccountConfig["groupPolicy"];
  message: MeshtasticInboundMessage;
  outerAllowFrom: string[];
  innerAllowFrom: string[];
}): boolean {
  const policy = params.groupPolicy ?? "disabled";
  const inner = normalizeMeshtasticAllowlist(params.innerAllowFrom);
  const outer = normalizeMeshtasticAllowlist(params.outerAllowFrom);

  if (inner.length > 0) {
    return resolveMeshtasticAllowlistMatch({
      allowFrom: inner,
      message: params.message,
    }).allowed;
  }
  if (outer.length > 0) {
    return resolveMeshtasticAllowlistMatch({
      allowFrom: outer,
      message: params.message,
    }).allowed;
  }
  return policy === "open";
}
