# W02：別画面へ移動する

**責務**：同じウィンドウを別モニターへ移動したと確証できる入力だけをW02として採用し、移動方向が不明でも記録とキー案内を別判定にする。[製品要件](../ui-requirements.md#compound-gesture)、[技術再審査](../research/compound-drag-validation.md)。

## 1. 検出と判定

| 経路   | 採用条件                                                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| マウス | caption押下→MOVESIZESTART→非注入の物理解放→同じウィンドウ／processのMOVESIZEEND。**始終monitorが異なる**通常・非arranged終端と解放位置を照合 |
| キー   | Win+Shift+←／→の入力時と解放後の対象・monitor差を照合。保持中の連続移動は起点からの**1操作**として確定                                       |

- `CandidateTracker`で同一対象、foreground、画面構成・作業域・DPIの整合を確認する。キー側は方向キー解放まで保留し、入力から**1000ms超**の結果や構成変更を除外する。構成変更通知は同じcallbackスレッドの候補を取消す。
- 途中で別画面に入っても**元のmonitorへ戻して解放した場合は0件**。Esc、注入・競合、未解放、別対象、前景変更、古い世代、重複終端、programによる状態変更だけの場合も記録しない。
- ドラッグ中の派生復元W04は別件数にしない。複数画面の任意配置・混在DPIや画面着脱時のイベント順序は人工試験だけでは合格としない。

## 2. キー案内と通信

- 左右が横並び・上端一致・非重複で方向が確定すれば、その方向の`Win+Shift+←／→`を案内する。
- それ以外でも、Nativeが始終とも**非重複の2画面だけ**で安定構成と確認し、同じウィンドウがもう一方へ移動した場合は、行先が一意なので`Win+Shift+←`を案内できる。キー操作では実入力の←／→を維持する。上下を空間的な左右と偽って`moveDirection`に設定しない。追加のboolean証拠`twoDisplayLayoutConfirmed`をMainが厳格parseし、Coreも非重複の始終monitorと照合する。欠落／falseは従来の記録のみへ戻る。
- 3画面以上・重複・構成不明でキー同等性を確証できない移動は記録のみ。これは製品受入の完了を意味しない。上下配置の通知を一律に除外する製品仕様ではなく、旧実装の横並び制限だった。
- Nativeのv1/v2 window証拠へ`moveConfirmed`を追加。Nativeが同一対象・安定構成を確認したときだけtrue、Mainが厳格parseし、Coreもtrueを必須とする。欠落／falseは採用しない。生入力やHWND・process・ウィンドウ矩形・画面fingerprintを保存しない。
- SQLiteの日別集計、重複防止、3学習状態、保存後通知、停止・失敗時の保全は共通経路を使用する。

## 3. 複合操作との境界

同一ドラッグで別モニターへ移動し、最大化W03／四隅配置W07も成立したら[複合契約](compound-drag.md)で各1件を原子保存し、適格な通知を1つにまとめる。

- `FinishMove`が同一入力transaction・開始／終了monitorと対象情報を照合し、`CompoundMoveResult`を`compound-drag-v1`へ送る。単独W02として部分送信しない。
- W02＋W06（別画面へのhalf配置）は未検証で、自動的に対応対象へ含めない。

## 4. 検証と限界

- `tests/native/policy/MonitorMoveTests.cs`：戻し、DPI／作業域変更、停止・注入・競合、複数画面配置。`tests/native/native-operation-policy.test.ts`でC# JSON→Main／Core→SQLiteを検証。
- `tests/integration/candidate-to-page-model-data-flow.test.ts`と隔離smoke：W02両入力、方向不明時の記録のみ、3学習状態、保存失敗・ACK喪失・再配送と両ページ集計。
- **未確認**：代表アプリでの実入力、画面構成変更・混在DPI、実OS通知、同一最終buildのR02／J04。追跡は[#47](https://github.com/YutoMatsui21/shortcut-expert/issues/47)。実装時の検証結果と異常なローカル保存環境の切り分けは[#38](https://github.com/YutoMatsui21/shortcut-expert/issues/38)／該当PRで参照する。
