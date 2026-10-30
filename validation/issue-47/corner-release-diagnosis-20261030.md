# C07：ChromeとExplorerの解放位置（session18）

## 固定した実測

製品revision `2ec7520`、hash `4fc685d4ce54e03d50c6a7e5a3df90567a2506ecd35edb8dd16fc900eb82d1cb`、既存診断ON。原本は `../evidence/issue-47/session18-*.json`。本人はChrome通知なし／Explorer通知ありと報告。

- Chrome：caption入力、対象・foreground、movesize始終、arranged終端を確認。終端の左端・横半分・上端・縦半分は一致し、quarter形状が成立。その他のDragガードも通るが、`PlacementSideAbove32=1`で8 physical pxのside解放条件に棄却。候補・記録・通知要求0。
- Explorer：`PlacementSideWithin2=1`、`PlacementAccepted=1`。1compound候補からW02/W07 mouse各1件、通知要求1・2操作。
- 本人はChromeでもカーソル自体を画面左上の端に当てて離したと明示。session17についても全4件のquarter成立・毎回の通常／非配置起点を明示済み。上中央のlayout選択や準備ミスを原因と断定しない。
- 終了code0、read-only integrity_check=ok、hash不変、同梱プロセス残存0。Chromeの未達は残す。

## 未確定の層

旧集計は32px超という区分だけで、実際の距離・物理カーソルとの関係・作業域のinset・途中の角への接触は分からない。直ちにcapを広げたり、Chromeだけ特例にしたりしない。仮説は、イベントと物理カーソルの時点／座標の相違、monitor/work左端の相違、ドラッグ中の接触後に位置が変わったケースである。いずれも現時点では未確定。

[MSLLHOOKSTRUCT.pt](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-msllhookstruct)はper-monitor-aware screen座標、[GetPhysicalCursorPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getphysicalcursorpos)は物理座標を返す。別時点の値が違うことだけでDPI不具合とは断定しない。helper起動時はPerMonitorV2を設定しており、判定側の8px条件はphysical座標の実装上限である。

## 追加診断の境界

通常モードの採否を変更しない。診断ON・active dragだけで、固定4点の非注入motion extremaと最後の1点を一時保持する。全イベントの配列やtimestampは作らない。解放時だけ、event pointと物理cursorの2 snapshot（既存のsub-observer前後）、monitor/work境界との関係を固定カテゴリへ投影する。座標・矩形・HWND・時刻列は通信／ディスクへ出さない。145カテゴリの辞書・各上限1000・世代退役を維持する。

motion extremaは全経路の再現ではない。接触flagがある場合は保持された非注入点との一致を示すが、flagがないだけで実際に接触しなかったとは断定しない。注入motionをextremaへ採用せず、注入有無と最終motionのflagは固定カテゴリだけ記録する。これらを採用・拒否の新しい条件には使わない。

Input.Probeは診断ONのMoveStartだけで作り、既存のForget／Clear／Foreground取消／Resetとともに破棄する。通常--observeではprobeを作らず、motionも収集せず、物理cursorの追加取得もしない。既存MouseReleasedの座標とmonitor/workを置き換えず、従来のedge判定を維持する。

fixtureで、角に触れた後の異なるevent／物理位置、monitor/work inset、注入motion・snapshot失敗を区別し、probe ON/OFFでcompound採否が同じこと、80px解放が両方とも拒否されること、drag終了後に集計が増えないことを確認する。自然入力は同じC07のL/LをChromeとExplorer各1回に絞る。修正前の根拠が揃うまで採用条件を緩和しない。

検証結果：関連unit35件、Native全7件、型検査、helper build、同梱base smoke・保存受入17件が成功。専用ローカルレビューは4観点で指摘なし。Native全473ファイル一致。固定manifestは `../evidence/issue-47/release-probe-build.json`、同梱先は `release/issue-47-release-probe/win-unpacked`。新しい診断を使った自然入力は未実施。NU1900警告は残る。


## 解放位置を変えた比較（session19）

診断revision `0d4618f`（採否は`2ec7520`と同じ8px）、hash `678aab19055b2ce0b8323ab3378164c7bdef7bfb0c978808f818dd08aa47fdad`。原本 `../evidence/issue-47/session19-*.json`。

- 最初のExplorerは本人がcursorを端まで持っていき、通知あり。eventと前後の物理cursorは等しく、monitor/work左端も同じ。途中と最後の端接触を観測し、W02/W07各1・通知1。
- 次のChromeは本人が意図的に端まで持っていかず、quarter previewが出た時点で解放した。33〜64pxの区分でeventと前後の物理cursorは等しく、monitor/work左端も同じ。quarter形状・入力・対象等は成立するが8px gateで棄却。
- 今回は解放操作が異なるため、アプリ固有の座標変換不具合とは結論しない。今回のsnapshotに座標差・途中の位置移動は観測されなかった。以前の明示的な「端まで当てた」という申告は原本のまま別に残す。
- 本人はMicrosoft一次情報による境界取得を優先し、なければ緩和する方針を指示。設定や画面配置は変更しない。

## Microsoft一次情報と公開パラメーター

[Snap Your Windows](https://support.microsoft.com/en-us/windows/experience/snap-your-windows)は、端までドラッグしなくてもSnapできる設定を明記している。[SystemParametersInfoW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfow)の`SPI_GETMOUSEDOCKTHRESHOLD`（0x007E）はmouseでmonitor端へdragするときのdocking閾値をpixelで取得する公開API。現在環境のgetter値は64、WinArranging/DockMovingは有効だった。`snap-system-parameters-20261030.json`／`snap-dpi-parameters-20261030.json`はread-onlyで採取し、setterは使っていない。

これはWindows11のcorner preview全体のpolygon・hysteresisを返すAPIではない。公開ドキュメントの確認範囲でその領域全体を取得するAPIは確認できなかった。dock閾値を、厳密な終端形状と入力照合を併用する保守的な解放許容値として使い、完全なOS hit regionと一致するとは主張しない。

同APIはper-monitor DPI aware threadから使うべきでないという注意があるため、取得中だけ自分のthreadをSYSTEM_AWAREへ切り替え、finallyで元に戻す。[ForDpi版](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfofordpi)は当actionをサポートしないため使わず、未文書の追加倍率計算も行わない。別のWin11設定値やDPI構成での一般化は自然入力とは分ける。

## OS値を使う最小修正

固定8pxを下限兼取得失敗時fallbackとして維持し、validatedなOS値（1〜256）と大きい方を採用。範囲外／取得失敗は8に戻す。256は異常に広い設定を無制限に受け入れないための実装上限で、Microsoftが公開した最大値ではない。before/afterの値が変わったgestureは採用しない。既存の終端1px一致、対象／構成／monitor/work/DPI、release、入力年齢、方向の照合を維持し、中央のlayout選択を無条件に許可しない。W03のtop2pxは今回変更しない。

getterはhook内で繰り返さず、非fixtureの観測開始時に読む。設定変更前は既存候補と値を無効化し、設定変更後に再取得する。fixtureはWindows設定を読まず、delegateとWindowState値で隔離する。読み取り値は候補通信や日別保存へ追加しない。

64設定で33／64を正例、65／500を負例として左右half／quarterを確認する。null／負値／0／過大値、設定変更、既配置起点、入力不一致、期限切れの負例を維持する。compoundは2件まとめて成立するか全体棄却であり、W02だけに分割しない。DPI context復元は正常・取得不可・例外のfixtureで確認する。

## 作業ツリーの分離

共有checkoutが別Issue137ブランチへ変わり、その未コミット作業を検出したため、一切変更せず `.tools/worktrees/issue-47` に既存acceptance branchの専用worktreeを作成した。Node/SDK/cacheを参照するが、source／native生成物／同梱先／試験データは分離する。新しいsession19原本と静的getter証拠だけをhash照合して専用treeへ移し、別Issueのindex・変更には触れない。

session19の終了はcode=null／SIGTERM、最終Main statusはCLOSED/error=true。原因は未確定で正常終了とは扱わない。read-only integrity=ok、hash不変、当該同梱app/helper残存0を別に確認し、異常なexit原本を保持する。

回帰試験は修正前に33〜64pxの拒否をassertで再現し、OS値64なら33/64を採用・65/500を拒否するようになった。関連unit57件、型検査、Native全7件、helper build成功。取得失敗／不正値のfallbackと設定変更時の棄却、DPI context復元、compoundの全体確定／全体棄却を検証済み。修正後の自然入力は未実施。

同梱確認：Native 473ファイル全一致、package全550ファイルを固定。manifest `../evidence/issue-47/os-dock-build.json`、SHA256 `26418e6053b6d677bed245f4b2f49c57cb4fcadb39a4cd47afa04fb735598cf7`。同梱base/settings/activation/migration/comparison smoke、保存受入17件も成功（fixtureの結果）。0d4618f以降の全変更を専用reviewerが4観点で確認し、対応が必要な指摘なし。OS設定値を使った修正後の自然入力・mixed-DPIは未確認。NU1900警告あり。
