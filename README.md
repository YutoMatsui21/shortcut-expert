# Window Shortcut Coach（仮称）

Windows 11の日常の窓操作に、既存ショートカットを案内するMVP。別画面へ移動・最大化・最小化・最大化から復元・閉じるを条件付きで検出し、日別のmouse/key回数を記録する。全11候補の横に参考ショートカットを表示する。実アプリの認識率と公開前条件は未合格。

Navy Shellの「ショートカット一覧」「記録」へ切り替える構成。一覧は正式12操作を全て「準備中」と表示し、実際に取得した直近7日のキー率を示す。各行で学習中・習得済み・対象外を変更して保存できる。全状態で記録を続け、習得済み・対象外は通知を止める。記録画面は直近7暦日のKPI・率バー・正式12操作を表示する。期間/対象選択は#20、比較は#21、Windows標準Toastへの統合は#26で行う。[記録の契約・検証範囲](docs/records-ui.md)。[一覧・assets・検証範囲](docs/learning-ui.md)。

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

記録画面で直近7日のキー率とキー/マウス回数を確認する。通知・計測の停止/再開、記録全削除は共通の歯車から操作する。全削除は設定を残す。時計が既存記録より前の日付になると、記録を保持して計測を止める。日時を戻すか、記録全削除後に再開する。

保存は日別集計と設定だけ。文字・キー生ログ・URL・窓タイトル・clipboard・画像を通常実行で保存せず、外部送信・アカウントなし。開発時は`.tools/coach-data`、同梱版は`%APPDATA%\window-shortcut-coach`へ保存（実行時identityと既存配布物で確認）。設定を含む完全削除はアプリ終了後に同梱版の保存フォルダーを削除する。

`records-v1/`のSQLiteへ日別記録を無期限に保存する。画面・IPCの読込は最大60日へ制限し、古い日は有界queryで読み出せる。記録画面は現在の7日間を表示する。観測の根拠がない項目は「—」。既存JSONは原本を保持し、全日分・設定を別stagingへ移して再読込・全行照合後に有効化する。移行前に削除済みの記録は復元できない。DB欠落・破損・未来版は空記録へ戻さず停止する。[保存経路](docs/durable-storage.md)・[移行と検証範囲](docs/json-migration.md)。

## 開発・確認

<a id="development-workflow"></a>

### 開発の進め方

1. 実装前に`git status --short --branch`、`git worktree list`、`git log -1 --oneline`を確認する。対象Issueの依存・受入条件と基準コミットを照合し、作業先を1つに決める。detached HEADの場合は実装前に`codex/`ブランチへ所属させる。別コピーへの移し替え、他のworktreeの依存フォルダーや生成物の流用は通常の準備手順にしない。commit・pushの範囲はユーザーの依頼に従う。
2. 長いIssue本文は成功した取得1回を`.tools/issue-<番号>.txt`などへ保存し、見出しを`rg -n '^#'`で探して該当節だけ読む。再取得は仕様更新の確認が必要な時に行う。取得失敗なら内容を仕様として使わず、終了コード・保存ファイルの内容を確認する。PowerShellではnativeコマンド失敗後も後続処理が続くため、依存するコマンドの間で`if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`を使う。
3. 必要なツールと版は`package.json`・`global.json`で照合し、不足分だけ下記手順で準備する。権限・ネットワークによる失敗は承認された再実行か環境修正で解決する。修正前に同じコマンドを繰り返さず、承認拒否時は理由と未完了箇所を報告する。試験のTEMPに書込権限の問題がある場合は、この作業先の`.tools/test-temp`を作成し、そのコマンドの`TEMP`/`TMP`だけそこへ向ける。
4. 修正中は下記のファイル・名前指定で関連試験を実行し、変更がまとまったら変更層のsuite・build・smokeを確認する。成功済み検証は変更内容・基準コミット・実行コマンドと対応づけ、ソース・依存・生成物・環境が変わった範囲を再検証する。調査の任意追加確認とIssueの必須条件を分け、次Issueの案内前にも依存条件を確認する。
5. pushとCI・レビュー確認まで依頼された場合は、push後のhead SHAを固定して状態と未解決指摘を確認する。同じheadの実行中状態は30秒以上空け、変化がなければ60秒へ延ばす。正常待機中は状態の要約、失敗時に該当jobのログ、レビュー時に対象指摘を読む。新しいpush後はSHAを取り直し、古いheadの成功を完了根拠にしない。

### 実行環境

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
node scripts/smoke.mjs --storage
node scripts/smoke.mjs --packaged --storage
node scripts/smoke.mjs --migration
node scripts/smoke.mjs --packaged --migration
node .\scripts\smoke.mjs --packaged --real-display --package-dir release/operation-detection
```

`test:unit`はhelperのpublishを待たず、判定・日付・集計・保存失敗・通知・通信を隔離fixtureで確認する。`test:native`はhelperを再buildし、本番C#候補生成/全画面policyの人工事象試験、C#→TS契約、hook開始終了を確認する。`test`は両方を順に実行する。Node 24のexperimental module mockはElectron/子プロセス/FS境界にのみ使う。`test:coverage`は速いsuiteのimport済みNode対象だけを計測し、未import・Renderer・C#を含む全体率ではない。

protocol v2の回帰は`test:unit`のvariant必須証拠・未知能力・再配送/差替え/世代/版混在と、`test:native`のC#→v1/v2 JSON→Main parse→Coreを確認する。新helperとMainはv2を選択し、旧helper/Mainのv1経路も残す。同じ観測世代では混在させない。既存5操作の確証条件を維持し、未実証のShell・activation・globalは採用しない。型付き証拠の接続成功を自然入力精度や新操作対応の証明としない。契約の詳細は[設計](docs/design.md#test-design)を参照。

`smoke`は隔離データの人工mouse1／key1からhelper→判定→保存→React→通知へ接続し、実UIの通知停止/全停止/再開/学習状態と7日集計、削除取消/確定、設定再読込、不正IPC拒否、解除・終了も確認する。削除確認のOS dialogだけ試験側の返答へ置換する。fixture中のhookは実入力payloadを読まない。数値はテスト値で、実入力認識率の証拠ではない。画像保存はこの試験で自分の画面だけに行う。`--real-display`は全画面抑制を実際のWindows画面状態で確認し、全画面があれば表示試験は不成功となる。

テスト追加の選び方は[Skill](skills/test-shortcut-coach/SKILL.md)、層と証拠の範囲は[テスト設計](docs/design.md#test-design)。CI定義は[quality.yml](.github/workflows/quality.yml)。Windows runnerで同じ入口を実行し、fixtureログと自アプリ画像だけ3日保存する。実入力・Windows 11通常権限の精度・NSIS導入/再導入/削除・通常60分は別の受入試験。

窓管理・IPC・画面状態処理の整理に対する回帰試験では、unitで窓の重複生成防止・不正IPC拒否・Preload購読解除を確認する。smokeは×で非表示、人工second-instanceイベントから同じ窓の再表示と最小化復元、画面再読込後の状態取得と操作も確認する。実際の二重起動やトレイのOSイベント配送はこの人工イベント試験の対象外。

操作追加版のsmokeは正式12行のキーと準備中表示、追加4操作それぞれのmouse/key→helper通信→判定→保存→Reactも確認する。追加4操作の通知画面はfixture通知で別途表示確認し、Coreの通知判断はunit試験で確認する。製品の通知間隔は変更しない。

`package:dir`は直前にbuildした内容から`release/win-unpacked`へ実行フォルダーを作る。旧版が起動中の場合は別の出力先を指定し、同じ出力先のexeを検証する。

```powershell
npm.cmd run build
npm.cmd run package:dir -- --config.directories.output=release/quality-tests
node .\scripts\smoke.mjs --packaged --package-dir release/quality-tests
```

原本probeは`validation/probes`のソースから再ビルドする。[再現手順](docs/research.md#probes)。旧probeの生成exe・同内容のlatestログコピー・調査用ダウンロードコピー・固定のfixture画像は整理済み。時刻付き原本ログ・初回原本・API結果は保持する。

SQLite方式の検証（[#10の結果・採用方式・限界](docs/sqlite-storage-validation.md)）は以下で再実行する。製品ビルドや.NET SDKを使わず、同じ固定版Electron/ASAR/Windows x64の独立した無署名probe配布物を作る。hook・実入力・通常の保存先は使わず、毎回`.tools/validation/sqlite-*`へfixtureと結果JSONを出力する。故障試験では自分で起動したprobeを強制終了し、fixture DBだけにread-only属性・NTFS書込拒否ACLを設定してfinallyで解除する。配布物内ソースが現在のprobeと異なれば実行前に再packageを要求する。

実行したElectronの版も`package.json`の固定版と照合する。SQLite保存・移行の回帰7件は通常の`test:unit`に含まれ、配布probeでは初期schema作成中の強制終了、JSON未作成、FULL後の同一書込の再送も確認する。

```powershell
npm.cmd run probe:sqlite
npm.cmd run probe:sqlite:package
npm.cmd run probe:sqlite:packaged
```

### 修正中のテスト絞り込み

`test:unit`の追加引数で`tests/`直下のファイル名を指定する。`--file=`は複数指定できる。module mockの有効化とsuiteごとのtimeoutは通常実行と同じ。未指定なら従来どおりsuite全体を実行する。

```powershell
npm.cmd run test:unit -- --file=coach-ipc.test.ts
npm.cmd run test:unit -- --file=protocol-v2.test.ts --test-name-pattern=v2
```

`--test-reporter=spec|tap|dot`も指定できる。名前指定は一致しないケースを実行しないため、実行された件数と対象名を確認する。dotは詳細を省くので、失敗調査にはspecかtapを使う。絞り込み成功をsuite全体の合格として扱わない。

nativeだけを絞る場合はhelperをbuildした後、`node scripts/test.mjs native --file=native-policy.test.ts`を使う。`test:native`経由では従来どおり毎回helperをbuildする。全体ログが必要な時は`.tools/test-results`へ保存し、結果の要約と失敗箇所を読む。

## 公開準備

`npm.cmd run package:installer`はbuild後にNSISインストーラーを作る入口。導入・再導入・削除、通常利用60分、採用操作ごとの精度確認は未完。正式名称・appId・OSSライセンス・公開先・署名を決める必要があり、UNLICENSEDは未選定を表す。

インストーラーをPowerShellで取得・実行する導入を優先し、npx用CLIは追加工数次第で判断する。現時点で公開された導入コマンドはない。

