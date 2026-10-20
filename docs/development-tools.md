# 開発時の取得・読取・監視

## 実行環境

`npm.cmd run dev:check`は作業先のTEMPとElectron/builderキャッシュでwrite→renameを確認し、Electron・SDK・helperの有無を要約する。SDKは.NET hostがglobal.jsonのrollForwardも含めて解決した版を採用し、基準版と実際の版を返す。必要な部品は`-- --require=electron,sdk,helper`で指定する。部品の存在確認はソースの新しさや検証成功を保証しない。

依存は`npm.cmd run dev:install`、Electron本体だけ不足する場合は`npm.cmd run dev:electron`を使う。installはネットワークを使う明示的な操作。`dev-run.mjs`を通るnpm入口、unit/native runner、helper build、smokeは各子プロセスへ作業先のTEMP/cacheを渡す。builderのElectron取得は環境変数だけを参照しないため、wrapperが`electronDownload.cache`も明示する。前のshellで設定した環境変数を引き継ぐ必要はない。SDKの版はglobal.json、各入口はpackage.jsonを正本とする。

権限・接続失敗時は最初の原因を確認し、設定修正や承認済みの再実行で条件を変えてから再試行する。同じURLの接続切断を別HTTPクライアントでも繰り返したら、接続先/実行環境を切り分け、版・licenseを確認できる配布経路へ移る。別worktreeの依存や古い生成物を標準の代替にしない。

## 仕様の取得と読取

GitHub CLIが使える実行環境では、取得・UTF-8保存・revision/hashの記録を一つの入口で行う。初回はネットワークから取得し、次回は検証したcacheを使う。標準出力はmetadataと見出しだけ。

```powershell
node scripts/github-workflow.mjs issue 14 --repo=YutoMatsui21/shortcut-expert
node scripts/github-workflow.mjs issue 14 --repo=YutoMatsui21/shortcut-expert --section="見出し一覧にある正確な見出し"
```

cacheは`.tools/issues/<owner>--<repo>/<number>.json`。該当見出しと下位節だけを出力し、code fence内の見出しは検索対象にしない。同名見出しが複数あるときはcacheの行位置から読む。仕様更新が必要なら`--refresh`で再取得する。取得・identity検証が失敗した場合は正常cacheを置換しない。cache破損は自動採用せずrefreshを要求する。

`gh auth status`は利用する実行環境で一度確認する。CLIが使えない場合は接続済みGitHubツールで取得し、必要節をファイル編集APIで保存する。本文全体をshellの引数へ再生成して運ばない。取得元・updated_at/revisionと保存成功を確認し、必要になった節だけを読む。認証・権限の失敗を別環境の恒久的な失敗とみなさない。

ソース調査は`rg`で型・関数・呼出し元を探し、必要な範囲を読む。既読の仕様節・型/関数・関連試験を短く作業メモへ残し、変更後は対象関数とdiffを読む。全文再読は、未知の責務や差分だけでは判断できない理由がある時に行う。変更後の再読や生成されたログ末尾の確認は重複とは限らない。

## PR監視

最新headの完全SHAを固定し、1回のGraphQL取得からchecks・review/comment識別子・未解決thread数を要約する。

```powershell
$prHead = git rev-parse HEAD
node scripts/github-workflow.mjs pr-status 64 --repo=YutoMatsui21/shortcut-expert --head=$prHead
```

同じheadで状態が変わらない場合は小さな要約だけを返す。コメント本文の編集やthreadの変化も差分として検出する。30秒以上空け、状態不変なら60秒へ延ばす。必要な指摘本文と最終確認は`--details`で取得する。

head不一致・取得エラー・checks/reviews/threadsおよび各thread内コメントのページ上限超過では完了扱いにしない。threadは最初の指摘から返信まで100件を取得し、本文の編集も差分検出へ含める。上限を超えた項目は接続済みツールやCLIのpaginationで最後まで確認する。PR全体のcommentsは直近20件なので、`earlierCommentsOmitted`なら必要な過去コメントを追加取得する。`checksPassed`はレビュー合格を意味しない。最新headのCodex完了通知・指摘・未解決threadを人間可読の本文で確認する。CLIはmergeやレビュー依頼を実行しない。

GitHub APIが使える限り、待機中にrun/job/全コメントを別々に全面取得しない。取得失敗を成功扱いせず、対応する接続済みツールへ切り替える場合も最新headを維持する。

## 編集とプロセスの扱い

- patchは同じファイルの変更を一つの操作にまとめ、古いhunkが拒否されたら対象行だけを再確認する。
- Pythonで日本語ソースを編集する場合は`python -X utf8`と`read_text/write_text(encoding='utf-8')`を使う。長いファイル内容はファイル編集APIで渡す。
- 非同期処理は返されたIDを保存し、終了結果を受け取ったIDを待機対象から外す。`functions.wait`のcell IDと`write_stdin`のsession IDを区別する。
- 成功した検証はソース・依存・生成物・環境と対応づける。変更した範囲を再検証し、UI/fixtureの期待を固めてから最終packageする。現行の全体確認や最新headのレビューを省略しない。

smokeはElectronモジュールの読込より先にTEMP/cacheを設定し、初回の自動downloadも同じ作業先へ向ける。同梱版では開発用Electronを読み込まない。終了時に成功markerがない場合は、exit 0でも不成功とする。通常のstage/stackに加え、空出力やtimeoutでもmode・起動回数・終了status/signal・出力byte数を表示する。不正IPC拒否のような意図した負例ログと、最初の失敗stageを区別する。診断は隔離fixtureの試験経路だけで出す。
