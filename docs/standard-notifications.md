# 標準Toast（#26 / J02）

通常起動のDurableCoachは、受理時に学習中・mouse・同等キーありの通知tokenを作り、記録commitと読戻しに成功した後で一度だけMainへ発行を要求する。保存待ちにTTLは設けない。表示用monitorは不要で、検出器の証拠条件は変更しない。正式操作名は一覧のlearningOperationsと共通。

発行直前にgeneration、通知pause、現在の学習状態を再検査する。保存中のpause→resumeやmastered/excludedへの変更でも、取消した通知は復活しない。状態変更の取消しはwriter queue投入前に行う。保存失敗は観測を停止し、保留記録を再試行しても通知tokenを復元しない。新世代の新しい適格操作から通常発行へ戻る。通知のPromiseをwriterは待たず、API結果不明でも記録を続ける。

MainのStandardNotificationsは各要求で新しいNotificationとUUIDを作る。titleは証明したキー、bodyは正式操作名、silent=true、timeoutType=default。旧通知窓の間隔、全画面/context照会、同時1窓、4秒消去を通常経路へ接続しない。旧経路はJSONの隔離回帰fixtureにだけ残し、物理撤去は#42。

runtime結果はrequested、api-returned、show-event、failed、unknownを区別する。APIから戻ってもOSの可視バナー成功とは扱わない。failed/unknownはMainのruntime診断へ返し、自動再送しない。通常実行で通知履歴・操作履歴を保存しない。OS通知OFFやDNDをアプリ側で間引き・再送する理由にしない。

非同期イベント用の強参照は最大256件・60秒保持する。この上限は発行数を制限しない。showイベント未着での期限/上限到達はunknownとして参照を解放する。timedOutだけでは即解放せず、click/userCanceled/failedまたは保持期限でlistenerを整理する。close()や履歴削除APIは呼ばない。参照解放後の履歴clickはNotification.handleActivationで共通showCoachへ渡す。

runtimeのAUMIDはelectron-builder.ymlのappIdと同じlocal.window-shortcut-coach。handleActivationを窓生成より前に登録し、早いclickはshowRequestedへ保留する。instance click、global activation、second-instanceは同じ既存窓のrestore/show/focusを使う。cold activationでも初期化後に表示し、通常どおり計測開始する。単一起動lockは維持する。

## 検証の境界

learning-state.test.tsは実SQLite Workerとdeferred保存で遅延、停止、pause→resume、学習状態変更、保存失敗/再試行、新世代、配送結果不明/無応答を確認する。standard-notification.test.tsはElectron境界をfakeにし、N要求、UUID/options、API結果とイベント、参照保持/解放、失敗/無応答、資源上限での発行継続を確認する。storage smokeは本番Core/Main adapterと隔離SQLiteを使い、OS Notificationだけをfakeにする。JSON smokeは旧通知窓の回帰であり、標準Toastの証拠ではない。

OSバナー・通知センター・GC後/長時間後の履歴click、COM登録ready race、clean install/update/reinstallのCLSID/AUMIDとcold activation、実OSによる既存窓のfocusは未確認。専用Windows user/VMでのV01/V02/V04受入が必要であり、fixture成功を実入力精度・OS表示・公開受入の合格とはしない。

API根拠：[固定Electron 44.7 Notification](https://github.com/electron/electron/blob/v44.7.0/docs/api/notification.md)。

2026-10-21のローカル確認：Node 24.11.1、SDK 10.0.401、Electron 44.7.0でtypecheck・unit 225件・build成功。旧JSON UI smoke、開発版/同梱版のSQLite smokeが成功し、後二者では人工mouse 3件→保存3件→adapterの個別UUID/API返却/fixture表示イベント各3件、旧通知窓0を確認した。出力先はrelease/issue-26。OS API境界はfakeであり、OS表示は未確認。sandbox内のesbuild親directory読取とElectron AppContainer ACLの制限は通常環境での同一入口実行により切り分けた。
