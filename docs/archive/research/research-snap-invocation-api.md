# Snap Layout呼び出し推定のAPI調査（Issue #83）

> **履歴資料／現行の実装・受入条件ではありません。** W08（Snap Layout／Win+Zの呼び出し）は初回公開の8操作から除外されています。ここにある「確定」「未達」「次工程」「OPEN」や試験回数・合格率は**記録当時の判断**です。将来この機能を再検討するときの参考として残し、現在の対象・承認済み条件は[製品要件](../../ui-requirements.md)を優先してください。

調査日：2026-10-23。Microsoftの公開資料を確認した結果。これはAPIの保証範囲の整理であり、実機試験の合格記録ではない。製品の検出器・保存・通知・操作の受入条件は変更しない。

本人による8ケース・追加試験と、最終的に採用するAPI選択・unknownの扱いは[実測と確定判断](research-snap-invocation-validation.md#追加調査で確定した実装判断)を正本とする。

## 入口と保証されない点

Microsoftは、最大化／復元ボタンへのホバーとWin+ZをSnap flyoutの入口として説明している。設定UIにはSnap全体と最大化ボタンのホバー表示の選択肢がある。一方、この説明から入力の発生だけで表示成功を証明することはできない。[Snap Your Windows](https://support.microsoft.com/en-us/windows/experience/snap-your-windows)

独自captionの場合、Win32アプリは最大化／復元ボタンの`WM_NCHITTEST`に`HTMAXBUTTON`を返す対応が案内されている。したがって、標準captionとChrome等の独自captionで取得値を比較する価値がある。ただし他プロセスからその応答を得たことは、実際のflyout表示や全アプリのSnap対応の証明にはならない。[Support snap layouts for desktop apps on Windows 11](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-snap-layout-menu)

## Win+Zと対象ウィンドウ

- `GetForegroundWindow`は前面ウィンドウを返し、activationの変化中などはNULLにもなる。非NULLを「Snap対象」とみなすAPIではない。[GetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow)
- `GetDesktopWindow`は画面の土台となるdesktopウィンドウ、`GetShellWindow`はShellのdesktopウィンドウを返す。後者はShell不在時にNULLとなる。両方との一致を除外の根拠にできるが、これだけでdesktop配下の全hostを識別できたとはしない。[GetDesktopWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdesktopwindow)、[GetShellWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getshellwindow)
- `GetAncestor(..., GA_ROOT)`はparent鎖、`GA_ROOTOWNER`はparentとowner鎖をたどる。対象照合で両者を混同しない。Explorerというprocess名だけの除外では通常のExplorerウィンドウも除外するため、desktop選択時との実測比較が必要である（この後半は設計上の判断）。[GetAncestor](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getancestor)
- `WS_MAXIMIZEBOX`は最大化ボタン、`WS_THICKFRAME`はサイズ変更枠を示す。これらは候補の制約に使えるが、Snap対応の確定APIではない。独自captionや例外アプリの網羅性は別に検証する。[Window Styles](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-styles)

`WH_KEYBOARD_LL`はキーdown/upを観測できるが、callbackは非同期キー状態の更新前なので、callback内の`GetAsyncKeyState`をその入力更新後の状態として扱えない。callbackを短く保ち、他ウィンドウへの問い合わせをhook内で待たせない。タイムアウトでhookが通知なく外れる可能性があるため、hook登録成功だけで全試行を観測済みとしない。[LowLevelKeyboardProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc)

`KBDLLHOOKSTRUCT`には`LLKHF_INJECTED`と`LLKHF_LOWER_IL_INJECTED`があるが、通常のキーmessageのrepeat countはない。down状態を保持して同じZのdownをkeyupまで重複採用しない方針が必要になる（設計上の推論）。注入flagなしだけで物理入力を完全に証明したとも扱わない。[KBDLLHOOKSTRUCT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-kbdllhookstruct)。押し続けでdown messageが反復する一般動作は[About Keyboard Input](https://learn.microsoft.com/en-us/windows/win32/inputdev/about-keyboard-input)を参照。

## ホバー対象と問い合わせ

1. `GetCursorPos`はscreen座標を返す。入力desktopと実行desktopの一致およびwindow station権限が必要である。取得失敗をホバーなしの正常な負例へ置き換えない。[GetCursorPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getcursorpos)
2. `WindowFromPoint`は点のウィンドウを返すが、hidden／disabledウィンドウは返さず、static textには例外がある。前面ウィンドウと一致させず、点直下のウィンドウからrootを照合することで非アクティブウィンドウも調査できる（後半は設計上の判断）。[WindowFromPoint](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-windowfrompoint)
3. `WM_NCHITTEST`の`HTMAXBUTTON=9`は最大化ボタンを示す。座標はscreen座標の符号付き値として扱う。通常このmessageはマウス移動や`WindowFromPoint`等でも発生するが、受信側の`WindowProc`を呼ぶ問い合わせなので副作用ゼロを保証するものではない。[WM_NCHITTEST](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-nchittest)
4. `TITLEBARINFOEX`はcaption要素の状態とscreen座標を提供し、index 3が最大化ボタン。`cbSize`を初期化して`WM_GETTITLEBARINFOEX`へ渡す。独自captionで空・不整合・非対応ならunknownとし、矩形が得られたことだけでSnap表示可とはしない。[TITLEBARINFOEX](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-titlebarinfoex)、[WM_GETTITLEBARINFOEX](https://learn.microsoft.com/en-us/windows/win32/menurc/wm-gettitlebarinfoex)
5. `SendMessageTimeout`には`SMTO_ABORTIFHUNG`、`SMTO_ERRORONEXIT`を使う余地がある。ただし同じqueueのウィンドウでは直接呼出しになりtimeout値が無視される。全体の実行期限は別process等でも制限する。戻り値0はtimeoutを含む失敗で、`GetLastError`が常に原因を設定するわけではないため、失敗を「最大化ボタンではない」へ変換しない。[SendMessageTimeoutW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeoutw)

## 設定と閾値

`SPI_GETWINARRANGING (0x0082)`の公開契約は、上位ウィンドウをdrag／sizeするときのwindow arrangement全般の有効状態である。Windows 11のSnap Layout専用状態やWin+Z・hoverの各可否を個別に返すとは書かれていない。`SPI_GETMOUSEHOVERTIME (0x0066)`も`TrackMouseEvent`が`WM_MOUSEHOVER`を生成するまでの時間であり、ShellのSnap flyout閾値の公開契約ではない。[SystemParametersInfoW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfow)

今回参照したMicrosoftの公開API資料では、`HKCU\Control Panel\Desktop\WindowArrangementActive`および`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced\EnableSnapAssistFlyout`の値を、Snap Layoutの各入口に対する互換性保証付き判定APIとする根拠を確認できなかった。値を読む場合は**検証候補**と表記し、欠落・型違い・読取失敗を有効へ補完しない。未確認の値を根拠に試行を合格にしない。設定UIで全体ON/OFF・hover ON/OFFを変更した各状態において、取得値、Win+Z、hoverの目視結果を同時に照合する。

ホバー時間の候補は短・境界・長で試し、実際の表示と推定の差を測る。ポーリングのsample間隔、問い合わせ時間、境界誤差も報告する。同じウィンドウ・同じ最大化ボタン内の継続滞在は1回とし、退出後の再入場と対象ウィンドウ変更を別に検証する。ここで選んだ閾値はprobeの実験値であり、OSの内部閾値を特定したとはしない。

## 実機で未確認の項目

この資料単体では8ケース、desktopフォーカス除外、非アクティブウィンドウ、標準caption／Chromeの差、問い合わせの副作用、設定値の対応、表示までの時間、repeat／退出再入場、および自然入力の各20回以上・95%以上／負例誤記録0を未確認。最終結論は、probeの試行IDに対応する本人の表示確認と陽性・陰性の件数を記録した実機結果で判断する。

## 追加調査：問い合わせ失敗・buffer寿命・入力の境界

2026-10-23追記。本人の指示により、今回の#83では自然入力各20回・95%の判定を完了条件にしない。製品リリースの精度受入を合格にする変更ではない。以下は実装判断に使う公開契約と、そこから選ぶ保守的な方針を分けた補足である。

### `SendMessageTimeoutW`の失敗分類

呼出し直前に`SetLastError(ERROR_SUCCESS)`を行い、APIの戻り値と`lpdwResult`を別に扱う。**APIが非zeroのときだけmessage結果を解釈する。** APIの戻り値0でerror0の場合もgeneric failureである。この手順は[SendMessageTimeoutW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeoutw)の明示的な指示に従う。

| APIの戻り値 | 直後のlast error | 解釈とprobeの扱い                                                   |
| ----------- | ---------------- | ------------------------------------------------------------------- |
| 0           | 0                | 原因未特定の失敗。正常な否定hitへ変換しない                         |
| 0           | 5                | `ERROR_ACCESS_DENIED`。権限制約の失敗としてunknown                  |
| 0           | 1460             | `ERROR_TIMEOUT`。期限内未完了としてunknown                          |
| 0           | 1400             | `ERROR_INVALID_WINDOW_HANDLE`。対象消失等で有効な問い合わせ結果なし |
| 0           | その他           | 取得失敗としてunknown。error値は診断に残せるが推定の肯定に使わない  |

コード値の定義は[System Error Codes 0–499](https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--0-499-)と[1300–1699](https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--1300-1699-)。message送信はUIPIの制約を受け、UIPIによる拒否のlast errorは5と説明されている。ただし5だけから拒否の全原因をさらに断定しない。[SendMessageW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagew)

### `WM_GETTITLEBARINFOEX`の他プロセス問い合わせと寿命

`WM_GETTITLEBARINFOEX=0x033F`は`WM_USER=0x0400`未満のsystem messageで、`lParam`は送信側が確保した`TITLEBARINFOEX`へのpointer。system messageの他process通信はWindowsのmarshalling対象である。構造体の`cbSize`と配列長を正しく合わせ、失敗後の内容を有効な結果として使わない。[WM_GETTITLEBARINFOEX](https://learn.microsoft.com/en-us/windows/win32/menurc/wm-gettitlebarinfoex)、[SendMessageTimeoutW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeoutw)

timeout時に、messageがまだ受信されていなければ取消される。一方、受信側`WndProc`が処理を開始していれば、その処理はtimeout後も続く。system-marshalled dataは受信処理が終わるまでwindow managerが維持し、custom messageでは送信側が寿命を管理する必要がある。したがって「timeoutしたから受信処理も停止した」は誤りである。この説明を、同process別threadへ渡したraw pointerやcustom messageの即時解放に流用しない。probeでは他process対象に限定するか、同process対象には別の同期／寿命管理が必要になる。[What happens to a sent message when SendMessageTimeout reaches its timeout?](https://devblogs.microsoft.com/oldnewthing/20110915-00/?p=9643)

### hit testの副作用と押下中の除外

Microsoftの解説は、`WM_NCHITTEST`が`WindowFromPoint`、drag/drop、accessibility等からも送られ、マウス入場通知ではないと説明している。受信アプリが誤ってhoverアニメーション等を開始する実例も示されている。そのため、外部queryの副作用ゼロは保証しない。問い合わせ有／無で同じ手動hoverを比較し、表示、focus、ボタン状態、遅延に違いがないか確認する。[WM_NCHITTEST is for hit-testing](https://devblogs.microsoft.com/oldnewthing/20110218-00/?p=11453)

probeの設計判断として、物理マウスボタンのいずれかがdownの区間はhover候補を取消し、解放後に新しく滞在時間を測る。`GetAsyncKeyState`は最上位bitで現在のdownを読めるが、最下位bitの「前回以降の押下」は信頼できない。マウス値はlogicalでなくphysical buttonを表すので、左・右・中・X1・X2を確認する。戻り値0はupだけでなくdesktop／権限制約の失敗もあり得るため、desktop等の観測条件が成立した範囲での抑制である。[GetAsyncKeyState](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getasynckeystate)

`GetCapture()==NULL`だけで他processのcaptureなしとはいえない。このAPIは呼出threadのcaptureだけを返す。他threadの確認には`GetGUIThreadInfo`の`hwndCapture`と`GUI_INMOVESIZE`等が使えるが、指定threadの情報であり全desktopの完全なcapture列挙ではない。取得失敗やactivation遷移時のhandle不確定を肯定へ補完しない。[GetCapture](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getcapture)、[GetGUIThreadInfo](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getguithreadinfo)、[GUITHREADINFO](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-guithreadinfo)

### Ctrl／Alt／Shiftを併用したWin+Z

公開の操作説明が示す入口はWin+Zである。追加modifierを押した組合せも同じ入口として数える保証は確認できなかった。そのためprobeの採用条件は、Win down、Zの初回down、Ctrl／Alt／Shiftはすべてupとする。これは曖昧な組合せを採用しない設計判断で、追加modifier付きでOSが必ず表示しないという主張ではない。左右modifierをhookのdown/upから保持し、注入入力を混ぜず、開始時に押されていたキーや状態欠落は一度解放するまでunknownにする。[Snap Your Windows](https://support.microsoft.com/en-us/windows/experience/snap-your-windows)、[LowLevelKeyboardProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc)、[KBDLLHOOKSTRUCT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-kbdllhookstruct)

### hover設定の欠落とdefault

Microsoft Learn／Support／Windows Developer Blogを対象に`EnableSnapAssistFlyout`とdefaultの組合せを限定調査したが、**値が存在しない場合はONとして扱う**という公式の互換性契約は確認できなかった。MicrosoftドメインのQ&Aに第三者の設定手順は見つかるが、公開APIの保証には採用しない。Windowsの設定UIが提供するhover表示ON/OFFの意味は公式Supportに記載されているものの、その説明はレジストリの未作成時動作を保証していない。[Snap Your Windows](https://support.microsoft.com/en-us/windows/experience/snap-your-windows)

今回の判断は、欠落・型違い・取得失敗をunknownのまま保持すること。実機で欠落時に表示されても「このOS build・user profileで表示を確認」と記録し、全Windows 11のdefault ON契約へ一般化しない。

## 追加調査：caption矩形とhit testが不一致の場合

標準captionの目視結果、`TITLEBARINFOEX`の最大化矩形内、`WM_NCHITTEST`の結果が一致しない場合は、片方を正解にして推定を肯定しない。座標系、呼出thread／対象ウィンドウのDPI context、対象の同一性、問い合わせ中の変化を原因候補として切り分ける。以下の資料だけでは、この不一致の根本原因を確定できない。

### 公開資料で確認した点

- `GetCursorPos`はscreen座標だが、その値は**呼出threadのDPI awareness contextのlogical座標系**に従う。physical座標が必要な場合は`GetPhysicalCursorPos`を使う。screen座標という表記だけでphysical pixelと同一とみなさない。[About Cursors](https://learn.microsoft.com/en-us/windows/win32/menurc/about-cursors)、[GetPhysicalCursorPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getphysicalcursorpos)
- `SetProcessDpiAwarenessContext`は成功時TRUE、失敗時FALSE。すでにprocessのDPI awarenessがmanifestまたはAPIで設定済みなら`ERROR_ACCESS_DENIED`となる。DPIに依存するAPIやUI生成より前に設定し、戻り値を確認する。process defaultが設定できても、各threadは別contextへ変更できる。[SetProcessDpiAwarenessContext](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setprocessdpiawarenesscontext)
- 実際の呼出threadは`GetThreadDpiAwarenessContext`、対象ウィンドウは`GetWindowDpiAwarenessContext`で確認できる。後者の返すウィンドウcontextは呼出threadのawarenessに影響されない。process設定APIを呼んだ履歴だけではTimer callback時のcontextを証明できない。[GetThreadDpiAwarenessContext](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getthreaddpiawarenesscontext)、[GetWindowDpiAwarenessContext](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowdpiawarenesscontext)
- WindowsのDPI資料は、API別のvirtualizationの文書が十分ではないと明記している。DPI-unaware／system-aware threadからのAPI値はvirtualizeされ得るため、期待するthread contextを確認する必要がある。したがって、`TITLEBARINFOEX`矩形と別問い合わせの座標系の同一性を、どちらもscreen座標という理由だけで確定しない。[High DPI Desktop Application Development on Windows](https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows)
- `PhysicalToLogicalPointForPerMonitorDPI`と逆変換は、指定ウィンドウに基づきcallerのawarenessに依存せず変換する。対象ウィンドウcontextに従う比較の診断に利用できるが、未検証の一律DPI倍率を掛けて結果が合うよう補正する根拠にはしない。[PhysicalToLogicalPointForPerMonitorDPI](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-physicaltologicalpointforpermonitordpi)、[LogicalToPhysicalPointForPerMonitorDPI](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-logicaltophysicalpointforpermonitordpi)
- `WM_NCHITTEST`の`lParam`はscreen座標の符号付き16bitのx／yである。maskしてpackする場合も、signed shortへ復元した値が入力と一致する範囲に限定する。負のscreen座標をunsignedとして解釈しない。[WM_NCHITTEST](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-nchittest)
- `DwmDefWindowProc`は受信側window procedureのnon-client hit test用APIで、custom frame側では先にこの関数へ処理を委ねることが案内されている。外部probeが任意の他process HWNDへ直接呼ぶ代替問い合わせの保証としては扱わない。限定調査では、今回のような不一致をDWMのhit-test cacheが引き起こすという公式な根拠は確認できなかった。[DwmDefWindowProc](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmdefwindowproc)

### 原因を絞る診断案（未実施の手順）

1. DPI設定APIの戻り値と直後のerrorを記録する。UI生成前とTimer実行時のthread context、対象ウィンドウcontextを比較し、要求したPMv2が実際に有効か確認する。
2. 同じsampleで`GetCursorPos`と`GetPhysicalCursorPos`を比較する。保存を最小にする場合は座標値そのものではなく一致／不一致と取得成否を記録する。対象DPIの確認と、必要な場合の公式変換APIによる比較を行う。
3. 問い合わせの前後でカーソル位置とrootが変わっていないことを確認する。`WindowFromPoint`の返すウィンドウ、照合したroot、hit testを送ったウィンドウが一致するかを区別する。popup出現・対象の移動／resize中の不一致を静止状態の結果と混ぜない。
4. `lParam`をsigned shortへ復元して入力との一致をassertする。-32768〜32767の表現範囲を外れた値は切り詰めて採用しない。
5. 上記条件を固定しても不一致なら、APIの1つを正解として補完せず、標準captionでも推定条件が未成立と記録する。DWM内部cache等の仮説は、追加証拠が得られるまで未確定のまま残す。
