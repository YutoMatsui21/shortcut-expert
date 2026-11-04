# 非アクティブ窓の最大化・最小化クリック

製品要件は[要件書](../ui-requirements.md)。1回の物理左クリックをNative内部の同一root HWND/process、押下位置、開始状態、入力tick、transactionに結び付ける。生の識別子・座標・入力時刻列をIPCや永続保存へ送らない。

- 中立状態から別の適格窓へ押下し、既存のcaption判定で最大化／最小化ボタンを確定できた場合だけ専用経路が所有する。最大化状態の最大化解除はこの複合経路に含めない。WS_CAPTION等がないため既存W01適格性を確認できない対象は、この複合経路では推測しない。
- 押下時の状態を保持し、同一対象・processの通常→最大化、通常／最大化→最小化を独立に確認する。結果のcaption消失は開始時のprocessと通常対象の再検証で扱う。読取不能・process変更は採用しない。
- W01は同じクリック以後の対象へのforegroundイベントを、コールバック時点の前面一致で確認する。最小化結果の確認後は別窓への前面遷移を許す。前面化が観測できない場合、状態変更だけを採用し、W01を推測しない。
- 物理解放・同一対象・4px以内の移動を必要とする。注入・追加キー・他ボタン・ドラッグ・別対象・停止・世代変更は取消。状態確認は既存クリック経路と同じ500ms以内とし、イベント順序を待って500msの期限で1回だけ確定する。タイマー遅延が750msを超えた結果は採用しない。この期限は保守的な実装境界で、実測精度の保証ではない。
- `caption-click-v1`は`switched`と`terminal`（最大化／最小化／なし）を単一envelopeで渡す。片方だけの確証も1操作として扱う。復元は追加しない。
- Coreは1gestureをW01＋W03／W04に展開する。SQLiteは既存のW02＋W03／W07に加え、この2組のみを2件の原子mutationとして許可する。保存成功後に学習中の行だけを1つのWindows通知へ渡す。停止・通知一時停止・保存失敗・ACK喪失・再送の契約は共通経路で維持する。

## 検証の境界

`InactiveCaptionTests.cs`でNativeのイベント列・取消・停止、`native-operation-policy.test.ts`でC#→TS契約、`inactive-caption-click.test.ts`で厳格parse→Core→SQLite→通知adapterを検証する。人工fixtureは実入力の検出精度やWindows通知の表示成功を証明しない。

実装前のChrome物理クリックでは3ケースの一時前面化を確認した（[証拠](../../validation/evidence/issue-152/chrome-event-order.jsonl)）。これは調査probeの結果で、製品の検出・保存・OS通知の受入結果ではない。ChatGPT・Obsidianと最終buildの製品経路は別途確認する。
