# 02 コンポーネントの責務・入出力一覧（現行）

基準：[main@29bd044](https://github.com/YutoMatsui21/shortcut-expert/tree/29bd044be4dc7d71e38179d556d6a272787fe949)。実装上の役割を記述する。ここに示すクラス分割が将来の推奨構成とは限らない。

## 1. 最上位の境界

| フォルダ | 入口・入力 | 主な処理 | 外へ出すもの |
| --- | --- | --- | --- |
| `native-helper/`（C#） | Windows Hook / WinEvent / UIA・状態問合せ / Mainの`stdin`コマンド | OS入力の時系列を保持し、状態変化と照合、候補Evidenceを生成 | `CandidateEnvelope`等をJSON Linesで`stdout`に出力 |
| `src/main/`（Electron） | helperのstdout、renderer IPC、アプリ状態 | 子プロセス管理、プロトコルの厳密な受信検証、Coreの呼出し | 検証済み`ObserverCandidate`をCoreへ渡す |
| `src/core/`（TypeScript） | `ObserverCandidate`、保存・学習設定 | 世代/重複チェック、操作採用、件数の永続化、通知適格性判定 | `Observation[]`、書込・通知要求 |
| `src/shared/` | 依存される型・定義 | `Evidence`/`CandidateV2`/`OperationId`/`Observation`などの契約 | 共通TypeScript型 |

**補足**：`native-helper/Core`（C#の観測・候補管理）と`src/core`（製品側の採用・状態管理）は**別のCore**である。後者はWin32 APIを直接呼ばない。

## 2. C# フォルダ別の目的

| フォルダ | 主な責務 | 代表的なファイル |
| --- | --- | --- |
| `Core/` | Hookの統括、入力・窓状態の関連付け、候補形式化、プロセスのstdio制御 | `Observer.cs`、`CandidateTracker.cs`、`CandidateProtocol.cs`、`ObserverHost.cs` |
| `Platform/` | Win32 P/Invoke・定数・構造体、モニター・表示環境の照会、OS設定値の読取 | `NativeMethods.cs`、`DisplayContext.cs`、`WindowDockSettings.cs` |
| `Window/` | 通常ウィンドウの対象判定・タイトルバーの解釈、配置・移動・切替・閉じるの判定と証拠 | `WindowTargetPolicy.cs`、`WindowCaption.cs`、`PlacementPolicy.cs`、`WindowSwitchObserver.cs`、`WindowCloseObserver.cs` 等 |
| `Taskbar/` | タスクバーの候補slot・スナップショット・クリック／Win+数字の検証 | `TaskbarInputObserver.cs`、`TaskbarInputPolicy.cs`、`TaskbarQuery.cs` |
| `Snap/` | Snap Layout呼び出しについての既存実装コード（初回対象外） | `SnapInvocationObserver.cs`、`SnapInvocationPolicy.cs` |

分類は**名前のフォルダ単位**であり、依存が一方向とは限らない。実際に`Core/Observer`は`Platform`、`Window`、`Taskbar`を横断して参照する。

## 3. Native：制御・共通処理

| コンポーネント | 入力 | 出力・呼出し先 | 所有する状態 / 特徴 |
| --- | --- | --- | --- |
| `Program.cs` | CLIモード | `ObserverHost.Run/SelfTest`等の開始 | エントリーポイント |
| `ObserverHost.cs` | `stdin`のstart/stop/shutdown・fixture系コマンド、表示設定イベント、Observerからの通知オブジェクト | `Observer`のライフサイクル制御、`JsonSerializer.Serialize`＋`Console.WriteLine` | Windows Formsメッセージループ、受信コマンドのdispatch、出力ロック |
| `Observer.cs` | `OnMouse`/`OnKey`/`OnEvent`へのOS callback、timer | 各Tracker/Observer/Policyのメソッド呼出し、戻り候補を`CandidateProtocol`へ渡す | Hook・epoch・状態キャッシュ`states`・クリック対象解析・候補の競合取消・50msタイマー |
| `CandidateTracker.cs` | マウス/キーイベントに由来する対象・開始時状態・経過時間・foreground・状態変化 | `WindowCandidate`/`PlacementResult`/`CompoundMoveResult`または`null`（Observerが送信） | `input`/`dragPress`/`drags`/`winUp`/`completedWinDown`等、`PlacementPolicy`、transaction連番、入力・ドラッグ進行状態 |
| `CandidateProtocol.cs` | 専用ObserverやTrackerの候補結果（`WindowCandidate`、`...Evidence`等）、generation、transaction | `CandidateEnvelope`を`emit` callbackに渡す | generation・送信sequence・**候補発行を直列化する`gate`**。JSONLの標準出力書込を保護する`outputLock`は`ObserverHost`が所有する。種別別の`Switch/Close/Taskbar/Placement/CaptionClick/Compound/Complete`等の公開メソッド |

参照：[Observer](https://github.com/YutoMatsui21/shortcut-expert/blob/29bd044be4dc7d71e38179d556d6a272787fe949/native-helper/Core/Observer.cs#L7-L65)、[Tracker](https://github.com/YutoMatsui21/shortcut-expert/blob/29bd044be4dc7d71e38179d556d6a272787fe949/native-helper/Core/CandidateTracker.cs#L38-L147)、[Protocol](https://github.com/YutoMatsui21/shortcut-expert/blob/29bd044be4dc7d71e38179d556d6a272787fe949/native-helper/Core/CandidateProtocol.cs#L120-L190)、[Host](https://github.com/YutoMatsui21/shortcut-expert/blob/29bd044be4dc7d71e38179d556d6a272787fe949/native-helper/Core/ObserverHost.cs#L32-L192)。

## 4. Native：操作別の観測・状態・Policy

| コンポーネント | 入力 | 出力・呼出し先 | 保持する状態・境界 |
| --- | --- | --- | --- |
| `WindowSwitchObserver.cs` | Observerからのマウス/キー/foreground、timer、現在の対象窓・切替UI情報 | `WindowSwitchPolicy`の判定、成立時に**直接**`protocol.Switch` | 自身がタイマー・対象読取・一時マウス状態等を所有 |
| `WindowSwitchPolicy.cs` | 入力キー・押下順・foregroundの変化、イベントtick、現在窓 | `SwitchCompletion`または`null` | `before`/`target`/`confirmed`、Alt+Tab系列、解放・待機・取消状態。**状態を持つPolicy** |
| `WindowCloseObserver.cs` | マウス/キー/`OnEvent`、窓の存続・破棄/非表示、timer | `WindowClosePolicy`の判定、成立時に**直接**`protocol.Close` | 閉じる対象のWin32読取とpolling |
| `WindowClosePolicy.cs` | Alt+F4または閉じるボタンの入力、対象窓、後続ライフサイクル | `CloseCompletion`または`null` | 対象の同一性、押下/解放、破棄待ち、取消期限。**状態を持つPolicy** |
| `InactiveCaptionPolicy.cs` | 非アクティブ窓のcaptionクリック、foreground・window状態・時間 | `CaptionClickEvidence`または`null`（Observerが送信） | 対象/開始状態/押下時刻/解放/切替/終状態を保持。**状態を持つPolicy** |
| `PlacementPolicy.cs` | Win+方向キー系列、前後`WindowState`・入力フラグ | `PlacementResult`または`null`（CandidateTrackerが受取りObserverへ） | `series`/押下キー/取消フラグを保持。**状態を持つPolicy** |
| `PlacementGeometry`（同ファイル） | 窓frame、作業領域、dpi、離した座標、閾値 | half/quarterなどの幾何学的`shape`、`PlacementEvidence`、互換性判定 | static関数群。OS幾何と操作の形状表現が接する |
| `TaskbarInputObserver.cs` | マウス・Win+数字入力、taskbar snapshot、timer | `TaskbarKeys`、`TaskbarConfirmation`を用い**直接**`protocol.Taskbar` | snapshot・非同期照会・確認待ち候補・timer |
| `TaskbarInputPolicy.cs` | キー系列・slot・snapshot・時刻 | スロット番号・`TaskbarPending`・確認結果 | `TaskbarKeys`と`TaskbarConfirmation`は状態を保持 |
| `TaskbarQuery.cs` | UIA/タスクバー情報の問い合わせ | `TaskbarSnapshot` | worker・問い合わせ寿命・故障対応 |
| `SnapInvocationObserver/Policy.cs` | Win+Z・最大化ボタンhover等、Snap設定 | `protocol.Invocation`用の結果を生成できる実装 | **基準コミットのObserverに接続されていない**。初回公開対象の経路ではない |

参照：[WindowSwitchObserver](https://github.com/YutoMatsui21/shortcut-expert/blob/29bd044be4dc7d71e38179d556d6a272787fe949/native-helper/Window/WindowSwitchObserver.cs)、[WindowSwitchPolicy](https://github.com/YutoMatsui21/shortcut-expert/blob/29bd044be4dc7d71e38179d556d6a272787fe949/native-helper/Window/WindowSwitchPolicy.cs)、[WindowCloseObserver](https://github.com/YutoMatsui21/shortcut-expert/blob/29bd044be4dc7d71e38179d556d6a272787fe949/native-helper/Window/WindowCloseObserver.cs)、[WindowClosePolicy](https://github.com/YutoMatsui21/shortcut-expert/blob/29bd044be4dc7d71e38179d556d6a272787fe949/native-helper/Window/WindowClosePolicy.cs)、[PlacementPolicy](https://github.com/YutoMatsui21/shortcut-expert/blob/29bd044be4dc7d71e38179d556d6a272787fe949/native-helper/Window/PlacementPolicy.cs)、[TaskbarInputObserver](https://github.com/YutoMatsui21/shortcut-expert/blob/29bd044be4dc7d71e38179d556d6a272787fe949/native-helper/Taskbar/TaskbarInputObserver.cs)。

## 5. Native：プラットフォーム・補助判定

| ファイル | 入力 → 出力 | 役割 |
| --- | --- | --- |
| `Platform/NativeMethods.cs` | C#引数 → Win32 APIの戻り値/イベントcallback | P/Invoke定義、定数、Win32構造体。イベントの監視登録自体は`Observer.cs` |
| `Platform/DisplayContext.cs` | 窓・モニター情報 → `MonitorBounds`等 | ディスプレイ配置・モニター情報を取得 |
| `Platform/WindowDockSettings.cs` | Windows設定 → マウスdock閾値 | 環境依存設定の読取 |
| `Window/WindowTargetPolicy.cs` | process/style/class/可視性など → 対象可否 | 対象窓のフィルタリング。OSの識別条件と対象範囲のポリシーが接する |
| `Window/WindowCaption.cs` | マウス位置・窓情報 → caption・各標準ボタンの識別 | 非クライアント領域・hit test等 |
| `Window/MonitorMovePolicy.cs` | monitorの配置 → 移動レイアウト条件 | monitor幾何の静的判定 |
| `Window/WindowDiagnostics.cs` | 観測診断理由 → 集計等 | 診断用情報。通常のCandidateとは別経路 |

## 6. TypeScript：受信から採用まで

| コンポーネント | 入力 | 出力 | 状態 |
| --- | --- | --- | --- |
| `src/main/observer.ts`：`ObserverClient` | helper子プロセスstdoutの1行JSON・各種制御要求 | `candidateV2`で検証した`ObserverCandidate`のcallback、異常通知 | child/generation/requestId、行バッファ、ready、故障・リクエスト待ち |
| `src/shared/coach.ts` | ―（型定義） | `Evidence`/`CandidateV2`/`ObserverCandidate`/`Observation`等 | なし |
| `src/main/coach-app.ts` | ObserverClientのcallback | `coach.accept(candidate)` | Electron全体の組立・観測/表示等の制御 |
| `src/core/durable-coach.ts` | 検証済みCandidate、観測・設定・保存状態 | `classifyGesture`呼出し、書込と通知要求 | serial queue、観測世代、sequence、処理済みtransaction、学習状態 |
| `src/core/detector.ts` | Candidate + `evidence.kind` | `Observation[]`（W ID・origin・shortcut等） | stateless関数（`classifyGesture`/`classify`/`classifyWindow`） |

参照：[ObserverClient](https://github.com/YutoMatsui21/shortcut-expert/blob/29bd044be4dc7d71e38179d556d6a272787fe949/src/main/observer.ts#L442-L700)、[Core採用](https://github.com/YutoMatsui21/shortcut-expert/blob/29bd044be4dc7d71e38179d556d6a272787fe949/src/core/detector.ts)、[DurableCoach](https://github.com/YutoMatsui21/shortcut-expert/blob/29bd044be4dc7d71e38179d556d6a272787fe949/src/core/durable-coach.ts#L446-L545)。

## 7. 読み違えやすい点

- `Observer.cs` は単なるイベント配信器**ではない**。対象窓の読取・hit test・状態キャッシュ・他の候補の取消・戻り値種別による送信分岐まで担う。
- 名前が`Policy`でも必ずしも純粋関数ではない。`PlacementPolicy`、`WindowSwitchPolicy`、`WindowClosePolicy`、`InactiveCaptionPolicy` は一時状態を持つ。
- `CandidateTracker` が全候補を一元管理しているわけではない。切替・閉じる・タスクバーには独立した候補管理がある。
- `CandidateProtocol` は単なるJSON serializerではない。出力のsequence・generation・envelope化を担う。JSONへの変換と`stdout`書込は`ObserverHost.Emit`。
- `src/core/detector.ts` はマウス/キーの生イベントから時間相関を復元しない。**証拠を含むCandidateの製品上の採用条件**を判断している。
