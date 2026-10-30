# C07：ChromeとExplorerの解放位置（session18）

## 固定した実測

製品revision `2ec7520`、hash `4fc685d4ce54e03d50c6a7e5a3df90567a2506ecd35edb8dd16fc900eb82d1cb`、既存診断ON。原本は `../evidence/issue-47/session18-*.json`。本人はChrome通知なし／Explorer通知ありと報告。

- Chrome：caption入力、対象・foreground、movesize始終、arranged終端を確認。終端の左端・横半分・上端・縦半分は一致し、quarter形状が成立。その他のDragガードも通るが、`PlacementSideAbove32=1`で8 physical pxのside解放条件に棄却。候補・記録・通知要求0。
- Explorer：`PlacementSideWithin2=1`、`PlacementAccepted=1`。1compound候補からW02/W07 mouse各1件、通知要求1・2操作。
- 本人はChromeでもカーソル自体を画面左上の端に当てて離したと明示。session17についても全4件のquarter成立・毎回の通常／非配置起点を明示済み。上中央のlayout選択や準備ミスを原因と断定しない。
- 終了code0、read-only integrity_check=ok、hash不変、同梱プロセス残存0。Chromeの未達は残す。

## 未確定の層

旧集計は32px超という区分だけで、実際の距離・物理カーソルとの関係・作業域のinset・途中の角への接触は分からない。直ちにcapを広げたり、Chromeだけ特例にしたりしない。仮説は、イベントと物理カーソルの時点／座標の相違、monitor/work左端の相違、ドラッグ中の接触後に位置が変わったケースである。いずれも現時点では未確定。

[MSLLHOOKSTRUCT.pt](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-msllhookstruct)はper-monitor-aware screen座標、[GetPhysicalCursorPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getphysicalcursorpos)は物理座標を返す。別時点の値が違うことだけでDPI不具合とは断定しない。helper起動時はPerMonitorV2を設定しており、判定側の8px条件はphysical座標の実装上限である。

## 追加診断の境界

通常モードの採否を変更しない。診断ON・active dragだけで、固定4点の非注入motion extremaと最後の1点を一時保持する。全イベントの配列やtimestampは作らない。解放時だけ、event pointと物理cursorの2 snapshot（既存のsub-observer前後）、monitor/work境界との関係を固定カテゴリへ投影する。座標・矩形・HWND・時刻列は通信／ディスクへ出さない。145カテゴリの辞書・各上限1000・世代退役を維持する。

motion extremaは全経路の再現ではない。接触flagがある場合は保持された非注入点との一致を示すが、flagがないだけで実際に接触しなかったとは断定しない。注入motionをextremaへ採用せず、注入有無と最終motionのflagは固定カテゴリだけ記録する。これらを採用・拒否の新しい条件には使わない。

Input.Probeは診断ONのMoveStartだけで作り、既存のForget／Clear／Foreground取消／Resetとともに破棄する。通常--observeではprobeを作らず、motionも収集せず、物理cursorの追加取得もしない。既存MouseReleasedの座標とmonitor/workを置き換えず、従来のedge判定を維持する。

fixtureで、角に触れた後の異なるevent／物理位置、monitor/work inset、注入motion・snapshot失敗を区別し、probe ON/OFFでcompound採否が同じこと、80px解放が両方とも拒否されること、drag終了後に集計が増えないことを確認する。自然入力は同じC07のL/LをChromeとExplorer各1回に絞る。修正前の根拠が揃うまで採用条件を緩和しない。

検証結果：関連unit35件、Native全7件、型検査、helper build、同梱base smoke・保存受入17件が成功。専用ローカルレビューは4観点で指摘なし。Native全473ファイル一致。固定manifestは `../evidence/issue-47/release-probe-build.json`、同梱先は `release/issue-47-release-probe/win-unpacked`。新しい診断を使った自然入力は未実施。NU1900警告は残る。
