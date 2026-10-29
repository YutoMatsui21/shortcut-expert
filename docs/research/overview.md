# 調査・検証根拠

**2026-10-09〜11の調査・実測の記録**。現在の要件は[確定要件](../ui-requirements.md)、設計は[現行アーキテクチャ](../design.md#architecture)を正本とする。旧MVP要件は[アーカイブ](../archive/mvp-requirements.md)へ移動した。本書は2026-10-09〜11の判断根拠と原本の案内。各節の未実装／未確認は、その調査時点の状態を指す。ステップ1の再調査は不要。

必要な節だけ読む： [採用理由](#value)・[判断修正](#review)・[KPX](#kpx)・[競合](#tools)・[環境別制約](#platforms)・[11操作の判断](#operations)・[API保証範囲](#apis)・[実測](#measurements)・[probe再現](#probes)。

調査用のダウンロードコピーは削除し、一次資料へのリンクを保持。probeの原本ソースと時刻付き実測ログはvalidationへ保持する。生成exeと最新ログの同内容コピーは削除済み。再試行する場合はソースからビルドする。

<a id="value"></a>

## ステップ1：価値検証

2026-10-09承認・完了。当時の要件は[旧MVP要件](../archive/mvp-requirements.md)。現在の受入条件は[確定要件](../ui-requirements.md)。

### 目的・採用理由

PCを約10時間/日使用。Windowsの日常操作で有用なキーを知らない・覚えられない・思い出せず、マウス中心になる。特に窓／タブ切替、別画面への長い移動が負担。時々調べるが、手間・候補の多さ・効果の見えにくさが障壁。回数・損失時間は未測定。

マウス操作後に既存キーを案内し、別の練習時間を取らず日常作業で習慣化する。切替は例であり課題全体を1操作に限定しない。使用実績は学習の補助とする。

無料OSSとして、Key Promoter Xの体験をWindowsへ広げたい。Windows向け直接競合もあるが、有料・macOS限定・IDE限定・実用性未確認は本人の条件に合わない。不存在・新規性・学習／集中力／時間短縮効果の証明を自作の前提にしない。

### 開発方針

- 自分の効率化60%／portfolio40%。公開1か月後も日常利用し、コード・設計・READMEから技術力を評価できることが成功条件。
- 初期版3日、TS／React。Next.js・backendは必要時のみ。
- 動く主要機能、重大バグなし、簡単な導入・操作、README・license、UI／内部ロジックに各1件以上の工夫。
- 重大な不確実性を優先し短い実装・改善サイクル。時間・手戻りを記録する。
- 価値→要件→技術判断→最小設計→環境準備→実装・テスト→公開前確認→振り返り。工程完了時に次へ進むか確認。

採用参考はKPX通常通知。右下の軽い案内、強制練習・再入力不要。通知・日別記録・対象範囲の確定事項は要件書へ集約。独自キー作成は将来構想で初期対象外。

### 参照先と残る区別

- 通知・統計の参考：[KPX参照](overview.md#kpx)。
- 競合の事実・出典：[競合調査](overview.md#tools)。WORK & MOVEは有料、Keylume.appはmacOS、Shortcut Coachは実用性未確認として導入候補外。
- 判断の修正理由：[判断修正](overview.md#review)。
- 環境別の意味・入力・キー取得：[環境別制約](overview.md#platforms)。

入力取得と操作識別は別。IDE ActionをWindowsへそのまま使えない。キー一覧の件数と検出できる操作数、課題・公開範囲・代表検証を分ける。距離・回数は節約時間や習得の証明ではない。実装の成立・通知の邪魔さ・継続利用は後続で確認する。

### 工程記録

10/09 16:39開始→18:11承認、経過約92分（回答待ち含む）。調査概算27分、実作業全体は未計測。文書整理18:11–18:18の約7分は別。

文書修正2件：①具体例を課題全体へ狭めた、②直接競合の比較不足で自作価値を早期確定した。実装手戻り0。改善：課題・公開MVP・検証範囲を分け、採用条件と競合を確認して判断する。全工程の時間は要件書にも集約。

<a id="review"></a>

## ステップ1レビュー

2026-10-09、公式資料・公開コード確認、実機未試用。17:36時点の再レビューを経て17:49以降に採用条件を確定、18:11完了承認。[最終判断](overview.md#value)

### 判断の修正

課題定義は妥当だが「Windowsで使えるから自作価値がある」は直接競合を見落としていた。無料OSS・Windows日常操作という本人の採用条件と既存製品の差を自作理由とした。商用製品の試用・競合網羅・同種不存在・科学的効果の証明は不要。

### 後続へ残す注意

1. 操作認識と同等キーの選択は別。任意タブclickとCtrl+Tabは結果が違う。[Chrome公式](https://support.google.com/chrome/answer/157179?hl=en)
2. キー表の件数は正しく検出できる操作数ではない。意味・入力由来が主な技術リスク。
3. 頻度・誤通知・停止が継続利用を左右する。通知回数を習得とみなさない。
4. 総入力数・距離は節約時間の証拠ではない。学習に近い指標として対象操作のkey使用を検討。
5. 操作数だけで品質を判断せず、正確さ・導入・README・license・保存情報を要件化する。

### 参照先

- 操作後の案内：KPX、WORK & MOVE、Keylume.app、Shortcut Coach。主要参考はKPX。他は条件外／実用性未確認。
- 統計：WhatPulse、aw-watcher-input。操作支援：Vimium。コーチとは区別。
- 事実・提供状況・公開コード：[競合調査](overview.md#tools)。
- IDE内部Action：[KPX参照](overview.md#kpx)。コマンド履歴・Windows画面推定：[競合調査](overview.md#tools)。API制約：[環境別調査](overview.md#platforms)。

ユーザーはKPX通常通知・右下案内・強制練習なしを選択。日別graphは当時候補で、現在は数値必須／graph後回しに確定。現在の仕様は[確定要件](../ui-requirements.md)。

<a id="kpx"></a>

## Key Promoter X参照

2026-10-09、公式masterの資料・コード確認、実機未試用。JetBrains IDE用、無料OSS／BSD-3-Clause。[repo](https://github.com/halirutan/IntelliJ-Key-Promoter-X)

| 項目 | 確認事実・出典 | 今回への含意 |
| --- | --- | --- |
| 通常通知 | 操作名・代替キー・累積missedをBALLOON表示、設定／非表示links。[code](https://github.com/halirutan/IntelliJ-Key-Promoter-X/blob/master/src/de/halirutan/keypromoterx/KeyPromoterNotification.java) | 主要参考。[IDE既定](https://www.jetbrains.com/help/idea/notifications.html)はIDE窓右下で、Windows画面への独自固定とは別 |
| 強制性 | 通常経路は通知のみ。任意Hard Modeは指定キーで閉じるmodal、既定off。[dialog](https://github.com/halirutan/IntelliJ-Key-Promoter-X/blob/master/src/de/halirutan/keypromoterx/KeyPromoterDialog.java) | 再入力不要という希望に合う。Hard Modeは不要、実フォーカス未検証 |
| 頻度 | 項目ごとmouse使用N回、既定1／範囲1〜30。[条件](https://github.com/halirutan/IntelliJ-Key-Promoter-X/blob/master/src/de/halirutan/keypromoterx/KeyPromoterTipService.java) | 今回の時間間隔とは別 |
| 制御 | 個別抑制／復帰、再起動までsnooze、UI別制御、統計reset。[設定](https://github.com/halirutan/IntelliJ-Key-Promoter-X/blob/master/src/de/halirutan/keypromoterx/KeyPromoterSettings.java) | 停止UIの参考 |
| 統計 | Count(mouse)・Hit(key)、累積missed/used一覧。[項目](https://github.com/halirutan/IntelliJ-Key-Promoter-X/blob/master/src/de/halirutan/keypromoterx/statistic/StatisticsItem.java)、[UI](https://github.com/halirutan/IntelliJ-Key-Promoter-X/blob/master/src/de/halirutan/keypromoterx/statistic/StatisticsList.java) | PC全入力数ではない |
| 範囲・保存 | key回数は過去mouse実行で登録した項目だけ。抑制・snooze等で集計も停止、XML保存。[code](https://github.com/halirutan/IntelliJ-Key-Promoter-X/blob/master/src/de/halirutan/keypromoterx/statistic/KeyPromoterStatistics.java) | 今回は全対応項目を日別記録し、通知停止中も集計 |
| 日別・graph | 保存項目に日時なし、確認codeに日別／推移graphなし | 日別保存は別に必要 |
| 入力判定 | IDE ActionのMouseEvent／KeyEventを実行前に区別。[listener](https://github.com/halirutan/IntelliJ-Key-Promoter-X/blob/master/src/de/halirutan/keypromoterx/KeyPromoterActionListener.java) | 成功数検証ではなく実行観測。Windows全体へ流用できない |

今回の通知・停止・記録契約は[mvp-requirements.md](../archive/mvp-requirements.md)、APIの差は[技術調査](overview.md#platforms)。

<a id="tools"></a>

## ショートカット学習ツール調査

2026-10-09、公式資料・公開コード確認。インストール・実機未試用。未確認は非対応の証明ではない。競合調査は区切り、採用理由は[採用理由](overview.md#value)へ。

### 参照・練習・操作後案内

| 製品 | 確認できた機能／提供根拠 | 制約・採用判断 |
| --- | --- | --- |
| [PowerToys Shortcut Guide](https://learn.microsoft.com/en-us/windows/powertoys/shortcut-guide) | 前面app別表示・検索（Windows／Chrome／VS Code等）、推奨・pin | 操作後案内／mouse時間比較は未確認 |
| [KeyCombiner](https://keycombiner.com/features/) | 選択・練習・lesson・間隔反復・成績。[desktop](https://keycombiner.com/desktop/)で個人／前面appキー参照 | 無料／有料範囲差、browser予約キー制約。練習入力時間あり、mouse比較未確認 |
| [Key Promoter X](https://github.com/halirutan/IntelliJ-Key-Promoter-X) | JetBrains IDEのmouse後案内、累積統計・制御。[2026配布](https://github.com/halirutan/IntelliJ-Key-Promoter-X/releases/tag/v2026.1.2)、BSD-3-Clause | IDE外対象外。主要参考、[詳細](overview.md#kpx) |
| [VS Code Key Promoter](https://github.com/donebd/vscode-keypromoter) | 操作／編集パターンから案内。[VSIX](https://github.com/donebd/vscode-keypromoter/releases/tag/release/1.2.0-tag)、MIT | API制約の間接検出、未対応あり、counterはmemory内。Marketplace現状未確認 |
| KeyRocket | Explorer／Office向け案内・進捗。[会社名義2012発表](https://www.prlog.org/11970990-keyrocket-adds-support-for-spanish-and-french-russian-portuguese-greek-on-the-way.pdf) | 現行機能・互換性不明、導入候補外 |
| [WORK & MOVE](https://workandmove.bakkerelkhuizen.com/) | 現行Windows商用。[FAQ](https://workandmove.bakkerelkhuizen.com/faqs/)はWin10以上・導入・週間統計。[案内／学習list](https://www.bakkerelkhuizen.com/de-de/wissen/weniger-mausverbrauch-dank-tastaturkurzeln/) | 認識方式・代表操作・個人購入条件未確認。有料で条件外 |
| [Shortcut Coach](https://github.com/NirMendelson/shortcut-tips) | Windows/Python試作。UIA・入力監視・key対応・通知・SQLite | licenseファイル・再利用許諾・動作精度未確認。README保存方針と文字／clipboard断片を渡すcodeが不一致。導入候補外 |
| [Excel Shortcut Coach](https://excelshortcutcoach.com/) | Windows/Excelの操作後案内・項目制御、購入／download案内 | [FAQ](https://excelshortcutcoach.com/faq/)は初期実験版。認識方式・統計未確認、対象範囲外 |
| [Hotkey Hero](https://chromewebstore.google.com/detail/hotkey-hero/eeecmdilafpbkojiihcajnfkblljcfpa) | Google Docs。開発元は操作に応じた案内・記録・推定節約時間を説明 | code・認識・推定式未確認。Chrome本体とは別 |
| [Keylume.app](https://keylume.app/) | macOS商用、download／trial、Accessibilityで標準menu取得・click後案内・習得分析 | 内部未確認、OS条件外 |

[AltMouse](https://www.bakkerelkhuizen.com/altmouse/)は終了しWORK & MOVEへ移行。[LowtechguysのKeylume](https://lowtechguys.com/keylume/)は別製品（key可視化・cheatsheet中心）で、Keylume.appと混同しない。

統計参考：[WhatPulse](https://whatpulse.org/help/docs/software/input/using-the-input-tab)はkey・click・距離・組合せ、[aw-watcher-input](https://github.com/ActivityWatch/aw-watcher-input)は開発途上の入力回数集計。[Vimium](https://github.com/philc/vimium)はbrowserのkey操作支援。いずれも操作後の学習コーチと区別する。

### 公開コードで確認できた仕組み

- KPX：IDE Action＋入力種別。[参照](overview.md#kpx)
- VS Code版：[command捕捉](https://github.com/donebd/vscode-keypromoter/blob/master/src/services/subscriptionService.ts)＋[key履歴照合](https://github.com/donebd/vscode-keypromoter/blob/master/src/services/commandCounterService.ts)で推定。
- Shortcut Coach：[click位置UIA](https://github.com/NirMendelson/shortcut-tips/blob/master/server/ui_automation_manager.py)＋[英語名対応表](https://github.com/NirMendelson/shortcut-tips/blob/master/server/shortcut_manager.py)、[入力](https://github.com/NirMendelson/shortcut-tips/blob/master/server/input_monitor.py)、[通知／保存](https://github.com/NirMendelson/shortcut-tips/blob/master/server/core_system.py)。日本語精度未検証。

当初の参照・練習比較から、操作後通知にも直接競合があると判明。自作理由は本人の無料OSS・Windows日常操作という条件への適合で、新規性・効果の証明ではない。検出制約は[環境別調査](overview.md#platforms)。当時のソース抜粋は実行していない。整理時にダウンロードコピーを削除し、一次資料へのリンクを残した。

<a id="platforms"></a>

## 環境別のショートカット案内の制約

2026-10-09の公式API・公開コード・開発者説明に基づく資料調査。実機試用はこの調査では未実施。後続の実測は[技術検証記録](overview.md#measurements)、最新判断は[操作別の技術判断](overview.md#operations)。

主要な差は操作の意味・入力由来・代替キーを取得できるか。市場の普及原因・作者の他OS対応動機は未確認。同種ツールの不存在を前提にしない。

| 環境 | 取得・制約 | 根拠 |
| --- | --- | --- |
| IntelliJ/KPX | 内部Action＋入力種別。外から意味を推定せずに済むが全mouse操作対応ではない | [Action System](https://plugins.jetbrains.com/docs/intellij/action-system.html)、[listener](https://github.com/halirutan/IntelliJ-Key-Promoter-X/blob/master/src/de/halirutan/keypromoterx/KeyPromoterActionListener.java)、[README](https://github.com/halirutan/IntelliJ-Key-Promoter-X) |
| VS Code | 全command実行の公開監視APIは確認できず、既存拡張はcommand捕捉・key履歴・editor変化から間接推定 | [Commands](https://code.visualstudio.com/api/extension-guides/command)、[型定義](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts)、[拡張](https://github.com/donebd/vscode-keypromoter) |
| Chrome拡張 | content scriptはpage DOM。tabs.onActivatedのtabId/windowIdに入力由来なし。action.onClickedは拡張自身のbutton用 | [scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)、[tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs#event-onActivated)、[action](https://developer.chrome.com/docs/extensions/reference/api/action#event-onClicked) |
| Windows UIA | 意味・key情報を提供し得るが、全app／全event保証なし。AcceleratorKey既定は空 | [購読](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-eventsforclients)、[user/program両由来](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-eventsoverview)、[AcceleratorKey](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.acceleratorkeyproperty?view=windowsdesktop-10.0) |

VS Code開発者は2019年に性能・内部引数漏出等を理由に全command監視APIを撤回し、学習機能の本体提案は歓迎と説明した。「発想がなかった」説への反証で、市場全体の原因ではない。[懸念](https://github.com/microsoft/vscode/issues/78091#issuecomment-518545491)、[削除](https://github.com/microsoft/vscode/issues/78091#issuecomment-521640092)

拡張作者の2026年1月報告には入力監視libraryのMarketplace審査と手動VSIX案内がある。現時点の審査・安全性は未確定。[報告](https://github.com/donebd/vscode-keypromoter/issues/66#issuecomment-3789180201)

Google Docs内の拡張がChrome本体のtabbar・戻るbuttonを扱えるとは限らない。「WindowsにAPIがない」「UIAで全app一律解決」も不正確。

3日MVPではキー一覧と検出数を分け、入力・意味・結果・同等キーを対応づける。全app対応を工数の前提にしない。現在は資料で仮説を立て、重大な未確定だけ確認する方針。競合は[競合調査](overview.md#tools)、通知／統計は[KPX参照](overview.md#kpx)。

<a id="operations"></a>

W11の本番実装と局所検証は[#39の判定契約](../operations/window-close.md)・[2026-10-29の結果](../validation/window-close-20261029.md)を参照。通常閉鎖でもHIDE/前面変更/DESTROY時点の生存が先行する実測を保存し、同一対象の破棄と消滅を照合する。

> 2026-10-27：初回は8操作（W12/W01/W03/統合W04/W06/W07/W02/W11）。W05はW04へ統合、W08/W10は関連学習候補も含め対象外。以下の表は判断時点の証拠・仮説を保持し、現在の対象・経路は[確定要件](../ui-requirements.md)を優先する。W03上端直接ドラッグ、W07のWin保持列、W04連続Win+↓は個別ゲートで確認する。

> 2026-10-28 #9実測中の本人決定：画面をまたいで上端へ直接ドラッグし最大化した操作はW03だけ、別画面の通常位置で離した移動はW02だけとする。「monitorが変われば常にW02優先」という調査時の仮説はこの境界では採用しない。入力対象・ドラッグ終端・最大化を照合し、Snap Layout選択やprogram最大化を混同しない。移動中の派生復元の非計上は維持する。Win+↑単独と画面移動込みの操作全体との同等性は未成立。左右半分／四隅の画面跨ぎへは優先順位を拡張しない。過去の原本と判断は当時の証拠として保持する。

> **2026-10-28 後続の仕様改訂（調査原本・当時の判断は変更しない）**：上記の「画面跨ぎ上端dragはW03のみ」の排他的ルールを撤回。drag終了時に別monitorへ移動が確定し、同じdragで最大化も確定したら**W02＋W03各1件**、四隅quarterも確定したら**W02＋W07各1件**を記録する。中間monitor変化のみ・派生復元・中間halfは記録しない。操作別記録2件・同一gestureの通知最大1件の契約は[現行要件](../ui-requirements.md)と[#113](https://github.com/YutoMatsui21/shortcut-expert/issues/113)を参照。下記の2026-10-28実測や評価は**当時の証拠と評価**として残し、新方針の技術成立を実証したことにはしない。

> [2026-10-28の8操作調査結果（#9）](eight-operation-validation.md)：既存W12/W01と新規33完了試行を照合し、当時はW12/W01/W04/W06/W11が制約付き着手可、W03/W07/W02は未成立。その後の新仕様と16追加試行による[#14の再審査](compound-drag-validation.md)で、全8ゲートを制約付き着手PASSとした。製品完全対応・リリース合格ではない。下表の初期仮説や過去の結論は最新ゲートの代用にしない。


## Windows操作の技術判断（ステップ3結論）

2026-10-12実装更新：W02・W04・W05・W11を以下の仮説から条件付きで製品へ実装。W05の採用キーは最大化→通常・非arrangedへのWin+↓に限定し、Win+Shift+↓やスナップ解除は今回扱わない。W02はドラッグ開始時の入力照合を終端まで保持し、2画面が左右・上端一致・非重複の場合のみ方向付き案内を行う。移動中の画面構成変更は見送る。W11は破棄前の入力対象と画面を保持する。人工policy／通信／UI試験と実入力の精度は区別し、後者は未確認。以下の表は技術判断時点の仮説・残リスクを記録したもの。

2026-10-11完了。11候補は維持し、資料＋既存実測から実装方針を選べる状態。全件の動作・公開品質の合格ではない。資料上の仮説を実装へ持ち越す新方針はユーザー承認済み。実装後に不成立なら条件限定・修正・後回しを相談する。

要件・キー候補：[mvp-requirements.md](../archive/mvp-requirements.md)。実測：[技術検証記録](overview.md#measurements)。API詳細：[API保証範囲](overview.md#apis)。

### 操作×必要情報×判定仮説

「実装へ」は仕様の根拠、「合成」は観測値からの推論、「UI待ち」はprovider依存。全行に入力・対象・期待結果の対応が必要。未知・注入・競合・対象不一致は見送り、因果関係を保証したとは呼ばない。

| ID | 必要情報／API | 判定仮説・同等キーの条件 | 判断・残リスク |
| --- | --- | --- | --- |
| W01 切替 | mouse/key hook、直接クリックの候補HWND（WindowFromPhysicalPoint/GetAncestor）、前後foreground HWND、EVENT_SYSTEM_FOREGROUNDとcallback時/settle時poll。SWITCHENDは今回未出現 | 背後の別窓へ直接クリック／Alt+Tabの確定後、入力元と最終foregroundを照合し1候補。案内はAlt+Tabを基本とし、番号対応が確証できた場合だけWin+数字を追加。taskbar click・Win+数字はW12のみ | [#7実測](window-switch-validation.md)：自作通常3窓の基本経路は制約付きで実装着手可。負例とW12入口はW01候補0、後着イベントを現在pollと区別。外部アプリ一般・owner・同時program競合・W12製品との統合は#29/#47へ。Edgeタブは2026-10-26の現行要件でW01対象外。番号対応はunknown、Alt+Tabへfallback。追加案内は#96 |
| W12 タスクバーのアプリを開く | UIAのアプリアイコンの存在・座標・順番、mouse/key hook | マウスのアプリアイコンクリックと、存在する番号のWin+1〜9／Win+0を計測。番号不明/該当項目なしは除外、個別窓の起動/選択結果は不要 | **#6/#28：1〜10番の単一Win+数字案内は製品実装済み**。主タスクバーの1/2/9/10番と負例を代表環境で確認（全条件の保証ではない）。**#96で起動済み/未起動判定、起動済み11番目以降のAlt+Tab案内、2候補通知を別途実証・実装**。別タスクバー・overflow・変動はunknownを維持。[原本・限界・採用条件](taskbar-input-validation.md) |
| W02 画面移動 | monitor前後・配置、MOVESIZE開始終了、実入力 | drag終端比較／key＋結果。往復元画面0、途中を数えず、派生復元を別計上しない。Win+Shift+左右は移動方向が明確な2画面等 | **合成＋初期証拠**。細かな座標再現は対象外。上下配置等で方向対応不明なら見送り。Obsidian分類は既存ログから修正可能 |
| W03 最大化 | placement通常→最大化、HTMAXBUTTON／caption・button矩形、input | 同一対象の標準経路＋結果。Win+↑、独自全画面除外 | **実装へ＋初期証拠**。Chrome成立例あり。Obsidian mouseはunknown、標準矩形／UIAで識別できるか未確認 |
| W04 最小化 | placement・MINIMIZE系event、HTMINBUTTON等、input | targetと結果を対応。Win+↓は通常・非arranged等の元状態に限定。Alt+Space→N等はメニュー条件確認時のみ | **実装へ**。既存state観測を拡張、最大化から1回と無条件案内しない |
| W05 復元 | 最大化／arranged→通常・非arranged、button/input | placement＋arranged＋経路。移動開始の派生復元除外。Win+Shift+↓等は前後stateに合う場合 | **実装へ**。最大化復元とスナップ解除を区別 |
| W06 左右半分 | arranged変化、最終可視rect・作業領域・元state、drag終端／input | 非arranged普通窓→arranged、左右半分の定型rect。Win+左右が同じ結果になる元状態のみ | **合成**。API利用・DPI・不可視枠補正は実装時確認。自由比率／境界リサイズ除外 |
| W07 四隅 | W06＋四分割rect、元state、一連input | 非arranged→arranged四隅。方向キー順次操作の途中半分配置を重複計上しない | **合成**。具体的な順序・同等結果は実装時確認。任意layout除外 |
| W08 配置候補を呼び出す | Win+Z／最大化ボタン矩形優先・空矩形時hit fallback、実hover、対象窓、設定の既知状態 | 対象窓を伴う有効なWin+Zまたは500ms以上のhoverを各1操作として認識。メニュー本体の表示成功は問わない | **制約付き成立（#83）**。設定unknownは非計上。製品の自然入力精度・通常環境での合格は未確認 |
| W09 desktop表示 | UIA Show desktop要素、click/key、表示前後 | 識別済み要素＋表示／復帰の対応。Win+D。一窓最小化・desktop通常click除外 | **UI待ち**。設定・要素ID・前後stateが未確定 |
| W10 Task View | UIA button、click/key、識別済みTask View出現 | button＋対象UI出現。Win+Tab。以降の窓／desktop選択は別 | **UI待ち**。専用の安定state契約は今回未確認。Alt+Tab用eventsを代用しない |
| W11 閉じる | activeなtop-level HWND、HTCLOSE／close rect、input、DESTROY／WindowClosed | クリック前からactiveな標準×＋同一窓の閉鎖。Alt+F4。閉鎖前のtarget・画面を保持 | **実装へ**。非active・tab×・確認／中止・tray格納・独自×除外。click／process終了だけで数えない |

キー／定型操作：[Windows公式](https://support.microsoft.com/en-us/accessibility/windows/keyboard-shortcuts-in-windows)、[Snap](https://support.microsoft.com/en-us/windows/experience/snap-your-windows)。W08：[アプリのSnap Layout対応](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-snap-layout-menu)。W09／10：[taskbar](https://support.microsoft.com/en-us/windows/experience/personalization/customize-the-taskbar-in-windows)。仕様はキーの意味の根拠で、検出方式の保証ではない。

標準枠・座標・UIA・イベント仕様はAPIメモを参照。W11の要求／完了：[WM_SYSCOMMAND](https://learn.microsoft.com/en-us/windows/win32/menurc/wm-syscommand)、[WM_CLOSE](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-close)、[Window pattern](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-implementingwindow)。外部WinEvent購読から対象窓のWM_SYSCOMMANDを直接受信できるとは扱わない。

### 誤った置き換えを避ける

- IsWindowArrangedは方向・入力由来を返さない。showCmd通常でもarrangedの場合がある。資料にはprerelease注意・動的取得説明があり、対象runtimeでの利用は未実測。未提供なら配置判定はunknown。
- rectはDPI仮想化・不可視枠、画面は作業領域を考慮して座標系をそろえる。固定pxだけでsnapと断定しない。
- W08は2026-10-23に呼び出し推定方式へ仕様変更。EVENT_SYSTEM_ARRANGMENTPREVIEWはpreview rectの表示であり、W08の呼び出し証拠にも本体表示成功の証拠にも代用しない。W10のSWITCHSTART/ENDはAlt+Tab用。
- W09の裸のdesktop表示をIAppVisibilityだけで断定しない。[API](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-iappvisibility)、[値](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/ne-shobjidl_core-monitor_app_visibility)
- W08〜10の専用APIが存在しないとは断定しない。旧W08の表示成功方式は未成立の調査記録として保持し、現行W08の根拠は[呼び出し推定の実測判断](snap-invocation-validation.md)と[確定要件](../ui-requirements.md#excluded-operations)を優先する。
- UIA tree・提供eventsは固定保証がなく、action eventsにもuser/program両方がある。
- key押下や中間stateを成功数にしない。観測回数を習得率・全操作成功数としない。常用4アプリへの一般化も未確認。

### 実装経路の推奨（詳細設計は未確定）

Electron＋TypeScript／React＋小さなWindows native helper。C#／Win32 helper→TSでJSONを受け取る初期経路は検証済み。Windows APIの直接呼出しまでTSに統一することを必須にしない。Next.js・外部backend・accountは不要という判断。

| 機能 | 仕様上の手段・仮説 | 実装後確認 |
| --- | --- | --- |
| 通知 | BrowserWindow.showInactive／focusable＋React | focus・click阻害、時間・頻度・同時1件 |
| 画面右下 | screen display取得、Win32 physical／DIP変換 | 混在DPI・負座標・画面変更。対象不明なら見送り |
| 全画面抑制 | native前面窓state／rect＋画面を合成 | 覆う／判別不能時は保守的に抑制。自分のisFullScreenを外部判定に使わない |
| 停止 | TS制御＋helper hooks解除・再登録／停止 | 通知停止と観測全停止を分け、再開時に古い候補を数えない |
| 日別保存 | TSで操作ID×日付×mouse/keyを集計、userData等へ保存 | unknown・重複、再起動・日付・30日保持・削除。時計／試験データで確認可能 |
| 配布 | Electron実行フォルダ＋helper同梱 | 配置・起動・runtime依存・通常権限・終了解除 |

根拠：[BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)、[screen](https://www.electronjs.org/docs/latest/api/screen)、[app.getPath](https://www.electronjs.org/docs/latest/api/app)、[packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution)。保存規約は要件書に従い、診断ログを製品の保存形式に流用しない。

通知実表示・React接続・配布・負荷は未検証。既知手段と接続証拠から実装へ持ち越せるが、3日で11候補全採用を保証しない。

### 次工程

最小設計→1操作で検出・通知・記録を接続→state／snap／切替拡張→UI識別待ちを必要情報だけ観測→採用操作の公開前試験。Obsidianの複合分類は実装で修正。未成立時は理由・代案・件数影響を相談し、hoverだけの記録等へ無断で弱めない。追加の本人試行は現在不要。

<a id="apis"></a>

## Windows API：取得情報と限界

2026-10-09の一次資料＋10-11の配置／標準枠API追加。資料上の能力を示すメモで、実機証拠は[技術検証記録](overview.md#measurements)、操作別仮説は[操作別の技術判断](overview.md#operations)。

### 状態・入力・UI

| API／情報 | 仕様上取れるもの | 制限／推論 |
| --- | --- | --- |
| [SetWinEventHook](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook) | desktop events。OUTOFCONTEXTは非同期・順序維持、登録threadにmessage loop必要 | 登録成功≠必要event取得。発生時刻と配送時刻を分ける |
| [WinEventProc](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nc-winuser-wineventproc) | event・HWND・object/child・thread・発生時刻 | mouse/key由来なし、inputとの対応は別判断 |
| [GetWindowPlacement](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowplacement) | showCmdの最大化／最小化／通常 | 失敗あり。原因を返さず、通常でもarrangedの場合あり |
| [IsWindowArranged](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-iswindowarranged) | arranged boolean、snap窓を含む | 方向／原因なし。最大化・最小化と排他、最小化から復帰するとarrangedの場合あり。prerelease注意・動的取得説明、対象runtime未実測 |
| [MonitorFromWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-monitorfromwindow) | 交差面積最大のmonitor。最小化時は直前rect | 変更だけではdrag完了・全面移動を証明しない |
| [GetWindowRect](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowrect) | screen rect | DPI仮想化・不可視枠。可視rectはDwmGetWindowAttribute／DWMWA_EXTENDED_FRAME_BOUNDS、こちらはDPI補正なし |
| [GetMonitorInfo](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getmonitorinfoa)／[MONITORINFO](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-monitorinfo) | monitor／作業領域、primary flag | rectと座標系を統一。MONITORINFOEXの画面名は今回不要 |
| [WM_NCHITTEST](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-nchittest) | 座標のcaption・max/min/close等 | 独自UIの返し方に依存。負座標を符号付きとして扱う |
| [TITLEBARINFOEX](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-titlebarinfoex) | 標準titlebar buttonsのrect・state | 外部独自枠で必要情報が提供されるか未確認 |
| [mouse hook](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelmouseproc)／[key hook](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc) | target queue投入前のinput | 他hookが止め得る。押下≠処理／成功。message loop必要、遅いhookは無通知解除もある |
| [mouse flags](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-msllhookstruct)／[key flags](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-kbdllhookstruct) | injected／lower-integrity flags | 非注入でも意味・対象・成功は未確定 |
| [UIA ElementFromPoint](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomation-elementfrompoint) | 座標上の要素 | 消失時失敗。click原因・成功ではない |
| [UIA events](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-eventsoverview)／[購読](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-eventsforclients) | action／state等 | user/program両方、状態不変でも発生、一部未提供 |
| [UIA tree](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-treeoverview) | app/providerの要素・properties | tree固定ではない。taskbar ID／階層／Win+数字順位の全build保証は今回未確認 |

### Eventの意味

[定義](https://learn.microsoft.com/en-us/windows/win32/winauto/event-constants)：FOREGROUND=前面変更、LOCATIONCHANGE=位置／形／size変化、MOVESIZEEND=移動／size終了、MINIMIZESTART=最小化直前。単独で入力由来・経路・同等キーを証明しない。提供は対象で確認する。

ARRANGMENTPREVIEWはpreview rect、SWITCHSTART/ENDはAlt+Tab用。Snap Layout menu／Task Viewの表示成功へ代用しない。WM_CLOSE／SC_CLOSE等とUIA閉鎖の詳細は操作別判断書へ。

### 判定の条件

input種類・注入flag・target・前後state・競合を組み合わせる。時間的近さは候補。複数経路、hook欠落、要素失敗、競合時はunknown。時間窓は仕様の保証ではない。正解ラベルは本人の実施操作と目視結果で確認し、検出結果自身を正解にしない。

代表例：最大化は同一窓の通常→最大化、切替はclick対象とforegroundとキー到達先、画面移動は同一窓の開始／終端画面。押下だけ・途中境界だけ・細かな配置までの同等キー断定は不合格。

[SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)は人工inputの挿入件数を返し、操作成功数ではない。UIPI・既存押下キーの制約あり。API接続／events／注入flagの試験には使えるが、実mouse由来・本人key利用の合格には代用しない。注入除外によるunknownは通常入力の失敗と区別する。

### TypeScriptとnative接続

Win32はcallback・message loop、UIAはCOMが必要。[UIA概要](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-uiautomationoverview)

[Node addons](https://nodejs.org/api/addons.html)のほか、2026-10-09の公式にはv26.1追加のexperimental [node:ffi](https://nodejs.org/api/ffi.html)がありDLL／callbackを扱える。FFI対応build・callback thread等の条件あり、「純JSでは不可能」と断定しない。実環境Node24.11.1ではexe bridgeを確認しただけ。採用runtime・配布・連続性能は実装後確認する。

<a id="measurements"></a>

## ステップ3：技術検証記録

完了：2026-10-09 19:37:19→10-11 14:31:18 JST。必要情報とAPIから実装方針を判断した。製品実装・公開品質の合格ではない。次は別チャットで最小設計。

要件：[mvp-requirements.md](../archive/mvp-requirements.md)。最新判断：[操作別の技術判断](overview.md#operations)。API根拠：[API保証範囲](overview.md#apis)。再現：[probe再現手順](overview.md#probes)。

### 判定と方針

代表試験はW03最大化・W01タスクバー切替・W02画面間移動。意味・入力由来・結果・同等キー・観測数を確認するためで、公開範囲を3操作へ限定しない。

資料・API初期化・program変更・人工入力・本人の実入力を区別する。時間相関は入力候補であり因果関係の確定ではない。全ログのcausalityConfirmedはfalse。未知・注入・競合・重複を推測で通知／計上しない。

ユーザー希望により、全操作／全アプリの事前反復から「必要情報→API→判定仮説→未確定→不成立時の扱い」へ変更。合理的な仮説は実装へ進め、採否を左右する情報だけ小さく確認する。11候補は維持、削減は相談。追加の本人試行は現在不要。公開前試験は維持する。

### 環境・アクセスの制約

- PowerShell 7.6.6、Windows build10.0.26300（Windows 11は本人申告）、Node24.11.1。dotnetあり／SDK一覧空、Framework4系cscあり。
- CIM OS照会はアクセス拒否、シェルのプロセス照会は常用アプリを確認できず。シェルでの画面列挙1枚、本人probeは2枚。同一環境とみなさない。
- Computer Useはアプリ一覧まで成功。Chrome・Obsidianあり、ChatGPT表示はCodexの識別子。ChatGPT Classicの窓・VS Codeの窓は確認できず。
- Chrome状態取得は「未承認」で拒否。権限変更・通常再試行・JS再初期化後も同じ。設定スクショでは任意アプリ／Chromeオン、保存済みAlways allow一覧は空。一覧へ直接追加できるという説明を訂正した。
- configの許可キーのみ読み、approval_policy=neverを確認。拒否との因果関係は未確定。Ask for approvalへ変更後、20:05:17から「現在URLを十分な確度で特定できずpolicyを適用できない」に変化し、別ターン再試行も同じ停止指示。各回停止。読取成功・設定変更効果は断定しない。
- Computer Useの当時のguidanceは自動Winキー入力を禁止。認証・許可・security画面は操作せず、本人希望で手動試験へ移行。以後AIのアプリ自動入力なし。拒否回避を目的としたChrome読取は行っていない。
- 設定の根拠：[Computer Use](https://learn.chatgpt.com/docs/computer-use)、[権限](https://learn.chatgpt.com/docs/permission-modes)、[自動審査](https://learn.chatgpt.com/docs/sandboxing/auto-review)。現在の許可モードは次チャットで確認する。

### 実測証拠

#### API到達性

[native-health-result.json](../../validation/evidence/native-health-result.json)：自分の非表示窓でplacement・monitor取得、programリサイズの矩形変化とLOCATIONCHANGE1件、WinEvent／mouse／key hook登録。入力hookは即時解除、payload未読、自然入力試行0。TypeScriptからexe起動・JSON受信も成功。連続監視・React・配布の実行証拠ではない。

#### ManualWindowProbe v1

[round1原本](../../validation/evidence/manual-window-observations-round1.jsonl)：10/09 20:28:42保存、20:29:09読取。reset3件を含む11records。

| 本人ラベル | 観測／入力候補 | 評価 |
| --- | --- | --- |
| mouse-maximize | state1→3、nearby-mouse、5ms | 初期取得 |
| key-maximize | 1→3、nearby-key、Win+Up、8ms | 初期取得 |
| mouse-monitor-move | monitor0→1→0→1→0、mouse1／unknown3 | 本人回答は1回のdragで往復・元画面終了。4操作ではなく移動0 |
| key-monitor-move | 0→1、nearby-key、Win+Shift+Right、3ms | 初期取得 |
| program-maximize | 1→3、unknown | この負例ではmouse/key誤認なし |

原因：1秒の近接判定が長いdragを切る、途中のmonitor変化を操作扱い、入力競合／hit test／hook欠落。長時間・競合の修正前失敗を自動再現。v2はcaption実押下＋MOVESIZESTART/ENDで入力候補を保持し、終端と開始を比較。途中を数えず、元画面終了0、競合キーはunknown、終了解除。

[OriginCandidateTests.cs](../../validation/probes/OriginCandidateTests.cs)：12件合格。最大化・短いキー・長いdrag・終了解除・注入除外・競合・途中往復・終端比較・重複・元画面復帰を確認した純粋ロジック試験。OS配送・常用アプリ精度の保証ではない。保存はlatest＋UTC時刻付き原本に変更。

#### ManualWindowProbe v2

[原本](../../validation/evidence/manual-window-observations-20261009-113827-828.jsonl)：10/09 20:40:58保存、20:41:15読取、metadata1＋操作3。2画面、4hooks=true。

- drag8727ms：move-size-end、monitor0→1、drag-mouse、移動1。
- 元画面への往復：移動recordなし。本人が実施・元画面で離したと回答し、未実施と区別して0を確認。
- key：1→0、Win+Shift+Right、nearby-key、3ms。
- program最大化：state1→3、unknown。
- drag行のexpectedLabelはkey-monitor-move。ラベル取得時点の相違があり得るため入力の根拠にしない。新probeは入力時に保持する。
- monitor番号は出現順で、物理左右ではない。反復・入力競合・境界配置・他アプリへの一般化は未確認。

#### TaskbarProbe

[原本](../../validation/evidence/taskbar-observations-20261009-115509-449.jsonl)：10/09 20:55:28保存、20:55:43以降読取。

- foreground／mouse／key hooks=true。UIA appButtons6、ownMatches1、slotCandidate6、error=none。
- mouse切替：taskbar-mouse、67ms、actualTargetMatched=true。
- key切替：Win+6候補、46ms、同じtarget=true。
- keyMappingValidated=falseは取得時点の未検証flag。後続実入力は初期証拠で、全アプリの保証ではない。
- 自分の単独窓・現在配置だけ。外部窓・groups・別画面taskbar・並べ替えは未確認。原本コードはAppid／class／rectから順位候補を作る。固定UIA順序の公式保証とはしない。**2026-10-24のW12新仕様では、これをボタン番号とWin+数字入力の取得に関する初期証拠として扱う。個別結果窓の一致は必須条件から外した（#6）。**

#### ExternalWindowProbe：Chrome／Obsidian

初回：[原本](../../validation/evidence/external-window-observations-20261011-050724-973.jsonl)、10/11 14:10:43保存。chromeだけ選択。Obsidianの選び直しなしという本人申告のため、Obsidian証拠に使わない。

| Chrome初回 | 結果 |
| --- | --- |
| mouse最大化 | 1→3、nearby-mouse、135ms |
| key最大化ラベル | 3→1のrestore、Win+Up、21ms。原因未確定、再確認 |
| mouse画面移動 | move-size-end、0→1、drag-mouse、2980ms |
| key画面移動 | 1→0、nearby-key、Win+Shift+Left、36ms |

再試行：[原本](../../validation/evidence/external-window-observations-20261011-051237-322.jsonl)、14:14:27保存。chrome／obsidianとも選択済み、2画面、4hooks=true。

| 対象／操作 | 観測 | 判定 |
| --- | --- | --- |
| Chrome key最大化 | 1→3、Win+Up、nearby-key、34ms | 正しい初期例。前回不一致の原因は未確定 |
| Obsidian mouse最大化 | 1→3、unknown、inputAge64425ms | state取得、入力由来不成立。独自枠／hit test等の原因未確定 |
| Obsidian reset復元 | 3→1、unknown、75483ms | resetとして記録 |
| Obsidian key最大化 | 1→3、Win+Up、nearby-key、19ms | 初期取得 |
| Obsidian mouse移動 | move-size-end、3→1、monitor0→1、drag-mouse、2579ms、operation=restore | 複合変化をstate優先で分類する不備。移動＋派生復元を別々に数えない |
| Obsidian key移動 | 1→0、Win+Shift+Left、nearby-key、11ms | 初期取得 |

Chromeは2試行で4ケース、Obsidianはkey2ケースの初期証拠。mouse2ケースは未修正。通常サイズから始めたかはログだけで断定しない。

probeは選択1窓のstate／monitor／限定入力候補だけ観測し、文字・title・URLは読まない。外部hit testは20ms timeout、失敗時は候補なし。CodexをChatGPTの実測と混同しない。

### 結論・持ち越し

仕様による4操作、合成仮説3操作、UI識別待ち4操作の根拠と条件は技術判断書へ集約。Electron＋TS／React＋小さなWindows helperが推奨経路で、詳細設計は未確定。

ChatGPT・VS Code、配置系、UI識別、日別保存、通知・全画面抑制・停止、負荷、配布実行、公開精度は未確認。新方針では実装へ持ち越せる。未知なら見送り、件数削減／条件変更は相談する。

### 作業記録（JST）

終了・総経過・手戻りは[mvp-requirements.md](../archive/mvp-requirements.md#工程記録jst)。以下は記録できた区間（終端の応答／保存処理は一部未計測）。

| 日付 | 作業区間 | 時間 | 内容 |
| --- | --- | --- | --- |
| 10/09 | 19:37:19–19:45:34 | 8:15 | 環境・API・probe |
| 10/09 | 19:50:41–19:51:34 | 0:53 | 権限変更後の拒否確認 |
| 10/09 | 20:02:38–20:03:39 | 1:01 | 設定切り分け |
| 10/09 | 20:14:01–20:15:27 | 1:26 | 手動手順 |
| 10/09 | 20:29:09–20:35:44 | 6:35 | 初回評価・v2修正 |
| 10/09 | 20:41:15–20:49:02 | 7:47 | v2評価・taskbar準備 |
| 10/10 | 08:18:52–08:20:44 | 1:52 | external準備・記録 |
| 10/11 | 14:25:04–14:30:22 | 5:18 | 必要情報/API表・最終判断 |

累計33:07。10/09 20:55:43以降のtaskbar評価・ソース複製は終点未計測。10/11の初回／再試行評価・方針変更も厳密未計測。区間間差分（5:07、13:42、5:31等）と夜間は回答待ち中心／本人試行／中断／未計測作業を含むため純粋な待ち時間としない。

手戻り：probe修正1（長いdrag・途中境界）、計画再編1（実機網羅を要求しすぎた）。Obsidian不備2点は未修正、製品実装0。

<a id="probes"></a>

## 技術検証コード・再現手順

製品実装ではない。ステップ3完了、現在追加試行は不要。API到達性／program変化／本人inputを区別し、実測は[技術検証記録](overview.md#measurements)、採用条件は[技術判断](overview.md#operations)。

| ファイル | 用途／確認済み |
| --- | --- |
| NativeHealthProbe.cs／exe、run-native-health.ts | 自分の非表示窓のstate・rect・monitor・event・hook登録、TS→exe→JSON。input payload未読、自然input試行0 |
| ManualWindowProbe.cs／exe | controller＋自作target。v1／v2実施済み。v2はdrag開始／終了比較、長いdrag1・往復0・key移動1・program最大化unknown |
| TaskbarProbe.cs／exe | UIAで自分のbutton ID／class／rectだけ確認。mouse／Win+6でtarget一致の初期例。外部title／browser内容は読まない |
| ExternalWindowProbe.cs／exe | 本人選択1窓のstate／monitor／限定input候補。Chrome4ケース、Obsidian key2取得。mouse由来／複合分類不備は未修正 |
| InputOriginCandidate.cs、WindowStateSequence.cs | 候補・drag終端・state遷移の純粋ロジック |
| OriginCandidateTests.cs／exe | 修正前失敗→回帰12件合格。OS配送／全app精度ではない |

共通：通常権限で本人がExplorerから起動、hook初期化trueを確認。異常／falseなら終了して報告。文字内容・title・URL等を保存せず、限定入力の候補を扱う。近接1秒は仮値、causalityConfirmed=false。monitor番号は出現順。controllerの×で監視解除・保存。最新のmanual-window-observations-20261009-113827-828.jsonl／taskbar-observations-20261009-115509-449.jsonl／external-window-observations-20261011-051237-322.jsonlとUTC時刻付き原本を保持、v1原本はmanual-window-observations-round1.jsonl。各試行間はresetで戻し2秒待つ。

### 手動再現（必要時のみ）

#### ManualWindowProbe

label選択→targetを操作。mouse-maximizeは最大化button、key-maximizeはWin+↑、mouse-monitor-moveは通常窓を別画面へdrag、key-monitor-moveはWin+Shift+左右、program-maximizeはcontrollerのprogram最大化。resetは通常サイズへ戻すbutton。

v2追加ケース：2秒以上dragして別画面で離す（移動1）、1回のdragで境界を往復し元画面で離す（移動0）、key移動1、2秒待ったprogram最大化（unknown）。途中monitor変化を完成操作にしない。

#### TaskbarProbe

ownMatches=1・slotCandidate1〜10・3hooks=trueを確認。mouse-switch／key-switchを選び「候補再取得」。30秒以内に他窓へ切替→自身のtaskbar button／候補Win+数字で戻る。目視とforegroundが同じtargetか確認。候補なし・別appなら成功扱いしない。並べ替え・複数起動は試験外、pin操作は指示していない。30秒超cache・groups・順位不明は見送り。

#### ExternalWindowProbe

対象appを通常サイズにする→「5秒後に手前のウィンドウを対象にする」→5秒以内に対象をclick→controllerでtarget-selectedのappと4hooks=trueを確認。対象を替えるたびに選び直す（再起動不要）。CodexとChatGPTは別。

| label | 対象で行う操作／期待 |
| --- | --- |
| mouse-maximize | max button／maximize＋nearby-mouse |
| key-maximize | 手前でWin+↑／maximize＋nearby-key |
| mouse-monitor-move | 通常窓を2秒以上かけて別画面へ完全drag／move-size-end＋drag-mouse |
| key-monitor-move | 手前でWin+Shift+左右／画面変化＋nearby-key |

resetを選び本人が通常サイズに戻し2秒待つ。できない操作は飛ばして報告し、unknown／recordなしを整えるために反復しない。保存buttonは監視継続、×は解除・保存。

### ビルド

リポジトリのルートからPowerShellで実行。ソースは`validation/probes`、生成exeと今後のログはGit対象外の`.tools/validation`に置く。既存の実測原本は`validation/evidence`に保持する。cscはC:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe。以下は再現用で、今実行する必要はない。

```powershell
$probeCompiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
New-Item -ItemType Directory -Force .tools\validation | Out-Null
& $probeCompiler /nologo /out:.tools\validation\NativeHealthProbe.exe validation\probes\NativeHealthProbe.cs
node .\validation\probes\run-native-health.ts
& $probeCompiler /nologo /target:winexe /out:.tools\validation\ExternalWindowProbe.exe /reference:System.Windows.Forms.dll /reference:System.Drawing.dll validation\probes\ExternalWindowProbe.cs validation\probes\InputOriginCandidate.cs validation\probes\WindowStateSequence.cs
& $probeCompiler /nologo /out:.tools\validation\OriginCandidateTests.exe validation\probes\OriginCandidateTests.cs validation\probes\InputOriginCandidate.cs validation\probes\WindowStateSequence.cs
& .\.tools\validation\OriginCandidateTests.exe
```


