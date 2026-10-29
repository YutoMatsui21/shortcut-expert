# 旧JSONからSQLiteへの移行

**責務**：既存の利用記録・設定を保全したままSQLiteへ移し、移行途中の中断や再起動でも**二重取り込み・原本の上書き・空データ化**を起こさない。[保存方式](durable-storage.md)を前提とする。

## 1. 移行の前提と原本保護

- 通常起動は保存先を選択して**単一writer排他を取得した後**、Worker内で旧counts／settingsのv1 JSONを厳格検査する。実在暦日、旧操作ID、非負安全整数、設定、未知field・未知schema版を検査し、**ENOENTのみ「未作成」**として扱う。ACL／I/O失敗や不正原本を空値に変換しない。
- 旧JSONは**元のbytesのまま**保持し、欠落していた文書を作成しない。両ファイルの存在有無・長さ・SHA-256（path・キー列なし）で`source identity`を決める。移行中にsourceが変化したら停止する。

## 2. stagingとデータ変換

1. `migration-init-*`にidentityを同期保存し、所有markerのある`migration-v1/`へdirectoryを原子的に公開する。所有markerのないstage・不一致は再初期化せず停止。
2. **ひとつのtransaction**で旧日別件数・全日付（空日を含む`legacy_days`）・状態・時計高水位・移行identityを取り込む。
3. 旧件数のcoverageは**legacy-unknown（`activeMs=0 / gap=true`）**。過去の観測能力・既知0回・習得済みを推定せず、新操作へ旧回数を合算しない。
4. 旧`muted`は`excluded`へ、その他は学習中へ写す。旧W09など対象外の記録もDBへ保全するが、**現行の8操作UIには含めない**。旧IDの再採番はしない。

## 3. 全行照合とauthorityの切替

- DBを**閉じて再open**し、旧日付集合・全日×操作ID×mouse/key・coverage・空日・全状態・`opened`・identity/metaを照合する。**総和の一致だけでは合格にしない**。
- sourceも直前に再照合し、閉じた保存一式を同一ボリュームのdirectory renameで`records-v1/`へ**原子的に有効化**する。移行済みsource markerとDB／初期化情報が食い違えば停止。
- 中断したstageは**同じidentityで所有が確認できる場合のみ**再開する。transaction前なら再取込、commit後なら再照合だけで二重加算しない。既存active DBの`migration`／`legacy_days`欠落、未知版・欠損・破損は空表や空DBへ再作成しない。
- **有効化後はSQLiteが唯一のauthority**。残存JSONへfallback／再importせず、通常起動時に原本を再走査しない。WALを含めDBの一部だけをコピーして安全なバックアップとみなさない。

## 4. 削除と利用者データの場所

全記録の削除では旧JSON・一時`.tmp`・固定stagingの掃除まで完了して初めて成功。失敗時はpending cleanupとして再起動でも続行し、**旧原本から再度記録を復活させない**。学習状態・opened・normalBounds・消費済みsource identityは保持する。[削除の詳細](history-deletion.md)。

通常userDataは既存の`window-shortcut-coach`を維持し、開発用`.tools/coach-data`、試験用の専用userDataと分離する。アプリ名・appId・保存先の変更を移行の理由で行わない。

## 5. 検証と限界

- `tests/storage-migration.test.ts`、`tests/storage-migration-files.test.ts`：既存原本bytes、空日、長期履歴、source変更、schema中断、部分commit・再実行、全行照合、破損・旧原本の再import拒否、cleanup復旧。
- 隔離`node scripts/test/smoke.mjs --migration`：旧JSON→Worker→Core→IPC→画面、完全終了後の**別プロセス起動**による二重取り込み防止。配布版は`--packaged --migration`。
- 選定時の技術的根拠は[SQLite方式のprobe](../research/sqlite-storage-validation.md)、配布版の検証範囲は[V02受入](https://github.com/YutoMatsui21/shortcut-expert/issues/45)を参照。通常userDataの実アップグレード、NSIS更新、電源断による任意のrename途中の安全性はfixture成功だけでは保証しない。
