import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, join } from "node:path";
import { app } from "electron";
import type { ObserverCandidate } from "../shared/coach";
import {
  parseWindowDiagnostics,
  type WindowDiagnosticCounts,
} from "../shared/window-diagnostics.ts";
import { candidateV2 } from "./observer-candidate.ts";
import { protocolId, record } from "./observer-fields.ts";
import { parseObserverMessage } from "./observer-json.ts";

export { candidateV2 } from "./observer-candidate.ts";
export { parseObserverMessage } from "./observer-json.ts";

const responseTypes: Record<string, string> = {
  start: "started",
  stop: "stopped",
  shutdown: "stopped",
  fixtureCandidate: "injected",
  fixtureFocus: "focus",
};

export class ObserverClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private processes = new Map<ChildProcessWithoutNullStreams, Promise<void>>();
  private generation = 0;
  private requestId = 0;
  private fixture: boolean;
  private onCandidate: (candidate: ObserverCandidate) => void;
  private onFault: () => void;
  private onWindowDiagnostics?: (counts: WindowDiagnosticCounts) => void;
  private ready: {
    resolve(): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
  } | null = null;
  private active = false;
  private closing = false;
  private arrangedAvailable = false;
  private pending = new Map<
    number,
    {
      type: string;
      resolve(value: Record<string, unknown>): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(
    onCandidate: (candidate: ObserverCandidate) => void,
    onFault: () => void,
    fixture = false,
    onWindowDiagnostics?: (counts: WindowDiagnosticCounts) => void,
  ) {
    this.onCandidate = onCandidate;
    this.onFault = onFault;
    this.fixture = fixture;
    this.onWindowDiagnostics = onWindowDiagnostics;
  }

  async start(): Promise<number> {
    if (!this.child) {
      await this.launchHelper();
      if (!this.arrangedAvailable && !this.fixture) {
        await this.shutdown();
        throw new Error("arranged-api-unavailable");
      }
    }
    const generation = ++this.generation;
    const result = await this.request("start", {
      generation,
      protocolVersion: 2,
    });
    if (result.type !== "started") throw new Error("helper-not-started");
    this.active = true;
    return generation;
  }

  private launchHelper(): Promise<void> {
    this.closing = false;
    const path = app.isPackaged
      ? join(process.resourcesPath, "native-helper", "WindowObserver.exe")
      : join(
          app.getAppPath(),
          "resources",
          "native-helper",
          "WindowObserver.exe",
        );
    const child = spawn(path, [this.helperMode()], {
      cwd: dirname(path),
      windowsHide: true,
      stdio: "pipe",
    });
    this.child = child;
    this.trackExit(child);
    this.listenForLines(child);
    this.listenForProcessFailure(child);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ready = null;
        this.failed();
        reject(new Error("helper-ready-timeout"));
      }, 5000);
      this.ready = { resolve, reject, timer };
    });
  }

  private helperMode(): string {
    if (this.fixture) return "--fixture";
    return this.onWindowDiagnostics
      ? "--window-validation-consented"
      : "--observe";
  }

  private trackExit(child: ChildProcessWithoutNullStreams): void {
    // A failed transport retires a child, but kill() alone does not confirm its exit.
    const exited = new Promise<void>((resolve) => {
      const done = () => {
        this.processes.delete(child);
        resolve();
      };
      child.once("exit", done);
      child.once("error", () => {
        if (!child.pid) done();
      });
    });
    this.processes.set(child, exited);
  }

  private listenForLines(child: ChildProcessWithoutNullStreams): void {
    let buffered = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text: string) => {
      if (this.child !== child) return;
      const parts = text.split("\n");
      for (let index = 0; index < parts.length; index++) {
        const part = parts[index];
        if (buffered.length + part.length > 16384) {
          buffered = "";
          this.failed();
          return;
        }
        buffered += part;
        if (index === parts.length - 1) return;
        this.receive(buffered.replace(/\r$/, ""));
        buffered = "";
        if (this.child !== child) return;
      }
    });
  }

  private listenForProcessFailure(child: ChildProcessWithoutNullStreams): void {
    child.stdout.on("end", () => {
      if (this.child === child && !this.closing) this.failed();
    });
    child.stderr.resume();
    child.on("error", () => {
      if (this.child === child) this.failed();
    });
    child.on("exit", () => {
      if (this.child !== child) return;
      if (this.closing) this.child = null;
      else this.failed();
    });
  }

  async stop(): Promise<void> {
    this.active = false;
    if (!this.child) return;
    try {
      const response = await this.request("stop");
      if (response.type !== "stopped") throw new Error("stop");
    } catch {
      this.failed();
      throw new Error("helper-stop-failed");
    }
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    this.active = false;
    const child = this.child;
    const waits = [...this.processes].map(async ([process, exited]) => {
      const kill = setTimeout(() => process.kill(), 2500);
      let deadline: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          exited,
          new Promise<never>((_, reject) => {
            deadline = setTimeout(
              () => reject(new Error("helper-exit-unconfirmed")),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(kill);
        clearTimeout(deadline);
      }
    });
    const shutdown = async () => {
      if (!child) return;
      try {
        await this.request("shutdown");
      } catch {
        child.kill();
      } finally {
        child.stdin.end();
      }
    };
    await Promise.all([shutdown(), ...waits]);
    if (this.child === child) this.child = null;
  }

  async inject(value: ObserverCandidate): Promise<void> {
    if (!this.fixture) throw new Error("fixture-only");
    await this.request("fixtureCandidate", { candidate: value });
  }

  async focusToken(): Promise<string> {
    if (!this.fixture) throw new Error("fixture-only");
    const response = await this.request("fixtureFocus");
    if (typeof response.result !== "string")
      throw new Error("invalid-focus-token");
    return response.result;
  }

  private request(
    command: string,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (!this.child || this.child.stdin.destroyed)
      return Promise.reject(new Error("helper-unavailable"));
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("helper-request-timeout"));
      }, 2500);
      this.pending.set(requestId, {
        type: responseTypes[command],
        resolve,
        reject,
        timer,
      });
      this.child!.stdin.write(
        JSON.stringify({ command, requestId, ...extra }) + "\n",
        (error) => {
          if (error) {
            clearTimeout(timer);
            this.pending.delete(requestId);
            reject(error);
          }
        },
      );
    });
  }

  private receive(line: string): void {
    try {
      const message: unknown = parseObserverMessage(line);
      if (!record(message)) throw new Error("protocol");
      if (message.type === "ready") return this.receiveReady(message);
      if (message.type === "candidate") return this.receiveCandidate(message);
      if (message.type === "window-diagnostics" && this.onWindowDiagnostics)
        return this.receiveDiagnostics(message);
      this.receiveResponse(message);
    } catch {
      this.failed();
    }
  }

  private receiveReady(message: Record<string, unknown>): void {
    if (message.protocolVersion !== 2) throw new Error("helper-protocol");
    this.arrangedAvailable = message.arrangedAvailable === true;
    if (!this.ready) return;
    clearTimeout(this.ready.timer);
    this.ready.resolve();
    this.ready = null;
  }

  private receiveCandidate(message: Record<string, unknown>): void {
    const value = candidateV2(message);
    if (!value) throw new Error("candidate");
    if (this.active && value.generation === this.generation)
      this.onCandidate(value);
  }

  private receiveDiagnostics(message: Record<string, unknown>): void {
    const counts = parseWindowDiagnostics(message.counts);
    if (!counts || !protocolId(message.generation))
      throw new Error("window-diagnostics");
    if (message.generation === this.generation)
      this.onWindowDiagnostics?.(counts);
  }

  private receiveResponse(message: Record<string, unknown>): void {
    this.settleRequest(message);
    if (message.type === "fault") this.failed();
  }

  private settleRequest(message: Record<string, unknown>): void {
    const { requestId } = message;
    if (typeof requestId !== "number") return;
    const pending = this.pending.get(requestId);
    if (!pending) return;
    if (message.type !== "fault" && message.type !== pending.type)
      throw new Error("response-type");
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    if (message.type === "fault") pending.reject(new Error("helper-fault"));
    else pending.resolve(message);
  }

  private failed(): void {
    this.active = false;
    const child = this.child;
    this.child = null;
    child?.kill();
    if (this.ready) {
      clearTimeout(this.ready.timer);
      this.ready.reject(new Error("helper-failed"));
      this.ready = null;
    }
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("helper-failed"));
    }
    this.pending.clear();
    if (child && !this.closing) this.onFault();
  }
}
