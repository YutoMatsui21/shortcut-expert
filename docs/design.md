# 設計・実装状況

契約は[mvp-requirements.md](mvp-requirements.md)、実行手順は[README.md](../README.md)、根拠・原本は[research.md](research.md)。

<a id="architecture"></a>

## 開発順序の変更（2026-10-18）

現行5操作の条件付き検出は残すが、自然入力精度が未検証のため「検出対応済み」とは扱わない。初回リリース対象は12操作（W09・W14を除外）。

1. **契約と基盤**：Native候補→Main厳格検証→Core採用の境界を保ち、人工イベントで保存・集計・学習状態・通知・画面を実装する。イベントID・操作ID・由来・日時・検出確証・同等キーの整合を守る。検出器実装を基盤の着手条件としない。
2. **UI**：12操作を「準備中」と表示する。学習状態3種とは別軸。記録なし/観測欠損/既存履歴を混同しない。
3. **隔離統合**：fixtureを実記録と混ぜず、基盤版で回帰を通す（#43）。この合格は自然入力精度や最終版の証明ではない。
4. **検出器**：7操作 W03/W05/W04/W06/W07/W02/W11、残る5操作 W12/W01/W10/W08/W13。各操作の技術前提と既存安全契約を検証する。
5. **最終受入**：同一製品buildで回帰試験とR02の自然入力確認を行う。手動は各ケース原則1回、予想外の結果だけ再試行する（2026-10-24本人指示）。12操作と必要条件の確認が揃うまで公開しない。単発結果から精度率を実証したとは扱わない。

既存の工程記録・旧MVP要件・除外前Specの実施順より、この現行方針を優先する。Issue [#14](https://github.com/YutoMatsui21/shortcut-expert/issues/14)は検出器側の技術審査であり、UI/保存の着手ゲートではない。
## 現行アーキテクチャ

#46の隔離UI受入はMainの`ui-acceptance.ts`が本番CoachWindow/Rendererを計測する。起動scriptが新規fixture保存先と配布物hashを記録し、helperは実入力を読まない。[責務・結果・証拠の範囲](ui-acceptance.md)。

日別保存は[保存契約と検証](durable-storage.md)に従う。Mainの`sqlite-repository.ts`が単一writerと専用`storage-worker.ts`を所有し、`storage-store.ts`だけがSQLiteへアクセスする。Coreの`durable-coach.ts`は限定Repository契約を介して、件数・coverage・時計高水位・非重複checkpointを同時保存する。Core/Rendererは最大60日のread modelだけを持つ。Worker起動時の`storage-migration.ts`が旧JSONの厳格検査とstagingへの移行・再open照合・有効化を担当する。旧JSON用`Coach`/`JsonRepository`は隔離回帰試験用に維持し、通常起動は30日剪定を通さない。移行・削除の故障時も旧JSONへのfallbackは行わない。[移行契約](json-migration.md)を参照。限定bridgeの`getRecords`はMainでsender/mainFrame・実在日付・最大60日を再検証する。

機能追加・リファクタ・責務配置の判断に用いる。下記の責務分担を現行方針とし、後続の工程記録は当時の状態を示す。

| Module／配置 | 責務 |
| --- | --- |
| Core／`src/core` | 操作判定、集計、利用状態、純粋な日付処理。保存・通知は受け取った依存を呼び、Node・Electron・Windows APIを直接使わない |
| Main／`src/main` | Electron制御、保存実装、helper接続、通知、アプリ内スモーク試験 |
| Preload／`src/preload` | 型付きIPCによる状態取得・制御・設定・削除の橋渡し |
| Renderer／`src/renderer` | 数値・設定画面と通知画面、利用者の指示。OS観測・ファイルI/OはMainへ要求する |
| Shared／`src/shared` | 共通型・操作定義。Node・Electron・Windowsへの依存を持たない |
| Native helper／`native-helper` | Win32宣言、観測・候補生成、JSON Lines通信、画面照会。採用判断と案内キーの決定はTypeScript側で行う |

### 依存方向と拡張

- MainはCore・Sharedを利用し、CoreはSharedと純粋な処理を利用する。CoreからMainを参照しない。
- RendererはSharedと必要な純粋関数を利用する。Mainとの通信はPreloadが公開する橋渡しを使う。
- Mainの`CoachWindow`（`coach-window.ts`）は単一の数値窓の生成・非表示・最小化からの復元・前面化・状態配信を担当する。トレイと二重起動は共通の`showCoach`を呼ぶ。`coach-ipc.ts`はIPC登録・送信元frame・引数検証と`DeleteConfirmation`の短命・単回tokenを担当し、検証後に`coach-app.ts`の処理を呼ぶ。計測制御・直列化・削除実行・終了判断は`coach-app.ts`に残す。確認UIはRendererの`DeleteDialog`で、キャンセル初期focus・modal Tab拘束・Esc取消と二重click防止を持つ。
- #22の通常boundsはCoachWindowがDIPで取得し、Mainのwindow-boundsがwork areaへ補正する。Coreの設定キューから既存SQLite Workerへ保存する。最大化状態は非永続のsnapshot項目。coach-appの終了は重複要求をまとめ、制御待機→停止→bounds/保存flush→未保存確認→helper/Worker終了を待つ。[契約・V03未確認条件](window-lifecycle.md)。
- #23のSettingsPopoverは共通gearの下に2スイッチを表示し、トレイと同じMain commandでsessionの通知pause・計測stop/startを制御する。停止中は通知の希望値を保持して変更を無効にする。CoachWindowの非永続stateVersionで、Rendererが新しい配信後に届く古いIPC応答を無視する。[設定パネル・検証範囲](settings-panel.md)。
- #17のAppShellでは`CoachApp.tsx`が単一のuseCoach購読・2ページ・session表示状態を所有する。7日記録表示は`RecordsPage.tsx`に置き、一覧は`LearningPage.tsx`、7日集計はCoreの`learning.ts`へ置く。Mainの限定`getLearning`から実読取モデルを返す。[一覧の契約・assets・検証](learning-ui.md)。
- #18の3学習状態はSharedで解決し、Mainが検証した`setLearningState`をCoreの直列キューから既存settings保存へ渡す。DurableCoachの確定済みcounts/settings/revisionから一覧を生成する。全状態で記録を継続し、失敗時の保留は成功状態として表示しない。[保存・互換・検証範囲](learning-ui.md#3状態18)。
- #26のDurableCoachは受理時の通知tokenと発行直前の状態を照合し、保存成功後にMainのStandardNotificationsへ毎回要求する。Mainは新規instance/UUID、正式名・証明キー、無音・OS時間で発行し、要求/API返却/イベント/失敗/不明を分ける。配送応答をwriterで待たず、障害後に通知を再送しない。起動時のAUMID・global activationとinstance clickは共通showCoachへ集約する。旧NotificationWindowはJSON隔離fixtureだけで使う。[通知・参照寿命・未確認のOS受入](standard-notifications.md)。
- #27のMain indexはsingle-instance lock取得後にglobal activationを登録し、表示しないNotification instanceでWindows presenter/COM受信初期化を開始する。CoachWindowが読込前/読込中の表示要求を保留する。coldではopenedにかかわらず一覧を表示して通常の起動経路で計測し、稼働中clickは既存窓復元のみで停止/pauseを保持する。NSIS shortcut名とAUMIDは既存identityを維持する。COM ready race・旧通知から更新/再導入版の起動・OS focusは配布版受入が残る。
- #19の記録ページはCoreの`records.ts`で操作別7日集計とKPIを生成する。限定`getRecordSummary`がCore直列キュー→Repositoryの7日query→同一revision確認→12行/KPIを返す。Rendererは全履歴を取得せず、共通Shellに縦積み/4列表を表示する。[記録の契約・検証](records-ui.md)。
- #25のDurableCoachはSnapshotへerrorKindを渡し、両画面の共通SaveErrorBannerが固定header直下に表示する。記録/設定保存、保存先読込、時計、observerを区別し、retryは同一checkpointの保留差分だけを再送する。保存復旧はobserver/時計故障を解除せず、通知tokenを復元せず、観測も自動再開しない。[保存・障害契約](durable-storage.md)。
- #20の記録queryはSharedの期間/フィルタ/ソート型をMainで検証し、CoreのrecordsReadModelが現在の操作集合を両期間・KPI・比較・欠損判定へ共通適用する。DurableCoachが同じ直列キューで最大60日を一括読取し、整数分数の丸め前ソート結果を返す。AppShellは表示条件をsessionだけに保持する。#21のRecordsPageはこの比較値をKPI/操作行へ表示し、MissingCoverageInfoが説明のhover/focus/クリックと画面内配置を担当する。[記録queryの契約](records-ui.md)。
- C#のWin32宣言はNativeMethods、通信制御はObserverHost、型付き証拠と最終送信の直列化はCandidateProtocol、画面照会はDisplayContext、純粋な全画面分類はDisplayPolicy、フック・Windows状態取得はObserver、取得済み事象からの候補組立はCandidateTrackerに置く。
- W08の入力・50ms照会は既存hookを共用するSnapInvocationObserver、純粋な滞在/キー/設定/幾何判定はSnapInvocationPolicyに置く。専用v2証拠をMainで検査しCoreでW08へ判定する。[契約・検証と未受入事項](snap-invocation.md)。
- 同意後のW08製品受入は`w08-natural-acceptance.ts`が試行の開始/停止と集計差分だけを担当し、別processの手動panelから操作する。専用flag以外では接続せず、通常の検出・保存・通知処理を共用する。
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

全体に適用する短い参照指示は[AGENTS.md](../AGENTS.md)、責務と判断理由は本節に置く。テスト追加の反復作業は[リポジトリSkill](../skills/test-shortcut-coach/SKILL.md)から下記のテスト設計へ案内する。
根拠：[AGENTS.md公式資料](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[Skills公式資料](https://learn.chatgpt.com/docs/build-skills)、[指示を簡潔に保つ方針](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)。

<a id="test-design"></a>

## テスト設計

テスト実行入口`scripts/test.mjs`はunit/nativeの分類、module mock有効化、timeout、coverage条件を共通化する。ファイル・名前・reporter指定の使い方は[README](../README.md#修正中のテスト絞り込み)に集約する。`tests/test-runner.test.ts`は隔離fixtureを別プロセスで実行し、選択したテストだけの実行、失敗終了コードの伝播、既定の全件実行、native分類、誤った引数の拒否を確認する。製品の検出・保存・通知経路の試験とは分ける。

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

CIは`.github/workflows/quality.yml`でPR・main・手動実行を対象に、型検査→速い試験→native→build→smoke→同梱生成→同梱smokeを実施する。Windows x64 runner、採用Node/SDK、SHA固定Action、read権限、timeout、古い実行取消を使い、fixture診断だけ短期間保存する。branch protection等の外部設定・実機受入はこのworkflowの成功と別に確認する。

coverageはimportされたNode対象の未確認分岐を探す補助。未importのMain/Renderer・C#を含む製品全体の率とは呼ばない。mutation、長時間性能、OS/DPI matrix、実機アクセシビリティ、installerの自動化は必要性に応じて追加し、現在の受入条件を緩和しない。

### 追加と検証（2026-10-12）

- 保存/設定の失敗後の操作列、削除競合、深夜日付、通信の破損・期限・旧プロセス・EOF/終了、通知の抑制・期限・旧応答を回帰試験に追加。本番CandidateTrackerを人工事象で試験し、C# serialize→TS parser→採用判定も確認した。
- 設定の旧保留復活、設定復旧による記録/observer故障の隠蔽、初回flag失敗の再試行不足、全停止中の通知flag変更、旧helper/通知の競合、shutdownでexitを待たない問題、改行前の受信上限、窓破棄/別processへのcaption履歴流用を修正。frame単位のIPC送信者検証も追加。
- Nodeは速い102件＋native5件が成功（サブテスト含む）。C# policyの42ケースはnative suite内で別に実行し、Node件数へ水増ししない。型検査・helper/Electron build、通常と同梱の人工候補smokeが成功。UI制御、削除取消/確定、設定再読込、IPC拒否を確認。最終同梱の確認先は`release/quality-tests`。
- coverageコマンドも成功。対象はimport済みNodeコードのみ。Skill frontmatterとworkflow YAML、文書のローカル参照を確認した。CIの参照Actionは公式のcommit/input定義を確認しSHA固定したが、GitHub上のworkflowと必須チェック設定は未実行/未確認。
- Windows実入力の認識率、通常作業60分、混在DPI等の実画面、NSIS導入/再導入/削除、長時間性能、実機アクセシビリティは未確認。公開基準・候補数・通常保存内容を変更せず、実入力観測を行っていない。

## 関数内の整理結果（2026-10-12）

通知条件を名前付きの処理へ分離し、保存文書の検証を段階化した。直列キューを共通化し、Win32定数とアプリ固有の閾値を命名した。日付境界の重複計算と同じ同期区間のsnapshot複製を減らし、判断理由とdelegateの寿命にコメントを付けた。保存形式・IPC・helperプロトコル・表示・判定条件は維持している。

- 型検査・helper再ビルド・60件のテスト（サブテスト含む）・Electronビルドと同梱版生成が成功。通知期限と間隔、表示見送り、保存中の停止、除外候補のsequence、保存原本保持、キューの失敗後の継続を確認した。
- 通常・開発・同梱版の人工候補スモークで集計、重複／unknown除外、保存、2画面、フォーカス不変、通知消去、観測終了を確認。規約と計画への適合を別々にレビューし、指摘事項はなかった。

同梱版は`release/local-refactor/win-unpacked/Window Shortcut Coach.exe`。実入力精度・実画面の全画面判定・速度の差は今回測定していない。

## 責務分離の実施結果（2026-10-11）

保存実装をMainへ移動し、スモーク試験・Reactの2画面・C#のAPI宣言／通信／画面照会を分離した。上記の責務分担をAGENTS.mdから参照する構成にした。保存形式、IPC、helperのプロトコル、画面文言、判定条件は維持している。

- helper再ビルド・型検査・18テスト・本番ビルド、通常／開発／最終同梱版の人工候補スモークが成功。通常モードの隔離データでもトレイ、閉じた後の観測継続、停止／再開、通知設定、削除の取消／確定、終了を確認した。削除ダイアログの返答は試験側で置換して各経路を確認した。
- 文書をdocs、検証コードをvalidation/probes、実測原本をvalidation/evidenceへ移動。原本6ファイルのSHA-256が一致し、health probeの再ビルド・実行と純粋ロジック12ケースが成功した。生成物は.tools/validationに置く。
- 方針を新操作追加・保存処理変更・画面変更の3ケースで読み合わせ、担当箇所と必要な参照先を確認した。構成ルールと計画への適合を別々にレビューし、指摘事項はなかった。人工試験の成功は実入力精度の証拠にはしない。

[承認済み最小設計](#design)・[実装と試験結果](#implementation)・[環境準備時の記録](#environment)。以下は過去の工程記録。設計は残る候補も含み、実装済みはW03のみ。

2026-10-11整理後：環境準備専用の画面・IPC・health起動経路を削除し、人工候補を使うアプリ接続試験へ統一。日付生成と停止指示の重複を整理。現在のhelperはWinFormsのみを使い、未使用のWPF／UIAリンク確認依存を外した。UIAが必要な候補の実装時に参照を追加・検証する。以下の過去の試験名・コマンドは当時の記録で、現在の実行手順はREADMEに従う。

<a id="refactor"></a>

## 整理結果（2026-10-11）

- プロジェクト文書14本をREADME／要件書／本書／researchの4本へ統合。旧文書の必要な本文を保持し、参照先・章アンカーを更新。一次資料リンク、実測と人工試験の区別、未確認事項、工程時間を残した。
- research-cacheのダウンロードコピー、probe生成exe6本、固定fixture画像2枚、原本とSHA-256が一致するlatestログコピー3本を削除。probeソース、異なる時刻付き原本、初回原本、native-health結果を保持。古い隔離試験データと準備用Electronデータも削除し、現行試験分だけ再生成。
- 設定・集計保存形式と操作判定の仕様は維持。環境準備だけのReact画面・preload IPC・helper health・型を削除。helperの場所解決をobserverへ集約。トレイの通知停止も共通commandを使い、日付生成は既存関数へ統一。内部の日時整理メソッドをprivate化。
- 開発・同梱smokeを現行の人工候補による接続試験へ統一。開発の直接起動でも毎回別のfixtureデータへ保存し、既存記録と混ざらない。未使用WPF依存を外し、publish成功後に同梱helperを置換して古いDLLを残さない。
- 17件の試験、型検査・build、文書内リンク74件、開発smoke、同梱版＋実画面状態のsmokeが成功。通知内容・focus不変・4秒消去・保存・重複／unknown除外・hook解除を確認。実入力認識率の公開合格とは区別する。
- 最新実行ファイルは`release/refactor-20261011/win-unpacked/Window Shortcut Coach.exe`。未使用の旧win-unpackedとビルド途中のwin-unpacked.tmpを削除。実際に起動中だったfix-20261011は保持した。旧版を「終了」してから最新を起動する。

記録できた区間17:09:48→17:25:59 JST、16分11秒（権限・build・試験待ち含む）。それ以前の読解・最初のコード整理と末尾の記録・応答は未計測。内容の手戻り0、patchの同一ファイルdelete/add指定は受理されず1回書込み方式を変更。要件の削減なし。個別試験ファイルは検出・制御・保存・nativeの責務が異なるため維持し、ファイル数だけを目的にコードを結合しない。

<a id="design"></a>

## 最小設計（ステップ4）

状態：2026-10-11 15:21:06 JST承認・ステップ4完了。Electron＋C# helperと常駐は本人合意。導入はコマンドを希望、追加工数次第で変更可能、npx指定は必須ではない。ステップ5「環境準備」への進行も承認済み。製品の操作計測ロジックは後工程。

要件の正本：[mvp-requirements.md](mvp-requirements.md)。検出の仮説・残リスク：[操作別の技術判断](research.md#operations)。本書は最小設計の決定を記録し、技術検証の詳細を複製しない。

### 構成

Electron＋TypeScript／React＋C#／Win32 helperを採用。既存のhelper→TSのJSON接続証拠を利用する。Electron mainが制御・集計・保存・通知を所有し、Reactは表示と利用者の指示を担当する。Next.js・外部backend・DBサーバーは導入しない。

C#は一般に最良と断定した選択ではない。この作業では既にWindows観測・UIA・TS接続のC#試作があり、実装の見通しを引き継げるため推奨する。既存probeの誤分類は引き継がず修正する。言語を分けることでhelperのビルド・配布確認が必要になる。

| Module | 責務／Interface |
| --- | --- |
| Windows観測 | helper内で入力候補・対象窓・開始／終了状態・画面・UI識別をまとめる。start／stopと、完了した操作候補・稼働状態をJSON Linesで交換。キー生ログや窓タイトルは送らない |
| 操作判定 | TS内で候補を評価し、採用可能な操作ID・mouse/key・同等キー・通知画面、または見送り理由を返す。操作ごとの前提と複合変化の扱いをここへ集める |
| 利用制御・記録 | main内で稼働状態・セッション世代・通知間隔・操作別mute・日別数値・保存を一元管理。判定された1操作を1回だけ受理する |
| 表示 | Reactの数値／設定画面と通知画面。狭いIPCを介して状態取得・設定変更・削除を要求する。OS観測やファイル書込みを直接行わない |

helperがOSの時間順序と入力候補の寿命を管理し、TSが操作の意味・通知するキーを判断する。判定の試験は同じ候補入力と結果出力を使い、既存probeを製品へそのまま移さない。

### 観測と判定

流れ：OSの入力・状態変化 → helperで操作候補を完結 → TSで対象／由来／結果／同等キーを照合 → 日別数値更新 → mouseなら通知条件を確認。

- 候補にはprotocol版、セッション世代、単調な候補ID、開始／終了時刻、実行中のみ有効な窓識別子、対象アプリ識別、入力経路・競合／注入／欠落flag、前後のplacement／arranged／可視矩形／画面情報、必要時だけUI識別の結果を持たせる。入力は該当操作の経路とショートカット種別に絞り、文字・キー生ログを渡さない。永続化は日別数値と設定だけ。
- 近接した入力だけで確定しない。注入・競合・対象不一致・観測欠落はunknownとして通知／集計を見送る。OS因果関係の保証とは呼ばない。
- dragは開始と終端を比較。最大化から復元して別画面へ移動した場合はW02の1操作。途中の復元・境界往復を別計上せず、元画面終了は移動0。
- 四隅への連続キーはTSの判定で途中の左右半分を保留して一連の操作として解決する。helperの候補IDを消費し、同一対象・連続する前後状態・対応したキー経路の候補だけを統合する。競合・欠落・終端が決まらない候補を推測で計上しない。一定時間後に独立したW06の条件が成立していれば1回として確定する。具体的な時間値は実装時の配送観測から設定し、全停止・日付変更時の未完了列は破棄する。
- 同じ候補IDを再受信しても再計上しない。再開・helper再起動では世代を更新し、古い候補を破棄する。
- 11候補・4アプリを維持。採用表は操作×アプリ×成立条件で管理し、未確認条件を対応済みと表示しない。候補削減は相談する。

### 制御・保存

- 利用状態は「稼働」「通知停止」「全停止」。通知停止中は記録継続。全停止は新規受理を即時停止し、helperの観測解除完了を確認する。再開は新しい初期状態から開始する。
- 通知停止は独立したflagとして保持し、全停止中に通知停止flagを変更しない。全停止から再開した際は停止前の通知設定へ戻る。起動時は全停止・通知停止とも解除し、操作別muteを読み込む。
- helperへの命令はstart／stop／shutdown／queryDisplayContext、応答はready／started／stopped／candidate／displayContext／fault。命令にはrequestIdと世代を持たせる。queryDisplayContextは通知前の対象画面・全画面判定の取得用。停止確認が期限内に来なければ子プロセスを終了し、解除失敗を表示する。自動再開せず、手動再開で再初期化する。親の通信が閉じた場合もhelperは観測解除・終了する。
- 操作別muteは状態と独立して保存。停止状態は保存せず再起動で稼働へ戻る。停止・終了時には表示中の通知も消す。
- helper異常時は観測停止を画面に示し、古い候補を使わない。保存失敗は利用者へ知らせ、未保存数値を通常保存済みとして扱わない。
- 保存はuserData内のcounts.jsonとsettings.json。countsはschemaVersionとローカル日付→操作ID→mouse/keyの整数だけ。settingsはschemaVersionと操作別mute、初回画面表示済みflagだけ。
- helperの操作完了時点のローカル日付へ計上。通知間隔・候補期限は単調時計を使い、端末の日時変更から切り離す。今日を含む30暦日を保持し、起動・日付変更・更新で期限を整理。時計を後退させて未来日付の既存記録が生じた場合は、計測と保持整理を止めて日時確認を案内し、既存記録を黙って削除しない。端末日時を戻すか、利用者が記録全削除後に再開する。これを時計異常時の例外動作としてREADMEへ記載する。
- 同一プロセスで書込みを直列化し、一時ファイルから置換する。日別数値の全削除は進行中の候補・保留書込みも整理し、設定は保持。異常終了直前の保存保証は実装・公開前確認で明示する。
- 受理した操作ごとに更新した集計を保存し、完了後に通常の数値表示と通知へ進む。書込み失敗は未保存の集計をメモリーで保持し、観測を止める。再試行・全削除・終了時の未保存表示を用意し、再試行で二重加算しない。読込み時のJSON破損も空データへ黙って置換しない。通常の終了では保存完了を待つ。
- 全削除は利用者確認後、観測の受理を止め、未完了候補・未保存集計・旧世代を破棄し、保留書込み完了後に集計と一時ファイルを空にする。設定を保持し、削除成功後は元の稼働状態へ戻す。削除失敗時は停止を維持する。
- 通常実行では診断イベント／候補のファイル出力をしない。rendererはNode無効・contextIsolation有効とし、preloadが型付きの状態取得／制御／設定／削除だけを公開する。単一起動にし、多重観測と多重書込みを防ぐ。

### 通知・数値UI

- 常駐トレイから「記録を見る」「通知停止／再開」「全停止／再開」「終了」。設定／数値画面を閉じても観測・記録・必要な通知を継続する。初回起動は数値画面を開き、以降の起動はトレイから利用する。自動起動の設定は初期版に追加しない。
- 数値画面は状態、日付選択、当日または選択日の合計、操作別mouse/key、操作別通知ON/OFF、記録全削除。mouse/keyを並べ、習得率へ換算しない。
- 通知は操作名＋同等キー、対象画面右下、4秒、同時1件。全体10秒／同一操作60秒の間隔は実際に表示した時点から測る。見送り通知はqueueしない。
- 通知はフォーカスとクリックを奪わない。操作別muteの変更は数値／設定画面で行う。
- 全画面・画面不明・判別不能時は通知だけ見送り。W11は閉鎖前の画面を保持。W02は移動先、それ以外は操作対象または操作したShell UIの画面を使う。候補時の状態に加え、表示直前に対象画面の全画面状態をhelperへ問い合わせる。判定不能・照会失敗・画面変更は見送る。表示中に抑制条件になった場合は消す。物理座標からElectronのDIPへ変換し、負座標・混在DPIを配布前に確認する。
- UIの工夫案：mouse/keyを同じ行に並べて日別の利用状況を確認。内部の工夫案：完結した操作候補で派生復元・途中配置を吸収して過剰計上を防ぐ。

### 配布・実装順

初期版はWindows x64のインストーラーを優先（本人指定）。electron-builderの安定版とNSISでユーザー単位のSetup.exeを作り、Electronとhelperを同梱する。PowerShellからバージョン固定の配布物を取得・ハッシュ照合・インストーラー実行・終了コード確認する導入方法をREADMEへ載せる。NSISの/Sを用いた導入を配布試験で確認する。配布先・製品名・実コマンドは公開物を用意してから確定し、現時点で実行可能なURLやコマンドはない。

コマンド導入は希望、npx指定は必須ではないという本人回答に基づき、まず既存インストーラーをコマンドから実行する方式を設計の基準とする。npx用CLIはnpm公開・バージョン管理・追加試験の工数を環境準備／配布時に見積もり、小さく済む場合に追加を提案する。コマンド導入自体が著しく時間を要する場合は相談し、インストーラーのみへ変更する。ZIPはその次の代案とする。導入時のダウンロードと、アプリの操作記録を外部送信しない要件は区別する。

helperは.NET 10 LTS、net10.0-windows／win-x64のself-contained配布を基準とする。UIAを含む依存のビルド確認はステップ5。AOT・trimming・単一exe化は初期版の条件にせず、publishしたフォルダーを同梱する。開発側はSDKが必要、利用側はNode.js／.NETの別導入が不要となる構成を目指す。OS側のnative依存と通常権限での起動は別途確認する。同梱runtimeの更新はアプリの再配布で行う。

導入・再導入・アンインストール、アプリとhelperの終了、ライセンス告知、未署名配布の実際の起動経路を配布前に確認する。記録削除はアプリの全削除操作、設定を含む完全削除はREADMEのuserData削除手順で説明する。自動更新・winget登録・npm公開は初期版の必須条件に追加しない。製品名・ライセンス・公開先は公開準備で決める。

根拠：[electron-builder NSIS安定版資料](https://www.electron.build/v26/docs/nsis/)、[NSISコマンド引数](https://nsis.sourceforge.io/Which_command_line_parameters_can_be_used_to_configure_installers)、[npm npx](https://docs.npmjs.com/cli/v11/commands/npx/)、[.NETサポート方針](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core)、[self-contained配布](https://learn.microsoft.com/en-us/dotnet/core/deploying/)。手段の仕様と、このアプリの配布確認完了は区別する。

1. 環境準備後、W03の成立条件で観測→判定→通知→保存→数値表示を縦につなぐ。
2. 停止・mute・削除・保存失敗・helper終了と復帰を通す。
3. 状態変更W04/W05/W11、複合移動W02、配置W06/W07へ拡張。
4. W01/W09/W10はUI識別の必要情報を確認しながら接続。W08はメニュー表示の直接検出を前提にせず、対象窓・入力・Snap設定から呼び出しを推定する（[W08新仕様](ui-redesign-requirements.md#w08配置候補を呼び出す2026-10-23-仕様変更)、[#83の実測](research-snap-invocation-validation.md)）。製品精度の確認は別途必要。
5. 要件書の公開前試験・通常利用60分・配布物確認。3日で全候補成立を保証しない。

### 合意・確認と次工程

本人合意：構成・常駐。本人希望：インストーラーとコマンド導入を優先し、追加工数次第で変更可能。npx指定は必須ではない。初回ZIP案を更新した。

設計にまとめた実装判断：Moduleの責務、候補の受渡し、複合操作・unknown・重複、停止確認、保存／削除／日時異常、数値UI、全画面抑制、配布依存、実装順。追加の本人試行は要求しない。

実装へ残す事項：操作別の具体的なタイムアウト／座標許容値、動的API取得、UIA識別、常用4アプリの成立条件、通知／混在DPI、SDKでの移植・同梱起動、負荷、配布物の実コマンド。いずれも確認済みとはしない。公開範囲を減らす場合や要件を弱める場合は相談する。

本人の「OKです」によりステップ4完了・ステップ5へ進行。ステップ5はNode／package manager／.NET SDK確認、React・Electronの雛形、helperのビルドと同梱の入口まで。操作判定の製品実装はその後に行う。

<a id="implementation"></a>

## ステップ6：実装記録

2026-10-11 15:50:23→16:32:03 JST：W03最大化の初回接続区間完了。
ステップ6全体は継続。11候補を維持し、残る10候補は未実装。公開対応数の確定・要件削減は行っていない。

正本：[mvp-requirements.md](mvp-requirements.md)。設計：[最小設計](design.md#design)。起動：[README.md](../README.md)。

### 実装した動作

- Native helperのstdin／stdout JSON Lines。start／stop／shutdown／画面状態照会、世代・requestId、タイムアウト、親のstdin終了時の解除・終了。
- 通常権限のchrome／obsidian／code／chatgptを候補対象にする。Codexは含めない。WinEvent・mouse/key hooksで前後状態と入力候補を取得し、TSでW03を判定。
- W03は通常・非arranged→最大化、標準最大化button／caption double-click／Win+Upと対象が対応する条件。IsWindowArrangedが未提供なら開始しない。昇格／権限不明の対象を除外し、remote sessionでは開始しない。
- 未知・注入・競合・drag中・対象不一致・期限外は通知／集計を除外。近接は1000msの初期値で、因果関係のOS保証とは呼ばない。button hit testは10msで打ち切る。独自UIは推測で扱わない。
- 正しく受理した候補だけを1回集計。世代＋単調sequenceで重複・再開前の候補を除外し、保存と通知を直列化。
- 保存・IPC・描画待ちで受信から2秒を超えた候補は記録だけを残して通知を見送る。通知ウィンドウでも表示直前に期限・停止世代を再確認し、遅れた通知をqueueしない。
- mouseの通知は操作名＋Win＋↑。対象画面右下、focusable=false、showInactive、クリック透過、4秒、全体10秒／同じ操作60秒、同時1件、queueなし。物理座標→DIP変換、表示前／表示中に画面全体を覆う窓を照会し、不明は抑制。
- 数値UI：当日／保存日の合計・操作別mouse/key、11候補一覧、操作別通知ON/OFF、通知停止／全停止、全日分削除。未実装候補を準備中として区別。
- トレイ常駐。画面の×はhide、トレイから終了。停止は再起動で解除、muteを保存。自動起動登録なし。
- counts.json（schemaVersion＋日付→ID→mouse/key）とsettings.json（mute＋初回画面表示flag）。一時ファイルへ書込み・flush後に置換、形式検査、30暦日保持、未知の生データを拒否。
- 保存失敗は未保存分をメモリーに保持し、観測・通知を止めて再試行を表示。破損読込みは元のファイルを保持。全削除は古い候補と保留処理を整理し、設定を残す。

### 確認した範囲

| 確認 | 結果 |
| --- | --- |
| npm test | 14件成功。判定の負例、重複・同時受信、keyへの無通知、停止／mute／頻度、保存失敗・再試行、保存遅延時の無通知、保持・削除、時計後退、形式検査・読み戻し、Native hook登録／解除・親stdin終了 |
| npm run build | 最終のC# publish／TS型検査／Electron・React build成功 |
| npm run smoke:coach | fixtureのmouse1・key1、重複／unknown0、JSON保存、React表示、非フォーカス通知、4秒消去、hook解除に成功 |
| npm run package:dir | 最終実装のhelper同梱フォルダー作成成功。1回のrename EPERM後、再試行で解消 |
| npm run smoke:coach:packaged | 同梱版でも同じ接続確認成功、終了コード0 |
| 画面確認 | 自分の数値画面と通知のPNGを確認。日本語・数値・キー案内が表示される |

同梱版の試験データ・画像は`.tools/tests/coach-*`。通常の記録と分離し、公開データではない。当時の数値・通知画面を画像で確認した。固定画像は整理時に削除し、smokeで再生成できる。数値1／1はテストデータ。
fixtureはNativeのテスト専用経路から人工候補を送る。hookは登録・解除するが、fixture中のcallbackはpayloadを読み込まない。キーの自動入力・本人への追加反復依頼は行っていない。
通知表示前後のforeground tokenを比較して不変を確認したが、今回の試験条件の証拠であり一般保証とはしない。

### 2026-10-11 本人報告後の修正

本人報告：Chrome／ChatGPTの通常窓のマウス最大化は数値が増えるが通知なし。左右スナップからの最大化は数値も増えない。

- 通知：実際の2画面で`--display-check`がともにknown=true／fullscreen=true。画面1はcovering=1／cloakedCovering=1、画面2はcovering=1／maximizedCovering=1。表示されていないDWM cloaked窓と、通常最大化窓を矩形だけで全画面扱いしていた。元の判定で通知可のassertionが失敗することを確認。cloaked窓を除外し、最大化かつcaptionありの窓を通常窓として扱う。borderless全画面・状態不明は引き続き抑制する。
- 集計：before.arranged=trueをW03から除外していた。入力と実際の最大化結果が一致する場合は、スナップからの最大化も集計する。スナップ中のWin＋↑は配置になる場合があるので、同等キー未確認のマウス操作は記録のみとし案内しない。未知の入力由来や移動中の派生変化は引き続き除外。
- 回帰試験17件・build成功。全画面判定の通常最大化／cloaked／borderless全画面／unknownと、スナップ最大化の集計・無通知を追加。判定の失敗を見てから修正。
- 修正後の実画面判定は両画面known=true／fullscreen=false。元の再現assertionも成功。同梱版で人工候補＋実際のWindows画面状態を使う通知表示試験成功（realDisplayContext=true、focus不変、4秒消去、hook解除）。人工候補なので本人の実操作の認識率合格とは区別する。
- 更新先の旧版が起動中で上書きできず、修正版は`release/fix-20261011/win-unpacked/Window Shortcut Coach.exe`へ作成。旧版を「終了」してから修正版を起動する。通常保存先は同じなので既存記録・設定を引き継ぐ。旧版プロセスを強制終了していない。
- `--display-check`は画面ごとの判定と件数だけ出力し、hookを開始せず、窓名・タイトル・キー・画像を保存しない。表示試験の`--real-display`も入力候補は人工であり実入力を読まない。

記録できた区間16:47:20→16:55:59 JST、8分39秒。調査開始から16:47:20までと末尾の文書保存・応答は未計測。回答・build・権限・表示待ちを含む。既存実装の修正2件。配布手順の手戻りはsandbox cache EPERM1件、旧版ロックEBUSY1件→別フォルダー作成で解消。

根拠：[IsZoomed](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-iszoomed)、[DWMWA_CLOAKED](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute)、[Windowsのキー](https://support.microsoft.com/en-us/windows/keyboard-shortcuts-in-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec)、[Snap](https://support.microsoft.com/en-gb/windows/experience/snap-your-windows)。caption＋最大化で通常窓と区別する条件は製品側の合成であり、全アプリの全画面状態を保証するAPIとは扱わない。

### 未確認・制約

- 新しい実装でのChrome／Obsidian／VS Code／ChatGPTの実mouse/key認識率は未測定。既存probeの実測を新実装の合格へ流用しない。
- mixed DPI・負座標・画面変更・全画面の実アプリ試験、管理者／remote除外の実機負例、負荷・通常利用60分、保存失敗時の実ディスク／強制終了は公開前に確認する。
- 全画面判定はDWM cloak・最大化・caption style・矩形の合成。desktop／taskbarはclassで除外し、Explorerのアプリ窓も抑制判定へ含める。OS／アプリ固有の全画面状態、captionを残す独自全画面、背景のborderless窓の実機確認は残る。
- low-level hookにはタイムアウトによるsilent removalがあり、登録成功を継続配送の保証と扱わない。callbackの負荷と取りこぼしは実利用確認に残す。
- その他10候補、UIA識別、複合移動／snapの判定は次の実装区間。候補を削る場合は相談する。
- インストーラーの導入・削除、コマンド導入、npx追加工数、正式名称・OSSライセンス・署名・README公開対応表は未完。公開MVP完成とは扱わない。

### 手戻り・時間

開始15:50:23→最後の同梱確認終了16:32:03、経過41分40秒。
把握できた作業区間も同区間で、読解・TDD・実装・build・権限待ち・表示試験・確認を含む。純粋なコード記述時間とは呼ばない。以降の最終文書保存・応答は未計測。
TDDの意図したred→greenは欠陥の手戻りと別に扱う。手戻りはTSのmonitor型絞込みとclosure変数の型検査修正2、同梱作成のWindows rename再試行1。追加の内容確認で、全画面対象をprocess除外からShell class除外へ補正1、遅延通知を試験で再現して期限判定を追加1。初回接続の要件変更0。

根拠：[WinEvent](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook)、[low-level hook](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelmouseproc)、[TokenElevation](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ne-winnt-token_information_class)、[GetTokenInformation](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation)、[Electron screen](https://www.electronjs.org/docs/latest/api/screen)。操作の前提・残リスクは技術判断書を継承する。

<a id="environment"></a>

## ステップ5：環境準備

2026-10-11 15:21:06→15:40:23 JST完了。経過19分17秒。
ステップ4承認済み。[最小設計](design.md#design)に基づく開発準備で、操作判定の製品実装・公開品質の合格ではない。

### 準備した構成

- 既存Node.js 24.11.1／npm 10.9.2を利用。グローバル更新なし。
- .NET SDK 10.0.401を`.tools/dotnet`へ導入。global.jsonで指定し、build-helper.mjsから明示的に起動。システムPATHの変更なし。導入前のシステムdotnetはSDKなし／runtime 7.0.1。
- Electron 44.7.0、electron-vite 5.0.0、Vite 7.3.7、React／React DOM 19.3.0、TypeScript 7.0.2、electron-builder 26.15.3。package.jsonは固定版、package-lock.jsonで依存を固定。
- src/main（Electron）、src/preload（限定IPC）、src/renderer（React）、src/shared（型）。Node無効／contextIsolation／sandboxを有効にした画面を作成。
- native-helperはnet10.0-windows／win-x64、.NET 10.0.12のself-contained配布。UIAの型参照にWindows DesktopのWPF参照を使用するが、WPFの製品画面は作らない。
- resources/native-helperへpublishし、electron-builderのextraResourcesで実行フォルダーへ同梱。NSISのユーザー単位インストーラー設定とビルド入口を用意。

### 確認結果

| 確認 | 結果・範囲 |
| --- | --- |
| npm install／npm ls --depth=0 | 成功。peer依存の不一致を解消した構成 |
| npm run build | C# publish、TypeScript型検査、main／preload／Reactのproduction build成功。最終ビルドでNuGet情報取得の警告なし |
| npm run smoke | 非表示のElectronでReact mount→preload IPC→main→helper JSON受信に成功、確認後終了 |
| npm run smoke:dev | 開発用renderer serverを使う同じ接続確認に成功、確認後Electronと開発server終了 |
| npm run package:dir | Windows x64実行フォルダーとhelper同梱に成功 |
| npm run smoke:packaged | 最終更新した同梱フォルダーのexeで接続確認成功、終了コード0／SETUP_SMOKE_OK |

helperのhealth応答はprotocolVersion=1、runtime=.NET 10.0.12、architecture=X64、monitorCount=2、ownWindowPlacement=true、ownWindowRect=true、uiAutomationLinked=true、observationActive=false。

healthは自分の非表示窓のplacement／rect取得とUIAアセンブリのリンクだけ。全体入力hook・外部窓の観測・ユーザー入力の収集を開始しない。画面2枚は今回の通常権限での実行セッションの結果であり、以前の別実行セッションの1枚と同一条件と扱わない。UIA識別精度・操作判定精度を証明しない。

手順は[README.md](../README.md)。smokeのElectronデータは`.tools`内。公開アプリの記録形式の実装ではない。ローカルSDK・NuGet／npmキャッシュ・生成物は.gitignoreで除外し、既存probeと観測原本は保持した。

### 手戻り・権限

1. 最新Vite 8とplugin-react 6の初期選定がelectron-vite 5のpeer条件と不一致。Vite 7／plugin-react 5へ変更。強制解決オプションは使わなかった。
2. UIAをWinForms＋単独Referenceだけで参照する初期案ではコンパイル失敗。UseWPFでWindows Desktop参照を追加して解消。
3. 開発起動のsmoke引数を環境変数で渡す試みではCLI側の引数処理に上書きされ、確認終了を取得できなかった。今回起動した作業フォルダーのElectronだけを終了し、`dev -- --setup-smoke`で再確認成功。入力の観測は開始していない。

NuGet取得のアクセス拒否、Electron配布用キャッシュへのrename拒否で、それぞれ権限付きの再実行を行った。NuGet HTTPキャッシュの保存先を作業フォルダーへ指定し、復元を再確認。初回SDK起動にはPATH追加失敗と開発証明書生成のメッセージが出た。以降のビルドは関連の初回処理を無効にしている。既存のシステム証明書を削除する操作は行っていない。

### 残る事項と次工程

- 雛形は×で終了し、トレイ常駐・観測開始／停止・通知・操作判定・集計保存は未実装。設計どおりの製品機能は次工程で作る。
- NSISインストーラーのビルド・導入／再導入／削除・/Sの実動作、READMEの導入コマンド、npx追加工数、別PCでの起動は未確認。コマンド導入優先の方針を維持する。
- productName／appIdは準備用の仮値。OSSライセンス・作者情報・アイコン・署名／警告の扱い・公開先は公開前に決める。package.jsonのUNLICENSEDは未選定を表す。
- npmの開発依存にdeprecated警告あり。今回は開発ツールの導入・接続確認であり、全依存の脆弱性監査完了とは扱わない。
- .NET runtimeを同梱するため配布サイズが増える。runtimeの更新は再ビルド・再配布で行う。実行フォルダーの容量・負荷削減は製品実装後に必要性を判断する。
- 次はW03最大化の成立条件で、観測→判定→非フォーカス通知→日別保存→数値UIを縦に接続。既存probeの誤分類を製品へ持ち込まず、unknown・派生復元・重複を除外する。11候補／常用4アプリの成立範囲は実装・公開前確認で決める。

資料：[electron-vite](https://electron-vite.org/guide/)、[.NETローカル導入](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-install-script)、[self-contained配布](https://learn.microsoft.com/en-us/dotnet/core/deploying/)、[NSIS安定版](https://www.electron.build/v26/docs/nsis/)。実際に採用した版・互換性はnpmのmetadataと今回のビルド結果による。

### 工程記録（JST）

開始15:21:06→最終接続確認完了15:40:23、経過19分17秒。把握できた作業区間も15:21:06–15:40:23の19分17秒で、環境確認・SDK導入・雛形・依存修正・build・起動／同梱確認・文書作成を継続した区間。ダウンロード・権限待ち・ビルド待ちを含み、純粋な実装時間とは呼ばない。以降の終了記録・応答末尾は未計測。手戻り3件は上記。製品の操作計測ロジックの実装0。


