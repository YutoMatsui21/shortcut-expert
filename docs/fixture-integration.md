# #43 先行fixture統合の検証範囲

#43の12操作全経路受入は**未完了**。現行CoreはW02/W03/W04/W05/W11の5操作だけを採用する。
W01/W06/W07/W08/W10/W12/W13はCoreの採用契約が未実装であり、DBへの直接投入や判定器のfakeで通過扱いにしない。
検出器Issueの完了を着手条件に追加するものではなく、現行実装と#43の受入条件の差を示す。

## 本番経路と試験

| 契約 | 試験入口 | 通る経路・限界 |
| --- | --- | --- |
| 既存5操作×mouse/key×3状態 | `tests/fixture-integration.test.ts` | 人工v2 JSON→Main厳格parse→DurableCoach判定→実SQLite Worker→再open。両ページ用モデルと3filter、学習中だけ通知adapter発行、重送非採用を確認。React/Preload/helperはこの試験の対象外 |
| 12行・2ページ・限定IPC・停止/再開・終了 | 通常smoke、`--storage` | 本番Electron/Preload/Reactとfixture helper。通常smokeは旧JSON/独自通知、storageはSQLite/標準通知adapter。12行表示を12操作採用の証拠にしない |
| J01比較・警告 | `--comparison`、`tests/records-query.test.ts` | 隔離した取得済み記録/coverageによる比較と警告。投入したcountsはparse/Core採用の証拠ではない |
| J02保存後発行・障害後非再送 | 上記結合試験、`tests/durable-storage.test.ts`、`tests/standard-notification.test.ts`、storage smoke | 実Worker保存後のadapter、保存/ACK障害の再試行と再起動、OSイベントfake。物理disk故障の合格ではない |
| J03人工activation | `--activation`、`tests/notification-*.test.ts` | cold/稼働中/初期化失敗の人工callback。実COM/OS通知clickではない |
| 削除/再試行・不正IPC・世代・時計 | `--settings`、`tests/delete-*.test.ts`、`tests/coach-ipc.test.ts`、`tests/observer.test.ts`、`tests/protocol-v2.test.ts`、`tests/durable-storage.test.ts` | 取消/確定、保存障害、世代/transaction/版混在、時計後退。各試験が隔離する境界は個別ソースに記載 |
| Native既存5操作 | `npm.cmd run test:native` | 本番C# policy/通信→TS契約、fixture helperの開始/停止。残る7操作のNative結合は未通過 |

全件のunit/native、build、各smokeの実行方法は[README](../README.md#開発確認)。CIの`windows-quality`は通常版と同梱版でstorage/comparison/settings/activation/migrationを含む既存smokeを実行する。

## 証拠と再実行

CIのfixture artifactには実行ログと自アプリ画像だけを保存する。buildの照合用SHA-256は同じjobで生成する`build-hashes.json`を参照する。
commit SHAとhashが一致する生成物の実行結果を対応づけ、以前の結果を新しいbuildの合格へ流用しない。
`fixture-integration.test.ts`のNotification生成/OSイベントだけはfakeで、入力はすべて人工。通常userDataや実入力を使わない。

#44はOS通知登録/実click/cold起動、#45はdisk/Worker物理故障と移行保全、#46はFigma/DPI/窓の視覚・実操作、#47は自然入力精度を判定する。
基盤段階のfixture結果で自然入力・旧protocol撤去・最終V04を代替しない。実検出器を接続した最終build/hashで同じfixture全経路を#47にて再実行する。
