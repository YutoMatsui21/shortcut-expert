# 保存・移行・削除の設計

ここには、**利用記録を失わず、一貫して扱うための永続化契約**だけを記す。画面・操作の製品要件は[製品要件](../ui-requirements.md)、全体の責務分担は[設計](../design.md)が正本。

| 文書 | 扱う内容 |
| --- | --- |
| [SQLiteの永続保存](durable-storage.md) | 保存先、日別集計、coverage、冪等な再送、時計・障害復旧 |
| [旧JSONからの移行](json-migration.md) | 原本保護、staging・全行照合、authority切替と再取り込み防止 |
| [利用記録の全削除](history-deletion.md) | 確認token、削除とepoch、cleanup・失敗時の復旧 |

**設計と証拠は分ける**：採用方式のprobeは[技術検証](../research/sqlite-storage-validation.md)、同梱製品のV02受入と未試験条件は[配布版受入](../validation/storage-acceptance.md)。個別のIssue・PRの実行履歴はここへコピーしない。

初回公開の画面は**8操作**だが、SQLiteは互換性のため旧IDの記録も保持する。保存可能なID集合を画面対象・検出可能操作と混同しない。
