# SQLite保存方式の技術検証（#10 / V02）

2026-10-18。対象は[Issue #10](https://github.com/YutoMatsui21/shortcut-expert/issues/10)。製品Storageの導入は #15 / #16 で扱い、この変更は隔離probeだけを追加する。通常のJSON保存・Renderer・Preload・Native helperは変更しない。

## 判断と引継ぎ

**Electron同梱の`node:sqlite` + 専用Workerの単一接続 + WAL / synchronous=FULLを採用する。** 固定版のWindows x64配布exeでディスク保存・再起動・故障・移行・期間読込が成立したため、#15の保存実装へ進める。外部SQLiteバインディングや別DBの導入は不要。これは保存方式の成立確認で、製品の移行完了や公開合格ではない。

- MainがWorkerと要求IDを所有し、Worker内でSQLiteを同期・直列実行する。Workerは明示的にASARからunpackし、DBをASAR外の書込領域に置く。RendererへDBパス・SQL・汎用ファイルAPIを公開しない。
- `generation + writeId + payload`の照合、集計加算、ledger挿入を同じtransactionに置き、COMMIT後だけ成功応答する。再送は**同じID・同じ差分**を使う。同じIDで異なる内容、旧世代の遅延要求は拒否する。削除・世代更新もtransactionで行う。新IDでの再送は二重加算を防げないため、#15で保留要求の寿命と再起動時の扱いを定義する。未確定のメモリ上の入力の救済は保証しない。
- ledgerは集計の書込メタデータだけで、入力ログ・窓ID・タイトルを記録しない。ledger削除は再送防止の根拠を失わせるため、保存期間を短くしない。製品でのサイズ管理・観測期間・設定を含むschemaは#15/#16で定義する。
- 既存JSONを上書きせず、別DBへコピーする。日付集合（空の操作日も含む）・全操作のmouse/key・全設定・原本SHA-256を照合し、DBを閉じて再読込してから切替pointerを一時ファイル同期→renameで確定する。旧W09の履歴とmuteも保全する。新12操作の状態はmuted→対象外、その他→学習中。習得済みや過去の観測期間を推定しない。
- 製品移行では旧保存queueを止め、単一起動lockを保持したまま2ファイルを読む。probeの直前bytes再照合は、旧プロセスが照合後に書く競合を排除できない。既存移行先の破損・未知schema・原本不一致は上書きせず停止する。変更された原本との自動マージはしない。
- 起動時・移行前にschemaと整合性を確認する。失敗を空DBへ置換しない。WAL運用中のDB本体だけのコピーをバックアップとしない。破損の自動修復、利用者の保存再試行UI、実userDataへの切替は後続Issueで実装する。

## 配布版での実測

Windows `10.0.26300` / x64、Electron **44.7.0**、同梱Node **24.21.0**、実測SQLite **3.53.4**、electron-builder **26.15.3**。ASAR内のmainからunpackされたWorkerを起動し、全件`app.isPackaged=true`を照合。独立した無署名probe exeであり、既存アプリの同梱helperやUIは起動しない。通常製品と同じ固定Electron・packager・ASAR・Windows x64を使う。NSIS導入や署名は対象外。

最終配布版実行：**2026-10-18 23:57:12〜23:57:48 JST、15シナリオ成功**。原本は`.tools/validation/sqlite-qazV1A/report.json`。最終開発版も同じ15シナリオが成功し、原本は`.tools/validation/sqlite-dITpYM/report.json`。既存unitテスト113件・型検査・probeの構文確認・diffの空白検査も成功。製品経路は変更しないため、helper/native試験・通常UI smokeは今回実行していない。各ソースSHA-256・ASAR SHA-256・runtime・結果を記録し、実行前に配布物内のソース一致を検証する。生成exe・DB・ログはGit対象外で再生成できる。

| 確認した条件 | 結果 |
| --- | --- |
| Worker内64書込→別プロセスで再読込 | mouse=2016 / key=64、WAL / FULL=2、integrity=ok |
| 同じ書込の再送・ID内容衝突・世代更新 | 重複は加算なし、内容違いと旧世代は拒否、新世代だけ1回加算 |
| transaction更新後・COMMIT前に強制終了 | 既確定mouse=1を保持、再送で2。未確定ledgerも残らない |
| COMMIT後・応答前に強制終了 | 再起動でmouse=2、再送後も2。DB・WALを元の場所から再読込 |
| Worker停止点でMainの応答性 | Workerが待機中でもMain heartbeatが進む |
| max_page_countによる実SQLite容量エラー | SQLITE_FULL=13、途中の集計・ledgerをrollback、上限解除後の再送成功 |
| Windows read-only属性 | SQLITE_READONLY=8、属性復旧後に未保存IDで再送成功 |
| fixture DBへのNTFS書込拒否ACL | SQLITE_CANTOPEN=14、ACL復旧後に原本bytes一致、再送成功。ACLはfinallyで解除 |
| DBヘッダー破壊・内部B-treeページ破壊 | NOTADB=26 / quick_checkでpage 2のcode 11、両方とも原本bytes保持 |
| 将来DB schemaVersion=99 | 拒否し、原本bytes保持 |
| 10年分3,653日→指定7日読込 | 全日保持、指定した7行だけ返却。EXPLAINはday主キーのindex SEARCH |
| JSON全件移行・再実行 | 400日/807操作行、旧11操作・空日・0件・W09・mute/opened保持、両JSON bytes一致、再取込なし |
| 移行transaction途中・切替前・切替後に強制終了 | 3停止点それぞれ再実行で807行へ復旧。部分移行の切替なし |
| 切替直前に原本を変更 | 切替拒否、次回もhash不一致で停止、既存移行DBを上書きしない |
| JSON破損・将来counts/settings・不正操作/日付/負数・移行先DB破損 | 空DB化や切替をせず、原本を保持 |

長期fixtureは1日1操作で3,653行。7日読込はプロセス起動・整合性確認を含み437msだった。製品の大量データ・UI応答速度の保証ではない。

## 未確認事項と検証時の修正

実ボリュームの容量枯渇、WAL同期時のI/O障害、停電・OS crash・記憶装置故障は未確認。FULLはSQLiteページ上限による故障、強制終了はElectron親プロセスの終了であり、これらを停電試験と同一視しない。故障ディスクからの救済を保証しない。製品userData・並行する旧版との移行・NSIS・通常UIとの結合は#15以降で確認する。

初期probeはElectronのready前にWorkerを動かし、早期終了時に断続的なaccess violationを起こした。`whenReady`後に開始し、Workerのexitを待って終了する構成へ変更し、描画不要のprobeではhardware accelerationを無効化した。以後の最終開発版・最終配布版は各15シナリオ成功。製品の既存起動コードは変更していない。NTFS拒否中は試験側のreadFileも失敗するため、ACLを戻した後に原本を照合するよう試験を修正。内部ページ破損は例外codeではなくquick_checkの結果として返る場合もあるため、その実結果を照合する。

## 一次資料

2026-10-18確認。以下の「設計への適用」は資料から導いた判断であり、上記の実測結果と区別する。

## ElectronとWorker

- 固定版Electron 44.7.0はNode.js 24.21.0を同梱する。[Electronリリース](https://releases.electronjs.org/release/v44.7.0)
- Node 24.21.0の`node:sqlite`は追加フラグ不要、安定度はRelease candidate。`DatabaseSync`の処理は同期式で、`readOnly`・busy待機`timeout`・トランザクション状態`isTransaction`を提供する。設計への適用：mainが管理する専用Worker内で接続を開き、直列処理する。ホストNodeでの成功からElectron内の利用可否を推定せず、配布exeのWorker内でもimport・SQL・再起動後の読込を実測する。[Node 24.21.0 SQLite](https://nodejs.org/download/release/v24.21.0/docs/api/sqlite.html)
- NodeのWorkerエントリは絶対パスまたは規定の相対パス／URLで指定する。ASARは読取専用で、仮想ディレクトリをcwdにできない。設計への適用：Workerを明示的にunpackして実在パスから起動し、DBはASAR外の隔離した書込可能領域へ置く。この構成での実行可否は配布probeで確認する。[Node Worker](https://nodejs.org/download/release/v24.21.0/docs/api/worker_threads.html#new-workerfilename-options)、[Electron ASAR](https://www.electronjs.org/docs/latest/tutorial/asar-archives)

## WALと確定の意味

`journal_mode=WAL`は返り値が`wal`か確認する。WALでは`-wal`も永続状態の一部で、開いているDBの本体だけをコピーしてバックアップと扱えない。SQLite公式は複数接続の同時write/checkpointに関わるWAL-reset bugを記載しており、修正版は3.51.3以降、バックポートは3.44.6 / 3.50.7。設計への適用：`sqlite_version()`を実測ログに残し、単一Writer接続を基本にする。[SQLite WAL](https://www.sqlite.org/wal.html)

WAL + `synchronous=FULL`はcommitごとにWALを同期する。NORMALは停電・OS crashで確定済みtransactionが戻る可能性がある。設計への適用：FULLを明示し値`2`を照合し、COMMIT成功後のみACKする。[SQLite synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous)

この耐久性はOS／記憶装置が同期要求を正しく実装する前提。プロセス強制終了試験は停電・OS crash・装置故障の証明にはならない。[SQLite syncの限界](https://www.sqlite.org/howtocorrupt.html#failure_to_sync)

## 書込失敗と再試行

`SQLITE_FULL`はDB本体だけでなく一時ファイルへの書込でも起こる。READONLYは書込権限のない接続での変更、CORRUPTは破損、NOTADBはDBとして認識できない状態を表す。設計への適用：失敗を正常な空集計へ変換せず、原本を残して明示的に失敗を返す。[SQLite結果コード](https://www.sqlite.org/rescode.html)

FULL／IOERRなどでは、失敗した文だけ戻る場合とtransaction全体が戻る場合がある。設計への適用：例外時は`isTransaction`を確認してROLLBACKし、ACKしない。別接続で再読込して直前の確定済み値と照合する。[SQLite transactionエラー](https://www.sqlite.org/lang_transaction.html#response_to_errors_within_a_transaction)

`max_page_count`はDBページ数の上限。設計への適用：隔離fixtureでFULL経路を再現する補助手段にするが、実ボリューム枯渇・WAL同期失敗の検証とは区別する。[SQLite max_page_count](https://www.sqlite.org/pragma.html#pragma_max_page_count)

## 二重加算防止と世代

SQLiteは一意制約を提供するが、通常のPRIMARY KEY／UNIQUEではNULLが重複防止をすり抜ける場合がある。設計への適用：write IDとgenerationにNOT NULL制約を付け、一意な組をledgerへ記録する。ledger挿入・日別操作別加算・世代照合を同じtransactionに置き、commit後のACK消失再送はledger照合で処理する。同じIDで内容が違う再送は成功としない。[SQLite制約](https://www.sqlite.org/lang_createtable.html#the_primary_key)

これはアプリ側の設計案でありSQLite単体のexactly-once機能ではない。リセットによる世代更新も同じDBで直列化し、旧世代の遅延writeを拒否する必要がある。未commit／未送信のメモリ上の差分は回復保証の対象にできない。ledgerを削除すると、そのIDの再送を識別する根拠も失う。

## JSON移行と原本bytes

Nodeの`copyFile`は既定で宛先を上書きし、コピー全体の原子性を保証しない。`COPYFILE_EXCL`は既存宛先を拒否する。設計への適用：旧JSONをBufferのまま保持し、別領域で全件移行・再読込照合してから切替える。JSON parse/stringifyで原本を作り直さず、空白・改行・BOMを含むbytesの一致を独立に比較する。[Node copyFile](https://nodejs.org/download/release/v24.21.0/docs/api/fs.html#fspromisescopyfilesrc-dest-mode)

切替はDB transactionと別ファイルの同時原子更新だと仮定しない。中断点ごとに再実行し、再取込の二重加算、部分移行の採用、既存の破損／未知futureの上書きを防ぐ。原本保護の判定は破壊的初期化より先に行う。これらはprobeで検証する移行手順の要件であり、本資料だけで安全性が確認できたことにはならない。
