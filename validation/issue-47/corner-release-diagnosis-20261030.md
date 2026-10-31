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

## 修正後の自然入力（2026-10-31、session21）

製品revision `6d82358`、通常observer（Native診断OFF）、OS閾値64を使う同梱版。manifestは `../evidence/issue-47/os-dock-build.json` と一致。前日に開いたsession20は試行0で正常終了し、受入結果には数えない。

本人が6件全て期待どおりだったと報告。session21原本は `../evidence/issue-47/session21-status.json` 等に保持し、パネルの未選択初期値（not-observed／not-seen）は書き換えず、後の本人確認をparticipant別添へ保存した。代替キー同等性は今回未試験。

| 試行 | 入力／状態（W02／W07） | 記録 | 通知要求 |
| --- | --- | --- | --- |
| 1 | Chrome早期preview解放、learning／learning | W02/W07各mouse1 | 1件、2行 |
| 2 | 同、learning／excluded | 同 | 1件、W02のみ |
| 3 | 同、excluded／learning | 同 | 1件、W07のみ |
| 4 | 同、excluded／mastered | 同 | 0 |
| 5 | Explorer実端解放、learning／learning | 同 | 1件、2行 |
| 6 | Chrome上部中央のSnap Layout選択 | 0 | 0 |

全6件valid/completed、期限切れ・中断・日付変更なし。通知可視結果と窓の結果は本人の一括報告で期待一致。Main CLOSED/error=false、exit code0、read-only SQLite integrity=ok、build hash不変。停止後の当該app／helper／panelの残存0も確認した。session19の異常終了原本は消さず、今回の正常終了で以前の原因が判明したとは扱わない。

今回で早期preview解放と代表状態混在の未達は解消したが、#47全体の同一最終buildによる基本16操作・重要境界・pause/stop・UI/環境条件は未完了。以前のbuildの成功を転記せず、必要な影響範囲と残る受入を次にまとめて整理する。6d82358のwindows-qualityはSUCCESS。今回の文書・証拠のみの追記は本番動作変更がなく、専用再レビューとbuild再作成を省略する。

## 最終buildの基本・停止条件20件（2026-10-31、session22）

session21と同じ製品revision `6d82358`／同じpackage manifest、通常observer（診断OFF）。原本は `../evidence/issue-47/session22-status.json` 等。全20件valid/completed、日付変更・期限切れ・中断なし。記録の機械照合は20/20、通知要求の機械照合は19/20。

- P03m（trial5）はChrome、normal→maximized、mouse/max-button、W03 mouse1を保存。before-arranged-true、通知要求0で、予定した未配置起点の通知期待とは不一致。入力検出・分類・保存は通過し、Coreのarranged起点ではshortcut=nullとする既存条件で通知されなかった。実際の起点状態は本人へ確認中であり、誤操作とも誤判定とも確定しない。
- P03k（trial6）は本人がWin+Upの前に別操作を行ったと申告。機械結果はbefore-arranged-false、W03 key1のみ、通知0で一致するが、指定操作だけの清浄な試行として受入済みにしない。追加操作の内容・結果を推測しない。
- その他18件は記録と通知要求が期待一致。pause中のC03はW02/W03各mouse1・通知0、全停止中C03は候補・記録・通知0。P12番号の機械照合も成功。
- パネルのoperatorResult/visibleNotification/equivalenceは全て初期値のまま保持。本人は全件完了、P03m通知なし、P03k追加操作を報告。残りの個別OS可視結果やキー同等性を補完して断定しない。
- 正常終了code0、Main CLOSED/error=false、read-only SQLite integrity=ok、build hash不変、自身のapp/helper/panel残存0を確認。製品コード・buildを変更せず、同じ20件の再試行はしない。P03起点の回答に応じ、必要な2件だけを残る境界・負例とまとめる。

本人の追加回答：P03mの直前の配置状態は覚えていない。起点はunknownのまま残し、準備ミスともarranged誤判定とも断定しない。次のバッチで未配置を明確に準備したP03m/P03kの2件だけを再確認する。本人はIssue Closeまで必要な作業を継続するよう指示した。未確認条件を成功へ付け替える承認ではなく、製品buildを変えず残る境界・負例・UI/環境受入を続ける。

## 境界・負例20件（2026-10-31、session23）

同じ製品6d82358・同じpackage hash、診断OFF。`../evidence/issue-47/session23-status.json` 等に原本を保持。20件全てvalid/completed、記録照合18/20、通知要求照合19/20。

- P03m/P03kの明確な未配置起点での再試行は各W03 mouse/key1、mouse通知1／key通知0。本人も今回この2件の相違を報告しておらず、他は期待どおりと報告。以前の起点unknown・余分操作の原本は書き換えない。
- S03-double、S04-double、通常／最大化起点の最小化、連続Win+Downは各1件で期待一致。11負例（Alt+Tab取消／元窓／同窓／tab切替、追加修飾、移動戻り／取消、配置取消、tab閉鎖、Win+Z、Win+Tab）は全て候補・記録・通知0。
- S03-dragは候補0・記録0・通知要求0。本人は通知なしと報告。実際の最大化結果と解放位置は質問中であり、上端2px条件だけが原因と推測して変更しない。
- S01-multiも候補0・記録0・通知0。本人の「それ以外は期待どおり」は窓の実結果の報告と分け、機械上の記録未達を隠さない。終了時に開始と異なる通常窓が前面になったか質問中。
- 正常終了code0、Main CLOSED/error=false、read-only DB integrity=ok、hash不変、自身のapp/helper/panel残存0。パネルの初期確認欄は変更せず、一括本人報告はparticipant別添へ残す。

この時点で製品修正・再buildをしない。2件の実操作条件を確認し、既存診断で区別できる失敗は同じbinaryの診断ONで確認する。既存診断だけで区別できないときだけ、必要な失敗境界の有界カテゴリを追加する。

本人の追加回答：S03-dragは上端より手前の最大化previewで解放し、窓自体は最大化した。S01-multiも開始時と異なる通常窓が最後に前面になった。両方とも実結果に対する記録未達であり、操作結果不明や同窓戻りへ付け替えない。

Microsoft SystemParametersInfoWのSPI_GETMOUSEDOCKTHRESHOLDはmouseのmonitor端docking閾値、SPI_GETDOCKMOVINGは上端・左右端を対象とする。上端にも公開getterの利用根拠がある一方、完全なWin11 preview領域やhysteresisを返すものではない。今回は先に採否を変えない診断を追加し、2px gate以外の起点／release／foreground不整合を区別する。

session22を保存した3618b00以降の診断変更：上端最大化のrelease有無・monitor/work・起点・foreground・X範囲・上端距離の固定区分と、W01のAlt開始・Tab・解放・前面確認・取消／期限／最終結果・ターゲット適格性の固定理由を追加。既存の明示的診断起動だけで有効、通常起動はdelegate=null。判定・timeout・対象照合・allowlistは変更しない。HWND/PID/座標/窓名/キー列/時刻列を新たに保存しない。Native enumとMain allowlistを同期し、1000上限を維持する。

診断追加の検証：型検査、関連unit32件、Native全7件（C#本番policy assertions626）、helper build、同梱base smoke、保存受入17件が成功。専用レビューは3618b00以降の全tracked/untracked差分を4観点で確認し、対応が必要な指摘なし。保存受入は初回にCLI引数形式を誤り既定pathのENOENTで起動前失敗、正しい `--package-dir=.../win-unpacked` で同一packageを再実行して成功した。これを製品の保存障害とは扱わない。NU1900警告は継続。

Native全473ファイル一致、package全550ファイルを `../evidence/issue-47/max-switch-diag-build.json` に固定。同梱先 `release/issue-47-max-switch-diag/win-unpacked`。固定診断キーは185種類、0〜1000の厳格parseを維持。次は同一binaryの診断ONでChrome／Explorer各1回のS03-dragとS01-multi、計4件のみを比較する。現時点で未達2件は未解決。
