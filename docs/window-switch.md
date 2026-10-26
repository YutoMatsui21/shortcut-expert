# W01：直接クリックとAlt+Tabによる切替（#29）

基本検出器をNative→v2 protocol→Core→保存後通知・一覧/記録へ接続した。本人が認めたEdgeタブ対象外の範囲で、隔離実入力によるW01の局所確認結果を以下に記録する。[#7の研究](research-window-switch-validation.md)で得た基本経路を採用し、全12操作のR02/J04と同一最終buildの#47は別途確認する。番号対応はunknownで、案内はAlt+Tabのみ。追加候補は#96へ残す。

## 製品経路と除外

- `WindowSwitchObserver`は既存のmouse/key hookとforeground WinEventを共用する。message threadの`WindowSwitchPolicy`が1件の有界な仮候補を管理し、stop/startで破棄する。fixtureでは観測経路を開始しない。
- mouseは非注入の左down前のforegroundとhit rootが異なり、同じ対象でup、対象foregroundのイベントと最終pollが一致した場合に1件。drag閾値を越える移動・movesize開始は取消。downから1.5秒以内、upから50ms以上で確定する。
- keyは入力解放後に開始したAlt保持→Tab→Alt解放を1件として扱う。複数Tab・repeatで候補を増やさず、解放から300ms以上経過したpollと裏付け済みforegroundを照合する。Alt開始から15秒、解放から2秒が上限。期限は暫定値であり、取りこぼし・遅延・通常利用での成立は実機確認が必要。
- Alt+Tab中のShell中間窓は、入力開始時と現在のShell processが同じ場合だけ限定的に扱う。可視のswitcher UI、不可視の`ForegroundStaging`、同じShellの不可視switcher UIを区別する。不可視窓のHWNDの同一性やUI表示イベントの受信は成功条件にしない。中間窓は成功根拠にならず、通過後は対象の新しいforeground通知と最終pollの一致が必要。確定先は保持し、別の通常窓への変更や検証不能な窓は取消にする。
- callback時のforegroundとイベントHWNDが違う後着イベント、入力より古いイベントは成功根拠にしない。SWITCHEND単独、foreground単独・同窓・元窓・Esc・追加key/修飾・Alt再押下・注入・混合mouse/key・競合・不明窓は非計上。検出不能なprogram同時前面化の因果まで証明する方式ではない。
- 入力とforegroundの前後関係はhookのmessage timestampとWinEvent timestampをDWORDのwrapを考慮して直接比較する。WinEventのtick差をStopwatchへ換算して順序判定しない。期限だけStopwatchを使う。[WinEvent timestamp](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nc-winuser-wineventproc)、[hook timestamp](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-kbdllhookstruct)、[GetMessageTimeの起点とwrap](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getmessagetime)。
- W12のtaskbar clickは通常窓hitに該当しない。Win+数字はW01候補を作らない。有効番号は独立したW12の前後snapshot照合で判断し、W01へfallbackしない。
- 窓は可視・非最小化・非cloaked・ownerなし・captionありのrootで、通常権限の別processを検査する。desktop・taskbar・tool/noactivate・child・helper自身・不明窓は除外。特殊owner窓などの日常条件の対応完了を意味しない。
- Edgeのタブ操作は本人判断でW01の対象外。通常のEdge窓へのAlt+TabはW01の対象だが、現実装はタブと個別窓の同等性をHWNDで証明できず、Edge宛てのkey経路を一律非計上にする。通常のEdge窓を区別して計上する条件は#29の未達として残す。Edge窓への直接clickは他アプリと同じ通常窓検査を通る場合だけ候補になるが、実機未確認。この制約を全12操作のJ04合格とは扱わない。

`window-switch/window-switch-v1`は前後が異なること、通常窓・入力対象・foregroundの一致、入力経過と解放後の待機、通知用monitorだけを渡す。HWND/PID・process名・窓名・URL・キー生ログ・入力時刻列・座標履歴は送信/保存しない。Mainは必須fieldを厳格検査し、Coreはmouse/direct-click、key/alt-tabと期限を検査する。v1には出力しない。既存transaction重複抑止・SQLiteの日別集計・3状態・pause/stop・保存後通知・再送抑止を利用し、保存形式とPreload APIは変更しない。

## 検証と実入力確認入口

- `tests/native-policy/WindowSwitchTests.cs`：本番C# policyのmouse/key・複数Tab・取消・競合・後着・期限・W12入口・世代/v1除外。C# serialize→Main→Coreも確認。
- `tests/window-switch.test.ts`、`tests/fixture-integration.test.ts`：parse/Coreの負例、SQLite Worker・3状態・保存後通知adapter・両ページ集計、再送・pause/stop・保存失敗と復旧。
- 通常/同梱smoke：人工v2を実helper通信へ投入し、Reactと隔離保存を確認。実入力・OS可視通知・精度の証拠ではない。
- `tests/w01-natural-acceptance.test.ts`：手動試験計画、W01の通知キーとW12件数を独立検査。bootstrap隔離・ARM gatingは既存試験へ追加。

```powershell
node scripts/w01-natural-acceptance.mjs --package-dir release/issue-29 --compile-only
# 本人の明示同意・準備完了後のみ
node scripts/w01-natural-acceptance.mjs --package-dir release/issue-29 --observe-consented
```

panelはtool windowでW01対象外。ARM後4秒はhookを開始せず開始窓を選ぶ。ARMED後に1操作、3秒待機、FINISHで解除する。各試行45秒・session20分上限、CANCEL/終了でも解除。自作A/B/Cとowned popupを用意し、代表外部アプリは別ケースで確認する。通常データを使わず、build全ファイルhashと件数・通知要求・状態・期限・W12集計だけを残す。UI目視、同等性、対象選択と環境条件は本人が確認する。API通知要求はOS可視通知の証拠ではない。

必要ケースは直接click、Alt+Tab、複数Tab、Esc、元窓、同窓、program単独、W12 click/Win+数字、switcher mouse、owner/Edge条件、3状態・通知停止・全停止。各ケース原則1回で、予想外の場合だけ理由を残して再試行。自作窓だけで通常環境の受入合格にはしない。

2026-10-26のローカル確認：型検査、unit全265件、native全7件（内部で本番C# policy 260項目）、helper/Electron build、通常/同梱fixture smoke、panel compileとlauncher構文検査が成功。専用CodexレビューのP2（Alt解放後の現在の不明窓への遷移を無視していた）を、修正前に失敗する回帰テストで確認して修正し、変更全体の再レビューは追加指摘なし。build/smokeのsandbox権限エラーは通常環境で再実行して成功。NuGetの脆弱性情報取得にNU1900警告があり、脆弱性情報の取得成功は主張しない。実入力観測・R02/J04・OS可視通知・NSIS・リリース受入はこの結果に含まない。

## 最初の製品実入力試行と時刻比較の修正

本人の明示同意・準備完了後、commit aeb478aの同梱版でmouse/direct/learningを実施した。初回と本人希望の再試行の計2回、本人はBへ切替したと申告、通知は見えなかったと申告。両方とも実行のvalidはtrueだが、W01 countsはmouse/keyとも0、通知要求0、detectorPassed/notificationRequestPassedはfalse。失敗を成功へ置き換えず、[初回build](../validation/evidence/w01-natural-20261026-initial-build.json)と[終了済み結果](../validation/evidence/w01-natural-20261026-initial-results.json)を保持する。観測は終了し、アプリはexit 0で終了した。

実入力hookなしの自作窓で本番の通常窓Readは成功した。別途、Win32 tick差をStopwatchから引く時刻換算で入力後の有効foregroundが入力前へ変換される不具合を人工時系列で再現し、修正前のassert失敗を確認した。入力/foregroundのnative timestampを直接比較する方式へ修正し、同tick・古いevent・DWORD wrapの回帰を追加。本番C# policy 260項目が成功。この人工再現は初回2試行の具体的な棄却理由を実測したものではなく、実入力0件の原因確定・修正後合格は別途確認が必要。

## 初期解放判定の見送り原因と修正

時刻比較修正後も直接clickは0件で、別の一時診断版を手動ARM/FINISHして確認した。固定理由別カウンターでneutralBlocked=98、notNeutral=4、入力候補生成0が判明した。さらに手動ARM/CANCELで、ボタン・修飾・既知キー・IME・定義外値のカテゴリだけを集計した。neutralBlockedReserved=196/196、通常のキー/修飾/IMEのblockは0、ボタンは4回だった。生キー値や押下時刻列は収集していない。この試行は本人が操作間違いを申告しCANCELしており、受入成功には使わない。[修正後の失敗・診断・終了結果](../validation/evidence/w01-natural-20261026-followup-results.json)。

全整数1〜254をGetAsyncKeyStateへ渡す走査が、通常入力キーとして定義されない値の状態に妨げられていた。System.Windows.Forms.Keysの定義済みキー/ボタンを1〜254へ絞って重複除去し、解放判定へ渡す方式へ修正した。既知キー・ボタンの押下除外は維持する。非キー値の状態によって確定clickが除外される人工回帰を修正前の失敗から確認し、16種類の実キー/ボタンの押下除外も検査した。一時診断のtransport・counter・テスト補助は除去した。実入力修正版の受入は別途確認が必要。

## Shell中間窓の修正と後続の実入力確認

定義済みキーへの修正後、直接clickはmouse 1件・通知要求1件となり、本人も通知表示を確認した。一方、Alt+Tabは本人が切替を確認しても0件だった。固定理由別診断を段階的に行い、Shellの不可視中間窓が解放前後で異なるHWNDとなるケースを確認した。中間窓の同一HWNDと可視switcherイベントの受信を必須にする仮定を除去し、Shell process照合、確定先の保持、中間窓通過後の新しいforeground照合を維持した。後着イベント、不可視の偽switcher、別process、Shell交代、B→中間窓→Cの誤採用を人工回帰で検査した。

[終了済みの診断版セッション](../validation/evidence/w01-natural-20261026-key-and-negative-results.json)では、Tabを4回押した1操作がkey 1件・通知要求0件となり、本人もBへの切替を確認した。Esc、元窓への復帰、同窓、program単独、実際のswitcherサムネイルのmouse選択はW01 0件・通知要求0件で、本人も通知なしを確認した。操作間違い、FINISH前のChatGPTへの追加切替、サムネイルを選ばなかったケース、owned popupが見えず実行できなかったケースは別注記し、対応する受入成功には使わない。これらはビルドhashを付けた診断版での限定観測であり、診断除去後の最終build・代表外部アプリ・W12帰属・R02/J04全体の完了を意味しない。

後続セッションではowned popupを表示してからC→popupを実施し、本人が切替・通知なしを確認、W01は0件だった。Chromeへのtaskbar clickはW12 mouse 1件のみ、Win+数字はW12 key 1件のみ、W01はいずれも0件だった。本人もChromeへの切替と、click時のWin+数字通知・key時の通知なしを確認した。最初のtaskbar clickはW12 1件でも本人が切替を確認できなかったため、成功扱いせず再試行と分けた。Chromeのタイトルバーへの直接clickはW01 mouse 1件・通知要求1件・W12 0件で、本人もChromeへの切替とAlt+Tab通知を確認した。これらも同じ診断製品buildでの限定観測として記録する。

診断除去後の全体レビューで、Alt保持中の不明窓通過後に候補が復活する問題を指摘された。修正前の人工操作列の失敗を確認し、不明foregroundで取消にした。手動panelはARM直後から条件選択を無効にし、試験中にシナリオが変わらないよう修正した。この版の製品実入力では本人がBへの切替を確認したがW01は0件だった。固定カテゴリだけの再診断で、Alt保持中に同じShell processの不可視switcher UIが現れ、候補が取消されたことを確認。診断側の許可リスト漏れによる無効試行も残した。この既知class・同一Shell process・不可視の組み合わせだけを中間状態として追加し、入力由来や最終切替先の確証には使わない。分類の修正前失敗と修正後成功、異なるPID・可視UIの非該当を本番C# policyで確認した。

診断除去後の最終製品buildでは、本人が自作Bと代表外部アプリChromeへのAlt+Tab切替を各1回確認し、どちらもW01 key 1件・W12 0件、通知要求0件だった。隔離buildのhashと失敗・診断・最終結果を同じ[証拠ファイル](../validation/evidence/w01-natural-20261026-key-and-negative-results.json)に保持する。型検査、unit 265件、native 7件（本番C# policy 291項目）、通常/同梱fixture smokeが成功。診断除去後の全体レビューで指摘された2点と、不可視Shell UIの追加は再レビュー済みで追加指摘なし。Edgeタブは対象外だが、通常Edge窓へのAlt+Tabは未対応で#29に残る。#47の同一最終build受入とNSIS配布は別途未実証とする。
