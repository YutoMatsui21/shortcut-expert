# Chromeの復元・閉鎖（session12）

## 固定した事実

製品revision `b80e645`、同梱manifest `8fdefa1d6dbff47436f132e1b4d76fa8868af9e0287bcd5df8b083d49df5dd4f`。通常観測・Native診断OFF。20試行は全件有効・期限内、機械期待値一致は15件。原本は `../evidence/issue-47/session12-*.json`。本人申告は別添とし、原本case ID・アプリカテゴリ・未選択の確認欄は変更しない。

- trial1/2：P12m/P12k、standard、slot1。W12 mouse/key各1、番号一致、通知はmouseだけ1。これは指示どおりの基本W12受入。
- trial3〜6、8〜14、16、19：Chromeで期待する操作各1件、通知はmouseのみ各1。W02通常mouse移動も成立し、以前の単独移動0件を再現しなかった。
- trial7 P04m：最大化→通常・非arrangedのrestore候補1。input-recentだがorigin/routeがunknown。Core分類0、W04記録0、通知0。
- trial15 P11m：候補0、W11記録0、通知0。
- trial20 S04-double：trial7と同じrestore候補1・由来不明、分類・記録・通知0。
- 本人は上記3件で窓自体は期待どおり復元／閉鎖したと明示。
- trial9 P06m-left：本人は2回つかみ損ねたと申告。機械側はplacement候補1、W06 mouse+1、通知1で、他操作の余分な計上は0。失敗入力がなかったとは主張しない。
- trial17/18：P11の後に追加したChromeのP12m/P12k。trial17は本人が見えているChrome窓を直接clickしたと明示。W01 mouse+1と通知1はその操作に一致するが、タスクバーW12の試行としては手順不一致であり成功に付け替えない。trial18はW12 key+1、通知0だがパネルslot1と不一致。実際の数字は未回答で、追加試行の番号確認を保留する。基本W12のtrial1/2を無効化しない。
- 終了code0、read-only integrity_check=ok、build hash不変、起動した同梱プロセス残存0。現在のPR head CIは成功。

## 境界と次の検証

W04は結果観測までは成立し、入力の意味付けの境界で失敗。W11は候補生成以前で止まる。Mainの通知だけの失敗ではない。Chrome固有caption／buttonのhit、TITLEBARINFOEXのrect／state照合、対象・foregroundなどを仮説として分け、現時点でいずれとも断定しない。

同じbinaryに既存 `--diagnostics` を指定し、P04m／S04-double／P11mの3件だけ再試行する。Root/childのhit、title読み取り、最終caption/button分類の固定集計で入力層を切り分ける。W11のclose専用policy診断まではこのwindow診断に含まれないので、入力層が正常だった場合は次にその境界を調べる。新しい根拠なしに採用条件を変更しない。成功済みの基本操作とつかみ損ねのP06は繰り返さない。

今回は文書と実測原本の追加のみ。本番の採否・型・試験設定を変更しないため、GitHub操作Skillの例外で追加コードレビュー・再build・自動製品試験を省略する。診断ON試行を通常モードの合格へ転記しない。Issue #47は未達3件と残る受入条件があるためOpen／Draftを維持する。


## 既存診断の結果（session13）

同じ製品revision `b80e645`・同じhash、Native診断ON。原本は `../evidence/issue-47/session13-*.json`。panelは全件standardだが、本人は3件ともChrome窓を操作したと明示。`application`は手動結果の分類メタデータで、検出器選択には使っていない。原本は変更せず、別添でChromeとして区別する。ラベルの誤りだけを理由に操作を繰り返さない。

- P04m：RawButton1→FinalOther1、TitleReadOk1／TitleOutsidePoint1。対象はforeground一致。復元候補1だが由来・route不明、件数・通知0。本人の無駄なクリックは別添で注記し、MouseDown3／TargetMissing2のどれだったかは推測しない。余分な計上は0。
- S04-double：RawCaption2→FinalOther2、TitleReadOk2／TitleOutsidePoint2、HitRoot2。復元候補1だが由来・route不明、件数・通知0。
- P11m：RawButton1→FinalButton1、TitleReadOk1、HitRoot1。window側のbutton分類は通るがclose候補0。close専用policyの内部段階はこの診断に含まれていない。
- 3件とも有効・期限内。終了code0、read-only integrity_check=ok、build hash不変。今回の申告は操作完了とラベル／クリック補足であり、原本の未選択欄を成功へ書き換えない。

復元の失敗は、Chromeが返すcaption／buttonヒットを、その後のWindowCaption.Hitが棄却する境界まで絞れた。現行Hitは全ボタン矩形不整合、無効状態、buttonヒットと矩形の不一致をいずれも-1にするため、旧集計だけでは区別できない。閉鎖は別経路のCloseButton矩形照合やReady／release／DESTROY確認があり、window最終buttonだけで原因を断定しない。

## 追加する診断と次の仮説判別

新しい根拠なく採否を緩和しない。WindowCaption.Hitの各戻りを変えず、title geometryのvalid／fallback／invalid、無効状態、ヒットと矩形の不一致を固定集計する。rootのmin/max/closeも固定分類する。閉鎖側は既存CloseReasonとgeometryの固定理由を同じ世代付きwindow診断へW11 prefixで投影する。Root/closeのWindows読取り回数・順序は維持し、座標・矩形・状態値・HWND・窓名・時刻列は保存しない。

通常--observeでは新しいclose診断callbackも設定しない。既存のclose専用validationモードは保持。すべて1カテゴリ上限1000・start世代reset・Takeで退役する集計へ入り、停止後や次の試行へ流用しない。

fixtureではcaption／closeの診断ON/OFFの戻り同値、geometry原因、CloseReason全件の固定mapping、世代と上限を確認する。追加診断の目的は、同じ未達3件を1バッチで再試行した際に、修正に必要な分岐を特定すること。採否の変更や解決済みの主張はしない。

追加診断の検証：関連unit35件・Native全7件・型検査・helper build成功。C#/TSの固定112カテゴリ一致、caption／close判定のON/OFF同値、CloseReason全件mappingと上限・世代を検証。同梱base smoke・保存受入17件、Native全473ファイル一致。専用ローカルレビューは4観点で指摘なし。NU1900の脆弱性index取得警告は残る。新診断同梱先は `release/issue-47-chrome-detail/win-unpacked`、manifestは `../evidence/issue-47/chrome-detail-diag-build.json`。自然入力は未実施であり、失敗3件は未達のまま。


## 原因の判別（session14）

製品revision `042caa4`、hash `4cb8d26d756029750aac31d557c117662b694d97eee3cb24a06874b45a58d6a9`、Chromeカテゴリ・追加診断ON。原本 `../evidence/issue-47/session14-*.json`。3件とも有効・期限内、記録・通知0。本人は完了を報告したが、今回は目視の個別結果を追加申告していない。

- P04m：RawMaxButton1、TitleGeometryInvalid1、FinalOther1。1つのrestore候補はorigin/route不明。Chromeの明示的max/restoreヒットが矩形不整合で捨てられた。
- S04-double：RawCaption2、TitleGeometryInvalid2、FinalOther2。1つのrestore候補はorigin/route不明。同じ矩形不整合が明示的captionヒットを捨てた。
- P11m：RawCloseButton1、TitleGeometryFallback1、FinalButton1。閉鎖側もW11GeometryFallback2で、CloseRectangle／PendingMouseが0。全ボタン矩形が空で、rootのHTCLOSEをMain側windowルートは保持する一方、close専用ルートは代替証拠を受け付けなかった。
- W11NotReady等も含む集計には複数clickが入るため、どのclickのReadyかは断定しない。ただし矩形fallbackは、Readyとは独立にclose候補を作れない必須条件の不成立だった。修正後にも残る場合はその新しい証拠を使う。

## 観測に対応する修正

矩形の取得に成功しても内容が不正な独自captionについて、root自身の明示的caption／min／max／closeヒットを捨てない。client／resize／不明から操作を作らず、有効な矩形では従来の位置・無効状態チェックを維持する。子captionのroot/process条件も変更しない。

close専用ルートは、矩形が空／不整合のときだけrootへ10ms上限でWM_NCHITTESTを問い合わせ、HTCLOSEを返し、照会後にもroot・実ヒット先のroot・process・threadが同じと確認できた場合を代替証拠とする。押下／解放の双方で照合し、既存の同一対象DESTROY・native tick・HWND消滅・1000ms・停止／取消／非再通知を保持する。有効な閉じる矩形がある場合は無効状態や範囲外を迂回しない。画面位置の推測やtabの×の採用ではない。[WM_NCHITTESTの一次資料](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-nchittest)。

修正前の回帰試験は、captionヒット2が-1に捨てられるassertで失敗した。修正後は不正矩形＋明示的root判定を実CandidateTrackerのrestore2経路へ通し、Main／Core／SQLiteにも接続してW04を確認する。空／不正close矩形のroot証拠有無、client/tab/resize/不明、root/process/thread不一致、有効矩形の無効状態・範囲外を回帰試験にする。旧「不正矩形＋root min」棄却の期待は、今回確証した明示的hit保持へ変更し、root不明時の棄却を別途維持する。受入期待値を実装都合で弱めたものではない。

修正後の自然入力は未実施。3件の再確認に加え、窓が残る複数タブのtab×でW11誤計上0を同じバッチで確認する。

修正のローカル検証：関連unit34件、Native全7件、型検査、helper buildが成功。専用ローカルレビューは4観点で指摘なし。Nativeの新診断キーは114個でC#/TS一致。初回の同梱先 `release/issue-47-chrome-hit-fixed` はelectron展開後のフォルダーrenameでEPERMとなり、未完成のため受入に使わない。ACL等を変えず、別出力先で同じコードを同梱する。

同梱結果：別出力先 `release/issue-47-chrome-hit-verified/win-unpacked` で成功。全473 Nativeファイル一致、base／settings／activation／migration／comparisonの5種smoke、保存受入17件成功。固定manifestは `../evidence/issue-47/chrome-hit-fixed-build.json`。初回失敗の出力先は使わず、Windows権限設定は変更していない。次の4件はこの同じbinary・通常observer（診断OFF）で行う。修正後の自然入力はまだ未確認。


## 修正後・通常モードの結果（session15）

製品revision `2ec7520`、hash `4fc685d4ce54e03d50c6a7e5a3df90567a2506ecd35edb8dd16fc900eb82d1cb`、Chrome・Native診断OFF。原本は `../evidence/issue-47/session15-*.json`。4件とも有効・期限内。

- P04m：max-button/mouseのrestore候補1、W04 mouse+1、対応する通知要求1。
- S04-double：caption-double-click/mouseのrestore候補1、W04 mouse+1、対応する通知要求1。
- P11m：window-close候補1、W11 mouse+1、対応する通知要求1。
- N11-tab原本：window-close候補1、W11 mouse+1、通知1で、負例の期待値はfalse。本人は「2つのChrome窓を開き、1つの窓の右上×で窓自体を閉じた」と明示。これは予定したtab-only操作と異なるため、原本を変えず別添で実操作W11の正しい反応と区別する。誤通知バグとして通知を抑制せず、N11-tabの負例成功にも付け替えない。
- 本人は全件完了とtrial4の通知表示を報告。trial1〜3の目視確認は新たな個別申告として補完しない。
- 終了code0、read-only integrity_check=ok、hash不変、起動した同梱プロセス残存0。最新製品headのwindows-quality／change-scopeは成功。

根拠は製品要件W11の「閉じるボタンと対象窓の破棄」と、学習中の確証済みmouse操作の保存後通知。Chrome窓がもう1つ開いていても、閉じた対象窓のW11成立は変わらない。N11-tabで意図した操作は、**1つのChrome窓にCtrl+Tで2つ以上のタブを作り、ページ名の横の小さい×を押して1タブだけ閉じ、窓は残す**こと。窓右上の×は使わない。窓破棄が起きないのでW11を記録・通知しない負例である。

次は同じ製品build・診断OFFで、N11-tabと、タブ切替／同窓click／Alt+Tab取消・元窓／配置drag取消／Win+Z／Win+Tabの8負例をまとめて行う。成功した修正3件は繰り返さない。この追記は文書・証拠のみなのでSkillの例外で追加コードレビュー・再build・製品自動試験は省略する。


## 重要負例の結果（session16）

同じ製品revision `2ec7520`・同じhash、Native診断OFF、Chrome。`../evidence/issue-47/session16-*.json`。N11-tab／N01-tab／N01-same／N01-escape／N01-return／N67-cancel／N08／N10の8件すべて有効・期限内完了。全件で候補0・日別件数差分なし・通知要求0となり、tab-only閉鎖の負例も今回は成立した。本人は全操作の完了を報告。原本確認欄は変更せず、個別のOS目視申告を補完しない。終了code0・read-only integrity_check=ok・hash不変・同梱プロセス残存0。

## 学習状態の組合せと検証層

複合の9組を検証する要件は維持する。既存のfault／eligibility試験は代表状態の組合せだけだったため、同じ本番Main strict parser→Core→実SQLite→通知adapterで、移動＋最大化／四隅それぞれの3×3全組合せを追加fixtureで確認する。状態に関係なく2件を1revisionで保存し、学習中の適格操作だけを1通知へ含め、状態read modelと同一transaction再送の非再通知を照合する。これは隔離された自動試験であり、自然入力の精度やOS表示の証拠ではない。

Nativeへ学習状態は送らず、状態による保存・通知適格性は共通Coreの責務である。自然入力では同じbuildで、最大化4組（L/L、L/M、M/L、M/E）、四隅4組（L/L、L/E、E/L、E/M）を代表として行い、両操作・全3状態が混ざった際の2行／片方／通知なしと、保存2件を確認する。L=learning、M=mastered、E=excluded。全9組の自然入力を行ったという主張にはしない。全9組のfixtureと代表自然入力の根拠を区別して受入へ渡す。

本人は後続の保存確認取消用の保存不要窓を用意できると回答した。上記8組とN11-dialog（例：新規ペイント画像に線を描いてから、ARM後Alt+F4→保存確認をキャンセル）を次の1バッチで確認する。準備の描画は観測停止中に行い、画像や文字を観測データへ保存しない。窓は残り、N11-dialogでは記録・通知0が期待値。pause／全停止と最終基本マトリクスは別途残す。

製品コード・同梱binaryは変更しない。追加の共通状態fixtureを含むcompound suite49件と型検査が成功。追加試験は既存の成立する契約の網羅であり、修正前の失敗を作るテストファーストの対象ではない。保存失敗・再送・停止等の既存ケースは維持する。

状態マトリクスの専用ローカルレビューは4観点で指摘なし。製品コード・binaryの再buildは行っていない。環境の補助記録 `../evidence/issue-47/environment-versions-20261030.json` はmanifest-aware PowerShellのWindows version 10.0.26340.0と、既知のchrome processのProductVersion集合156.0.8078.74だけを取得した。process ID・path・窓情報は保存せず、個別試行窓と実行ファイルの対応を確証したとは扱わない。旧WinForms panelのosBuild9200はlegacy manifest値として実OS buildの根拠に使わない。


## 状態混在と閉鎖取消の自然入力（session17）

製品revision `2ec7520`・同じhash、診断OFF。`../evidence/issue-47/session17-*.json`。

- 最初のC03 L/L試行はcompleted=false／valid=false、expired=false／interrupted=false、候補・件数・通知0。理由は未申告で原本に保持。これを成功や期限切れへ付け替えない。
- 続くC03のL/L、L/M、M/L、M/Eは各1compound候補、W02/W03各mouse+1。通知は順に2行／移動だけ／最大化だけ／0で期待一致。本人も「他は期待どおり」と報告。
- C07のL/L、L/E、E/L、E/Mは全4件で候補・件数・通知要求0。最初3組は通知未達。E/Mは通知0だけ期待一致するが、全状態で必要な2件の記録がなく、4件とも未達。
- N11-dialogはstandardカテゴリ、候補・件数・通知要求0。本人も期待どおりと報告。保存確認取消の負例として区別して保持。
- 終了code0、read-only integrity_check=ok、hash不変、同梱プロセス残存0。

C03が全状態で正常な一方、C07はCoreの学習状態判定以前に候補がない。保存／通知適格性の変更では直らない。Native診断OFFなので、起点、入力対応、終端形状、解放位置、構成整合のどの条件が失敗したかは未確定。本人へ、実際のquarter成立と各試行前の準備を質問中。回答前にどちらかを原因と断定しない。

次の試行は同じbinary・既存診断ONで、C07-two-displaysのL/LだけをChrome／Explorer各1回とする。開始は毎回通常・非配置、移動元画面内へ窓全体を収め、もう一方の画面左上へ1回で直接dragする。異なるappの比較と棄却理由で、同じ未達4組の反復を避ける。自然入力の全9組を再試行せず、成功済みC03や取消負例も繰り返さない。コード変更・新buildはない。

この追加は文書・証拠だけであり、Skillの例外で追加コードレビュー・再build・製品自動試験は省略する。Issue #47はC07の未成立と残りの受入を未達のまま保持する。

本人の追加回答：C07全4件は実際に別画面左上のquarterになり、毎回IDLE中に通常・未配置、移動元画面へ窓全体を収めてからARMしたと明示。準備ミスを原因と扱わず、正しい起点・実結果に対する候補未生成として既存Native診断で調べる。原本は変更しない。

## session18の解放位置の差

[Chrome／Explorerの比較と追加診断](corner-release-diagnosis-20261030.md)。Chromeは実際のquarter形状成立に対し解放位置32px超で棄却、Explorerは2px以内で成立。本人のカーソル接触申告との食い違いを調べるため、採否・8px capを変えない固定カテゴリ診断を追加する。
