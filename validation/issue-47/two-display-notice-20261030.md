# 上下2画面でのW02案内とsession9

## 観測と仕様

対象は `a4e62d839581340c4380a62d96717318adcd29ff`、通常観測・診断OFFの `session-tZXsLe`。本人は9件のウィンドウ変化・表示を期待どおりと報告したが、6・7の通知に移動が含まれない点を質問した。原本は `../evidence/issue-47/session9-*.json`。

- 1・2：正常起点から左上・左下W07各mouse+1、通知各1。
- 3：単独マウス移動は候補・W02記録が0。通知0だけで合格にせず、検出側の未解決事項とする。診断OFFなので原因は未確定。
- 4・5：上下2画面でWin+Shift+←／→を各1回、別monitorへの移動とW02 key+1を確認。
- 6・7：各1つのcompound候補からW02＋W03／W07各mouse+1、通知各1。ただしW02行は欠落。旧実装の期待値一致であり、完全受入PASSではない。
- 8・9：W11 mouse/key各1、通知はmouseだけ1。
- 終了code0、read-only integrity_check=ok、同梱build hash不変。本人申告と機械観測は分離して保存。

製品要件の複合操作では、適格な2操作を1つの通知に別行で案内する。キー不明の記録のみfallbackは許されるが、完全対応を意味しない。上下配置でW02通知を除外すると最終合意した事実はない。旧実装の横並び制限を今回の受入期待値として説明したのは不適切だった。

## 修正と検証範囲

非重複の2画面だけで構成が安定し、同一ウィンドウがもう一方へ移動した証拠をNativeから `twoDisplayLayoutConfirmed` として渡す。左右方向は捏造せず、上下ではnullを維持する。左右方向が確証できる既存経路を優先し、それ以外の確証された2画面ではWin+Shift+←を案内する。キー由来では実入力の←／→を維持。3枚以上・重複・不明構成へ拡張しない。保存形式・操作件数・通知上限は変更しない。

修正前に最大化／quarterのW02行欠落を回帰テストで再現。修正後にCore→実SQLite→通知adapterの2行・1通知、単独移動、キー両方向、証拠欠落／型不正／重複画面、Nativeの完全画面数・安定性・protocol伝達を検証。

ローカル専用レビューでは、新ケースの固定←期待が横並びの右移動と衝突するP2を指摘。新ケースを上端の高さが異なる2画面専用と明記して解消。製品ロジックの追加指摘なし。文言だけの修正につき再レビューは省略し、型検査と関連ケースを再確認する。

修正後の自然入力・実OS通知は未確認。旧試行を新buildの合格へ付け替えない。単独マウス移動の未記録は本修正で直ったと扱わない。Issue #47は継続中。

検証結果：全unit301件、Native全7件、型検査、helper build成功。同梱版の5種類smokeと保存受入17件成功。レビューによる手順文言の限定後に再bundleし、base smoke・保存受入17件を再確認。Native全473ファイル一致。固定build manifestは `../evidence/issue-47/two-display-build.json`。NuGet脆弱性index取得NU1900警告あり。Electron試験のsandbox環境での読取エラーは通常環境の隔離試験で解消し、ACLは変更していない。

## 修正後の自然入力（session10）

`b47e75b`、固定hash `1c8fab6922d8d772cad5db491fc755adbd2afd680196c161193f8ead0a284129`、通常観測・Native診断OFF。`C03-two-displays`／`C07-two-displays`の各1回で、候補は各1つのcompound、W02＋W03／W07のmouse各1、通知要求各1・2操作のキー案内一致。本人も両件の動作・表示が期待どおりと報告。原本の確認欄は未選択なので書き換えず、本人申告を別添に保存した。終了code0、read-only integrity_check=ok、build hash不変。`../evidence/issue-47/session10-*.json`。

これにより今回環境・当該buildの複合2行通知を確認した。全8操作の最終受入、キーを順に押した複合全体の再現、別構成への一般化は合格へ転記しない。b47e75bの最新head CIはwindows-quality／change-scopeとも成功。

## 単独mouse移動の診断準備

session9 trial3はNative候補0件で原因不明。複合通知の修正で直ったと扱わず、通常終端経路の棄却理由を追加する。非重複の固定カテゴリだけを上限1000で数え、同monitor、解放不明、解放monitor／work不一致、終端状態不適合、StableMove不成立、入力不適合、foreground不一致、採用を分ける。最大化終端への分岐も固定カテゴリで識別する。既存のガードの順序・採否を維持し、通常モードは診断を保存しない。

診断追加前に、採用自体は成立するが理由カテゴリがないためassertが失敗する回帰試験を確認。10条件で診断ON/OFFの候補同値と期待理由を照合する。新たな自然入力はこの診断を有効にした隔離試行で行い、通常移動の往復方向・戻し・Esc取消をまとめて切り分ける。原因確認前に採用条件を緩和しない。

診断版検証：関連unit35件、Native全7件、型検査、helper build、同梱base smoke、保存受入17件が成功。新71カテゴリはC#/TS一致、診断ON/OFFの10条件採否同値を確認。専用ローカルレビューは4観点で追加指摘なし。manifestは `../evidence/issue-47/normal-drag-diag-build.json`。settings等の動作変更はなく、b47e75bでの5種smokeを履歴として保持するが新buildの全自然入力合格へ転記しない。

## 単独mouse移動の再確認（session11）

`b80e645`、固定hash `8fdefa1d6dbff47436f132e1b4d76fa8868af9e0287bcd5df8b083d49df5dd4f`、診断ON。4件すべて有効・期限内で完了。`../evidence/issue-47/session11-*.json`。

- 上→下／下→上の通常drag：各1候補、W02 mouse+1、通知各1、`MoveAccepted=1`。本人も期待どおりと報告。
- 同じdragで元画面へ戻す：候補・件数・通知0、`MoveSameMonitor=1`。
- Esc取消：候補・件数・通知0、終端は`DragNoSource=1`。取消後の候補を採用しない。
- 終了code0、read-only integrity_check=ok、hash不変、起動した同梱アプリ／helper残存0。

session9 trial3の未記録は今回は再現しなかった。元のtrialにはNative診断がないため、原因を操作不足・不具合のどちらとも断定しない。診断追加による採用条件の変更はなく、修正で直ったとは扱わない。今回の診断ON成功を通常モードの全受入へ転記しない。

次は同じ同梱build・診断OFFで8操作mouse/keyの16件と、ブラウザーのcaption double-click最大化／復元2件をまとめて確認する。W12は目視で番号を確認できる同じアプリ、他は保存不要のChromeまたはEdgeの通常ウィンドウを使い、panelのアプリカテゴリも対応させる。状態learning・pause/stopなし。各準備はIDLE中、ARM後の操作は各1回。ウィンドウ全体が移動先に入った通常位置でW02を確認する。browserの1操作成功を全アプリ一般の精度へ一般化しない。

この追記は実測原本・計画の文書のみ。本番動作変更がないためSkillの例外で追加コードレビュー・製品再buildは省略する。
