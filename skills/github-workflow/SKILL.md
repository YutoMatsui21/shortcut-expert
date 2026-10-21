---
name: github-workflow
description: shortcut-expertのGitHub操作（Issue・PRの参照/更新、Codexレビュー依頼、CI確認、merge、Issue完了・ラベル更新）を行うときに使う。
---

# GitHub操作

GitHub操作はこのSkillに従う。リポジトリの[AGENTS.md](../../AGENTS.md)と対象Issueの受入条件を優先する。コマンドや効率的な差分監視は[開発手順](../../README.md#development-workflow)・[PR監視入口](../../docs/development-tools.md#pr監視)を参照する。

## 操作の優先順位

- **GitHub CLI（`gh`）を最優先**。実行環境で`gh --version`と`gh auth status`を確認し、取得は`gh api --jq`や`gh ... --json ... --jq`で必要な項目だけに絞る。
- `gh`が未導入・未認証・権限不足などで**目的の操作を実行できない場合に限り**、接続済み`codex.apps`（GitHubアプリ）を使用する。単に結果が0件・処理が失敗したことだけをCLI利用不能と決めつけず、原因を確認する。
- どちらも利用できない場合、成功を装わず阻害要因を報告する。認証状態は実行環境ごとに判定する。

## 実装Issueの完了フロー

1. **実装と検証**：受入条件を確認し、関連テストを実行する。テスト選定は[テスト設計Skill](../test-shortcut-coach/SKILL.md)。人工fixtureを実入力精度の証拠としない。
2. **PR作成・レビュー依頼**：作業ブランチへcommit・pushし、main向けPRがなければ作成する。本文に対象Issue（例：`Closes #17`）、変更点・テスト結果・未検証事項を記載する。**自動Codexレビューは無効**のため、PR作成後と**以後の各push後**、PRのConversationに`@codex review`を明示的に投稿する（例：`gh pr comment <PR番号> --body '@codex review'`）。PRができる前のpushはPR作成直後に依頼する。同一headへの重複依頼は避け、投稿できたことを確認する。
3. **両方の結果を待つ**：最新headの完全SHAを固定し、[PR監視入口](../../docs/development-tools.md#pr監視)でCI（必須の`windows-quality`）と、**依頼後のCodexレビュー完了通知・本文・指摘**を確認する。**CIとCodexレビューの両結果が出揃うまで、片方が失敗していても修正に着手しない**。未開始・進行中・結果不明を完了扱いにしない。待機を継続できない／依頼が処理されないときは阻害要因として報告し、mergeしない。
4. **指摘を評価・修正**：両結果が揃ったらCI失敗とレビュー内容を確認する。Codexの**P0/P1は必ず対応**、**P2は実際の影響度・重要度・緊急度を評価し、重要または緊急なバグと判断したものだけ修正**する。P2を見送る場合は理由を残す。必要な指摘はコードと照合し、変更範囲に応じてテストする。保存・移行変更はテスト設計Skillの故障境界も確認する。修正をpushしたら**新しいheadで手順2のレビュー依頼から繰り返す**。
5. **merge**：最新headのCI成功・Codexレビュー完了・必須指摘への対応・未解決thread・競合・branch protectionを確認してからmainへmergeする。CI失敗、レビュー未完了、重大指摘未解決、権限不足ならmergeしない。
6. **Issueを更新**：mainへの取り込みを確認してから、対象Issueを`Closed (completed)`にする。`ready-for-agent`と不要な`blocked`を外し、`ui-redesign`・`kind:...`などの分類ラベルは残す。親Issueの進捗を更新し、後続Issueは全着手条件を満たした場合だけ`blocked`を外して`ready-for-agent`にする。
7. **結果報告**：PR/merge先、CI・レビュー結果、更新したIssue・ラベル、残作業を簡潔に伝える。

**例外**：すでにmainへ反映された実装は重複PRを作らず、取り込みと受入条件を確認してIssue更新へ進む。調査・Figma等の非実装Issueは成果物を確認して状態だけを更新し、不要なPRを作らない。保留・対象外Issueを勝手に着手可能に変えない。アプリの公開・配布は別途承認が必要。
