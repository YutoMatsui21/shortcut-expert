# 記録ページの7日集計（#19）

今日を含むローカル暦日7日間を表示する。12操作は学習一覧と同じregistry・正式名・キー・表示順を使い、全行に準備中を表示する。学習状態にかかわらず取得済みの値を表示する。期間・対象の選択は#20、前期間比較は#21、並べ替えは後続Issueで実装する。未実装の比較は「—／準備中」とし、架空の値を表示しない。

CoreのrecordsReadModelが既存learningReadModelの操作別集計を再利用し、KPIをキー合計÷（キー合計＋マウス合計）で計算する。操作率の平均は使わない。日付はdaysBeforeの暦日演算、率はBigInt中間値で小数1桁に四捨五入し、バーには丸め前の率を渡す。操作別・全体合計の安全整数超過は保全エラーとする。

countsまたはobservedの根拠がある操作だけを集計根拠にする。根拠がない値はnull／「—」、観測済みの0件は0回、分母0の率はnull、mouseのみ正なら0.0%。旧countsは使用するが、欠損coverageを生成しない。全く根拠がない期間は空状態を表示する。W09の旧記録は保存・有界履歴queryに保持し、正式12操作のKPIには含めない。

MainのgetRecordSummaryは引数なし。Mainが現在localDateを決め、DurableCoachの直列キュー内でRepository.queryを7日分だけ実行し、確定settingsと同じrevisionを確認する。Rendererへは12行・KPI・期間・revisionだけ返す。任意SQL・保存先・全履歴の複製は追加しない。Mainの既存mainFrameだけを許可し、通知窓・別窓・子frameを拒否する。旧JSON経路は隔離回帰fixture用に同じCore集計を使う。

AppShellの単一購読は維持し、記録ページは日付・revision・設定・エラー変化で再読込する。日次タイマーは停止中や無操作でも表示期間を進める。古い非同期応答・旧日付・旧revisionを表示せず、読込失敗はエラーへ接続する。記録ページの本文scrollは画面往復で保持、再読込では初期化する。旧日別UIの通知・計測・削除は共通歯車から操作する。

Figmaの275:6552、206:6712、205:6847を参照。共通Shell/font/SVG/keycapを再利用する。本文幅はviewport−248（上限872）、800pxはKPI縦積み・操作2段行、920px以上はKPI横並び・4列表。期間/対象/並べ替えの選択や比較値は後続Issueのため、現段階では固定期間・全操作を明示する。準備中の表示と12行は現行要件を優先し、Figmaの例示11行・数値をコピーしない。

## 検証

records.testは7暦日・閏日・両端・期間外・旧ID除外・重み付きKPI・既知0/未観測/0%・丸め・バーの未丸め値・全体安全整数超過を確認する。records-query.testは本番SQLite WorkerとDurableCoachの並行書込/設定/query、同一revision、日次移動、削除と設定保持を確認する。IPC/preload試験は専用channelと送信元制限を確認する。

records-smokeは隔離JSON/SQLiteの人工mouse1/key1を本番IPCとReactへ接続し、4幅でKPI・12行・準備中・未知値・SVG読込・縦横配置・横はみ出しなし・scroll保持を検査し、自アプリのPNGと寸法JSONを出力する。SQLite query故障後の停止・エラー・再開時再読込と、移行後の古い履歴保全も既存smokeで確認する。人工入力を自然入力精度の証拠にしない。

2026-10-20：Windows build 26300 / Node 24.11.1 / .NET SDK 10.0.401 / Electron 44.7.0でtypecheck/build、unit 179件、native 6件（C# policy 63assert）が成功。開発版とローカル配布版で旧JSON・SQLite・移行再起動の全6種類のsmokeが成功。4幅の自アプリPNGを確認し、ヘッダーの2px差と表のキー列見出し位置を修正した。リサイズの描画反映を待ってからDIP差を補正し、800/920/1120/1360pxの実CSS幅で検証する。初期依存導入のEPERMとElectron実行の制限は権限付きで解消した。実入力精度、混在DPI/文字拡大、標準Toast、NSIS導入、公開受入は未確認。
