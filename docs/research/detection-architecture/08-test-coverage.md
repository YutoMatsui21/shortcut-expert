# 08 回帰条件と現行テストの対応・不足（Step 3）

> **静的レビュー（2026-11-06 / main [782dbb79](https://github.com/YutoMatsui21/shortcut-expert/tree/782dbb79b11bf8eea3782ebbf4f299b0f83f76d3)）**。本書の「対応あり」は、該当するテストケース/Assertionをソース上で確認したことを表す。**今このrevisionでテストを実行してPASSしたという意味ではない**。基準行動は[07 回帰条件](07-regression-contract.md)のR01～R19。

## 1. テストの層と何を証明するか

| 層 | 既存の実行方法/入口 | 保護できる範囲 | 保証しない範囲 |
| --- | --- | --- | --- |
| **C# Native policy** | `tests/native/policy/*.cs`、Nodeの`native-operation-policy.test.ts`から実行 | 本番`CandidateTracker`・各Policyの人工イベント列、証拠生成、期限・取消、JSON契約 | 実OS Hook/WinEventの配送順、実アプリのヒットテスト精度 |
| **Core operation unit** | `tests/operations/*.test.ts`、`npm run test:unit` | 候補受理条件・W ID/案内・負例・複合Observation | C#がそのCandidateを実操作で生成できること |
| **Main/protocol** | `tests/app/ipc/native-message-protocol.test.ts`、`tests/app/lifecycle/observer-process-lifecycle.test.ts`、`tests/native/helper-process-contract.test.ts` | v2 schema、generation、JSONLの分割・異常、helper起動停止 | 実物理入力の認識 |
| **永続保存/通知** | `tests/storage/durable-write-recovery.test.ts`、`tests/operations/{cross-monitor-compound-drag,inactive-caption-click}.test.ts`、`tests/integration/candidate-to-page-model-data-flow.test.ts` | 実SQLiteでの重複・rollback・遅延・学習状態・通知adapter発行 | 実Windowsトーストの表示率 |
| **Electron/同梱smoke** | `scripts/test/smoke.mjs`、`scripts/test/ci-package-smoke.mjs` | synthetic CandidateからUI/IPC/SQLiteまでの接続と配布同梱 | Win32の自然入力・全アプリ |
| **手動自然入力** | `scripts/acceptance/*natural-acceptance.mjs`等（本人の明示同意後） | 対象build・機器・アプリ・操作に限った自然入力の成立 | 未試行の環境・入力・今と違うrevision |

`npm test`はunitとnativeの実行。WindowsのCI`.github/workflows/quality.yml`は、**実装変更でfullを行う**がMarkdownだけの場合は軽量チェックとなる。自動CIは人工fixtureであり**自然入力受入を代替しない**。

## 2. R01～R19 と主要な既存テスト

「対応」は主にAssert/Checkが存在するファイルを選び、同じテストファイルを網羅的に重複記載しない。**テスト名だけから推定した実行済みPASSは記載しない**。

| 回帰ID | 重点となる既存テスト | 静的に確認した保護対象 | 残る検証上の注意 |
| --- | --- | --- | --- |
| **R01/R02** 入力・証拠・不確定時の扱い | `native/policy/WindowStateTests.cs`、`operations/window-operation-detection.test.ts`、`operations/operation-event-classification.test.ts` | 状態/route/対象/期限の不成立、記録可能でも案内不能なケース | Observerでの実OS入力→窓読取→Policyへの引渡しは別途確認 |
| **R03** 競合/取消 | `native/policy/WindowStateTests.cs`、`native/policy/PlacementTests.cs`、`native/policy/WindowSwitchTests.cs`、`native/policy/InactiveCaptionTests.cs`、`native/policy/WindowCloseTests.cs` | 各PolicyのCancel、競合・異常入力・期限、入力順序 | **全Policyを束ねたObserverの呼出し順序と相互Cancel**は独立した統合テストが必要 |
| **R04** gesture・sequence・再配送 | `app/ipc/native-message-protocol.test.ts`、`storage/durable-write-recovery.test.ts`、`native/helper-process-contract.test.ts` | 世代/sequence/transactionの抑止、再送・故障時の非重複 | Sink/transaction発行者の変更時は全経路でIDの一意性を追跡 |
| **R05** W03 | `native/policy/WindowStateTests.cs`、`operations/window-maximize-minimize.test.ts`、`operations/operation-event-classification.test.ts` | 最大化状態・キー/マウス route、`Win+↑`、不正入力・fallback | 独自タイトルバーの物理入力はfixtureの成功で代替できない |
| **R06** W04 | `native/policy/Program.cs`（`CheckWinDownGrouping`）、`native/policy/WindowStateTests.cs`、`operations/window-maximize-minimize.test.ts`、`operations/supported-operation-scope.test.ts` | 復元/最小化、連続Win+↓、repeat、W04統合、案内 | 実アプリごとの最小化/復元WinEvent順と結果は実機で確認 |
| **R07** W06/W07 | `native/policy/PlacementTests.cs`、`operations/window-snap-placement.test.ts` | 各half/quarterのshape、Win保持方向キー列、中間計上の排除、負例 | DPI/monitorやOSスナップの物理境界は実機確認 |
| **R08** W02 | `native/policy/MonitorMoveTests.cs`、`operations/window-operation-detection.test.ts` | monitor差分・方向等価/unknown、キー/マウスの確証、負例 | 実Monitor配置・ドラッグのOSイベント順は実機別 |
| **R09** W01 | `native/policy/WindowSwitchTests.cs`、`operations/window-switch-detection.test.ts` | Alt+Tab/直接クリック、settle・Shell staging、same window、W12排除 | Observerとtaskbarの実際のイベント順による二重発行は追加保護が有効 |
| **R10** W11 | `native/policy/WindowCloseTests.cs`、`operations/window-close-detection.test.ts` | 実際のdestroy確認、hide/別対象/期限切れ/HWND再利用の負例 | 外部アプリの多段確認・通知は手動試験の対象 |
| **R11** W12 | `native/policy/TaskbarTests.cs`、`native/taskbar-uia-worker.test.ts`、`operations/taskbar-app-activation.test.ts` | slot、repeat、stale/変更snapshot、stop、W01非重複、SQLite | タスクバーUIA/複数画面/配列変更の自然入力は別途 |
| **R12** W01＋W03/W04 | `native/policy/InactiveCaptionTests.cs`、`operations/inactive-caption-click.test.ts` | 背後窓caption、foreground+終状態の独立確認、1候補から複数件、SQLite/1通知、取消/rollback | **Observerと通常WindowSwitch/Trackerとの競合**は配信変更前に統合レベルで固定する |
| **R13** W02＋W03/W07 | `native/policy/CompoundDragTests.cs`、`operations/cross-monitor-compound-drag.test.ts` | 同一gestureの2件、終端・不正Evidence一括棄却、中間W04/W06を除外 | Observer経由のMOVESIZEイベント・解放順序を変更するなら追加回帰が必要 |
| **R14** 原子保存・通知 | `operations/inactive-caption-click.test.ts`、`operations/cross-monitor-compound-drag.test.ts`、`storage/durable-write-recovery.test.ts`、`integration/candidate-to-page-model-data-flow.test.ts` | 2件目失敗rollback、ACK loss、学習状態/stop/pause、通知adapter | 実OS通知表示成功ではない。3件以上は今回の対象外 |
| **R15** wire v2 | `app/ipc/native-message-protocol.test.ts`、`native/native-operation-policy.test.ts`、`native/helper-process-contract.test.ts` | C#産出v2をTSでparse、Variant必須、未知profile拒否、epoch/ID | Handler/Sink分離後は**すべての候補経路**が同じJSON契約を守ることを比較 |
| **R16** 寿命/故障 | `app/lifecycle/observer-process-lifecycle.test.ts`、`native/helper-process-contract.test.ts`、`native/policy/WindowStateTests.cs` | stop/start、旧世代破棄、chunk/timeout/fault、helper終了 | 非同期照会・timer結果とHandlerのReset順序を動かす際は専用テスト追加 |
| **R17** 記録と通知の区別 | `integration/candidate-to-page-model-data-flow.test.ts`、`operations/window-switch-detection.test.ts`、`operations/taskbar-app-activation.test.ts`、`records/learning-state-updates.test.ts` | 3学習状態、保存先行、記録継続、通知適格性/抑制 | Windowsが実際に表示したかは確認しない |
| **R18** 対象8操作と旧ID | `operations/supported-operation-scope.test.ts`、`operations/legacy-snap-invocation.test.ts` | W05の集計混入除外、W08不採用等 | 新DispatcherへのSnap Handler誤登録を避ける |
| **R19** 通信データ最小化 | `native/native-operation-policy.test.ts`、`app/ipc/native-message-protocol.test.ts`、`app/lifecycle/observer-process-lifecycle.test.ts` | C#候補・TS schemaの許可field、未知データの投影/拒否 | **ObservedEventがNative内で閉じる**ことを新境界のテスト/レビューで確認 |

**既存のC#テスト群の実行入口**：`tests/native/policy/Program.cs` → `tests/native/native-operation-policy.test.ts`。後者が、C#出力をTypeScriptの`candidateV2`と`classify/classifyGesture`へ通す契約確認を実施する。

## 3. リファクタリングの前・途中で足したいテスト

| 優先度 | ID | 追加・補強するテスト仕様 | いつ必要か / 理由 |
| --- | --- | --- | --- |
| **P0** | **G01** | **Observer相当のイベント入力列→複数Handlerの配信・競合・取消の回帰**。キー/マウス/foreground/MOVESIZESTART/END/最小化/Destroyを、順序違い・期限・注入・対象変更込みで表現し、`CandidateEnvelope`の数・種類・transactionを比較する。Win+数字→W12のみ、ドラッグ中の派生窓状態を重複採用しない、非アクティブcaptionと通常switch/Trackerの干渉を防ぐ。 | **Dispatcher / Arbitrationを変更する前**。既存の操作別Policy単体テストだけではObserver内の順序が保護しきれない |
| **P0** | **G02** | **全Native出口のCandidate JSON互換性**。state/drag/placement/switch/close/taskbar/inactive-captionの正・負例を、`generation`/`transaction`/`sequence`/`origin`/`route`/`evidence`・不許可fieldについて検証。日時・sequenceの揺らぎは、意味を保つ正規化を明示して比較。1transactionを分割して2Candidate送らないことも確認。 | **Candidate Sink / Protocolを変更する前**。現在も多くのvariantにテストがあるため、既存を再利用し不足caseだけ追加 |
| **P1** | **G03** | **start/stop/resetと非同期結果・timerの境界**。stop直前の保留slot照会、Win+↑のtimer確定、切替settle、close破棄確認、世代切替で旧結果が`Emit`されない | handlerの寿命/非同期処理を移動する前 |
| **P1** | **G04** | **新検出器追加の拡張性契約**。仮のHandlerを1つ登録し、Observerや既存Handlerの分岐を書き換えずにObservedEventを受け取れること、意図しない既存Handlerは影響されないことを確認 | **Dispatcher実装と一緒に追加**する設計テスト。現行コードで実行するテストではない |
| **P1** | **G05** | **新しいTS Classifierを追加する登録/型のテスト**。既存`classifyGesture`の候補→Observation結果を表で固定し、新`evidence.kind`の追加時にParserとshared schemaを安全に更新できることを確認 | TSファイル分割時。既存の操作別assertの再利用を優先 |
| **P1** | **G06** | **安全なデータ境界**。Candidate/JSON LinesにHWND・PID・ウィンドウ名・キー列・座標・禁止文字列が追加されない。Native内部のObservedEventの値が直接`ICandidateSink`へ渡らない | 新ObservedEvent / CandidateDraft導入時 |
| **手動/必要に応じて** | **G07** | 同一最終buildで、独自captionを含む代表アプリ、異なるモニター/DPI、W01/W12/複合drag・captionの自然入力と実通知を確認。build SHA・操作・条件・不合格を別途記録 | Hook、ウィンドウ状態読取、hit test、非同期timerの意味が変わるリスクのある変更。本人の明示同意が必須 |

**P0の意味**：「必ず全ケースを新規追加する」ではなく、**既存テストが同じ境界を既に保護しているかを再確認し、足りない最小限だけ先行追加する**。Observer/Coordinatorに変更がないStepではG01を形式的に追加しない。

## 4. Codex向けのテスト選択ガイド（Step 4でIssueに割り当てる）

| 変更箇所 | 最低限の先行テスト候補 | 後続の検証 |
| --- | --- | --- |
| `CandidateTracker`の部分抽出 | `native/policy/WindowStateTests.cs`、`native/policy/MonitorMoveTests.cs`、`native/policy/PlacementTests.cs`、`native-operation-policy.test.ts` | 対応するTS operation unit、C#→TS→SQLite |
| 共通transaction/`CandidateProtocol` | `native/native-operation-policy.test.ts`、`native/helper-process-contract.test.ts`、`app/ipc/native-message-protocol.test.ts` | 全Candidate出口の互換性（G02）、Coreの再配送 |
| `Observer`/Dispatcher・Arbitration | G01の入力列、`native/policy/WindowSwitchTests.cs`、`native/policy/InactiveCaptionTests.cs`、`native/policy/CompoundDragTests.cs`、`native/policy/WindowCloseTests.cs` | 全native suite、必要時の本人同意による実機 |
| TypeScript`detector.ts`のファイル分割 | `tests/operations/*.test.ts`、`app/ipc/native-message-protocol.test.ts` | `native/native-operation-policy.test.ts`、複合SQLiteテスト |
| `DurableCoach`の調整（本Stepでは極力避ける） | `storage/durable-write-recovery.test.ts`、複合2種のSQLiteテスト | 対応するElectron storage smoke |

**ローカル/CIコマンド（Windows PowerShell）**：

```powershell
npm.cmd run test:unit
npm.cmd run test:native
npm.cmd run typecheck
npm.cmd run lint
```

全体のビルド・配布smoke等は[開発ガイド](../../development.md)と[テスト設計Skill](../../../.agents/skills/test-shortcut-coach/SKILL.md)に従い、**変更箇所に合った必要範囲**を選択する。`test:native`はhelper buildを含む。隔離fixtureのみであり自然入力観測はしない。

## 5. 本Stepの確認・未確認

- **実施したこと**：製品要件・操作別設計・テストソース・CI workflowを静的に読み、各R IDへ対応付け。G01～G07を潜在的な不足・追加検証として分類。
- **未実施**：テスト実行、実OS自然入力、新規テストの実装、正/負ケースの全分岐カバレッジ計測、PRのCI確認。
- **判定禁止**：ファイルの存在だけで完全保護、fixture成功で実機受入、未実行のテストをPASSとすること。
