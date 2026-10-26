# W01：直接クリックとAlt+Tabによる切替（#29）

基本検出器をNative→v2 protocol→Core→保存後通知・一覧/記録へ接続した。**実入力の製品受入は未実施、#29は未完了。** [#7の研究](research-window-switch-validation.md)で得た基本経路を採用し、通常Windows環境のR02/J04と同一最終buildの#47は別途確認する。番号対応はunknownで、案内はAlt+Tabのみ。追加候補は#96へ残す。

## 製品経路と除外

- `WindowSwitchObserver`は既存のmouse/key hookとforeground WinEventを共用する。message threadの`WindowSwitchPolicy`が1件の有界な仮候補を管理し、stop/startで破棄する。fixtureでは観測経路を開始しない。
- mouseは非注入の左down前のforegroundとhit rootが異なり、同じ対象でup、対象foregroundのイベントと最終pollが一致した場合に1件。drag閾値を越える移動・movesize開始は取消。downから1.5秒以内、upから50ms以上で確定する。
- keyは入力解放後に開始したAlt保持→Tab→Alt解放を1件として扱う。複数Tab・repeatで候補を増やさず、解放から300ms以上経過したpollと裏付け済みforegroundを照合する。Alt開始から15秒、解放から2秒が上限。期限は暫定値であり、取りこぼし・遅延・通常利用での成立は実機確認が必要。
- callback時のforegroundとイベントHWNDが違う後着イベント、入力より古いイベントは成功根拠にしない。SWITCHEND単独、foreground単独・同窓・元窓・Esc・追加key/修飾・Alt再押下・注入・混合mouse/key・競合・不明窓は非計上。検出不能なprogram同時前面化の因果まで証明する方式ではない。
- W12のtaskbar clickは通常窓hitに該当しない。Win+数字はW01候補を作らない。有効番号は独立したW12の前後snapshot照合で判断し、W01へfallbackしない。
- 窓は可視・非最小化・非cloaked・ownerなし・captionありのrootで、通常権限の別processを検査する。desktop・taskbar・tool/noactivate・child・helper自身・不明窓は除外。特殊owner窓などの日常条件の対応完了を意味しない。
- Edgeを含むAlt+Tabは、タブと個別窓の同等性をHWNDで証明できないため非計上。Edgeへの直接clickは通常窓検査を通る場合だけ候補になるが、実機未確認。これは製品要件の縮小やJ04合格ではなく、残る障害として扱う。

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

2026-10-26のローカル確認：型検査、unit全265件、native全7件（内部で本番C# policy 240項目）、helper/Electron build、通常/同梱fixture smoke、panel compileとlauncher構文検査が成功。専用CodexレビューのP2（Alt解放後の現在の不明窓への遷移を無視していた）を、修正前に失敗する回帰テストで確認して修正し、変更全体の再レビューは追加指摘なし。build/smokeのsandbox権限エラーは通常環境で再実行して成功。NuGetの脆弱性情報取得にNU1900警告があり、脆弱性情報の取得成功は主張しない。実入力観測・R02/J04・OS可視通知・NSIS・リリース受入はこの結果に含まない。
