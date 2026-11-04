# W03/W04 マウス状態フォールバックの実機確認

## 現在の結果

物理マウスは自動操作から実行できないため、以下はすべて**未実施**。fixtureによるNative→Core→SQLite→通知adapterの成功は、実機精度・Windows通知の表示実績とは扱わない。500msは未調整の初期値。

| アプリ   | 通常→最大化 | 最大化→通常 | 通常→最小化 | 最大化→最小化 | 通常の本文クリック |
| -------- | ----------- | ----------- | ----------- | ------------- | ------------------ |
| Dia      | 未実施      | 未実施      | 未実施      | 未実施        | 未実施             |
| Obsidian | 未実施      | 未実施      | 未実施      | 未実施        | 未実施             |
| Chrome   | 未実施      | 未実施      | 未実施      | 未実施        | 未実施             |

## 本人による検証手順

リポジトリ直下のPowerShellで実行する。試験は未インストールの最新buildと新規の隔離データを使う。既存のShortcut Expertはトレイから終了し、Dia・Obsidian・Chromeを起動しておく。配布・インストールは不要。

```powershell
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
npm.cmd run package:dir
if ($LASTEXITCODE -ne 0) { throw 'Package failed' }
$trialRoot = Join-Path (Get-Location) ('.tools/validation/mouse-state-' + (Get-Date -Format yyyyMMdd-HHmmss))
$trialData = Join-Path $trialRoot 'data'
New-Item -ItemType Directory -Path $trialData -Force | Out-Null
$trialPanel = Join-Path $trialRoot 'FinalInputPanel.exe'
& "$env:SystemRoot/Microsoft.NET/Framework64/v4.0.30319/csc.exe" /nologo /target:winexe /platform:x64 "/out:$trialPanel" /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll validation/issue-47/FinalInputPanel.cs
if ($LASTEXITCODE -ne 0) { throw 'Panel compile failed' }
$trialCases = Join-Path $trialRoot 'cases.json'
node --input-type=module -e 'import {writeFileSync} from "node:fs"; import {finalInputCases} from "./src/main/final-input-cases.ts"; writeFileSync(process.argv[1], JSON.stringify(finalInputCases));' $trialCases
git -c safe.directory=C:/Users/y0u5t/Documents/ChatGPT/shortcut-expert rev-parse HEAD | Set-Content (Join-Path $trialRoot 'revision.txt')
Get-FileHash 'release/win-unpacked/resources/app.asar','release/win-unpacked/resources/native-helper/WindowObserver.exe' | Format-List | Out-File (Join-Path $trialRoot 'build-hashes.txt')
$savedTrialData = $env:COACH_TEST_DATA_DIR
$env:COACH_TEST_DATA_DIR = $trialData
try {
    Start-Process -FilePath (Join-Path (Get-Location) 'release/win-unpacked/Shortcut Expert.exe') -ArgumentList '--final-natural-acceptance','--caption-diagnostics'
} finally { $env:COACH_TEST_DATA_DIR = $savedTrialData }
$trialReadyDeadline = (Get-Date).AddSeconds(30)
while (!(Test-Path (Join-Path $trialData 'status.json'))) {
    if ((Get-Date) -gt $trialReadyDeadline) { throw 'Natural acceptance did not become ready' }
    Start-Sleep -Milliseconds 250
}
Start-Process -FilePath $trialPanel -ArgumentList ('"' + $trialData + '"'),('"' + $trialCases + '"')
```

1. パネルがIDLEになったら、Dia／Obsidianはapplication=`external`、Chromeは`chrome`を選ぶ。stateとsecondaryStateは`learning`、pausedとstoppedはOFF。
2. 試行前に対象窓を通常・未配置または最大化へ準備する。ARM後4秒以内に対象窓を前面にし、**ARMED表示後**に物理マウスで1操作だけ行う。準備操作をARMED中に混ぜない。
3. 最大化は`P03m`、復元は`P04m`、通常から最小化は`S04-min-normal`、最大化から最小化は`S04-min-max`。各アプリで各1回以上行う。各試行の期限は45秒、セッションは20分。再開時は新しい隔離ディレクトリを作る。
4. 実際の窓状態と通知を目視して、result／notificationを該当する値にし、FINISHを押す。キー同等性を試していなければequivalence=`not-tested`を選ぶ。未確認をmatchedにしない。
5. 各アプリで前面の通常窓の本文をクリックする`N01-same`も実施する。状態変化・W03/W04分類・記録・通知がすべて0件であることを確認する。誤検出の評価を広げる場合は、状態が変わらない別の本文位置でも繰り返す。
6. パネルを閉じて観測とアプリを終了する。`$trialData/status.json`の各resultを確認する。`valid=true`、`classified`が期待するW03/W04だけ各1件、`recordsPassed=true`、`notificationRequestPassed=true`を必要とする。目視結果とWindows通知表示は`operatorResult`／`visibleNotification`で別に確認する。

`diagnostics`ではbefore/afterの固定状態カテゴリと`route-mouse-state-fallback`を確認できる。Chrome等で従来の`route-max-button`／`route-min-button`が使われても正常。入力・候補・HWND・process・窓タイトル・座標の生ログを保存しない。結果表にはbuild hash、アプリ別の試行数、状態・Core分類・記録・通知の成否、本文クリック誤検出件数だけを転記する。

クリック直後にアプリ内処理が同一窓の状態を変えた場合を厳密に区別できない点は許容リスク。500ms以内でも解放前に4pxを超えて移動した操作や長押しは棄却する。実機データがない段階で時間閾値を広げない。
