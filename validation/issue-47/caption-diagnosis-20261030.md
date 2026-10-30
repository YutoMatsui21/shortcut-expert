# Caption操作の残る3件の診断

一般窓修正後の製品ソースは`24bd47c4a29ec44b6a87fd748b62943e079b18d4`、manifest SHA-256は`a29277ed352313e5c2632bfc60ec11b9b34d14ea709cf6f941017ed015440c7d`。

session3の10ケース中、P03m／P04m／P03k／P04k／S04-min-max／S04-min-normal／S04-repeatの7件は記録・通知要求が期待値と一致した。S03-double／S04-double／S03-dragは候補が各1件届いたが、Core採用0件、保存0件、通知要求0件だった。本人は3件とも窓の最大化・復元・最大化が成立し、通知が出なかったと明示した。

[status原本](../evidence/issue-47/session3-status.json)、[本人確認](../evidence/issue-47/session3-participant.json)、[build](../evidence/issue-47/session3-build.json)、[正常終了](../evidence/issue-47/session3-exit.json)、[SQLite整合性・hash不変](../evidence/issue-47/session3-integrity.json)。元のパネル確認欄は未選択だったため書き換えず、本人申告を別原本にした。

原因は未確定。captionのhit判定、double-click／dragとの入力相関、期限／対象照合／最終形状等を区別する。通知設定や保存障害と決めつけず、製品の採用条件を変更せずに診断を追加する。

## 診断の境界

- `--final-natural-acceptance`の空の隔離userData・手動ARM〜FINISHだけで収集する。Mainは受入用`ALL`モードのときだけNativeの`--window-validation-consented`を選ぶ。通常の`--observe`とfixtureでは収集しない。
- Nativeはmouse down/up、対象不成立、NCHITTESTのcaption/client/button/other、TITLEBARINFOEXの取得成否と包含の真偽、最終hitカテゴリ、前面一致、move start/endを理由別に最大1000で集計する。窓名・process名・座標・入力時刻列・操作順序は送信しない。
- stop時にgeneration付きの集計を1回だけ送る。取り出した集計は退役し、再stopや全停止試行へ前件を混ぜない。Mainは完全な固定キー集合・整数0〜1000・generation一致を検査し、全停止試行でも受け取らない。
- Main受信候補はkind・origin・routeの固定カテゴリ、状態・arranged・照合／注入／競合／moving、同画面か、経過の範囲カテゴリだけを集計する。候補原文・経過値・座標・自由文字は保存しない。診断と`classifyGesture`の採用判定を分離する。
- C# enumとTS allowlistはnative-policy結合試験で照合する。TSの未知文字列／prototype名／過剰値／欠落キーを回帰試験で棄却し、前件集計・上限・世代リセットも本番C#集計器で試験する。

次の自然入力は、同じ代表窓で失敗した3ケースだけ各1回まとめて行う。新しい診断結果で仮説を区別してから製品修正を判断する。診断版の成功や、旧buildでの7件成功を同一最終buildの#47全面合格とはしない。

診断追加の関連unit34件、型検査、C# policy539検証とtaxonomy／Core／SQLite結合、helper buildが成功。専用レビューのP2（全停止試行への前件集計混入）を修正し再レビューで指摘なし。修正後の同梱helper hash一致、隔離smoke、保存受入17件も成功した。正常系の採用判定の変更ではなく、原因調査の準備完了である。
