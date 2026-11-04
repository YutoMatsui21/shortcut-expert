import type { OperationId } from "../shared/coach.ts";

export type FinalCase = {
  id: string;
  label: string;
  instruction: string;
  origin: "mouse" | "key" | "negative";
  records: OperationId[];
  notices: { operation: OperationId; shortcut: string }[];
};
const one = (
  id: string,
  operation: OperationId,
  origin: FinalCase["origin"],
  label: string,
  instruction: string,
  shortcut: string,
): FinalCase => ({
  id,
  label,
  instruction,
  origin,
  records: [operation],
  notices: origin === "mouse" ? [{ operation, shortcut }] : [],
});
const negative = (
  id: string,
  label: string,
  instruction: string,
): FinalCase => ({
  id,
  label,
  instruction,
  origin: "negative",
  records: [],
  notices: [],
});
const quarter = (side: string, vertical: string) =>
  `Winを押したまま ${side}、続けて ${vertical}`;
export const finalInputCases: FinalCase[] = [
  one(
    "P12m",
    "W12",
    "mouse",
    "タスクバーclick",
    "主タスクバーの選択番号のアプリアイコンを1回クリック。番号は事前に目視確認。",
    "slot",
  ),
  one(
    "P12k",
    "W12",
    "key",
    "Win+数字",
    "存在する選択番号のWin+数字を1回。10番はWin+0。",
    "",
  ),
  one(
    "P01m",
    "W01",
    "mouse",
    "通常窓を直接click",
    "背後に見える別の通常窓を1回クリックして切り替える。タスクバーは使わない。",
    "Alt + Tab",
  ),
  one(
    "P01k",
    "W01",
    "key",
    "Alt+Tab",
    "Alt+Tabで別の通常窓へ切り替え、全キーを離す。",
    "",
  ),
  one(
    "P03m",
    "W03",
    "mouse",
    "最大化ボタン",
    "通常・未配置の窓の最大化ボタンを1回クリック。",
    "Win + ↑",
  ),
  one(
    "P03k",
    "W03",
    "key",
    "Win+↑",
    "通常・未配置の窓でWin+↑を1回、全キーを離す。",
    "",
  ),
  one(
    "P04m",
    "W04",
    "mouse",
    "復元ボタン",
    "最大化した窓の復元ボタンを1回クリック。",
    "Win + ↓",
  ),
  one(
    "P04k",
    "W04",
    "key",
    "Win+↓ 復元",
    "最大化した窓でWin+↓を1回、全キーを離す。",
    "",
  ),
  ...(["left", "right"] as const).flatMap((side) => {
    const arrow = side === "left" ? "←" : "→",
      label = side === "left" ? "左" : "右";
    return [
      one(
        `P06m-${side}`,
        "W06",
        "mouse",
        `${label}半分drag`,
        `通常窓のcaptionから同じ画面の${label}端へ直接dragし、half配置で離す。`,
        `Win + ${arrow}`,
      ),
      one(
        `P06k-${side}`,
        "W06",
        "key",
        `Win+${arrow}`,
        `通常窓でWin+${arrow}を1回、全キーを離す。`,
        "",
      ),
      one(
        `P02m-${side}`,
        "W02",
        "mouse",
        `別画面へ${label}移動`,
        `横並び・上端一致の2画面で、通常窓を${label}の別画面の通常位置へdrag。端に配置しない。`,
        `Win + Shift + ${arrow}`,
      ),
      one(
        `P02k-${side}`,
        "W02",
        "key",
        `Win+Shift+${arrow}`,
        `横並び2画面で移動先が${label}となる起点からWin+Shift+${arrow}を1回。`,
        "",
      ),
    ];
  }),
  ...(["left", "right"] as const).flatMap((side) =>
    (["top", "bottom"] as const).flatMap((vertical) => {
      const arrow = side === "left" ? "←" : "→",
        up = vertical === "top" ? "↑" : "↓";
      const label = `${side === "left" ? "左" : "右"}${vertical === "top" ? "上" : "下"}`;
      return [
        one(
          `P07m-${side}-${vertical}`,
          "W07",
          "mouse",
          `${label}quarter drag`,
          `captionから同じ画面の${label}隅へ直接dragし、quarter配置で離す。`,
          quarter(arrow, up),
        ),
        one(
          `P07k-${side}-${vertical}`,
          "W07",
          "key",
          `${label}quarter key`,
          `通常窓でWinを保持したまま${arrow}、続けて${up}。最後にWinを離す。`,
          "",
        ),
      ];
    }),
  ),
  one(
    "P11m",
    "W11",
    "mouse",
    "閉じるボタン",
    "保存不要の通常窓の閉じるボタンをクリック。窓自体の閉鎖を確認。",
    "Alt + F4",
  ),
  one(
    "P11k",
    "W11",
    "key",
    "Alt+F4",
    "保存不要の通常窓でAlt+F4。窓自体の閉鎖を確認。",
    "",
  ),
  one(
    "S03-double",
    "W03",
    "mouse",
    "double click最大化",
    "通常窓のcaptionをダブルクリック。",
    "Win + ↑",
  ),
  one(
    "S03-drag",
    "W03",
    "mouse",
    "上端drag最大化",
    "通常窓のcaptionから同じ画面の上端へ直接dragし、最大化で離す。",
    "Win + ↑",
  ),
  one(
    "S04-double",
    "W04",
    "mouse",
    "double click復元",
    "最大化した窓のcaptionをダブルクリック。",
    "Win + ↓",
  ),
  one(
    "S04-min-normal",
    "W04",
    "mouse",
    "通常窓を最小化",
    "通常・未配置の窓で最小化ボタンをクリック。",
    "Win + ↓",
  ),
  one(
    "S04-min-max",
    "W04",
    "mouse",
    "最大化窓を最小化",
    "最大化した窓で最小化ボタンをクリック。",
    "Win + ↓",
  ),
  one(
    "S04-repeat",
    "W04",
    "key",
    "連続Win+↓",
    "最大化窓でWin+↓を物理的に2回、1000ms以内に再押下して最小化。長押しはしない。",
    "",
  ),
  one(
    "S01-multi",
    "W01",
    "key",
    "Alt+複数Tab",
    "Altを保持したままTabを複数回押し、別の通常窓でAltを離す。",
    "",
  ),
  one(
    "P02m-two-displays",
    "W02",
    "mouse",
    "上下／上端非整列2画面の移動",
    "画面上端の高さが異なる非重複2画面専用。通常・未配置窓をもう一方の画面の通常位置へdragし、端に配置せず離す。W02の案内を確認。",
    "Win + Shift + ←",
  ),
  {
    id: "C03-two-displays",
    label: "上下／上端非整列2画面の移動＋最大化",
    origin: "mouse",
    instruction:
      "画面上端の高さが異なる非重複2画面専用。通常・未配置窓をもう一方の画面上端へ1回で直接dragし最大化。1つの通知に移動・最大化の2行を確認。",
    records: ["W02", "W03"],
    notices: [
      { operation: "W02", shortcut: "Win + Shift + ←" },
      { operation: "W03", shortcut: "Win + ↑" },
    ],
  },
  {
    id: "C07-two-displays",
    label: "上下／上端非整列2画面の移動＋四隅",
    origin: "mouse",
    instruction:
      "画面上端の高さが異なる非重複2画面専用。通常・未配置窓をもう一方の画面左上隅へ1回で直接dragしquarter配置。1つの通知に移動・四隅の2行を確認。",
    records: ["W02", "W07"],
    notices: [
      { operation: "W02", shortcut: "Win + Shift + ←" },
      { operation: "W07", shortcut: quarter("←", "↑") },
    ],
  },
  {
    id: "P02m-unknown",
    label: "キー同等性不明の別画面へ移動",
    origin: "mouse",
    instruction:
      "2画面確証も左右方向確証もない構成専用。通常窓を別画面へdragし通常位置で離す。W02記録のみを確認。",
    records: ["W02"],
    notices: [],
  },
  one(
    "P02k-unknown-left",
    "W02",
    "key",
    "上下／非整列 Win+Shift+←",
    "通常窓からWin+Shift+←で別画面へ移動し全キー解放。実結果を確認する。",
    "",
  ),
  one(
    "P02k-unknown-right",
    "W02",
    "key",
    "上下／非整列 Win+Shift+→",
    "通常窓からWin+Shift+→で別画面へ移動し全キー解放。実結果を確認する。",
    "",
  ),
  {
    id: "C07-unknown",
    label: "方向不明＋別画面quarter",
    origin: "mouse",
    instruction:
      "2画面確証も左右方向確証もない構成専用。通常窓を別画面左上隅へ直接drag。W02は記録のみ、W07だけ案内。",
    records: ["W02", "W07"],
    notices: [{ operation: "W07", shortcut: quarter("←", "↑") }],
  },
  ...(["left", "right"] as const).flatMap((side) => {
    const arrow = side === "left" ? "←" : "→";
    return [
      {
        id: `C03-${side}`,
        label: `別画面${arrow}＋最大化`,
        origin: "mouse" as const,
        instruction: `通常窓を${side === "left" ? "左" : "右"}の別画面の上端へ1回で直接dragし、最大化して離す。`,
        records: ["W02", "W03"] as OperationId[],
        notices: [
          { operation: "W02" as const, shortcut: `Win + Shift + ${arrow}` },
          { operation: "W03" as const, shortcut: "Win + ↑" },
        ],
      },
      {
        id: `C07-${side}`,
        label: `別画面${arrow}＋quarter`,
        origin: "mouse" as const,
        instruction: `通常窓を${side === "left" ? "左" : "右"}の別画面の左上隅へ1回で直接dragし、quarterで離す。`,
        records: ["W02", "W07"] as OperationId[],
        notices: [
          { operation: "W02" as const, shortcut: `Win + Shift + ${arrow}` },
          { operation: "W07" as const, shortcut: quarter("←", "↑") },
        ],
      },
      {
        id: `C03-unknown-${side}`,
        label: `方向不明${arrow}＋最大化`,
        origin: "mouse" as const,
        instruction:
          "2画面確証も左右方向確証もない構成専用。通常窓を別画面上端へdragし最大化。",
        records: ["W02", "W03"] as OperationId[],
        notices: [{ operation: "W03" as const, shortcut: "Win + ↑" }],
      },
    ];
  }),
  negative(
    "N01-escape",
    "Alt+Tab取消",
    "Alt+Tabを開きEscで取消し、元の通常窓に戻る。",
  ),
  negative(
    "N01-return",
    "Alt+Tab元窓",
    "Altを保持したまま元の通常窓を選び直してAlt解放。",
  ),
  negative("N01-same", "同窓click", "既に前面の通常窓の本文をクリック。"),
  negative(
    "N01-tab",
    "ブラウザー内タブ切替",
    "同じブラウザー窓内のタブだけをクリックして切り替える。",
  ),
  negative(
    "N12-empty",
    "存在しない番号",
    "存在しないタスクバー番号のWin+数字を1回。空きがなければ実施しない。",
  ),
  negative(
    "N12-modifier",
    "Win+数字追加修飾",
    "存在する番号へCtrl+Win+数字。追加修飾の除外を確認。",
  ),
  negative(
    "N02-return",
    "drag元画面へ戻す",
    "captionから別画面に入り、同じdragで元画面の通常位置へ戻して離す。",
  ),
  negative("N02-cancel", "画面移動drag取消", "別画面へdrag中にEsc取消し。"),
  negative("N67-cancel", "配置drag取消", "同じ画面の端へdrag中にEsc取消し。"),
  negative(
    "N11-dialog",
    "閉鎖確認取消",
    "保存確認の出る試験用窓を閉じる操作後、確認dialogで取消す。",
  ),
  negative(
    "N11-tab",
    "タブの×",
    "複数タブのブラウザーでタブの×だけをクリック。窓は残す。",
  ),
  negative("N08", "Win+Z", "Win+ZでSnap Layoutを開き、Escで閉じる。"),
  negative("N10", "Win+Tab", "Win+TabでTask Viewを開き、元の窓へ戻る。"),
  negative(
    "N-layout",
    "Snap Layout内部選択",
    "Snap Layout UIで配置先を選ぶ。直接dragとは区別する。",
  ),
];
