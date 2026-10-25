> **履歴資料／現行仕様ではありません。** 当時の調査や合意です。現在の[確定要件](../ui-redesign-requirements.md)・[設計](../design.md)・[README](../../README.md)を優先してください。

# Windowsデスクトップ製品のテスト・CI・品質保証の調査

調査日：2026-10-12。対象：Electron＋React＋TypeScriptと、C#／.NET／Win32の補助プロセスを持つ個人開発MVP。

本書は一次資料に基づく背景調査である。現在のコード・テスト・CIとの照合結果は[不足分析](quality-gap-analysis.md)へ分ける。製品の要件は[mvp-requirements.md](mvp-requirements.md)、責務は[現行アーキテクチャ](../design.md#architecture)、実行手順は[README](../../README.md#開発確認)を正本とし、本書はそれらを変更しない。

各節の「一次資料」は資料が述べる事実・原則、「適用案」はその原則を本製品へ当てはめた調査者の判断である。「先に必要」は現在のリスクに対応する推奨であり、新しい公開受け入れ条件の承認を意味しない。操作候補11件、Windows 11・1〜2画面、4アプリの成立範囲、人工試験と実入力精度の区別を維持する。

## 1. 調査から得た方針

この製品では、判定・集計の正しさ、プロセス境界、Windowsの実際の観測、配布物の動作を別々の証拠で確認する必要がある。純粋関数のテストが通ってもhelperの入力由来は保証できず、人工候補の全経路試験が通ってもChrome等での認識率は保証できない。これは現在の[公開MVPの達成条件](mvp-requirements.md#公開mvpの達成条件)と[設計の検証方針](../design.md#architecture)からの適用判断である。

推奨する構成は、速く隔離できるテストを日常の中心に置き、境界の結合テスト、少数のElectron／配布物スモーク、同意のある実機受け入れで補う形である。Googleの原著も、単体だけでは接続の正しさは分からず、結合と少数E2Eが必要とする。掲載された70／20／10は初期の目安で、普遍的な合格比率ではない。[Google Testing Blog：Just Say No to More End-to-End Tests](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html)

最初から大規模な品質基盤を導入する必要はない。本製品への優先順位は次の順とする。

1. 要件に結び付くテスト一覧と、失敗したら公開・変更を止める項目を決める。
2. Windowsでクリーンな復元・型検査・既存試験・buildをCI化する。
3. 観測候補生成、IPC、保存失敗、停止競合の境界を補う。
4. 生成した配布物と、公開対象のWindows 11実機条件を確認する。
5. 必要に応じてproperty-based、mutation、静的解析、アクセシビリティ、性能の確認を増やす。

これは後述の一次資料と本製品のリスクを組み合わせた適用案で、テスト件数や導入ツール数を目標にしない。

## 2. テストを設計する単位と優先順位

### 一次資料

良い単体テストは速く、隔離され、繰り返せて、自分で成否を判断できる。実装の細部を多く設定するより、必要最小限の入力と利用者に意味のある結果を確認する。ファイルやOSへの依存は結合テストへ分ける。[Microsoft：Unit testing best practices](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-best-practices)

NISTのSSDF 1.1は、要求に対応するセキュリティ確認、コード分析、実行可能コードの試験、リリース完全性、既知の問題の原因分析を別の活動として扱う。これは品質保証の補助的な枠組みであり、このMVPに認証や企業用の全管理工程を要求する根拠ではない。[NIST SP 800-218（SSDF 1.1）](https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-218.pdf)

### 適用案

まず「壊れると何が起きるか」でテストを選ぶ。以下の高優先項目を要件ID・シナリオ・確認層・期待結果・証拠の種類へ結び付ける。

| リスク | 優先する確認 | 主な確認層 |
| --- | --- | --- |
| 誤ったショートカットを案内する | 入力由来不明、キー操作、program、独自UI、結果不一致を除外 | 判定、候補生成、実機受け入れ |
| 実入力を阻害する／全停止でも観測する | hook処理、解除、親死亡、停止中の受理、終了 | native結合、プロセス結合、実機 |
| 回数が二重になる／失われる | 重複ID、世代、再試行、保存失敗、削除との競合 | Core、保存結合 |
| 利用者情報を保存・送信する | payloadと保存形式の許可項目、診断・例外・配布物 | 境界契約、保存、セキュリティ確認 |
| 通知が作業を妨げる | フォーカス、クリック、画面、全画面、消去、間隔 | 通知ロジック、Electron、実機 |
| 開発機だけ動く | helper同梱、ASAR、依存runtime、導入・終了・削除 | packaged smoke、クリーン環境 |

各重要シナリオには正常例、明確な負例、境界例、故障例を用意する。「検出しなかった」だけでは保存や通知も止まったとは限らないため、返却値・数値・通知・副作用を必要に応じて同時に確認する。テストの追加目的を具体的に説明できない小さなgetterや、実装の行をそのまま再現するテストは優先しない。

## 3. テスト層と、それぞれが証明できること

### 一次資料

小さいテストは失敗場所を絞りやすく、結合テストは部品間の不整合を見つける。E2Eを中心にすると、環境依存・遅いフィードバック・原因切り分けの負担が増える。[Googleのテスト階層に関する原著](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html)

Electron公式はアプリの自動テスト手段としてPlaywright等を紹介する。PlaywrightのElectron対応は調査時点でもexperimentalであるため、通常のブラウザ自動化と同じ安定性・互換性を仮定しない。[Electron：Automated Testing](https://www.electronjs.org/docs/latest/tutorial/automated-testing)、[Playwright：Electron API](https://playwright.dev/docs/api/class-electron)

### 適用案

| 層 | 対象と道具の例 | 証明できないこと |
| --- | --- | --- |
| 静的確認 | TypeScript型検査、C# compiler／analyzer、依存方向 | 実行時JSONの正しさ、実入力 |
| 純粋ロジック | Core判定・日付・集計、C# DisplayPolicy、候補生成の純粋部分 | Win32の実際のイベント・権限 |
| 境界契約 | C#出力→TS検証、Preload公開API、schema読込み | GUI、OSの因果関係 |
| 結合 | 実ファイル、実helper子プロセス、命令・応答、故障注入 | 常用アプリでの精度 |
| Renderer | DOMと利用者操作、状態表示・削除・設定 | tray、非フォーカス、Win32 |
| アプリ全経路 | 隔離fixture→helper→Main→保存→React→通知→終了 | fixtureがバイパスした本番入力経路 |
| 配布物 | win-unpacked／installerからの起動、同梱物、停止・終了 | 公開対象の全条件 |
| 実機受け入れ | 同意あるWindows 11通常権限、対象アプリ、1〜2画面 | 未試験のアプリ版・設定・条件 |

層は件数比率ではなく、見つけたい故障と実際に通った経路で分類する。同じテストを複数の層として数えて品質を上乗せしない。Coreだけを確認する日常コマンドはhelperのpublishから独立できるとフィードバックが速い。ただしhelperを変えたときのnative build・結合・同梱確認は省略しない。

## 4. 境界契約・不正入力・互換性

### 一次資料

ElectronはIPCの送信者検証を求め、contextBridgeから汎用的なIPC送信機能を渡す代わりにメッセージごとの限定APIを示す。型があるだけでは、どのframeが送信できるかという境界は保護されない。[Electron：Security（IPC sender）](https://www.electronjs.org/docs/latest/tutorial/security/#17-validate-the-sender-of-all-ipc-messages)、[Electron：Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)

### 適用案

helper／Main／Preloadは実装言語や実行環境の違う境界なので、入力を`unknown`として検証し、双方が共有するfixtureで契約を確認する。大きいschema生成基盤は必須でなく、現行の小さい型ガードと契約fixtureから始められる。

- C#が実際にserializeしたcandidate・fault・ready・displayContextをTSが受理する。TSからのstart／stop／shutdown／queryの命令をhelperが受理する。手書きのTS fixtureだけに閉じない。
- protocol版、requestId、世代、sequence、操作ID、由来、時刻、窓・画面の識別、整数範囲と有限値を確認する。型不足、null、NaN相当、負数、桁あふれ、未対応版、余分な機密項目を負例へ入れる。
- JSON Linesの分割chunk、複数行chunk、末尾未完、空行、不正JSON、巨大行、stdoutへの診断混入、EOF、stderr、異常exitを試験する。上限と不正メッセージへの動作を先に定める。
- 応答の遅延・重複・不一致、停止後のcandidate、helper再起動前の世代が、数値や通知を変えないことを確認する。
- IPCは不正command、非boolean設定、未定義operation、想定外sender／frameを拒否する。rendererが生の`ipcRenderer`、Node、ファイルI/O、任意のchannelを使えないことを実行環境でも確認する。

互換性を約束していない段階では、未知のschemaを黙って空データ扱いするより、検出して保存・受理を止める方針を確認する。実際に保存形式を変えるときに限り、前版fixture→新版読込み→新版保存の移行試験を追加する。この方針は[現行設計](design-implementation-history.md#design)に従う適用案である。

## 5. 状態遷移・非同期・プロパティテスト

### 一次資料

property-based testingは例を人が列挙する方式を補い、生成した入力に不変条件を適用する。fast-checkは失敗を小さい反例へ縮小し、seedで再現できる。例ベースの回帰試験の代替ではない。[fast-check：Why Property-Based Testing?](https://fast-check.dev/docs/introduction/why-property-based/)

model-based testingは操作列を単純なモデルと比較できる。ただしモデルを本実装のコピーにすると、同じ誤りを再現して検知能力を失う。[fast-check：Model based testing](https://fast-check.dev/docs/advanced/model-based-testing/)

### 適用案

停止・再開・削除・保存失敗が重なる製品なので、単一関数の入出力に加えて操作列を試す。先に手書きの重要列を用意し、組合せが増えた段階でfast-check等を部分導入する。現行のnode:testを全面移行する理由にはしない。

| 不変条件の例 | 検知する故障 |
| --- | --- |
| 同じ世代の同じ候補IDを何回配送しても、採用は最大1回 | 二重集計 |
| 全停止後・削除前の古い世代は採用されない | 遅延配送の混入 |
| キー由来候補では案内通知が増えない | 誤通知 |
| mute／通知停止の切替は採用済みの記録を減らさない | 状態の混同 |
| retry後の保存回数が増えても集計は再加算されない | 故障回復での二重加算 |
| 全削除成功後に旧pending書込みで数字が復活しない | 削除競合 |
| キューの1件が失敗しても後続が進み、呼出し元へ失敗が返る | キュー停止・握りつぶし |
| notificationの見送りは将来の遅延表示を作らない | 不要な通知queue |

Promiseの完了順を制御できるdeferredや小さなfakeを使い、「保存開始→停止→保存完了」「画面照会開始→全停止→照会応答」「削除開始→旧候補配送」を意図的に作る。固定sleepを短くして偶然に競合させるだけでは、必要な順序を確認した証拠にしない。

## 6. 時刻・日付・保持・永続化

### 一次資料

Node 24.11.1のnode:testにはmock timer／Dateと複数reporterがある。テストから返すPromise・subtestを待たずに終えると、非同期処理はテストの寿命を越える。利用する機能は最新文書でなく、実際に固定するNodeの版で確認する。[Node 24.11.1：Test runner](https://nodejs.org/download/release/v24.11.1/docs/api/test.html)

MicrosoftのFakeTimeProviderは実時間待ちを避け、深夜・月境界・夏時間・うるう年等の端点を試す例を示す。[Microsoft：Testing with FakeTimeProvider](https://learn.microsoft.com/en-us/dotnet/core/extensions/timeprovider-testing)

NodeのwriteFileは、前の書込みがsettleする前に同じファイルへ重ねて呼ぶのは安全でない。中断はbest effortなので、一部書込み済みになり得る。[Node 24.11.1：File system](https://nodejs.org/download/release/v24.11.1/docs/api/fs.html#fspromiseswritefilefile-data-options)

### 適用案

壁時計の日付と単調時計の間隔は別に注入する。Dateのmockだけで単調時計も制御されたと扱わず、プロセスをまたぐ時刻の基準も契約として確認する。

- 通知4秒、全体10秒、同一操作60秒の直前・一致・直後。表示見送り・照会遅延・mute・停止・再開による間隔の扱い。
- candidateの完了日と処理日の違い、23:59→00:00、月末・年末・うるう日、29／30／31暦日、将来日付を含む既存記録、端末時計の後退・前進。
- タイムゾーンや夏時間を使う追加fixtureは暦日処理の堅牢性確認であり、公開OS・言語・地域の対応拡大を意味しない。
- 書込み・置換・削除の各失敗、権限拒否、ディスク不足相当、読み取り専用、JSON破損、未知schema、途中までの一時ファイル、複数回のretry、通常終了待ち。
- fake filesystemの故障注入に加えて、一時ディレクトリ上の実ファイル結合で再起動・置換・削除・settings保持を確認する。全試験で通常userDataを明示的に使わない。

一時ファイル→renameの成功は、電源断までの完全な耐久性の証明ではない。異常終了注入を行う場合も専用fixtureディレクトリ・専用プロセスで行い、「保存前」「一時ファイル書込み後」「置換後」の再起動結果と保証範囲を分ける。永続化方式の変更や保証追加は、[現行保存設計](design-implementation-history.md#design)の更新と相談が必要である。

## 7. Native helperとWindows固有の品質

### 一次資料

Microsoftのinterop guidanceは、P/Invokeの引数・型・struct layoutをネイティブ宣言に合わせ、resource lifetimeとGetLastErrorの扱いを正しくするよう求める。BOOLとBOOLEAN、LONGとpointerの幅は取り違えやすい。[Microsoft：Native interoperability best practices](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/best-practices)

LowLevelKeyboardProcにはmessage loopが必要で、hook処理がtimeoutするとWindows 7以降ではhookが通知なく削除される場合がある。公式は処理を速く返し、必要な作業を別threadへ渡す方針を示す。[Microsoft：LowLevelKeyboardProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc)

WindowsのDPI認識と座標系はプロセス／threadのDPI awarenessに影響される。モニター間で倍率が異なるデスクトップも考慮する必要がある。[Microsoft：High DPI desktop application development](https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows)

### 適用案

NativeMethodsの宣言確認、純粋な候補生成、実APIの配線、常用アプリ精度を分ける。fixtureモードでhook callbackをバイパスした試験は、そのcallbackが正しいとの証拠にしない。

先に必要な確認は、ボタン／double-click／キーと状態変化の対応、競合・注入・欠落、対象窓一致、hook登録失敗・解除・再登録、親EOF／異常終了時の終了である。Win32の戻り値失敗、窓消滅、識別子再利用、display照会失敗、message loop終了などをadapterや専用fixtureから与え、推測で採用しないことを確認する。

本番入力の収集を広げる前に、callbackが受け取った必要最小限の事象からcandidateを作る部分を純粋なfixtureで試せるか検討する。全OSをmockする大きな抽象化は不要だが、状態変化・時間・対象照会の境界を少数の入力として扱えると再現性が高い。

1画面、左右／上下／負座標の2画面、混在倍率、work areaとscreen boundsの違い、通常最大化と独自全画面、cloaked／非表示／最小化、画面構成変化を候補fixtureと実機で分けて確認する。3画面・管理者アプリ・remote等を「新しく対応」させる必要はなく、非対応条件で誤案内しない負例として扱う。

hookの稼働表示だけで実入力が届き続けていると断定しない。長時間利用中の異常をどう検知・表示するかは、OS側の通知されない解除という制約を踏まえて検討する。認識率は現行の同意ある実入力試験で確認する。

## 8. Renderer、アクセシビリティ、少数E2E

### 一次資料

Testing Libraryは部品内部のinstanceよりDOMを通じ、利用者の使い方に近い試験を推奨する。[Testing Library：Guiding Principles](https://testing-library.com/docs/guiding-principles/)

Playwrightのweb assertionは期待する状態まで再試行する。利用者が認識するroleやlabelで要素を見つけ、固定timeout待ちより状態の成立を待つ方が維持しやすい。[Playwright：Assertions](https://playwright.dev/docs/test-assertions)、[Playwright：Best Practices](https://playwright.dev/docs/best-practices)

ElectronはChromiumのアクセシビリティ機能を利用できる。自動アクセシビリティ検査は一部の問題を検知できるが、全違反を見つけるわけではなく手動評価が必要である。[Electron：Accessibility](https://www.electronjs.org/docs/latest/tutorial/accessibility)、[Playwright：Accessibility testing](https://playwright.dev/docs/accessibility-testing)

### 適用案

数値画面は、集計日選択、mouse/key表示、mute／通知停止／全停止の区別、保存失敗表示、retry、削除取消・確定をDOM操作で確認する。Mainの値をUI側で別解釈していないこと、再購読や画面再表示で古い状態へ戻らないことも対象とする。

Electron全経路の必須候補は「起動→fixture集計→表示→保存→通知→停止→終了」「再起動→記録・設定の復元」「削除取消／確定」の少数経路から選ぶ。trapになる長大な1本へ集めず、失敗箇所を切り分ける。現行のアプリ内smokeを再利用できる部分は再利用し、Playwright追加自体を品質の条件にしない。

独立した外部テストは、Main内部が成功と報告していてもUIが操作不能、preloadが読めない、exeが閉じない等を検知する補完になる。テスト用フラグの本番露出を広げず、packaged実行・起動path・cleanupを確認する。Playwrightのexperimental Electron APIと製品Electron版の組合せは小さい試験で先に確認する。

数値画面ではキーボードだけで設定と削除に到達できること、focusが見えること、label・status・エラーが読み取れること、表示倍率・high contrast・文字拡大で重要操作が隠れないことを確認する。通知は非フォーカス要件を維持し、読み上げのためにフォーカスを奪う変更をしない。自動axe検査の合格だけでアクセシビリティ完了としない。

## 9. Electronのセキュリティを検証可能にする

### 一次資料

Electron公式のsecurity checklistは、contextIsolation、sandbox、Node無効、CSP、navigation／新規window／外部URLの制限、IPC送信者検証、現在のElectron版の維持を挙げる。安全なdefaultを使っていても、アプリ側の設定・API公開を確認する必要がある。[Electron：Security](https://www.electronjs.org/docs/latest/tutorial/security/)

Fusesはpackage時に未使用の強力な機能を無効化する仕組みであり、設定によって`child_process.fork`やテスト自動化に影響する。ASARの格納そのものと、ASAR integrity検証は別である。[Electron：Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)、[Electron：ASAR Integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)

### 適用案

小さい脅威モデルとして「侵入入口：renderer／IPC／helper JSON／保存JSON／配布」「守るもの：入力由来・保存データ・実行権限」「拒否時の動作」を1表で定義する。ネット上の不特定ページを表示しない製品でも、rendererの権限境界と不正JSONは残る。

安全設定はコードを読むだけでなく、生成されたwindowの`webPreferences`、preload公開名、CSP、想定外navigation・popup・IPCをfixture環境で確認する。失敗の表示に生のcandidateやファイルパスを混ぜない。

Fuses／custom protocol／ASAR integrityは公開配布時の追加候補として評価する。採用時は同梱helperとテスト起動方式の互換性も確認し、全設定を無条件に切り替えない。最新Electronを機械的に使うのではなく、製品が採用する版の更新を定期確認し、更新PRで型検査・native・smoke・packageを再確認する。

## 10. 静的解析と依存方向

### 一次資料

TypeScriptのstrictは型検査を強める。noUncheckedIndexedAccessは未宣言のindex参照へundefinedを加えるが、strictに自動で全追加検査が含まれるわけではない。[TypeScript：strict](https://www.typescriptlang.org/tsconfig/strict.html)、[TypeScript：noUncheckedIndexedAccess](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html)

typescript-eslintのno-floating-promisesは未処理Promiseを検知する。`void promise`はawaitしない意図を示すだけでrejectionを処理しない。[typescript-eslint：no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/)

.NETではcompiler診断に加え、CA系analyzerが安全性・性能・設計の問題を検査する。対象frameworkでは既定有効のものもあり、全analyzer未導入と決め付けない。[Microsoft：Code analysis in .NET](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/overview)

### 適用案

型検査はtests・scripts・preloadを含む実際の対象を確認する。runtime検証と型検査は併用する。Core／SharedがNode・Electron・Mainをimportしない等、[現行依存方向](../design.md#architecture)の破壊を小さい自動検査またはlintで検知する。

lintを追加する場合は、未処理Promise、async callbackの誤用、switchの網羅、unsafe値・不要な抑制等のバグに関係する規則から始める。見た目の一括修正を本調査の推奨と混ぜない。C# warningは重要なものからCIで扱い、既存診断の一覧・抑制理由を確認してからwarnings-as-errorsの範囲を決める。

## 11. CIの再現性、安全性、結果の信頼性

### 一次資料

`npm ci`はlockfileが必要で、manifestと不一致なら失敗し、lockfileを更新しない。.NET global.jsonはSDKの選択・rollForwardを制御する。NuGet lockfileとlocked restoreは依存解決の変化を検出する。[npm：npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/)、[Microsoft：global.json](https://learn.microsoft.com/en-us/dotnet/core/tools/global-json)、[Microsoft：NuGet locking dependencies](https://learn.microsoft.com/en-us/nuget/consume-packages/package-references-in-project-files#locking-dependencies)

GitHubは最小権限、full-length commit SHAでのAction固定、不信なPR内容のshellへの直接埋め込み回避、特権workflowでの不信コードcheckout回避を推奨する。self-hosted runnerにはhostedと同じクリーンVMの保証がない。[GitHub：Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)

GitHubのWindows hosted VMは管理者・UAC無効で動く。調査時点のx64標準ラベルにはWindows 2022／2025系があり、Windows 11 ARMのラベルも存在する。ラベルと実機条件は一律ではない。[GitHub：GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[GitHub：Windows 2025 runner image](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md)

### 適用案

最初のCIはWindows x64の1ジョブまたは少数ジョブでよい。クリーンcheckout→指定Node／npm／SDKの確認→`npm ci`→型検査→純粋試験→helper build／native結合→Electron buildを基本とし、安定して動くfixture smoke／packageを追加する。実行コマンドをREADMEと分岐させず、exit codeの失敗をworkflowへ伝える。

具体的には次を確認する。

- Node・npm・SDKの実際の版、OS image、commit、lockfileが結果へ紐付く。`windows-latest`に任せた暗黙の変更を避けても、image内の全ソフトウェアまで固定されたとは扱わない。
- 復元cacheは最適化に留め、cache無しでも通る。成果物やテスト成功をcacheで使い回さない。取得したSDK／バイナリの出所・checksumも確認する。
- timeoutと後片付けを用意し、helperが残って後続に影響しない。GUI／単一起動／hookを含む試験は共有desktop上で並列競合させない。
- workflow／jobのtoken権限は必要最小限。build・testはread中心、署名・公開は別の信頼済み経路へ分ける。ActionをSHAで固定した後も、更新・ソース確認は続ける。
- fixtureログだけをartifactへ保存し、失敗段階・assertion・versionを残す。通常userData、候補生ログ、desktop全体の画像をartifactへ入れない。
- 必須ジョブの欠落・skip・test未発見を成功と混同しない。OS依存テストを非Windowsでskipして緑になるだけのジョブを主要証拠にしない。

CI buildやhosted fixtureは、Windows 11通常権限・常用4アプリ・1〜2画面の実入力精度を保証しない。公開前実機受け入れを別に残す。個人の普段のPCを公開PR用self-hosted runnerにする案は優先しない。

必須checkでmergeを止める機能はGitHubにあるが、private repositoryの利用可否はプランに依存する。設定・権限・プランを確認したうえで導入する。1人MVPに複数承認者・merge queueを必須化する理由はない。[GitHub：About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

## 12. 供給網・配布物・Windows実機matrix

### 一次資料

GitHub dependency reviewは変更された直接／間接依存の既知脆弱性やlicense情報を示すが、利用可能なrepository形態・プランがある。CodeQLはJavaScript／TypeScript・C#を解析できる。[GitHub：Dependency review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review)、[CodeQL：Supported languages and frameworks](https://codeql.github.com/docs/codeql-overview/supported-languages-and-frameworks/)

`npm audit`は既知advisoryに基づき、依存名と版等をregistryへ送る。advisoryがない悪意ある依存を全て見つける機能ではない。電子署名・provenance確認と脆弱性検査も同じものではない。[npm：npm audit](https://docs.npmjs.com/cli/v11/commands/npm-audit/)

self-contained .NET配布はruntimeを同梱し、端末に新しいsecurity patchがあっても自動でそのruntimeへroll forwardしない。[Microsoft：.NET application publishing](https://learn.microsoft.com/en-us/dotnet/core/deploying/)

Microsoftは、署名の有効性とSmartScreenのreputationを別に説明する。OV／EVでも新しい配布物には警告があり得る。署名すれば必ず警告が消えるとは扱わない。[Microsoft：SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)

NISTの組合せテスト研究は、少数の入力因子の相互作用に着目し、全直積より小さい試験集合を生成する方法を扱う。pairwiseで全故障を検知できるという保証ではなく、制約と期待結果の設計も必要になる。[NIST：Combinatorial Methods for Trust and Assurance](https://csrc.nist.gov/projects/automated-combinatorial-testing-for-software)

### 適用案

依存確認はElectron／Chromium／Node、npm、.NET SDK／同梱runtime、NuGet、GitHub Actions、package用取得物を含める。`devDependencies`だから実配布物へ関係しない、と一括で除外しない。定期的なadvisory確認と更新時のsmokeを行い、重大issueは到達性・修正版・回避策を短く記録する。`audit fix --force`や無検証の自動mergeを通常の回復策にしない。

配布前の優先確認は、開発ツールを入れていないWindows 11通常ユーザーでの導入、初回／2回目起動、helper解決と同梱DLL、トレイ、単一起動、終了、再導入、削除、既存の記録・設定の扱いである。日本語・空白を含む場所、起動時cwdが違う場合、別出力先、起動中exeのlockも対象にする。installer生成成功と導入成功は別の確認とする。

配布したexe・helper・installerのhash、commit、dependency版、確認結果を紐付ける。テスト後の再buildを未確認のまま公開せず、実際に配るartifactを確認する。SBOMやartifact attestationは公開運用が育った段階の追加候補でよく、初期から複雑なrelease基盤を必須にしない。署名・公開先・OSS licenseは既存の[公開準備](../../README.md#公開準備)に従って別途決める。

| 場所 | 優先する組合せ | 位置付け |
| --- | --- | --- |
| 日常CI | 固定したWindows x64 build環境・指定toolchain | build／fixture回帰 |
| 公開前実機 | Windows 11・通常権限、対応表のアプリ版、1画面／2画面、倍率・配置・キーボード条件 | 現行受け入れ |
| 追加回帰 | mixed DPI、負座標、monitor構成変更、sleep／復帰・lock／unlock | 状態回復のリスク確認 |
| 将来 | 複数Windows 11版、追加言語／keyboard、ARM | 対応範囲を広げる場合に相談 |

全条件の直積は初期MVPには重い。既知の事故に直結する組合せを必須にし、独立した条件は代表・pairwiseで補う。これは試験計画の適用案であり、公開対象操作ごとのmouse10／key10・負例20・通常利用60分という現行基準をpairwiseで置き換えない。

## 13. Flaky test、coverage、mutationの使い方

### 一次資料

Microsoftはcoverageが高くても品質は保証されないと注意する。実行されたコードの量と期待結果を確かめた量は違う。[Microsoft：Code coverage and code quality](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-best-practices#code-coverage-and-code-quality)

Strykerは小さく変更した実装に対しテストが失敗するかを測り、coveredでもsurvivedとなる変更を区別する。等価な変更など、mutation scoreだけでは判定できない場合もある。[Stryker：Mutant states and metrics](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)、[Stryker：Equivalent mutants](https://stryker-mutator.io/docs/mutation-testing-elements/equivalent-mutants/)

Playwrightは最初に通るpassed、失敗後retryで通るflaky、最後まで失敗するfailedを区別する。[Playwright：Retries](https://playwright.dev/docs/test-retries)

### 適用案

coverageは欠けている分岐を探す地図として使う。Core／Main保存／nativeで分母を分け、未importファイル、生成物、fixture、platform skip、型定義の扱いを確認する。全体80%や100%を根拠なく合格条件にせず、判定の負例・保存失敗・停止競合が確認されたかを見る。

mutationは重要な少数moduleで試す。「unknownを受理」「重複判定を無効化」「10秒境界を変える」「保存失敗を成功扱い」に相当する変更をテストが落とせるかが有用である。node:test／native fixtureとの互換性・実行時間を先に確認し、全面導入や100% gateは将来候補とする。

flakyはretryを増やして解決済みにしない。最初の失敗を残し、製品race／待機の誤り／共有fixture／環境制約を切り分ける。隔離する場合は理由・追跡先・見直し時期・代わりの確認を書く。重要な停止・保存テストを無期限にskipして「全合格」と報告しない。

スモークは既知の処理完了を待ち、timeout時にはどのstageにいたかを示す。純粋テストは仮想時刻、プロセス結合は応答とexit、UIは表示状態を待つ。毎回反復実行するより、故障修正時に必要な同条件反復を行う。

## 14. 性能・診断・プライバシー

### 一次資料

Electronは計測・profilingを重視し、Mainを長時間blockさせない方針を示す。単に推奨実装を採用しても速さの保証にはならない。[Electron：Performance](https://www.electronjs.org/docs/latest/tutorial/performance)

Electron crashReporterは調査時点の既定でuploadToServerがtrueであり、falseでもdumpをdiskへ保存する。Playwright traceはDOM snapshot、console、network等を記録する。診断を入れるだけでも、保存内容が増える。[Electron：crashReporter](https://www.electronjs.org/docs/latest/api/crash-reporter)、[Playwright：Trace viewer](https://playwright.dev/docs/trace-viewer-intro)

### 適用案

入力阻害のない常駐が目的なので、idle／burst candidate、Main event loop、helper CPU／memory／handle、長時間利用後の増加、通知・停止の応答、終了後の残processを測る。初期はfixtureでbaselineを取り、安定した基準機で変化を見る。hosted CIの揺れを厳しい性能gateへ直結させない。現行60分受け入れは別途必要である。

通常実行は集計・設定だけの保存と外部送信なしを維持する。品質のためという理由で候補生ログ・キー生ログ・全desktop画像・自動crash uploadを追加しない。故障は既存UIの観測停止／未保存／再試行表示と、限定したエラーcodeを中心に伝える。

追加diagnosticsが必要なら、まずfixture CIに限ってstage・匿名なversion・error分類を出す。実利用用に診断ファイルを保存する案は、通常保存の契約を変えるため、許可項目・保存期間・消去・見せ方を具体化して相談する。dumpは文字やpathを含まないと仮定せず、要件確認なしに有効化しない。

実機バグ報告には、app版、Windows版、対象operation、mouse/key、通常／最大化／snap等の状態、画面数・倍率、期待／結果、再現回数、時刻条件を求める。窓タイトル・URL・入力文字・全画面録画を必須にしない。利用者の報告を匿名fixtureへ落として再現・修正・回帰テストへつなげる。

## 15. 個人MVPでの導入順序

以下は本調査の適用案。新たな要件ではなく、不足分析と照合して採否を決めるための順序である。

| 段階 | 先に整えるもの | 後回しにできるもの |
| --- | --- | --- |
| 次の機能追加前 | 要件と試験の対応、速い純粋テスト、Windows CI、重要境界fixture、失敗報告 | 全moduleのmutation、巨大なtest framework移行 |
| 公開前 | packaged／installer、IPC安全性、保存失敗・停止・削除、通常権限実機の既存精度試験、プライバシー確認、導入文書 | 多OS・ARM保証、自動更新、全条件直積 |
| 継続開発 | 依存更新、regression fixture、flaky解消、重要分岐coverage、少量property／model、UI操作・基本アクセシビリティ、baseline計測 | 外部telemetry、中央log、常時性能gate |
| 利用者・公開規模拡大 | SBOM／attestation、署名運用、対応OS／アプリ版の拡大、追加scanner | 専用device farm、複数承認体制、複雑なrelease orchestration |

判断時に見る指標は、要件に対応した重要シナリオの未確認数、失敗を再現できるか、初回試験の失敗率、原因判別までの時間、既知重大バグ、配布artifactの同一性、実機試験の条件である。テスト件数・coverage・CIの緑・認識率の標本は、それぞれ対象範囲と限界を添えて扱う。

## 16. 調査方法と情報時点の限界

Electron、Node、npm、Microsoft、GitHub、Playwright、TypeScript、Testing Library、fast-check、Stryker、NISTの公式資料と、Google Testing Blogの原著を直接確認した。二次記事の「一般にベストプラクティス」といった主張を根拠にしない。本製品の要件・アーキテクチャ・package.jsonは文脈確認に使用したが、本書だけで現況の欠落やテストの成功を判定しない。

2026-10-12時点のWeb資料を参照した。`latest`、Actions image、プラン、署名サービス、advisory、依存のsupported版は変わるため、導入時に再確認する。Node test／fsは製品の最低指定版24.11.1のversioned文書も確認した。ツールの採用案は製品Electron／TypeScript／.NET版で実行検証しておらず、互換性保証ではない。

署名についてElectron文書の警告・証明書説明とMicrosoft SmartScreen資料に食い違いがあったため、Windowsのreputation挙動はMicrosoft資料を優先した。取得できなかったGoogleのcoverage／flaky個別記事は根拠へ採用せず、取得できたMicrosoft・Playwrightの記述で扱った。

本調査では実入力を観測せず、新しい性能測定・精度試験・installer導入試験・セキュリティscanner実行をしていない。提案の効果や現行不具合の存在は、[不足分析](quality-gap-analysis.md)と今後の検証で区別する。
