# W03・W04の検出器と受入条件（#31・#33）

> **2026-10-29 Issue責務の更新：** 本文の「#31は#113待ちでOpen」という完了判断は、PR #115時点の旧Close基準による履歴。#31はW03単独の局所実装として完了・Close済み。W02＋W03の複合確定・原子保存・単一Toastは[#113](https://github.com/YutoMatsui21/shortcut-expert/issues/113)、実機最終受入は[#47](https://github.com/YutoMatsui21/shortcut-expert/issues/47)の責務。現行Close基準は[#31](https://github.com/YutoMatsui21/shortcut-expert/issues/31)を参照。以下の当時の実装証拠・未確認範囲は変更しない。


2026-10-28。開始revisionは`bcd8fad2709460f4d48a0d2c54f8d2970e8360cb`。
正本は[確定要件](../ui-requirements.md)。[技術再審査](../research/compound-drag-validation.md)と最新の#9・#14により、G-W03/G-W04は制約付き着手PASS。研究時の成功を、この製品buildの自然入力精度へ読み替えない。

## 共通処理と操作別の条件

入力対象・process・入力由来・期限・競合・ドラッグの始終は既存の`CandidateTracker`で照合し、Native→Mainの厳格parse→Core→SQLite→一覧/記録→保存後通知を再利用する。標準captionボタンの矩形取得は`WindowCaption`にまとめ、既存のSnap用取得処理も同じ関数を使う。矩形が有効ならhit testより優先し、不可視・無効・重複・不正な矩形は採用しない。全ボタン矩形が空なら既存hit testへ戻す。取得失敗時も既存hit test以外の根拠は推測しない。

- W03：通常→最大化と最大化ボタン／caption double click／Win+↑を照合する。同一monitorの直接上端dragはcaption押下→MOVESIZESTART→物理解放→MOVESIZEEND時の最大化まで照合する。終端だけを候補にし、途中の復元や最大化callbackは数えない。
- 上端判定は解放先作業域の上端から2物理px以内、作業域内のX、解放先monitorと結果monitorの一致を必要とする保守的な実装境界。Windowsの全Snap領域を実証した値ではない。上端以外のSnap Layout選択、解放未確認、取消、注入、別対象、process/画面構成変更、停止、重複終端は除外する。最大化がMOVESIZEEND後に遅着した場合や、最大化起点の同一monitorドラッグは今回採用しない。これらの実入力成立範囲は未確認。
- W04：最大化→通常（復元ボタン／caption double click／Win+↓）と、通常・最大化→最小化（最小化ボタン／Win+↓）を同一IDへ分類する。最大化中のmouse最小化には「Win+↓（必要に応じて繰り返す）」を案内する。arranged/不明な起点のmouse最小化は記録とキー同等性を分離し、未確証キーは通知しない。arranged起点のWin+↓を最小化として採用しない。
- 連続Win+↓は、確定済み最大化解除に続く同一窓/processの通常→最小化の物理再押下だけを1件へまとめる。最初の押下から1000ms以内（1000msを含む）。再度最大化された窓の操作は独立する。自動repeatでは入力期限を更新せず、他入力、別窓/foregroundの変更、期限超過、停止/再開で連続関係を終了する。1000msは仮閾値で、認識精度の実測値ではない。

通常のprotocol v1/v2、保存schema、Preload API、W03/W04の別学習状態は維持する。旧W05の移行や新たな学習対象は追加しない。実入力の観測、キー送出、Windows設定の変更は行わない。

## #113との依存とClose判断

| 条件 | 今回の実装・証拠 | 残る条件 |
| --- | --- | --- |
| #31：mouse3経路とkeyの対象・結果照合 | ボタン、double click、同一monitor上端drag、Win+↑の本番policy/Core/SQLite fixture | 一般アプリ、保守的上端境界の実入力、遅着等は#47。別monitorの複合終端は#113と連携が必要 |
| #31：W02＋W03各1件、同一IDの重複0 | 単独W03再送・重複終端と、途中状態/取消/別対象等の負例 | 複合2件の原子保存・ACK再試行は#113未実装。今回は複合最大化を0件として保留し、W02片方だけの保存/通知も出さない |
| #31：学習中のみ保存後通知、3状態/停止/障害 | 単独W03の既存経路と局所結合fixture | 複合項目の独立適格性・単一Toastは#113未実装 |
| #33：G-W04の根拠 | #9・#14の最新本文と既存研究文書を確認 | 技術着手PASSは製品R02合格ではない |
| #33：同一W04、連続入力、repeat/期限/競合 | 本番C# policy→Main/Core→SQLite、既存・追加境界試験 | 同一最終buildの自然入力は#47 |
| #33：arranged/派生復元/Win+M/Win+D/不明な対象/program | 本番policyとCoreの負例、ドラッグ中の復元0件 | 複合確定後もW04が0件である全経路試験は#113 |
| #33：3状態/一覧/記録/通知、pause/stop、故障・復旧 | 実SQLite workerと通知アダプター、保存遅延/失敗/ACK喪失fixture | OS Toast表示と一般Windowsの最終build受入は#47 |

**#31の全Close条件は未達。** 現行Coreは1transactionにつき1操作、SQLiteのmutationは単一count、通知も単一操作であり、同じgestureの2候補を個別送信しても要求される原子保存・単一Toastを満たせない。今回それらを先回りして変更しない。画面跨ぎで最大化したdragをW03のみ・W02のみとして完成扱いにもせず、#113に向けた未実装として保持する。

#113では、同一HWND/process/世代のドラッグ始終・始終monitor・解放・終端最大化を相関づける候補契約、操作別重複排除、原子保存、適格項目の通知統合をまとめて実装する必要がある。今回の単独上端dragと通常位置へのW02終端を壊さず、派生W04を追加しない試験も行う。複合2件を送るためだけの暫定APIは追加しない。

2件をまとめたPRはレビュー・CIを通した上で、#113依存を含むClose/merge方針を本人と決める。`Closes #31`を記載したままmergeすると未達Issueが閉じるため、方針決定前はmergeしない。受入条件を削除・緩和してClose可能とは扱わない。

## 検証の範囲

- `tests/native-policy/WindowStateTests.cs`：本番CandidateTracker、caption矩形の純粋判定、上端dragの正常/負例、W04のmouse/keyと連続境界。`native-policy.test.ts`が新規C#候補を厳格v2 parse→Core→SQLiteへ流し、操作別件数・再送の非加算・保存後通知を確認する。
- `tests/window-state.test.ts`、既存detector/additional-operations：操作別条件とW03/W04の分離、未確証の経路・同等キーの非採用。
- `tests/fixture-integration.test.ts`：3状態、一覧/記録、通知アダプター、再読込。W04の保存遅延中pause/stop、書込失敗、ACK喪失と復旧後の非再通知・非重複。W03の故障境界は既存`durable-storage.test.ts`も使う。

これらは隔離人工fixture。本番Windowsイベント配送、独自caption、全アプリ、混在DPI、任意画面構成、実OS通知、NSIS、通常60分、同一最終build R02/J04は未確認。#47へ残し、人工試験の成功で代替しない。検証コマンドの結果・レビュー対象revision・最新head CIはPRに記録する。

ローカル検証：unit 275件、native 7件（内部C# policy 333ケース）、helper/Electron build・型検査、通常隔離smokeが成功。専用レビューで物理Winキーのextended flagによる連続関係の誤解除を指摘され、Winキー解放/再押下を含むRedを確認して注入bitのmask判定へ修正した。smokeは制限環境内のElectron ACLエラー後、同じfixtureを制限の外で実行し成功。ACLや製品sandbox設定は変更していない。helper buildではNuGet脆弱性情報の取得失敗警告があり、既存依存でコンパイル・publishが完了した。
