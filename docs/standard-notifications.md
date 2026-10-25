# 標準Toast（#26 / J02）

通常起動のDurableCoachは、受理時に学習中・mouse・同等キーありの通知tokenを作り、記録commitと読戻しに成功した後で一度だけMainへ発行を要求する。保存待ちにTTLは設けない。表示用monitorは不要で、検出器の証拠条件は変更しない。正式操作名は一覧のlearningOperationsと共通。

発行直前にgeneration、通知pause、現在の学習状態を再検査する。保存中のpause→resumeやmastered/excludedへの変更でも、取消した通知は復活しない。状態変更の取消しはwriter queue投入前に行う。保存失敗は観測を停止し、保留記録を再試行しても通知tokenを復元しない。新世代の新しい適格操作から通常発行へ戻る。通知のPromiseをwriterは待たず、API結果不明でも記録を続ける。

MainのStandardNotificationsは各要求で新しいNotificationとUUIDを作る。**現行実装**のtitleは証明した単一キー、bodyは正式操作名、silent=true、timeoutType=default。旧通知窓の間隔、全画面/context照会、同時1窓、4秒消去を通常経路へ接続しない。旧経路はJSONの隔離回帰fixtureにだけ残し、物理撤去は#42。**#96の新仕様ではW01/W12で起動状態・番号に応じて最大2つの候補を提示するが、同じ操作の通知を2つには分けず、1通知内に明確に区切って表示する。単一`shortcut`型の互換と保存成功後の1回発行・失敗後の非再送は後続実装・試験で保証する。**

runtime結果はrequested、api-returned、show-event、failed、unknownを区別する。APIから戻ってもOSの可視バナー成功とは扱わない。failed/unknownはMainのruntime診断へ返し、自動再送しない。通常実行で通知履歴・操作履歴を保存しない。OS通知OFFやDNDをアプリ側で間引き・再送する理由にしない。

非同期イベント用の強参照は最大256件・60秒保持する。この上限は発行数を制限しない。showイベント未着での期限/上限到達はunknownとして参照を解放する。timedOutだけでは即解放せず、click/userCanceled/failedまたは保持期限でlistenerを整理する。close()や履歴削除APIは呼ばない。参照解放後の履歴clickはNotification.handleActivationで共通showCoachへ渡す。

runtimeのAUMIDはelectron-builder.ymlのappIdと同じlocal.window-shortcut-coach。per-user NSISのStart Menu shortcut名はproductNameと同じWindow Shortcut Coachとし、既存のpackage名・appId・userDataとアンインストール時のデータ保持を維持する。

#27 / J03ではsingle-instance lock取得後、ready時にhandleActivationを窓生成より前に登録する。通知を表示しないNotification instanceを1つ生成・終了まで保持し、最初の通知発行を待たずElectronのWindows presenter/COM class factory初期化を開始する。handleActivation自体はこの初期化を行わない。COMのbackground登録完了を同期的に保証するAPIではなく、ready raceのOS受入は残る。Electronは既存Start Menu shortcutのToastActivatorCLSIDを再利用し、HKCU LocalServer32を実行exeへ更新するため、独自のランダムCLSIDで上書きしない。

早いclickはCoachWindow内で窓の読込完了まで保留する。instance click、global activation、second-instanceは同じ既存窓のrestore/show/focusだけを使い、観測開始やpause変更を呼ばない。通常の再起動はopenedに従うが、cold activationはopenedにかかわらず初期化後に一覧を表示し、プロセス起動時の通常経路で一度だけ計測を開始する。遅れて届いたCOM callbackも既存窓を表示する。初期化失敗は一覧のエラーを保持し、callbackで観測成功へ変えない。

## 検証の境界

learning-state.test.tsは実SQLite Workerとdeferred保存で遅延、停止、pause→resume、学習状態変更、保存失敗/再試行、新世代、配送結果不明/無応答を確認する。standard-notification.test.tsはElectron境界をfakeにし、N要求、UUID/options、API結果とイベント、参照保持/解放、失敗/無応答、資源上限での発行継続を確認する。storage smokeは本番Core/Main adapterと隔離SQLiteを使い、OS Notificationだけをfakeにする。JSON smokeは旧通知窓の回帰であり、標準Toastの証拠ではない。

OSバナー・通知センター・GC後/長時間後の履歴click、COM登録ready race、clean install/update/reinstallのCLSID/AUMIDとcold activation、実OSによる既存窓のfocusは未確認。専用Windows user/VMでのV01/V02/V04受入が必要であり、fixture成功を実入力精度・OS表示・公開受入の合格とはしない。

API根拠：[固定Electron 44.7 Notification](https://github.com/electron/electron/blob/v44.7.0/docs/api/notification.md)、[Notification constructorとhandleActivation](https://github.com/electron/electron/blob/v44.7.0/shell/browser/api/electron_api_notification.cc)、[presenterのCOM初期化](https://github.com/electron/electron/blob/v44.7.0/shell/browser/notifications/win/notification_presenter_win.cc)、[shortcut/CLSID/LocalServer32の再利用と登録](https://github.com/electron/electron/blob/v44.7.0/shell/browser/notifications/win/windows_toast_activator.cc)。

## J03配布版の残る受入

### V01の実OS発行入口（#44）

ユーザーの明示同意を得てNSIS導入版を`--os-notification-acceptance`で起動する。
このmodeは通常userDataを使わず、fixture専用userDataとSQLite、本番helperの人工候補入口を使う。
hookはfixture動作で実入力payloadを読まない。最大化2件と復元1件を3秒間隔で保存し、本番の
StandardNotifications/Electron Notificationへ個別要求する。通常smokeのNotification fakeは使わない。
`V01_DELIVERY`は人工通知のUUIDとrequested/api-returned/show-event/failed/unknownだけを出力し、
`V01_FIXTURE_COMMITTED`は人工件数の確認であり、バナー可視表示の成功ではない。
発行後はtrayと窓を維持する。instance/global clickは`V01_ACTIVATION`で区別する。
通常版の観測processをtrayで完全終了してから起動し、cold activationも試す際は受入modeをtrayから終了する。
OSがCOMで起動する際は通常起動となるため、cold起動の確認は通常userDataに戻る点も区別する。
この入口は同一/異操作の実adapter要求と履歴clickの切り分け用であり、保存故障・遅延・GC・更新・
DND等のV01全ケースや自然入力精度の合格を自動判定しない。専用profile/VMを原則とし、例外の環境は受入記録に残す。

専用Windows user/VMで、同一buildのper-user NSISを導入する。現在のユーザーの登録を書き換える開発版やunpacked版を代用しない。

1. clean install後の最初の発行、OSバナー/通知センター、AUMID・shortcutのCLSID・HKCU LocalServer32と実行exeの一致を確認する。isSupported/API返却だけでCOM登録readyと判定しない。
2. 稼働中に計測停止・通知pauseを設定して窓をhide/minimizeし、バナーと履歴をclickする。窓/helper/観測が増えず停止状態を保持することを確認する。
3. 60秒経過・GC後・長時間後に履歴clickを確認する。トレイから完全終了して履歴clickし、opened=trueでも一覧を表示して安全初期化後に計測することを確認する。
4. 更新前の通知を残してNSIS更新し、旧userData・CLSID・COM起動先と履歴clickを確認する。アンインストール/再導入後も別途確認する。CLSID/COM登録先が変わった場合は履歴互換を未合格とする。

これらは未実施。隔離fixtureでの実装検証をもって#27の配布版受入完了・公開可とはしない。

2026-10-21の#27実装確認：Node 24.11.1、SDK 10.0.401、Electron 44.7.0。typecheck・unit 227件・build、開発版の既存UI smoke、開発版/同梱版のactivation smoke（各3起動）、同梱版SQLite storage smokeが成功した。activationはopened=trueの旧設定を移行し、一覧/計測開始、停止/pause保持、単一窓、再起動、読込失敗エラーを確認した。通知境界はfakeで、COMやOS focusの合格ではない。出力先はrelease/issue-27。exeのProductNameはWindow Shortcut Coach、userDataDirectoryはwindow-shortcut-coachを確認した。sandbox内のAppContainer ACLとesbuild親directory読取制限は、通常環境で同じfixture入口を実行して切り分けた。

2026-10-21のローカル確認：Node 24.11.1、SDK 10.0.401、Electron 44.7.0でtypecheck・unit 225件・build成功。旧JSON UI smoke、開発版/同梱版のSQLite smokeが成功し、後二者では人工mouse 3件→保存3件→adapterの個別UUID/API返却/fixture表示イベント各3件、旧通知窓0を確認した。出力先はrelease/issue-26。OS API境界はfakeであり、OS表示は未確認。sandbox内のesbuild親directory読取とElectron AppContainer ACLの制限は通常環境での同一入口実行により切り分けた。
