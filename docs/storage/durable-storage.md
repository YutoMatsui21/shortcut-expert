# SQLiteの永続保存・障害復旧

**責務**：操作回数と観測範囲を失わず保存し、再送・故障・再起動で**二重加算や空データへの置換を起こさない**。[製品要件](../ui-requirements.md)、[移行](json-migration.md)、[履歴削除](history-deletion.md)を参照。

## 1. 保存先と責務

| 層 | 所有するもの |
| --- | --- |
| Main `SqliteRepository` | 保存先の選択、専用Worker・要求ID・直列queue・書込sessionの寿命・接続 |
| Worker `StorageStore` | SQLite接続、schema、transaction、日別件数、coverage、checkpoint、epoch |
| Core `DurableCoach` | 採用候補の世代、未確定差分、観測間隔・日付・再試行 |
| Renderer | 限定IPCから得た集計・確定状態だけを表示。SQL・DB path・全履歴への直接アクセスなし |

- 通常起動は`records-v1/`のSQLiteをauthorityとする。初回のみ作成／旧JSONから[安全に移行](json-migration.md)。**既存のauthorityが欠落・破損・未知版でもJSONや空DBへfallbackしない**。旧JSON writerは持たず、移行用の厳格なreaderだけを保持する。
- SQLiteはElectron同梱`node:sqlite`、専用Workerの**単一writer接続、WAL・`synchronous=FULL`**を使用。Workerと必要chunkをASARからunpackし、DBはASAR外へ置く。保存root単位のOS named pipeで複数writerを排他し、pipeへ記録を流さない。
- 日別の集計は**自動削除せず全期間を保持**。画面向けの有界queryは最大60暦日（直近7／30日と比較対象を含む）。全履歴をRendererへ転送しない。
- 保存可能な旧操作IDと**現行UIの8操作**は別概念。旧IDは移行・互換のため保持し、表示対象や「検出可能」の判定へ自動追加しない。

## 2. transactionと冪等な再送

1回の記録transactionで、操作別・日別`mouse/key`差分、coverage、正常`localDate`、`revision`、`writeSession/sequence/payload hash`、再送判定用checkpointを**一緒に確定**する。元の日付が確定している遅延入力はその日に記録し、観測が不明な時間を既知扱いしない。

- **COMMIT後だけACK**。応答が失われた場合は**同じsession・sequence・payload**を再送し、checkpointによって加算済みを再加算しない。内容違い・sequence飛び・古いsession／epochは拒否する。別IDでの再送は冪等性の保証外。
- Mainの新しい起動はwriter排他取得後に新sessionをclaimする。Nativeのgenerationとは別に管理する。保存・読戻しエラーでは原本を残し、未確定差分を同じIDのまま保留する。**プロセス強制終了時の未commitメモリ差分は復元保証しない**。
- 保存には操作の集計・必要な観測metadataのみを含め、入力キー列・操作時刻列・HWND・アプリ名・座標履歴は保存しない。
- **複合gesture（[検出契約](../operations/compound-drag.md)）**：同一ドラッグでW02＋W03／W07が独立成立したら、異なる2操作IDを**同じtransactionで原子的に各+1**、同一操作IDは重複加算なし、ACK喪失時は全体を冪等再送する。`RecordMutation.counts`の2件を同じcheckpointに含める。保存するのは日付・操作ID・由来だけで、Nativeの相関情報は含めない。

## 3. coverageと時計の扱い

- `counts`と`coverage`は区別する。**件数の根拠なし＝未観測**、観測済みの0回＝既知0回。取得済み件数はcoverage不足を理由に非表示へ変えない。表示上の集計・欠損判定は[記録画面](../features/records-ui.md)が担当する。
- capabilityが実証されない経路は未知のまま。連続した`monotonic`間隔が**0超〜2500ms**かつ同日・同じ能力revision・観測継続中のときだけ`activeMs`へ加算する。停止／suspend／helper異常、長い空白、能力変更や日付境界の不確実な時間は既知時間にしない。部分日・停止・gapを保持する。
- 起動・候補受理・毎秒tickでローカル日付と**時計の高水位**を検査。無操作・停止中も時計を監視し、日付後退／未来日候補では既存記録を消さず安全停止する。timezone変更に応じた過去の集計日付の再配分は行わない。
- `normalBounds`だけのsettings変更は記録ReadModelの`revision`を進めない。学習状態等と記録変更は通常どおり更新する。[窓の設計](../features/window-lifecycle.md)。
- `settings.recordingEnabled`は明示的な計測停止／再開の希望値。未設定の旧データは開始許可として扱い、falseなら起動時も停止する。通知pauseは永続化しない。停止は即時、再開は設定保存成功・故障解消後のみ。削除・窓位置・学習設定の保存でも保持する。

## 4. 失敗・停止・復旧

| 状況 | 守る条件 |
| --- | --- |
| 保存／応答不明 | 未確定差分を保持、観測・通知を停止。再接続後に**同一ID**で再試行 |
| DB読込失敗・破損 | 原本を保持して失敗を示す。空DB作成・旧JSONへのfallback禁止 |
| 保存保留中の開始要求 | 新しい観測の開始を拒否し、明示的な再開前に未保存を解決 |
| 保存再試行成功 | 旧通知は再発行しない。**自動では計測再開しない** |
| observer／時計の別故障 | 保存の回復と独立に故障状態を保持。保存成功だけで解除しない |
| 削除の失敗 | [履歴削除](history-deletion.md)に従いpending purgeと世代を保持 |

- `errorKind`は記録保存・設定保存・読込・時計・observerを区別。保留記録・最新設定を先に確定し、残る読込故障を再検査する。Mainからの再読込やRendererの古い非同期応答によって確定データを巻き戻さない。
- 両画面の保存エラーバナー・retryは[設定パネル](../features/settings-panel.md)／[UI要件](../ui-requirements.md)に従う。再試行可能な保存障害が復旧しても、observer／時計による停止を消さない。

## 5. 検証と保証の限界

- `tests/durable-storage.test.ts`、`tests/repository-faults.test.ts`等：本番Worker／SQLite・checkpoint・WAL、rollback・ACK喪失・再接続・再起動・単一writer・時計／coverage・エラーの競合と原本保持。
- 隔離`node scripts/test/smoke.mjs --storage`：人工helper候補→実SQLite→IPC→React、古い日の有界queryと再open、保存エラー／再試行。配布版は`--packaged --storage`。
- **配布版受入の実施範囲・未確認項目**は[V02検証記録](https://github.com/YutoMatsui21/shortcut-expert/issues/45)を参照。SQLiteのpage制限・SQL注入・プロセス強制終了は、**実ボリューム枯渇・OS crash・停電・SSD故障の再現ではない**。
