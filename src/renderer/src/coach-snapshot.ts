import type { Snapshot } from '../../shared/coach';

// IPC replies and broadcasts can arrive in a different order than Main produced them.
export function newestSnapshot(current: Snapshot | undefined, incoming: Snapshot): Snapshot {
  return current && (current.stateVersion ?? -1) > (incoming.stateVersion ?? -1) ? current : incoming;
}
