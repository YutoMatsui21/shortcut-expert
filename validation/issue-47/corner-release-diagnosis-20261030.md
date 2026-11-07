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

| 試行 | 入力／状態（W02／W07）                    | 記録            | 通知要求     |
| ---- | ----------------------------------------- | --------------- | ------------ |
| 1    | Chrome早期preview解放、learning／learning | W02/W07各mouse1 | 1件、2行     |
| 2    | 同、learning／excluded                    | 同              | 1件、W02のみ |
| 3    | 同、excluded／learning                    | 同              | 1件、W07のみ |
| 4    | 同、excluded／mastered                    | 同              | 0            |
| 5    | Explorer実端解放、learning／learning      | 同              | 1件、2行     |
| 6    | Chrome上部中央のSnap Layout選択           | 0               | 0            |

全6件valid/completed、期限切れ・中断・日付変更なし。通知可視結果とウィンドウの結果は本人の一括報告で期待一致。Main CLOSED/error=false、exit code0、read-only SQLite integrity=ok、build hash不変。停止後の当該app／helper／panelの残存0も確認した。session19の異常終了原本は消さず、今回の正常終了で以前の原因が判明したとは扱わない。

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
- S03-double、S04-double、通常／最大化起点の最小化、連続Win+Downは各1件で期待一致。11負例（Alt+Tab取消／元ウィンドウ／同ウィンドウ／tab切替、追加修飾、移動戻り／取消、配置取消、tab閉鎖、Win+Z、Win+Tab）は全て候補・記録・通知0。
- S03-dragは候補0・記録0・通知要求0。本人は通知なしと報告。実際の最大化結果と解放位置は質問中であり、上端2px条件だけが原因と推測して変更しない。
- S01-multiも候補0・記録0・通知0。本人の「それ以外は期待どおり」はウィンドウの実結果の報告と分け、機械上の記録未達を隠さない。終了時に開始と異なる通常ウィンドウが前面になったか質問中。
- 正常終了code0、Main CLOSED/error=false、read-only DB integrity=ok、hash不変、自身のapp/helper/panel残存0。パネルの初期確認欄は変更せず、一括本人報告はparticipant別添へ残す。

この時点で製品修正・再buildをしない。2件の実操作条件を確認し、既存診断で区別できる失敗は同じbinaryの診断ONで確認する。既存診断だけで区別できないときだけ、必要な失敗境界の有界カテゴリを追加する。

本人の追加回答：S03-dragは上端より手前の最大化previewで解放し、ウィンドウ自体は最大化した。S01-multiも開始時と異なる通常ウィンドウが最後に前面になった。両方とも実結果に対する記録未達であり、操作結果不明や同ウィンドウ戻りへ付け替えない。

Microsoft SystemParametersInfoWのSPI_GETMOUSEDOCKTHRESHOLDはmouseのmonitor端docking閾値、SPI_GETDOCKMOVINGは上端・左右端を対象とする。上端にも公開getterの利用根拠がある一方、完全なWin11 preview領域やhysteresisを返すものではない。今回は先に採否を変えない診断を追加し、2px gate以外の起点／release／foreground不整合を区別する。

session22を保存した3618b00以降の診断変更：上端最大化のrelease有無・monitor/work・起点・foreground・X範囲・上端距離の固定区分と、W01のAlt開始・Tab・解放・前面確認・取消／期限／最終結果・ターゲット適格性の固定理由を追加。既存の明示的診断起動だけで有効、通常起動はdelegate=null。判定・timeout・対象照合・allowlistは変更しない。HWND/PID/座標/ウィンドウ名/キー列/時刻列を新たに保存しない。Native enumとMain allowlistを同期し、1000上限を維持する。

診断追加の検証：型検査、関連unit32件、Native全7件（C#本番policy assertions626）、helper build、同梱base smoke、保存受入17件が成功。専用レビューは3618b00以降の全tracked/untracked差分を4観点で確認し、対応が必要な指摘なし。保存受入は初回にCLI引数形式を誤り既定pathのENOENTで起動前失敗、正しい `--package-dir=.../win-unpacked` で同一packageを再実行して成功した。これを製品の保存障害とは扱わない。NU1900警告は継続。

Native全473ファイル一致、package全550ファイルを `../evidence/issue-47/max-switch-diag-build.json` に固定。同梱先 `release/issue-47-max-switch-diag/win-unpacked`。固定診断キーは185種類、0〜1000の厳格parseを維持。次は同一binaryの診断ONでChrome／Explorer各1回のS03-dragとS01-multi、計4件のみを比較する。現時点で未達2件は未解決。

## 診断4ケース・実際5行（2026-10-31、session24）

1dc4481、診断ON、`../evidence/issue-47/session24-status.json` 等。最初のChrome S03-dragはcompleted=false/valid=false、maximized分岐に入らずMoveSameMonitorで候補0。未完了の理由を推測しない。次の完了ChromeはMaxReleaseTopWithin2／MaxAccepted各1、W03 mouse1・通知要求1。完了standardはDragMaximizedResult／MaxReleaseTop3To8各1、W03記録・通知要求0で、上端3〜8pxの解放を固定2px gateが棄却した。

本人は「Chromeは通知なし・Explorerは通知あり」と再回答し、Chromeは端、Explorerは手前previewで離したと思うと報告。機械の通知要求の行対応とは逆で、理由未確定。application欄・原本・本人報告を入れ替えず保持する。本人申告を機械要求の表示確認に自動対応させず、OS Toastの成功はこの比較では確定しない。

複数TabはChrome（TabDown4）／standard（TabDown2）ともW01 key1・通知0。KnownStagingを通過しForegroundConfirmed／Completedを各1観測。直前session23の別ウィンドウへの実切替で候補0となった原因は今回再現せず、診断追加だけで修正されたとは扱わない。

本人完了報告後もパネルはIDLEだったため、観測停止を確認して既存end制御を送った。正常終了code0／Main CLOSED/error=false、read-only DB integrityとhash不変を確認する。試行・診断・確認欄の原本は変更しない。

## 上端のOS docking閾値修正

3pxのpreview解放をOS値64のsnapshotでも拒否するassertでRedを確認。W03 top dragにもW06/W07と同じ公開getterを利用し、valid raw1〜256と上端fallback2pxの大きい方を採用する。側端のfallback8pxは変えない。設定変更中のgestureは棄却し、注入／取消／対象／release／monitor/work／起点／layout／最終最大化の照合とcompound全体確定は維持する。W01判定は変更しない。

回帰は同monitorおよび別monitor最大化の3/8/33/64を正例、65/500・負のY・無効getter・設定変更を負例とした。追加テストを既存集計サンプルへ混ぜたことで最初のGreen実行はfixture集計の期待と不一致となり、集計サンプルを増やさず直接policy結果をassertする形に修正して成功。既存の期待値は変更していない。

上端修正後の検証：型検査、関連unit60件、Native全7件（policy assertions651）、helper build、同梱base/settings/activation/migration/comparison、保存受入17件が成功。専用reviewerが1dc4481以降の全tracked/untracked差分を4観点で確認し、対応が必要な指摘なし。Native473ファイル全一致、package550ファイルのmanifestは `../evidence/issue-47/top-threshold-build.json`。同梱先は `release/issue-47-top-threshold/win-unpacked`。現在の実機確認はこの修正後buildでは未実施であり、session24の診断結果と混同しない。記録回収時に一度別packageを指定してhash mismatchとなった準備エラーは、実際の診断packageを指定して解消し、session24のhash不変・DB整合性・残存0を確認済み。Native strict診断キーは186。NU1900警告あり。

## 上端修正後の通常経路6件（2026-10-31、session25）

製品f22db85、Native診断OFF、同梱 `release/issue-47-top-threshold/win-unpacked`。全6件valid/completed、記録・通知要求6/6一致。Chrome／standardの同monitor top preview解放はW03 mouse各1・通知各1、別monitor top previewはW02/W03 mouse各1・1通知2行。複数TabはChrome／standardでW01 key各1・通知0。Snap Layout選択は候補・記録・通知0。本人は全件期待どおりと報告し、原本の初期確認欄を変更せずparticipant別添へ残す。

正常終了code0、Main CLOSED/error=false、read-only SQLite integrity=ok、build hash不変、自身のapp/helper/panel残存0。本人報告後にIDLEを確認して既存end制御で終了した。f22db85のwindows-quality/change-scope成功。session23/24の未記録・通知対応不明の原本は保持し、今回をW01判定修正の証拠とは扱わない。

製品コードを以降変更せず、同一最終buildの基本8操作×mouse/keyとキー同等性、複合四隅・pause/stop・保存確認取消を20件で確認する。自然入力の一般化や認識率95%は主張しない。今回追記は証拠／文書だけのため追加専用レビュー・再buildは不要。

## 最終8操作20件（2026-10-31、session26）

f22db85の同一最終package・診断OFF。全20件valid/completed、記録・通知要求20/20一致、本人は全て期待どおりと報告。[受入一覧](final-build-acceptance-20261031.md)へ8入力対と追加4条件、静的環境、read-only DB、画面確認の限界をまとめた。通常終了code0・DB integrity=ok・hash不変・当該プロセス残存0。

一覧は実セッションのウィンドウを最小化から復帰してUIAで8行の値を確認。記録画面の本人報告はW番号・key/total表示の対応が不明で未確定。source recordsReadModelと同一renderer fixtureは全値一致するが、最終レビューはそれでは実DB→本番Main/IPC→記録UIの受入を代替しないとP1指摘。#47の残る必須ゲートとして維持する。本人の画像保存許可後に、隔離した元DB複製と変更していない製品パッケージで既存UI試験を実行する準備を済ませた。

P1対応：本人の明示画像許可後、元session26のSQLite一式のbyte一致複製を使い、同じf22db85の本番Main/Store/Worker/IPC/画面で16条件を実施した。Nativeのみfixtureで実入力hookなし、fake Main handlers／合成countsなし。全16条件成功・正常終了・元DB/package不変・全8行のpublic modelと欠測条件一致を確認。初回1条件のy差、後検査のnull-prototype型差、補足UIA保持fixtureの制御終了はそれぞれ原本／説明を保持する。16枚はローカル確認のみで公開しない。[P1の根拠と対応](final-build-acceptance-20261031.md#p1対応元db複製を本番mainipcで確認)を再レビュー対象にする。

最終P1再レビューは一度利用上限で中断したが、完了扱いにせず再実行して完走した。4観点でP1解消・#47の必須条件に未確認なしと確認された。最終製品f22db85の同梱物を変えず、最終証拠commitのCI成功後にmerge／Closeする。
