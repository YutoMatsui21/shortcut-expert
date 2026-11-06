# 12 実装段階の切替条件・回帰ゲート（Issue分割前の仕様）

> **状態：設計判断を確定（実装未着手）**。[10 目標構成](10-architecture-decisions.md)、[11 配送・調停契約](11-routing-and-ownership.md)を、Codexが後から実装できる粒度の**安全な移行順序・受入基準**へ変換したもの。**ここではIssue作成やリファクタリングの実装を行わない**。

## 1. 移行順序を確定

| Gate | コード上の変更範囲（概念） | 前提 | 段階終了時に必須の条件 |
| --- | --- | --- | --- |
| **G0 回帰基準の固定** | テストのみ | 既存の[07 R01–R19](07-regression-contract.md)、[08 G01–G07](08-test-coverage.md)を参照 | C#本番Policy→v2候補→TS parse→Observation・SQLiteの現行サンプルを維持する。配信経路テストの導入に必要な**本番Routerの抽出方法**を確定。現在Observerのprivate Win32 callbackをfakeの別実装で代用して「本番を保証した」と主張しない |
| **G1 Nativeの候補出力境界** | 共通`CandidateDraft`、`ICandidateSink`、`CandidateProtocol`への適合adapter。各専用Observerはまだ従来呼出しを維持可 | G0で[08 G02](08-test-coverage.md)候補出口ごとの互換試験を確認/補強 | 出力するv2 JSONの`type/protocolVersion/generation/sequence/transaction/date/origin/route/evidence`が同等、許可済みfieldのみ、記録/通知件数不変。`CandidateProtocol.gate`、`ObserverHost.outputLock`は分離維持 |
| **G2 共通transactionの所有変更** | `DetectionSession`／`ITransactionIds`＋全`CandidateTracker`内の直接`++transaction`、`PlacementPolicy` callback、専用Observerのdelegateの置換 | G1、C#全候補出口のtransaction試験 | **同一世代でID重複なし・確定候補は一意・取消した候補の欠番許容**。start/stopの世代境界、TS側の4096幅の再送対策の意味が不変。改修で発番タイミングが変わるなら、絶対数値ではなく発番の一意性・候補対応・順序を評価し、理由をPRに残す |
| **G3 Nativeの責務分離** | `WindowGestureHandler`を`CandidateTracker`の入口として適合、`InactiveCaption`／`WindowSwitch`／`WindowClose`／`Taskbar`をそれぞれ`IEvidenceHandler`へ適合。`WindowFacts`のOS read境界を抽出 | G1/G2と[08 G01](08-test-coverage.md)の基準操作列 | すべてのHandlerが自己のpendingだけを保有。**元のプロトコルはまだ変えない**。Win+↑、Win+↓連続、caption fallback、drag→placement、taskbar非同期等の証拠が一致。**必要に応じて現在のObserverの順序を互換adapterに残してよい** |
| **G4 Router/Arbitrationへ切替** | Observerから操作別の直呼びを外す。`DetectionComposition`でRouterとHandlerを登録。現在の順序を`ArbitrationPolicy`へ移す。各Handlerのtimer結果をRouterに戻す | **G01・G02が本番配送/候補経路でPASS**、timer・workerの所有変更時には**G03もP0でPASS** | [11 配信表](11-routing-and-ownership.md)の全交差が保持され、複合Candidateは単一Handler所有、W12→W01重複なし、Win+↓統合・復元派生なし。**旧Observerの操作固有分岐を削除できる**。人工イベント列テストは実装した本番Routerを駆動する |
| **G5 TypeScript Classifier分割** | `src/core/detector.ts`の`evidence.kind`ごとの処理を別の純粋関数ファイルへ移動し、共通`classifyGesture`入口を維持 | G4とは独立実行も可。既存TS unit/Native連結テスト | `Observation[]`、`W ID`、`shortcut=null`時の記録、複合0～2件の採用と順序が一致。`DurableCoach`・`shared/coach.ts`・`candidateV2`のwire契約と永続化を変更しない |
| **G6 最終照合・クリーンアップ** | 一時compatibility adapterや重複したobserver直呼び・不要フィールドを削除。ただし必要な互換層は残す | G0～G5の該当部分PASS | Observerが具体的なHandler型や`FinishMove/Complete/Switch`等の**操作別メソッドを参照しない**。Handler登録は`DetectionComposition`に集約。全Native/TS/IPC/SQLite・配布smokeと必要な実機確認を報告。新操作追加の変更波及を`G04`で実測・記録 |

**この順は実装の依存方向**であり、そのまま「Gate＝1 Issue」とする指示ではない。複数の小さなIssueへ分割することはStep 4で行う。**G1/G2で内部型だけ導入し、同時にOSイベント配信と製品判定まで変更しない**。

## 2. 具体的な新しいファイル/責務の配置（命名候補をここで固定）

**Native候補構成**：

```text
native-helper/
  Core/
    Observer.cs                     # HookとWin32イベントのAdapter
    ObserverHost.cs                 # stdioとmessage loop
    CandidateProtocol.cs            # v2 Envelope、sequence、generation
    Detection/
      DetectionComposition.cs       # Handler登録と依存注入（1箇所）
      DetectionRouter.cs            # 同期イベント配信
      ArbitrationPolicy.cs          # Handler間の専有・取消・許可
      DetectionContracts.cs         # IEvidenceHandler / IDetectionContext等
      DetectionSession.cs           # generation / transaction採番
      CandidateDraft.cs             # 内部候補の共通レコードとSink adapter
      ObservedEvent.cs              # C#内部だけのOS観測イベント
  Platform/
    WindowFacts.cs                  # 窓read/cache/hit testの境界
  Window/
    WindowGestureHandler.cs         # CandidateTracker/PlacementのFacade
    InactiveCaptionHandler.cs       # 既存PolicyのFacade
    WindowSwitchObserver.cs         # 既存資産をHandler契約に適合
    WindowCloseObserver.cs
  Taskbar/
    TaskbarInputObserver.cs         # 既存資産をHandler契約に適合

src/core/
  detector.ts                       # classifyGesture互換入口
  detection/
    window.ts                       # window系Evidence
    placement.ts                    # placement系Evidence
    switch.ts                       # window-switch/close系Evidence
    taskbar.ts                      # taskbar系Evidence
    compound.ts                     # caption-click / compound-drag
```

**配置はファイルを新設する目的ではなく、責務の検索性を高めるための目標**。既存`CandidateTracker.cs`/`PlacementPolicy.cs`/専用Observer等を削除するかどうかはG6で用途を確認する。window handlerが内部のCandidateTrackerを使うことはG3時点で許容。テストファイル配置は既存`tests/native/policy/`、`tests/operations/`の規則に従う。不要な抽象化・ファイルを増やさない。

## 3. before / afterの比較ルール

**構造変更前後で同じ人工イベント列を与えたときの比較対象**：

- Nativeで**確定したCandidate数と`evidence.kind`、各Evidenceの検証値、origin、route、date、注入・競合フラグ、候補確定順序**が一致する。
- CandidateEnvelopeの`generation`/`sequence`は現行の世代境界・**確定送信順の単調性と連番**を維持。`transaction`は**同一世代での一意性・Candidateとgestureの対応・再送抑止**を守る。競合候補の採番順が変わった場合、**絶対的なtransaction番号の一致は必須としない**（変わった理由と期待する重複防止は明記）。
- `DateTime.Now`の現行の採取時点（mouse onset / callback時点 / timer確定時点等）と表す**ローカル日付**は維持。テスト内の時刻・timezone差を「整形」として無条件に削除しない。
- TypeScript側の`candidateV2`受信結果、`classifyGesture`のW ID／origin／shortcut／順序、`DurableCoach`のSQLiteカウント・失敗時rollback、通知要求の**件数・行・順序**が一致する。
- 旧revision/別buildの自然入力成功を新buildの成功とみなさない。**Windows Hookの実効性と独自caption/多画面/DPI/通知表示は、必要に応じて本人同意の実機受入**で確認。
- protocol v2の`JsonPolymorphic(typeof(Evidence))`由来の`kind`、`profile`の値、必須/許可フィールドを変えない。TS parserは未知fieldを投影して捨てるため、**Nativeが出す生のJSON Linesにも禁止情報がないか直接検査**する。

## 4. Gateごとの失敗条件（自動停止ライン）

1. **前ゲートの対象回帰が通らない**：原因未確定のまま次のGateに進まない。回帰期待値を新実装へ合わせて緩めない。
2. **同じジェスチャで2 Candidateを発行した**：たとえTSが後続を重複排除して件数が合っていても**Native出力の互換性違反**。元の取消・所有を修正する。
3. **既存のwindow-switch/close/taskbarのtimer/workerの所有が不明**：対応するG03の寿命/旧世代を固定してから変更。
4. **無関係なWindow Handlerが、テキスト操作・タスクバーの新実装のために変更を要求される**：共通イベント/契約の境界が崩れていないか見直す。
5. **機密情報・生入力がCandidateDraftやJSONLへ入った**：設計違反として修正する。`ObservedEvent`がNative内で必要最小限の生情報を使うこととは区別。
6. **Detectorの分類を変更しないとNativeの構造リファクタが通らない**：候補出力の意味を意図せず変更している疑い。仕様変更なら別の案件へ切り離す。

## 5. 完了判定（拡張性の評価）

**合格条件**：

- 独立した新Handlerの登録に、Observerや既存Handler内の操作固有分岐の修正が不要（`DetectionComposition`と新Handlerの追加、必要なTS型/Classifierは許容）。
- 他操作との競合がある新機能だけ、単一`ArbitrationPolicy`に新交差ルールを追加。**競合規則を各Handlerに散らさない**。
- 原則 **1gesture→1CandidateEnvelope→0～2 Observation**、複合操作の原子保存を維持。
- G01～G06の影響範囲、Windows CI、必要に応じる実機確認が行われたこと。**テスト未実行をPASS扱いにしない**。
- 変更範囲を`docs/research/detection-architecture/`の目標と比較し、プロトコル・通知・記録など実際の製品仕様への変更がゼロであること。

**Step 4へ渡すもの**：このGate表、[10 D01〜D14](10-architecture-decisions.md)、[11 配送・調停契約](11-routing-and-ownership.md)、[07 回帰条件](07-regression-contract.md)、[08 テスト対応表](08-test-coverage.md)。**この時点では実装Issueをまだ作成しない**。
