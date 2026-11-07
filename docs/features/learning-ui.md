# ショートカット一覧・学習状態

**責務**：8操作の学習状況と直近7日の利用実績を表示し、操作ごとの学習状態を安全に更新する。見た目・初期値は[製品要件](../ui-requirements.md)と[Figmaの一覧画面](https://www.figma.com/design/mMfK6fQQzfhUqRHR7jsGne?node-id=275-6498)を正本とする。

## 1. 表示と画面状態

- `src/shared/learning.ts`が8操作の名称・表示順（W12 / W01 / W03 / W04 / W06 / W07 / W02 / W11）・4グループ（2 / 2 / 3 / 1）・一覧用キーを定義する。旧IDは再採番・合算せず、旧registryは検出・互換処理に必要な範囲だけ残す。
- **一覧にキーがあることと検出可能であることは別**。実機受入までは「準備中」の表示を検出成立の証拠にしない。
- `AppShell`が`useCoach`の単一購読と2画面の表示状態を所有する。画面往復では折り畳み・スクロールを維持し、Renderer再読込・再起動では一覧／全グループ展開に戻す。ローカル日付の切替は操作停止中にも反映する。
- TitleBar・NavigationRail・レスポンシブ表示は共通Shellを利用する。ウィンドウの位置・サイズ・終了は[ウィンドウのライフサイクル](window-lifecycle.md)が担当する。

## 2. 学習状態の更新

| 状態     | 記録 | マウス操作時の学習通知       |
| -------- | ---- | ---------------------------- |
| 学習中   | 継続 | 同等キーを確証できた場合のみ |
| 習得済み | 継続 | なし                         |
| 対象外   | 継続 | なし                         |

- 共通型`LearningState`を使い、保存済みの明示状態 → 旧`muted`設定 → 学習中の順に解決する。習得済みはユーザーの明示選択のみ。状態の履歴は保存せず、過去の操作回数・観測範囲を書き換えない。
- 各行のselectはアクセシブルな名称とキーボード操作を持ち、「準備中」でも変更できる。`setLearningState`はMainで送信元mainFrame・操作ID・値を検証し、Coreの直列キューからSQLite settingsを更新する。
- **保存成功後にだけ**確定状態とrevisionを更新。保存・再読込失敗時は旧確定値と保留／エラーを表示し、最新の保留設定を再試行する。勝手に計測を再開しない。
- 互換`muted`は学習中以外で通知OFF。旧`setMuted`によるONは学習中、OFFは対象外へ写す。旧JSONの経路は隔離回帰用で、通常起動はSQLite。

## 3. 記録・通知との境界

- `src/core/learning.ts`の`learningReadModel`は取得済みの直近7暦日の件数から表示値を作る。**未観測と観測済み0回**を区別し、分母0の率を0%と見せない。集計の安全整数超過は保全エラーとする。
- `getLearning`はMainが期間を決めた有界queryだけを使う。Rendererから任意SQL・保存先・任意期間を受け付けず、通知ウィンドウ・子frameからの呼出しも拒否する。
- 学習状態は[記録画面](records-ui.md)の集計フィルタにも影響するが、元の件数を改変しない。保存後の通知の条件・再送禁止は[標準通知](standard-notifications.md)を参照。

## 4. アセットと検証

- Figma由来のSVGと同梱fontは`src/renderer/src/assets/`等で管理し、実行時にFigmaや外部font APIへアクセスしない。Noto Sans JP・Interのライセンスは`src/renderer/public/licenses/`に同梱する。第三者素材の再配布権限は公開前に確認する。
- **自動試験**：`tests/records/shortcut-learning-summary.test.ts`（操作定義・日付・既知0・丸め）、`tests/records/learning-state-updates.test.ts`（3状態・SQLite・故障復旧）、IPC試験と一覧smoke（画面往復・再読込・4幅・保存失敗）。
- **対象外の証拠**：隔離fixtureでの表示・通知adapter試験は、実入力認識率、実OSトースト表示、混在DPI・文字拡大、NSIS導入の合格を示さない。
