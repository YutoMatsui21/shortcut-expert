# V03 UI・窓制御の先行受入（#46）

## 判定（2026-10-22）

**未合格。#46を閉じず、#47/#48の着手条件を解除しない。**
基盤版の隔離fixtureで表示・操作経路を確認した。実Windowsのcaption/Snap/tray、混在DPI移動、文字拡大、物理画面着脱は未確認。
UIA・マウス/キー送出はユーザーが許可したが、Computer Useの対象アプリ承認がタイムアウトし、UI操作の成功証拠は得られなかった。

Windows build 26340、Electron 44.7.0（同梱Node 24.21.0）、開発Node 24.11.1、.NET SDK 10.0.401。
画面構成は主画面1440×900 DIP・200%、副画面2560×1440 DIP・100%（y=-1440）。
画面構成の取得だけで、画面間移動や負座標での実窓動作を合格にしない。

## 再現入口と責務

```powershell
npm.cmd run build
npm.cmd run package:dir -- --config.directories.output=release/issue-46 --config.electronDist=node_modules/electron/dist
node scripts/ui-acceptance.mjs --package-dir release/issue-46 --matrix-only
node scripts/ui-acceptance.mjs --package-dir release/issue-46
```

`ui-acceptance.mjs`は配布ディレクトリー全ファイルのSHA-256 manifestとそのhashを記録し、毎回新しい`.tools/tests/ui-acceptance-*`を作って`--ui-acceptance`を渡す。
Main indexでfixtureとして分離し、helperは既存のfixtureモード（実入力payloadを読まない）、保存は本番SQLite Worker、通知adapterはfakeとなる。
通常保存先を使わず、本番Renderer/Preload/IPC/CoachWindowと実トレイを接続する。Rendererへ試験用APIを追加しない。
Mainの`ui-acceptance.ts`が16サイズを計測し、各画像と`ui-acceptance.json`へ外形/content/viewport/DPR・画面構成を保存する。
`--matrix-only`は計測後に本番終了処理を通し、stdout/stderr完了後に成否を判定する。60秒を超えたら自分が起動した子を終了し失敗を返す。
省略時はUI操作用に残るので、トレイの「終了」で終了する。実UI操作には別途同意が必要。

`V03_MATRIX_COMPLETE`は計測完了を表す。`dimensionMismatches`を必ず確認する。
`V03_READY`や終了code 0はV03合格を意味しない。要求した高さと一致しなくても実測を保持し、未合格条件として報告する。
画像は自アプリの隔離fixtureのみ。実入力精度・OS通知・DB耐障害・NSIS・公開受入はこの入口で判定しない。

## 今回の配布物と原本

配布物：`release/issue-46-reviewed/win-unpacked`。以下は同一配布物のhash。

| 対象 | SHA-256 |
| --- | --- |
| exe | `0dac58b9eee6175a615c68205ba0e8013d0865a516a25740d4f1079496fadd19` |
| app.asar | `b7b519ebda28d7e94a3a2ac9773494719dc9fda32da05ba56d18e4f7b0833f92` |
| helper | `596a0e1828aa8685b448745b670986288efd7a96075e9e6932811ca97d0e9146` |

全349ファイルのmanifest hash：`c564bea68fb3f0b0f3e90e24252fd7787a2a6915f376a55820cac197a58924b3`。
原本は`.tools/tests/ui-acceptance-BVN77a/{build.json,package-manifest.json,ui-acceptance.json,session.log,ui-*.png}`。
配布smokeのログは`.tools/issue-46-final-{smoke,settings,comparison,storage}.log`。
JSON計測値の転記は[受入証拠](../validation/ui-acceptance-20261022.json)に固定した。
画像・ローカルログはGitへ追加せず、fixture経路・build hashと対応づける。

## 結果と未確認事項

| 条件 | 今回の結果 | 判定の範囲 |
| --- | --- | --- |
| 4幅×2ページ・境界919/920、1119/1120、1359/1360 | 幅補正後の実viewportで12行・横overflowなし・本文幅/左端/上端が仕様どおり | fixtureの寸法確認。全状態の視覚合格ではない |
| 初期1120×700 | 外形1120×700、content/viewport **1119×700** | 不一致。初期表示では1120境界の狭幅側になる |
| 最小800×600 | nominal外形800×601、content/viewport799×601。幅補正後は外形801×601、viewport **800×601** | 両ページで高さ不一致（16試料中2件）。800×600合格にしない。製品の最小寸法設定は変更していない |
| 設定/削除・focus/Tab/Esc | packaged settings smokeで4幅×2ページ、dialogのfocus拘束/取消/確定/失敗retryを通過 | Electron/DOM入力のfixture。Windows UIAによる操作は未確認 |
| 保存エラー・記録queryエラー | packaged storage smokeで本番SQLite/IPC/Rendererのエラー・retry・4幅表示を通過 | 隔離故障注入。物理disk故障の受入ではない |
| J01欠損info | packaged comparison smokeでKPI/操作別・4幅・hover/focus/Space/Esc/click・filter再計算を通過 | 取得済み比較と既知0/unknownを含むfixture |
| 3filter・画面往復・学習状態 | packaged smoke/comparisonで通過 | 通常ユーザーデータは使用していない |
| caption drag/no-drag、標準Snap hover、最大化復元、最小化、×hide、実トレイ復元 | IPC/CSS/人工second-instanceの既存smokeは通過。実OS操作の成功証拠なし | **実機未確認**。自前最大化buttonにnative caption hit-testがない既知制約も残る |
| bounds再起動保持/offscreen補正/負座標 | 既存unitは成功 | 今回の実窓操作による受入は未確認 |
| 混在DPI移動・文字拡大・画面着脱 | 画面構成だけ取得 | **未確認**。物理着脱は人手での実施が必要 |
| 通知復元後のUI/窓状態 | 未確認 | OS click配送は#44、復元後の状態は#46で確認する |

typecheck/build成功、unit **236/236**成功。サンドボックス実行の1回は既存の保存fixtureで失敗したが、権限制約のない実行環境では全件成功した（失敗原因の断定はしない）。
出力drain前のexit、子process stall、runtimeファイル変更の3回帰試験は修正前失敗/修正後成功を確認。
記録ページの計測は`aria-busy=false`と12行の読込を待つ。最終配布物の通常・settings・comparison・storageの4モードで`COACH_SMOKE_OK`を確認した。
matrix終了時の`coach:get-learning: 終了処理中です。`は、窓サイズ復元後の読込と安全終了が重なった拒否ログで、試験成功markerとは区別する。

## Figma照合

今回取得した正本はファイル`mMfK6fQQzfhUqRHR7jsGne`の一覧`275:6498`、記録`275:6552`、
J01説明`367:3715`、4幅`370:4129`、既知0`371:3664`の画像、および4幅ノードのmetadata。
一覧1120のNavy Shell・余白・行・キー・状態部品と、J01のinfo/説明配置をfixture画像で確認した。
fixture件数/率/状態はFigmaのダミー値に合わせない。

**視覚合格は保留。** 記録1120の実装は「期間」「集計対象」のラベルをselect上へ置く一方、
正式記録画面は「期間・直近7日間」「対象・学習中・習得済み」をcontrol内に置くcompact表現である。
追加の日付範囲表示なども含め、controlsと全データ状態の厳密な照合を残す。
J01の正式ノードが存在することと、KPIの回数比較・全操作行・4幅・文字拡大の全状態を視覚受入したことを区別する。

## 再開条件

初期/最小寸法の不一致と記録controlsのFigma差を解消・再検証し、実窓操作を実行できる環境で
caption/Snap/tray/bounds/画面間移動/文字拡大/物理着脱/通知復元後を確認する。
修正後の同一build/hashで影響するfixtureと実機経路を再試験し、その証拠を審査してから#46を完了する。
