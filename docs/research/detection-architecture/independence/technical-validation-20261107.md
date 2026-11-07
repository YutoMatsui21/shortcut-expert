# 検出条件の技術検証（2026-11-07）

状態：調査結果・未採用。本番条件、製品要件、複合契約は変更しない。

対象revision: 55580f39e66fe9115ea8cd27293811e5d4a1d540。参考資料3件（current-detection-methods、ideal-feasibility-and-proposal、findings）と関連操作仕様を照合した。資料の基準revisionとは区別する。前回回答の「参考資料が存在しない」は今回の作業ツリーには当てはまらない。

## 結果

| 検証項目      | APIで実現可能か                                           | 現行条件の問題                                                   | 推奨する条件                                                  | 誤検出リスク                                         | 実機検証結果                  |
| ------------- | --------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------- |
| A W02         | 入力・始終monitor・状態の取得手段あり。安全性の実証は未了 | 最大化終端で開始normal必須、単独W02はnormal/non-arranged終端必須 | 有効な対象dragと始終monitor差。W03は別途非最大化→最大化で評価 | resize、アプリ独自移動、構成変更、開始snapshot誤取得 | Chrome/Dia/Obsidianとも未実施 |
| B W03         | showとarrangedの取得手段あり                              | 配置済み起点は既に許容。normalという名前を非配置と誤解しない     | 現行の配置済み許容と上端入力証拠を維持                        | 状態変更の因果、遅着、独自drag                       | 同上                          |
| C W06         | arranged＋DWM frame＋作業域からhalfを分類可能             | mouseはarranged起点を棄却                                        | 既知の開始配置と終端配置が異なることを追加                    | 同配置戻し、resize、未知shape                        | 同上                          |
| D W07         | 同様にquarterを分類可能                                   | Cと同じ                                                          | quarter終端＋対応側端解放、開始配置差                         | Snap bar内部選択、resize、未知shape                  | 同上                          |
| E 独自caption | 標準hit-test取得可能。独自UIの意味は取得保証なし          | fallbackはクリックと状態変化の相関                               | 標準判定優先。近接2クリック代替は試作比較に限定               | 本文2クリック＋アプリの状態変更が区別不能            | 同上                          |

## 条件変更と判断

### A

根拠：native-helper/Core/CandidateTracker.cs FinishMoveのarranged/maximized分岐とMaxStartInvalid、src/core/detector.ts classifyWindowのmonitor-move分岐。最大化→最大化は現在棄却。通常→最大化は適格なら複合候補。

削除候補は単独mouse W02の終了normal/non-arranged制約。最大化終端をW03の開始normal条件でW02ごと落とす分岐も変更が必要。ただしW03の非最大化起点条件自体は残す。単に最大化起点をCompound(maximized)に通すとW03を余計に計上する。

新たに最大化A→最大化BをW02のみと評価できる。配置済み終端も情報上は評価可能だが、W02+W06は既存契約外で採用しない。不正な既存複合証拠をW02だけに部分採用する変更も別の仕様判断。

未解決：MOVESIZEはmove/resize共通。HTCLIENTの独自タイトルバーで、resize開始を確実に除外できるか。MonitorFromWindowのmonitorは最大交差面積であり、カーソルmonitorとは異なる。解放先と結果monitor照合を保つと、大きな跨ぎウィンドウは意図的に見逃し得る。追加実機検証が必要。

### B

根拠：CandidateTracker.FinishMoveは開始Show=SW_SHOWNORMAL、Arranged既知を要求するがtrueを許容。detector.ts maximizeもmouseのarranged=nullを除外するのみ。WindowStateTests.csのstart-arrangedは肯定例、start-maximizedは否定例。

左右half/quarterはShow=normalになり得る。従ってhalf→上端最大化のための本番条件削除は不要。未知arrangedを許容することは別の緩和であり今回推奨しない。上端解放・同一対象・process・foreground・物理解放・構成整合は維持。現行条件の実アプリ受信確認が必要。

### C/D

根拠：PlacementGeometry.Dragのbefore.Arranged != falseとPlacementStartInvalid。Shapeは終端Show=normal、Arranged=true、DWM frame/作業域の1px照合を要求。CandidateTrackerはcaption押下も要求する。

非arranged起点の一律条件を置換し、開始Shapeと終端Shapeの差を追加する。右half→左half、左上→右上を許容。同形状への戻しは0。未知arranged/未知shapeを無条件に「異なる」としない。配置identityにはmonitorと作業域を含める。通常非配置起点は既知の非配置として扱う。

通常resizeが偶然half矩形になってもArranged=falseなら棄却する。もっとも未知hit-testの独自resize、アプリが自らarranged状態を変更する状況の安全性は未証明。現行のcaption条件、release strip、quarterの上下側照合を外さない。四隅そのものの公開hit領域を取得できたわけではない。追加試作・負例・実機確認が必要。

### E

標準方式：WindowCaptionのTITLEBARINFOEX矩形・WM_NCHITTEST・同root/processの子caption補完を優先。明示的部位証拠があるが、独自UIのHTCLIENTは意味不明のまま。

現行fallback：CandidateTracker.Completeはunknown clickを物理解放後500ms以内、4px以内、同対象・process、非注入・非競合・非drag、適格な終端変化でmouse-state-fallbackへ変換。通常クリックだけで状態が変わらなければ成立しない。しかし本文クリックでアプリ自身が最大化した場合も相関条件を満たし得る。

2クリック案：同root/process、左down/up×2、GetDoubleClickTime以内、SM_CXDOUBLECLK/SM_CYDOUBLECLKの範囲、非drag・非注入・競合なし、2回目直前状態と確定結果を照合。最初のクリックで既に状態変更した列を新しいdouble-click操作へ誤結合しない。1クリックfallbackと2クリック案は別々のshadow結果として比較し、両方を保存しない。

単クリックによる誤採用は減らせる可能性があるが、本文double-click＋状態変更は同じ観測となる。単クリックの独自最大化/最小化ボタンを失う。特に最小化のボタンを2クリック方式で代替するのは不適切。誤検出ゼロは保証不可、採用保留。

## 複合操作

| 入力前→入力後         | 現行条件      | 理想案の評価（未実装） |
| --------------------- | ------------- | ---------------------- |
| A最大化→B最大化       | 棄却          | W02のみ                |
| A通常→B最大化         | 適格なら複合  | W02+W03                |
| 同monitor half→最大化 | 適格ならW03   | W03のみ                |
| 右half→左half         | mouse起点棄却 | W06のみ                |
| 左上→右上             | mouse起点棄却 | W07のみ                |

Completeはdrags所有中とPlacement.Owns中の状態確定を抑制する。途中restore/halfを独立操作として評価せず、物理押下前snapshotと終端を比較する。これらは判定規則の静的評価であり、新条件を実装して成功させた結果ではない。MOVESIZESTART以前の復元イベント、ENDとreleaseの順序、終端遅着は実機で確認が必要。

W01の背後caption、W04の連続Win+Down、W11のDESTROY、W12のslot照合とW01排他を変更しない。W02+W06の採用には別途契約・parser/classifier・原子保存・通知の対応と仕様判断が必要。

## 検証証拠

今回実行：node scripts/test/test.mjs native --file=native/native-operation-policy.test.ts

結果：1 test成功、C# production policy assertions 1166、失敗0、skip0。本番C# policyの人工入力とTS契約の証拠であり、自然入力ではない。前回のTS関連56件成功とは別の実行。新条件の動作試作・実マウス試験・全CIは未実施。

## 実機手順（未実施）

1. Windows 11 build、Chrome/Dia/Obsidian版、helper/Electron hash、画面枚数・配置・DPI、Snap設定を固定。隔離データで実施し、通常製品記録と混ぜない。実入力観測開始の本人同意後にARMする。
2. 各アプリで表の5ケースを各5回、両monitor方向で物理操作。開始状態を作ってからARM、左押下→drag→解放→終端確定→FINISHまで待つ。初期設定操作は試験に含めない。
3. 負例：同じ配置へ戻す、monitorを跨いで元へ戻す、通常resize、Esc、別対象、追加キー/ボタン、本文single/double-click、上端Snap bar内部選択、同じ近接クリック後に別原因の状態変化。Eでは標準タイトルバーと独自ボタンも比較。
4. W01背後ボタン、W04独立復元/最小化とWin+Down連続、W11閉じる/取消、W12タスクバーを回帰ケースにする。中間W04/W06と追加通知は0を期待。
5. ログはcase ID、固定カテゴリの開始/終了show・arranged・shape、monitor変更bool、target/process一致bool、physical press/release確認、move/resize分類根拠、期限内bool、取消/棄却理由、各方式の判定件数、FINISHとhook解除に限定。座標・HWND・processは必要な一時照合だけ。入力時刻列、タイトル、URL、画像、生入力は保存しない。
6. 各caseを成功/見逃し/誤採用/操作不成立/未実施で集計。中断を成功扱いしない。未知snapshotや終端遅着は理由を分類し、閾値を推測で緩めない。

現行helperだけでは新条件の期待結果は生成できない。上記shadow比較に必要な隔離probeは今回未作成。従ってこの手順を既存helperで実施しただけで理想条件の実証完了とはしない。

## 公式API根拠

- [IsWindowArranged](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-iswindowarranged)：配置済みでもSW_SHOWNORMALになり得る。
- [GetWindowPlacement](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowplacement)：show状態と位置。
- [MonitorFromWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-monitorfromwindow)：最大交差面積のmonitor。因果やユーザー意図は返さない。
- [Event Constants](https://learn.microsoft.com/en-us/windows/win32/winauto/event-constants)：MOVESIZEは移動とサイズ変更の両方。
- [WM_NCHITTEST](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-nchittest)：部位分類。独自UIの意味を保証しない。
- [GetSystemMetrics](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getsystemmetrics)、[Mouse Input Functions](https://learn.microsoft.com/en-us/windows/win32/inputdev/mouse-input-functions)：2クリックの距離・時間を取得可能。タイトルバー操作の因果証明にはならない。

結論：A/C/Dは追加検証候補、Bは現行条件をまず実機確認、Eは識別限界があり採用保留。始終snapshotだけで十分なのは操作結果の分類であり、適格な入力の因果・取消・終端確定の証拠は引き続き必要。新アーキテクチャ、Gestures管理、Aggregatorは本調査の対象外。
