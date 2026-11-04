# 開発ツールの使い方

開発ガイドに載せきらない**取得・調査・PR監視・実行環境の補助ツール**だけを扱う。標準のビルド・テスト手順は[開発ガイド](development.md)、ツールの実装と引数は`scripts/`・[package.json](../package.json)、GitHub操作の規則は[GitHub操作Skill](../.agents/skills/github-workflow/SKILL.md)を正本とする。

## 1. 実行環境を確認する

```powershell
npm.cmd run dev:check
npm.cmd run dev:check -- --require=electron,sdk,helper
```

`scripts/dev/dev-run.mjs`はツール実行時のTEMPとnpm/Electron cacheを作業先へ向ける。`dev:check`は書込可能性と部品の有無を検査し、SDKの解決バージョンも表示するが、ソースの再buildや動作検証はしない。不足があれば`npm.cmd run dev:install`、Electron本体のみ不足なら`npm.cmd run dev:electron`を使う（ネットワーク取得あり）。SDK版は[global.json](../global.json)、Node/Electron版は[package.json](../package.json)を参照。

権限・接続エラーは**最初の失敗原因**を確認する。同じ失敗を設定変更なしで繰り返さず、別worktreeの生成物を無条件に流用しない。

<a id="仕様の取得と読取"></a>

## 2. Issueとソースを必要な範囲だけ読む

`scripts/dev/github-workflow.mjs`は`gh`を利用してIssue本文を取得し、revision/hash付きで`.tools/issues/`にcacheする。変更が必要なら`--refresh`で再取得する。

```powershell
node scripts/dev/github-workflow.mjs issue 14 --repo=YutoMatsui21/shortcut-expert
node scripts/dev/github-workflow.mjs issue 14 --repo=YutoMatsui21/shortcut-expert --section="見出し一覧の正確な見出し"
```

- `gh auth status`で**現在の実行環境**の認証を確認。CLIが利用できないときだけ接続済みGitHubツールを使う。
- `rg`で関連する型・関数・呼出し元を特定し、必要な節と差分を読む。調査済みの全文を毎回読み直さない。
- 読込失敗やcache破損を最新仕様と見なさず、取得元・revisionを確認する。

<a id="pr監視"></a>

## 3. PRとCIを確認する

PR前レビュー・merge条件は[GitHub操作Skill](../.agents/skills/github-workflow/SKILL.md)。**PR後は最新headの必須CI `windows-quality` を確認**し、GitHub Codexレビューの結果をmerge条件にしない。

```powershell
gh pr checks <PR番号> --watch --interval 30
```

詳細なチェックや未解決threadが必要なら`scripts/dev/github-workflow.mjs pr-status`でheadを指定して要約を取得できる。

```powershell
$prHead = git rev-parse HEAD
node scripts/dev/github-workflow.mjs pr-status <PR番号> --repo=YutoMatsui21/shortcut-expert --head=$prHead
```

- `head`不一致、チェック未開始・skip・取得失敗を成功と扱わない。必要時のみ`--details`で全文を取得する。
- Markdownのみの変更は軽量CI、コード・設定変更はWindowsフルCI。いずれも`windows-quality`成功が必須（[quality.yml](../.github/workflows/quality.yml)）。
- 反復取得ではステータス要約を優先し、生ログや全コメントを繰り返し取り込まない。branch protectionの追加条件は別に確認する。

## 4. 編集・診断の注意

- 変更は対象箇所と差分に限定する。古いpatchが失敗したら対象行を再読込する。
- 日本語ファイルをPythonで編集する場合は`python -X utf8`などでUTF-8を明示する。
- 長時間処理は実際の終了状態を確認し、失敗stage・終了コード・必要なログだけを読む。
- Electron smokeは専用のTEMP/cacheと隔離userDataを使い、**成功markerがないexit 0は合格にしない**。検証結果はbuild・環境と結び付けて残す。
