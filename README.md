# Window Shortcut Coach（仮称）

Windows 11の日常の窓操作に、既存ショートカットを案内するMVP。別画面へ移動・最大化・最小化・最大化から復元・閉じるを条件付きで検出し、日別のmouse/key回数を記録する。全11候補の横に参考ショートカットを表示する。実アプリの認識率と公開前条件は未合格。

**今後の製品要件の正本**：[UI刷新の確定要件](docs/ui-redesign-requirements.md)。本書は現行ビルドの使い方とロードマップ、[mvp-requirements.md](docs/mvp-requirements.md)は旧MVPの要件・工程記録、[design.md](docs/design.md)は設計・実装状況、[research.md](docs/research.md)は調査・実測原本。

## 開発ロードマップ（2026-10-18決定）

- 初回リリース対象は**12操作**。W09（Win+D）とW14（Win+M）は将来保留。
- **先にUI・データ保存・通知・設定を実装**し、全12操作を「準備中」として表示する。人工イベントを隔離データに流して結合・回帰試験を行い、通常の利用実績と混ぜない。
- 検出器は最後に実装する。先行7操作は **W03最大化、W05最大化解除、W04最小化、W06左右半分、W07四隅、W02別画面移動、W11閉じる**。残る5操作はW12／W01／W10／W08／W13。
- 条件付き実装済みの5操作は、まだ自然入力95%以上を確認していない。UI完成・人工テスト合格と検出器の受入は別。**12操作の両自然入力が受入基準を満たすまでリリースしない。**

現行の実行・検出説明は既存ビルドの仕様。今後の要件は[UI刷新の確定要件](docs/ui-redesign-requirements.md)、工程は[親Issue：基盤](https://github.com/YutoMatsui21/shortcut-expert/issues/50)・[UI](https://github.com/YutoMatsui21/shortcut-expert/issues/51)・[検出器](https://github.com/YutoMatsui21/shortcut-expert/issues/52)を参照。
品質保証の調査（2026-10-12）：[テスト設計・CI等のベストプラクティス](docs/quality-best-practices.md)、[現行リポジトリの不足・優先度・検証結果](docs/quality-gap-analysis.md)。改善案であり、製品の要件や公開基準は変更していない。

開発方針は[AGENTS.md](AGENTS.md)と[現行アーキテクチャ](docs/design.md#architecture)を参照。

## 起動

最新の操作追加版は`release/operation-detection/win-unpacked/Window Shortcut Coach.exe`。旧版をアプリ内またはトレイの「終了」で閉じてから起動する。画面の×はトレイへ閉じる動作で、記録を継続する。通常の保存先は共通なので記録・設定を引き継ぐ。利用側にNode.jsや.NET SDKの別導入は不要。

通常権限のChrome／Obsidian／VS Code／ChatGPTを候補とし、標準最大化ボタン、タイトルバーのダブルクリック、Win＋↑と最大化結果の一致を確認する。管理者アプリ、独自ボタン、キー変更、remote環境、全4アプリの認識精度は保証しない。スナップからの最大化も集計するが、同等キー未確認のためマウス操作には案内しない。

追加操作も入力と同一窓の結果が一致した場合に記録する。標準最小化ボタン／通常・非スナップ窓のWin＋↓、最大化からの標準復元ボタン・タイトルバーダブルクリック／Win＋↓、前面窓の標準×／Alt＋F4を対象にする。最大化・スナップからマウスで最小化した場合は記録だけ行う。閉じるは窓の破棄を確認し、トレイ格納やタブ閉鎖を数えない。

画面移動はタイトルバーのドラッグ終端、またはWin＋Shift＋左右と移動結果を照合する。長いドラッグも扱い、途中変化・元画面への往復・派生復元は別計上しない。マウスへの方向付きキー案内は左右に並ぶ2画面で方向を確定できる場合だけ。移動中の画面構成変更は見送る。切替・左右／四隅スナップ・スナップレイアウト・デスクトップ表示・タスクビューはキー一覧のみで、検出は準備中。

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
npm.cmd run test:unit
npm.cmd test
npm.cmd run test:coverage
npm.cmd run smoke
npm.cmd run smoke:dev
npm.cmd run package:dir
npm.cmd run smoke:packaged
node .\scripts\smoke.mjs --packaged --real-display --package-dir release/operation-detection
```

`test:unit`はhelperのpublishを待たず、判定・日付・集計・保存失敗・通知・通信を隔離fixtureで確認する。`test:native`はhelperを再buildし、本番C#候補生成/全画面policyの人工事象試験、C#→TS契約、hook開始終了を確認する。`test`は両方を順に実行する。Node 24のexperimental module mockはElectron/子プロセス/FS境界にのみ使う。`test:coverage`は速いsuiteのimport済みNode対象だけを計測し、未import・Renderer・C#を含む全体率ではない。

`smoke`は隔離データの人工mouse1／key1からhelper→判定→保存→React→通知へ接続し、実UIの通知停止/全停止/再開/mute/過去日選択、削除取消/確定、設定再読込、不正IPC拒否、解除・終了も確認する。削除確認のOS dialogだけ試験側の返答へ置換する。fixture中のhookは実入力payloadを読まない。数値はテスト値で、実入力認識率の証拠ではない。画像保存はこの試験で自分の画面だけに行う。`--real-display`は全画面抑制を実際のWindows画面状態で確認し、全画面があれば表示試験は不成功となる。

テスト追加の選び方は[Skill](skills/test-shortcut-coach/SKILL.md)、層と証拠の範囲は[テスト設計](docs/design.md#test-design)。CI定義は[quality.yml](.github/workflows/quality.yml)。Windows runnerで同じ入口を実行し、fixtureログと自アプリ画像だけ3日保存する。実入力・Windows 11通常権限の精度・NSIS導入/再導入/削除・通常60分は別の受入試験。

窓管理・IPC・画面状態処理の整理に対する回帰試験では、unitで窓の重複生成防止・不正IPC拒否・Preload購読解除を確認する。smokeは×で非表示、人工second-instanceイベントから同じ窓の再表示と最小化復元、画面再読込後の状態取得と操作も確認する。実際の二重起動やトレイのOSイベント配送はこの人工イベント試験の対象外。

操作追加版のsmokeは全11行のキーと準備中表示、追加4操作それぞれのmouse/key→helper通信→判定→保存→Reactも確認する。追加4操作の通知画面はfixture通知で別途表示確認し、Coreの通知判断はunit試験で確認する。製品の通知間隔は変更しない。

`package:dir`は直前にbuildした内容から`release/win-unpacked`へ実行フォルダーを作る。旧版が起動中の場合は別の出力先を指定し、同じ出力先のexeを検証する。

```powershell
npm.cmd run build
npm.cmd run package:dir -- --config.directories.output=release/quality-tests
node .\scripts\smoke.mjs --packaged --package-dir release/quality-tests
```

原本probeは`validation/probes`のソースから再ビルドする。[再現手順](docs/research.md#probes)。旧probeの生成exe・同内容のlatestログコピー・調査用ダウンロードコピー・固定のfixture画像は整理済み。時刻付き原本ログ・初回原本・API結果は保持する。

## 公開準備

`npm.cmd run package:installer`はbuild後にNSISインストーラーを作る入口。導入・再導入・削除、通常利用60分、採用操作ごとの精度確認は未完。正式名称・appId・OSSライセンス・公開先・署名を決める必要があり、UNLICENSEDは未選定を表す。

インストーラーをPowerShellで取得・実行する導入を優先し、npx用CLIは追加工数次第で判断する。現時点で公開された導入コマンドはない。

