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

## session4の診断結果

3件とも親のroot HWNDへの`WM_NCHITTEST`は`HTCLIENT`、TITLEBARINFOEX取得は成功したが押下点はBar矩形の外だった。前面・通常窓の照合は成立し、Coreにはorigin／route unknownの状態変化候補が届いた。double-click2件は入力の期限内であり、経過超過だけでは説明できない。dragではMOVESIZESTART／ENDも届いたがcaption押下が確認できていない。

[診断原本](../evidence/issue-47/session4-status.json)、[本人申告](../evidence/issue-47/session4-participant.json)、[build](../evidence/issue-47/session4-build.json)。この時点で製品の採用条件を緩和しない。親窓に照会していることが原因なのか、独自ドラッグ領域なのかを区別するため、実際のヒット先の子窓にも照会する診断を追加する。rootと同じ祖先・同じprocessを一時照合し、結果はcaption/client/other等の集計だけに落とす。子窓の戻り値をまだ本番のhit判定へ代入しない。3件は同じ親caption不成立を示すため、次は代表のS03-doubleを1回だけ確認する。

API根拠：[WM_NCHITTEST](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-nchittest)は送信先のWindowProcが返す領域分類で、HTCAPTIONとHTCLIENTを区別する。[Windowsのタイトルバー仕様](https://learn.microsoft.com/en-us/windows/apps/develop/title-bar)ではcaptionボタンを維持しつつ独自のドラッグ領域を定義できる。Explorerがどちらの実装を使うかは未確認で、公式の一般仕様だけで個別挙動を断定しない。

session4終了はCLOSED/error=trueとなり、ランチャーの終了結果がSIGTERMだった。原本の3試行は期限内・中断なしの結果として別保存しているが、session全体の正常終了とは扱わない。[終了原本](../evidence/issue-47/session4-exit.json)。その後、この同梱版のWindowObserver残存0を確認した。終了理由は未確定で、#47の終了条件を合格へ置き換えない。

## session5で確証した原因と製品修正

[status原本](../evidence/issue-47/session5-status.json)では、S03-doubleの2回の押下とも、rootがHTCLIENT、同一root祖先・同一processの実ヒット先の子窓がHTCAPTIONを返した。照会失敗・対象不一致は0。製品はrootだけのhitを使っていたため、同じ入力にorigin／route unknownを付け、Coreは記録・通知しなかった。[本人申告](../evidence/issue-47/session5-participant.json)、[build](../evidence/issue-47/session5-build.json)、[正常終了](../evidence/issue-47/session5-exit.json)、[SQLite整合性・build不変](../evidence/issue-47/session5-integrity.json)。前sessionの終了異常が繰り返されなかったことは確認したが、原因解決の証拠とはしない。

rootのTITLEBARINFOEX読取とボタン照合の後にHTCLIENTが残った場合だけ、子窓の明示的なHTCAPTIONでcaption入力へ補完する。同じroot祖先・processを10ms上限の照会前後で確認し、rootのボタン／resize／不明を上書きしない。失敗・子窓client／unknown／別root／別processは採用しない。childの情報から状態結果を推測せず、これまでどおりrootに対する入力→同一対象／process→最終結果をtrackerで照合する。子窓情報を通信・保存へ追加しない。

修正前に本番C#回帰試験でexpected HTCAPTION(2)／actual HTCLIENT(1)の失敗を確認。修正後はC# policy551検証とCore／SQLite結合が成功した。child-captionのdouble-click最大化／復元、上端dragの正例と、client／unknown／別対象／別process・ボタン優先の負例を追加した。結合試験のW03 mouse期待値2→4は新しい2正例の追加に対応し、既存期待値を緩めたものではない。製品修正後の自然入力は未実施であり、成功したとはしない。

修正後のNative全7件、型検査、同梱helper hash一致、通常/settings/activation/migration/comparisonの5種類の隔離同梱smoke、保存受入17件が成功した。専用ローカルCodexレビューでも指摘なし。helper publish後のrenameがEPERMとなったため、別のpublish出力をworkspace内の生成物フォルダーへコピーして同梱した。Windows設定やACLは変更していない。次はこの修正版で残る3ケースを各1回まとめて確認する。
