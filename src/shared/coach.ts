export type OperationId = 'W01' | 'W02' | 'W03' | 'W04' | 'W05' | 'W06' | 'W07' | 'W08' | 'W09' | 'W10' | 'W11' | 'W12' | 'W13' | 'W14';
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
  afterArranged?: boolean | null;
  fromMonitor?: Bounds | null;
  toMonitor?: Bounds | null;
  moveDirection?: 'left' | 'right' | null;
};
export type Observation = {
  id: string; operation: OperationId; origin: 'mouse' | 'key'; date: string;
  shortcut: string | null; monitor: Bounds | null;
};
// Protocol v2 expands the transport without asserting new detector capabilities.
export type CapabilityProfile = 'legacy-window-v1' | 'unverified';
export type WindowEvidenceResult = Omit<Candidate, 'type' | 'protocolVersion' | 'generation' | 'sequence' | 'date' | 'origin' | 'route' | 'injected' | 'conflicted'> &
  Required<Pick<Candidate, 'afterArranged' | 'fromMonitor' | 'toMonitor' | 'moveDirection'>>;
export type Evidence =
  | { kind: 'window'; profile: CapabilityProfile; result: WindowEvidenceResult }
  | { kind: 'shell-display'; profile: 'unverified'; feature: 'task-view' | 'snap-layout'; wasVisible: boolean | null; visible: boolean | null; targetMatched: boolean | null }
  | { kind: 'activation'; profile: 'unverified'; slot: number | null; appMatched: boolean | null; targetMatched: boolean | null; individualEquivalent: boolean | null; result: 'launched' | 'activated' | 'unknown' }
  | { kind: 'global'; profile: 'unverified'; feature: 'desktop' | 'minimize-all'; targetsKnown: boolean | null; resultConfirmed: boolean | null };
export type CandidateV2 = {
  type: 'candidate'; protocolVersion: 2; generation: number; sequence: number; transaction: number;
  date: string; origin: 'mouse' | 'key' | 'unknown'; route: string; injected: boolean; conflicted: boolean;
  evidence: Evidence;
};
export type ObserverCandidate = Candidate | CandidateV2;
export type Counts = Record<string, Partial<Record<OperationId, { mouse: number; key: number }>>>;
export type LearningState = 'learning' | 'mastered' | 'excluded';
export type Settings = { muted: OperationId[]; opened: boolean; states?: Partial<Record<OperationId, LearningState>>; normalBounds?: Bounds };
export type Snapshot = {
  counts: Counts; settings: Settings;
  coverage?: import('./storage.ts').CoverageDays; revision?: number;
  observing: boolean; notificationsPaused: boolean;
  error: string | null; pendingSave: boolean;
  windowMaximized?: boolean;
};
export type Notice = { operation: OperationId; label: string; shortcut: string; monitor: Bounds; expiresAt: number };
export type CoachBridge = {
  getLearning(): Promise<import('./learning.ts').LearningReadModel>;
  getRecordSummary(query?: import('./records.ts').RecordsQuery): Promise<import('./records.ts').RecordsReadModel>;
  windowCommand(command: 'minimize' | 'maximize' | 'hide'): Promise<void>;
  getRecords?(from: string, to: string): Promise<import('./storage.ts').RecordRange>;
  getNotice(): Promise<Notice | null>;
  getSnapshot(): Promise<Snapshot>;
  command(command: 'pause-notifications' | 'resume-notifications' | 'stop' | 'start' | 'retry-save' | 'quit'): Promise<Snapshot>;
  setMuted(operation: OperationId, muted: boolean): Promise<Snapshot>;
  setLearningState(operation: OperationId, state: LearningState): Promise<Snapshot>;
  deleteCounts(): Promise<Snapshot>;
  subscribe(listener: (snapshot: Snapshot) => void): () => void;
};

export const operations: { id: OperationId; label: string; shortcut: string; condition?: string; implemented: boolean }[] = [
  { id: 'W01', label: 'ウィンドウの切替', shortcut: 'Alt + Tab', condition: '切替候補を選択', implemented: false },
  { id: 'W02', label: '別画面へ移動', shortcut: 'Win + Shift + ← / →', implemented: true },
  { id: 'W03', label: '最大化', shortcut: 'Win + ↑', implemented: true },
  { id: 'W04', label: '最小化', shortcut: 'Win + ↓', condition: '通常窓。最大化中は復元してから', implemented: true },
  { id: 'W05', label: '復元', shortcut: 'Win + ↓', condition: '最大化から', implemented: true },
  { id: 'W06', label: '左右半分に配置', shortcut: 'Win + ← / →', implemented: false },
  { id: 'W07', label: '四隅に配置', shortcut: 'Win + ← / →、続けて ↑ / ↓', condition: 'Winを押したまま', implemented: false },
  { id: 'W08', label: 'スナップレイアウト', shortcut: 'Win + Z', implemented: false },
  { id: 'W09', label: 'デスクトップ表示', shortcut: 'Win + D', implemented: false },
  { id: 'W10', label: 'タスクビュー', shortcut: 'Win + Tab', implemented: false },
  { id: 'W11', label: 'ウィンドウを閉じる', shortcut: 'Alt + F4', implemented: true }
];
