---
name: codex-session-analysis
description: Codexの実行履歴（Rollout JSONL）からトークン消費、実行時間、大量出力、失敗、重複、手戻りを分析する。セッションの振り返りに使用し、開発のたびに自動実行しない。
---

# Codexセッション分析

分析の正本はローカルのRollout JSONL。ログ全文をモデルへ渡さず、付属スクリプトで集計してから必要な根拠だけ取得する。分析対象は原則読み取り専用とする。

## 分析手順

1. **対象セッションを最小限の出力で特定する。** 依頼や直前の会話に確定済みのJSONLパスがあれば再検索せず使う。パスが不明なら次の5件から確認する。
   `python -B .agents/skills/codex-session-analysis/scripts/analyze_session.py overview --last 5 --project .`
   古いPRのセッションが見つからない場合は、日付などで対象を絞り、まずファイル名だけを検索する（例：`rg -l -F 'pull/116' "$HOME/.codex/sessions/2026/10/28" -g 'rollout-*.jsonl'`）。過去の分析セッションも一致するため、作成時刻と対象の記録を照合する。生のJSONL行を`rg -n`で丸ごと出力しない。行番号が必要なら`rg -n -o -m 3`で一致箇所だけ表示する。必要な場合に限り検索範囲を広げる。
   `MEMORY.md`などの過去の要約を初めに広く検索しない。既知の対象に不足する特定情報がある場合だけ、検索語と件数を絞って参照する。
2. **最初に集計レポートを取得する。**
   `python -B .agents/skills/codex-session-analysis/scripts/analyze_session.py report --file "<JSONLのパス>" --top 5 --max-total-chars 6000`
   トークン使用量、応答ごとの入力規模、ターン別のツール出力量、先頭8件と8件区間ごとの出力量、失敗・重複・切り詰め候補を確認する。候補の`summary`で内容を把握し、必要なIDだけ追加調査する。全件一覧や同じ`overview`を繰り返し取得しない。レポートの数値だけで無駄と判断しない。
3. **候補の必要性を調べる。** 前後の経緯を確認する必要があるツールIDだけ、次のコマンドで取得する。
   `python -B .agents/skills/codex-session-analysis/scripts/analyze_session.py detail --file "<JSONLのパス>" --id 7 --around 2 --max-chars 2000 --max-total-chars 6000`
   周辺の会話が不要なら`--around 0`とする。初めは必要最小限の文字数で取得し、根拠が不足する場合だけ範囲を広げる。同じIDの再取得は追加情報が必要なときだけにする。複数の`detail`を一括実行して巨大な合計出力を作らない。
4. **レビュー指摘・承認などの文章は指定行から取得する。** JSONLの行番号が分かっている場合、独自PythonでJSONLを直接解析する前に次を使う。
   `python -B .agents/skills/codex-session-analysis/scripts/analyze_session.py message --file "<JSONLのパス>" --line 255 --max-chars 1500`
   `message`は指定行のユーザー・アシスタントのテキストのみを返す。ツール出力や別の種類の記録は取得できない。長文が省略された場合のみ必要な範囲を再取得する。
5. **一覧が必要なら元のIDで絞り込む。** まず必要なIDを指定する。
   `python -B .agents/skills/codex-session-analysis/scripts/analyze_session.py calls --file "<JSONLのパス>" --ids 1,23,34`
   連続する範囲は`--from-id 1 --to-id 8`を使う。最初は関連する数件〜10件程度を目安とし、必要なら追加する。出力順は原則元の実行順。該当IDが未特定のときだけ`--sort-by output`、`--sort-by duration`、`--min-output-chars`を使って探索する。
   先頭8件の出力量や負荷の高い区間の集計だけを目的に全件の`calls`を取得しない。8件区間は工程別の意味的な区分ではない。
6. **原因と改善策を判断する。** 処理が必要だった理由、回帰防止への寄与、手戻り、改善の影響を検討し、ログの行番号・ツールIDで根拠を示す。PR情報との照合が必要な場合だけGitHub操作Skillに従い、例えば`gh pr view 116 -R YutoMatsui21/shortcut-expert --json createdAt,title,url`で必要項目を取得する。

## 集計値の扱い

- `report`はJSONLを1回走査する。応答IDが同じトークン記録は重複計上しない。応答単位・ターン単位の内訳が取得できない場合、推測で補完しない。
- `output_timeline`は出力文字数を呼び出し順の8件区間で集計する。`initial_window`は先頭8件（8件未満なら全件）、`largest_windows`は出力量の多い区間を示す。ターンに紐付かない出力は`unattributed_chars`として明示する。
- `report`の出力文字数には上限がある。`truncated`と`omitted`で省略を示す。省略があれば必要な項目だけ追加取得する。
- ツールの呼び出し回数を減らすためだけに複数の検索結果・詳細結果を一度に集約しない。各コマンドの出力量だけでなく、**呼び出し全体でモデルに返る文字数**も小さく保つ。必要な根拠は段階的に追加取得する。
- 入力トークン、キャッシュ済み入力、非キャッシュ入力、出力トークンを区別する。ツール出力の文字数はトークン数ではない。
- ツール所要時間は呼び出しから結果までの概算であり、API内部の処理時間ではない。
- 候補の`summary`は操作名を知るための省略表示であり、コマンド全文や実行証拠の代わりにはならない。必要な箇所だけ`detail`で確認する。
- 指定行の確認には`message`を優先し、毎回独自Pythonコードを生成しない。対応しない記録形式や行番号が不明な場合のみ、必要な範囲を別途調査する。
- 失敗、重複、待機、出力切り詰めは調査候補であり、不要な処理と同義ではない。終了コード不明の処理を正常終了と断定しない。
- セッションをまたいで合計する際は、対象範囲とサブエージェントの有無を明示し、重複する応答IDを確認する。

## 制約と検証

調査だけの依頼では、ログ、ソースコード、AGENTS.md、他のSkillを変更しない。ログにはコードや認証情報が含まれるため、公開リポジトリへコピーしない。実際の内部待機時間が必要なら、利用可能なOTelデータを別途調査する。

スクリプトを変更した場合は、次を実行する。

`python -B -m unittest discover -s .agents/skills/codex-session-analysis/scripts -p "test_*.py"`

実際のJSONLでも`overview`とのトークン集計の整合、`report`の出力上限、根拠となるID・行番号を確認する。
