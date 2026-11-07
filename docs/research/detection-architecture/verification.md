# 回帰条件とテスト

**目的**：内部構造を変えても、検出結果・記録・通知を変えない。**製品の成立条件の正本は[製品要件](../../ui-requirements.md)と[操作別設計](../../operations/README.md)**。本書はリファクタリング時に保護する境界とテストの対応を示す。

## 変えてはいけない動作

| 対象                            | 回帰条件（要点）                                                                                                                                                                       | 既存の主なテスト                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **共通の入力相関**              | 対象窓/プロセス、押下と状態結果の時系列、注入・修飾キー競合・期限切れ・破棄・foregroundの条件を維持。不確かなら採用しない                                                              | `tests/native/policy/WindowStateTests.cs`、`tests/operations/window-operation-detection.test.ts`                                                          |
| **W03/W04** 最大化・復元/最小化 | 前後状態・キー/マウス由来・同等キーの条件、Win+↓連続2回の1操作扱い、キーrepeat/派生状態の重複排除。独自captionでのWS_CAPTION消失を誤除外しない                                         | `tests/native/policy/WindowStateTests.cs`、`tests/operations/window-maximize-minimize.test.ts`                                                            |
| **W06/W07** 半分・四隅          | 配置幾何・入力方向キー列、Win保持の連続操作を1操作とし、中間のhalfを別計上しない                                                                                                       | `tests/native/policy/PlacementTests.cs`、`tests/operations/window-snap-placement.test.ts`                                                                 |
| **W02** 別画面移動              | 画面・対象・安定条件を確認。**移動は確定しているがキー方向の同等性が不明な場合は、記録のみ（shortcut=null）**                                                                          | `tests/native/policy/MonitorMoveTests.cs`、`tests/operations/window-operation-detection.test.ts`                                                          |
| **W01** 切替                    | 直接クリック/Alt+Tabの確定切替、同じ窓・キャンセル・タスクバーからの二重計上防止                                                                                                       | `tests/native/policy/WindowSwitchTests.cs`、`tests/operations/window-switch-detection.test.ts`                                                            |
| **W11** 閉じる                  | 入力と対象のDESTROY確認が必要。HIDE/単なるforeground変更/別窓やHWND再利用では採用しない                                                                                                | `tests/native/policy/WindowCloseTests.cs`、`tests/operations/window-close-detection.test.ts`                                                              |
| **W12** タスクバー              | slotとsnapshot、クリック/Win+数字、キーrepeat・stale/不明マッピングの棄却。W01と重複しない                                                                                             | `tests/native/policy/TaskbarTests.cs`、`tests/operations/taskbar-app-activation.test.ts`                                                                  |
| **非アクティブcaption複合**     | クリック起点/foreground/終端状態は個別に確認。**1Candidate→W01＋W03/W04**（0～2件）。fallbackとドラッグの優先/取消を維持                                                               | `tests/native/policy/InactiveCaptionTests.cs`、`tests/operations/inactive-caption-click.test.ts`                                                          |
| **別画面の複合ドラッグ**        | **1Candidate→W02＋W03/W07**。中間のW04/W06を別計上しない。不正な複合Evidenceは全体棄却。W02＋W06は対象外                                                                               | `tests/native/policy/CompoundDragTests.cs`、`tests/operations/cross-monitor-compound-drag.test.ts`                                                        |
| **通信・重複排除**              | protocol v2の`kind/profile`・type・generation・sequence・transactionを維持。旧世代・重複・順序逆行を除外                                                                               | `tests/native/native-operation-policy.test.ts`、`tests/app/ipc/native-message-protocol.test.ts`、`tests/native/helper-process-contract.test.ts`           |
| **寿命・故障**                  | stop/start、timer/非同期照会、helper再起動で古いCandidateを流さない。例外時はfail closed                                                                                               | `tests/app/lifecycle/observer-process-lifecycle.test.ts`、`tests/native/helper-process-contract.test.ts`                                                  |
| **保存・通知**                  | 複合2件は同一SQLite transactionで原子保存。失敗ならrollback、ACK喪失後の再送も重複なし。**記録できるかと通知できるかは別**。保存成功後、学習中・マウス由来・キー案内可能なもののみ通知 | `tests/storage/durable-write-recovery.test.ts`、`tests/operations/inactive-caption-click.test.ts`、`tests/operations/cross-monitor-compound-drag.test.ts` |
| **対象とプライバシー**          | 初回対象8操作以外を勝手に登録/計上しない。生入力・ウィンドウ名/ID等をJSONLや保存へ漏らさない                                                                                           | `tests/operations/supported-operation-scope.test.ts`、`tests/operations/legacy-snap-invocation.test.ts`、`tests/app/ipc/native-message-protocol.test.ts`  |

上記の「既存テスト」は**関連するテストの所在**を示す。**実機の検出精度やすべてのObserver配信順が既に保証されている意味ではない**。

## 変更前後で補強するテスト

| 優先                     | テスト                      | 最低限の確認事項                                                                                                                                                                                                                                               |
| ------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **最優先**               | **配送・競合・取消**        | マウス、キー、foreground、MOVESIZESTART/END、DESTROY、timerなどの**同じ入力列**を**本番の配信・調停実装**へ渡し、発行Candidate数・順序・種類を比較。背後窓caption fallback＋ドラッグ、Win+数字/W01の排他を含める。テスト専用の別Dispatcherだけでは代替できない |
| **最優先**               | **Candidateの全出口**       | WindowGesture、caption、switch、close、taskbarの**生JSONL**を確認。v2のkind/profile、origin/route、各Evidence、sequence/transaction、禁止fieldを比較する。複合の分割送信は禁止                                                                                 |
| **寿命変更の前には必須** | **Stop/Reset/timer/非同期** | 旧generationの結果をEmitしない、stop前の保留やworker終了でstale候補を復活させない                                                                                                                                                                              |
| Router実装時             | **追加容易性**              | 仮Handlerを登録するだけでObserver/他Handlerの分岐変更なく購読イベントを受け取れる。競合がない場合の既存結果に影響しない                                                                                                                                        |
| Classifier分割時         | **TS互換性**                | `classifyGesture`への同じCandidateでW ID、origin、shortcut、0～2件と順序が一致する                                                                                                                                                                             |
| 新データ境界導入時       | **データ最小化**            | **Nativeが出した生JSONL**とTS受信後の双方を検査。TS parserが未知fieldを捨ててもNativeで漏れていれば不合格。モニターの`x/y/width/height`は許可された幾何であり、生カーソル軌跡ではない                                                                          |
| Windows入力経路変更時    | **実機受入**                | 本人の明示同意で、代表アプリ（独自caption含む）、多画面/DPI、複合操作と通知を**同じ最終build**で確認。build SHA・結果・未確認事項を記録                                                                                                                        |

**配信/調停を変更する前には最優先2項目を固定する**。Handlerのtimer/worker所有を動かす場合は寿命テストも最優先にする。すでに同等の回帰がある場合は再利用し、不足分だけ追加する。

## 比較・合格判定

- **Native**：同じ人工イベント列から、候補の数・種類・確定順序・Evidence/route/origin・未送信の取消条件が一致する。
- **protocol**：`generation`と送信`sequence`の意味と順序を維持する。`transaction`は世代内で一意で再利用しないが、**取消による欠番は許容**し、絶対値の一致は必須にしない。
- **TypeScript**：同じCandidateに対する`Observation[]`・W ID・shortcut（`null`含む）・順序、SQLite保存・rollback・通知要求が一致する。
- **対象外の変更**：検出対象の追加、キー案内規則変更、protocol v3、新しい自動入力収集、3件以上の複合操作は今回のリファクタリングに含めない。
- **検証レベル**：C# Policy単体・TS単体・helper IPC・SQLite統合・Electron smoke・自然入力を区別する。**fixtureの成功は物理操作やOS Toast表示の証拠にはならない**。

Windowsの実行コマンド・CIは[開発ガイド](../../development.md)と[テスト実装方針](../../../.agents/skills/test-shortcut-coach/SKILL.md)を参照。**本文書は試験計画であり、試験の実行結果ではない**。
