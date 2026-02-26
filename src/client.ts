import { MeshDevice } from "@meshtastic/core";
import { nodeNumToHex } from "./normalize.js";
import type { MeshtasticRegion } from "./types.js";

export type MeshtasticTextEvent = {
  senderNodeNum: number;
  senderNodeId: string;
  senderName?: string;
  text: string;
  channelIndex: number;
  isDirect: boolean;
  rxTime: number;
};

export type MeshtasticClientOptions = {
  transport: "serial" | "http";
  serialPort?: string;
  httpAddress?: string;
  httpTls?: boolean;
  /** LoRa region to set on the device after connection. */
  region?: MeshtasticRegion;
  /** Device display name — sets the node's longName on connect. */
  nodeName?: string;
  abortSignal?: AbortSignal;
  onText?: (event: MeshtasticTextEvent) => void | Promise<void>;
  onStatus?: (status: string) => void;
  onError?: (error: Error) => void;
};

export type MeshtasticClient = {
  device: MeshDevice;
  myNodeNum: number;
  sendText: (
    text: string,
    destination?: number,
    wantAck?: boolean,
    channelIndex?: number,
  ) => Promise<number>;
  getNodeName: (nodeNum: number) => string | undefined;
  getChannelName: (index: number) => string | undefined;
  close: () => void;
};

/**
 * Patch SerialPort.prototype.close to not throw when the port is already
 * closed.  The @meshtastic/transport-node-serial `create()` factory has an
 * `onError` handler that calls `port.close()` on a port that may never have
 * opened (e.g. "Resource temporarily unavailable / Cannot lock port").  The
 * synchronous throw from the native close() becomes an uncaught exception.
 */
async function patchSerialPortClose(): Promise<void> {
  try {
    const { SerialPort } = (await import("serialport")) as {
      SerialPort: { prototype: { close: ((...a: unknown[]) => unknown) & { __patched?: boolean } } };
    };
    const proto = SerialPort.prototype;
    if (proto.close && !proto.close.__patched) {
      const origClose = proto.close;
      const patched = function patchedClose(this: { isOpen?: boolean }, ...args: unknown[]) {
        if (!this.isOpen) {
          // Port already closed — invoke callback (if any) with the error
          // instead of throwing synchronously.
          const cb = typeof args[args.length - 1] === "function" ? args[args.length - 1] : undefined;
          if (cb) (cb as (e: Error) => void)(new Error("Port is not open"));
          return;
        }
        return origClose.apply(this, args);
      };
      patched.__patched = true;
      proto.close = patched as typeof proto.close;
    }
  } catch {
    // Best-effort; serialport may not be installed (HTTP transport).
  }
}

/** Connect to a Meshtastic device via serial or HTTP transport. */
export async function connectMeshtasticClient(
  options: MeshtasticClientOptions,
): Promise<MeshtasticClient> {
  let transport;
  if (options.transport === "serial") {
    // Patch before create() so the factory's onError handler won't throw.
    await patchSerialPortClose();
    const { TransportNodeSerial } = await import("@meshtastic/transport-node-serial");
    transport = await TransportNodeSerial.create(options.serialPort ?? "");
  } else {
    const { TransportHTTP } = await import("@meshtastic/transport-http");
    const address = options.httpAddress ?? "meshtastic.local";
    const prefix = options.httpTls ? "https" : "http";
    transport = await TransportHTTP.create(`${prefix}://${address}`);
  }

  const device = new MeshDevice(transport);

  // Node info cache for name resolution.
  const nodeNames = new Map<number, string>();
  const channelNames = new Map<number, string>();
  let myNodeNum = 0;

  // Subscribe to device events before configuring.
  // Event types from @meshtastic/core are complex generics; use explicit shapes.
  device.events.onMyNodeInfo.subscribe((info: { myNodeNum?: number }) => {
    if (info.myNodeNum) {
      myNodeNum = info.myNodeNum;
    }
  });

  device.events.onNodeInfoPacket.subscribe(
    (packet: { data?: { num?: number; user?: { longName?: string } } }) => {
      if (packet.data?.user?.longName && packet.data.num) {
        nodeNames.set(packet.data.num, packet.data.user.longName);
      }
    },
  );

  device.events.onConfigPacket.subscribe(
    (packet: {
      data?: {
        payloadVariantCase?: string;
        payloadVariant?: { value?: { index?: number; settings?: { name?: string } } };
      };
    }) => {
      // Capture channel config for name resolution.
      if (packet.data?.payloadVariantCase === "channels") {
        const ch = packet.data.payloadVariant?.value;
        if (ch && typeof ch.index === "number" && ch.settings?.name) {
          channelNames.set(ch.index, ch.settings.name);
        }
      }
    },
  );

  device.events.onDeviceStatus.subscribe((status: number) => {
    options.onStatus?.(`status=${status}`);
  });

  device.events.onMessagePacket.subscribe(
    async (packet: { from?: number; to?: number; channel?: number; data?: unknown }) => {
      if (!options.onText) {
        return;
      }
      const from = packet.from;
      if (!from || from === myNodeNum) {
        return;
      }
      const text =
        typeof packet.data === "string" ? packet.data : (packet.data as { text?: string })?.text;
      if (!text) {
        return;
      }

      const senderNodeId = nodeNumToHex(from);
      const channelIndex = packet.channel ?? 0;
      // Direct message: packet.to equals our node number.
      const isDirect = packet.to === myNodeNum;

      const event: MeshtasticTextEvent = {
        senderNodeNum: from,
        senderNodeId,
        senderName: nodeNames.get(from),
        text: typeof text === "string" ? text : String(text),
        channelIndex,
        isDirect,
        rxTime: Date.now(),
      };

      try {
        await options.onText(event);
      } catch (err) {
        options.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
  );

  // device.disconnect() may reject asynchronously (WritableStream already
  // closed by the transport layer after a USB disconnect).  A plain try/catch
  // only catches synchronous throws, so we must also swallow the returned
  // promise's rejection.
  const safeDisconnect = () => {
    try {
      const result = device.disconnect();
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch(() => {});
      }
    } catch {
      // Best-effort cleanup.
    }
  };

  // Configure the device (loads channels, nodes, config).
  // The SDK's configure() sends `wantConfigId` via sendRaw(), which also
  // triggers the serial transport to start connecting.  Because the first
  // sendRaw call happens before the transport is connected, the `wantConfigId`
  // packet is often lost.  We re-call configure() once DeviceConnected is
  // reached so the device actually receives the config request.
  let configureRetried = false;
  const configured = new Promise<void>((resolve, reject) => {
    let poll: ReturnType<typeof setInterval> | undefined;
    const cleanup = () => {
      clearInterval(poll);
      clearTimeout(timeout);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("device configure timed out (45 s)"));
    }, 45_000);
    device.events.onDeviceStatus.subscribe((status: number) => {
      if (status === 7 /* DeviceConfigured */) {
        cleanup();
        resolve();
      } else if (status === 5 /* DeviceConnected */ && !configureRetried) {
        // Transport is now connected — re-send the config request after a
        // short delay so the serial pipe is fully established.
        configureRetried = true;
        setTimeout(() => device.configure().catch(() => {}), 500);
      } else if (status === 2 /* DeviceDisconnected */) {
        cleanup();
        reject(new Error("device disconnected during configure"));
      }
    });
    // Poll as fallback — ste-core dispatch can miss late subscribers.
    poll = setInterval(() => {
      if (
        (device as unknown as { isConfigured: boolean }).isConfigured ||
        (device as unknown as { deviceStatus: number }).deviceStatus === 7
      ) {
        cleanup();
        resolve();
      }
    }, 2_000);
  });
  // First configure() call kicks off the transport connection.
  device.configure().catch(() => {});
  try {
    await configured;
  } catch (err) {
    // Configuration failed — disconnect the device to release the serial port
    // so retries can reopen it.
    safeDisconnect();
    throw err;
  }

  // LoRa region: rely on NVS-persisted config set via `meshtastic --set lora.region`.
  // Sending a partial setConfig (region-only) zeroes out tx_enabled, tx_power, etc.
  // in the protobuf message, effectively disabling TX.  So we skip setConfig here.

  // Set device display name if configured.  Fire-and-forget for the same reason.
  if (options.nodeName?.trim()) {
    const longName = options.nodeName.trim();
    const shortName = longName.slice(0, 4);
    device
      .setOwner({ longName, shortName } as Parameters<typeof device.setOwner>[0])
      .catch(() => {});
  }

  // Catch unhandled promise rejections originating from @meshtastic/core's
  // internal transport (e.g. WritableStream.close() on a broken serial port).
  // Without this the process crashes with exit code 1.
  let disposed = false;
  const rejectionGuard = (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason ?? "");
    if (/WritableStream|Invalid state/i.test(msg)) {
      // Suppress — handled.  Return without rethrowing so the process
      // doesn't crash.
      return;
    }
    // Non-transport rejections: let the default handler deal with them.
    // We can't rethrow here (would crash), so just log.
    console.error("[meshtastic] unhandled rejection:", reason);
  };
  process.on("unhandledRejection", rejectionGuard);

  if (options.abortSignal) {
    options.abortSignal.addEventListener("abort", () => safeDisconnect(), { once: true });
  }

  return {
    device,
    get myNodeNum() {
      return myNodeNum;
    },
    sendText: (text, destination, wantAck = true, channelIndex) =>
      device.sendText(text, destination, wantAck, channelIndex),
    getNodeName: (nodeNum) => nodeNames.get(nodeNum),
    getChannelName: (index) => channelNames.get(index) || (index === 0 ? "LongFast" : undefined),
    close: () => {
      safeDisconnect();
      // Remove rejection guard — no longer needed after disconnect.
      if (!disposed) {
        disposed = true;
        process.off("unhandledRejection", rejectionGuard);
      }
    },
  };
}
