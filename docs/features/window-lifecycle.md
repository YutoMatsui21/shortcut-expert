# アプリウィンドウのライフサイクル

**責務**：1つのElectronウィンドウの生成・表示／非表示、位置の保存・復元と、観測・保存を壊さない終了処理を定める。通常のWindows操作検出器の仕様ではなく、**Shortcut Expert自身の画面とプロセス**の設計。

## 1. 画面の所有と表示

- Mainの`CoachWindow`が**単一の窓**を所有し、任意boundsをRendererから受け付けない。初期1120×700 DIP、最小800×600 DIP、32px独自caption。ドラッグ領域と歯車・窓ボタンの`no-drag`領域を分ける。
- 最小化はタスクバー、最大化ボタンは最大化／復元、`×`は**hideのみ**でバックグラウンド計測を継続する。最大化状態は非永続のsnapshotで表示へ通知する。
- トレイ／通知／`second-instance`は共通`showCoach`で**同じ窓**を復元→位置補正→表示→前面化する。初期化中の表示要求は窓の準備完了後に反映する。

## 2. 位置・サイズの永続化

| 状況 | 設計上の約束 |
| --- | --- |
| move／resize | 通常状態の`normalBounds`（整数DIP）だけを取得。最大化・最小化中の値で上書きしない |
| 連続変更 | 約250msで最後の通常boundsをまとめ、終了時に未保存分をflushする |
| 画面変更 | 再表示・起動・ディスプレイ着脱／設定変更時にwork areaへ補正 |
| 複数画面 | 有効な負座標は保持。caption全体がどの画面にも収まらなければ最も重なる画面へ移す |
| 保存失敗 | pending saveとしてエラー・再試行へ接続。保存失敗を正常終了扱いにしない |

- boundsはSQLite settingsの`normalBounds`へ、学習状態などと同じwriter／Coreキューで保存する。**boundsだけの保存では記録ReadModelのrevisionを進めない**。記録全削除では通常boundsを維持する。
- 旧settingsにboundsがなくても起動できるが、追加fieldを拒否する旧版への**downgrade互換は保証しない**。最大化状態そのものは永続化しない。
- 作業領域が800×600 DIP未満の場合はcaption全体の画面内収容を保証できない。最大化中も通常boundsを補正してから最大化へ戻す。詳細な復元制約は`src/main/window-bounds.ts`。

## 3. 安全な終了

終了要求は**同一Promiseへ集約**し、次の順序を守る。

1. 新規開始・設定変更・削除を止め、進行中のUI制御を完了させる。
2. 計測を停止し、helperのstop、boundsのflush、Core／SQLiteの保存完了を確認する。
3. 未保存があれば確認し、**「戻る」なら停止状態のまま画面を戻し再試行可能**にする。
4. 終了確定後、helperのshutdown／EOF／exit、SQLite Workerのcloseを待ち、トレイを破棄して`app.quit`する。

- helperのshutdownは**2.5秒でkill要求、5秒までにexit未確認なら失敗**。kill要求だけで完全終了扱いにしない。通信故障で切り離したhelperもexit待機の対象にする。
- 保存Promiseが失敗してもキューを復旧可能に保ち、同じ値を再試行する。終了中の新たなbounds変更は保存しない。
- 定期集計tickerはhelper／Workerの終了確認後に停止。終了が失敗して画面へ戻る場合は再開できる状態を保持する。

## 4. 検証・残る実機受入

- **unit**：`tests/coach-window.test.ts`、`tests/window-bounds.test.ts`などで単一窓、負座標・画面外補正、通常bounds保存・再open、失敗時の再試行、終了競合を確認。
- **Electron smoke**：実Main／Renderer／IPCでhide・復元・画面状態、保存失敗時の終了取消、helperとWorkerの終了順、外形／content／viewportを確認。
- **未合格のV03**：自前の最大化ボタンによる標準Snap Layoutのhover表示は未実証。実トレイ操作・別プロセス二重起動・混在DPI／画面着脱・再起動後bounds保持も同一配布buildで検証が必要。CSSのdrag／no-dragや最大化成功だけでOSのSnap UI対応と判断しない。

詳しい16サイズの証拠・未確認条件は[V03 UI受入台帳](../validation/ui-acceptance.md)。実OS操作の試験は本人の明示同意後に実施する。
