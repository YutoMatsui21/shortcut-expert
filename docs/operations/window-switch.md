# W01：ウィンドウを切り替える

**責務**：通常窓への直接クリックとAlt+Tabによる確定切替を検出し、タスクバー操作（W12）や自動的な前面変更を誤計上しない。[製品要件](../ui-requirements.md#w01-w12)と[技術調査](../research/window-switch-validation.md)を前提とする。

## 1. 操作の成立条件

| 経路   | 確定する条件                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------- |
| マウス | 入力前foregroundとは異なる通常窓を非注入で左押下し、同一窓で解放。入力後のforegroundイベントと最終照会がその窓で一致 |
| キー   | Alt保持→Tab（複数回可）→Alt解放後、最終的に別の通常窓へ切替。Tab回数ではなく**確定した切替を1件**                    |

- `WindowSwitchObserver`は既存hook・foreground WinEventを共用し、`WindowSwitchPolicy`が世代内の一時候補を管理する。stop/startで破棄し、fixtureでは実入力監視を始めない。
- **マウス期限**：downから1.5秒以内、up後50ms以上の照合。dragやmove-size開始は除外。
- **キー期限**：Alt開始から15秒、解放から2秒以内。解放後300ms以上経過した照会と裏付けのあるforegroundを照合する。repeatやTab連打を別件数にしない。これらは保守的実装期限であり、認識精度の実証値ではない。

## 2. 誤計上を防ぐ境界

- 対象は可視・非最小化・非cloaked・ownerなし・captionありの通常root窓。desktop、taskbar、tool/noactivate、child、helper自身、不明な窓は対象外。
- **W12専属**：タスクバーのアプリアイコンクリック／Win+数字はW01へfallbackさせない。W01の成立はW12によるforeground変更だけでは推測しない。[W12](taskbar-input.md)
- Esc、同じ窓への復帰、別入力・追加修飾、注入、競合、入力に先行するイベント、遅着した不一致イベント、SWITCHEND／foregroundのみを除外。アプリ側の自動foreground変更との完全な因果証明は未達。
- Alt+Tab中の**Shell中間窓**は、それ自体を成立根拠としない。入力開始時と同じShell processに限り、可視switcher・不可視ForegroundStaging・同一Shellの不可視switcher UIを限定的に通過扱いとする。中間HWNDの一致や可視イベント到着を必須にせず、その後の**新しい通常窓foregroundと最終照会の一致**を必要とする。別process・不明状態への移行は取消す。
- 入力hookとWinEventの**Windows message timestampを直接比較**し、DWORD wrapを考慮する。イベント時刻をStopwatch時刻へ換算しない。期限計測だけStopwatchを用いる。この区別は実入力での見逃しを防ぐための設計理由。

**既知の未対応**：Edgeのタブ切替は対象外。通常のEdgeウィンドウへのAlt+Tabは同一性を確証できず、現行キー経路では保守的に非計上。直接クリックも対象条件を満たす場合のみ。一般利用環境での成立性・未検証ケースは[#29](https://github.com/YutoMatsui21/shortcut-expert/issues/29)と[#47](https://github.com/YutoMatsui21/shortcut-expert/issues/47)で扱う。1操作へのWin+数字追加候補は将来の[#96](https://github.com/YutoMatsui21/shortcut-expert/issues/96)。

## 3. 通信・記録

`window-switch/window-switch-v1`のv2候補に、異なる対象・由来・対象照合・foreground一致・経過時間・通知monitorを載せる。Mainが必須項目を厳格に検証し、Coreがmouse/direct-click、key/alt-tabの成立を確認する。HWND、process名、タイトル、URL、キー列・座標履歴は送信・保存しない。既存のtransaction重複除外、SQLite日別集計・学習状態・保存後通知を使い、v1へは出力しない。

## 4. 検証と未確認条件

- **自動**：`tests/native/policy/WindowSwitchTests.cs`、`tests/operations/window-switch-detection.test.ts`、`tests/integration/candidate-to-page-model-data-flow.test.ts`。C#→Main parse→Core→SQLite、取消・後着イベント・W12非重複・3状態・停止／保存失敗を確認する。
- **実入力**：`node scripts/acceptance/w01-natural-acceptance.mjs --package-dir <build> --observe-consented`。本人の明示同意後のみ、隔離環境でARM／FINISH・45秒／20分上限を守る。通常データや生入力列を保存しない。
- **既存の局所証拠**：[失敗・原因調査・最終の限定試行](../../validation/evidence/w01-natural-20261026-key-and-negative-results.json)。時刻換算、未定義キーを含む解放判定、Shell中間窓の誤認による見逃しを修正した経緯を含む。自作窓・Chromeの一部試行成功を最終製品全体のR02／J04・OS通知受入の合格とは扱わない。
