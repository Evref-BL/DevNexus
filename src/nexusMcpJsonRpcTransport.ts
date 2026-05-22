import process from "node:process";
import type { Readable, Writable } from "node:stream";

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export function jsonRpcResult(
  id: JsonRpcId | undefined,
  result: unknown,
): unknown {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

export function jsonRpcError(
  id: JsonRpcId | undefined,
  code: number,
  message: string,
): unknown {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

export interface StdioJsonRpcTransportStreams {
  stdin: Readable;
  stdout: Writable;
}

export class StdioJsonRpcTransport {
  private buffer = Buffer.alloc(0);
  private processing = false;

  constructor(
    private readonly onMessage: (
      message: JsonRpcRequest,
    ) => Promise<unknown | undefined>,
    private readonly streams: StdioJsonRpcTransportStreams = {
      stdin: process.stdin,
      stdout: process.stdout,
    },
  ) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.streams.stdin.on("data", (chunk: Buffer | string) => {
        const bufferChunk = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk, "utf8");
        this.buffer = Buffer.concat([this.buffer, bufferChunk]);
        void this.processBuffer().catch((error: unknown) => {
          this.send(
            jsonRpcError(
              undefined,
              -32603,
              error instanceof Error ? error.message : String(error),
            ),
          );
        });
      });
      this.streams.stdin.once("end", resolve);
    });
  }

  private async processBuffer(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
      while (true) {
        if (this.buffer.length === 0) {
          return;
        }

        if (this.startsWithContentLengthFrame()) {
          const processed = await this.processContentLengthFrame();
          if (!processed) {
            return;
          }
          continue;
        }

        const processed = await this.processJsonLine();
        if (!processed) {
          return;
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async processContentLengthFrame(): Promise<boolean> {
    const headerEnd = this.headerEndIndex();
    if (!headerEnd) {
      return false;
    }

    const [endIndex, separatorLength] = headerEnd;
    const header = this.buffer.slice(0, endIndex).toString("utf8");
    const lengthMatch = /^Content-Length:\s*(\d+)\s*$/imu.exec(header);
    if (!lengthMatch) {
      throw new Error("Missing Content-Length header");
    }

    const contentLength = Number(lengthMatch[1]);
    const messageStart = endIndex + separatorLength;
    const messageEnd = messageStart + contentLength;
    if (this.buffer.length < messageEnd) {
      return false;
    }

    const body = this.buffer.slice(messageStart, messageEnd).toString("utf8");
    this.buffer = this.buffer.slice(messageEnd);
    await this.handleMessageBody(body, "content-length");
    return true;
  }

  private async processJsonLine(): Promise<boolean> {
    const newlineIndex = this.buffer.indexOf("\n");
    if (newlineIndex < 0) {
      return false;
    }

    const line = this.buffer.slice(0, newlineIndex).toString("utf8").trim();
    this.buffer = this.buffer.slice(newlineIndex + 1);
    if (!line) {
      return true;
    }

    await this.handleMessageBody(line, "json-line");
    return true;
  }

  private async handleMessageBody(
    body: string,
    responseFormat: "content-length" | "json-line",
  ): Promise<void> {
    const response = await this.onMessage(JSON.parse(body) as JsonRpcRequest);
    if (response) {
      this.send(response, responseFormat);
    }
  }

  private startsWithContentLengthFrame(): boolean {
    return this.buffer
      .subarray(0, Math.min(this.buffer.length, "Content-Length:".length))
      .toString("utf8")
      .toLowerCase() === "content-length:".toLowerCase();
  }

  private headerEndIndex(): [number, number] | undefined {
    const crlfIndex = this.buffer.indexOf("\r\n\r\n");
    if (crlfIndex >= 0) {
      return [crlfIndex, 4];
    }

    const lfIndex = this.buffer.indexOf("\n\n");
    return lfIndex >= 0 ? [lfIndex, 2] : undefined;
  }

  private send(
    message: unknown,
    responseFormat: "content-length" | "json-line" = "content-length",
  ): void {
    const body = JSON.stringify(message);
    if (responseFormat === "json-line") {
      this.streams.stdout.write(`${body}\n`);
      return;
    }

    this.streams.stdout.write(
      `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`,
    );
  }
}
