# 複合ドラッグ：W02＋W03／W07

同じマウスドラッグで別画面移動と最大化／四隅配置が確定した場合の横断契約。[製品要件](../ui-requirements.md#compound-gesture)を正本とする。

## 検出と一時的な通信

- `CandidateTracker`のcaption押下→MOVESIZESTART→物理解放→MOVESIZEENDを使用する。同一HWND・process、観測generation、入力transaction、foreground、始終monitor、安定した画面構成・作業域・DPI、終端結果をNative内で相関づける。HWND・process・入力列・解放座標は通信／保存へ渡さない。
- 最大化は通常・非arranged起点と上端2px以内の解放、quarterは通常／最大化・非arranged起点と最終shapeに対応した側端8px以内の解放を要求する。[W03](window-state.md)の上端制限は維持し、quarterだけ[W07](window-placement.md)の自然入力反例に対応した側端上限を共有する。WindowsのSnap領域や一般環境での精度を保証する境界ではない。
- `compound-drag-v1`をprotocol v2の追加variantとする。envelopeのgeneration／transactionがgestureを識別する。証拠は終端shape、対象一致・物理解放・画面構成の照合結果、押下→移動開始の経過、始終monitor、確証された左右方向、終端キーの同等性だけ。Mainは必須型・許可値を検査し、許可fieldのみをCoreへ渡す。
- Coreはmouse由来・専用route・注入／競合なし・全照合成立・異なる始終monitor・入力経過0〜1000msを再確認する。不正な複合証拠は全体を棄却し、一方だけ採用しない。
- 途中の復元W04／half W06、元画面へ戻した移動、取消・別窓・program変更・Snap Layout内部選択は複合として採用しない。cross-monitor half（W02＋W06）は対象外。

## 原子保存と通知

- `classifyGesture`はW02とW03／W07の異なる2操作を返す。`DurableCoach`は同一generation／transactionの再送を除外し、`RecordMutation.counts`の2件を同じSQLite transaction・checkpointでmouse各+1する。2件目の失敗では件数・coverage・revision・checkpointを全てrollbackする。ACK喪失時は同じpayloadを再試行する。[保存契約](../storage/durable-storage.md)を参照。
- W02は左右の横並び・上端一致・非重複と確証された方向の一致でだけキーを案内する。不明でも記録し、W03／W07の適格性は独立に扱う。各キーはその操作の案内であり、順に押せばドラッグの最終結果を再現するという意味ではない。
- 保存後、操作ごとの学習状態・キー確証・通知取消tokenを再確認する。適格2件は1Toastの別行、1件は既存のキーtitle／操作名body、0件なら通知しない。別gestureは別通知とする。
- pause→resume、stop、保存失敗／ACK喪失後のretry、学習状態変更中の保存、OS結果unknownは通知を復活させない。OS結果はアプリの発行要求成功と区別し、自動再送しない。

## 検証と限界

- `tests/native-policy/CompoundDragTests.cs`：本番tracker／protocolの人工操作列、派生復元・half、対象／process／構成変更、取消・注入・競合・重複・停止・解放不明・内部選択。`tests/native-policy.test.ts`でC# JSON→厳格parse→Core→実SQLiteを接続する。
- `tests/compound-drag.test.ts`：最大化／quarter、方向不明／キー不明、学習状態混在、保存中の状態変更、pause／stop、保存失敗、ACK喪失、2件目INSERT失敗のrollback、再送・再試行、通知adapterの単一発行とunknown、一覧／記録read model。
- 隔離storage smoke：helper fixture→Main→実SQLite→IPC→両画面。通常buildと同梱buildで同じfixtureを使用する。
- 一般アプリの実入力、混在monitor・DPI、実OS Toastの表示、NSIS、同一最終buildのR02／J04は[最終受入 #47](https://github.com/YutoMatsui21/shortcut-expert/issues/47)へ残す。fixture成功を自然入力PASSと扱わない。
