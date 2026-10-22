# 窓の保持と終了（#22）

## 契約

MainのCoachWindowが単一窓と通常boundsを所有する。1120×700 DIPで初期化し、最小800×600を維持する。32px captionはdrag、歯車と窓ボタンはno-drag。最小化はtaskbar、最大化ボタンはmaximize/unmaximize、×はhideだけを実行する。最大化状態はMainから既存の限定snapshotで配信し、復元アイコンと操作名へ反映する。任意boundsをRendererから受け付けない。

settingsのoptional `normalBounds: { x, y, width, height }`に整数DIPだけを保存する。旧settingsにfieldがなくても読め、旧JSON移行の厳格なv1契約は変更しない。現行SQLiteのsettings JSONへ追加し、単一writer Worker・既存Coreキューで学習設定やopenedと直列に更新する。通常記録の削除では保持する。旧ビルドは未知fieldを拒否し、安全停止するため、この設定保存後の旧版へのdowngradeは保証しない。

move/resizeでgetNormalBoundsを取得し、最大化・最小化中のイベントは採用しない。250ms以内の変更を最後の通常値へまとめ、連続drag中も書込みを無期限に延期しない。終了前に残りをflushする。保存失敗は既存のpendingSaveと再試行へつなぐ。窓位置の正常保存だけでは記録画面を更新せず、サイズ変更で行とスクロールを破棄しない。

boundsだけの保存は記録ReadModelを変えないためmeta.revisionを進めない。学習状態など他のsettings変更は従来どおりrevisionを進める。実Worker試験でこの差と再open後のbounds保持を確認する。

起動・再表示・display追加/除去/metrics変更時に現在のwork areaと照合する。有効な負座標は保持し、caption全体（窓controlsを含む）が1画面内に残らなければ、最も重なるwork areaへ補正する。補正が必要な場合は画面に収まる大きさへ制限するが最小寸法を下げない。800×600 DIP未満のwork areaでは全体収容を保証できない。最大化中の補正は通常位置を直してから最大化へ戻す。最大化状態自体は永続化しない。

トレイの表示/double-clickとsecond-instanceはshowCoachを共用し、最小化からrestore→位置補正→show→focusする。初期化中の表示要求も初期化後に反映する。通常の再起動表示はopenedに従い、通知cold起動は#27に残す。

終了要求は同じPromiseにまとめる。新たなstart・設定変更・削除を止め、先行UI制御を待ち、計測停止とhelperのstop、通常bounds flush、Core保存待機を終えてから未保存確認を出す。「戻る」は停止を維持して既存窓を表示し、再試行できる。終了確定後はhelper shutdown/EOF/exitとSQLite Worker closeを待ち、トレイを破棄してapp.quitする。終了中の表示変更では新しいbounds保存を追加しない。終了失敗は成功扱いせず、停止・画面エラーへ戻す。

通信失敗で切り離したhelperもexit待機対象に保持する。shutdownは2.5秒でkillを要求し、5秒までにexitを確認できなければ失敗してアプリを残す。kill要求だけで完全終了と扱わない。bounds保存Promiseがrejectした場合は呼出し元へ失敗を返し、同じ値の再試行を保持して保存キューの末尾を回復する。この2件は修正前の回帰失敗と修正後の成功を確認した。

定期集計tickerはhelper/Workerの終了確認後に止める。終了失敗で画面へ戻った後にも計測を再開でき、tickerが再び実行されることを隔離smokeで確認する。終了要求中はtickerの処理を抑止する。

## 証拠の範囲とV03

#46の同一配布物による16サイズ計測、初期/最小viewportの不一致、残る実窓試験は[V03受入台帳](ui-acceptance.md)を参照。V03は未合格。

unitは負座標/画面外/小画面補正、状態変化中の上書き防止、保存待機と遅延イベント拒否、実SQLite Worker経由の保存・削除保持・再open・不正値拒否を確認する。Electron smokeは限定IPCからの最大化/復元、CSS drag/no-drag、hide中の計測状態、共通second-instance復元、保存失敗時の終了取消・保存再試行、重複終了要求から実helper shutdownまでを通す。外形/content/viewport/devicePixelRatio/scaleFactorをfixture結果に含める。

**未合格：V03の実機確認。** 自前HTMLの最大化ボタンはnative captionのhit-testを実装しておらず、標準Snap Layoutのhover表示を実証していない。clickによる最大化成功やCSSのno-drag設定をSnap UI成功の証拠にしない。OS caption overlayは外観が変わる代替候補のため無断採用していない。

実機では当該配布buildについて最大化hoverの標準Snap UI、caption drag/double-click、実トレイ操作、別プロセスsecond-instance、100/150%等の混在DPI・負座標・物理画面着脱、再起動後bounds保持を確認する必要がある。実入力/UIA/キー送出を伴う試験は明示同意後とし、通常保存先・実利用記録は使わない。未確認のまま#22を完了・mergeせず、#27や実検出精度・公開受入の成功として扱わない。
