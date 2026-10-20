# 履歴削除（#24）

正本：承認済みSpec §7.4/§9、[Figma 349:2534](https://www.figma.com/design/mMfK6fQQzfhUqRHR7jsGne?node-id=349-2534)。対象は正式確認・限定IPC・履歴削除と非復活。保存エラーバナーの正式デザインは#25、V02/V03全体の受入は#45/#46に残す。

## 確認から削除まで

1. gearから設定を閉じ、440×218pxの`DeleteDialog`を開く。キャンセル初期focus、Tab/Shift+Tab循環、Esc取消、背景inert、確定中の二重操作防止を持つ。
2. `requestDelete()`でMainがUUID tokenを発行する。mainFrameに紐付け、5分・単回有効。再確認・取消・hide・navigation・終了で旧tokenは無効。`deleteCounts(token)`はsender/引数/tokenを検証し、control queueへ入る前に消費する。パスや保存内容は渡さない。
3. 確定までは計測を継続。Mainで観測停止・旧世代無効化後、Core queueと未確定writeを解決する。Repository transactionでcounts/coverage/legacy_daysを削除し、epochとpending purgeを更新する。
4. 旧JSON・その一時ファイル・固定stagingの掃除と完了meta保存まで成功した場合だけ成功応答する。コピーの別backupは作成していない。学習状態/opened/normal boundsとsource消費identityは残す。
5. 元が計測中なら新世代で再開し、停止中なら停止を保持。失敗は停止・保存エラー/再試行へ返す。削除の再試行成功時も元の計測状態へ戻す。起動時はpending purgeを観測前に実行し、authorityがあれば旧コピーを再importしない。

## 2026-10-20 検証

Windows 11 Home build 26300、Node 24.11.1/npm 10.9.2、.NET SDK 10.0.401、Electron 44.7.0（内蔵Node 24.21.0）。通常userDataには触れず、全て専用の人工fixture。

| 経路 | 結果と証拠の範囲 |
| --- | --- |
| typecheck / unit | 成功、210件。token期限・frame・取消・重送・不正IPC、実SQLiteで掃除失敗→再起動・旧epoch拒否・設定保持、実Worker/Coreで遅延write→削除→再open、既存ACK喪失・rollback回帰 |
| native | 6件成功、内部で本番C# policy 63 assertions。実入力payloadを読まないhook fixture |
| build / package:dir | 成功。`release/issue-24/win-unpacked/Window Shortcut Coach.exe` |
| 通常版・同梱版のsettings smoke | 成功。4幅800/920/1120/1360、dialog寸法、初期focus、実キーボードTab/Shift+Tab/Esc、取消、確定前のCore人工記録、重送防止、旧世代拒否、reset故障→retry、計測中/停止中の復帰。本番Main/Preload/React/SQLiteを使用。画像を目視照合 |
| 通常版・同梱版の既存smoke | UI/IPC・storage・migration（各2起動）・comparisonが成功 |

実行入口はREADME。削除UIの回帰は`node scripts/smoke.mjs --settings`と`node scripts/smoke.mjs --packaged --settings --package-dir release/issue-24`。CIも同じsettings smokeを実行し、自アプリの`delete-*.png`を保存する。

同梱exe SHA-256：`081D4684DD9998150EC953FDADC053E309EAA26311DEE3B17D378A902B58210D`。これはこの時点の隔離検証物であり、リリース成果物ではない。

実入力精度・UIA・自然キー送出・物理disk full/停電・SSD物理消去・混在DPI/文字拡大・NSIS導入・通常60分は未検証。Coreへ直接与えた人工候補はNative検出の証拠に含めない。データ削除の論理原子性と故障回復の試験を、物理媒体の完全消去や自然入力精度の保証にしない。
