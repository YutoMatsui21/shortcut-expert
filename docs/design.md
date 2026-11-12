# 設計・アーキテクチャ

Shortcut Expertを**どの責務に分け、なぜそう接続するか**を記す。機能の合格条件は[製品要件](ui-requirements.md)、起動・検証コマンドは[開発ガイド](development.md)を正本とする。実装状況や作業順はIssue・PRで追跡し、ここには日付別の進捗を積み重ねない。

<a id="architecture"></a>

## 1. 全体構成

| 層            | 主な場所         | 責務・依存の制約                                                                          |
| ------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| Native helper | `native-helper/` | Win32の入力・ウィンドウ状態を観測し、候補をJSON Linesで通知。採用操作や案内キーは決めない |
| Main          | `src/main/`      | Electronライフサイクル、候補の厳格検証、IPC、保存・通知、helper管理                       |
| Core          | `src/core/`      | 操作の採用判定、学習状態、集計、日付処理。Electron・Windows APIに依存しない               |
| Preload       | `src/preload/`   | Rendererへ必要最小限の型付きIPC APIを公開                                                 |
| Renderer      | `src/renderer/`  | Reactの一覧・記録・設定UI。Windows APIや保存ファイルへ直接アクセスしない                  |
| Shared        | `src/shared/`    | 共通の操作ID、契約型、表示に必要な定義。OS依存を持たない                                  |

**依存方向**：Main → Core/Shared、Core → Shared、Renderer → Shared。RendererとMainはPreloadを介して通信する。CoreからMainを参照しない。

## 2. 操作の検出・採用

`Windows API → Native候補 → Mainの型・世代検証 → Coreの採用判定 → 保存 → 必要なら通知`

- **Native**：`Observer`で入力・状態を取り込み、`CandidateTracker`や操作別`Policy`で証拠を組み立てる。`CandidateProtocol`で送信順を確定する。最大化したままの画面移動は単独W02、既知配置からの再配置は`PlacementGeometry`で配置差を確認する。既存のTracker・Policy・複合契約を使用し、独立検出器やAggregatorは追加しない。UIAなどの遅い照会を入力hookの中で無制限に実行しない。
- **Main**：`observer.ts`で通信形式・必須項目・世代・protocol v2を検証し、認めた項目だけCoreへ渡す。未知の能力は`unknown`のまま扱う。
- **Core**：`detector.ts`などが入力由来・対象・結果・同等キーを照合する。確証のないイベントを推測で採用しない。**操作の記録可否とキー案内の可否は別判定**にする。
- **境界**：protocol v2だけを受理し、イベント識別子・入力transaction・送信sequenceによって旧世代や再配送を拒否する。入力した文字・生キー列・ウィンドウタイトル等は保存・外部送信しない。
- **入力系列**：`GestureManager`がTrackerの共通入力参照と開始・解放・終端snapshot、取消・期限切れ・Resetの寿命を管理する。操作固有の成立条件・キー系列の形状・W11のDESTROY待ち・W12のUIA待ちは既存Tracker／Policyに残す。共通GestureのIDはtransactionとは独立し、共通寿命からCandidateを送信しない。移行済み範囲と残る責務は[現行構成](research/detection-architecture/current.md)を参照。

- **採番**：Nativeの`DetectionSession`が観測世代内で共有transactionを発行する。ObserverのStartで開始し、Stopで失効する。検出器のResetや候補取消では共有カウンタを巻き戻さず、欠番を許容する。採番delegateは開始時の世代とライフサイクルを保持し、停止後は0（無効）を返す。W11の保留確認、W12のworker結果はメッセージスレッドで確定し、Stopで保留・worker参照を破棄する。Candidate Sinkは旧世代を棄却し、transactionとは独立に送信確定順のsequenceを発行する。通信型・Mainの再配送排除・保存・通知の契約は変更しない。

操作ごとの成立条件は[operations/](operations/)、技術検証の原本は[research/](research/)を参照。**検出処理の現在の構成と、実装前のリファクタリング設計は[検出アーキテクチャ](research/detection-architecture/README.md)に分けて記載する。\*\*\*\*W02（画面移動）とW03（最大化）／W07（四隅配置）の同時成立**は、1ジェスチャから異なる操作IDをそれぞれ1件採用し、同じIDを重複させない設計とする。実装・最終受入が完了した意味ではない（[#113](https://github.com/YutoMatsui21/shortcut-expert/issues/113)）。1操作への複数代替キー案内は将来の[#96](https://github.com/YutoMatsui21/shortcut-expert/issues/96)で扱う。

## 3. 起動・画面・IPC

- `startup-mode.ts`・`startup-data.ts`で通常／隔離モードと保存先を決定し、`coach-app.ts`が観測・保存・通知・IPC・終了処理を組み立てる。
- `coach-window.ts`がウィンドウの生成・再表示・位置復元を担当。トレイ／通知／二重起動の表示要求を同じ既存ウィンドウへ集約する。
- `coach-ipc.ts`が送信元frame・引数・削除確認tokenを検証する。Rendererは限定されたPreload APIだけを呼ぶ。`contextIsolation`と`sandbox`を維持する。
- UIの状態・操作ルールは[一覧](features/learning-ui.md)、[記録](features/records-ui.md)、[設定](features/settings-panel.md)、[ウィンドウ](features/window-lifecycle.md)を参照する。

## 4. 保存・通知

### 保存と移行

- 通常起動は`DurableCoach`と`SqliteRepository`を使う。`sqlite-repository.ts`が単一writer／`storage-worker.ts`を管理し、`storage-store.ts`だけがSQLiteへアクセスする。
- 件数・観測範囲・checkpoint等の一貫性を維持し、ACK喪失時の再送でも二重計上しない。複合操作の複数カウントは原子的に保存する設計とする。
- 記録は無期限に保持し、UI/IPCの取得は最大60日へ制限。旧JSONの厳格検証・staging移行・再照合は`storage-migration.ts`が担当する。失敗を空記録への初期化で隠さない。
- 通常起動・隔離smokeともに同じSQLite／標準通知経路を使う。旧JSON writer・30日prune・独自通知ウィンドウは設けない。旧JSONの読み取り検証だけを`legacy-documents.ts`に保持する。

詳細：[保存契約](storage/durable-storage.md)、[移行](storage/json-migration.md)、[削除](storage/history-deletion.md)。

### 通知

保存成功後にMainの`StandardNotifications`へ発行を依頼する。発行直前に学習状態・通知停止・計測停止を再確認し、失敗後の古い通知はまとめて再発行しない。OSへの発行要求成功と、Windowsがポップアップを表示したことは別。詳細は[通知設計](features/standard-notifications.md)。

<a id="test-design"></a>

## 5. テスト設計

**目的は誤記録・誤通知・データ喪失・入力妨害の検出。** テスト件数やcoverageだけで実機受入を代用しない。

| 層                                                   | 確認するもの                                            | 証明しないもの               |
| ---------------------------------------------------- | ------------------------------------------------------- | ---------------------------- |
| Node unit（`tests/**/*.test.ts`のうち`native/`以外） | Coreの判定・集計、Main境界の契約・故障対応              | 実際のWindows入力            |
| C# policy／native                                    | 本番C#の判定、JSON→Main→Coreの契約、helper起動停止      | 実OSイベントの到着精度       |
| Electron smoke                                       | 実Main・Preload・React・SQLiteの接続を隔離fixtureで確認 | 通常利用環境の動作・通知表示 |
| 同梱版smoke                                          | 配布用exeとhelperの同梱・起動経路                       | NSIS導入、自然入力の認識精度 |
| 自然入力・配布受入                                   | 対象Windows 11環境の実操作・通知・導入・終了            | 未試行の環境や全アプリの保証 |

`tests/`は自動回帰、`validation/probes/`は技術成立性の調査、`validation/evidence/`は実測原本。人工入力は通常の利用記録へ混ぜない。操作・リスクに応じたテスト選択は[テスト設計Skill](../.agents/skills/test-shortcut-coach/SKILL.md)、実行方法は[開発ガイド](development.md)を参照。

<a id="storage-review"></a>

### 保存・移行の故障境界

保存経路を変える際は、影響するケースを既存試験と照合する。

| 境界                   | 守る条件                                                 |
| ---------------------- | -------------------------------------------------------- |
| 未作成と読取失敗       | `ENOENT`を`EACCES`・I/O失敗と混同して空データにしない    |
| 書込・公開途中の中断   | 再起動後も所有情報と旧データを保全し、安全に再試行する   |
| DB・markerの欠落／破損 | 移行済み記録を空の初期値へ戻さない                       |
| 移行照合               | 空日・設定のみ・総和が同じ別行も含め、再openして全件照合 |
| 削除・ACK喪失          | 旧データの復活、同一書込の二重加算を防止する             |

## 6. 維持する設計原則

- 外部入力は境界で検証し、型アサーションで検証を代用しない。
- 直列化が必要な状態変更はキューで順序を保証する。非同期失敗は握りつぶさない。
- 条件分岐は意味の分かる関数へ分け、判定順序・副作用を維持する。
- コメントには**コードから読み取れない理由・制約**を書く。時系列の実装日誌はここに追加しない。
- 抽象化は実際の重複・変更需要に合わせる。根拠のない一般化を避ける。

過去の実装経緯は[履歴アーカイブ](archive/design/design-implementation-history.md)、進捗と未解決事項は[GitHub Issues](https://github.com/YutoMatsui21/shortcut-expert/issues)で追跡する。
