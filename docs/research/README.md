# 技術調査・判断根拠

**目的**：採用済みの実装方法が破綻したときや、検出対象・Windows環境を拡張するときに、**試した方法・失敗理由・代替案を再利用する**。単なる日付順の調査ログや進捗報告は置かない。

| 後から調べたいこと                | 判断材料                                          |
| --------------------------------- | ------------------------------------------------- |
| 操作全体の成立条件・誤分類・他API | [8操作の成立性](eight-operation-validation.md)    |
| 画面移動と最大化／四隅の複合操作  | [複合ドラッグ](compound-drag-validation.md)       |
| Alt+Tab／直接クリックの見逃し     | [W01 ウィンドウ切替](window-switch-validation.md) |
| タスクバー番号・UIA不明／遅延     | [W12 タスクバー](taskbar-input-validation.md)     |
| 永続化方式・WAL／故障・移行       | [SQLite採用理由](sqlite-storage-validation.md)    |

**読む順序**：まず[現行設計](../design.md)と[操作別設計](../operations/)、[保存設計](../storage/)で今の契約を確認し、**その方法がなぜ採用されたか／他の方法で何が失敗したか**を知りたいときだけ調査を読む。古い調査の「未実装」「PASS」は当時の評価であり、現在の実装・リリース判定ではない。

過去の価値検証・競合・旧W08／Win+Tab・Snap Layout調査は[archive](../archive/)へ移動。実測のソース・JSONL・hashなどの原本はリポジトリ直下の[`validation/evidence`](../../validation/evidence)、実行可能な調査コードは[`validation/probes`](../../validation/probes)と[`scripts`](../../scripts)に保持。完了／未完了・受入結果は各GitHub Issueを参照する。

**新しい調査文書を追加する条件**：未解決の技術選択肢が複数あり、調査によって後の実装判断が変わり得ること。調査時のテスト件数だけを残す場合はIssue／PRへ記録する。
