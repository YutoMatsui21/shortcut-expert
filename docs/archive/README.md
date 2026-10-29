# 過去資料アーカイブ

このディレクトリは**過去の意思決定・調査・実装の証拠**を保管します。現行仕様の正本ではありません。

現在の参照先：[プロダクトの目的](../product.md)／[確定要件](../ui-requirements.md)／[設計](../design.md)／[開発・実行方法](../development.md)／[Agent方針](../../AGENTS.md)

## 過去資料

- [旧MVP要件と工程記録](mvp-requirements.md) — 旧11操作・30日保持・旧通知条件
- [設計・実装の過去工程](design-implementation-history.md) — 初期設計、環境準備、実装・リファクタの記録
- [テスト・CIの背景調査](quality-best-practices.md) — 2026-10-12時点の一般原則と適用案
- [品質保証の不足分析](quality-gap-analysis.md) — 2026-10-12時点の不具合・改善案
- [10月19日の振り返り](implementation-retro-2026-10-19.md)
- [10月20日の振り返り](implementation-retro-2026-10-20.md)

以前の[価値検証・競合・技術調査](research-overview.md)と、初回対象外の[Snap Layout資料](research-snap-layout-validation.md)・[Snap呼び出し資料](research-snap-invocation-validation.md)・[Task View資料](research-task-view-validation.md)も保管します。現在の調査判断は[research](../research/)を参照してください。

日時付きの受入記録は関連GitHub Issueへ引き継ぎ、実測のJSON／source等の原本はリポジトリ直下の`validation/evidence/`などに保持します。資料中の「CIがない」「未実装」などは**当時の状態**です。

## 更新ルール

1. 現行仕様は[確定要件](../ui-requirements.md)へ記述し、READMEやSkillsへ詳細を重複させない。
2. 実装状況はコード・Issue・受入証拠で確認する。設計上の合格条件とは区別する。
3. 変更理由はIssue・Git履歴に残し、重要な検証原本は保持する。現行設計書へ古い作業日誌を追記しない。
4. 歴史資料を現行の受入条件として引用しない。文書移動時はリンクを検証する。
