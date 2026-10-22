# Snap Layout検証の準備（Issue #5 / B04 / A07）

2026-10-22。**準備のみ。受入未実施、B04未解消。** ユーザーは実機観測に一度同意したが、その後「今画面見れないから準備だけ」と指定した。以後の実機採取は行っていない。製品の検出器・集計・通知に変更はない。

## 成果物と現在の判断

- [一次資料メモ](research-snap-layout-sources.md)：hover/Win+Zは公式の入口だが、本体selectorや対象窓対応は別に実証が必要。
- [限定probe](../validation/probes/SnapLayoutProbe.cs)と[実行入口](../scripts/snap-layout-probe.mjs)：標準captionの隔離WinForms窓、限定Shell UIA、MSAA、owner照合を準備した。
- 現チェックアウトにShellOperationProbeの再ビルド可能なソースはない。[#4の所在確認](research-task-view-validation.md)を参照。出自不明な既存exeを本検証の入口にしない。

実行環境はWindows x64、Node 24.11.1、.NET Framework 4.xのcsc。準備の基準commitは`9326337`。Computer Useのnode runtimeは「指定されたパスが見つかりません (os error 3)」で初期化できなかった。UI操作は自動化していない。

手動操作の可否への回答を待たず開始した初期採取は、90秒で703 worker、endあり0、Shell root0、OS build取得0だった。ローカル出力は`.tools/validation/snap-layout/sampling-1792673624236.jsonl`。ユーザーは画面を見ておらず、表示・操作oracleはない。**provider不在やSnap Layout検出不能の証拠にしない。** この出力は受入artifactに採用しない。直接の失敗原因は未確定。準備版ではtarget-ready待ち、サンプル間隔500ms、3連続worker失敗時の停止を追加したが、この修正後のlive経路は未実行。

## 実行手順

実入力を観測しないcompile・自己検査：

```powershell
node scripts/snap-layout-probe.mjs --self-test
node --check scripts/snap-layout-probe.mjs
```

上記は通過。自己検査は固定role分類とcompileの確認であり、UIA/MSAA・窓表示の成功を保証しない。

本人が画面を確認でき、実機試験の再開を指示した時だけ、ユーザーデスクトップのPowerShellから実行する：

```powershell
node scripts/snap-layout-probe.mjs --sample
```

`SAMPLING_READY`と「Snap Layout Research — isolated target」窓の可視表示の両方を確認する。最大90秒。対象窓を閉じれば終了し、時間上限ではこのrunnerが起動した隔離processだけを終了する。通常userData、製品helper、入力hook、人工キー送出は使わない。画面が見えない場合やtarget/workerの失敗時は操作を増やさず、デスクトップ/sessionと失敗stageを調べる。

## 採取範囲と限界

- visibleなtop-level窓のうちexplorer、ShellHost、ShellExperienceHost、StartMenuExperienceHost、ApplicationFrameHostを対象に最大24root。実体未確定のhostは探索外であり、root0を不在と扱わない。
- UIAは専用MTA threadでRawViewを最大256node・深さ8まで読む。PIDが変わる子は除外する。ControlType、IsOffscreen、固定role、親子indexだけを保存。AutomationIdは一時分類し、`Snap`を含んでも仮説に留める。
- MSAAはOBJID_CLIENTのIAccessibleから最大128node・深さ6、数値role/state/childCountのみ。WindowFromAccessibleObjectで同一Shell processを確認できない枝は読まない。provider不足・失敗・打切りを記録し、本体識別へ補完しない。[AccessibleObjectFromWindow](https://learn.microsoft.com/en-us/windows/win32/api/oleacc/nf-oleacc-accessibleobjectfromwindow)、[AccessibleChildren](https://learn.microsoft.com/en-us/windows/win32/api/oleacc/nf-oleacc-accessiblechildren)、[WindowFromAccessibleObject](https://learn.microsoft.com/en-us/windows/win32/api/oleacc/nf-oleacc-windowfromaccessibleobject)。
- 隔離窓とのowner-chain一致とforeground一致はbooleanのみ。HWND/PID・入力列・名前・タイトル・path・画像は採取結果へ保存しない。source/exeのSHA-256を付け、`.tools/validation/snap-layout/`へ保存する。
- workerは最大5秒、全体最大90秒。プロバイダー停止や途中出力を失敗として残す。`enumerationCompleted`は列挙の完走であり、全providerの完走・表示成功を意味しない。
- 全結果は`verdict=unknown`、`selectorVerified=false`、`originMeasured=false`。入力hook・開閉event・自然入力分類は未実装。連続snapshotだけで入力と本体の因果を確定しない。

## 再開時の比較表

最初はprovider成立性を確認する。区別可能な構造が出たら、snapshot番号と本人の目視結果・開始/解除を対応づける方法を追加し、閉→開→閉と対象対応を実証する。現在のsamplerには個別試行ラベルがなく、そのままで受入を完了できない。

| 条件 | 必要な確認 | 現在 |
| --- | --- | --- |
| 同じ窓のhover / Win+Z | 同一本体の出現・解除、対象照合 | 未実施 |
| hover中断 / tooltip | 本体と誤認しない | 未実施 |
| preview / top tray / Snap Assist | 本体と構造・意味を区別 | 未実施 |
| Snap OFF / 独自caption / 最小サイズ | 表示なし・制約・unknownの区別 | 未実施 |
| 通常複数窓・別対象への切替 | 別対象との誤対応を拒否 | 未実施 |
| UIA / MSAA | 表示差分、安定した識別構造と対象関係 | 準備のみ |

providerが不足すればMSAAの取得成否・役割の識別可能性を実測する。汎用roleだけでSnap本体とは断定しない。selectorと対象照合が成立した後、Spec A00/R02の両自然入力各20回以上・95%以上、負例の誤記録/誤通知0を別に測定する。隔離自作窓だけの成功をJ04の一般環境対応へ拡張しない。

Issue #5と親#49は未完了。#14のB04および後続検出器の成立ゲートも変更しない。
