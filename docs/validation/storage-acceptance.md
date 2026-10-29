# V02 保存・移行の基盤配布版受入（#45）

## 入口と範囲

`npm.cmd run acceptance:storage`は製品exeを`ELECTRON_RUN_AS_NODE=1`で起動し、ASAR内の受入entryから製品と共有するRepository・Core・Storeを読み込む。Workerは製品の`app.asar.unpacked/out/main/storage-worker.cjs`を使用する。#10の独立probeやmemory DBではない。UI・helper・hook・通知・通常userDataは使わない。

毎回`.tools/validation/v02-*`へ合成旧JSON・実disk DB・結果を作る。起動前に`out/main`全体とASAR、unpackしたWorker/chunkのSHA-256を照合し、不一致は拒否する。実Electron版もpackage.jsonと照合する。

```powershell
npm.cmd run build
npm.cmd run package:dir -- --config.directories.output=release/issue-45 --config.electronDist=node_modules/electron/dist
npm.cmd run acceptance:storage -- --package-dir=release/issue-45/win-unpacked
node scripts/smoke.mjs --packaged --storage --package-dir release/issue-45
node scripts/smoke.mjs --packaged --migration --package-dir release/issue-45
```

受入runnerの`--package-dir`はexeのあるdirectory、既存smokeではその親。成功にはexit 0と`V02_SUITE_OK`の両方が必要。`results.json`にruntime・各assert結果、`build.json`に実行時commit・配布物/全Main module/試験scriptのhash、`runtime.log`に出力を保存する。CIは同じ製品packageで実行し、これらの診断だけを3日保存する。

## 受入条件との対応

| 契約 | 配布版で通す検証 |
| --- | --- |
| open/write/reopen・旧履歴 | 全日/全row/空日/coverage/全14状態/opened、30日外保持、再接続非加算、原本2文書bytes一致 |
| rollback | coverageのSQL triggerで実transactionを中止。counts/coverage/checkpoint/設定を保持し、同一sequence retryは1回だけ反映 |
| lock・同時writer | 別Repositoryの同一root取得を拒否。外部SQLite接続のBEGIN IMMEDIATE中もcommit失敗→解放→retry |
| ACK喪失・fence | 製品Workerのcommit成功messageをMain境界で落として終了。unknown→再接続→同じwriteSession/sequence/payloadを非重複で再送。異payload/sequence飛び/旧session/旧epochを拒否。reset再送もepoch不変 |
| 強制中断 | 専用Main相当processをcommit後にkillし、OS writer所有権解放と再読込。実SQLiteの未commit更新を持つ補助Workerも終了し、製品Workerから元の値を再読込 |
| staging・authority | schema作成後/移行commit後・rename前で専用processをkillして再開。総和だけ同じrow改変stageはactivation拒否。active DBの未知schema/破損/欠落でも旧JSONへ戻らず原本保全 |
| dir/fixture | active authorityと矛盾する旧JSON/stageを併存させてもauthority採用。別rootは空。通常appのuserData設定を実行しない構造 |
| delete/purge | 原本をdirectoryへ置換してcleanup失敗。件数0でも成功扱いせず起動失敗を確認。障害解消後は原本/tmp/stageを掃除し、全旧日0・settings保持・epoch=2・再起動後0 |
| disk full | 実SQLite接続のpage上限とfixtureの1MiB割当で`SQLITE_FULL`（errcode=13）。Storeでrollbackを照合し、SQLite constructor境界で上限だけ注入したbootstrapから未変更の製品Workerも実行。commit失敗→count/coverage不変→制限なし再接続→同一差分非重複 |
| 権限 | 専用fixtureだけに現在accountのdeny-write ACLを設定。Worker open失敗を確認し、finallyでACL復元後にDB bytes/値を照合 |
| pending/error・Native世代 | bundled CoreのWorker終了→pending/record-save/停止、start拒否、retry連打の単回反映と停止保持。新Repository/Coreでgeneration=1/sequence=1を再利用し新入力を各1回記録。削除前世代は不採用 |

## 2026-10-21の結果

Windows 11 build 26340 / x64、ホストNode 24.11.1、製品Electron 44.7.0 / 同梱Node 24.21.0。`release/issue-45/win-unpacked`で17項目成功、証拠は`.tools/validation/v02-nC6pHi/`。関連unit（durable-storage/storage-migration/storage-migration-files/delete-purge）は44件成功。build/typecheck成功。同じ配布物のstorage smokeも成功し、製品Main→Worker→IPC→Reactと120日前保持・再openを確認した。packaged migration smokeも完全再起動を含む2回とも成功した。

| 成果物 | SHA-256 |
| --- | --- |
| app.asar | `3ea97db611bec9041dd7904018e5c207dbfb0d9c2ddaf748d38d0fb979952437` |
| exe | `41082aae37a14f1eab5f76c4b57e93559c2f012466297b4988af5ffce728686e` |
| unpacked Worker | `8bab1744b90476965119af46ff2a58e30372aa4916cfd98dd3653d54fa7f56c8` |

初回ACL試験はdeny中のDB読取で試験側が失敗した。照合をACL復元後へ移し、最終17項目で成功。sandboxのElectron crashpad登録にはアクセス拒否の診断が出たが、assert/exit/markerは成功した。UI smokeは専用配布directoryにsandbox読取ACLを付けて通常権限環境で実行した。

## 未試験と後続

`SQLITE_FULL`は実エラーとrollback/retryの試験であり、実ボリューム全体の空き容量を0にした試験ではない。物理I/O故障・電源断・OS crash・NSIS旧→新更新・SSD物理消去は未試験。中断は明示したschema/commit境界であり、任意のfsync/rename途中の停電を保証しない。

本証拠は検出器実装前の基盤版。V02全体の最終合格・初回公開を17項目だけで宣言しない。実ボリューム枯渇等を含む残る実機審査は#45に残し、最終検出器buildでは#47で影響経路を再実行する。通知非再送のOS経路は#44、error外観/focusは#46、fault状態遷移の全経路回帰は#43、自然入力は#47で判定する。
