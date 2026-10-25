---
name: test-shortcut-coach
description: shortcut-expertの回帰テスト追加、判定・保存・IPC・通知の変更、CIの検証範囲を決めるときに使う。他リポジトリの一般的なテスト設計には使わない。
---

# テストを追加する

正本は[テスト設計](../../../docs/design.md#test-design)。実行方法は[README](../../../README.md#開発確認)と[package.json](../../../package.json)。成立条件を変える場合は[要件](../../../docs/mvp-requirements.md)・[技術判断](../../../docs/research.md#operations)も読む。

1. 壊れた場合の利用者への影響と、入力→期待する記録・通知・保存・停止状態を決める。UI/API変更では「変更する契約→unit/IPC mock→smokeのselector・待機・表示期待→配布試験」を短く対応づけ、変更後の正しい期待と旧fixtureの前提を区別する。過去の調査ノートや検出器の出力を正解にしない。
2. 本番の処理を通す最小の層を選ぶ。Core、Mainの通信・保存・通知、本番C# policy、実helper、Electron UI、配布物は異なる証拠。fixtureで迂回した処理を検証済みとしない。
3. 不具合は操作列を回帰ケースにし、修正前の期待assert失敗を確認する。既存の正しい挙動への追加試験は最初から成功してよい。保存・移行の変更は[故障境界の確認](../../../docs/design.md#storage-review)から該当する操作列を選び、実装前の試験選定とPR前のレビューに使う。正常・負例・境界・故障のうち、そのリスクに必要な例だけを追加する。
4. OS・Electron・ファイルI/Oを境界でfakeにし、内部の判定器やキューは本番コードを使う。期待値は要件から与える。非同期順序はdeferred、期限は仮想時計で制御する。fakeは試験ごとに片付ける。
5. 新しいNode試験は`tests/*.test.ts`へ置く。helper/SDKが必要なら`native`で始める名前にする。本番C# policyのケースは`tests/native-policy`へ追加し、C#→TS契約も保つ。変更層に必要な検証をREADMEから選び、関連設計と結果を更新する。

## 変更範囲に応じたテスト選択

修正中は差分・呼び出し元・利用先から必要な層だけ選び、実行ファイルと結果を記録する。絞り込みの成功を全件合格と扱わない。

| 変更箇所 | まず確認するテスト | 影響がある場合に追加 |
| --- | --- | --- |
| Markdownのみ | 文書リンクと内容の整合 | 実装変更があれば関連層のテスト |
| Core/Shared | 関連unit、型検査 | C#→TS候補契約ならnative policyとhelper結合 |
| Main/IPC・保存・通知 | 関連unit、該当する故障操作列 | Electron smoke、保存・終了契約なら同梱smoke |
| Renderer/Preload | UI・IPC unit、型検査 | Main結合smoke、同梱契約ならpackaged smoke |
| native-helper/C# | 本番C# policy、helper build・native suite | TSとの契約試験、関連Core・Electron smoke |
| scripts/CI/package | 対応するtool試験と設定検証 | build・package・配布smoke |

対象unitは`npm.cmd run test:unit -- --file=対象.test.ts`、nativeはhelperをbuild後に`node scripts/test.mjs native --file=native-policy.test.ts`などで絞る。詳細はREADMEを正本とする。

PRでは実装・テスト・設定・workflowを変更したらWindowsフルCIを維持する。MarkdownのみはフルCIを省略するが、必須チェック`windows-quality`は成功させる。依存関係が不明なら安全側に検証を広げる。

自動試験は隔離fixtureだけを使う。実入力観測は本人の明示的な同意後に行い、人工入力を認識率の証拠にしない。通常userData・他アプリ画像・入力内容を試験artifactに含めない。コミット・push・公開の許可はこのSkillから与えない。

完了時は、確認した本番経路、実行結果、修正した不具合、残る実機・配布確認を簡潔に報告する。coverageは計測対象を添え、skipや未実行を合格へ置き換えない。
