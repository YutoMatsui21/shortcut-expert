# 開発・検証ガイド

Shortcut Expertを**開発・実行・検証するための手順**。製品の振る舞いは[製品要件](ui-requirements.md)、責務分担は[設計](design.md)、ツールの詳細な取得・監視方法は[開発ツール](development-tools.md)を参照。過去の成功件数・Issueごとの進捗はここへ追加せず、PR・検証記録へ残す。

## 1. 開発環境と起動

対象はWindows x64。Node.js／npmは[package.json](../package.json)、.NET SDKは[global.json](../global.json)の指定に従う。PowerShellでリポジトリのルートから実行する。

```powershell
pwsh -File .\scripts\setup-dotnet.ps1
npm.cmd run dev:install
npm.cmd run dev:check -- --require=electron,sdk
npm.cmd run build
npm.cmd run dev
```

- `dev:check`はTEMP/cacheの書込と部品の**存在**を確認する。ソースの新しさや実行成功は保証しない。
- `build`はC# helperのpublish、型検査、Electron bundleを作成する。SDKは`.tools/dotnet`へ導入し、通常はシステムPATHを変更しない。
- 画面の×はウィンドウを隠し、トレイでの動作を継続する。**完全終了**はトレイの「終了」を使用する。未インストール時と配布版で保存先が異なるので、テストには隔離データを使う。

<a id="development-workflow"></a>

## 2. 普段の開発フロー

1. `git status --short --branch`、`git worktree list`で作業先を確認し、Issueの受入条件と影響範囲を読む。
2. [テスト設計Skill](../.agents/skills/test-shortcut-coach/SKILL.md)で変更に合う先行テスト・必要な検証を決める。動作変更・バグ修正は原則テストファースト。
3. 実装後、関連unit/native → 影響層の結合・smoke → 必要な同梱版確認の順に実行する。PR前に`npm.cmd run lint`を実行して新たなerrorを修正し、warnは内容を確認して必要な場合に対応する。警告を消すだけの変更は行わない。Nodeのトップレベル`test()`登録に対する既知の警告は、未awaitのサブテストを見逃さないため維持する。**隔離fixtureのPASSを実入力精度の証拠にしない。**
4. PR前に[コードレビュー規則](code-review.md)と[GitHub操作Skill](../.agents/skills/github-workflow/SKILL.md)に従いローカルレビューを行う（文書のみ等の例外を除く）。
5. PRで最新headの必須CI `windows-quality`を確認してからmerge。失敗後は修正範囲を再検証し、重要なロジック変更は必要な再レビューを行う。GitHub上の`@codex review`は依頼しない。

変更対象がMarkdownだけならCIは軽量確認へ切り替わる。実装・設定・CI変更はWindowsフルCI。判定は[quality.yml](../.github/workflows/quality.yml)が正本。

## 3. 主なコマンド

| 目的                   | コマンド                         |
| ---------------------- | -------------------------------- |
| 環境確認               | `npm.cmd run dev:check`          |
| 開発起動               | `npm.cmd run dev`                |
| 型検査                 | `npm.cmd run typecheck`          |
| 速いunitテスト         | `npm.cmd run test:unit`          |
| Nativeを含む全テスト   | `npm.cmd test`                   |
| C# helperの再生成      | `npm.cmd run helper:build`       |
| 隔離Electron試験       | `npm.cmd run smoke`              |
| 配布フォルダー作成     | `npm.cmd run package:dir`        |
| 配布フォルダーの試験   | `npm.cmd run smoke:packaged`     |
| 保存の受入試験         | `npm.cmd run acceptance:storage` |
| NSISインストーラー作成 | `npm.cmd run package:installer`  |

正確なコマンドと組み合わせ順は[package.json](../package.json)の`scripts`を正本とする。配布版smokeは**その回でbuildしたexeとhelper**を対象に実行する。`package:installer`は配布を自動で承認・公開するものではない。

<a id="修正中のテスト絞り込み"></a>

### 修正中のテスト絞り込み

関連するテストだけ先に実行し、変更がまとまってから影響する層へ広げる。

```powershell
npm.cmd run test:unit -- --file=app/ipc/ipc-command-handlers.test.ts
npm.cmd run test:unit -- --file=app/ipc/native-message-protocol.test.ts --test-name-pattern=v2
npm.cmd run helper:build
node scripts/test/test.mjs native --file=native/native-operation-policy.test.ts
```

`--file=`は`tests/`からの相対パス、またはsuite内で一意のファイル名を指定する。同名が複数ある場合は相対パスを使う。探索は再帰的に行い、`native/`配下がnative、それ以外がunitとなる（`support/`・`fixtures/`・生成物の`bin/`・`obj/`は探索対象外）。`--test-reporter=spec|tap|dot`と`--test-concurrency=1|2|4|8`も利用できる。**絞り込みの成功を全件合格とは扱わない。** `test:coverage`はimport済みNode対象だけで、RendererやC#を含む全体coverageではない。

テストは`operations/`（操作の検出・分類）、`records/`（集計・学習状態）、`storage/`（保存・移行・復旧）、`app/{lifecycle,window,ipc,notifications}/`（アプリ境界）、`native/`（helper連携、C# policyは`policy/`）、`integration/`（結合・受入基盤）、`tooling/`（開発補助）へ配置する。共通補助は`support/`、fixtureは`fixtures/`を使う。ファイル名はkebab-caseで検証対象と振る舞いを表す。

## 4. 検証の種類と限界

| 検証               | 何を確かめるか                                                           |
| ------------------ | ------------------------------------------------------------------------ |
| unit / native      | 判定・保存・IPC・C# policy・プロトコルの回帰。実入力は観測しない         |
| `smoke`            | 隔離候補を通したMain → Preload → React・SQLite・通知adapterの結合        |
| `smoke:packaged`   | 配布用のexe・helper・preloadが同梱され動作すること                       |
| 自然入力の実機受入 | 代表アプリで実際のマウス／キー入力と検出結果・案内を照合                 |
| NSIS受入           | インストール／再インストール／通知クリック／アンインストール・データ保護 |

自然入力の観測は**本人の明示的な同意後**に、対象build・操作手順・隔離保存先を確定して実施する。自作fixtureと通常の記録を混ぜず、実測結果には未確認条件も記す。技術調査の判断根拠は[research/](research/)、操作ごとの実装上の制約は[operations/](operations/)、実機・配布の受入条件は[製品要件](ui-requirements.md#release-acceptance)と対応するGitHub Issueを正本とする。検証コードと証拠原本はリポジトリ直下の`tests/`・`scripts/`・`validation/`を参照する。

## 5. 公開前に確認すること

[製品要件のリリース条件](ui-requirements.md#release-acceptance)に従い、初回対象8操作の自然入力、代表的なWindows 11環境、通知・トレイ・画面サイズ、NSIS導入／再導入／削除、データ保護を確認する。**CI成功だけでリリース可能とは判定しない。**

正式名称・アプリ識別子・OSSライセンス・署名・公開手順は[README](../README.md)の公開準備も確認する。公開・配布は別途承認が必要。
