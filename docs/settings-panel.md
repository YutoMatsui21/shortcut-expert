# 設定パネル（#23）

共通title barのgearから、幅330・高さ262pxのSettingsPopoverを開く。正式Figma `349:2456` / `354:2001` を2026-10-20に再取得し、通知・計測の2スイッチ、説明、区切り、削除入口を接続した。On画像は `354:1997` の38×22px SVGをlocal assetへ保存した。Offは同じ寸法の状態表示。gearの右端へ合わせ、上端39px、本文のスクロールから独立する。

通知の希望値はsession内で保持する。計測停止中は通知スイッチをdisabledにし、表示値を残す。実効通知は計測中かつ通知pauseなしの場合だけ。再開で希望値を戻し、再起動は従来どおり計測開始・通知pause解除とする。保存エラー・時計異常・helper故障の安全停止は維持する。

Rendererは既存の限定Preload commandを呼ぶ。トレイも同じMain commandとSerialQueueを利用し、snapshotからmenuを再生成する。保存保留中の再開は両入口で無効。Core/observerの世代検査と通知adapterのepoch無効化を維持し、停止後の新候補と再開後の旧世代候補を採用しない。停止前に保存を開始した記録は保全し、遅延保存の完了から旧通知を出さない。保存中の再開は拒否する。

MainのCoachWindowは非永続のstateVersionを配信・IPC応答へ付ける。RendererのuseCoachは古いversionの初期取得・command応答を無視する。トレイの新状態を遅い応答で戻さず、bounds/記録の保存revisionとは分離する。

Enter/Spaceでgearとswitchを操作し、開いた時は最初の有効switchへfocusする。Esc・外click・gear再clickで閉じてgearへfocusを戻す。ページ切替・窓非表示・blurでも閉じる。削除入口はpanelを閉じ、既存のMain確認dialogへ渡す。正式な削除dialogと確認tokenは#24の範囲。

初期snapshot待ち・command処理中に開いて全buttonが無効な場合は、最初に操作が有効になった時にfocusを移す。一度focusを割り当てた後はsnapshot配信で利用者のfocusを奪わない。隔離smokeは実settings保存をdeferredで保留し、この操作列の修正前失敗と修正後成功を確認する。

初期focusの対象は有効な設定switchだけとし、保存保留で両switchが無効ならgearに留める。削除buttonへ自動でfocusしない。閉じているpanelへのclose要求はfocusを変えず、通常のnav・最大化/復元のキーボード操作を維持する。保存失敗後の展開とnav/最大化のfocus保持も修正前失敗・修正後成功の回帰に含める。

## 検証

`tests/settings-state.test.ts` は遅いsnapshot応答とトレイcommandを確認する。`learning-state.test.ts` は実SQLite Workerの保存遅延・停止・再開禁止・新世代再開・旧世代拒否・新世代通知を確認する。

`node scripts/smoke.mjs --settings` / `--packaged --settings` は隔離SQLiteを使い、4幅（800/920/1120/1360）×2ページ、600px高で寸法とasset geometry、Enter/Space/Esc、外click・gear再click・ページ切替・hide/blur、停止中の通知disabledと希望値保持、実トレイmenu callback→共通command→IPC配信→React同期を確認する。画像は自アプリのfixture画面だけ。

OSトレイへの実クリック配送、実入力精度、混在DPI・文字拡大、標準Toastはこのfixtureの証拠に含めない。標準Toast統合は#26、cold起動は#27。公開は行わない。

2026-10-20 Windows上でNode 24.11.1 / .NET SDK 10.0.401 / Electron 44.7.0を使用。unit 206件、native 6件（本番C# policy 63ケース）、typecheck/build、開発版と同梱版の通常smoke・SQLite smoke・設定smokeが成功。4幅×2ページの寸法・asset・自アプリ画像を確認した。同梱検証物は `release/issue-23/win-unpacked/Window Shortcut Coach.exe`。
