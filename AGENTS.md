# 開発方針

## 構成と参照先

- 機能追加・リファクタ・責務配置のレビューでは、[現行アーキテクチャ](docs/design.md#architecture)を参照し、処理を担当Moduleへ置く。
- Windowsの窓操作を効率化する目的・動作要件・公開前の受け入れ条件は[要件書](docs/mvp-requirements.md)、操作の成立条件は[技術判断](docs/research.md#operations)を参照する。習得数自体を目的にしない。
- 実装着手・仕様取得・CI待機は[開発の進め方](README.md#development-workflow)、実行手順・変更範囲に応じた検証は[README](README.md#開発確認)と[package.json](package.json)、.NET SDKの版は[global.json](global.json)を参照する。
- テスト追加・バグ修正・CI変更では[テスト設計Skill](skills/test-shortcut-coach/SKILL.md)を読み、変更した本番経路に対応する検証を選ぶ。
- Issue・PR・レビュー依頼・merge・ラベル更新などGitHub操作では[GitHub操作Skill](skills/github-workflow/SKILL.md)を読み、`gh`を最優先で使用する。
- 必要な資料だけ読み、過去の検証結果や設計上の仮説を現行実装の確認済み事実として扱わない。

## 変更と安全性

- 依頼の目的・範囲・達成条件に沿う最小限の変更とする。MVPの操作候補・対象条件・受け入れ基準の変更は根拠と影響を示して相談する。
- 対象はWindows全体の窓管理操作。アプリ内部のショートカットや独自キーは、明示的な要件がある場合に扱う。
- 入力由来・操作結果・代替キーの同等性が不明なら推測で案内・集計しない。ElectronのcontextIsolation・sandboxと限定されたpreload APIを維持する。
- 通常の保存は日別・操作別mouse/key集計、設定、および[#15の承認済み保存契約](https://github.com/YutoMatsui21/shortcut-expert/issues/15)・Spec §8.3/§9で定めた日別coverage集約（knownness・稼働量・gap・能力revision）と保存整合用metaに限定する。文字・キー生ログ・入力時刻列・活動履歴・URL・窓タイトル・ファイル名やパス・clipboard・画面画像は保存せず、外部送信しない。
- 自動検証は隔離したfixtureデータを使う。実入力の観測を伴う試験はユーザーの明示的な同意を得る。人工入力の成功を実入力精度の証拠としない。
- 実装Issueでは、実装・ローカルテスト→ローカル`/review`→指摘対応→commit・push→PR作成→最新headのCI確認→mainへmerge→Issue・ラベル・親/後続Issueを更新する。CI失敗後は修正内容に応じてローカル再レビューを判断する。GitHubの`@codex review`は高リスク変更など必要時だけ依頼し、依頼した場合は結果も確認する。詳細は[GitHub操作Skill](skills/github-workflow/SKILL.md)。CI・必要なレビュー・権限等の条件が満たせない場合はmerge/完了扱いにせず阻害要因を報告する。**アプリの公開・リリースは別途承認が必要。**
- 責務・依存方向・動作・要件を変更したら、同じ変更内で関連する設計書・正本・テストを更新する。
- 規則の詳細は設計書、実行手順はREADMEに集約し、このファイルでは重複した規則・一時的な作業状況を削る。
- 完了時は変更内容、検証結果、未確認事項を簡潔に報告する。

## Code Review Rules

- コードレビューでは[追加レビュー規則](docs/code-review.md)を参照し、仕様適合性・影響範囲・境界条件とテスト・変更固有の重点を確認する。既存の要件・設計・テスト規則を優先し、同じ規則を再定義しない。
- ローカル`/review`の専用レビュアーが参照先Markdownを自動的に読んだとは仮定しない。追加指示の適用が確認できない場合は、レビュー実行時に必要な観点を明示し、未確認のまま合格と扱わない。
