# Snap Layout検証（Issue #5 / B04 / A07）

> **履歴資料／現行の実装・受入条件ではありません。** W08（Snap Layout／Win+Zの呼び出し）は初回公開の8操作から除外されています。ここにある「確定」「未達」「次工程」「OPEN」や試験回数・合格率は**記録当時の判断**です。将来この機能を再検討するときの参考として残し、現在の対象・承認済み条件は[製品要件](../../ui-requirements.md)を優先してください。

2026-10-22。**限定実機試験を実施したが、本体selector・対象照合は未成立、B04未解消。** 準備PR #80の後、ユーザーが「作業できます。実機試験をやりましょう」と再開を指示した。両入口の表示・解除は本人の目視回答で確認したが、probeによる検出成功とは区別する。製品の検出器・集計・通知に変更はない。

## 成果物と現在の判断

- [一次資料メモ](research-snap-layout-sources.md)：hover/Win+Zは公式の入口だが、本体selectorや対象窓対応は別に実証が必要。
- [限定probe](../../../validation/probes/SnapLayoutProbe.cs)と[実行入口](../../../scripts/probes/snap-layout-probe.mjs)：標準captionの隔離WinForms窓、限定Shell UIA、MSAA、owner照合を準備した。
- 現チェックアウトにShellOperationProbeの再ビルド可能なソースはない。[#4の所在確認](research-task-view-validation.md)を参照。出自不明な既存exeを本検証の入口にしない。

実行環境はWindows x64、Node 24.11.1、.NET Framework 4.xのcsc。準備の基準commitは`9326337`。Computer Useのnode runtimeは「指定されたパスが見つかりません (os error 3)」で初期化できなかった。UI操作は自動化していない。

手動操作の可否への回答を待たず開始した初期採取は、90秒で703 worker、endあり0、Shell root0、OS build取得0だった。ローカル出力は`.tools/validation/snap-layout/sampling-1792673624236.jsonl`。ユーザーは画面を見ておらず、表示・操作oracleはない。**provider不在やSnap Layout検出不能の証拠にしない。** この出力は受入artifactに採用しない。直接の失敗原因は未確定。準備版でtarget-ready待ち、サンプル間隔500ms、3連続worker失敗時の停止を追加した。再開後の実行結果は下記の通り。

## 再開後の実機結果

Windows build **26340**、Node 24.11.1、通常のユーザーデスクトップで実行。基準はPR #80のmain `74c5385`。入力hookと人工キー送出は使わず、本人が隔離窓を操作した。

正本は[試行集約](../../../validation/evidence/snap-layout-summary-20261022.json)。ローカルJSONL、source/exeのSHA-256を含む。各時点のsourceはhash一致を検証して`validation/evidence/snap-layout-sources/`へ保存した。EXEはcscの再buildでhashが変わるため、各sessionの実行時hashを残す。

保存ソースは`.gitattributes`の`-text`で改行変換を止める。`tests/research-evidence.test.ts`は隔離Gitリポジトリでautocrlfを有効にし、登録後のblobと記録hashを照合する。作業ファイルだけの照合ではGit内の改行変換を検出できないため、登録後のbytesも確認する。

| 採取ファイル                   | 操作と本人の回答                                           | worker数 / endあり | 採取結果                                                                                   |
| ------------------------------ | ---------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| `sampling-1792676353448.jsonl` | 同一隔離窓でhoverとWin+Z。両方の表示・解除を確認           | 19 / 18            | 延べ325root、うちXaml2。owner一致0。Snap仮説はtaskbar内buttonのみ。1workerは途中出力で終了 |
| `sampling-1792676545035.jsonl` | hoverのみ、約15秒保持→中央へ移動→×。表示・解除と閉窓を確認 | 11 / 11            | 既知Xaml root0                                                                             |
| `sampling-1792676635543.jsonl` | Win+Zのみ、約15秒保持→Esc→×。表示・解除と閉窓を確認        | 13 / 13            | 既知Xaml root0                                                                             |
| `sampling-1792676746463.jsonl` | Win+Zのみ、約15秒保持→Esc→×。表示・解除と閉窓を確認        | 11 / 11            | 既知Xaml root0。最大化button直下3点は計33件すべてfixture自身を返し、Shell host未取得       |

計54sampleは自然入力54回という意味ではない。本人の回答はsession単位のoracleであり、各snapshotの表示中/解除済みラベル、入力・開閉の正確な時刻、両入口と各rootの対応は取れていない。混合sessionの2つのXaml窓も用途未確定で、本体とは判定しない。全Shell探索ではUIA不完全20root、MSAA不完全77rootを含む。完走したworkerでも全providerの完全取得とは扱わない。

既知Xaml classと直下3点の探索では本体を捕捉できなかった。点が実際のpopup領域を覆っていたことも未確認であり、fixtureが返ったことからprovider非対応とは断定しない。未探索のclass/host、別の座標、別providerの可用性は未確定。現行の全Shell経路ではMSAA取得自体は可能だが、本体への到達・UIAとの差分による識別を実証できていない。

同じ試行の追加回数ではselector欠落を解消できないため、操作反復は止めた。次はpopup領域/hostを独立に特定し、取得時の表示oracleと同期して比較する必要がある。tooltip/preview/top tray/Snap Assist/hover中断、別対象との競合、Snap OFF等の負例は未実施であり、誤認0を主張しない。

## 実行手順

実入力を観測しないcompile・自己検査：

```powershell
node scripts/probes/snap-layout-probe.mjs --self-test
node --check scripts/probes/snap-layout-probe.mjs
```

上記は通過。自己検査は固定role分類とcompileの確認であり、UIA/MSAA・窓表示の成功を保証しない。

本人が画面を確認でき、実機試験の再開を指示した時だけ、ユーザーデスクトップのPowerShellから実行する：

```powershell
node scripts/probes/snap-layout-probe.mjs --sample
```

既知Xamlクラスと隔離窓直下3点だけの限定探索は`--sample-xaml`。同modeは範囲を狭める診断用で、全Shellやpopup全域を網羅しない。各sampleのstartMs/endMsはsession開始からの採取区間であり、入力時刻・開閉時刻ではない。

`SAMPLING_READY`と「Snap Layout Research — isolated target」窓の可視表示の両方を確認する。最大90秒。対象窓を閉じれば終了し、時間上限ではこのrunnerが起動した隔離processだけを終了する。通常userData、製品helper、入力hook、人工キー送出は使わない。画面が見えない場合やtarget/workerの失敗時は操作を増やさず、デスクトップ/sessionと失敗stageを調べる。

## 採取範囲と限界

- visibleなtop-level窓のうちexplorer、ShellHost、ShellExperienceHost、StartMenuExperienceHost、ApplicationFrameHostを対象に最大24root。実体未確定のhostは探索外であり、root0を不在と扱わない。
- UIAは専用MTA threadでRawViewを最大256node・深さ8まで読む。PIDが変わる子は除外する。ControlType、IsOffscreen、固定role、親子indexだけを保存。AutomationIdは一時分類し、`Snap`を含んでも仮説に留める。
- MSAAはOBJID_CLIENTのIAccessibleから最大128node・深さ6、数値role/state/childCountのみ。WindowFromAccessibleObjectで同一Shell processを確認できない枝は読まない。provider不足・失敗・打切りを記録し、本体識別へ補完しない。[AccessibleObjectFromWindow](https://learn.microsoft.com/en-us/windows/win32/api/oleacc/nf-oleacc-accessibleobjectfromwindow)、[AccessibleChildren](https://learn.microsoft.com/en-us/windows/win32/api/oleacc/nf-oleacc-accessiblechildren)、[WindowFromAccessibleObject](https://learn.microsoft.com/en-us/windows/win32/api/oleacc/nf-oleacc-windowfromaccessibleobject)。
- 隔離窓とのowner-chain一致とforeground一致はbooleanのみ。HWND/PID・入力列・名前・タイトル・path・画像は採取結果へ保存しない。source/exeのSHA-256を付け、`.tools/validation/snap-layout/`へ保存する。
- workerは最大5秒、全体最大90秒。プロバイダー停止や途中出力を失敗として残す。`enumerationCompleted`は列挙の完走であり、全providerの完走・表示成功を意味しない。
- 限定modeでは隔離窓のphysical boundsを基準に最大化button直下の3点を読む。UIAのPIDを照合し、fixture/非Shell/no-processは固定の除外値だけを出す。既知Shellのみ親を最大8要素まで読む。点は固定仮説であり、popup位置を確認したselectorではない。
- 取得失敗のstageは`target-process`、`target-window`、`os-version`、`point-provider`、`shell-enumeration`の固定値で出力する。例外本文やprocess情報は出さない。spawn前にhashを計算し、起動後はready待ちから後片付けの範囲に含める。
- 全結果は`verdict=unknown`、`selectorVerified=false`、`originMeasured=false`。入力hook・開閉event・自然入力分類は未実装。連続snapshotだけで入力と本体の因果を確定しない。

## 再開時の比較表

最初はprovider成立性を確認する。区別可能な構造が出たら、snapshot番号と本人の目視結果・開始/解除を対応づける方法を追加し、閉→開→閉と対象対応を実証する。現在のsamplerには個別試行ラベルがなく、そのままで受入を完了できない。

| 条件                                | 必要な確認                           | 現在                                                   |
| ----------------------------------- | ------------------------------------ | ------------------------------------------------------ |
| 同じ窓のhover / Win+Z               | 同一本体の出現・解除、対象照合       | 目視の表示・解除のみ確認。provider識別・対象照合未成立 |
| hover中断 / tooltip                 | 本体と誤認しない                     | 未実施                                                 |
| preview / top tray / Snap Assist    | 本体と構造・意味を区別               | 未実施                                                 |
| Snap OFF / 独自caption / 最小サイズ | 表示なし・制約・unknownの区別        | 未実施                                                 |
| 通常複数窓・別対象への切替          | 別対象との誤対応を拒否               | 未実施                                                 |
| UIA / MSAA                          | 表示差分、安定した識別構造と対象関係 | 限定採取を実施。本体の特定・対応は未成立               |

providerが不足すればMSAAの取得成否・役割の識別可能性を実測する。汎用roleだけでSnap本体とは断定しない。selectorと対象照合が成立した後、Spec A00/R02の両自然入力各20回以上・95%以上、負例の誤記録/誤通知0を別に測定する。隔離自作窓だけの成功をJ04の一般環境対応へ拡張しない。

Issue #5と親#49は未完了。#14のB04および後続検出器の成立ゲートも変更しない。
