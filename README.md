# Window Shortcut Coach（仮称）

Windows 11の日常の窓操作に、既存ショートカットを案内するMVP。現在は最大化のみ実装済み。通常窓のマウス最大化でWin＋↑を案内し、日別のmouse/key回数を記録する。実アプリの認識率と公開前条件は未合格。

文書は4つ：本書は使い方、[mvp-requirements.md](docs/mvp-requirements.md)は要件・工程記録、[design.md](docs/design.md)は設計・実装・確認結果、[research.md](docs/research.md)は調査根拠・実測・probe再現。

開発方針は[AGENTS.md](AGENTS.md)と[現行アーキテクチャ](docs/design.md#architecture)を参照。

## 起動

最新の整理版は`release/local-refactor/win-unpacked/Window Shortcut Coach.exe`。旧版をアプリ内またはトレイの「終了」で閉じてから起動する。画面の×はトレイへ閉じる動作で、記録を継続する。通常の保存先は共通なので記録・設定を引き継ぐ。利用側にNode.jsや.NET SDKの別導入は不要。

通常権限のChrome／Obsidian／VS Code／ChatGPTを候補とし、標準最大化ボタン、タイトルバーのダブルクリック、Win＋↑と最大化結果の一致を確認する。管理者アプリ、独自ボタン、キー変更、remote環境、全4アプリの認識精度は保証しない。スナップからの最大化も集計するが、同等キー未確認のためマウス操作には案内しない。

通知は操作した画面の右下に4秒、全体10秒／同一操作60秒以上の間隔、同時1件。全画面・判別不能では通知を抑制する。通知停止中も記録し、全停止では観測・記録・通知を止める。停止状態は再起動で解除し、操作別通知設定は保持する。自動起動登録なし。

数値画面で日付選択、操作別mouse/key、通知ON/OFF、記録全削除を操作する。全削除は設定を残す。時計が既存記録より前の日付になると、記録を保持して計測を止める。日時を戻すか、記録全削除後に再開する。

保存は日別集計と設定だけ。文字・キー生ログ・URL・窓タイトル・clipboard・画像を通常実行で保存せず、外部送信・アカウントなし。開発時は`.tools/coach-data`、同梱版は`%APPDATA%\Window Shortcut Coach`へ保存。設定を含む完全削除はアプリ終了後に同梱版の保存フォルダーを削除する。

## 開発・確認

Windows x64、Node.js 24系・npm。作業フォルダーのPowerShellで実行する。

```powershell
pwsh -File .\scripts\setup-dotnet.ps1
npm.cmd ci
npm.cmd run build
npm.cmd run dev
```

.NET SDKはglobal.jsonの版を`.tools/dotnet`へ導入する。システムPATHへ追加しない。初回SDK／NuGet／npm取得にはネットワークが必要。helperはWinForms／Win32、self-containedでpublishする。ビルドは成功したpublishで同梱フォルダーを置換し、不要になった依存DLLを残さない。

```powershell
npm.cmd test
npm.cmd run smoke
npm.cmd run smoke:dev
npm.cmd run package:dir
npm.cmd run smoke:packaged
node .\scripts\smoke.mjs --packaged --real-display --package-dir release/local-refactor
```

`test`はhelperをビルドし、判定・集計・保存形式・通知条件・直列実行・helperの開始終了を確認する。`smoke`は隔離データの人工mouse1／key1を使い、helper→判定→保存→React→通知→解除・終了を確認する。fixture中のhookは実入力payloadを読まない。数値1／1はテスト値で、実入力認識率の証拠ではない。画像保存はこの試験で自分の画面だけに行う。`--real-display`は全画面抑制を実際のWindows画面状態で確認し、全画面があれば表示試験は不成功となる。

`package:dir`は`release/win-unpacked`へ実行フォルダーを作る。旧版が起動中の場合は終了するか、別の出力先を指定する。

```powershell
npm.cmd run package:dir -- --config.directories.output=release/local-refactor
```

原本probeは`validation/probes`のソースから再ビルドする。[再現手順](docs/research.md#probes)。旧probeの生成exe・同内容のlatestログコピー・調査用ダウンロードコピー・固定のfixture画像は整理済み。時刻付き原本ログ・初回原本・API結果は保持する。

## 公開準備

`npm.cmd run package:installer`はbuild後にNSISインストーラーを作る入口。導入・再導入・削除、通常利用60分、採用操作ごとの精度確認は未完。正式名称・appId・OSSライセンス・公開先・署名を決める必要があり、UNLICENSEDは未選定を表す。

インストーラーをPowerShellで取得・実行する導入を優先し、npx用CLIは追加工数次第で判断する。現時点で公開された導入コマンドはない。

