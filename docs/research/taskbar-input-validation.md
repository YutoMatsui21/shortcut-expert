# W12：タスクバー番号と入力操作の技術検証（#6）

2026-10-25。対象は[#6](https://github.com/YutoMatsui21/shortcut-expert/issues/6)の2026-10-24改訂（取得本文hash `c6ff77f575afa07a573b1fd071837d55f4218700f340766d7cdb18d4bb8e91cd`）と[確定要件](../ui-requirements.md#w01-w12)。製品コードは変更しない。

**結論：G-W12は制約付きで実装着手可。** 現行Windowsの主タスクバーでアプリ項目・番号の取得、通常アプリのmouse/key、10番のWin+0、負例除外を実測した。別タスクバー・overflow・変動中・古い照会はunknownにする。これは#28へ進むための技術判定で、製品の対応完了・R02/J04・#47の合格ではない。下記の採用条件を製品経路で成立させる必要がある。

## 検証方式

[TaskbarInputProbe.cs](../../validation/probes/TaskbarInputProbe.cs)と[実行入口](../../scripts/taskbar-input-probe.mjs)を追加。旧TaskbarProbeの前景化・自作窓一致・30秒cacheは使わない。新probeは入力だけを候補として数え、アプリ起動や結果HWNDを追わない。

- `Shell_TrayWnd`配下のUIA Buttonから、AutomationIdの`Appid:`接頭辞とClassNameの`TaskListButton`を両方満たす項目を列挙。可視・正面積・タスクバー内の矩形を左から並べる。番号1〜9はWin+1〜9、10はWin+0。
- ID・矩形はローカルworkerからpanelへのメモリ内通信だけ。Name、窓タイトル、URLを照会しない。worker標準出力をファイルへ保存しない。
- UIAは再利用する独立processで照会ごとに最大2秒。worker自身にも親終了監視と照会中の最大2.5秒のwatchdogを置く。失敗・timeoutではworkerを終了し、次回は作り直す。非ARM時は照会要求を送らず、workerは標準入力を待つだけ。失敗・timeout・重複ID・重なる矩形・不明app分類・非表示app・検出できたoverflowはunknown。主タスクバー以外のクリックは候補にしない。
- 手動ARM時に新規照会し、取得開始から750ms以内・入力解放済みのときだけhookを開始。ARM中は250ms timerで次の照会を要求し、照会は最大1個。入力時の照会開始から750msを超えた候補はunknown。FINISH・30秒上限・窓終了でhookを解除する。
- 左buttonのdown/upが同じ項目上で成立したときだけmouse候補。keyはWin+数字の初回downを数え、修飾付き・長押しrepeat・注入を除外する。該当項目数に足りない番号は数えない。
- 試行中またはFINISH時に列挙内容が変われば試行全体をunknown。試行結果はケース名、期待番号、候補件数・番号、unknown理由、項目数、別タスクバー有無とmouse判定段階別の件数だけを保存する。入力時刻列・キー生ログ・座標履歴・アプリIDは保存しない。
- 診断版はper-monitor DPI awarenessを要求し、物理座標を受け取る`WindowFromPhysicalPoint`を使う。secondary上のクリックと、主タスクバー矩形内なのにrootが一致しないクリックはunknown。段階別件数は主root一致・主矩形内・app矩形内・secondary一致の集計で、座標自体は保存しない。

**限界**：前後のsnapshotが一致しても、照会の間に並びが変わって元へ戻る可能性がある。UIA列挙と入力は原子的ではなく、左からの順位がWin+数字の番号に一致することもWindows全buildで保証されない。従って出力は`eventTimeMappingProven=false`、`productPass=false`の研究候補。安定配置での一致と変動中の安全性は別々に判定する。secondaryの存在は記録するが、別タスクバーの番号対応を推測しない。

## 実行方法

```powershell
node scripts/taskbar-input-probe.mjs --self-test
# 本人が明示同意した後だけ
node scripts/taskbar-input-probe.mjs --observe-consented
# 10番やoverflowを調べるための専用窓（hook/UIAなし、1〜24個）
node scripts/taskbar-number-fixtures.mjs 3
```

初期状態ではhookなし。caseとexpected slot（負例は0）を選び、ARM→手動操作→FINISHを各ケース原則1回実施。ARMは新規query完了後に成立するので、ARMED表示を確認して操作する。起動・試行間・終了後は観測しない。閉じると終了。sessionは最大20分で、強制終了時の未完試行は捨てる。保存先は`.tools/validation/taskbar-input/trials-*.jsonl`。source/exe hashで試験版を対応付ける。

実機ケース：外部アプリのmouse/key、Win+0、長押し、追加修飾、存在しない番号、非app要素、thumbnail、並べ替え、pin/unpin、起動/終了、overflow、secondary。pin/並べ替え等の環境変更は事前に内容を示して同意を得る。配置変更は非ARM時に行って再ARMした追従と、ARM中に変えたunknownを区別する。未実施条件を成功にしない。

[番号用の専用窓](../../validation/probes/TaskbarNumberFixture.cs)はprocessごとに異なる自作AppUserModelIDを指定する。通常アプリの設定・pinを変更せず項目数を増やすためのfixtureで、各窓とrunnerは最大20分。窓を閉じれば項目を除去できる。専用窓での番号確認を通常アプリ全般の実証に置き換えない。

## 結果

- compileと11件のfixture自己検査を実施。Win+1、repeat、Win+0、追加修飾、注入Win、注入数字、注入chord完了後の物理入力への復帰、Winなし、矩形端点、unknown矩形を確認。初期版の出力は10件表記だったがassertは11件あり、診断版で件数表示を訂正した。実入力・Windows Shell列挙の証拠ではない。
- 実入力観測への本人同意を2026-10-25に取得。並べ替えと専用窓のpin/解除にも個別同意を得た。最終的に本人が試験窓・panel終了と元のpin/配置への復元を確認した。
- 初回session：Windows build `10.0.26340.0`。source hash `5ad1bf3d55d183b2fcf0c7f042fd12fc37d432c7423b8d5d9ee98e9e2a23de94`、exe hash `c30590c354b55f76640b7e1f7ca2ecf60839ad5e1396295087320292c0e1a579`。UIAは主タスクバーの7項目とsecondaryの存在を取得し、ARM前照会はfresh/errorなし。本人の手動2ケースでWin+1候補1件、mouse候補0件。mouseは本人申告で**別画面側のタスクバー**へのクリックだった。主タスクバーの検出失敗や非app負例の証拠に流用しない。
- 同sessionの追加5ケース：主タスクバーのmouseは候補0で不成功。key-repeatは`stale-snapshot-at-input`のunknown。Win+Shift+1、7項目時のWin+0、主タスクバー空白は各候補0。本人は全ケース実施と、Win+Shift+1で新しい窓が開いたことを報告した。負例3件のpanel期待番号は1のままだったため、ログのexpectedSlotを正解として扱わず、操作指示の期待0と候補0を照合する。主mouseとrepeatは予想外のため診断版で再確認する。
- 診断版source hash `0db615d9b38096bb5c3289579f90f6b5ce60bd84f139725835a1375a1c7de0f2`、exe hash `8ccfbe0ce09a1c0c2fe73462f87008baafad6c938f48dc6504815f66734112d1`。本人による再確認で主mouseは候補1・slot1・unknownなし。主root一致／主矩形内／app矩形内がそれぞれ1件で、secondary一致は0件。物理座標APIへの変更後に改善したが、API変更とDPI awareness変更のどちらが単独原因だったかは分離していない。key-repeatは再びunknownで、実機での安定取得は未成立。
- 同意を得た1→2番の並べ替え中はunknown、変更後のWin+2は候補1・slot2・unknownなし。変更後のmouseは主root・主矩形・app矩形に各1件到達したがunknown。本人が3ケース実施と元配置への復元を報告した。照会ごとのprocess起動コストを除くためworkerを再利用する版へ変更し、750msの鮮度条件は維持した。
- worker再利用版のfixture自己検査は15件。従来11件に、fixture-only応答の往復、同じworkerの再利用、停止したworkerのtimeout、次回worker再生成を追加した。これらのself-testはShell UIAを照会しない。
- worker再利用版source hash `ed0804c810144ac9ef4787fe288fb3339fa496d077719587d2aa0f404b02f99e`、exe hash `4e01ac6d1864bfcd605e1113d537a52e9eeb856cda16af187169efe7c1a5f022`。本人の長押し再確認でkey候補1・slot1・unknownなし。試行内最大query時間532ms、入力時snapshot age最大246msで750ms条件内だった。これらは1試行内の集計値で、通常利用の速度や精度の統計ではない。
- 専用窓を3つ追加し、主タスクバー10項目・unknownなしを取得。Win+0はkey候補1・slot10、10番クリックはmouse候補1・slot10で各unknownなし。最大queryはそれぞれ117/122ms、入力時snapshot ageは173/208ms。専用窓を含む境界ケースの証拠で、通常アプリ10種類の検証ではない。secondaryクリックはsecondary一致1件・候補0件・unknown。本人が3ケース完了を報告した。
- 専用窓終了中は`layout-changed-or-query-failed`でunknown。サムネイルを伴う主アプリアイコンクリックはmouse候補1・slot1、その後のサムネイル選択だけの試行は候補0。結果HWNDを調べずに初回アイコン操作と後続操作を分離できた。
- 専用窓のpin/解除操作は各候補0。pin後のクリックは期待9に対しmouse候補1・slot9。期待番号を設定し忘れて操作前にやり直した試行は候補0の別行として原本に残し、番号一致の証拠から除外した。
- 専用窓24個でoverflowを作り、ARM前照会が`primaryApps=28,error=overflow-unknown,queryFresh=true`となってARMを拒否した。28はその時に列挙できた可視項目数で、全項目数や利用可能なslot数ではない。hookを開始せず、入力操作は求めなかった。追加した専用窓24個は自作exeの絶対パスを照合して通常の窓終了要求で閉じ、残存なしを確認した。
- 最終ソースでは、不明classの`Appid:`項目もunknownへ落とす保守的な分類を追加し、Win+1〜9／Win+0の10対応をfixtureで確認した。最終自己検査は25件合格。実機版からの本番候補ロジック差分はこの未知分類の不採用だけで、実機のsource/exe hashは原本どおり保持する。最終ソース全体を再度実入力で試験したという意味ではない。

### 原本と証拠の範囲

- [初期版：7完了試行](../../validation/evidence/taskbar-input-20261025-initial.jsonl)
- [物理座標診断版：5完了試行](../../validation/evidence/taskbar-input-20261025-diagnostics.jsonl)
- [worker再利用版：11完了試行とoverflowのARM拒否](../../validation/evidence/taskbar-input-20261025-worker.jsonl)

3sessionとも未完試行なしで終了。原本の失敗・unknown・期待値取り違えを修正していない。正常ケースは反復せず、予想外の結果の切り分けと本人の操作前のやり直しだけを追加した。単発の機能確認であり95%精度や通常利用性能の実証ではない。製品の自然入力確認は[現行R02](../ui-requirements.md#release-acceptance)に従う。

## #28への採用条件と残る確認

1. **候補をそのまま保存・通知しない。** このprobeの件数はFINISH後の再照会と試行中の変化検査を含めて解釈する。製品では入力ごとの有界な確定処理と照会世代を設け、採用前に同じ項目・番号・配置であることを再確認する。変化・照会失敗・鮮度不足・分類不明はunknownにし、仮候補を日別件数や通知へ流さない。
2. 物理座標・DPI awareness、主タスクバーのroot一致、可視app分類、順位、1〜10の存在を確認する。secondary/overflowを主タスクバーの番号へ推測で対応させない。全build共通のUIA契約や照会間の原子的な番号保証は今回実証していない。
3. 注入・追加修飾・repeat・非app・サムネイル後続入力を除外し、Win+数字の結果窓・foreground成功を待たない。W12の由来をW01へ二重計上しない。**W01との統合・重複0は今回の独立probeでは未検証**。
4. 現行Windows build/横向き主タスクバーの実測であり、別build・RTL・自動非表示・高負荷・通常アプリ全般の網羅ではない。secondary/overflowを含む通常利用での製品対応とunknown率は#28/#47のR02/J04で判断し、今回のunknownを製品完全対応や受入成功へ置き換えない。要件上の対応範囲は縮小しない。
5. 日別保存・通知・学習状態・pause/stop・UI統合は未実装。今回の原本は製品経路の検証ではない。#9/#14全体と公開判定は未完了のまま。

## APIの根拠

[Microsoftのショートカット一覧](https://support.microsoft.com/en-us/accessibility/windows/keyboard-shortcuts-in-windows)はWin+数字の意味を示すが、Shell UIAから番号を得る方法の保証ではない。[UIA tree](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-treeoverview)の構造はproviderに依存する。[LowLevelMouseProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelmouseproc)はhookを短時間で返す必要があるため、UIA照会はhook callbackの外へ置いた。

[MSLLHOOKSTRUCT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-msllhookstruct)の座標はper-monitor-aware screen coordinates。[UIAの画面拡大への対応](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-screenscaling)と[WindowFromPhysicalPoint](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-windowfromphysicalpoint)を参照して座標系を明示した。この変更が初期版mouse不成功の原因を解消するかは実機の再確認で判断する。
