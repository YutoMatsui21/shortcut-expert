# 既存JSONの移行（#16 / T14）

通常起動は旧Coachの剪定を通さず、単一writerを確保した保存Worker内で旧v1文書を検査する。日付・旧W01〜W11・非負安全整数・設定・未知field/版を厳格に検査し、ENOENTだけを既定値へ置換する。原本はbyteのまま残し、存在しなかった文書は作らない。

## 保存と有効化

`migration-v1/`へsource identity（両文書の有無・長さ・bytesのSHA-256、pathや入力列なし）を同期保存する。所有markerがないstage・source変更・読取不能は停止する。counts・各旧rowのlegacy-unknown coverage（activeMs=0/gap=true）・opened・muted→excluded・他全IDのlearning・時計高水位・移行identityをtransactionで取り込む。新操作の過去countや既知0件、masteredは作らない。空の旧日付は高水位には残し、架空の操作rowは作らない。

DBを閉じて再openし、全日×ID×mouse/key、全coverage、全状態、opened、identity/metaを照合する。総和だけで合格にしない。sourceも再照合し、閉じた保存一式を同一ボリュームのdirectory renameで`records-v1/`へ原子的に有効化する。新規保存のauthority markerと初期化保護もそのまま移る。

中断stageは所有identityが一致したときだけ再開する。transaction前なら再取込、commit済みなら全行照合だけを行い加算しない。未知・不一致のstageは空にして再作成しない。activation後は`records-v1/`自体がauthorityであり、JSONへアクセスしない。DB破損・欠落・未来版も再importしない。

W09の旧count/設定はDBへ保持し、通常の一覧・合計から外す。W14のIDは詰め替えず状態をlearningで確保する（旧v1 registryはW01〜W11のみ）。初回12操作の一覧刷新は後続UI Issueの範囲で、今回W12/W13の新しい表示行は追加しない。

## 全削除

件数・coverage削除とepoch更新のtransactionで移行metaをpending purgeにする。続けて旧counts.json/settings.jsonを削除し、完了metaを保存してから応答する。原本削除前にもDBは消費済みauthorityを維持する。cleanup失敗は未保存エラーとして停止し、同じ要求のretryまたは次のWorker起動時に残りを削除する。設定・状態・opened・source消費identityはDBへ残す。stagingはactivation時に移動済みで記録の別backupは作らない。SSDの物理消去は保証しない。

## identityと検証

`electron-builder.yml`のproductName=`Window Shortcut Coach`、appId=`local.window-shortcut-coach`、package name=`window-shortcut-coach`、通常のuserData選択を維持する。配布版はElectronの既存userData、開発版は`.tools/coach-data`、fixtureは起動時に専用userDataへ分離する。名称変更・別dir探索・通常の記録ファイル読取は行わない。

2026-10-19に既存`release/operation-detection/win-unpacked/resources/app.asar`のpackage nameとMain内の`app.getPath('userData')`使用を読み取り、実行時identity=`window-shortcut-coach`と照合した。通常保存フォルダー`%APPDATA%\window-shortcut-coach`の存在もメタデータだけ確認し、従来READMEの`Window Shortcut Coach`（空白あり）は存在せず表記誤りと判明した。通常記録の内容は読まず、移行対象の実保存位置と既存identityを維持する。旧NSISからの更新自体は未確認。

`tests/storage-migration.test.ts`は本番reader/Store/Workerを使い、原本bytes、長期row、状態、coverage、再open、schemaのみ/commit後中断、transaction rollback、総和一致の行改変拒否、source変更、破損/未知版、authority優先、削除後再importなし、purge失敗と再起動復旧を確認する。

`node scripts/smoke.mjs --migration`は隔離旧JSONから起動し、本番Worker→Core→IPC→Reactで古い日の7/5件とW09除外を確認する。同じuserDataで完全終了・再プロセス起動して再確認する。`--packaged --migration`は配布exeで同じ確認を行う。人工fixtureの結果であり、実入力精度・通常userData/旧NSIS更新・停電の証明ではない。
