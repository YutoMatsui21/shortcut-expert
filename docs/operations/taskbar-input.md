# W12：タスクバーのアプリを開く

**責務**：主タスクバーのアプリアイコンへのクリック／有効なWin+数字を、前面窓の切替W01とは区別して記録する。起動・復帰・個別窓の選択結果を待たない。[製品要件](../ui-requirements.md#w01-w12)、[技術調査](../research/taskbar-input-validation.md)。

## 1. 検出経路と対応範囲

| 入力 | 採用する条件 |
| --- | --- |
| マウス | 同じ**主タスクバーのアプリアイコン**で非注入の左down／up。クリック前後の同一項目・番号を照合 |
| キー | 存在する番号への`Win+1〜9／Win+0`の初回down。注入、追加修飾、repeat、存在しない番号を除外 |

- `TaskbarInputObserver`がhookを共用し、別processの`TaskbarQuery`でUIAのapp Buttonを照会。分類・可視矩形・Appid・番号の一意性を検査し、**UIA照会をhook内で直接実行しない**。アプリ名・窓タイトルは取得・保存しない。
- 250ms間隔・同時最大1照会。queryの2秒timeoutとworkerの2.5秒watchdogを設け、失敗時にworkerを破棄・再生成する。stop時はworker・仮候補を破棄する。
- 入力前に始まった照会から750ms以内のsnapshotを使い、入力後の新照会で番号・項目・配置が一致したら2.5秒以内に確定する。仮候補最大16件。古い照会・並び変化・照会失敗・期限切れは採用しない。
- **現行の検証済み範囲は主タスクバー1〜10番**。別タスクバー、overflow、RTL、不明なButton、並び替え中はunknown。未検証の番号・キーを推測しない。これを製品要件の対応範囲縮小とは扱わない。
- タスクバーアイコンの操作は**W12だけ**。切替結果としてforegroundが変わってもW01へ追加計上しない。[W01](window-switch.md)。

## 2. 通信と記録

専用v2証拠`taskbar-input/taskbar-input-v1`には番号・同一項目照合・snapshotの鮮度・完了までの時間・通知用monitorだけを載せる。Mainは必須項目を厳格parseし、CoreがW12へ分類。UIAのAppid・座標／入力列・ウィンドウ識別子は永続化しない。v1候補や未検証activation証拠は採用しない。保存・集計・通知は共通SQLite／学習状態の経路を使用する。

**初回は番号が確証できたときのWin+数字1候補のみ**。11番目以降の検出、起動状態別のAlt+Tab候補、1操作への複数キーは将来の[#96](https://github.com/YutoMatsui21/shortcut-expert/issues/96)。

## 3. 検証と未確認条件

- **自動**：`tests/native/policy/TaskbarTests.cs`、`tests/native/taskbar-uia-worker.test.ts`、`tests/operations/taskbar-app-activation.test.ts`、`tests/integration/candidate-to-page-model-data-flow.test.ts`。番号照合・期限・再生成・停止・C#→Main／Core、3状態・SQLite・通知adapterを確認する。
- **自然入力入口**：本人の明示同意後だけ、`node scripts/acceptance/w12-natural-acceptance.mjs --package-dir <build> --observe-consented`。隔離SQLiteを使用し、ARM→操作→FINISHでのみ観測（1試行45秒・session20分）。通常userData、生入力列・アプリ識別子は保存しない。
- **局所の実測結果**：2026-10-25の主タスクバー／代表環境17ケースは期待したW12件数・通知要求・W01非重複と一致。[結果原本](../../validation/evidence/w12-natural-20261025-results.json)、[build manifest](../../validation/evidence/w12-natural-20261025-build.json)。Explorer／Chromeと自作窓を含む限定試験であり、一般アプリ全体・pin変動・overflow・secondaryの番号対応・最終公開buildのR02／J04・実OS通知の網羅を示さない。
