# #43 先行fixture統合の検証範囲

8操作版の最終受入#43/#47は未完了。現行Coreで採用する操作IDはW12/W01/W03/統合W04/W02/W11。W06/W07の検出器とW03上端ドラッグの技術条件・実機受入は別Issueで追跡する。W08/W10は初回対象外。旧W05はW04へ統合し、履歴の合算はしない。旧検証証拠は保持する。


DBへの直接投入や判定器のfakeで未実装の検出器を通過扱いにしない。旧W08の成果は[対象変更前の製品経路](snap-invocation.md)に保持する。
検出器Issueの完了を着手条件に追加するものではなく、現行実装と#43の受入条件の差を示す。

## 本番経路と試験

| 契約 | 試験入口 | 通る経路・限界 |
| --- | --- | --- |
| 現行6操作ID（W04の2経路を含む）×mouse/key×3状態 | `tests/fixture-integration.test.ts` | 人工v2 JSON→Main厳格parse→DurableCoach判定→実SQLite Worker→再open。両ページ用モデルと3filter、学習中だけ通知adapter発行、重送非採用を確認。React/Preload/helperはこの試験の対象外 |
| 8行・2ページ・限定IPC・停止/再開・終了 | 通常smoke、`--storage` | 本番Electron/Preload/Reactとfixture helper。通常smokeは旧JSON/独自通知、storageはSQLite/標準通知adapter。8行表示を8操作採用の証拠にしない |
| J01比較・警告 | `--comparison`、`tests/records-query.test.ts` | 隔離した取得済み記録/coverageによる比較と警告。投入したcountsはparse/Core採用の証拠ではない |
| J02保存後発行・障害後非再送 | 上記結合試験、`tests/durable-storage.test.ts`、`tests/standard-notification.test.ts`、storage smoke | 実Worker保存後のadapter、保存/ACK障害の再試行と再起動、OSイベントfake。物理disk故障の合格ではない |
| J03人工activation | `--activation`、`tests/notification-*.test.ts` | cold/稼働中/初期化失敗の人工callback。実COM/OS通知clickではない |
| 削除/再試行・不正IPC・世代・時計 | `--settings`、`tests/delete-*.test.ts`、`tests/coach-ipc.test.ts`、`tests/observer.test.ts`、`tests/protocol-v2.test.ts`、`tests/durable-storage.test.ts` | 取消/確定、保存障害、世代/transaction/版混在、時計後退。各試験が隔離する境界は個別ソースに記載 |
| Native既存window判定・W01/W12と旧W08 policy | `npm.cmd run test:native` | 本番C# policy/通信→TS契約、fixture helperの開始/停止。未成立の実検出経路はfixtureで通過扱いにしない |
| W11の型付き閉鎖結果 | `tests/native-policy.test.ts`、`tests/fixture-integration.test.ts`、storage smoke | 本番C# close policy→`window-close-v1`→Main/Core→SQLite/保存後通知/両ページ。確認取消・遅延・対象不一致・再配送・停止/障害/retryと、[手動試験の範囲](window-close.md)を区別 |

全件のunit/native、build、各smokeの実行方法は[開発・検証ガイド](development.md#development-workflow)。CIの`windows-quality`は通常版と同梱版でstorage/comparison/settings/activation/migrationを含む既存smokeを実行する。

## 証拠と再実行

CIのfixture artifactには実行ログと自アプリ画像だけを保存する。buildの照合用SHA-256は同じjobで生成する`build-hashes.json`を参照する。
commit SHAとhashが一致する生成物の実行結果を対応づけ、以前の結果を新しいbuildの合格へ流用しない。
`fixture-integration.test.ts`のNotification生成/OSイベントだけはfakeで、入力はすべて人工。通常userDataや実入力を使わない。

#44はOS通知登録/実click/cold起動、#45はdisk/Worker物理故障と移行保全、#46はFigma/DPI/窓の視覚・実操作、#47は自然入力精度を判定する。
基盤段階のfixture結果で自然入力・旧protocol撤去・最終V04を代替しない。実検出器を接続した最終build/hashで同じfixture全経路を#47にて再実行する。
