# 11 配送・調停・複合候補の具体契約

> **設計決定**。[10 目標構成の確定判断](10-architecture-decisions.md) D02〜D10の詳細。ここは従来の[05 擬似API](05-contracts-and-state.md)の**未確定箇所を具体化する後継資料**。型名・C#構文は実装用のモデルであり、APIの小さな命名変更は可。**順序・所有・出力境界**は変更不可。

## 1. 登録するHandlerと所有する状態

| Handler ID（固定登録名の例） | 包含する現行コード | 専用状態 | 出力の責任 |
| --- | --- | --- | --- |
| `window-gesture` | `CandidateTracker`と`PlacementPolicy`/Geometry | 入力候補、Win+↑/↓、ドラッグ、半分/四隅、monitor移動、確定待ち | 通常`window`・`placement`・**複合`compound-drag`** |
| `inactive-caption` | `InactiveCaptionPolicy` | 背後窓の押下、ボタン既知/不明`Fallback`、解放、foreground、終状態 | **`caption-click`（W01＋W03/W04を含む）** |
| `window-switch` | `WindowSwitchObserver/Policy` | Alt+Tab系列、直接クリック、切替settle | 通常`window-switch` |
| `window-close` | `WindowCloseObserver/Policy` | Alt+F4/閉じるボタン、DESTROY/消滅確認 | `window-close` |
| `taskbar-input` | `TaskbarInputObserver/Keys/Confirmation/Query` | Win+数字、クリックslot、snapshot、非同期照会 | `taskbar-input` |

- **`window-gesture`は1つのHandler**。共有`input`/`dragPress`/`drags`/`Placement`を持つので、この段階で独立した最大化・ドラッグ・配置の3Handlerへ分離しない。内部の純粋判定関数・Policyは個別ファイルに分けてもよい。
- 既存の`SnapInvocationObserver/Policy`はソースに残しても、Dispatcherの本番登録対象には含めない。
- 既存の`WindowSwitchObserver`、`WindowCloseObserver`、`TaskbarInputObserver`のタイマー・OS問い合わせは、必要な範囲だけアダプタ化する。単にクラスを改名する必要はない。

## 2. コンポーネントの実行時インターフェース

次は**役割・呼出し方向を固定する疑似C#**。`HandlerResult`の実際の名前やenum実装は調整可。

```csharp
// Nativeプロセス内に閉じる。イベント由来の時点・対象はここで保持。
// 生キー列・生座標列等をCandidateDraftへコピーしない。
abstract record ObservedEvent(int Generation, long ObservedAtMs);
record MouseObserved(...) : ObservedEvent(...);
record KeyObserved(...) : ObservedEvent(...);
record WindowObserved(...) : ObservedEvent(...);
record TimerObserved(string HandlerId, ...) : ObservedEvent(...);
record DisplayChangedObserved(...) : ObservedEvent(...);

// 各Handlerは自身のpendingのみ所有する。
// 現在のClaim状況（Pending/Exclusive/Compatible/Fallback等）を外部へ
// 読み取り専用で公開し、別Handlerの状態を直接変更しない。
interface IEvidenceHandler
{
    string Id { get; }
    EventInterest Interests { get; }
    HandlerStatus Status { get; }
    HandlerResult Handle(ObservedEvent e, IDetectionContext context);
    void Cancel(CancelReason reason);
    void Reset(int generation);
}

// Proposalは後からRouterで許可確認し、確定後にSinkへ渡す。
record HandlerResult(
    ClaimTransition Claim,
    IReadOnlyList<CandidateDraft> Proposals
);

interface IArbitrationPolicy
{
    DispatchPlan Plan(
        ObservedEvent e,
        DispatchPhase phase,
        IReadOnlyDictionary<string, HandlerStatus> statuses
    );
    bool AllowPublish(
        string sourceHandler,
        CandidateDraft draft,
        IReadOnlyDictionary<string, HandlerStatus> statuses
    );
}

interface IDetectionContext
{
    IWindowFacts WindowFacts { get; }
    ITransactionIds Transactions { get; }
    int Generation { get; }
    long NowMs { get; }
}

// Wire型と分けるC#内部の共通Candidate提案。
// Evidenceは既存CandidateProtocol.csのpolymorphic recordを使用する。
record CandidateDraft(
    int Generation, int Transaction, string Date,
    string Origin, string Route,
    bool Injected, bool Conflicted, Evidence Evidence
);

interface ICandidateSink
{
    void Publish(CandidateDraft draft); // Routerで許可後、Protocolへ委譲
}
```

**動作契約**：

1. `Observer`がcallbackを受信して`ObservedEvent`へ変換する。OS読取は`IWindowFacts`に集約するが、**現状と同じ時点・順序**で必要時だけ照会する。
2. `DetectionRouter`はEventInterestの購読Handlerを取り出す。**並列実行せず同じmessage-loop thread上**で`ArbitrationPolicy.Plan`に従い、配信→状態確認→必要なCancel→次Handlerへの配信を段階的に行う。
3. `IEvidenceHandler.Handle`は自身のpending状態だけを更新し、`HandlerResult.Proposals`で`CandidateDraft`を提案する。**Handle内でProtocolやJSONLへ直接送信しない**。タイマーからの確定も同じRouterを経由する。
4. `ArbitrationPolicy.AllowPublish`が承認した提案だけを**元の確定順で**Sinkへ渡す。`AllowPublish`は提案に含まれる生の`HWND/PID/キー/座標`を要求してはならない。相関に必要な情報はHandler内に保持し、Routerの同一sessionで判断する。
5. `CandidateProtocol`は`CandidateEnvelope(v2)`へ変換し、generationと発行sequenceを検証・採番する（`gate`）。`ObserverHost.Emit`が独立した`outputLock`でJSONLを標準出力へ送る。停止・旧世代の提案は不採用。
6. **新規独立Handler**は`DetectionComposition`へ登録すれば対象イベントを受け取れる。既存Handlerへの横断的影響がある新操作だけは**ArbitrationPolicyへ明示的なルール追加が必要**。その変更は許されるが、既存Handlerのprivate状態へ直接アクセスさせない。

**処理結果**`ClaimTransition`は「このイベントでの候補開始／取消／確定」を宣言する値。**共有のClaimとPendingの二重管理**を増やさず、Routerが必要とする**最小限の処理状態（HandlerStatus）**だけを提供する。任意の`string`プロトコルを使わず、登録IDと定義済みClaim種別を型で検証する。実装名は変えてよいが「どのHandlerが何を所有し、他を取消できるか」を`ArbitrationPolicy`へ隠れた副作用なしで伝える。

### 調停で用いる状態とアクションの確定範囲

**実装する意味（列挙子名は変更可）**：

| 種類 | ケース | 動作 |
| --- | --- | --- |
| `HandlerStatus` | `None` / `SharedPending` / `ExclusivePending` / `Completed` | 他Handlerに見せる**現在の候補状態**。`SharedPending`は例外的な並行追跡（caption Fallback＋drag）を意味する。`ExclusivePending`でも配信全面停止を自動化せず、**Policyの許可した対象**だけを抑制 |
| `ClaimTransition` | `Unchanged` / `StartedShared` / `StartedExclusive` / `Yielded` / `Released` / `Completed` | `Handle`処理前後の所有権変化。`Yielded`はMOVESIZESTART等で別Handlerへ所有を移したことを示す。`Completed`には候補`Proposals`が付く |
| `DispatchStep` | `Deliver(handler)` / `Cancel(handler, reason)` / `Skip(handler)` | Routerが**順番通りに**実行するアクション。`Cancel`後はHandlerStatusを再取得 |
| `PublishDecision` | `Allow` / `Reject` | Source Handlerと提案・このイベントまでのClaim履歴から発行を許可。**同一gestureから別Handlerの部分候補が既に確定しているならReject** |

**評価順序**：`Plan(event, phase, statuses)` → DispatchStepを1つ実行 → `HandlerResult`と**更新された**HandlerStatusを反映 → **次のphaseを再評価** → 完了した候補を`AllowPublish`で審査してSinkへ発行。計画を**イベントの開始時に一度だけ計算し、古いsnapshotで最後まで配信することは禁止**。`ArbitrationPolicy`はHandlerのprivate状態を読まず、Handlerが公開する**限定した状態ビュー**だけを参照する。`ClaimTransition`はイベント固有の一時結果で、グローバルな入力ログを作らない。

**所有権とtransactionの区別**：HandlerStatus/ClaimはNative内部での候補の競合抑制を表す。`CandidateDraft.Transaction`は**確定した候補の識別子**であり、複数Handler間の入力専有ロックの代用には使わない。複数の仮候補が違うtransactionを採番していても、Policyは**配信・Claimの履歴**で余分な候補を拒否する。

## 3. 既存Observerの順序を再現する配信表

**重要**：全購読者へのfan-out／先着Handlerのexclusive獲得は禁止。次の**依存する順序**をRouter/Policyで再現する。

| イベント | 配信・抑制の順序（初期の構造変更で維持） |
| --- | --- |
| **マウスイベント、caption待機中** | 新しい左押下ならcaptionの保留を取消して通常経路へ。それ以外はcaptionへまず伝える。**既知ボタン**のcaption候補が確定待ちの間は後続の通常経路を抑制。**Fallback（ボタン不明）**なら通常WindowGestureへのドラッグ追跡を残し、captionが不成立・消滅した場合は必要に応じて`CancelMouseState`を行う |
| **通常マウス入力** | `WindowGesture.MouseMessage`の補助処理 → `Taskbar.Mouse` → `WindowSwitch.Mouse` → `WindowClose.Mouse` → WindowGestureの移動／解放処理。左押下では**既存キャッシュの有無・Win32 hit test・対象同一性**を確認し、条件が合えばInactiveCaptionを開始。成功なら`WindowSwitch.Cancel`と`WindowClose.Cancel`、既知ボタンではWindowGestureの入力を取消、Fallbackではドラッグのため残す。そうでなければWindowGestureへ入力を渡す |
| **キー入力** | `InactiveCaption.Cancel`、WindowGestureの不明マウスfallback取消 → `Taskbar.Key` → `WindowSwitch.Key` → `WindowClose.Key`。**Win+数字はTaskbar専属**でWindowGestureへ流さない。その他はWindowGestureのキー／解放処理へ渡す（Win+↑確定待ち、Win+↓連続、配置シリーズ等） |
| **Window foreground** | captionの対象・前景の判定 → `WindowClose.Event` → WindowGestureのforeground更新 → WindowSwitchのforeground確定 → WindowGestureの窓状態照合（caption対象のときは通常候補を抑制） |
| **MOVESIZESTART** | caption候補を取消（Fallbackドラッグへ譲る） → WindowCloseへイベント → WindowSwitchを取消 → WindowGestureのドラッグ開始処理。**ドラッグに由来する復元などを別Candidateとして出さない** |
| **MOVESIZEEND** | caption/close向けの必要な更新 → WindowGestureが終端証拠と配置・モニター移動を統合し**最大1つの最終CandidateDraft**を提案。**独立のWindowState候補を二重発行しない** |
| **DESTROY / MINIMIZE / LOCATIONCHANGE / その他WinEvent** | captionのState/Cancel → WindowCloseの破棄・保留処理 → 前景・window状態の整合・targetキャッシュ更新、WindowGesture候補確定。通常の`OBJID_WINDOW/CHILDID_SELF`判定と早期return条件を維持 |
| **各専用timer/async完了** | Win+↑/captionの既存50ms poll順、WindowSwitch/WindowCloseの50ms timer、Taskbarの照会worker完了・250ms間隔を維持。**既存のタイマーを一つの新しい定期ループへ統合しない**。callback時は`TimerObserved(HandlerId,Generation)`として同じRouterの候補提出経路へ戻す |
| **表示・設定変更** | 既存`Observer.InvalidateDisplay/RefreshDockThreshold`の取消対象とDock threshold cacheを保持。**無関係なWindowSwitch/Taskbar pendingを追加で取消さない** |
| **Stop / start** | Protocolが旧世代を拒否 → 既存timer・workerを止める/失効 → 各Handler Reset、状態cache破棄 → 新generationの登録。callback再入時・旧async結果の出力は禁止 |

ここで書いた**操作別の送信条件は既存Policyの正本に従う**。具体的なtimeoutやhit test条件を一律の共通値に置き換えない。

### 複合クリック・複合ドラッグの所有権

| ケース | 並行して追跡可能なもの | 最終的に送信できる所有者 | 結果 |
| --- | --- | --- | --- |
| 背後窓の識別可能な最大化/最小化ボタン | InactiveCaption | **InactiveCaption** | foreground＋終状態に応じW01/W03/W04を**1Candidateから** |
| 背後窓のボタン不明（`Fallback`） | **InactiveCaptionとWindowGestureのドラッグ候補** | **クリックとして成立ならInactiveCaption、ドラッグならWindowGesture** | `MOVESIZESTART`でcaptionを取消・dragへ譲る。両方から同一入力のCandidateは送らない |
| 画面を跨ぐドラッグ＋最大化/四隅 | WindowGesture内部の移動・終端配置候補 | **WindowGesture** | `compound-drag` **1Candidate** → W02＋W03/W07 |
| タスクバーのslotクリックまたはWin+数字 | Taskbar、他の受動的なinput状態 | **Taskbar** | W12。起動結果に由来するW01を別途採用しない |
| 通常の閉じるボタン/Alt+F4 | WindowClose、他の受動的なinput状態 | **WindowClose** | DESTROY/消滅が確定したときだけW11 |
| 通常の直接クリック/Alt+Tab | WindowSwitchと独立の窓状態監視 | **WindowSwitch** | 成立した前景切替のみW01 |

**注意**：現行`CandidateTracker`・WindowSwitch・InactiveCaptionが、ひとつの物理入力を競合追跡中に**別々のtransaction番号を先行採番することはあり得る**。したがって**物理入力=必ず同一transaction番号を全Handlerで事前共有**とはしない。確定した**1Candidateのtransactionは一意**であり、競合して採番された不成立候補の番号は欠番でよい。候補発行済みIDの再使用は禁止。保存側は**候補ごとに一度**処理する。

## 4. 時間・snapshot・例外・スレッドの契約

- `ObservedEvent`はWindow Hookのcallback時刻、必要なnative event tick、入力フラグと対象識別（**C#内部のみ**）を保持する。OS adapterは現在と同じ物理クリック・注入・修飾キー・対象の確認を行い、TSへは生イベントを出さない。
- `IWindowFacts`は既存`Observer.states`と`Read/ReadStateChange`の互換境界。押下時の`before`と結果時の`after`を混ぜず、**同じイベント内の必要箇所でのみ**照会。特に`GetWindowPlacement`等の更新は**結果確認時に新たに読む**。ポーリング周期・hit test呼出しの閾値・window cache未登録時の棄却を変更しない。
- タイマー・worker結果は`Generation`を保持し、**元のmessage-loop thread上で**Routerへ返す。Router/Handlerの通常配送を並列化しない。`CandidateProtocol`と`ObserverHost`のそれぞれのlockは維持。
- 例外時は**Candidateを送らない（fail closed）**。現在の`OnMouse/OnKey/OnEvent/PollMaximize`ごとに異なるCancel対象を、ルーティングテストの基準に合わせて維持する。**すべてのHandlerを無条件にResetする**などの意味変更は禁止。
- 個別Handlerの`timer`やTaskbar query workerは独立のままでもよい。`Stop`によって古いTaskが完了しても、`generation`チェックが通らなければ`Publish`しない。
- `HandlerResult.Proposals`は単一処理での候補群の一時収集であり、**個別Policyが複数操作を別Candidateとして生産する仕様ではない**。`Router`は政策で許可したものだけを`CandidateSink.Publish`する。複合証拠を分けて送らない。

## 5. 機能追加時の契約

**既存イベントで独立に検出できる操作を1つ追加する場合**：`IEvidenceHandler`実装1件＋`DetectionComposition`登録＋必要なTS Classifier/型・テストの追加を中心にする。Observerの`switch/case`や既存Handlerの条件分岐へ追記しない。

**他操作と競合する新操作の場合**：`ArbitrationPolicy`に**その交差ルールだけ**追加する。これは意味のある変更点であり「OCP違反だから悪い」とは扱わない。独立のDetectorへ無理に横断ポリシーを埋め込まない。

**新しいWin32の観測種別が必要な場合**：OS Adapterでそのイベントを取得できるようにする。**新しいEvidence種別**を使う場合はC# polymorphic union、TS shared型・`candidateV2`・Operation Classifierのそれぞれを更新してよい。IPC契約を型安全にするために必要な変更は拡張性の失敗ではない。

## 6. 正本と受入

- 実行結果の正本：[07 回帰条件](07-regression-contract.md)のR01～R19。
- 先行テスト：[08 テスト対応表](08-test-coverage.md)のG01/G02、timer移行時はG03。G01は**本番のRouting/Arbitration実装**で実行すること。
- 移行ゲート：[12 実装段階の受入条件](12-migration-and-gates.md)。**ここではまだIssue化しない**。
