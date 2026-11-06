# 06 設計判断と拡張性の評価（Step 2）

> **後続決定（2026-11-06）**：本書に列挙した未確定事項は[10 確定判断](10-architecture-decisions.md)・[11 配送と所有権](11-routing-and-ownership.md)・[12 移行ゲート](12-migration-and-gates.md)で解決した（実装・テスト実行は未着手）。**本書は検討理由・代替案の履歴として保存**し、実装時は新資料を優先する。

> **レビュー用の推奨案**。Step 1で確認した事実とは区別する。製品仕様を変更したという意味ではなく、実装Issueが確定するまでは「提案」の状態。

## 1. 判断一覧

| 設計判断 | 提案する結論 | 採用の理由 | 別案・採用しない理由 |
| --- | --- | --- | --- |
| C# / TS境界 | C#は相関済みOS証拠、TSはW ID・記録/案内ルール | OS時間相関と製品ルールを分離 | OS生イベント全送信は境界が大きすぎる |
| 初期のJSONL | **v2を維持** | 変更をNative内部に限定して回帰が簡単 | 最初からv3へ切替は影響範囲が大きい |
| Observerの責務 | Win32 callback・入力の正規化と状態読み取り、Handlerへの配送 | 操作追加に伴う分岐増加を抑制 | Observerが全操作のMethodを直呼びする方式を継続しない |
| Dispatcher | **採用候補**：同期・順序付き登録Handler配信 | 扱うイベント種別とhandler登録を分離 | 非同期イベントバス・並行fan-outはhook時間/順序/競合の危険がある |
| C# Handler interface | **採用候補**：`IEvidenceHandler.OnEvent` / `Reset` | 個別実装をObserverが知らなくてよい | 全Handlerに操作固有のメソッドを公開しない |
| Candidate出力 | **採用候補**：`ICandidateSink.Emit(CandidateDraft)` | CandidateProtocolとの依存を一箇所に集約 | Nativeの各検出器がv2用メソッドを直接呼ばない。候補発行gateとstdout書込lockは別の所有者 |
| 状態管理 | 各Handlerは自分のpending状態を所有し、共有ID・競合だけを別管理 | 変更の局所性が高い | 巨大な単一Gesture Coordinatorへ全状態を集約しない |
| TypeScript classifier | `classifyGesture`を共通入口に保って、Evidence群別の純粋関数へ分割 | 追加箇所が明確、テスト単位が小さい | W IDごとの1対1制約は複合操作に合わない |
| Snapの扱い | 初回対象外のコードは新しいHandler登録へ含めない | 現行の検出対象を変えない | ついでに機能追加しない |

## 2. ステップを分けるべき理由

**構造の変更と意味の変更を同じPRでやらない**。

- **構造変更**：Observer・Trackerの分割、interface/Dispatcher・Sinkの導入、TSのClassifierをファイル分割。外部の`CandidateEnvelope`と`Observation[]`は一致させる。
- **意味の変更**：Win+↓連続の統合をC#からTSへ移す、対象窓の除外条件を移す、Candidateの証拠形式を整理する。これはJSONLや発行タイミングが変わる可能性があり、別の振る舞い変更として扱う。
- Step 2では**前者の最終構造案を示し、後者は独立して要否を判断する**。例えば「C#が`maximize`という文字列を持つ」ことだけでは移動の理由にならない。

## 3. 新しい操作を1件追加する場合の変更シミュレーション

| 仮想機能 | 必要な実装変更（目標） | 既存の共通部分への変更 |
| --- | --- | --- |
| **既存イベント・既存Evidenceで表現できる窓操作** | 専用Evidence Handler（必要なら）、TSのClassifier関数、操作定義・テスト | Observerの操作分岐・既存Handlerは**原則変更なし**。新Handler登録は組立箇所1か所 |
| **新しい形のEvidenceを持つ窓操作** | 上記＋C# Evidence/serial DTO、TS union・schema検証、Classifier | **wire契約の型追加は許容**。Observerや既存Handlerの操作固有のロジックは変更不要が目標 |
| **新しいWindowsの観測方法が必要** | OS Adapter/Win32 API読取、新Handler、対応する契約・テスト | Adapterの変更は必要な責務内。新API実装を既存の各操作別Handlerへ広げない |
| **テキスト操作（将来の仮例）** | 専用OS観測経路、プライバシー設計、専用Handler、Evidence形式・Classifier・テスト | WindowState/配置用の既存Handlerへ無理に条件を追加しない |
| **1gestureから3操作以上成立** | Candidate/Classifierの表現、DurableCoachの書込設計、通知UI、テスト | 現行は2件の原子保存前提。**別の機能開発**として変更する |

**評価のしかた**：単純な変更ファイル数だけでなく、「既存の別操作用Detectorを変更した数」「Observerに増えた操作固有分岐の数」「contract更新が安全に検証されるか」を測る。新しいEvidence種類でTS Parserの型検証を増やすことは**正当な契約変更**であり、設計失敗とは数えない。

## 4. Step 3で固定すべき具体的な不変条件

| 確認するケース | 現行で守ること |
| --- | --- |
| マウス最大化/復元/最小化とキー操作 | 対象・操作前後状態・入力由来・ショートカットの条件が変わらない |
| Win+↓の連続操作・キーリピート・注入入力 | 同じ操作の意図しない二重記録を生じさせない |
| 直接クリック・Alt+Tab・非アクティブcaption | foregroundとの対応、既存の条件付き取消、複合W01＋W03/W04を維持 |
| ウィンドウのドラッグ・左右半分/四隅・別画面移動 | 移動の開始/終了・モニター一致・配置の幾何・複合W02＋W03/W07を維持 |
| 閉じる操作 | 対象同一性、クリック/Alt+F4由来、破棄待ち期限を維持 |
| タスクバー | slotの対応、クリック/Win+数字、遅延照合、snapshotの整合を維持 |
| stop/start・表示設定変更・非同期結果の遅延 | stale候補が次世代で採用されない |
| CandidateProtocol v2 | envelope/schema/generation/sequence/transaction/date/origin/route/evidenceを変更しない構造工程を先行 |
| 記録・通知 | 1gestureの重複防止、複数W IDの原子保存、学習状態と通知条件の既存動作を維持 |
| データ最小化 | 生の文字・キー列・ウィンドウタイトル・ID類をJSONL/永続データに流さない |

**実証の区別**：既存のC# policy/fixture、TS単体、プロトコル接続、Electron smoke、実Windows自然入力はそれぞれ証明範囲が異なる。Step 3では利用可能なテストとの対応表、足りないテスト、自然入力が必要な範囲を分けて記録する。

## 5. Step 4（Codex用Issue）に落とすときの境界案

この表は**Issueの依存の考え方**であり、分割・実装順をまだ最終決定しない。

| 作業の境界 | 完了時に成立させたい契約 |
| --- | --- |
| 既存動作の固定 | 上記のケースに対する不足回帰テストの追加と現行結果の基準化 |
| 共通transaction・Candidate Sink分離 | CandidateTrackerに番号発行の責務を残さず、各既存CandidateのJSONLは同じ |
| Trackerの領域別抽出 | 状態変化・ドラッグ・配置の所有者が明確になり、Observerから見た動作は同じ |
| Dispatcher/interface導入 | Observerが操作ごとの専用Handler実装を知らず、イベントの順序・競合が維持される |
| TS Classifier分離 | `classifyGesture`の入出力と現在のW ID・案内が同じ |
| C#↔TS意味の再分担（必要な場合のみ） | 現行とは別の要件・回帰・互換性判断を揃え、単なるコード移動を目的にしない |

## 6. 設計の未確定事項と次工程の決め方

1. **Handlerをどの粒度で分けるか**：WindowState/Move/Placementを論理上分けたが、窓の復元・最大化・ドラッグ・caption clickの所有権が跨る。Step 3でイベント列と競合条件を固定し、Step 4で最小の切り出し単位を決める。
2. **Arbitration/Compatibility PolicyのAPI**：入力ごとの優先順位・Cancel/Resetの因果関係を確認してから契約を決める。根拠なくglobal stateを移動しない。
3. **Dispatcherの配信順と調停API（実装前ブロッカー）**：現在のコード順序、専有、取消、複合操作を維持するため、G01の入力列で確認し、Handlerの処理結果・所有権・競合通知をどう表現するか決める。**擬似`IEvidenceHandler.OnEvent()`だけでは十分な契約にならない**。登録配列順だけに安全性を依存させず、APIが未確定ならDispatcherの本実装Issueを開始しない。
4. **ObservedEvent内のsnapshot**：不要なWin32 API呼び出しを増やさず、各Handlerが必要な時点の情報を得る方式を選択する。すべてのマウス移動で完全なwindow snapshotを取得しない。
5. **CandidateDraftとEvidenceの内部型**：現行C#の`Evidence` record階層をそのまま使うか、wire DTOとの境界を分けるかは依存分析後に決定する。**1gestureの複合証拠は1つの最終所有Handlerから送る**ことを維持し、同一transactionで複数Handlerが個別に送る構成は許容しない。
6. **既存の「Win+↓ 2回で1操作」等の意味移動**：TypeScriptに移す場合、何を別候補として送るか、重複除外の順序と照合して独立設計する。
7. **プロトコルの将来形**：v3への変更の必要性が明確になるまではv2維持。将来の拡張のためだけの汎用raw-event schemaは作らない。
8. **transaction採番の全経路**：`tracker.NextTransaction()`のdelegateだけでなく、Tracker内の`++transaction`や`PlacementPolicy`経由の発番、各専用Observerの発番を同じsession採番器へ移す。**候補の取消によりtransactionが欠番になる現行の性質は維持し、連番を強制しない**。採用済み番号の重複・世代跨ぎを含めNative→TSの重複排除結果を変えない。
9. **コンポジションルート**：Handlerの生成・登録はObserverの操作分岐とは別の1か所に集約。将来追加時に既存Handlerを変更しないことを、G04でテストする。

**結論**：Step 2の設計軸は「ObserverをOS観測へ、Evidence Handlerを相関へ、TS Classifierを製品上の採用へ」分割すること。ただし**Dispatcher導入そのものや抽象化量より、競合と同一ジェスチャの意味が変わらず拡張しやすいか**を優先する。

**次工程**：[README](README.md)に戻り、Step 3で不変条件とテストを一覧化する。
