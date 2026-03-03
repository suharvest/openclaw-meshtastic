# OpenClaw Meshtastic Plugin

[![npm version](https://img.shields.io/npm/v/@seeed-studio/meshtastic.svg)](https://www.npmjs.com/package/@seeed-studio/meshtastic)
[![license](https://img.shields.io/npm/l/@seeed-studio/meshtastic.svg)](https://www.npmjs.com/package/@seeed-studio/meshtastic)

[OpenClaw](https://github.com/openclaw/openclaw) channel plugin for [Meshtastic](https://meshtastic.org/) LoRa mesh networks. Connect your AI gateway to the mesh over USB serial, HTTP, or MQTT — no cloud required.

<p align="center">
  <img src="media/hardware.jpg" width="420" alt="Meshtastic LoRa hardware" />
</p>

## Table of Contents

- [Quick Start](#quick-start)
- [Demo](#demo)
- [Recommended Hardware](#recommended-hardware)
- [Features](#features)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Contributing](#contributing)

## Quick Start

Requires [OpenClaw](https://github.com/openclaw/openclaw) and Node.js 22+. You also need a Meshtastic device (USB or WiFi) or access to an MQTT broker.

```bash
# 1. Install plugin
openclaw plugins install @seeed-studio/meshtastic

# 2. Guided setup — walks you through transport, region, and access policy
openclaw setup

# 3. Verify
openclaw channels status --probe
```

<p align="center">
  <img src="media/setup-screenshot.png" width="700" alt="OpenClaw setup wizard" />
</p>

## Demo

https://github.com/user-attachments/assets/a3e46e9d-cf5a-4743-9830-f671a1998ca0

Fallback: [media/demo.mp4](media/demo.mp4)

## Recommended Hardware

<p align="center">
  <img src="media/XIAOclaw.png" width="760" alt="Meshtastic device with Seeed XIAO module" />
</p>

| Device | Best for | Link |
|---|---|---|
| XIAO ESP32S3 + Wio-SX1262 kit | Budget off-grid node | [Buy](https://www.seeedstudio.com/Wio-SX1262-with-XIAO-ESP32S3-p-5982.html) |
| Wio Tracker L1 Pro | Ready-to-deploy gateway | [Buy](https://www.seeedstudio.com/Wio-Tracker-L1-Pro-p-6454.html) |
| SenseCAP Card Tracker T1000-E | Compact field tracker | [Buy](https://www.seeedstudio.com/SenseCAP-Card-Tracker-T1000-E-for-Meshtastic-p-5913.html) |

Any Meshtastic-compatible device works. Serial and HTTP transports connect directly; MQTT requires no local hardware at all.

## Features

- **Direct messages and mesh channels** with per-channel rules
- **Access control** — DM policy (`open` / `pairing` / `allowlist`), group policy (`open` / `allowlist` / `disabled`), mention-gating, per-channel allowlists
- **Multi-account** — run independent serial, HTTP, and MQTT connections side by side
- **Region-aware** — sets device region on connect and derives MQTT topic defaults
- **Auto-reconnect** with resilient retry handling

## Configuration

The guided setup (`openclaw setup`) covers everything below. For manual config, edit with `openclaw config edit`.

### Serial (USB)

```yaml
channels:
  meshtastic:
    transport: serial
    serialPort: /dev/ttyUSB0
    nodeName: OpenClaw
```

### HTTP (WiFi)

```yaml
channels:
  meshtastic:
    transport: http
    httpAddress: meshtastic.local
    nodeName: OpenClaw
```

### MQTT (broker)

```yaml
channels:
  meshtastic:
    transport: mqtt
    nodeName: OpenClaw
    mqtt:
      broker: mqtt.meshtastic.org
      username: meshdev
      password: large4cats
      topic: "msh/US/2/json/#"
```

### Multi-account

```yaml
channels:
  meshtastic:
    accounts:
      home:
        transport: serial
        serialPort: /dev/ttyUSB0
      remote:
        transport: mqtt
        mqtt:
          broker: mqtt.meshtastic.org
          topic: "msh/US/2/json/#"
```

### All Options

| Key | Type | Default | Notes |
|---|---|---|---|
| `transport` | `serial \| http \| mqtt` | `serial` | |
| `serialPort` | `string` | — | Required for serial |
| `httpAddress` | `string` | `meshtastic.local` | Required for HTTP |
| `httpTls` | `boolean` | `false` | |
| `mqtt.broker` | `string` | `mqtt.meshtastic.org` | |
| `mqtt.port` | `number` | `1883` | |
| `mqtt.username` | `string` | `meshdev` | |
| `mqtt.password` | `string` | `large4cats` | |
| `mqtt.topic` | `string` | `msh/US/2/json/#` | Subscribe topic |
| `mqtt.publishTopic` | `string` | derived | |
| `mqtt.tls` | `boolean` | `false` | |
| `region` | enum | `UNSET` | `US`, `EU_868`, `CN`, `JP`, `ANZ`, `KR`, `TW`, `RU`, `IN`, `NZ_865`, `TH`, `EU_433`, `UA_433`, `UA_868`, `MY_433`, `MY_919`, `SG_923`, `LORA_24`. Serial/HTTP only. |
| `nodeName` | `string` | auto-detect | Also used as @mention trigger. Required for MQTT. |
| `dmPolicy` | `open \| pairing \| allowlist` | `pairing` | |
| `allowFrom` | `string[]` | — | Node IDs, e.g. `["!aabbccdd"]` |
| `groupPolicy` | `open \| allowlist \| disabled` | `disabled` | |
| `channels` | `Record<string, object>` | — | Per-channel overrides (`requireMention`, `allowFrom`, `tools`) |

### Environment Variable Overrides

These override the default account's config (YAML takes precedence for named accounts):

| Variable | Equivalent config key |
|---|---|
| `MESHTASTIC_TRANSPORT` | `transport` |
| `MESHTASTIC_SERIAL_PORT` | `serialPort` |
| `MESHTASTIC_HTTP_ADDRESS` | `httpAddress` |
| `MESHTASTIC_MQTT_BROKER` | `mqtt.broker` |
| `MESHTASTIC_MQTT_TOPIC` | `mqtt.topic` |

## Troubleshooting

| Symptom | Check |
|---|---|
| Serial won't connect | Device path correct? Host has permission? |
| HTTP won't connect | `httpAddress` reachable? `httpTls` matches device? |
| MQTT receives nothing | Region in `mqtt.topic` correct? Broker credentials valid? |
| No DM responses | `dmPolicy` and `allowFrom` configured? |
| No group replies | `groupPolicy` enabled? Channel in allowlist? Mention required? |

Found a bug? [Open an issue](https://github.com/Seeed-Solution/openclaw-meshtastic/issues) with transport type, config (redact secrets), and `openclaw channels status --probe` output.

## Development

```bash
git clone https://github.com/Seeed-Solution/openclaw-meshtastic.git
cd openclaw-meshtastic
npm install
openclaw plugins install -l ./openclaw-meshtastic
```

No build step — OpenClaw loads TypeScript source directly. Use `openclaw channels status --probe` to verify.

## Contributing

- [Open an issue](https://github.com/Seeed-Solution/openclaw-meshtastic/issues) for bugs or feature requests
- Pull requests welcome — keep code aligned with existing TypeScript conventions

## License

MIT
