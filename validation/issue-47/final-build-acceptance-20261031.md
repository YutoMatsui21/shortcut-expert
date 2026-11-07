# Issue #47 最終build受入（2026-10-31）

## 固定した候補

- 製品revision：`f22db85e9199a93a39a5e67f208ccb9ccf5b6d21`。以後は証拠／文書だけを更新し、本番コード・同梱物を変えない。
- 同梱先：`release/issue-47-top-threshold/win-unpacked`。
- 全550ファイルのmanifest SHA-256：`7369ba5f0ceba5e5a47ddf9aafb09a9f5343ebca237fe3d0e833ce1c13bb6070`。[manifest](../evidence/issue-47/top-threshold-build.json)。Native全473ファイルはbuild生成物と一致。
- session25／26は診断OFF・本人による物理入力・新規の隔離データ。通常userDataを使用せず、ARM以外は観測停止。入力・ウィンドウの生データや画像は証拠へ追加しない。

## 同一buildの自然入力

[session25原本](../evidence/issue-47/session25-status.json)の6件は全てvalid/completed、記録・通知要求・本人の結果報告が期待一致。上端previewでの同monitor最大化2アプリ、別monitor最大化、複数Tab切替2アプリ、Snap Layout選択負例を確認した。W01判定の変更はなく、以前の単発の未記録原因が解決したという主張はしない。

[session26原本](../evidence/issue-47/session26-status.json)の20件も全てvalid/completed、記録・通知要求20/20一致。8組の比較も含む結果報告を依頼し、本人は「全て期待通り」と回答した。パネルの個別確認欄は初期値のまま保持し、[一括本人報告](../evidence/issue-47/session26-participant.json)と機械照合を分ける。W02のapplication欄は予定standardに対してchromeだったため、そのカテゴリを勝手に補正しない。ウィンドウと実行ファイルの個別の対応を保存／確証したものではない。

| 操作                         | mouse／keyのケース                   | 各入力の基本記録 | mouse通知／key通知 |
| ---------------------------- | ------------------------------------ | ---------------- | ------------------ |
| W12 タスクバーのアプリを開く | P12m／P12k                           | 各1              | 1／0、番号照合成功 |
| W01 ウィンドウを切り替える   | P01m／P01k                           | 各1              | 1／0、W12非重複    |
| W03 ウィンドウを最大化する   | P03m／P03k                           | 各1              | 1／0               |
| W04 最大化解除・最小化       | P04m／P04k                           | 各1              | 1／0               |
| W06 左右半分に配置する       | P06m-left／P06k-left                 | 各1              | 1／0               |
| W07 画面の四隅に配置する     | P07m-left-top／P07k-left-top         | 各1              | 1／0、途中W06なし  |
| W02 別画面に移動する         | P02m-two-displays／P02k-unknown-left | 各1              | 1／0               |
| W11 ウィンドウを閉じる       | P11m／P11k                           | 各1              | 1／0               |

追加4件：移動＋四隅はW02/W07 mouse各1・1通知2行。pause中の移動＋最大化はW02/W03 mouse各1・通知0。全停止中は候補・記録・通知0。保存確認取消は記録・通知0。別操作の派生記録や単独W02への分割はない。W02と終端のキーは各操作として比較し、キーを順に実行した全体が複合dragと同等だとは案内しない。

## DBと画面

[read-only集計](../evidence/issue-47/session26-totals.json)：マウス12・キー8・計20、全体キー率40.0%。W12/W01/W04/W06/W11はmouse1/key1（50.0%、1/2）、W03/W07はmouse2/key1（33.3%、1/3）、W02はmouse3/key1（25.0%、1/4）。

一覧は、最小化されていた今回の試験用アプリだけを開き、8操作の率と分数をUIAの文字情報で確認した。画面画像やUI tree全体は保存しない。元の記録画面の目視報告は、本人がW番号との対応を把握できず不一致の可能性を報告したため、確認済みへ書き換えない。分数はmouse/keyではなくkey/totalであると説明した。追加で、実DBをread-onlyで本番recordsReadModelへ渡した[集計結果](../evidence/issue-47/session26-records-model.json)と、同じ承認済み件数の隔離fixtureを、変更していない最終packageのrenderer/preload・本番IPC検証・本番read modelで再生した[UI結果](../evidence/issue-47/session26-renderer-replay.json)を確認した。全体40.0%・キー8回・mouse12回、一覧8行・記録8行すべての操作名／mouse／key／率／分数が一致し、数値不具合は再現しなかった。fixture再生は元のMain/DBセッションでの本人目視と区別し、実入力成功の件数に加えない。

## 人工回帰と変更影響

最終同梱物でbase/settings/activation/migration/comparisonの5smoke、保存受入17件、型検査、関連unit60件、Native全7件（C# policy assertions651）が成功。f22db85の`windows-quality`も成功。重複ACK・保存後通知・保存失敗・retry・2件目rollback・非再通知、学習3状態の全9組×2複合は隔離fixtureとして確認し、自然入力の全組合せを実施したとは扱わない。

session23のダブルクリック／最小化／連続Win+Downと11負例、session21の四隅状態混在、session17の最大化状態混在等はそれぞれ当時のrevisionの証拠として保持する。最終上端修正は最大化dragの解放閾値と共有tolerance関数だけで、W01/W04/W11/W12の入力判定やCoreの学習／保存／通知適格性は変更していない。旧自然入力を最終buildの再実施と数えず、変更影響は最終buildのsession25/26と全policy／同梱fixtureで再確認した。

UI replayは `node scripts/acceptance/records-renderer-replay.mjs` で再実行できる。Native/helperを一切起動せず、実入力・画像・通常userData・元DBの書込みを使わない。最初は画面の単位「回」を含めない期待値でfixture assertが失敗し、数値や製品を変えず単位付き期待へ修正して成功した。esbuildの初回sandboxアクセス失敗とPowerShell GUI起動の結果未回収も準備エラーとして区別した。

専用レビューは変更段階ごとに実施し、最終の1dc4481以降の本番差分は4観点で指摘なし。追加のrenderer replayハーネスは最終レビュー対象に含める。製品パッケージの再buildは行わない。

## 環境と証拠の限界

[静的環境](../evidence/issue-47/environment-final-20261031.json)：Windows 11 build 26340、物理解像度2880×1800/200%と2560×1440/100%の非重複上下2画面。Chrome version156.0.8078.74、Explorer version10.0.26100.9949（静的metadataで、試行ウィンドウとの個別の実行ファイル対応ではない）。Windowsの配置・scale・設定は変更していない。WinFormsの旧osBuild9200とsystem-awareの論理boundsを実OS build／物理解像度と混同しない。

実アプリの通常ウィンドウ・標準UI・複数ウィンドウ、同画面操作と画面移動を含む条件での機能確認であり、全環境／全DPI／認識率95%以上を保証しない。異常・未完了・追加操作・本人報告との対応不明の原本は[診断経緯](corner-release-diagnosis-20261030.md)と各session別添へ保持する。session19のSIGTERM原因は未確定だが、session25/26はcode0で正常終了した。

## #48への引継ぎ

製品の公開・配布・署名・NSIS導入／再導入／削除・通常60分の受入は実施しておらず、#47の結果で代替しない。トレイアイコンはユーザーが見つけられず、今回は既知の最小化ウィンドウを直接開いて一覧を確認した。実トレイからの発見・再表示と通知activationは#48の実機確認へ明示して渡す。また現行記録画面の既存footnoteに「11操作とも検出精度は未検証」という旧文言が残るため、8操作の正式UI文言との整合も#48で修正・確認する。後続mainや別PRで本番動作が変わった場合も、このhashを新しいbuildの成功へ読み替えない。

## 最終レビューの保留条件

全体レビューで、記録UIについてP1の受入不足を指摘された。renderer replayはfixture Main handlersと合成coverageであるため、実セッションのDB→本番Main/IPC→記録画面（欠測表示を含む）を代替しない。現時点で#47はこの条件をBLOCKEDとして維持し、#48へ移して完了扱いにしない。

元の終了済みsession26のrecords-v1を隔離rootへ複製し、DB hash一致・8操作・integrity=okを確認した。製品パッケージは変更しない。既存の `--ui-acceptance --ui-acceptance-exit` は本番Main/Store/Worker/IPCで複製DBを読み、Nativeだけfixtureとして実入力を観測しない。ただし自分のアプリ画面16枚をローカル保存するので、AGENTS.mdの画面画像保存禁止に対する本人の明示許可待ちであり、まだ実行していない。通常データや他アプリの画像は使わない。許可されるまでは人工replay成功を根拠にmerge/Closeしない。

## P1対応：元DB複製を本番Main／IPCで確認

本人は2026-10-31、今回の試験アプリ自身の16枚のローカル保存・確認を明示許可した。通常データ・他アプリ撮影・画像公開は許可範囲に含まず、実行もしない。

終了済みsession26のrecords-v1をbyte単位で新しい隔離rootへ複製し、変更していないf22db85同梱exeを `--ui-acceptance --ui-acceptance-exit` で起動した。`COACH_TEST_DATA_DIR`は複製root。本番のMain／Store／SQLite Worker／Core／IPC／renderer／preloadを通し、Nativeだけ既存fixtureモードにして実入力hookを使わない。Main handlersの置換や合成countsの注入は行わない。

[本番DB経路の結果](../evidence/issue-47/session26-original-db-ui.json)は一覧／記録各8条件の計16条件を完走、全条件8行・横overflowなし・要求viewport一致、code0で正常終了。16枚はcontact sheetと原寸の記録画面で確認し、全体40.0%・shortcut8回・mouse12回、見えている操作別の率・分数、前期間の欠測「—」と注意表示を照合した。全8行の値と欠測flagは、[元DB／複製DBの本番public read model一致](../evidence/issue-47/session26-original-db-ui-model.json)でも確認した。copied sessionとウィンドウ位置保存でrevisionは増えるが、全8行のmouse/key/total/rate/previous/comparisonとsummaryは元DBと完全一致する。元DB SHA-256とpackage全550ファイルのmanifestは実行前後で不変、複製DB integrity=ok、count変化0。画面画像は.tools配下だけに保持し、Git／GitHubへ含めない。

初回は最初の一覧800×600の本文y=243（期待191）で中断し、画像0枚。原因となる表示本文を取得できず、[初回部分結果](../evidence/issue-47/session26-original-db-ui-first-attempt.json)を保持する。同じ元DBから新たに複製した再試験では起動失敗の固定カテゴリなし・全16条件成功。終了後の値比較はSQLiteのnull-prototype rowとJSON objectの型差だけで一度失敗し、値を変えず通常objectへ正規化して後検査を回収した。UI撮影の追加再試行で隠さない。初回の一過性の位置差は原因解決と主張せず、#48の起動／通常利用で監視する。

補足のUIA text確認用に保持したfixtureは、ツールでウィンドウを選択できず所有者制御で終了した。Native実hookなし、元DB不変、画像hashは正常終了した試験と全16枚一致、fixture終了後のapp/helper/panel残存0。この制御終了を、上記16条件の正常終了や自然入力session26の正常終了と混同しない。

P1が指摘した「fixture Main handlersでは本番DB→IPC→記録画面を代替できない」という点を、この実DB複製＋変更していない本番Mainで埋めた。元の本人の曖昧な目視申告を成功へ書き換えず、本番経路の追加証拠で受入を判断する。P1対応の再レビューを依頼し、その結果と最新head CIを確認してからmerge／Closeする。

## 最終判定

2026-10-31、専用reviewerの4観点再レビューが完了し、前回P1は本番DB複製→変更していない同梱Main/Store/Worker/Core/IPC→画面の証拠で解消と確認された。元DB／package hashと全public model一致を独立確認し、#47の必須条件に未確認の残りはないとの結論。元の本人目視の不確実性や各失敗原本を消さず、人工replayを実入力として数えたり#47の条件を#48へ移したりしていない。

最初のP1再レビューはCodex利用上限で中断され、完了扱いにしなかった。再実行を完走して上記判定を得た。レビュー対象の本番コードはf22db85、fixtureコードは[レビューreceipt](../evidence/issue-47/final-review.json)にhashを固定。以後の更新はこの証拠／文書とPR説明だけで、追加の製品buildは作らない。merge前に最終commitのwindows-quality成功を必ず確認する。#48の通常60分・導入／配布等のゲートは別途残す。
