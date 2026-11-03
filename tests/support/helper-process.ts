import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

export type HelperRequest = {
  command: string;
  requestId: number;
  generation?: number;
  protocolVersion?: number;
  monitor?: unknown;
  candidate?: unknown;
};

// OS/process boundary only; protocol parsing and request lifetimes use production code.
export class HelperProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly requests: HelperRequest[] = [];
  readonly stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      if (this.writeError) {
        callback(this.writeError);
        return;
      }
      const request: HelperRequest = JSON.parse(chunk.toString());
      this.requests.push(request);
      queueMicrotask(() => this.respond?.(request));
      callback();
    },
  });
  exitCode: number | null = null;
  killed = false;
  writeError: Error | null = null;
  respond: ((request: HelperRequest) => void) | null = (request) => {
    const types: Record<string, string> = {
      start: "started",
      stop: "stopped",
      shutdown: "stopped",
      fixtureFocus: "focus",
    };
    this.send({
      type: types[request.command],
      requestId: request.requestId,
      result: "fixture-focus",
    });
    if (request.command === "shutdown") this.exit();
  };
  constructor() {
    super();
    this.stdin.on("error", () => {});
  }
  ready(protocolVersion = 2, arrangedAvailable = true): void {
    this.send({ type: "ready", protocolVersion, arrangedAvailable });
  }
  send(value: unknown): void {
    this.stdout.write(JSON.stringify(value) + "\n");
  }
  kill(): boolean {
    this.killed = true;
    return true;
  }
  exit(code = 0): void {
    this.exitCode = code;
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", code, null);
  }
  dispose(): void {
    this.stdout.destroy();
    this.stderr.destroy();
    this.stdin.destroy();
  }
}
