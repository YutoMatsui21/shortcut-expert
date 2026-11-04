# 操作別の検出設計

ここには**現在の初回公開対象8操作の技術的な成立条件**、除外条件、通信契約と検証範囲をまとめる。製品仕様・公開条件は[製品要件](../ui-requirements.md)が正本。実装日付やIssueの進捗、実測原本はここに重複させない。

| 操作ID   | 対象                       | 設計                                       |
| -------- | -------------------------- | ------------------------------------------ |
| W01      | ウィンドウ切替             | [window-switch.md](window-switch.md)       |
| W02      | 別画面移動                 | [monitor-move.md](monitor-move.md)         |
| W03・W04 | 最大化／最大化解除・最小化 | [window-state.md](window-state.md)         |
| W06・W07 | 左右半分／四隅配置         | [window-placement.md](window-placement.md) |
| W11      | ウィンドウを閉じる         | [window-close.md](window-close.md)         |
| W12      | タスクバーのアプリを開く   | [taskbar-input.md](taskbar-input.md)       |

**横断する契約**：W02＋W03／W07の同時成立・原子保存・通知統合は[compound-drag.md](compound-drag.md)、同一最終buildでの自然入力／一般環境の受入は[Issue #47](https://github.com/YutoMatsui21/shortcut-expert/issues/47)で追跡する。個別のfixture合格を公開合格とは扱わない。

初回対象外のW08「Snap Layout呼び出し」の過去設計は[archive](../archive/design/snap-invocation.md)、W11の日時付き実測・修正経緯は[validation](https://github.com/YutoMatsui21/shortcut-expert/issues/39)。技術的な成立性の調査全般は[research](../research/)を参照する。
