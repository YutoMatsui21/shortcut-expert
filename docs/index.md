# 開発ドキュメントの案内

このページは、タスクに必要な**正本と補足情報を見つけるための索引**。すべての資料を毎回読む必要はない。対象が明確なら該当資料を直接参照し、実装の事実と現在の進捗はコード・テスト・Issueで確認する。

## 情報の正本

| 知りたいこと | 最初に参照する場所 |
| --- | --- |
| なぜ作るか・どんな成果を重視するか | [プロダクトの目的・思想](product.md) |
| 何を作るか・MVP・期待動作・公開合格条件 | [製品要件・受入条件](ui-requirements.md) |
| どういう責務分担で実現するか | [全体設計・アーキテクチャ](design.md) |
| Windows操作をどう検出・分類するか | [操作別の技術設計](operations/README.md) |
| UI・通知・ウィンドウ動作の実装設計 | [機能別の設計](features/learning-ui.md)・[記録](features/records-ui.md)・[設定](features/settings-panel.md)・[通知](features/standard-notifications.md)・[窓管理](features/window-lifecycle.md) |
| 保存・移行・削除の契約 | [永続保存](storage/durable-storage.md)・[旧JSON移行](storage/json-migration.md)・[記録削除](storage/history-deletion.md) |
| 開発環境・実行・検証コマンド | [開発・検証ガイド](development.md) |
| 補助ツール・Issue取得・CI監視 | [開発ツール](development-tools.md) |
| レビュー時の確認観点 | [コードレビュー規則](code-review.md) |

画面の**外観・レイアウト・文言**は、[製品要件](ui-requirements.md)からリンクされている正式なFigmaノードも確認する。要件・受入条件は製品要件が正本であり、Figmaのサンプルデータは仕様ではない。

## 作業手順と実装の事実

- **共通指示・安全上の不変条件**：[AGENTS.md](../AGENTS.md)。
- **実装・テストの進め方**：[テスト設計Skill](../.agents/skills/test-shortcut-coach/SKILL.md)。関連する変更のときだけ参照する。
- **Issue・PR・CI・mergeの手順**：[GitHub操作Skill](../.agents/skills/github-workflow/SKILL.md)。GitHub操作時だけ参照する。
- **実際のコード構造・動作**：`src/`・`native-helper/`を調査する。文書の実装経路が古い可能性があれば現行コードを確認する。
- **自動テストと技術検証**：`tests/`・`validation/probes/`。実測原本は`validation/evidence/`。人工fixtureの成功を実際のWindows入力の成立証拠にしない。
- **進捗・未解決事項・受入結果**：[GitHub Issues](https://github.com/YutoMatsui21/shortcut-expert/issues)・PR・対応する証拠を参照する。最新の状態を履歴資料から推測しない。

## 判断理由や過去の失敗を調べる場合

現行の仕様・設計を先に確認したうえで、**なぜその方式にしたか、何を試して失敗したか**が必要なときだけ[技術調査・判断根拠](research/README.md)を参照する。

[過去資料](archive/README.md)は、旧MVP・旧実装・実施当時の調査と振り返り。**現行の正本ではない**。現在の判断へ採用するには、改めて要件・コード・Issueとの整合を確認する。

## 文書を更新する際の原則

1. 製品目的・成果の優先順位は`product.md`、機能仕様と受入条件は`ui-requirements.md`へ置く。理由と実装詳細を混同しない。
2. 設計意図と重要な契約は`design.md`および関連する個別設計へ置く。コードから容易に正確に得られる細部を二重管理しない。
3. 実装状況・日時付きの試験経過・一時的な作業課題はIssue・PR・証拠で追跡する。過去資料を現行仕様へ昇格させない。
4. 正本を変更したら、関連する参照リンク・必要なテストを確認する。ただし無関係な文書を一括して読み直さない。
