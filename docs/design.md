# 設計・実装状況

現行の受入条件は[確定要件](ui-redesign-requirements.md)、実行手順は[開発・検証ガイド](development.md)、根拠・原本は[research.md](research.md)。

W03/W04の局所実装・共通処理・#113との未解消依存は[検出器と受入条件](window-state-implementation.md)を参照。複合記録・通知の未達を単独操作の試験成功で代替しない。

## 現行の開発順序（2026-10-27更新）

W13の上下halfは一般的な横向き画面で標準マウス入口を確認できなかったため初回リリースの対象外（[#3](https://github.com/YutoMatsui21/shortcut-expert/issues/3)）。B02/A09/G-W13は将来検証とし、既存ID・履歴は保全する。

現行5操作の条件付き検出は残すが、自然入力精度が未検証のため「検出対応済み」とは扱わない。初回リリース対象は8操作（W12/W01/W03/統合W04/W06/W07/W02/W11）。W05はW04へ統合し、W08/W10/W09/W14/W13を除外。旧データ削除は承認済みで、履歴移行・学習状態統合は要求しない。

1. **契約と基盤**：Native候補→Main厳格検証→Core採用の境界を保ち、人工イベントで保存・集計・学習状態・通知・画面を実装する。イベントID・操作ID・由来・日時・検出確証・同等キーの整合を守る。検出器実装を基盤の着手条件としない。
2. **UI**：8操作を「準備中」と表示する。学習状態3種とは別軸。記録なし/観測欠損/既存履歴を混同しない。
3. **隔離統合**：fixtureを実記録と混ぜず、基盤版で回帰を通す（#43）。この合格は自然入力精度や最終版の証明ではない。
4. **検出器**：6操作 W03/W04/W06/W07/W02/W11、残る2操作 W12/W01。各操作の技術前提と既存安全契約を検証する。
5. **最終受入**：同一製品buildで回帰試験とR02の自然入力確認を行う。手動は各ケース原則1回、予想外の結果だけ再試行する（2026-10-24本人指示）。8操作と必要条件の確認が揃うまで公開しない。単発結果から精度率を実証したとは扱わない。

**2026-10-28 追加設計（#113）**：別monitorでのドラッグ終了と最大化／四隅への配置がともに確定したら、W02＋W03／W07を**各操作IDで1件ずつ記録**する（同一IDの重複は不可）。一時的なgesture IDと対象窓/世代・始終monitor・入力/終端の因果をNative→Main→Coreで維持し、同一gesture内の複数件をSQLiteへ原子的に保存する。学習中・キー確証済みの操作だけを**1つのToastで別行表示**する。画面配置でW02の移動キーが不明ならW02は記録のみ、W03/W07は独立して案内する。今ある単一Observation/単一キー/1候補→1通知のコードと先行試験は複合動作の実装証拠ではない。#96（1操作の複数候補）は別の将来拡張。#113と#31/#37/#38で実装し、#47で最終検証する。

既存の工程記録・旧MVP要件・除外前Specの実施順より、この現行方針を優先する。Issue [#14](https://github.com/YutoMatsui21/shortcut-expert/issues/14)は検出器側の技術審査であり、UI/保存の着手ゲートではない。
<a id="architecture"></a>

## 現行アーキテクチャ

#46の隔離UI受入はMainの`ui-acceptance.ts`が本番CoachWindow/Rendererを計測する。起動scriptが新規fixture保存先と配布物hashを記録し、helperは実入力を読まない。[責務・結果・証拠の範囲](ui-acceptance.md)。

日別保存は[保存契約と検証](durable-storage.md)に従う。Mainの`sqlite-repository.ts`が単一writerと専用`storage-worker.ts`を所有し、`storage-store.ts`だけがSQLiteへアクセスする。Coreの`durable-coach.ts`は限定Repository契約を介して、件数・coverage・時計高水位・非重複checkpointを同時保存する。Core/Rendererは最大60日のread modelだけを持つ。Worker起動時の`storage-migration.ts`が旧JSONの厳格検査とstagingへの移行・再open照合・有効化を担当する。旧JSON用`Coach`/`JsonRepository`は隔離回帰試験用に維持し、通常起動は30日剪定を通さない。移行・削除の故障時も旧JSONへのfallbackは行わない。[移行契約](json-migration.md)を参照。限定bridgeの`getRecords`はMainでsender/mainFrame・実在日付・最大60日を再検証する。

機能追加・リファクタ・責務配置の判断に用いる。下記の責務分担を現行方針とし、過去の工程記録は[アーカイブ](archive/design-implementation-history.md)に分離した。

| Module／配置 | 責務 |
| --- | --- |
| Core／`src/core` | 操作判定、集計、利用状態、純粋な日付処理。保存・通知は受け取った依存を呼び、Node・Electron・Windows APIを直接使わない |
| Main／`src/main` | Electron制御、保存実装、helper接続、通知、アプリ内スモーク試験 |
| Preload／`src/preload` | 型付きIPCによる状態取得・制御・設定・削除の橋渡し |
| Renderer／`src/renderer` | 数値・設定画面と通知画面、利用者の指示。OS観測・ファイルI/OはMainへ要求する |
| Shared／`src/shared` | 共通型・操作定義。Node・Electron・Windowsへの依存を持たない |
| Native helper／`native-helper` | Win32宣言、観測・候補生成、JSON Lines通信、画面照会。採用判断と案内キーの決定はTypeScript側で行う |

### 依存方向と拡張

- 起動時の引数は`startup-mode.ts`で一度判定し、`startup-data.ts`がsingle-instance lock取得前に通常／隔離userDataと自然入力受入の起動条件を設定する。`coach-app.ts`は本番の保存・通知・観測・IPC・終了処理を構成する。明示した検証モードだけ`validation-runtime.ts`を遅延読込し、fixture準備・モック通知・故障注入・smoke／acceptanceランナーを接続する。ランナーは本番のcommand・停止・終了処理を共用する。分割chunkの配置に依存しないよう、storage smokeの再openには本番側で解決したWorkerパスを渡す。通常起動の構成はDurableCoach／SqliteRepositoryのみで、IPC・tick・終了も同じSQLite経路を使う。旧Coach／JSONが必要な隔離smokeはValidationRuntimeからだけ読み込む`legacy-fixture-runtime.ts`で構成し、互換read modelと日付更新を接続する。旧protocol・通知等の最終撤去は#42に残す。
- MainはCore・Sharedを利用し、CoreはSharedと純粋な処理を利用する。CoreからMainを参照しない。
- RendererはSharedと必要な純粋関数を利用する。Mainとの通信はPreloadが公開する橋渡しを使う。
- Mainの`CoachWindow`（`coach-window.ts`）は単一の数値窓の生成・非表示・最小化からの復元・前面化・状態配信を担当する。トレイと二重起動は共通の`showCoach`を呼ぶ。`coach-ipc.ts`はIPC登録・送信元frame・引数検証と`DeleteConfirmation`の短命・単回tokenを担当し、検証後に`coach-app.ts`の処理を呼ぶ。計測制御・直列化・削除実行・終了判断は`coach-app.ts`に残す。確認UIはRendererの`DeleteDialog`で、キャンセル初期focus・modal Tab拘束・Esc取消と二重click防止を持つ。
- #22の通常boundsはCoachWindowがDIPで取得し、Mainのwindow-boundsがwork areaへ補正する。Coreの設定キューから既存SQLite Workerへ保存する。最大化状態は非永続のsnapshot項目。coach-appの終了は重複要求をまとめ、制御待機→停止→bounds/保存flush→未保存確認→helper/Worker終了を待つ。[契約・V03未確認条件](window-lifecycle.md)。
- #23のSettingsPopoverは共通gearの下に2スイッチを表示し、トレイと同じMain commandでsessionの通知pause・計測stop/startを制御する。停止中は通知の希望値を保持して変更を無効にする。CoachWindowの非永続stateVersionで、Rendererが新しい配信後に届く古いIPC応答を無視する。[設定パネル・検証範囲](settings-panel.md)。
- #17のAppShellでは`CoachApp.tsx`が単一のuseCoach購読・2ページ・session表示状態を所有する。7日記録表示は`RecordsPage.tsx`に置き、一覧は`LearningPage.tsx`、7日集計はCoreの`learning.ts`へ置く。Mainの限定`getLearning`から実読取モデルを返す。[一覧の契約・assets・検証](learning-ui.md)。
- #18の3学習状態はSharedで解決し、Mainが検証した`setLearningState`をCoreの直列キューから既存settings保存へ渡す。DurableCoachの確定済みcounts/settings/revisionから一覧を生成する。全状態で記録を継続し、失敗時の保留は成功状態として表示しない。[保存・互換・検証範囲](learning-ui.md#3状態18)。
- #26のDurableCoachは受理時の通知tokenと発行直前の状態を照合し、保存成功後にMainのStandardNotificationsへ毎回要求する。Mainは新規instance/UUID、正式名・証明キー、無音・OS時間で発行し、要求/API返却/イベント/失敗/不明を分ける。配送応答をwriterで待たず、障害後に通知を再送しない。起動時のAUMID・global activationとinstance clickは共通showCoachへ集約する。旧NotificationWindowはJSON隔離fixtureだけで使う。[通知・参照寿命・未確認のOS受入](standard-notifications.md)。**#96は、既存の単一`shortcut`をW01/W12の状態別・構造化した複数候補へ拡張する後続作業。1操作・1保存・1通知要求と既存の保存後発行/非再送契約を維持する。現行実装はまだ複数候補に非対応。**
- #27のMain indexはsingle-instance lock取得後にglobal activationを登録し、表示しないNotification instanceでWindows presenter/COM受信初期化を開始する。CoachWindowが読込前/読込中の表示要求を保留する。coldではopenedにかかわらず一覧を表示して通常の起動経路で計測し、稼働中clickは既存窓復元のみで停止/pauseを保持する。NSIS shortcut名とAUMIDは既存identityを維持する。COM ready race・旧通知から更新/再導入版の起動・OS focusは配布版受入が残る。
- #19の記録ページはCoreの`records.ts`で操作別7日集計とKPIを生成する。限定`getRecordSummary`がCore直列キュー→Repositoryの7日query→同一revision確認→12行/KPIを返す。Rendererは全履歴を取得せず、共通Shellに縦積み/4列表を表示する。[記録の契約・検証](records-ui.md)。
- #25のDurableCoachはSnapshotへerrorKindを渡し、両画面の共通SaveErrorBannerが固定header直下に表示する。記録/設定保存、保存先読込、時計、observerを区別し、retryは同一checkpointの保留差分だけを再送する。保存復旧はobserver/時計故障を解除せず、通知tokenを復元せず、観測も自動再開しない。[保存・障害契約](durable-storage.md)。
- #20の記録queryはSharedの期間/フィルタ/ソート型をMainで検証し、CoreのrecordsReadModelが現在の操作集合を両期間・KPI・比較・欠損判定へ共通適用する。DurableCoachが同じ直列キューで最大60日を一括読取し、整数分数の丸め前ソート結果を返す。AppShellは表示条件をsessionだけに保持する。#21のRecordsPageはこの比較値をKPI/操作行へ表示し、MissingCoverageInfoが説明のhover/focus/クリックと画面内配置を担当する。[記録queryの契約](records-ui.md)。
- C#のWin32宣言はNativeMethods、通信制御はObserverHost、型付き証拠と最終送信の直列化はCandidateProtocol、画面照会はDisplayContext、純粋な全画面分類はDisplayPolicy、フック・Windows状態取得はObserver、取得済み事象からの候補組立はCandidateTrackerに置く。
- **過去のW08実装（初回対象外）**：8操作版はSnapInvocationObserverを通常観測へ接続せず、CoreでもW08候補を採用しない。旧証拠型・純粋policy試験・実測資料は保持する。旧W08の入力・50ms照会は既存hookを共用するSnapInvocationObserver、純粋な滞在/キー/設定/幾何判定はSnapInvocationPolicyに置く。専用v2証拠をMainで検査しCoreでW08へ判定する。[契約・検証と未受入事項](snap-invocation.md)。
- W12はTaskbarInputObserverが既存hookを共用し、TaskbarQueryの独立processでUIAを照会する。TaskbarInputPolicyが番号の入力前後照合・期限・repeat/注入除外を担当する。専用v2証拠をMainで検査しCoreがW12/Win+数字へ変換する。[契約・unknownと受入](taskbar-input.md)。**W12 11番目以降・起動状態でのAlt+Tab候補と、W01切替先のtaskbar番号照合は#96で追加予定。既存の1〜10番の実測をそのまま拡張の成立証拠としない。**
- 同意後のW08/W12製品受入は`natural-input-acceptance.ts`が試行の開始/停止と集計差分を担当し、別processの手動panelから操作する。専用flag以外では接続せず、通常の検出・保存・通知処理を共用する。
- 新操作は既存の操作定義・観測・判定・表示の担当箇所へ追加する。既存の通信契約や保存形式を変える場合は互換性と移行方法を設計に記録する。
- 共通化・新しい階層・操作別フォルダーは、実際の重複や差し替え需要が生じた時点で判断する。
- 責務や依存方向を変更した場合は、この節を同じ変更内で更新する。

### 関数・コメントの方針

- 長い条件式は業務上の意味が分かる関数名へ分け、早期returnで前提を示す。判定順序・短絡評価・副作用は維持する。
- 重複する直列実行は`SerialQueue`を使い、Coach・Main制御・保存はそれぞれ独立したキューを持つ。失敗は呼出し元へ返し、後続処理は続ける。
- 外部データは小さな型ガードで段階的に検証し、型の絞り込みを使う。キャストで検証を代用しない。
- OS定数はNativeMethods、アプリ固有の時間・距離は利用箇所に名前を付けて置く。
- コメントはコードから読み取れない理由・制約・寿命を書く。処理や型の言い換えは避ける。
- 抽象化は実際の重複や差し替え需要に合わせる。性能改善は不要な計算の削減から始め、効果を主張する場合は計測する。

根拠：[条件式の分解](https://refactoring.com/catalog/decomposeConditional.html)、[必要になってから抽象化する方針](https://martinfowler.com/bliki/Yagni.html)、[TypeScriptのコメント](https://google.github.io/styleguide/tsguide.html#comments-and-documentation)・[型アサーション](https://google.github.io/styleguide/tsguide.html#type-and-non-nullability-assertions)、[C#のコメント規約](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/coding-conventions#comment-style)。

### 確認と検証物

- 判定・集計・保存は関連する自動試験で確認する。helper変更は再ビルドとnative試験、画面・IPC・起動の変更は関連するスモーク試験、同梱経路の変更は同梱版でも確認する。コマンドは[README](../README.md#開発確認)と[package.json](../package.json)を参照する。
- 検証ソースは`validation/probes`、既存の実測原本は`validation/evidence`、再生成可能なexe・今後のログはGit対象外の`.tools/validation`に置く。製品コードにprobeを取り込む場合は成立条件を改めて確認する。
- 人工候補の接続試験と実入力精度の証拠を区別し、未確認条件を対応済みとして扱わない。

### #10：SQLite方式の成立確認（2026-10-18）

配布版の隔離probeで`node:sqlite`・専用Worker・WAL/FULLのディスク保存、応答消失時の重複防止、故障時の原本保持、JSON全件/bytes照合後の移行、長期期間読込を確認した。方式と証拠・限界・#15/#16への引継ぎは[SQLite保存方式の技術検証](sqlite-storage-validation.md)を参照する。製品は引き続き`JsonRepository`を使い、このprobeを本番保存として呼ばない。

2026-10-19のPR #55レビュー対応では、未作成JSONの既定値と欠落保持、所有情報で限定したschema初期化再開、全削除時のledger削除と世代更新、不正暦日の拒否、FULL後の同じ書込の再送、現在のElectron固定版との照合を追加した。初期schemaのtransaction内も強制終了試験の対象とし、所有情報のないDBや未知版は上書きしない。

### 指示の配置

全体に適用する短い参照指示は[AGENTS.md](../AGENTS.md)、責務と判断理由は本節に置く。テスト追加の反復作業は[リポジトリSkill](../.agents/skills/test-shortcut-coach/SKILL.md)から下記のテスト設計へ案内する。
根拠：[AGENTS.md公式資料](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[Skills公式資料](https://learn.chatgpt.com/docs/build-skills)、[指示を簡潔に保つ方針](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)。

### 8操作版の連続入力と表示

UIと記録集計はlearningOperationsの8件、coverage生成はrecordOperationsの8件を使う。保存parserは過去の操作IDを解釈できるが、W05をW04へ合算しない。新しいrestoreはW04に記録する。最大化中の最小化ボタンにはWin+↓を必要に応じて繰り返す案内を出し、arranged状態不明では同等性を推定しない。

CandidateTrackerは同じHWND/processに対する、前回の成立入力から1000ms以内の物理的なWin+↓再押下を1操作にまとめる。最初の確定結果を即時に記録し、続く確定結果は重複送信しない。他入力・別窓・期限切れ・停止/世代変更で切る。押しっぱなしのrepeatで有効期限を延長しない。この1000msは実装で固定した境界であり実測値ではない。W07のWin保持列とW03上端ドラッグの実検出は#9/#31/#35/#37の成立・実機受入を別に確認する。

<a id="test-design"></a>

## テスト設計

テスト実行入口`scripts/test.mjs`はunit/nativeの分類、module mock有効化、timeout、coverage条件を共通化し、ファイル並列度の明示指定も受け付ける。ファイル・名前・reporter・並列度指定の使い方は[README](../README.md#修正中のテスト絞り込み)に集約する。`tests/test-runner.test.ts`は隔離fixtureを別プロセスで実行し、選択したテストだけの実行、失敗終了コードの伝播、既定の全件実行、native分類、誤った引数の拒否、異なるファイルの同時実行とprocess隔離を確認する。製品の検出・保存・通知経路の試験とは分ける。

開発用の`scripts/dev-environment.mjs`は子プロセスのTEMP/cache、`dev-run.mjs`はNode製toolの起動と準備確認を担当する。`github-workflow.mjs`は開発Issueのrevision/hash付きcacheとhead固定のPR状態要約を扱う。製品Core/Mainの保存や通信には接続しない。実行方法は[開発用ツール](development-tools.md)。smoke失敗のstackとプロセス診断は隔離fixture経路だけに出力する。

<a id="storage-review"></a>

### 保存・移行の故障境界

保存・移行を変える時、該当する下表を実装前の試験選定とPR前のレビューで照合する。既存試験が同じ本番経路を通すなら再利用し、無関係なケースを機械的に追加しない。

| 故障境界 | 操作列と期待する保護 |
| --- | --- |
| 未作成と読取不能 | ENOENT / EACCES / I/O失敗を分け、後二者を空データや新規authorityへ変えない |
| 公開・同期の中断 | marker/DB/有効化の各変更境界で中断→再起動し、所有情報と原本を保持して安全に再実行する |
| 一部欠落 | DB・marker・補助表を個別に欠落/破損させ、移行済みデータを空の初期化へ戻さない |
| 空データと全件照合 | 空日付・設定だけの旧データ、同じ総和で異なる行を区別して再open照合する |
| 削除と再送 | active/stagingを分け、削除中断→再起動、ACK喪失→同じ書込再送で復活・二重計上を防ぐ |

レビューは仕様文の有無だけでなく、選んだ故障操作列の結果と本番処理を確認する。根拠がない場合は未検証として残す。

### #13：型付き証拠とprotocol v2の併設

後続#39ではW11を`window-close/window-close-v1`へ分離した。[入力・同一対象破棄・期限・検証範囲](window-close.md)を参照。以下の#13時点のvariant/legacy記述は導入時の契約を示す。

Sharedの`ObserverCandidate`は旧`Candidate`と`CandidateV2`のunion。v2はgeneration/最終送信sequence/入力transaction/完了日/由来/route/注入・競合と、`window`・`shell-display`・`activation`・`global`の証拠を分ける。Nativeの`CandidateProtocol`は限定された証拠recordを直列送信し、Mainがvariantの必須項目・型・ID範囲を検査して許可項目だけをCoreへ渡す。未知の能力はnullのまま保持し、成功へ変換しない。生キー列・窓token・process ID・タイトル・path・UIA treeは通信型に含めない。hookへUIA処理は追加していない。

readyは旧版互換のprotocolVersion=1とsupportedProtocols=[1,2]を返す。新Mainはstartでv2を選び、広告のない旧helperにはv1を選ぶ。旧Mainから版指定なしのstartを受けた新helperはv1を送る。同じ世代では1経路だけを使い、Mainは選択版と違う候補を通信故障として停止する。Coreでも世代内の版混在を拒否する。fixture命令だけは既存のv1人工候補を選択中のv2へ変換する。この変換は実入力経路には存在しない。

Nativeの入力transactionは世代内で単調増加し、入力・drag終端・破棄・停止の既存寿命を引き継ぐ。単純入力の1000ms、dragの入力→開始1000msと終端までの保持を維持する。CandidateTrackerの結果組立時sequenceとは独立に、CandidateProtocolが最終emit時にsequenceを採番する。遅い完了が先のtransactionでも送信順に受けられ、停止・旧世代の遅延完了は送らない。drag中の派生状態は送らず、終端だけがtransactionを消費する。

Coreは除外候補もsequenceとtransactionを消費し、再配送・同一IDの内容差替えを拒否する。記録・通知待ちへ入る前に候補を複製し、呼出し元からの差替えも防ぐ。transactionの記憶は最新IDから4096個の範囲に制限し、範囲外の古いIDは記憶を削除しても採用しない。この上限は再配送拒否の資源制限であり、新しい検出器の実測期限ではない。Shellの非同期読取や確認dialog等の確定点・期限は本変更では実装しない。

`window/legacy-window-v1`だけが既存5操作のCore条件へ接続する。これは従来条件の移送profileであり、自然入力精度の合格profileではない。残るvariantは`unverified`として型・parse契約だけを併設し、値がtrueでも採用0件。未実証route/profile・操作は採用しない。判定後の`Observation`（ID/操作ID/由来/完了日/同等キーまたはnull/画面）がUI・保存・通知との境界となる。保存形式・表示registry・通知条件は本変更で変更しない。B08解消・新操作実装・自然入力受入を意味しない。

検証はNodeのv2厳格parse→本番CoreとCoach、C#の本番CandidateTracker/CandidateProtocol→JSON→TS parse/Core、実helperのv1/v2選択・開始解除を隔離fixtureで扱う。余分なenvelope項目で否定的なwindow証拠を上書きできる不具合は、採用されてしまうassert失敗を確認後、必須envelope項目だけを明示的に移送する修正で防いだ。実入力の検出精度・UIA provider・配布受入は別の検証とする。

2026-10-19検証結果：Windows 11 build 26300、Node 24.11.1/npm 10.9.2、ローカル.NET SDK 10.0.401。型検査、unit 121件、native 6件（本番C# policy 63ケース）、helper/Electron buildが成功。最後の必須fieldの型整理後も関連26 unitとC#→TS契約を再確認した。通常版と`release/protocol-v2/win-unpacked/Window Shortcut Coach.exe`の隔離fixture smokeが成功し、既存5操作のmouse/key集計・保存・通知、重複除外、設定再読込、停止/再開/削除、窓復元、不正IPC拒否、hook解除を確認した。npm取得のEPERM、同梱生成のElectronキャッシュrenameのEPERM、同梱exeのsandbox内起動失敗は権限付き再実行で成功。実入力観測・UIA探索・キー送出・自然入力精度・NSIS導入・通常60分は未実施。B08や新操作の技術ゲートは未解消。コミット・push・PR作成・Issue更新は行っていない。

### #1：新UIの準備整理（2026-10-18）

[Issue #1](https://github.com/YutoMatsui21/shortcut-expert/issues/1)の範囲で窓管理・IPC受付・Rendererの状態処理を上記担当へ分離した。画面・保存形式・IPC/Preload契約・既存5操作の判定条件は維持する。再表示は同じ窓を使い、最小化中は明示的にrestoreしてからshow/focusする。復元呼出しを外すと回帰試験が失敗することも確認した。

Node試験は窓の読込中の重複生成防止、close→hideと終了時のclose許可、窓の隔離/遷移拒否、正規IPCと別窓・子frame・不正引数の拒否、Preloadの再購読/解除を確認する。Electron smokeには実窓のclose→hide、登録済みsecond-instanceイベントからの再表示/最小化復元、Renderer再読込後の状態取得・通知停止/再開を追加した。second-instanceは人工イベントであり、実際の別プロセス起動やトレイのダブルクリック配送の証拠とはしない。

検証結果：型検査、unit 113件、native 5件（内部で本番C# policy 61ケース）、helper/Electron build、隔離fixture smokeが成功。smokeは既存の記録・設定・通知・停止/再開・削除・不正IPC拒否に加え、上記の窓復元とRenderer再読込を確認した。実入力観測は実施していない。実際の別プロセスからの二重起動・トレイのOS操作・配布版/NSISは今回未確認。コミット・push・PR作成は行っていない。

### 操作検出の追加（2026-10-12）

W03に加えW02・W04・W05・W11の条件付き検出を実装し、全11候補へ一覧用キーと条件説明を追加した。UI一覧と、採用結果に応じた通知キーは別に決める。Coreの通知名はSharedの操作定義から取得する。

- NativeMethods／Observerは最小化イベント、最小化／閉鎖のhit test、Win+↓／Win+Shift+左右／Alt+F4、画面情報を取得する。CandidateTrackerが入力と同一窓の前後状態・破棄・ドラッグ終端を照合し、Coreが採用条件と通知キーを決める。最小化・閉鎖後の前面変更を許すが、入力時の前面対象一致は必要。
- ドラッグの入力→開始は1秒以内。開始時の証拠を終端まで保持し、追加入力・取得失敗・対象process変更・停止で破棄する。途中変化と復元を別計上せず、終端が元画面なら0回。画面構成変更も除外する。方向付き通知は左右・上端一致・非重複の2画面だけ。
- JSON protocolVersionは1を維持。Candidateに任意の`afterArranged`・`fromMonitor`・`toMonitor`・`moveDirection`を追加しMainで型検証する。旧最大化候補はそのまま受信できる。復元は`afterArranged=false`、画面移動は異なる前後画面が必須。不足時は該当操作を見送る。helperとMainは同じbuildで同梱する。

2026-10-29 #38：W02はv1/v2 window証拠の`moveConfirmed=true`も必須とし、Nativeで解放/対象/構成/通常終端を確認する。方向不明時は記録のみ。単独操作の契約・人工検証・#113/#47との境界は[W02実装記録](monitor-move-implementation.md)を参照する。
- HWND・process・入力時の画面構成はhelper内の一時情報。構成比較に画面矩形だけを使い、title・path・キー生ログは送らない。通常保存のschemaVersion、操作ID、Preload APIは変更せず、既存記録と設定を引き継ぐ。

試験は本番C#→TS契約、Core→通知／集計／隔離保存、Electronの追加4操作mouse/key表示と全11行のキー、fixture通知画面を扱う。実入力精度・混在DPIの実画面・NSIS・通常60分は別の受入試験とする。

検証結果：型検査、unit 109件、native 5件（本番C# policy 61ケースを内部で実行）、helper／Electron buildが成功。通常・開発版・同梱版の隔離fixture smokeが成功し、11行のキー、追加4操作のmouse/key集計・保存、通知画面・focus不変、設定再読込、停止・削除・不正IPC拒否・hook解除を確認した。同梱版は`release/operation-detection/win-unpacked/Window Shortcut Coach.exe`。開発版起動と同梱版生成／起動はsandbox制限による初回失敗後に権限制限の外で再実行した。実入力は観測しておらず、実アプリの認識率・実画面のDPI条件・NSIS導入は未確認。コミット・push・PR作成は行っていない。

目的は誤案内・二重集計・保存喪失・入力阻害を検知すること。試験数やcoverageを公開合格の代わりにしない。追加時は利用者に影響する入出力・副作用を確認し、不具合は修正前に失敗する操作列を残す。期待値は要件から与え、実装のコピーを正解にしない。

| 層 | 本番の検証対象 | 隔離する境界・限界 |
| --- | --- | --- |
| 速いNode試験 | Coreの判定・時刻・状態列、Repository、ObserverClient、NotificationWindow | Electron/子プロセス/FS失敗を境界でfake。実入力・実画面の証拠ではない |
| C# policy | 本番CandidateTrackerとDisplayPolicyをリンクした`tests/native-policy`、serialize出力→TS検証・判定 | 人工事象・状態。Win32配送・アプリ精度を保証しない。assertはC#で実行し、Nodeサブテストに水増ししない |
| 実helper結合 | hook開始解除、start/stop/世代/EOF/shutdown | fixtureで入力payloadを読まない。callbackのOS取得は別確認 |
| Electron smoke | 実Main/Preload/React、通知、画面操作、IPC拒否、設定再読込、削除取消/確定、解除・終了 | 人工候補・専用userData。削除確認も本番Renderer dialogとMain単回tokenを通す。通常tray・インストーラー・実認識精度は別 |
| 同梱smoke | 同じbuildから生成したexe・preload・renderer・helper | 開発版と同じ隔離fixture。SDKなしでの導入とNSISは別 |
| 実機受入 | Windows 11通常権限、対象app・1〜2画面、同等キー・入力精度・通常60分・導入と削除 | 本人の明示的な同意後に実施し、成果物版/hashと実施条件を残す。既存MVP基準を維持 |

Node試験は`tests/*.test.ts`。`native`接頭辞はSDK/helperが必要なsuite、それ以外は速いsuiteへ自動収集する。コマンド・対象環境はREADMEとpackage.jsonを正本とする。zero discoveryを失敗にし、Nodeのmodule mockは外部境界だけに使う。実処理の失敗は握りつぶさず、native suiteを非Windowsでskipして合格としない。

非同期競合はdeferredで完了順を指定し、時間境界はfake clockまたは注入時計を使う。保存は隔離directoryで原本bytesと再読込結果、失敗後の復旧を確認する。通知は表示前後・表示中の抑制、世代、focus/click、消去を確認する。C#取得処理を変えた場合、policy試験だけで済ませずhelper再build・結合と必要な同意後の実機確認を選ぶ。

保存失敗後の設定は、後の正常保存を最新値とし古い保留を解消する。設定だけ復旧しても未保存記録とhelper故障を成功状態へ変えない。初回表示flagの保存失敗も保留設定として再試行できる。全停止中の通知flagは保持する。helper通信はrequestId・応答type・世代を照合し、旧プロセスの応答/exitを無視する。stdoutは改行前も上限を確認し、shutdownは応答後のexitを待ち、期限超過では強制終了する。

CIは`.github/workflows/quality.yml`でPR・main・手動実行時に先に差分を分類する。Markdownのみなら軽量Linuxで本番試験を省略し、`windows-quality`の成功は維持する。それ以外や手動実行・判定不能時はWindowsで型検査→速い試験→native→buildを実施する。続く通常版smokeと同梱生成は`scripts/ci-package-smoke.mjs`で重ね、確定済みout/helperを変更せず、両方の終了と成功を確認してから全ファイルhash・同梱smokeへ進む。失敗時も両方のログを回収する。GUI smoke同士は並列化しない。Windows x64 runner、採用Node/SDK、SHA固定Action、read権限、timeout、古い実行取消を使い、fixture診断だけ短期間保存する。branch protection等の外部設定・実機受入はこのworkflowの成功と別に確認する。

coverageはimportされたNode対象の未確認分岐を探す補助。未importのMain/Renderer・C#を含む製品全体の率とは呼ばない。mutation、長時間性能、OS/DPI matrix、実機アクセシビリティ、installerの自動化は必要性に応じて追加し、現在の受入条件を緩和しない。

### 追加と検証（2026-10-12）

- 保存/設定の失敗後の操作列、削除競合、深夜日付、通信の破損・期限・旧プロセス・EOF/終了、通知の抑制・期限・旧応答を回帰試験に追加。本番CandidateTrackerを人工事象で試験し、C# serialize→TS parser→採用判定も確認した。
- 設定の旧保留復活、設定復旧による記録/observer故障の隠蔽、初回flag失敗の再試行不足、全停止中の通知flag変更、旧helper/通知の競合、shutdownでexitを待たない問題、改行前の受信上限、窓破棄/別processへのcaption履歴流用を修正。frame単位のIPC送信者検証も追加。
- Nodeは速い102件＋native5件が成功（サブテスト含む）。C# policyの42ケースはnative suite内で別に実行し、Node件数へ水増ししない。型検査・helper/Electron build、通常と同梱の人工候補smokeが成功。UI制御、削除取消/確定、設定再読込、IPC拒否を確認。最終同梱の確認先は`release/quality-tests`。
- coverageコマンドも成功。対象はimport済みNodeコードのみ。Skill frontmatterとworkflow YAML、文書のローカル参照を確認した。CIの参照Actionは公式のcommit/input定義を確認しSHA固定したが、GitHub上のworkflowと必須チェック設定は未実行/未確認。
- Windows実入力の認識率、通常作業60分、混在DPI等の実画面、NSIS導入/再導入/削除、長時間性能、実機アクセシビリティは未確認。公開基準・候補数・通常保存内容を変更せず、実入力観測を行っていない。

## 過去の工程記録

<a id="refactor"></a>
<a id="design"></a>
<a id="implementation"></a>
<a id="environment"></a>

[2026-10-11〜12の初期設計・環境準備・実装記録](archive/design-implementation-history.md)はアーカイブへ分離しました。記載内容は過去の状態であり、現在の受入基準ではありません。
