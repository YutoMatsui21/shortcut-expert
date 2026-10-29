# W02単独の画面移動検出（#38）

2026-10-29。基準revision `840bf26`。[現行要件](ui-redesign-requirements.md)と[#38](https://github.com/YutoMatsui21/shortcut-expert/issues/38)が正本。
技術ゲートは[#14の再審査](research-compound-drag-validation.md)を再利用する。調査原本の成功を今回の製品buildの実入力受入に置き換えない。

## 単独操作の成立条件

本番`CandidateTracker`でcaption押下→MOVESIZESTART→非注入の解放→同一対象/processのMOVESIZEENDを照合する。始終monitorが異なり、通常・非arranged終端、解放monitor/作業域と結果の一致、入力対象/foreground一致、既知の画面構成・作業域・DPIを必要とする。開始時の最大化から移動に伴い復元してもW04を別計上しない。途中跨ぎ・元monitorへの戻し・Esc・競合入力・未解放・別対象・programだけの変化・停止後・重複終端は採用しない。

Win+Shift+左右は方向キー解放まで途中結果を保留し、入力開始時の窓/process・monitorと解放時（または後続の結果イベント）のmonitorを比較する。入力から1秒を超えた結果、注入・競合、foreground変更、未知/変化した構成を採用しない。キー保持中の反復は開始monitorからの1操作とし、元へ戻って解放した場合は0件。

画面構成の比較には全画面のboundsとworking areaを使う。DisplaySettingsChanging/UserPreferenceChangingでは同じcallbackスレッドに取消を配送する。設定イベントの配送順・OS固有のDPI変更挙動は人工試験だけでは保証できず、#47で実入力・着脱・DPI変更を確認する。混在DPIや任意配置の実機対応をPASSとしない。

## 通信・保存・通知

既存v1/v2のwindow証拠へboolean `moveConfirmed`を追加する。本番Nativeは同一対象・既知で安定した構成を確認したW02だけtrueにする。Mainは型を厳格に検証して許可したfieldだけを通し、Coreはtrueを必須とする。欠落/falseの旧W02候補は採用しない。他操作と旧protocolの読取経路は維持する。helper/Mainは同じbuildで同梱する。

左右2画面・上端一致・非重複の限定条件でのみ方向を確定する。Coreも座標関係とkey routeを照合する。上下・非整列・方向不明や入力キーと確定方向が合わない場合、確証済み移動は記録するがキー通知を出さない。方向不明を操作未成立に読み替えない。

保存は既存の操作別日別集計と設定だけ。入力列、窓矩形、HWND、process、画面構成fingerprintを保存しない。既存のtransaction重複排除、SQLite commit後の通知、学習3状態、停止、保存失敗/ACK喪失の再試行を再利用する。一覧の静的キー表示と通知キーの確証は別契約。製品全体の実機受入が残るため一覧の「準備中」は維持する。

## #113への引継ぎ

`FinishMove`は同一gestureの`Input.Window/Before.Process/Transaction`、開始WindowState、終了WindowState、解放monitor/作業域を一時保持して照合する。

- 別monitorの上端直接drag＋最大化は`CompoundMoveResult`でtransaction・始終monitor・確証済み終端をローカルに残す。Observerは現在この型を送信しない。
- 別monitorのquarterは既存`PlacementResult`の`monitorChanged=true`として保持し、`CandidateProtocol.Placement`が送信を抑止する。開始側の証拠は同じ`FinishMove`のdragにあり、#113で共通gesture証拠に束ねる。
- half複合を自動対応しない。原子2件保存・同一ID非重複・単一Toastと複合負例は#113が担当する。

## 局所検証と残る受入

`tests/native-policy/MonitorMoveTests.cs`は本番C# policyの横並び・上下・非整列・負座標・DPI差・構成変更・取消・戻し・注入・競合・別対象・派生復元・重複を人工列で検証する。`tests/native-policy.test.ts`がC# JSON→Main厳格parse→Core→実SQLite Worker→保存後通知を検証する。

`tests/fixture-integration.test.ts`はW02を3学習状態で保存し、一覧/記録モデル・再読込・方向不明時の非通知・通知停止/全停止・保存失敗/ACK再試行・重送非重複を検証する。標準smokeは隔離helper→Core→保存→本番ReactのW02 mouse/key接続を確認する。通知adapterはfakeであり、実OS通知・代表アプリの入力精度・monitor構成/DPI/着脱・方向同等性・最終buildのR02/J04は#47に残る。

ローカル結果：型検査、unit 292件、Native 7件（C# policy 429ケース）、build、開発版smokeは成功。ローカルCodexレビューは追加レビュー規則の4観点で具体的な回帰指摘なし。レビュー後の差分はJSON回帰fixtureの一時領域への移動と後片付け・保存エラーのassert追加だけで、本番ロジック変更はない。

このWindows作業先の`.tools/tests`ではJSON原本のrenameが`EPERM`となる事象を観測した。unitは一時領域へ移して全件成功。同梱版の標準smoke初回はW02 mouse/key保存後、W01のkey保存で原本が0・tmpが1のまま置換されず失敗した。試験保存先を分けた同一buildでの結果と最新head CIはPRに記録する。保存失敗を成功として集計しない。
