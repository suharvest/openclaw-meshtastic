# openclaw-meshtastic

OpenClaw channel plugin for [Meshtastic](https://meshtastic.org/) LoRa mesh networks.

Lets your OpenClaw gateway send and receive messages over Meshtastic devices — via USB serial, HTTP (WiFi), or MQTT broker.

<p align="center">
  <img src="media/hardware.jpg" width="400" alt="Meshtastic LoRa hardware with Seeed WM1302 module" />
</p>

## Demo

https://github.com/user-attachments/assets/demo.mp4

> The video above shows OpenClaw communicating over a Meshtastic LoRa mesh network. If it doesn't load, see [media/demo.mp4](media/demo.mp4).

## Features

- **Three transport modes**
  - **Serial** — connect a Meshtastic device via USB (e.g. `/dev/ttyUSB0`)
  - **HTTP** — connect over WiFi to a device's HTTP API (e.g. `meshtastic.local`)
  - **MQTT** — connect through an MQTT broker (e.g. `mqtt.meshtastic.org`), no local hardware needed
- **Direct messages and group channels** — supports both DM and mesh channel conversations
- **Access control** — DM policy (open / pairing / allowlist), per-channel allowlists, mention-gating for group channels
- **Multi-account** — run multiple Meshtastic connections with independent configs
- **LoRa region selection** — configure device region on connect (US, EU_868, CN, JP, etc.)
- **Device display name** — set node longName, also used as @mention trigger in channels
- **Interactive onboarding** — guided setup wizard via `openclaw setup`
- **Auto-reconnect** — resilient connection handling with configurable retry

## Requirements

- [OpenClaw](https://github.com/openclaw/openclaw) installed and running
- Node.js 22+
- For serial transport: a Meshtastic device connected via USB
- For HTTP transport: a Meshtastic device on the same network
- For MQTT transport: access to an MQTT broker (public `mqtt.meshtastic.org` works out of the box)

## Install

```bash
openclaw plugins install @seeed-studio/openclaw-meshtastic
```

Or install from a local directory during development:

```bash
git clone https://github.com/suharvest/openclaw-meshtastic.git
openclaw plugins install -l ./openclaw-meshtastic
```

## Configuration

### Interactive setup

```bash
openclaw setup
# Select "Meshtastic" when prompted for channel
```

The wizard walks you through transport selection, connection details, region, access policy, and channel config.

<p align="center">
  <img src="media/setup-screenshot.png" width="600" alt="OpenClaw setup wizard with Meshtastic channel configured" />
</p>

### Manual configuration

Add to your OpenClaw config (`openclaw config edit`):

**Serial (USB device):**

```yaml
channels:
  meshtastic:
    enabled: true
    transport: serial
    serialPort: /dev/ttyUSB0
    nodeName: OpenClaw
    dmPolicy: pairing
```

**HTTP (WiFi device):**

```yaml
channels:
  meshtastic:
    enabled: true
    transport: http
    httpAddress: meshtastic.local
    httpTls: false
    nodeName: OpenClaw
    dmPolicy: pairing
```

**MQTT (broker):**

```yaml
channels:
  meshtastic:
    enabled: true
    transport: mqtt
    mqtt:
      broker: mqtt.meshtastic.org
      port: 1883
      username: meshdev
      password: large4cats
      topic: "msh/US/2/json/#"
      tls: false
    dmPolicy: pairing
```

### Configuration reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `transport` | `serial` \| `http` \| `mqtt` | `serial` | Connection method |
| `serialPort` | string | — | Serial device path |
| `httpAddress` | string | `meshtastic.local` | Device IP or hostname |
| `httpTls` | boolean | `false` | Use HTTPS for HTTP transport |
| `mqtt.broker` | string | `mqtt.meshtastic.org` | MQTT broker hostname |
| `mqtt.port` | number | `1883` | MQTT broker port |
| `mqtt.username` | string | `meshdev` | MQTT username |
| `mqtt.password` | string | `large4cats` | MQTT password |
| `mqtt.topic` | string | `msh/US/2/json/#` | MQTT subscribe topic |
| `mqtt.tls` | boolean | `false` | Use TLS for MQTT |
| `region` | string | `UNSET` | LoRa region (serial/HTTP only) |
| `nodeName` | string | — | Device display name and @mention trigger |
| `dmPolicy` | `open` \| `pairing` \| `allowlist` | `pairing` | DM access policy |
| `allowFrom` | string[] | — | Allowed node IDs (e.g. `["!aabbccdd"]`) |
| `groupPolicy` | `open` \| `allowlist` \| `disabled` | `disabled` | Group channel policy |
| `channels` | object | — | Per-channel config (requireMention, tools, allowFrom) |

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
```

## Verify

```bash
openclaw channels status --probe
```

## Environment variables

These can be used as alternatives to config file settings:

- `MESHTASTIC_TRANSPORT` — `serial`, `http`, or `mqtt`
- `MESHTASTIC_SERIAL_PORT` — serial device path
- `MESHTASTIC_HTTP_ADDRESS` — device IP or hostname
- `MESHTASTIC_MQTT_BROKER` — MQTT broker hostname

## Supported LoRa regions

US, EU_433, EU_868, CN, JP, ANZ, KR, TW, RU, IN, NZ_865, TH, UA_433, UA_868, MY_433, MY_919, SG_923, LORA_24

## License

MIT
