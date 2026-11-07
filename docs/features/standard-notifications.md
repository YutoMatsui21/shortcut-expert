# Windows標準通知

**責務**：保存済みの適格なマウス操作をWindows標準トーストで案内し、通知センターからの起動・既存ウィンドウの復元を安全に扱う。通知条件の正本は[製品要件](../ui-requirements.md)、画面の再表示・終了は[ウィンドウのライフサイクル](window-lifecycle.md)。

## 1. 発行までの流れ

`Coreの操作採用 → SQLite commit・読戻し → 発行直前の状態確認 → MainのStandardNotifications → Windows Notification API`

- `DurableCoach`は、学習中・マウス由来・同等キー確証済みの記録に対して通知tokenを作る。**保存成功後**、旧TTLによる時間切れや10秒／60秒の独自間引きなしで発行を要求する。
- 発行直前に世代・通知pause／計測stop・現在の学習状態を再確認。保存待ち中の停止や状態変更で取消した通知を復活させない。保存失敗の復旧後も**過去の通知は再送しない**。
- Mainの`StandardNotifications`は通常の単独操作ごとに新しい`Notification`とUUIDを作る。単独通知は**タイトル＝確証されたキー、本文＝操作名**。`silent=true`、`timeoutType=default`。表示時間やOS側の通知抑制はWindowsへ委ねる。
- 発行要求・API返却・showイベント・失敗・結果不明を分け、**API成功をバナー表示成功とみなさない**。失敗／結果不明でも重複防止のため自動再送せず、記録そのものは維持する。

### 複合操作と将来拡張の境界

**未実装の複合通知契約（[#113](https://github.com/YutoMatsui21/shortcut-expert/issues/113)）**：同一ドラッグでW02＋W03／W07がそれぞれ確定した場合、2操作を原子的に保存し、適格な操作だけを**1通知内の別行**で案内する（0〜2行、通知要求は最大1件）。個別キーが複合動作全体を再現するとは表示しない。既存の単一`shortcut`経路がこの複合通知を実装済みという意味ではない。

**将来の別機能（[#96](https://github.com/YutoMatsui21/shortcut-expert/issues/96)）**：W01／W12で1操作に複数の代替キーを提示する場合も、通知要求を増やさない。#113の「異なる操作2件」と混同しない。

## 2. 非同期イベントと参照の寿命

- 通知イベントを受けるため、Mainで強参照を**最大256件・60秒**まで保持。これは通知を間引く上限ではない。
- 結果不明のまま期限・上限に達した参照は`unknown`として解放。`timedOut`だけで即時解放せず、click／取消／failedや保持期限に応じてlistenerを整理する。
- アプリ側で通知履歴や操作履歴を保存せず、旧独自通知ウィンドウは通常経路へ接続しない。旧経路は隔離JSONの回帰用に限る。

## 3. クリック時の起動・復元

- 起動中：通知click、トレイ、`second-instance`を共通の`showCoach`に集約し、**同じウィンドウ**をrestore／show／focusする。観測を二重開始したり停止状態を勝手に解除しない。
- 完全終了後：通知センターからのcold起動では一覧画面を表示し、通常の起動経路で計測を一度だけ開始する。ウィンドウの準備前に届いた表示要求は保持して後で適用する。
- Windowsでは`single-instance lock`取得後、`Notification.handleActivation`をウィンドウ生成より前に登録。通知を表示しない`Notification`インスタンスを保持し、COM presenter初期化を始める。ただし**OS側の登録完了との競合は未検証**。
- 既存の`appId`（`local.window-shortcut-coach`）、Start Menu shortcut、ToastActivatorCLSID、`userData`との互換を維持する。新規CLSIDの安易な発行や、表示名変更に伴う保存先切替をしない。

API根拠：[Electron Notification](https://github.com/electron/electron/blob/v44.7.0/docs/api/notification.md)、[Windows presenter](https://github.com/electron/electron/blob/v44.7.0/shell/browser/notifications/win/notification_presenter_win.cc)。

## 4. 検証と未確認事項

| 検証                                                     | 対象と限界                                               |
| -------------------------------------------------------- | -------------------------------------------------------- |
| `tests/records/learning-state-updates.test.ts`           | 遅延保存・状態変更・世代・通知再送禁止                   |
| `tests/app/notifications/windows-toast-delivery.test.ts` | APIをfakeにしたUUID・イベント・参照寿命・発行継続        |
| 隔離storage／activation smoke                            | 本番Core／Main・SQLiteの接続。OSトーストとCOMはfake      |
| Windows配布版受入（未完）                                | 実バナー・通知履歴click・cold起動・更新／再導入・COM登録 |

### V01：実OS通知の受入入口

**本人の明示的な同意後**、通常版をトレイから終了し、専用Windows user／VMでNSIS導入版を`--os-notification-acceptance`付きで起動する。隔離SQLite・人工候補から**本物のWindows通知API**に要求し、実入力hookは使わない。`V01_DELIVERY`等のログは要求・API結果・fixture保存の証拠であり、画面上の表示成功は別途目視確認する。

実機では、clean installでの通知表示・AUMID／CLSID／LocalServer32、稼働中／停止中の履歴click、60秒後・長時間後のclick、完全終了後のcold起動、更新・アンインストール・再導入後の互換を確認する。**これらは自動fixtureだけでは合格しない**。手順とログの範囲は[開発ガイド](../development.md)・[製品受入条件](../ui-requirements.md#release-acceptance)を参照。
