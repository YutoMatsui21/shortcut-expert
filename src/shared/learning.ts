import type { OperationId } from './coach.ts';

export const learningGroups = [
  { label: '起動・切り替え', icon: 'imgCategoryIcon' },
  { label: '最大化・最小化', icon: 'imgCategoryIcon1' },
  { label: '配置・移動', icon: 'imgCategoryIcon2' },
  { label: '画面の整理', icon: 'imgCategoryIcon3' }
] as const;
export type LearningState = 'learning' | 'mastered' | 'excluded';
// Static keycaps describe the intended shortcut, never detector evidence.
export const learningOperations: { id: OperationId; group: number; label: string; keys: string[]; hint?: string; availability: 'preparing' }[] = [
  { id: 'W12', group: 0, label: 'タスクバーのアプリを開く', keys: ['Win', '1–9'], availability: 'preparing' },
  { id: 'W01', group: 0, label: 'ウィンドウを切り替える', keys: ['Alt', 'Tab'], availability: 'preparing' },
  { id: 'W10', group: 0, label: 'ウィンドウ一覧を表示する', keys: ['Win', 'Tab'], availability: 'preparing' },
  { id: 'W03', group: 1, label: 'ウィンドウを最大化する', keys: ['Win', '↑'], availability: 'preparing' },
  { id: 'W05', group: 1, label: '最大化を解除する', keys: ['Win', '↓'], availability: 'preparing' },
  { id: 'W04', group: 1, label: 'ウィンドウを最小化する', keys: ['Win', '↓'], availability: 'preparing' },
  { id: 'W08', group: 2, label: '配置候補を表示する', keys: ['Win', 'Z'], availability: 'preparing' },
  { id: 'W06', group: 2, label: '左右半分に配置する', keys: ['Win', '← / →'], availability: 'preparing' },
  { id: 'W13', group: 2, label: '上下半分に配置する', keys: ['Win', 'Alt', '↑ / ↓'], availability: 'preparing' },
  { id: 'W07', group: 2, label: '画面の四隅に配置する', keys: ['Win', '方向キー'], hint: 'Winを押したまま ← / →、続けて ↑ / ↓', availability: 'preparing' },
  { id: 'W02', group: 2, label: '別画面に移動する', keys: ['Win', 'Shift', '← / →'], availability: 'preparing' },
  { id: 'W11', group: 3, label: 'ウィンドウを閉じる', keys: ['Alt', 'F4'], availability: 'preparing' }
];
export type LearningRow = { id: OperationId; state: LearningState; mouse: number | null; key: number | null; total: number | null; rate: number | null };
export type LearningReadModel = { from: string; to: string; revision: number; rows: LearningRow[] };
