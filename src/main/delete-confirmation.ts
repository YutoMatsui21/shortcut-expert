import { randomUUID } from 'node:crypto';

// Ephemeral authority only: never persist a renderer's confirmation across navigation/restart.
export class DeleteConfirmation {
  private pending: { frame: object; token: string; expires: number } | null = null;
  private now: () => number;
  constructor(now = () => performance.now()) { this.now = now; }
  issue(frame: object): string {
    const token = randomUUID();
    this.pending = { frame, token, expires: this.now() + 300_000 };
    return token;
  }
  consume(frame: object, token: string): void {
    const value = this.pending;
    if (!value || value.frame !== frame || value.token !== token || this.now() >= value.expires) throw new Error('Invalid delete confirmation.');
    this.pending = null;
  }
  cancel(frame: object, token: string): void {
    if (this.pending?.frame === frame && this.pending.token === token) this.pending = null;
  }
  clear(): void { this.pending = null; }
}
