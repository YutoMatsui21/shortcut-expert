# 現在の検出アーキテクチャ

**これは現行実装の説明**。リファクタリング後の設計ではない。構造は2026-11-06の[コード](https://github.com/YutoMatsui21/shortcut-expert/tree/c1203ec79cf0976a2dad1e65b8c2451fcbe14ef7)で確認した。変更後の実態はコードで再確認する。

## 処理の全体像

```mermaid
flowchart TD
    OS["Windows API<br/>マウス・キー・WinEvent"]
    OBS["Observer.cs<br/>Hook、窓状態取得、処理の振分け"]
    TRACK["CandidateTracker<br/>最大化・配置・ドラッグなど"]
    OTHER["操作別Observer / Policy<br/>切替・閉じる・タスクバー等"]
    PROTO["CandidateProtocol<br/>Evidence → CandidateEnvelope v2"]
    HOST["ObserverHost<br/>JSON Lines / stdout"]
    MAIN["src/main/observer.ts<br/>JSON検証・Candidate受信"]
    COACH["DurableCoach<br/>世代・順序・重複の確認"]
    DET["detector.ts<br/>Evidence → Observation[]"]
    SAVE["SQLite記録 → 適格なら通知"]
    OS --> OBS
    OBS --> TRACK
    OBS --> OTHER
    TRACK -->|"Observerが結果を送る"| PROTO
    OTHER -->|"一部は直接送る"| PROTO
    PROTO --> HOST --> MAIN --> COACH --> DET --> COACH --> SAVE
```

**C#からTypeScriptへ送っているのは生のOSイベントではなく、入力と結果を照合したCandidate**。1行につき1つのJSONオブジェクトを標準出力に送る（ディスク上にJSONLファイルを作るわけではない）。

## 各コンポーネントの入力・出力

| 現行コンポーネント            | 入力                                                                                                                       | 出力・役割                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Observer.cs`                 | `OnMouse`（低レベルマウス）、`OnKey`（低レベルキー）、`OnEvent`（foreground／位置／移動開始・終了／最小化／破棄等）、timer | Win32で窓状態・押下対象等を読み、各Tracker/Observer/Policyの**具体的なメソッドを順序付きで呼ぶ**。状態キャッシュも保持 |
| `CandidateTracker.cs`         | 入力、押下時の窓状態、WinEventによる状態変化・経過時間                                                                     | `WindowCandidate`／`PlacementResult`／`CompoundMoveResult`。最大化・復元／最小化、配置、ドラッグ・画面移動の候補       |
| `WindowSwitchObserver/Policy` | キー・クリック・foreground・timer                                                                                          | 切替が成立すれば`protocol.Switch`                                                                                      |
| `WindowCloseObserver/Policy`  | 閉じる入力・窓の存続/DESTROY・timer                                                                                        | 閉じる確証があれば`protocol.Close`                                                                                     |
| `TaskbarInputObserver`等      | タスクバークリック／Win+数字・UIA snapshot・非同期確認                                                                     | `protocol.Taskbar`                                                                                                     |
| `InactiveCaptionPolicy`       | 非アクティブ窓クリック・foreground・最終窓状態                                                                             | `Observer`のtimer経由で`protocol.CaptionClick`                                                                         |
| `CandidateProtocol.cs`        | 上記の各種候補結果                                                                                                         | Evidenceを含むv2 `CandidateEnvelope`、generation・sequence・発行順（`gate`）                                           |
| `ObserverHost.cs`             | Envelope・制御コマンド                                                                                                     | JSON直列化とstdoutへの書込み（`outputLock`）                                                                           |
| `src/main/observer.ts`        | helperのstdout行                                                                                                           | `candidateV2`で形式を検証した`ObserverCandidate`                                                                       |
| `src/core/durable-coach.ts`   | 検証済みCandidate                                                                                                          | generation／sequence／transactionの重複を確認し、分類後の原子保存・通知判定                                            |
| `src/core/detector.ts`        | Candidateと`evidence.kind`                                                                                                 | 0～2件の`Observation`（操作ID、入力由来、案内キー等）                                                                  |

C#側の`WindowCandidate`内部に古い`protocolVersion=1`表記があっても、外部送信前に`CandidateProtocol`が**v2へ変換する**。この内部型と通信形式を混同しない。

## どこで状態を保持しているか

| 状態                                                            | 現在の所有者                                              |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| Hook、窓状態のキャッシュ、入力ルーティング・取消順序、50ms poll | `Observer`                                                |
| 入力／ドラッグ／Win+↑・↓の候補、配置シリーズ、transaction採番   | `CandidateTracker`（配置は`PlacementPolicy`も状態を持つ） |
| 背後窓captionのクリック候補                                     | `InactiveCaptionPolicy`                                   |
| 切替・閉じる・タスクバーの候補、専用timer/worker                | 各専用Observer／Policy                                    |
| generation、送信sequence、Envelopeの発行                        | `CandidateProtocol`                                       |
| stdout書込・helperの起動制御                                    | `ObserverHost`                                            |
| 子プロセス、行バッファ                                          | `ObserverClient`                                          |
| 再配送排除、記録、通知の適格性                                  | `DurableCoach`                                            |

## 機能追加時に変更が広がりやすい理由

- **Observerが個別実装を知る**：`tracker.Complete/FinishMove`など、操作ごとに呼出し条件・戻り値別のProtocol呼出しがある。
- **Trackerの責務が広い**：最大化・キー系列・ドラッグ・配置が押下/取消状態を共有している。
- **競合処理が分散**：通常切替・背後窓caption・ドラッグ・タスクバーは、`Observer`が特定順でCancel/抑制する。
- **候補の出口が複数**：Trackerの戻り値はObserverが送る一方、専用Observerの一部はProtocolを直接呼ぶ。
- **TSの分類が集中**：`classifyGesture`の内部でEvidence種別により分岐する。

ただし、これらが**直ちに不具合であるという意味ではない**。特に既存の競合・取消順序には誤採用防止の理由がある。目的は振る舞いを変えずに変更箇所を局所化すること。

## 現行で注意が必要な操作

- **非アクティブcaptionクリック**：ボタン不明時は通常のドラッグ候補と**並行追跡**でき、`MOVESIZESTART`ではクリック候補を取り消す。単純な先着専有ではない。
- **複合ドラッグ**：画面移動＋最大化／四隅は**1つのCandidateから2つのObservation**を生成し、中間の復元等を別計上しない。
- **Win+数字**：タスクバー候補の経路を優先し、通常切替へ二重計上しない。
- **確証のない案内**：操作の記録と、等価なショートカットの案内は別判定。特にW02は移動が確証済みなら方向不明でも記録し、キー案内を`null`にできる。

操作の具体的な成立条件は[操作別設計](../../operations/README.md)を正本とする。

→ **新しい構成は[目標アーキテクチャ](target.md)**。
