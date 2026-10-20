# 新規利用者の日別保存（#15 / T13）

2026-10-19。#10で採用したElectron同梱`node:sqlite`、専用Worker、単一writer、WAL / synchronous=FULLを製品経路へ接続した。検出器の自然入力精度・旧JSON移行・新しい分析画面の受入とは別の変更である。

## 保存先と責務

- `selectRepository`はCoach初期化より先にSQLiteを選ぶ。#16ではWorker起動時に旧JSONの全日分を[原本保護・全行照合して移行](json-migration.md)する。JsonRepositoryと旧Coachは明示した隔離回帰試験だけで使用する。
- 空のuserDataでは`records-v1/`にSQLiteを作り、DurableCoachを使用する。既に同ディレクトリがあれば常にそちらを選び、DB欠落・破損・未来版でもJSONへ戻らない。通常データとfixtureのuserDataは既存の起動時分離を維持する。
- MainのSqliteRepositoryが要求ID・queue・プロセス固有writeSession・接続寿命を所有する。保存ディレクトリごとのOS管理named pipeでwriterを排他し、プロセス異常終了時はOSが解放する。pipeは受信した接続を閉じるだけで、記録の送受信には使わない。
- StorageStoreはWorker内だけでSQLiteを開く。schema transaction、日別加算、coverage、時計高水位、recordEpoch、直近checkpointを担当する。Workerと共通chunkをASARからunpackする。
- CoreはSQL・FS・Electronへ依存しない。日付・世代・未保存差分・coverage用monotonic間隔・再試行を制御する。JSON経路のCoreは移行Issueまで残す。

## transactionと保持

全日分をdiskへ保持し、自動削除しない。Core/Snapshotは今日を含む最大60日だけを読む。過去日の表示は限定bridgeの`getRecords(from,to)`から最大60暦日の範囲でqueryし、indexedな日付keyで取得する。全履歴をMain/Core/Rendererへ転送して上書きしない。UIは任意の過去日を選択できる。

1回のrecord transactionに、count差分・日別×操作のknowledge/activeMs/gap/capabilityRevision・最後の正常localDate・revision・writeSession/sequence/hashを含める。前日完了の遅延候補も元の日付へ保存し、その日のcoverageはunknownを保つ。保存するのは集計だけで、操作時刻列・入力列・イベントログを作らない。

checkpointはmetaの1行のみ。正常commitの応答だけが失われた場合、Workerを開き直して同じsession/sequence/payloadを送ると加算せず成功する。同じ識別子の異なる内容・飛んだsequence・旧session・旧epochは拒否する。Nativeのgenerationが再利用されてもMainのsessionとは別になる。新Mainは排他取得後に新sessionをclaimする。

全削除は観測停止→Core queue drain→未確定commitの解決→counts/coverage/legacy_days削除とepoch更新のtransaction。学習状態・opened・normal boundsは保持する。削除自身の応答喪失にも同じcheckpointで対応し、古い候補・古いepochから復活させない。移行の有無にかかわらず同じtransactionで`deletion_cleanup.pending=1`を立て、旧JSON両文書・その`.tmp`・固定staging `migration-v1/`を掃除してから成功を返す。別のmigration backupは作成していない。失敗時は停止・再試行し、再起動時にも観測前にcleanupする。既存の移行metaのpending purgeも引き継ぐ。

削除確認はRendererの440×218 dialogで行う。MainがmainFrameに紐付いた5分有効の単回tokenを発行し、確定時はcontrol queueへ入れる前に消費する。取消・新規確認・hide・navigation・終了で旧tokenを無効化する。確定までは計測を継続し、削除・掃除成功後は元が計測中のときだけ新世代で再開する。失敗時は完了表示せず既存の保存エラー/再試行へ返し、その削除の再試行が成功した場合も元の計測状態へ戻す。先行する未保存writeの解決に失敗した場合も、Coreは削除要求をpendingとして維持し、retryでwrite解決後に削除を完了する。

## coverage・時計・失敗

新規保存契約は初回対象12操作に対応する。現在の11行の旧表示一覧の刷新は別Issueであり、Storageの12操作を検出対応済みと表示する意味ではない。自然入力の能力証明がない本番経路はcapability集合を空にし、稼働量や既知0件へ変換しない。fixtureだけW03へ明示した能力revisionを与える。

観測継続中、同じ日・同じ能力revisionで、連続するmonotonic間隔が0超〜2500msの場合だけactiveMsへ加算する。通知pauseは継続する。全停止・helper故障・suspend・能力不足・長いticker中断・revision変更・日付境界の不確実な間隔は加算しない。2500msは1秒tickerの連続性上限であり、検出精度の保証値ではない。部分日・開始前・中断等のgapを保持する。停止した無操作日は高水位だけ更新し、counts/coverageを生成しない。

起動・候補受理・毎秒tickで高水位とlocalDateを照合する。無操作・停止中でも高水位は永続化し、日付後退または未来日の候補では保存済み記録を削除せず停止する。時計修正後の再開は保存先を再検査する。timezone変更で過去日を再配分しない。

UIは保存済みの数値を表示する。coverage根拠もcountもない操作は「—」とし、取得済みcountをunknownのために隠さない。queryのrevisionとeffect取消で古い返信が新しい選択・削除後の表示を上書きするのを防ぐ。期間比較・欠損infoの正式デザインは後続Issueの範囲。

#22のnormalBoundsだけのsettings保存はReadModelへ影響しないためrevisionを進めない。他のsettings変更と記録transactionのrevision更新は維持する。[窓制御の契約](window-lifecycle.md)。

保存失敗・結果不明は同じ差分をメモリーに残し、観測・通知を停止する。再試行はWorker再接続後に同一transactionを再送し、観測の自動再開や過去通知の再送はしない。DB破損等の読込失敗でも空のDBへ置き換えず、原本を保持する。プロセス終了時に未commitのメモリー分が失われる制約は従来どおり。

## 検証

### PR #57のCI・レビュー修正

最新mainのprotocol v2と結合し、DurableCoachもObserverCandidateを受け取る。世代内のprotocol固定、4096 transaction範囲の重複拒否、採用前の候補複製をJSON経路と揃えた。起動時load失敗では設定を書かず、設定保存成功は設定由来のエラーだけを解除する。読込時にも設定の形式を検査する。

追加レビューでは、SQLite authorityを確認した後は旧JSONへアクセスしないようにし、全削除だけは時計高水位を現在日へ戻して復旧できるようにした。設定変更は保留中の最新値を引き継ぐ。過去日のqueryはエラー解除後に同じrevisionでも再実行し、全停止中のsuspendは故障扱いしない。過去queryの失敗→同一revisionでの再開と、停止後suspendは本番Main/Worker/Reactを通す隔離smokeへ追加した。

停止中のtickは時計確認を継続するが、日付高水位・count・coverageに差分がなければtransactionと配信を省く。保存方式のprobe失敗は原本を保持して再試行/終了のOS dialogを示す。CIには開発版・配布版両方のSQLite smokeを追加した。今後の実装完了条件（push、最新headのCI/Codex確認、必要な修正と再検証）はAGENTS.mdに集約する。

以下の125件等は初回実装時の記録。レビュー修正後の最終確認はPR #57の最新headに対応するCIとCodexレビューで確認する。

2026-10-19、Windows 11 build 26300 / x64で確認。ホストNode 24.11.1、開発版・配布版Electron 44.7.0 / 同梱Node 24.21.0。

| 確認 | 結果 |
| --- | --- |
| `npm.cmd run typecheck` | 成功 |
| `npm.cmd run test:unit` | 125件成功（新規保存12件を含む） |
| `node node_modules/electron-vite/bin/electron-vite.js build` | Main / Worker / Preload / Renderer成功。helperの再buildは今回の実施範囲外 |
| `npm.cmd run package:dir` | 最終のWindows x64配布フォルダー作成成功 |
| 開発版・配布版の`--storage` smoke | 各成功。mouse1/key1、120日前のquery/React表示、保存先再open、範囲外IPC拒否、helper停止を確認 |
| 開発版・配布版の従来JSON smoke | 各成功。既存の設定・停止・削除・再読込・通知・窓・IPCの回帰 |
| `git diff --check` | 成功 |

単一writer試験は同じ保存先を開く二つ目のRepositoryを拒否し、強制終了試験は隔離Main子プロセスを終了した後の再取得を確認した。ACK喪失は本番Workerのcommit後に外部境界で応答を失わせ、実Worker再接続後の同一差分retryで非重複を確認した。物理I/O故障や停電の代用とは扱わない。

再現コマンドはREADMEの開発確認を参照。`tests/durable-storage.test.ts`は実SQLite/本番Worker/Coreを使い、保持・再読込・稼働量・無操作高水位・未来日・単一writer・応答喪失再接続・epoch・session・削除・rollback・Main異常終了・原本保護を確認する。SQL triggerのRAISE(ABORT)はtransactionの故障注入であり、物理disk fullの実測とは呼ばない。

`node scripts/smoke.mjs --storage`は空の隔離userDataから、本番helperのfixture候補→判定→Workerのdisk commit→bridge→Reactのmouse/key表示、120日前の記録のqueryと画面表示、同じ保存先を開き直した保持を確認する。`--packaged --storage`は同じ試験を配布exeで実行する。再読込は保存Worker/Coreの再生成で、OSからの通常アプリ起動とは区別する。従来のsmokeは明示的な隔離JSONで既存経路の回帰を維持する。

本変更では実入力・UIA追加観測・キー送出・通常userDataの読書きを行わない。helperソースは変更せず既存の同梱artifactを使用した。実ボリューム枯渇・WAL同期中の物理I/O故障・停電・OS crash・NSIS導入は今回の検証外。#10の技術検証を新製品の全故障条件の実測へ読み替えない。保存中断時の安全性は上記の試験条件内で確認する。
