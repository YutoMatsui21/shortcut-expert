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
