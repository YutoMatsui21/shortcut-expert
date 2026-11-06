# リファクタリングの実装計画

**目標**：既存の動作を変えず、[目標アーキテクチャ](target.md)へ段階的に移行する。**この文書は実装順序と完了条件を決める仕様であり、まだ実装済みという意味ではない**。各段階をCodexへ任せるIssueの範囲・依存関係は別途決める。

## 進める順番

| 順番 | 作業 | 終了条件 |
| --- | --- | --- |
| **1. テスト基準の固定** | [回帰条件](verification.md)を既存テストと照合。**配送/競合**・**全Candidate出口**の不足ケースを先に追加 | 本番の検出・分類経路に対する比較可能な入力列と、変更前の期待値がある |
| **2. Candidate出力の統一** | `CandidateDraft`／`ICandidateSink`を導入し、Tracker戻り値と専用Observerからの候補を共通の送信窓口へ寄せる | すべての**外部v2 JSONL**が変更前と同等。既存`CandidateProtocol.gate`・`ObserverHost.outputLock`を維持 |
| **3. transaction採番の分離** | `DetectionSession`／`ITransactionIds`へ統一。`NextTransaction`だけでなく、Tracker内の直接`++transaction`、配置・専用Observerの全callbackを移す | 同一generation内で衝突なし、取消による欠番は許容、旧世代無効化・重複排除が不変 |
| **4. Handlerの境界を作る** | `WindowGesture`にTracker/Placementの共通状態を閉じ込め、InactiveCaption・Switch・Close・Taskbarの専用Observerを`IEvidenceHandler`へ適合。必要な`WindowFacts`抽出 | Handlerごとのpending・timeoutが独立。**旧Observerの配信順は暫定互換コードで残してよい**。JSONLと操作結果は変更しない |
| **5. Router/調停へ切替** | `DetectionComposition`で登録し、`DetectionRouter`＋`ArbitrationPolicy`へ配信・Cancelを移す。専用timer/workerの結果もRouterを通す | **本番配送経路の競合回帰とstop/再起動の寿命テストが合格**。Observerから操作固有の呼び出しを除去。複合候補は単一Handlerが所有 |
| **6. TypeScript Classifierを分割** | `classifyGesture`を公開入口として残し、Evidence種別ごとの純粋な分類関数へ抽出 | 同じCandidateで0～2件のObservation、W ID、shortcut、保存・通知結果が一致する |
| **7. 仕上げ・拡張性の検証** | 一時的な互換コード/重複配信を除去し、実装・型・docs・テストを照合 | 既存Handlerを変更せず**新Handlerの登録だけで独立した検出経路を追加できる**。Windows CI・必要な自然入力受入を記録 |

**途中で意味を変えない**。Win+↓連続の統合、ウィンドウ対象の除外条件、既存protocol v2、検出対象8操作、複合0～2件の計数、通知条件は据え置く。製品上の意味を移動する必要が生じたら**別の仕様変更**として扱う。

## 変更先の目安

```text
native-helper/
  Core/
    Observer.cs                  # OSイベント取得に専念
    CandidateProtocol.cs         # v2 Envelope・generation/sequence
    ObserverHost.cs              # stdio・message loop
    Detection/
      DetectionComposition.cs    # 登録の唯一の場所
      DetectionRouter.cs         # 同期配送
      ArbitrationPolicy.cs       # 操作間の調停
      DetectionContracts.cs      # Handler/Context/Sink interface
      DetectionSession.cs        # 世代とtransaction採番
      CandidateDraft.cs          # Evidenceを持つ内部候補と送信アダプタ
      ObservedEvent.cs           # C#内の観測イベント
  Platform/
    WindowFacts.cs               # Win32照会・window snapshotの境界
  Window/
    WindowGestureHandler.cs      # CandidateTrackerを包むFacade
    InactiveCaptionHandler.cs    # InactiveCaptionPolicyを包む
    WindowSwitchObserver.cs      # 既存の専用実装を適合
    WindowCloseObserver.cs
  Taskbar/
    TaskbarInputObserver.cs

src/core/
  detector.ts                    # classifyGesture互換入口
  detection/                     # Evidence種別ごとの純粋関数
```

上記は**責務の配置目安**。ファイルの新設数を目標にせず、既存クラスを適合させる方法も許容する。**WindowGesture内部のWindowState・Drag・Placementを最初から独立した3Handlerにすることは必須にしない**。

## 実装中に迷わないためのルール

1. **共通インターフェースを導入しただけでは完成ではない**。Dispatcher（Router）は配信、ArbitrationPolicyは競合・Cancel・発行許可という別の責務を持つ。
2. 1イベント内の配信は**1アクションごとにHandler状態を再評価**する。既存の優先順序を無条件fan-outへ置き換えない。非アクティブcaption fallbackとドラッグの**並行追跡**を維持する。
3. **同一ジェスチャの最終Candidateは1つ**。W01＋W03/W04はInactiveCaption、W02＋W03/W07はWindowGestureが作る。TSへ分割送信して組み立てない。
4. 個別Handlerは自身のpendingを所有し、共有sessionはIDと世代を管理。**すべての入力・ドラッグ・配置状態をグローバルCoordinatorへ統合しない**。
5. Win32の照会は必要時だけ行う。押下時と確定時のsnapshotを区別し、Hook callbackに重いUIA処理を追加しない。既存の50ms timerやTaskbar workerを不用意に一つに統合しない。
6. 不確実な結果・古いgeneration・不一致対象ではfail closed。失敗した回帰テストの期待値を、設計に合わせて緩めない。
7. **C#の生JSONLを直接検証**。TS parserが未知フィールドを捨てても機密情報の送信が許されるわけではない。

## 完了時に確認すること

- **拡張性**：独立した新操作を仮追加し、Observer・既存の他操作Handlerへの変更を必要としない。変更はHandler＋登録＋必要なTS分類・型・テストに収まる。**他操作と競合する場合はArbitrationPolicyの交差ルール追加を許容**。
- **互換性**：Native Candidateの証拠・route・発行順、TS Observation、SQLite原子保存・通知要求が変更前後で一致。transactionの絶対的な番号は一致不要だが、世代内の一意性と重複防止は必須。
- **検証**：各変更PRで[回帰条件](verification.md)に該当する既存・追加テストを実行。配信/非同期の変更では本番経路を使った回帰を必須とする。CI通過と実Windows自然入力の確認を区別する。
- **変更を止める条件**：候補が二重発行される、旧世代が復活する、v2 schemaが変わる、保存/通知の振る舞いが変わる、禁止データが送信される、または既存の回帰期待値を説明なく変更する必要が出た場合。

この計画を**実装Issueへ分割する前に読む正本**とする。詳しい操作成立条件は[操作別設計](../../operations/README.md)、全体の品質要件は[製品要件](../../ui-requirements.md)に従う。
