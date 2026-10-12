---
name: test-shortcut-coach
description: shortcut-expertの回帰テスト追加、判定・保存・IPC・通知の変更、CIの検証範囲を決めるときに使う。他リポジトリの一般的なテスト設計には使わない。
---

# テストを追加する

正本は[テスト設計](../../docs/design.md#test-design)。実行方法は[README](../../README.md#開発確認)と[package.json](../../package.json)。成立条件を変える場合は[要件](../../docs/mvp-requirements.md)・[技術判断](../../docs/research.md#operations)も読む。

1. 壊れた場合の利用者への影響と、入力→期待する記録・通知・保存・停止状態を決める。過去の調査ノートや検出器の出力を正解にしない。
2. 本番の処理を通す最小の層を選ぶ。Core、Mainの通信・保存・通知、本番C# policy、実helper、Electron UI、配布物は異なる証拠。fixtureで迂回した処理を検証済みとしない。
3. 不具合は操作列を回帰ケースにし、修正前の期待assert失敗を確認する。既存の正しい挙動への追加試験は最初から成功してよい。正常・負例・境界・故障のうち、そのリスクに必要な例だけを追加する。
4. OS・Electron・ファイルI/Oを境界でfakeにし、内部の判定器やキューは本番コードを使う。期待値は要件から与える。非同期順序はdeferred、期限は仮想時計で制御する。fakeは試験ごとに片付ける。
5. 新しいNode試験は`tests/*.test.ts`へ置く。helper/SDKが必要なら`native`で始める名前にする。本番C# policyのケースは`tests/native-policy`へ追加し、C#→TS契約も保つ。変更層に必要な検証をREADMEから選び、関連設計と結果を更新する。

自動試験は隔離fixtureだけを使う。実入力観測は本人の明示的な同意後に行い、人工入力を認識率の証拠にしない。通常userData・他アプリ画像・入力内容を試験artifactに含めない。コミット・push・公開の許可はこのSkillから与えない。

完了時は、確認した本番経路、実行結果、修正した不具合、残る実機・配布確認を簡潔に報告する。coverageは計測対象を添え、skipや未実行を合格へ置き換えない。
