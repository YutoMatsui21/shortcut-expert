# SQLite保存方式を採用した理由

**いつ読むか**：保存が壊れる／遅い、保存ライブラリを変更する、移行・故障耐性の前提を見直すとき。現行実装の契約は[永続保存](../storage/durable-storage.md)と[JSON移行](../storage/json-migration.md)。ここは**採用判断の根拠**であり、現行の実装状態やV02の合格証明ではない。

## 1. 判断と比較軸

**採用**：Electron同梱Nodeの`node:sqlite`を**専用Worker内の単一SQLite writer**から使用し、`WAL + synchronous=FULL`、commit後のACK、同じID／payloadの冪等再試行を組み合わせる。

| 選択肢・方式 | 研究時の判断 |
| --- | --- |
| 旧JSONへの日別上書き | 実装は単純でも、書込の原子性・ACK喪失・移行時の原本保護を自前で設計する必要がある。新規のauthorityとしては採用しない |
| 外部SQLiteバインディング | Electron配布環境の互換・追加native依存を増やす。固定版同梱`node:sqlite`で配布probeが成立したため採用しなかった |
| Mainスレッドで同期SQLite | 同期DB操作がUI／メッセージ処理を止めるリスクがある。**専用Workerに閉じ込める** |
| WAL／`synchronous=NORMAL` | commit済みの更新が停電等で戻り得る。FULLを選び、正常値`2`を検査する |
| DBに集計のみ保存 | ACK喪失後の再送で二重加算しかねない。**sequence・payload一致とcheckpointを同一transaction**に含める |

## 2. 検証で確認したこと・確認していないこと

2026-10-18〜19、固定Electron 44.7.0／同梱Node 24.21.0・SQLite 3.53.4の**独立配布probe**で最終20シナリオを確認。新規保存・別process読込、WAL/FULL、同一ID再送、commit前／後の中断、`SQLITE_FULL`・READONLY・NTFS ACL、破損・未来版、長期日付query、旧JSONの全行移行・中断復旧が成立した。原本と修正履歴は[#10](https://github.com/YutoMatsui21/shortcut-expert/issues/10)・[PR #55](https://github.com/YutoMatsui21/shortcut-expert/pull/55)。

**保証していないこと**：プロセスkillは停電やOS crashではない。`max_page_count`による`SQLITE_FULL`は物理ボリューム枯渇ではない。WAL運用中の**DB本体だけのコピーはバックアップにならない**。原本はV02配布受入とは異なる独立probeであり、通常利用環境の復旧保証でもない。

## 3. 失敗した場合に再検討すること

- **保存が止まる**：SQLエラー／Worker停止／OS権限／媒体障害を分ける。rollbackと元DBの保持を先に確認し、空DBや旧JSONへ自動fallbackしない。
- **重複が起きる**：writeSession・sequence・epoch・payload hash／checkpointの同一transaction性を確認。新IDでの再送を単純なリトライとみなさない。
- **移行に失敗する**：source bytes、所有marker、全日・全操作行（空日含む）、閉じたDBの再open検証、authority切替順序を追う。総和一致だけで成功とはしない。
- **性能が問題になる**：Worker・query・WAL checkpoint・保存サイズを測り、根拠なく同期方式やdurabilityを弱めない。
- **ランタイム更新**：固定Electron／Node／SQLiteのAPI・SQLiteバージョン・WAL挙動を再確認し、配布版で試験する。

## 4. 一次資料

[Node `node:sqlite`](https://nodejs.org/download/release/v24.21.0/docs/api/sqlite.html)、[Electron ASAR](https://www.electronjs.org/docs/latest/tutorial/asar-archives)、[SQLite WAL](https://www.sqlite.org/wal.html)、[synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous)、[エラーコード](https://www.sqlite.org/rescode.html)、[transaction失敗時の扱い](https://www.sqlite.org/lang_transaction.html#response_to_errors_within_a_transaction)。

配布版の実装と同一Workerを使う現行の再受入条件・結果は[Issue #45](https://github.com/YutoMatsui21/shortcut-expert/issues/45)、最終製品の判断は[#47](https://github.com/YutoMatsui21/shortcut-expert/issues/47)。当時のprobeの成功を新ビルドのPASSへ引き継がない。
