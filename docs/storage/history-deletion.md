# 利用記録の全削除

**責務**：利用者の明示確認後に記録を論理的に削除し、遅延書込・再起動・旧JSONからの**記録の復活を防ぐ**。確認画面は[製品要件](../ui-requirements.md)と[Figma](https://www.figma.com/design/mMfK6fQQzfhUqRHR7jsGne?node-id=349-2534)を正本とする。

## 1. 確認から削除まで

1. 設定から`DeleteDialog`を開き、キャンセル初期focus、Tab／Shift+Tabのfocus循環・Esc取消・二重確定防止を提供する。
2. `requestDelete()`でMainが**mainFrameに紐付いたUUID token**を発行（5分・1回限り）。再確認／取消／hide／navigation／終了で無効化し、`deleteCounts(token)`はsender・引数・tokenを検査して**control queue投入前に消費**する。
3. 確定までは計測を続け、実行時は観測停止・旧世代無効化→Core queueと先行の未確定保存解決→削除transactionへ進む。
4. **同じtransaction**で`counts / coverage / legacy_days`を削除し、`recordEpoch`とpending cleanupを更新。旧JSONの2文書・`.tmp`・固定`migration-v1/`を掃除し、完了meta保存後にのみ成功応答する。
5. 元が計測中なら**新世代**で再開し、元から停止中なら停止を維持する。古いepochの遅延要求は受け付けない。

## 2. 保持する情報と失敗時の扱い

| 保持・削除 | 内容                                                        |
| ---------- | ----------------------------------------------------------- |
| 削除する   | 操作回数・coverage・旧移行日付と残存旧JSON／staging         |
| 保持する   | 学習状態、`opened`、`normalBounds`、移行済みsource identity |
| 保証しない | 物理SSDの完全消去・復元不能化。別のbackupを自動生成しない   |

- 先行する保存が失敗したら削除要求を**pendingとして保持**し、保存解決後に削除する。削除自体の掃除が失敗した場合も**成功と表示しない**。保存エラーで停止し、同一要求の再試行または次の起動時に掃除を完了する。
- 削除後のACK喪失でもcheckpointと更新済みepochで**二重削除・旧データ復活を防ぐ**。cleanupの完了が確認できるまで観測を始めない。復旧成功時は削除実行前の計測状態へ戻す。
- authorityが存在するときは残った旧JSONを**再importしない**。論理的な削除の原子性と、記憶媒体からの物理消去は区別する。[保存・再送の詳細](durable-storage.md)。

## 3. 検証と限界

- `tests/app/ipc/history-delete-confirmation.test.ts`、`tests/storage/usage-history-deletion.test.ts`、`tests/storage/durable-write-recovery.test.ts`：tokenの期限・単回性とframe制限、並行保存・失敗・再試行、epoch更新・旧書込拒否、設定保持と移行原本の掃除。
- 隔離`node scripts/test/smoke.mjs --settings`（配布版は`--packaged --settings`）：実Main／Preload／React／SQLiteのfocus・取消・確定・失敗復旧を確認。
- V02の配布物受入・未確認の物理障害は[検証記録](https://github.com/YutoMatsui21/shortcut-expert/issues/45)。人工入力・SQLiteエラーの注入・画面smokeだけで自然入力精度／実OS障害／SSD物理消去を保証しない。
