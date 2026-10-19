---
name: finish-issue
description: shortcut-expertの実装Issueが完了したとき、PRのCI・Codexレビュー確認、mainへのmerge、Issueのクローズ・ラベル・親と後続Issueの更新を行う。
---

# 実装Issueの完了処理

実装・マージ・GitHub上の状態更新を**一つの作業**として扱う。リポジトリの[AGENTS.md](../../AGENTS.md)と当該Issueの受入条件を優先する。

1. **実装と検証**：担当Issueの受入条件を確認し、変更箇所のテストを行う。テスト選定は[テスト設計Skill](../test-shortcut-coach/SKILL.md)。人工fixtureを実入力の成功証拠にしない。
2. **PRを作る**：作業ブランチへcommit・pushし、main向けPRを作る。本文に対象Issue（例：`Closes #17`）、変更点、テスト結果、未検証事項を記載する。既にmainへ反映されている場合は、重複PRを作らず取り込み済みであることを確認する。
3. **レビューを終える**：PR最新headのCI・GitHub上のCodexコードレビュー・必要な指摘対応を確認する。修正時は再pushし、最新headで再確認する。競合やbranch protectionなどの必須条件も満たす。
4. **mainにマージ**：条件を満たしたPRをmainにmergeする。CI失敗、レビュー未完了、未解決の重大指摘、権限不足時は**mergeしない**。失敗を成功扱いせず理由を報告する。
5. **GitHubを更新**：mainへの取り込みを確認してから、対象Issueを`Closed (completed)`にする。`ready-for-agent`と不要な`blocked`を外し、`ui-redesign`・`kind:...`など分類ラベルを残す。親Issueの進捗を更新する。後続Issueは**全ての着手条件**を確認し、満たせば`blocked`を外して`ready-for-agent`にする。
6. **結果を報告**：PR/merge先、テスト・レビュー結果、更新したIssue・ラベル、残作業を簡潔に伝える。

**例外**：PRなしでmainに取り込み済みの変更は、mainへの反映と受入条件を確認して手順5へ進む。調査・Figma等の非実装Issueは成果物を確認した後に状態だけ更新し、不要なPRを作らない。保留・対象外Issueを勝手に着手可能へ変えない。アプリの公開・配布は別途承認が必要。
