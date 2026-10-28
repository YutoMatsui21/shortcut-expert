# 初回8操作の成立性調査（#9）

**後続の仕様改訂（2026-10-28、試行原本は不変更）**：本台帳中の「上端別画面dragはW03のみ」「画面跨ぎquarterとW02は未決定」は、#9調査完了時の判断。現行では、drag終了時の別monitorへの移動＋最大化/quarterがともに確定すれば**W02＋W03/W07を各1件**計上し、通知は適格な項目を1Toastにまとめる。これは本人の新しい**仕様決定**であり、下記33試行が複合検出・原子保存・通知を実証したわけではない。新ゲートの検証事項は[#14](https://github.com/YutoMatsui21/shortcut-expert/issues/14)、実装は[#113](https://github.com/YutoMatsui21/shortcut-expert/issues/113)を参照。過去の記録と実測結論は上書きしない。

2026-10-28。[現行要件](ui-redesign-requirements.md)を正本とし、製品検出器の実装着手を判定する調査。製品コード・保存・通知は変更しない。旧11/12操作の件数・受入条件は適用しない。

**最終判定：制約付きで可5操作、現行必須範囲で未成立3操作、無条件の実装着手可0操作。** W12/W01は既存成果を再利用した。未成立は実現不可能という意味ではなく、必須経路・同等性・操作間の帰属を現存証拠で確証できないという意味である。#9は調査として終了できるが、#14と初回リリースの合格を意味しない。

## 判定と引継ぎ

| 操作 | 判定・実装可能な範囲 | 残る条件・引継ぎ |
| --- | --- | --- |
| W12 | **制約付きで可**。#6/#28の安定した主タスクバー1〜10番のapp icon click／存在する番号のWin+数字を再利用。結果HWNDの起動・選択成功は要求しない | secondary/overflow/変動/stale/番号不明はunknown。W01へ重複計上しない。#28は完了済み。#96の起動状態別・複数候補・11番目以降は初回の依存ではない。最終受入#47は別 |
| W01 | **制約付きで可**。#7/#29の直接clickとAlt+Tab最終確定、W12非重複を再利用。案内はAlt+Tab1候補 | owner/混合入力/不明対象はunknown。通常Edge宛てkeyの未達記載は、#29のCLOSED状態から合格と解釈しない。#47へ残す |
| W03 | **未成立（現行必須範囲）**。caption double clickと上端直接dragの最大化を新規実測。max button／Win+↑の初期実測も保持 | 別画面上端へのdragは本人決定でW03のみだが、Win+↑単独は画面移動込みの全体操作を代替しない。同一画面上端の直接drag、通常アプリの独自枠、複合操作の通知同等性は未確証。#31はblocked。既存研究の「実装へ」は全経路の合格ではない |
| W04 | **制約付きで可**。自作標準窓でrestore button／caption double click、通常/最大化からのmin button、Win+↓の復元→最小化とrepeatを観測。min buttonはTITLEBARINFOEXによる代替識別が成立 | WM_NCHITTEST単独ではmin buttonをcaptionと誤認した。#33で可視・有効・一意なbutton矩形と同じ対象の結果を照合する。1000msは固定値で精度保証ではない。製品の1件化、他入力/別窓/期限/停止、arranged起点、一般アプリは実装試験・#47へ |
| W06 | **制約付きで可**。非arranged通常窓から同一画面の左右halfへ、直接dragとWin+左右双方でarranged・可視rectの一致を実測 | #35で入力transactionと最終rectを結び、Win保持中のhalfは保留する。自由resize/取消/Snap Layout経由を除外。DPI awarenessは確認したが、混在scale・サイズ制限・別環境は未検証。許容差を広げて合格にしない |
| W07 | **未成立（現行必須範囲）**。四隅のmouse/key最終quarterを取得、Win保持のkey列では中間half→quarterを観測 | mouse上側2隅はmonitor変更を伴うがkeyは同一monitor。四隅全てで同じ最終monitorまで含む同等性とW02の優先順位は未確証。#37はblocked。左下key初回の競合原因は未確定、再試行の正常結果と分ける。独立half後の特定キー経路は本人指定で追加調査しないが、独立操作の非混同要件は維持 |
| W02 | **未成立（現行必須範囲）**。drag始終monitor比較、中央で離した移動＋派生復元は観測でき、検出基礎は再利用可 | 初期案内の「制約付き可」は終端移動の基礎だけの暫定評価。現行の上下2画面では方向付きWin+Shift+左右との同等性を新規実証していない。旧monitor番号も物理左右ではない。#38の必須mouse/key案内全体を着手可にはせずblocked。画面移動のみと上端最大化の終端分類を実装前に分ける |
| W11 | **制約付きで可**。自作active通常窓の×／Alt+F4と同じ窓のDESTROY、取消・hide・別窓DESTROYを外部WinEventで区別できた | #39で入力前target/processと結果を保持し、要求だけで採用しない。確認待ちの遅延、同一process内HWND再利用、tray/タブ×/独自枠・一般アプリは未確認。close後のforegroundをW01へ流さない |

**次に着手可能な候補は#33（W04）・#35（W06）・#39（W11）**。各操作の上記制約をG-W04/G-W06/G-W11の限定的な着手条件として#14へ渡す。#31/#37/#38は必須範囲の未成立を解消するまでblocked。#28/#29は既存完了Issueであり新規着手先ではない。UI・保存・通知を#14全体の完了待ちにはしない。

## 根拠と検証環境

調査開始時のローカルrevisionは`ce89f97190223b925a112518e666922fd5364379`。要件の2026-10-28更新を含む`c4f772740f5bd7acd7696b876959fec18f24dfbe`を取得し、その上の研究ブランチで記録した。製品のCandidateTracker/Observer/Coreを調査したが変更していない。

- W12：[既存研究](research-taskbar-input-validation.md)、#6/#28。Windows `10.0.26340.0`、主タスクバー1/2/9/10番、repeat、変動・overflow等の制約と原本hashを再利用。今回の実入力再試行は0。
- W01：[既存研究](research-window-switch-validation.md)、#7/#29/PR #108。2026-10-25の自作3窓、2026-10-26のChrome・自作窓、W12との非重複・負例の証拠を再利用。通常Edge keyと最終R02は未確認のまま。今回の実入力再試行は0。
- 初期W03/W02：[研究記録](research.md#measurements)、2026-10-09〜11のManualWindowProbe/ExternalWindowProbe。Windows build `10.0.26300`、PowerShell 7.6.6、Node 24.11.1、本人probeは2画面。シェルAPI-healthの1画面とは合算しない。初期source/exe hashは原本に欠け、当時buildの完全同定は不可。近接入力候補は`causalityConfirmed=false`。
- 新規実測：本人が明示承認し、手動ARM→対象窓を前面→入力解放→手動操作→F8/FINISH。Windows `10.0.26340`、自作WinForms窓A/B、主2880×1800（作業域2880×1704）・副2560×1440（作業域2560×1392）の2画面。本人申告は上下配置。per-monitor DPI awarenessとIsWindowArranged取得可を確認。各画面のscale値は採取せず、混在DPIを実証したとは扱わない。
- Framework64 cscでx64研究exeを生成。通常userData・製品helper/IPC/通知・UIA・キー送出を使用しない。起動・準備中は入力hookなし、ARM後45秒上限・session20分上限。WinEventは自作processに限定。保存は固定カテゴリと集計、始終state/shape、monitor変更bool、環境・hashのみ。タイトル・生キー・入力時刻列・座標履歴・画像は保存しない。

### 原本・版の対応

全33完了試行。ARM拒否2回は本人申告として別記し、完了試行数に含めない。各sessionに終了行と`hooksRemoved=true,unhookFailures=0`を確認。session3は最後のF8後も自作窓が残っていたため、exe絶対パスと所有PIDを照合し、自作窓だけへ通常の終了要求を送り終了行を確認した。通常アプリの配置・pin・設定は変更していない。

| session | 完了数 | source SHA-256 | exe SHA-256 |
| --- | --- | --- | --- |
| [1](../validation/evidence/eight-operation-20261028-session1.jsonl) | 4 | `b4f078bef514c371a34321e96532a37594bbaa1e2f13a57871a367d0449793bd` | `5b37132013ebbd4273d6616c2753375a609acccc6395e5c44af5fd31063960db` |
| [2](../validation/evidence/eight-operation-20261028-session2.jsonl) | 25 | 同上 | `62dbdcddd774324ead5d0b5dc95dfd231db124a98b3217f40e2ea79290eb31e3` |
| [3](../validation/evidence/eight-operation-20261028-session3.jsonl) | 4 | `003e5b6ce6908243b1d37b3e77e9cac1f09ff71062abc76ef7b530bbbece4444` | `17944feb794f877c6c23e3972be59dc02e0fef4ec820e655c36fc861dd7a3493` |

同sourceでもコンパイルごとのexe hashは異なる。各実測exeはその起動時に自己検査も通過した。測定したsource bytesは[原本保存先](../validation/evidence/eight-operation-sources/)に保持し、Gitの改行正規化を無効にした。[本人確認1](../validation/evidence/eight-operation-20261028-session1-operator.jsonl)・[2](../validation/evidence/eight-operation-20261028-session2-operator.jsonl)・[3](../validation/evidence/eight-operation-20261028-session3-operator.jsonl)は原本を書き換えず補足する。

### 新規実測の内訳

| 原本のtrial | 本人操作・観測 | 評価 |
| --- | --- | --- |
| S1-1 | caption double click、通常→最大化1、monitor変更なし、競合0 | 同一対象の直接経路と結果が一致 |
| S1-2 | 別画面の上端へdrag、開始/終了各1、top-centerで解放、最大化1、monitor変更あり | 本人確認により実施操作を特定。case欄は前のdouble-click名のままなのでラベル単独を正解にしない。分類は本人決定でW03のみ。キー全体同等性は未成立 |
| S1-3 | 最大化起点→別画面中央で解放、通常へ復元1、monitor変更あり | W02の入力・終端移動の基礎。派生復元を別W04にしない。最初2回のARM拒否は本人申告、記録された完了試行は1件 |
| S1-4 | 物理Win+↓2回、1000ms以内の間隔カテゴリ1、repeat0、復元1→最小化1 | 2回の物理操作と2結果を観測。製品が1件にまとめた証拠ではない |
| S2-1 | Win+↓長押し、物理押下1、repeat101、最小化1 | repeatと再押下を区別する入力情報を取得。repeat値は1試行の集計であり入力速度の評価ではない |
| S2-2/3 | restore button／caption double click、最大化→通常各1 | 入力経路と結果が一致 |
| S2-4/5 | 通常/最大化のmin button、最小化各1、hit testはcaption | 結果だけ成功、入力識別は不成立として保持。S3で別APIを検証 |
| S2-6/7 | ×／Alt+F4、同じAのDESTROY各1 | 閉鎖要求と結果の対応を外部WinEventで取得 |
| S2-8/9/10 | 確認でNo／hide／別Bを破棄。AのDESTROYはいずれも0、Bのみ1（最後のケース） | 取消・非表示・別対象破棄を閉鎖成功へ混同しない。確認ダイアログclickはexternalClicks1として区別 |
| S2-11〜14 | 左右halfのmouse/key各1、arranged=true、同一monitor、方向別half rect | 同じ形状のmouse/key結果を取得。入力経路を含めて採用する基礎 |
| S2-15〜18 | 四隅mouse各1、最終quarterとarranged=true。上側2隅はmonitor変更あり | 結果形状は一致。上側はkey試行との最終monitor同等性を未確証のまま残す |
| S2-19/20/22 | 左上/右上/右下key、Win保持2方向・解放1、half1→quarter1、競合0 | 中間halfを保留する必要をOS上で観測。製品の二重計上0は未検証 |
| S2-21 | 左下key、quarterには到達したがroute=mixed、競合2・Win解放3 | 本人は異常なしと報告したが入力経路不成立。原因を断定せずS3の正常例と区別 |
| S2-23 | 独立Win+←後にWin+↑、最終half-left、quarter0、競合あり | 本人もquarterにならなかったと回答。この特定キー経路の追加調査は本人指定で終了し、成功扱いしない。既存の独立操作境界要件は維持 |
| S2-24/25 | 自由resize／drag中Esc、非arranged・通常・half/quarter0 | 配置結果と直接入力の両方が必要な負例。resizeにもMOVESIZE開始/終了がある |
| S3-1/2 | 通常/最大化のmin button。hitCaption1・hitMin0、TITLEBARINFOEXのmin矩形一致1・不一致集計1、minimize1 | 標準自作窓で代替APIを実証。元のhit情報は保持し、結果から逆算してmin buttonと決めていない。独自provider一般化は不可 |
| S3-3 | 左下key、Win保持2方向・解放1、half1→quarter1、競合0、Win状態の2方式不一致0 | 修正したのは識別用診断だけ。初回不成立の原因が解消したと断定しない |
| S3-4 | Win+Z→区画click、half-left/arranged=trueだがunsupported-key・externalClicks1、MOVESIZE0 | 同じhalf形状でも直接drag/keyの経路ではない負例。W06やW03へ形状だけで付け替えない |

`causalAttributionProven=false,productPass=false`を全trialに保持。時間相関や単発試行では、同時program競合・全アプリ・認識率・誤通知率を証明できない。本人の実施・目視結果、API結果、人工policy、製品受入を別々に評価する。

## 操作間の境界と不成立時の代案

1. **W01/W12**：taskbar icon clickと有効Win+数字はW12だけ。foreground変更単独ではW01にしない。close/minimizeによる自動foregroundも同様。
2. **W03/W02**：本人決定により、画面をまたいでも上端直接drag＋最大化終端はW03のみ、別画面の通常位置で解放した移動はW02のみ。入力対象・drag終端・直接経路を確認する。単なるmonitor変更と最大化の同時発生では推定しない。W02起点の派生復元は独立W04にしない。
3. **W06/W07**：Win保持の方向入力列は終端まで保留し、中間halfを発行しない。Win解放・他入力・別対象・取消・停止で系列を区切る。実測は系列の存在と中間形状を示すが、製品の1件化は#35/#37の人工policy・統合試験で別途検証する。画面跨ぎhalf/quarterとW02の優先順位は未確定で、W03の本人決定を類推適用しない。
4. **W04**：同じ窓・process・入力経路の短い物理Win+↓再押下のみ継続候補。1000msは実装定数で精度保証ではない。他入力/別窓/foreground変化/期限/停止、repeat、arranged起点の境界は#33で実装試験する。
5. **W08/W10除外**：Snap Layout/Win+Z・Task View/Win+Tabとその選択経路は対象外。旧W08候補をCoreで拒否していることだけでは、選択後の全派生状態の排除を証明できない。S3-4の異なる入力経路を否定条件として使い、最終形状だけでW03/W06/W07へ帰属させない。Task Viewからの配置・切替の新規試行は行っていない。

代案は標準枠のbutton矩形＋入力対象＋結果照合、drag始終・構成世代の保持、Win保持列の終端保留。矩形/状態しか取れない独自枠、同等キー不明、方向不明、競合・欠落はunknown/非通知にする。hoverだけの記録や閾値拡大で必須条件を弱めない。

### APIの確認範囲

- [TITLEBARINFOEX](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-titlebarinfoex)・[WM_GETTITLEBARINFOEX](https://learn.microsoft.com/en-us/windows/win32/menurc/wm-gettitlebarinfoex)：min/max/closeの矩形と可用状態を得る。APIの仕様だけではproviderの実装を保証しないためS3で自作窓に対する取得を実測した。無効/非表示/画面外・空・重なる矩形は採用しない。API呼出しは自作窓に限定し20ms timeoutとした。
- [LowLevelKeyboardProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc)：callbackは対象キーの非同期状態更新前に呼ばれる。診断ではWin保持の記憶とGetAsyncKeyStateの差を集計するが、初回左下失敗の原因をこの仕様から推定しない。
- [IsWindowArranged](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-iswindowarranged)：方向・入力原因は返さない。DWM可視rectと作業領域を同じ座標系で比較し、3物理pxの固定許容差でhalf/quarterを分類した。別環境で許容差を広げる前に根拠が必要。
- [MonitorFromWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-monitorfromwindow)：最大交差面積のmonitorであり途中変化は完了ではない。最小化時は直前rectを使う。旧出現順番号を左右方向に読み替えない。
- [WinEvent constants](https://learn.microsoft.com/en-us/windows/win32/winauto/event-constants)・[WM_CLOSE](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-close)：イベントの提供は対象UIで確認し、要求と破棄成功を区別する。WinEvent購読でWM_CLOSEそのものを外部受信したとは扱わない。
- [公式ショートカット表](https://support.microsoft.com/en-us/accessibility/windows/keyboard-shortcuts-in-windows)：キー機能の根拠であり任意の起点・monitor構成・独自窓でmouseと同じ結果になる実測の代用ではない。

## 再現と検証

[研究source](../validation/probes/EightOperationProbe.cs)・[実行入口](../scripts/eight-operation-probe.mjs)。

```powershell
node scripts/eight-operation-probe.mjs --self-test
# 本人の明示同意と準備完了後のみ
node scripts/eight-operation-probe.mjs --observe-consented
```

ケース選択→Prepare/reset→ARM→Aを前面にし入力解放→6秒待つ→手動操作→解放→F8。F8はパネルが隠れていてもFINISHとなる。停止後は観測せず、終了で自作窓を閉じる。親process終了watchdogと独立した強制上限も設け、終了行がなければsession終了確認済みにしない。環境設定・通常アプリは変更しない。正常ケースは反復せず、不成立の入力識別だけを診断後に再試行した。

自己検査は初版22件、診断版30件（geometry・負座標・安全な出力・button矩形の状態/重複/境界）。窓表示・hookを使わない人工試験であり自然入力の証拠ではない。ローカル専用レビューで最小化後のrepeat取りこぼしを修正し、F8/親終了監視/解除失敗の計測を含め再レビューした。診断版のinterop・固定カテゴリ・privacy・解除処理も再レビューし、指摘なし。本番suiteは変更しておらず、実装Issueの試験や最終#47を代行しない。

未確認の一般アプリ・通常Edge key・混在DPI/構成変更・同時program競合・世代/遅延・実製品の記録通知・R02/J04・NSIS配布は残る。#9を閉じてもこれらを完了扱いにしない。
