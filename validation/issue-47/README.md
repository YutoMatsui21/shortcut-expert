# Issue #47 最終受入

正本：[Issue #47](https://github.com/YutoMatsui21/shortcut-expert/issues/47)、[製品要件 §6](../../docs/ui-requirements.md#release-acceptance)。これは試験計画。未実施ケースの結果はすべて `unknown` とし、過去buildの成功を転記しない。

## 候補と証拠

- 製品ソース：main `64cdc61`（完全SHAと全同梱ファイルのSHA-256は `.tools/issue-47-candidate.json`）。製品変更後は新しい候補として影響ケースを再確認する。
- 同梱先：`release/issue-47/win-unpacked`。公開・インストールは行わない。
- 人工回帰：同じ同梱先で `node scripts/test/smoke.mjs --packaged --package-dir release/issue-47`。settings／activation／migration／comparisonも別結果として残す。
- 自然入力：本人の別途明示同意後のみ。新規の `.tools/validation/issue-47/session-<id>/data` に隔離する。通常userDataは使わない。
- 試行ごとに手動ARM→操作→FINISH。準備・窓選択・復元は観測停止中に行う。既存W01/W12パネルは各操作専用であり、他操作・複合を検証できたとは扱わない。8操作の有界計測を開始する前に、操作別件数と通知要求数を取りこぼさない計測入口を用意する。
- 各試行は原則1回。異常時は証拠を残し、入力受信／候補／保存／通知のどこで期待と異なるかを切り分けてから再試行する。

### 8操作の手動入口

2026-10-30、本人から自然入力試験の明示同意を受けた。現在の画面は上下／非整列の複数画面で、代表アプリはエクスプローラーとブラウザー。横並び環境の合格へ読み替えない。

~~~powershell
# パネルのコンパイルだけ（観測なし）
node scripts/acceptance/final-natural-acceptance.mjs --package-dir release/issue-47-final --compile-only
# 本人同意後の手動試験。起動時はhooks OFF
node scripts/acceptance/final-natural-acceptance.mjs --package-dir release/issue-47-final --observe-consented
~~~

専用の `--final-natural-acceptance` は同梱版・新規の空の隔離保存先を必須にする。パネルは固定ケースIDと固定カテゴリだけ送る。ARM後4秒の準備時間、45秒の試行上限、20分のsession上限がある。終了操作やパネル異常終了では停止を要求し、終了不能時はランチャーの期限で打ち切る。通常起動では専用制御を読み込まない。

実結果は `matched`（想定どおり）／`different`／`not-observed`、Toastは `matched`／`different`／`not-seen`／`not-expected`、キー同等性は `matched`／`different`／`not-tested` を本人が選ぶ。初期値は未確認。`recordsPassed` と `notificationRequestPassed` は件数・要求の機械照合だけであり、本人確認・同等性・環境条件まで含む総合PASSではない。日付変更・期限切れ・停止／保存異常は試行を無効にし、製品の精度失敗と区別する。

現在の非整列構成では `P02m-unknown`、`P02k-unknown-left/right`、`C03-unknown-left`、`C07-unknown` を使う。W02は記録とキー案内の確証を分け、mouseのW02単独通知は0件、複合ではW03／W07だけを案内する想定。横並び前提のケースをそのまま適用しない。

## 結果の記録

ケースごとに `pass / fail / unknown / N/A`、入力種別、対象アプリの固定カテゴリ、起点・実結果の固定カテゴリ、8操作それぞれのmouse/key日別件数差分、通知要求数、表示されたキーの一致、本人によるToast可視確認、一覧／記録の一致を記録する。N/Aには理由を付け、未確認の必須条件をN/Aで合格へ置き換えない。

6契約（入力由来・対象と実結果・同等キー・日別SQLite・保存後通知・負例非計上）は独立した結果とする。キー入力は通常通知0件。通知APIの要求／showイベントと本人が見たToastは別証拠。同等性不明ならunknownのまま残す。

保存・送信するのは承認済み日別集計と固定カテゴリの試験結果・build hashだけ。文字、生キー列、入力時刻列、活動履歴、窓名、URL、ファイル名／パス、clipboard、画面画像は含めない。対象窓の識別は試行中の一時照合だけとする。

## 正例マトリクス

以下は期待値。実測結果ではない。基本条件は学習中・通知pauseなし。別の操作が増えた場合は、その操作を意図して行ったかを確認し、推測で試行へ帰属させない。

| ID | 操作 | mouse | key | 期待する記録 |
| --- | --- | --- | --- | --- |
| P12 | W12 | 主タスクバーの存在するアプリアイコン | 対応するWin+数字 | W12だけ+1、番号一致、W01は0 |
| P01 | W01 | 背後の通常窓を直接click | Alt+Tab | W01だけ+1、W12は0 |
| P03 | W03 | 通常窓の最大化ボタン | Win+↑ | 通常→最大化、W03+1 |
| P04 | W04 | 最大化窓の復元ボタン | Win+↓ | 最大化→通常、W04+1 |
| P06 | W06 | captionから左右端へ直接drag | Win+←／→ | 対応するhalf、W06+1 |
| P07 | W07 | captionから四隅へ直接drag | Winを保持した左右→上下の順次キー | quarter、W07+1、途中W06は0 |
| P02 | W02 | 別monitorの通常位置へdrag | Win+Shift+←／→ | W02+1、派生W04は0 |
| P11 | W11 | 閉じるボタン | Alt+F4 | 同じ窓の破棄、W11+1 |

基本16ケースは代表外部アプリの通常窓で行う。標準captionとブラウザーの両方、複数窓を含める。自作窓は補助であり一般環境の代用にはしない。

| ID | 追加の正例・境界 | 期待 |
| --- | --- | --- |
| S03a/b | captionダブルclick／同monitor上端drag | W03 mouse+1ずつ |
| S04a/b/c | captionダブルclick復元／通常窓の最小化／最大化窓の最小化 | 各W04 mouse+1、起点に対応する案内 |
| S04d | 最大化からWin+↓を1000ms以内に物理再押下 | 最終最小化、W04 keyは合計1 |
| S06 | 左右それぞれのhalf | 対応するW06だけ |
| S07 | 四隅それぞれ、通常／最大化起点 | 対応するW07だけ、W04/W06は0 |
| S01 | 複数TabのAlt+Tab後にAlt解放 | 最終切替のW01 keyは1 |
| S12 | 存在する1番・10番、起動／復帰でのアイコン操作 | W12だけ、Win+1／0が番号と一致 |
| C03 | 別monitorへdragして最大化 | W02とW03 mouse各1、W04/W06は0、通知要求最大1 |
| C07 | 別monitorへdragしてquarter | W02とW07 mouse各1、W04/W06は0、通知要求最大1 |
| Ckey | W02と終端操作の案内キーを独立して実行 | 各キーの対象と実結果を確認。複合全体と同等とは推測しない |
| Cunknown | 方向不明の画面構成で複合成立 | W02は記録のみ、W03/W07の案内を独立判定 |

## 重要負例

| ID | 操作列 | 期待 |
| --- | --- | --- |
| N01 | Alt+Tab取消／元窓へ戻す／同窓click／Edgeタブ内切替 | W01誤計上・誤通知0 |
| N12 | 存在しない番号／追加修飾／長押しrepeat／非アプリアイコン | W12誤計上・誤通知0。長押しの初回有効入力は1 |
| N02 | drag中に別画面へ入り元画面へ戻して終了／Esc取消 | W02は0、派生W04は0 |
| N03 | Snap Layout内部選択／入力なしのprogram状態変化 | 対象外経路をW03へ帰属しない |
| N67 | 配置drag取消／途中halfから同じWin保持列でquarter | 取消0、quarterだけW07+1でW06は0 |
| N11 | 閉鎖確認dialogを取消／窓をhide／タブの× | W11誤計上・誤通知0 |
| N810 | Win+Z／Win+Tabと選択経路 | W08/W10を記録・通知しない。選択を他操作へ推測帰属しない |
| NC | 複合drag取消／元monitorへ戻す／programだけの変化 | 複合2件を誤記録せず、派生W04/W06も0 |

## 横断条件と終了

- 基本操作は学習中／習得済み／対象外、pause／stopで保存と通知を照合。複合は両操作の3状態の組合せ（9組）と方向不明を含め、記録2件と適格行だけの最大1Toastを確認する。
- 保存失敗・再試行・ACK喪失・同一ID再配送・2件目rollback・非再通知は隔離fixtureで確認する。自然入力と組み合わせた未確認条件はunknownとして残す。通常データやディスク全体を壊す操作はしない。
- Windows build、代表アプリのバージョン、横長画面の解像度／scale／monitor相対配置、主タスクバーの固定カテゴリを記録する。OS／registry設定変更は別途合意なしに行わない。現在環境が不足する場合はJ04を未確認として残す。
- FINISH／取消／期限切れ／パネル終了で観測を止める。終了後は自分が起動したhelper停止、SQLite read-only再openとintegrity_check、build hash不変、通常データ不使用、設定復元を確認する。
- #48へ、固定build/hash・ケース別結果・異常原本・未確認環境を引き継ぐ。全必須条件が埋まるまで#47は完了扱いにしない。NSIS受入・公開判断は別途残す。
