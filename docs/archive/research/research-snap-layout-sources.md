# Snap Layout表示検出の一次資料メモ（Issue #5）

> **履歴資料／現行の実装・受入条件ではありません。** W08（Snap Layout／Win+Zの呼び出し）は初回公開の8操作から除外されています。ここにある「確定」「未達」「次工程」「OPEN」や試験回数・合格率は**記録当時の判断**です。将来この機能を再検討するときの参考として残し、現在の対象・承認済み条件は[製品要件](../../ui-requirements.md)を優先してください。

調査日: 2026-10-22。Microsoftの仕様資料を確認した机上調査。実機の検出結果・自然入力精度の証拠ではない。W08の対象はレイアウトを開く操作で、ゾーン選択・最終配置・Snap Assistは別に扱う。

## 公開資料で確認できる契約

| 論点            | 確認した内容                                                                                                                                                                        | 根拠                                                                                                                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 表示入口        | 最大化ボタンhoverとWin+ZでSnap Layoutを開く。レイアウトは画面サイズ・向きに依存する。                                                                                               | [Support snap layouts](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-snap-layout-menu)                                                                                                                                                                                    |
| hover対応       | 独自タイトルバーを持つWin32アプリでは、最大化/復元ボタン上のWM_NCHITTESTにHTMAXBUTTONを返す対応が示される。これは対応方法であり、第三者観測から表示完了を知るイベント契約ではない。 | [Support snap layouts](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-snap-layout-menu)                                                                                                                                                                                    |
| 表示設定        | hoverのSnap flyout、上端へドラッグするSnap bar、配置後のSnap Assistにはそれぞれ設定がある。hoverだけで表示を断定できない。                                                          | [Snap your windows](https://support.microsoft.com/en-us/windows/experience/snap-your-windows)                                                                                                                                                                                                         |
| WinEvent        | EVENT_OBJECT_SHOW/HIDEはオブジェクトの表示/非表示。MENUPOPUPSTART/ENDは汎用menuで、システムから一貫して送信される保証がない。Snap Layout専用の成功イベントとは記述されていない。    | [Event Constants](https://learn.microsoft.com/en-us/windows/win32/winauto/event-constants)                                                                                                                                                                                                            |
| preview         | **EVENT_SYSTEM_ARRANGMENTPREVIEW** (0x8016) の公式説明はpreview rectangleの表示。Snap Layoutメニュー表示・選択完了の意味に拡張しない。公式資料の識別子はARRANGMENTという綴り。      | [Event Constants](https://learn.microsoft.com/en-us/windows/win32/winauto/event-constants)                                                                                                                                                                                                            |
| UIA events      | 全イベントがproviderから発生すると仮定できない。actionイベントはユーザー操作・プログラム操作の両方から生じ得る。状態不変でも生じるイベントがある。                                  | [Subscribing to UI Automation Events](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-eventsforclients)、[Events Overview](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-eventsoverview)                                                                              |
| UIA tree        | treeは固定構造ではなく、要素の追加・移動・削除で変わり、raw viewもUI frameworkに依存する。                                                                                          | [Tree Overview](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-treeoverview)                                                                                                                                                                                                          |
| UIA properties  | providerが提供しないpropertyには既定値が返り得る。GetCurrentPropertyValueEx等は未対応を既定値と区別できる。NativeWindowHandleは窓がなければ0。                                      | [Retrieving Properties](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-propertiesforclients)、[NativeWindowHandle](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.automationelementinformation.nativewindowhandle?view=windowsdesktop-10.0) |
| 点からのUIA取得 | ElementFromPointは指定desktop座標の要素を取得する。返る前に要素が消えればUIA_E_ELEMENTNOTAVAILABLEとなる。                                                                          | [ElementFromPoint](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomation-elementfrompoint)                                                                                                                                                       |
| MSAA            | AccessibleObjectFromEventにはcallbackのHWND/object ID/child IDを渡す。戻り値は対象自身または親のIAccessibleとchild ID。CREATE時は未初期化で失敗し、DESTROY時は取得しない。          | [AccessibleObjectFromEvent](https://learn.microsoft.com/en-us/windows/win32/api/oleacc/nf-oleacc-accessibleobjectfromevent)                                                                                                                                                                           |
| HWND関係        | GetWindow(GW_OWNER)は存在するowner、GetAncestor(GA_ROOTOWNER)はparent/ownerの連鎖を返す。Shell popupが操作対象アプリをownerに持つ契約とは記述されていない。                         | [GetWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindow)、[GetAncestor](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getancestor)                                                                                                      |

## 実機で確かめる仮説と失敗時の扱い

次は上記資料からの設計上の推論であり、APIの保証ではない。

- hover/Win+Zに続く識別済みShell UIの非表示→表示を、表示完了の候補証拠とする。単なる経過時間・キー押下・任意popupのSHOW・窓配置変更では成功にしない。
- Shell process、class、AutomationId、ControlType、限定した子構造などを照合できるか調べる。今回確認した資料にSnap Layout専用の固定AutomationId/class/tree、全build共通の識別契約は見つかっていない。観測できてもbuild・表示言語・DPI・アプリ条件に限定した結果として記録する。
- 入力開始時の対象窓と表示UIの対応を別々に確かめる。popup HWNDやそのUIA NativeWindowHandleはpopup自身の識別に使えても、それだけで操作対象アプリとの対応は証明しない。owner不明、foreground競合、別窓への切替、複数候補ではunknownにする。
- hover成立前の離脱、設定off、別popup、繰り返し表示、既に表示中のWin+Z、取消しを負例に含める。UIA/MSAA取得失敗・event欠落では成功を補完しない。
- UIA/MSAAはUIの状態の証拠。入力由来は別証拠を必要とする。人工入力で表示を再現した結果は、自然入力の分類精度を示さない。

## 検証probeへの制約

WinEventは必要なevent範囲と対象process/threadで絞る。OUTOFCONTEXTは非同期配信で登録threadのmessage loopが必要。callbackには再入の注意があるため、重い探索を直結しない。[SetWinEventHook](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook)

UIA探索・イベント登録は専用MTA threadを使い、登録と解除を同じthreadで行う。UI threadで自分のUIへ問い合わせると停止等の問題が起こり得る。[Understanding Threading Issues](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-threading)

取得範囲は承認された隔離窓と表示候補Shell UIの識別情報に限定する。本文、Name/Valueによる内容収集、全desktopのtree dump、タイトル・path・画像・入力生ログの保存は行わない。この制約は本repoのAGENTS.mdに従うもので、Microsoft APIが自動的に保証するものではない。

## 判断

hover/Win+ZがSnap Layoutの入口であることは公式資料で確認できる。一方、第三者アプリが表示UI・入力由来・対象窓を一律に結び付ける専用の公開契約は、上記の調査範囲では確認できない。限定probeで識別・対象照合・負例の証拠がそろうまでは、W08の製品集計を有効にする根拠にしない。「WindowsにAPIが存在しない」という網羅的な不存在の主張は行わない。
