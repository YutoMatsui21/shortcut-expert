export type OperationId = 'W01' | 'W02' | 'W03' | 'W04' | 'W05' | 'W06' | 'W07' | 'W08' | 'W09' | 'W10' | 'W11';
export type Bounds = { x: number; y: number; width: number; height: number };
export type Candidate = {
  type: 'candidate'; protocolVersion: 1; generation: number; sequence: number;
  app: string; operation: string; date: string;
  before: { state: string; arranged: boolean | null };
  after: { state: string };
  origin: 'mouse' | 'key' | 'unknown'; route: string;
  injected: boolean; conflicted: boolean; moving: boolean; elevated: boolean;
  targetMatched: boolean; inputAgeMs: number;
  monitor: Bounds | null;
};
export type Observation = {
  id: string; operation: OperationId; origin: 'mouse' | 'key'; date: string;
  shortcut: string | null; monitor: Bounds | null;
};
export type Counts = Record<string, Partial<Record<OperationId, { mouse: number; key: number }>>>;
export type Settings = { muted: OperationId[]; opened: boolean };
export type Snapshot = {
  counts: Counts; settings: Settings;
  observing: boolean; notificationsPaused: boolean;
  error: string | null; pendingSave: boolean;
};
export type Notice = { operation: OperationId; label: string; shortcut: string; monitor: Bounds; expiresAt: number };
export type CoachBridge = {
  getNotice(): Promise<Notice | null>;
  getSnapshot(): Promise<Snapshot>;
  command(command: 'pause-notifications' | 'resume-notifications' | 'stop' | 'start' | 'retry-save' | 'quit'): Promise<Snapshot>;
  setMuted(operation: OperationId, muted: boolean): Promise<Snapshot>;
  deleteCounts(): Promise<Snapshot>;
  subscribe(listener: (snapshot: Snapshot) => void): () => void;
};

export const operations: { id: OperationId; label: string; implemented: boolean }[] = [
  { id: 'W01', label: 'ウィンドウの切替', implemented: false },
  { id: 'W02', label: '別画面へ移動', implemented: false },
  { id: 'W03', label: '最大化', implemented: true },
  { id: 'W04', label: '最小化', implemented: false },
  { id: 'W05', label: '復元', implemented: false },
  { id: 'W06', label: '左右半分に配置', implemented: false },
  { id: 'W07', label: '四隅に配置', implemented: false },
  { id: 'W08', label: 'スナップレイアウト', implemented: false },
  { id: 'W09', label: 'デスクトップ表示', implemented: false },
  { id: 'W10', label: 'タスクビュー', implemented: false },
  { id: 'W11', label: 'ウィンドウを閉じる', implemented: false }
];
