# #47 準備結果（2026-10-30）

判定：**未受入**。自然入力の同意待ち。本人同意を要する観測・UIA試験・キー送出は実施していない。製品ソースの変更なし、IssueのClose／公開なし。

## 固定候補

- main: `64cdc615c06651da2941cfdfc98ecec8e475555a`
- 同梱先: `release/issue-47/win-unpacked`
- 全550ファイルmanifest SHA-256: `f2d2378e4d93ebd0ddf014122338f4225269b47215339bff36eaefb06fbfe351`
- exe: `154597d1f93d01e7317fe52661bf5d7bd9eae4a2c6abb5c3757010cfcad87841`
- app.asar: `865399c1d861b8d39b2d07c04cad01b29da54bcf90bdcc5e3433a20524e21c17`
- WindowObserver.exe: `a60a2b25d786137d08cc928c4bcf5464f88ebf607533565cf326e7b81c5a07bc`
- ローカル全ファイルmanifest: `.tools/issue-47-candidate.json`。試験後に全体hash不変を確認。
- 同revisionの[main CI成功](https://github.com/YutoMatsui21/shortcut-expert/actions/runs/40888939698)を確認。このローカルbuild自体はCI artifactではない。

## 実施済み（隔離fixture）

| 試験 | 結果・ローカル証拠 |
| --- | --- |
| helper publish／型検査／Electron bundle／同梱 | 成功。`.tools/issue-47-build.log`、`issue-47-bundle.log`、`issue-47-package.log` |
| 通常同梱smoke | 成功。8操作、複合2件、SQLite、一覧／記録、通知要求、保存失敗復旧。`.tools/issue-47-smoke.log` |
| settings | 成功。停止／pause、全削除、失敗再試行、4幅。`.tools/issue-47-settings.log` |
| activation | 3起動成功。既存窓／cold start／初期化失敗。`.tools/issue-47-activation.log` |
| migration | 2起動成功。原本保全・移行・再起動。`.tools/issue-47-migration.log` |
| comparison | 成功。4幅・filters・read model。`.tools/issue-47-comparison.log` |
| 保存受入 | 17ケース成功。`.tools/issue-47-storage.log`、`.tools/validation/v02-FaIFEt/` |

保存受入にはACK喪失、Worker停止、再起動、SQLite接続のpage limitによるSQLITE_FULL、隔離fixtureのdeny-write ACLと復元が含まれる。物理ディスク枯渇・電源断を確認した意味ではない。

初回buildはサンドボックスのesbuild読取制限で失敗。権限拡張での再実行はpublish後のrenameがEPERMとなった。成功済みpublishの内容を同梱先へコピーし、Electron bundle／packageを完了した。製品コードの回避修正はしていない。NuGet脆弱性データ取得のNU1900警告は残る。

## 未実施と次の工程

- [受入計画](README.md)の全自然入力ケース、6契約、代表外部アプリ／一般環境、実Toast表示は `unknown`。
- W01／W12専用の既存計測では全8操作・複合の受入証拠を採れない。本人同意後の観測開始前に、有界な8操作計測入口を用意し、テストと必要なローカルレビューを行う。製品bundleを変更した場合は候補hashを更新し、同じ新候補で必要なfixtureを再実行する。
- 試験前に環境カテゴリと対象窓・起点・操作列を確定し、本人が各ケースを物理操作する。隔離データ、手動ARM/FINISH、期限、終了時helper停止を守る。
- NSIS／通知センター起動の実OS受入、#48への最終結果引継ぎ、#47完了は未実施。
- 今回の差分は試験計画・準備記録のMarkdownのみ。Skillの文書例外により専用コードレビューを省略。製品変更や自然入力受入のレビューを済ませた意味ではない。記録はローカル未コミットで保持。
