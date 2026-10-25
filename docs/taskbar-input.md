# W12：タスクバーのアプリを開く（#28）

W12はアプリアイコンの左クリック（同じ項目でdown/up）と、有効なWin+1〜9／Win+0の初回downを記録する。起動・前景化・グループの選択結果は待たない。[確定要件](ui-redesign-requirements.md#w12タスクバーのアプリを開く2026-10-24-仕様変更)と[#6の採用条件](research-taskbar-input-validation.md#28への採用条件と残る確認)を適用する。

## 製品経路

- `TaskbarInputObserver`は既存hookを共用する。`TaskbarQuery`の独立processで主タスクバーのUIA Buttonを照会し、AppidとTaskListButton分類・可視矩形・IDの一意性・重なりを検査する。Nameや窓タイトルは読まない。Appidと矩形はメモリ内だけで扱う。
- 250ms間隔で最大1照会。hook callbackはUIAを呼ばない。照会の2秒timeoutでworkerを終了し、次回再生成する。workerは親終了と2.5秒の照会watchdogを持つ。stopはworkerと仮候補を破棄する。
- 入力前の照会開始から750ms以内にある番号だけを仮候補にし、入力後に開始した照会で同じ項目・番号・配置を再確認する。確定は入力から2.5秒以内、仮候補は最大16件。変化・失敗・期限切れは破棄し、保存・通知へ流さない。照会間の並びが変わって戻る場合まで原子的に保証する方式ではない。
- 横向き主タスクバーで確認できた1〜10番だけを扱う。別タスクバー・overflow・RTL・分類不明・古い照会はunknown。未検証条件を番号へ推測変換しない。これらは製品の対応完了や要件範囲の縮小を意味しない。
- 物理座標と主root一致を確認する。非app領域・サムネイル・追加修飾・repeat・注入を除外する。起動時に押下済みのキーは全解放後に有効化する。
- Win+数字は既存window trackerへ渡さず入力を解除する。W01検出器は未実装なので、将来のW01もtaskbar由来入力を受理しない契約を維持する。

`taskbar-input/taskbar-input-v1`の専用v2証拠は番号、対応確認、入力前snapshot age、確定までのage、通知用monitorだけ。Mainが必須fieldを厳格検査し、CoreがW12とWin+数字へ変換する。旧activation/unverified証拠は採用しない。v1には送らない。採用後は既存のtransaction重複除外、日別SQLite保存、3学習状態、保存後のmouse通知、pause/stop・復旧、両ページの集計を通る。通常保存は既存契約のままで、番号・Appid・入力時刻列・座標履歴を追加保存しない。

## 検証入口と証拠の範囲

- `tests/native-policy/TaskbarTests.cs`：1〜10番、Win+0、repeat、修飾・注入・開始時押下、hit境界、入力後照会、変動・鮮度・期限・stop・世代とv1除外。本番C#出力をMain→Coreへ通す。
- `tests/native-taskbar-query.test.ts`：本番query transportのworker往復・再利用・timeout・再生成・dispose。fixture workerを使いShell UIAと実入力は読まない。
- `tests/taskbar-input.test.ts`：strict parse、unknown・競合、実SQLiteの両入力・3状態・重複・pause/stop・保存故障/retry。known zeroの能力は主張しない。
- `tests/fixture-integration.test.ts`：両入力×3状態→SQLite Worker→一覧/記録model→保存後の標準通知adapter、再open。
- 通常と同梱版smoke：helper→Main→Core→保存→ReactのW12 mouse1/key1、pause中通知なし、再配送除外、W01未計上。人工fixtureであり自然入力の証拠ではない。

## 自然入力の受入

明示同意の後、`node scripts/w12-natural-acceptance.mjs --package-dir release/issue-28 --observe-consented`で専用同梱版・新しい隔離SQLite・手動panelを起動する。通常版を先に終了する。起動と試行間は観測せず、ARMからFINISHまでだけ観測する。45秒の試行期限、20分のsession期限、panel終了時のstopを持つ。

panelでkind、state、pause、期待slot（負例は0）を選ぶ。キーを全解放してARM、ARMEDから3秒待ち、指定入力を1回行い、さらに3秒待ってFINISHする。slotは1〜9、10はWin+0。通常アプリの主アイコンmouse/key、3状態、pause/stopと復旧、長押し、追加修飾、無効番号、空白、サムネイル後続、別タスクバーを確認する。pin/並べ替え/overflowを作る変更は内容を示して個別同意を得る。

結果は試行ごとの期待slot、件数差分、slot一致、通知要求数と誤番号、W01差分、無効/期限/障害だけを保存する。キー列・入力時刻列・アプリ識別子は保存しない。通知要求の成功とOS表示は別であり、表示・案内番号は本人確認を併記する。[R02](ui-redesign-requirements.md#r02自然入力の機能確認2026-10-24-試行方針改定)に従い各ケース原則1回、予想外だけ再試行する。最終同一buildの再受入は#47。

自然入力・J04の通常環境・別タスクバー/overflow等の未成立条件が残る間は、#28と公開判定を完了扱いにしない。
