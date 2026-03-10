# AGENTS.md — MeshClaw

## Project Overview

MeshClaw — OpenClaw channel plugin for Meshtastic LoRa mesh networks. Enables
sending/receiving messages over Meshtastic devices via USB serial, HTTP (WiFi), or MQTT broker.

- **Language**: TypeScript (strict mode, no `tsconfig.json` — OpenClaw host loads TS via esbuild)
- **Module system**: ESM (`"type": "module"` in package.json)
- **Runtime**: Node.js 22+, executed by the OpenClaw plugin host (not standalone)
- **Schema validation**: Zod v4 (not v3 — different API: `z.object().strict()`, no `.passthrough()`)
- **Key deps**: `@meshtastic/core`, `@meshtastic/transport-http`, `@meshtastic/transport-node-serial`, `mqtt`, `zod`
- **Repo**: `github.com/Seeed-Solution/MeshClaw` (npm: `@seeed-studio/meshtastic`)

## Build / Lint / Test Commands

There is **no build step, no linter, no test suite**. The plugin is loaded directly
from TypeScript source by the OpenClaw runtime via the `openclaw.plugin.json` manifest.

```bash
npm install                                    # Install dependencies
openclaw plugins install -l ./MeshClaw  # Install plugin locally for dev
openclaw channels status --probe               # Verify plugin is working

# Restart gateway after code changes (foreground process)
kill -9 $(pgrep -f "openclaw-gateway" | head -1); sleep 2; openclaw gateway &

# No build, lint, or test commands exist.
# If adding tests, use vitest (ESM-native) and place tests in src/__tests__/.
```

## CI / Workflows

- **Publish** (`publish.yml`): `npm publish --provenance` on `v*` tags. No build/test gate.
- **Translate README** (`readme-translate.yml`): Translates `README.md` into 5 languages
  (zh-CN, ja, fr, pt, es) via LLM API. Triggered by `workflow_dispatch` or `/translate`
  comment on PRs. Config lives in `.github/translate/` (languages, glossaries, prompts).
  Translation script: `.github/scripts/translate_readme.py` (Python, uses streaming SSE).

## Project Structure

```
index.ts                  # Plugin entry — default export, registers channel with OpenClaw
openclaw.plugin.json      # Plugin manifest (id, channels, configSchema)
src/
  types.ts                # Shared type definitions (config, messages, probes)
  config-schema.ts        # Zod v4 schemas for config validation
  runtime.ts              # Singleton plugin runtime accessor (module-level mutable ref)
  channel.ts              # Main ChannelPlugin implementation (the "glue" file)
  accounts.ts             # Multi-account config resolution and merging
  client.ts               # Serial/HTTP device connection via @meshtastic/core
  mqtt-client.ts          # MQTT broker connection via mqtt.js
  monitor.ts              # Gateway lifecycle — starts/stops device or MQTT monitors
  inbound.ts              # Inbound message processing (access control, routing, dispatch)
  send.ts                 # Outbound message sending (stripMarkdown, resolves transport)
  policy.ts               # Group/DM access policy evaluation (allowlists, mention gates)
  normalize.ts            # Node ID normalization, target parsing, allowlist matching
  onboarding.ts           # Interactive setup wizard integration
.github/
  workflows/              # CI: publish.yml, readme-translate.yml
  scripts/                # translate_readme.py — LLM-based README translation
  translate/              # languages.json, glossary/, prompts/, do-not-translate.md
```

## Code Style

### Formatting

- 2-space indentation, double quotes, semicolons always
- Trailing commas in multi-line arrays, objects, and parameter lists
- Soft line length ~110 characters
- No prettier or eslint config — maintain consistency manually

### Imports

- **Always** use `.js` extension for local imports: `import { foo } from "./bar.js"`
- Separate `import type` from value imports — never mix in one statement
- Type-only imports use the `type` keyword: `import type { Foo } from "./types.js"`
- Inline `type` keyword when mixing value + type in one import: `import { foo, type Bar } from "..."`

**Import order** (blank line between groups):
1. Node built-ins (`node:crypto`, `node:fs/promises`)
2. Third-party packages (`@meshtastic/core`, `mqtt`, `zod`)
3. OpenClaw SDK (`openclaw/plugin-sdk`)
4. Local modules (`./accounts.js`, `./types.js`) — alphabetical within group

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Files | kebab-case | `config-schema.ts`, `mqtt-client.ts` |
| Functions | camelCase, domain-prefixed | `resolveMeshtasticAccount`, `normalizeMeshtasticNodeId` |
| Types | PascalCase, domain-prefixed | `MeshtasticAccountConfig`, `MeshtasticTransport` |
| Zod schemas | PascalCase, suffix `Schema` | `MeshtasticConfigSchema`, `MeshtasticAccountSchemaBase` |
| Constants | SCREAMING_SNAKE_CASE | `CHANNEL_ID`, `MESHTASTIC_CHUNK_LIMIT` |
| Enum-like objects | PascalCase name, `as const` | `DeviceStatus = { Connected: 5 } as const` |
| Booleans | `is`/`has`/`was` prefix | `isGroup`, `hasConfiguredGroups`, `wasMentioned` |

### Types & Type Safety

- Use `type` keyword (not `interface`) for ALL type definitions
- Shared types live in `src/types.ts`; module-local types are defined inline
- Use `satisfies` for type narrowing without widening
- Use `as const` for literal string constants and enum-like objects
- **Never** suppress type errors with `as any`, `@ts-ignore`, or `@ts-expect-error`
  - One exception: `client.ts` (`as any` in `setOwner()` for SDK compat) — avoid adding more

### Function Signatures

- Complex functions take a single `params` object: `function foo(params: { bar: string; baz: number })`
- Return discriminated result objects: `{ allowed: boolean; reason: string }`
- Optional callbacks: `onError?: (error: Error) => void`
- Async functions return `Promise<T>` explicitly in type signatures

### Error Handling

- Throw plain `Error` with descriptive, user-facing messages
- Custom error classes extend `Error` and set `this.name` (see `SetOwnerRebootError` in `client.ts`)
- Best-effort cleanup uses empty catch: `catch { /* Best-effort cleanup */ }`
- Error propagation via callbacks: `options.onError?.(err instanceof Error ? err : new Error(String(err)))`
- **Never** swallow errors silently — always comment why a catch block is empty

### Exports & Comments

- Named exports for all functions and types
- Single default export only in `index.ts` (the plugin entry point)
- JSDoc `/** */` for public functions and type fields with non-obvious semantics
- Inline `//` comments for implementation details, workarounds, and "why" explanations

## Key Architecture Notes

### Plugin Lifecycle
- **Entry**: `index.ts` exports plugin object → `register()` saves runtime singleton → registers channel
- **Runtime singleton**: `runtime.ts` holds a module-level `PluginRuntime` ref set once at registration
- **Config flow**: YAML config → Zod v4 validation (`config-schema.ts`) → account resolution (`accounts.ts`)

### Message Flow
- **Inbound**: device/MQTT event → `monitor.ts` → `inbound.ts` (policy checks, LoRa system hint) → OpenClaw dispatch
- **Outbound**: `send.ts` converts markdown tables → `stripMarkdown()` → resolves transport → sends via serial/HTTP/MQTT
- **Chunking**: Outbound text chunked to ~200 bytes (`textChunkLimit`) via plain-text chunker (`chunkerMode: "text"`)

### OpenClaw SDK API Patterns (CRITICAL)
SDK pairing functions take **object params**, not positional args:
```ts
// CORRECT
core.channel.pairing.readAllowFromStore({ channel: CHANNEL_ID, accountId })
core.channel.pairing.upsertPairingRequest({ channel: CHANNEL_ID, accountId, id, meta })
// WRONG — will cause silent failures
core.channel.pairing.readAllowFromStore(CHANNEL_ID)
```

### Patterns to Follow

- Config resolution: merge base config with per-account overrides (`mergeMeshtasticAccountConfig`)
- Allowlist matching: normalize entries, then check `Set` membership
- Transport abstraction: `if (transport === "serial") ... else if (transport === "http") ... else (mqtt)`
- Module-level mutable state for active transport handles (see `send.ts`)
- Event subscription via `device.events.onX.subscribe()` from `@meshtastic/core`
- Promise-based blocking: `await new Promise<void>((resolve) => { signal.addEventListener("abort", resolve) })`
- Reconnect resilience: catch + disconnect + rethrow pattern in `client.ts`
- LoRa outbound: always `stripMarkdown()` before sending — radio can't render formatting

### Patterns to Avoid

- Don't add build steps — the OpenClaw runtime loads TS directly
- Don't add new dependencies without strong justification
- Don't create classes unless modeling errors — prefer plain functions and objects
- Don't use `interface` — use `type` for consistency
- Don't use barrel exports (`index.ts` re-exporting everything from `src/`)
- Don't add `console.log` — use the runtime logger (`core.logging.getChildLogger()`)
- Don't assume SDK functions take positional args — always check the `.d.ts` signatures
- Don't send markdown-formatted text to the radio — LoRa devices display raw characters
