# W06・W07の配置検出（#35・#37）

> **2026-10-29 Issue責務の更新：** 本文の「#35/#37はOpen維持」という判断は、PR #116時点の旧Close基準による履歴。#35・#37は単独W06/W07の局所実装として完了・Close済み。W02＋W07の複合確定・原子保存・単一Toastは[#113](https://github.com/YutoMatsui21/shortcut-expert/issues/113)、実機最終受入は[#47](https://github.com/YutoMatsui21/shortcut-expert/issues/47)に残る。現行Close基準は[#35](https://github.com/YutoMatsui21/shortcut-expert/issues/35)・[#37](https://github.com/YutoMatsui21/shortcut-expert/issues/37)を参照。以下の当時の実装証拠・未確認範囲は変更しない。


2026-10-28。開始revision `7b4a2bed0549e792bc04cdc586cf8678d515aeed`。
正本は[確定要件](../ui-redesign-requirements.md)。#9の[8操作調査](../research/eight-operation-validation.md)、#14の[複合ドラッグ再審査](../research/compound-drag-validation.md)を再利用する。G-W06/G-W07は制約付き着手PASSであり、今回の製品buildの自然入力成功を意味しない。過去の原本・評価は変更しない。

## 共通処理と固有条件

`PlacementGeometry`がPerMonitorV2の物理DWM可視frameとmonitor作業域、arranged、通常状態を照合する。左右halfと四隅quarterだけを分類し、座標丸めの1物理pxだけを許容する。サイズ制限、任意比率、API取得失敗、arranged不明、最大化/最小化結果を定型配置へ読み替えない。window矩形、入力列、HWND、process IDは候補通信・保存に追加しない。

mouseは既存CandidateTrackerのcaption入力→MOVESIZESTART→物理解放→同じ対象/processのMOVESIZEENDを再利用する。通常/最大化かつ非arranged起点、画面構成一致、入力対象/foreground一致、注入・競合なし、解放先monitorと結果monitor一致を必要とする。最終形状の左右に対応する作業域側端から2物理px以内の解放を確認し、quarterでは上下半分も照合する。同一monitorでは始終作業域・DPIも一致させる。途中の派生復元や配置callbackは数えない。

**側端2pxは保守的な実装境界で、OSのcorner領域の実測値ではない。** 上端内部のSnap Layout選択を除外するための条件であり、#14のreleaseZone=top-centerの成功trialを、この製品policyで採用できる証拠にしていない。Windowsが端から離れた解放でSnapする通常経路、MOVESIZEEND後の遅着結果、独自caption等の対応範囲は未確認。現行受入条件をこの境界へ縮小したものではない。

keyは`PlacementPolicy`が同一対象/process/画面構成/monitorのWin保持列を保留し、両方のWinキー解放時の実窓pollで終端を判定する。左右入力を起点とするhalf→quarterではW06を出さずW07だけ1件。先にWin解放でW06が完了した後、half起点のWin+上下でquarterへ変われば独立W07となる。起点と同じ形状、入力方向と異なる終端、未検証の起点は採用しない。repeatは系列・期限を更新しない。取消、他入力、別foreground、対象破棄、停止/再開、注入は未確定列を棄却する。棄却した列の後続方向キーだけで新しい正常列を作らない。既存の配置済み窓からWin+↑で最大化した場合は、Win解放時にW03の既存経路へ戻し、キー同等性は未確証のまま記録する。

系列上限15秒、最後の物理方向入力からWin解放まで1000ms、mouseの押下→移動開始は1000ms。これらは実装上限であって認識精度の実測値ではない。Win解放後に初めて終端が適用されるOSイベント順序は今回採用せず、実機で確認する。

protocol v2に`placement-v1`を追加し、最終shape・対象一致・入力からの経過時間・monitor変更の有無・通知monitorだけを渡す。Mainで型/値を厳格にparseし、Coreはmouse/key由来と経路、期限、同一monitorを再確認する。W06/W07は別々の日別件数・学習状態・キー率・通知とする。W07の案内は「Winを押したまま ←、続けて ↑」等、方向を特定した順次操作である。既存のSQLite writer、保存後通知、3状態、IPC、一覧/記録を再利用し、保存schemaとpreload APIは変更しない。

## #113とClose条件

| 条件 | このPRの証拠 | 未達・未確認 |
| --- | --- | --- |
| #35 技術ゲート/両halfのmouse・key | #9/#14の根拠、本番C# policy、strict parse/Core、SQLite、通知adapter、UI fixture | 自然入力、保守的側端条件の通常環境での成立範囲は#47 |
| #35 DPI/作業域/サイズ制限・開始状態 | 負座標、奇数幅、96/144/192 DPI、通常/最大化起点、サイズ制限、画面構成/作業域/DPI変更のpolicy fixture | 混在DPI・一般アプリ・画面変更の実機受入は未確認 |
| #35/#37 中間W06・独立再操作・誤分類/再送 | Win保持half→quarterはW07のみ、独立half→quarterは各1件。取消/resize/Snap Layout内部/注入/program/別対象/重複終端/停止を試験 | 同時program競合を全条件で判別した証拠はない |
| #37 四隅mouse/key・保存後通知・3状態・UI | 4形状×2由来のpolicy、C#候補→Main/Core→SQLite、3状態と通知adapter、Electron fixture | OS Toast実表示、自然入力4方向の製品最終build受入は#47 |
| #37 別monitor終端quarterとW02の独立成立 | 同じdragの始終monitor差とquarterのPlacementResultを保持するpolicy fixture | **W02＋W07各1件の製品確定は#38/#113待ち。現行単一writerへ片方だけ出力しない** |
| W02＋W06 | cross-halfをCore/単独送信から除外 | 未検証。対応範囲に追加しない |

複合dragは内部PlacementResultの`monitorChanged=true`まで判定するが、Native protocol送信とCore採用は保留する。W07だけ、またはW02だけを個別送信して原子保存・単一Toastを壊さない。#113ではこの同一対象・始終monitor・終端quarterの根拠を再利用し、操作別各1件・gesture内重複排除・原子保存/ACK再試行・通知適格性を統合する。本PRに暫定の複合保存APIは作らない。

**#37の全Close条件は未達。#35も保守的mouse経路の成立範囲を含め、製品完全対応とは主張しない。** 本人はこれらを残した部分実装の取り込みを承認した。#35・#37はOpenのまま維持し、受入条件を削除せず、#113を完了したことにもしない。

## 検証

実行環境はWindows `10.0.26340.0`、Node `24.11.1`、Electron `44.7.0`、.NET 10。今回の試験は隔離fixtureのみ。実入力監視・自動キー送出・Windows設定変更は行わない。

- `tests/native-policy/PlacementTests.cs`：本番policyの両half/四隅、Win保持と独立操作、DPI/作業域/負座標/サイズ制限、正常/負例。native-policy.test.tsがC#候補をMainのstrict parse→Core→実SQLiteへ接続し、再送非加算・保存後通知を確認。
- `tests/placement.test.ts`：W06/W07分類と方向別キー案内、未知経路/不正契約/複合結果の非採用。
- `tests/fixture-integration.test.ts`：3状態、一覧/記録model、SQLite再読込、通知adapter。W06/W07それぞれ保存遅延中のpause/stop、書込失敗、ACK喪失、再試行後の非重複・非再通知。
- `src/main/storage-smoke.ts`：helper fixture通信→Main/Core→SQLite→実IPC→Electronの一覧/記録。通常userDataを使わない。

unit全件・native全件、本番helper/Electron build・型検査を実行。NuGet脆弱性情報の取得にNU1900警告がある。SQLite/Electron smokeではW06/W07の別件数、実一覧/記録、再送非加算、hook停止を確認した。制限環境のesbuild親directory読取/Electron起動ACLエラーは、設定を変えず通常ユーザー環境で同じ隔離fixtureを再実行して切り分けた。smoke追加時の古いgeneration指定による非採用を修正した。

専用全体レビューは両Winキーの早期確定、未検証起点からの系列再開、arranged起点Win+↑のW03回帰を指摘した。再レビューでWin+Shiftの連続移動、非定型配置起点と通常→half→quarter列の終端最大化の取りこぼしも確認した。回帰fixtureを追加し、起点棄却のRedを確認して修正。配置列の棄却と既存W02/W03への引継ぎを分離し、最大化は最後の物理入力直前の状態を使う。本番C# policy 390ケースの成功を確認した。最終再レビュー・最新head CIはPRに記録する。fixtureは自然入力精度・最終R02/J04・NSISの証拠にはしない。
