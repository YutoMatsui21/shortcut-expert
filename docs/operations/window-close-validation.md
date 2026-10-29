# #39 W11の局所検証（2026-10-29）

[判定契約](window-close.md)と[#9/#14のG-W11](../research/eight-operation-validation.md)を前提に、入力・対象・破棄の本番照合と保存/表示の結合を確認した。完成版のR02・一般アプリでの適用範囲・実OS通知・配布受入は#47へ残す。

## 本人の自然入力と自作窓

本人の明示同意後、自作標準WinForms窓A/Bだけを使い、本人がARM/FINISHを操作した。自動入力送出なし。WindowsのAPI報告版は`10.0.26340.0`。実行中の入力/窓識別子は本番helper内部の一時照合のみで、保存した証拠は固定カテゴリの集計。全試行のstop ACKを確認し、終了後にパネルとhelperを終了した。

最終8ケースは同一helper DLL SHA-256 `4DA55628BFA2B6294AAC896F238E57478B4A601C0FC6A7B56F3AA5E64897AAE0`。起点mainは`7177e73c481f05e0af38dc6c4b8e4605ff4efaad`で、当時の作業差分を使用した。[build/source hashes](../../validation/evidence/window-close-20261029/confirmed-build.json)、[集計原本](../../validation/evidence/window-close-20261029/confirmed-trials.jsonl)、[本人確認と範囲](../../validation/evidence/window-close-20261029/participant-confirmation.json)を保持する。

| 手動case | A破棄/B破棄 | W11 mouse/key | W01 | 結果 |
| --- | --- | --- | --- | --- |
| × | 1/0 | 1/0 | 0 | PASS |
| Alt+F4 | 1/0 | 0/1 | 0 | PASS |
| 確認No | 0/0 | 0/0 | 0 | PASS |
| hide | 0/0 | 0/0 | 0 | PASS |
| 別Bだけ破棄 | 0/1 | 0/0 | 0 | PASS |
| 内部PROGRAM CLOSE | 1/0 | 0/0 | 0 | PASS |
| 確認で2秒以上待ちYes | 1/0 | 0/0 | 0 | PASS |
| 内部TAB Xのみ消去 | 0/0 | 0/0 | 0 | PASS |

各1回の局所試験であり95%精度等を主張しない。hideはトレイ格納の代替実装ではなく、TAB Xも一般ブラウザのタブではない。一般アプリの独自枠、実tray、多段階確認、異なるWindows/画面構成の自然入力は未検証。HWND再利用・注入/競合・停止/世代変更等は本番policyの人工列であり、この8ケースで自然入力検証済みとはしない。

## 見逃し原本と原因

- [初回](../../validation/evidence/window-close-20261029/trials.jsonl)：冒頭1件は説明の不明点が申告された時期のA破棄0の記録で、操作実施を確証できずunknownとして除外。続く正例2件はA破棄1だがW11 0、6負例は0。初回buildのDLL hashは収集していない。
- [理由別診断](../../validation/evidence/window-close-20261029/diagnostic-trials.jsonl)：正例2件とも入力・対象を受付後に`ForegroundCancel=1`。通常閉鎖でも次の窓への前面変更が破棄前に来ていた。このbuildのDLL hashは未収集。
- [HIDE取消の試行](../../validation/evidence/window-close-20261029/fixed-trials.jsonl)：正例2件とも`HideCancel=1`、W11 0。[build hashes](../../validation/evidence/window-close-20261029/fixed-build.json)。通常閉鎖でもHIDE時点でHWNDが生存していたため、HIDE単独取消を撤回した。
- [破棄時の生存確認](../../validation/evidence/window-close-20261029/result-trials.jsonl)：正例2件とも`DestroyTarget=1/DestroyAlive=1`、thread/tick/期限/解放の不一致0、W11 0。[build hashes](../../validation/evidence/window-close-20261029/result-build.json)。DESTROY callbackでHWNDがまだ生存する実測に対応し、同一対象の消滅を元の入力期限内で待つようにした。
- 最終原本は正例各1・負例0。正常確定でも`PollCancel=1`が付く診断上の問題が残っていたため、最後に「正常完了と取消を二重に集計しない」ガードだけを修正した。入力判定・待機・確定・送信条件は変更していない。[診断修正版のhash/検証](../../validation/evidence/window-close-20261029/final-build.json)と自然入力で試したbuildを区別し、同一最終配布buildの自然入力合格とは扱わない。

生入力やイベント時刻列を取得せず、固定理由の有界集計で入力受付→取消→破棄→消滅の境界を切り分けた。回帰試験では、前面変更による取消とHIDE単独取消、DESTROY時点での生存に起因する見逃しのRedを確認し、実測順序と期限/対象不一致/停止等の負例でGreenを確認した。

## 自動検証とレビュー

- unit全298件PASS。`window-close`の厳格parse/Core、SQLiteの3学習状態、保存後通知adapter、pause/stop/保存失敗/ACK消失/retryを含む。
- 本番C# policy489項目、native suite全7件PASS。C#→v2 JSON→Main/Core→SQLite、fixtureプロセスとhook解除を含む。
- build（helper・型検査・Electron bundle）PASS。sandbox内のesbuild親ディレクトリ読取エラーは通常ユーザー環境で解消し、製品不具合と区別した。
- storage smoke PASS。W11型付き証拠をfixture helper→Main/IPC→SQLite→実Rendererの記録/一覧へ通し、停止/復旧等も検証。OS Toastの可視表示と自然入力精度はこの試験では未確認。
- `docs/code-review.md`の4観点を明示して全差分を専用Codexでレビュー。手動パネルのカウントダウン中FINISH、stop ACK不達時の終了、未操作試行の識別を修正した。実測と矛盾したhide取消は原本を根拠に再検討し、保留と消滅確認を含む全体再レビューでは指摘なし。その後の診断カウンタだけの差分は呼出し/送信/判定が同じことをローカル確認し、全体再レビューを追加しなかった。

人工fixtureと自作窓の局所成功を、#47の同一最終製品buildにおける8操作×両入力・6契約・R02/J04の合格へ読み替えない。
