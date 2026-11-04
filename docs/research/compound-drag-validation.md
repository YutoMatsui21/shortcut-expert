# 複合ドラッグ：画面移動＋配置の判断根拠

**いつ読むか**：W02とW03／W07の同時計測、異なるmonitorへのドラッグ、キー案内の同等性に疑問が出たとき。現在の正本は[複合操作要件](../ui-requirements.md#compound-gesture)。実装は[#113](https://github.com/YutoMatsui21/shortcut-expert/issues/113)、最終受入は[#47](https://github.com/YutoMatsui21/shortcut-expert/issues/47)。

## 1. 解決したい問題

同じドラッグで「別画面への移動」と「最大化／四隅配置」が独立して成立し得る。**どちらか一方だけの保存では事実を欠落させる**。一方、単なるmonitor通過・派生復元・一時的half・programによる結果変化を別操作へ誤計上してはいけない。

## 2. 実測による判断

2026-10-28の[#14](https://github.com/YutoMatsui21/shortcut-expert/issues/14)で、[#9の33試行](eight-operation-validation.md)に加えて**16件の自作窓操作**を実測。調査時点では全8操作が**制約付き着手PASS**となったが、製品での原子保存・通知は測定していない。

| 試行の焦点                      | 得られた知見                                 | 解釈上の限界                                     |
| ------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| 同一monitor上端drag／Win+↑      | 通常→最大化を確認                            | それだけで全アプリのW03検出を保証しない          |
| 上下2画面でWin+Shift+←／→       | 下→上は左右両キーで成立、上→下は←で確認      | **物理左右・monitor番号でキー方向を推定しない**  |
| 別monitorの左上／右上直接drag   | 終端quarterとmonitor移動がともに観測された   | OSのcorner許容領域は測定していない               |
| 途中跨ぎ→元画面へ戻す／Esc      | 遷移回数があってもW02不成立                  | **始終monitor差と物理解放／確定終端**が必要      |
| programによる最大化・別窓の変更 | 最終形状だけではユーザー入力に帰属できない   | 入力対象・結果・経路の相関が必要                 |
| 方向キーを順次実行              | 最終monitor＋最大化／quarterの再現を本人確認 | 研究probeの`mixed`集計からキー順序は復元できない |

原本：[16試行](../../validation/evidence/compound-drag-20261028-session1.jsonl)、[本人確認](../../validation/evidence/compound-drag-20261028-session1-operator.jsonl)、[試験source](../../validation/probes/EightOperationProbe.cs)。

## 3. 採用する設計と代替案

- **採用**：同一gestureの始終対象・monitor・物理解放・終端形状を相関付け、W02＋W03／W07をそれぞれ独立判定。成立した異なる操作IDを**同じDB transactionで各1件**、gestureあたり通知要求最大1件。派生W04・中間W06・同一ID重複は計上しない。
- **キー同等性が不明なら**：確証された操作は記録しても、方向や複合操作のキー再現を推測して案内しない。個々のキー列を示すことと、複合ドラッグ全体の同等操作を保証することは異なる。
- **保留する条件**：画面跨ぎhalf（W02＋W06）、横並び／非整列・混在DPI、構成変更と後着イベント、独自caption等。現行の成立条件を勝手に広げない。
- **誤った代替**：研究用の`releaseZone=top-center`は端から16物理pxの分類によるもので**WindowsのSnap領域の仕様ではない**。閾値の拡大だけで検出不可を解決しない。Win+Shiftの左／右キーと物理移動方向も同一視しない。

## 4. 再調査する場合

まず[#113](https://github.com/YutoMatsui21/shortcut-expert/issues/113)の製品証拠と[W02](../operations/monitor-move.md)、[W03・W04](../operations/window-state.md)、[W06・W07](../operations/window-placement.md)の境界を確認する。次に失敗した条件を**入力・monitor構成・release位置・終端・保存／通知**へ分離し、原本を残したまま追加試験する。

調査入口`node scripts/probes/eight-operation-probe.mjs --self-test`。本人の明示同意後のみ`--observe-consented`。研究probeの成功を製品Native→Main→SQLiteの成功や、最終buildでの実機認識率と混同しない。
