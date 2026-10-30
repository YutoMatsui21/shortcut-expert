# W03・W04：最大化／最大化解除・最小化

**責務**：同一ウィンドウの入力前後の状態を確証し、最大化（W03）と最大化解除・最小化（W04）を分類する。ドラッグ中の派生復元や連続キーによる二重計上を防ぐ。[製品要件](../ui-requirements.md)、[技術調査](../research/compound-drag-validation.md)。

## 1. 共有する判定

`CandidateTracker`で入力対象・process・入力由来・結果・期限・競合・dragの始終を照合。標準captionのボタン矩形は`WindowCaption`を共用し、有効な`TITLEBARINFOEX`を優先する。全ボタン矩形が空のときのみ既存hit testへ戻し、無効矩形・取得失敗を勝手に推測しない。

通常のNative→Main厳格parse→Core→SQLite→学習・記録画面→保存後通知を使用する。W03/W04の学習状態は別に保持し、旧W05を新W04へ合算しない。

対象は実行ファイル名の許可リストではなく、通常の可視root窓・caption・非owned／非tool／非cloaked・非昇格の条件で判定する。Shell／desktop／自己process、判定情報不明は除外する。最小化結果を読むため、結果窓の`IsIconic`だけでは除外しない。Nativeは実行ファイル名を取得・通信せず、固定カテゴリ`ordinary-window`を送る。旧4カテゴリは既存fixtureの互換読取だけに残し、一般アプリ受入の代用にはしない。この同じ対象読取はW02／W06／W07と複合dragにも使う。

## 2. W03：最大化

| 入力 | 成立条件 |
| --- | --- |
| マウス | 最大化ボタン、captionダブルクリック、**上端への直接ドラッグ**と通常→最大化の結果 |
| キー | `Win+↑`と対象窓の最大化結果 |

上端ドラッグはcaption押下→MOVESIZESTART→物理解放→同一対象のMOVESIZEEND／最大化を確認し、**終端だけ**1件計上。解放位置は作業域上端から2物理px以内・作業域内のX、解放先monitorと結果monitorが一致することを必要とする。

**2pxは保守的な実装境界**で、Windows標準のSnap許容範囲を実測して保証した値ではない。Snap Layoutの内部選択、解放不明・取消・注入・対象変更・構成変更・重複・遅着の未検証結果は採用しない。

## 3. W04：最大化解除・最小化

| 経路 | 成立条件 |
| --- | --- |
| 最大化解除 | 復元ボタン／captionダブルクリック／`Win+↓`で最大化→通常 |
| 最小化 | 通常／最大化中の最小化ボタン、または`Win+↓`で最小化 |

- 同一窓／processへの確定済み`Win+↓`の**物理的な再押下**が1000ms以内なら、最大化解除→最小化を**W04の1操作**へまとめる。キーrepeatは再押下として扱わず、期限を延長しない。
- 他入力・別対象・foreground変更・停止／世代変更・期限超過で連続関係を終了する。1000msは実装上の境界で、実機精度の統計ではない。
- 最大化中のマウス最小化には、必要に応じて`Win+↓`を繰り返す案内をする。arranged／不明な起点では操作記録とキー同等性を分離し、確証できないキーは通知しない。arranged起点の`Win+↓`を無条件に最小化として採用しない。

## 4. 複合ドラッグとの関係

同じドラッグで**W02画面移動＋W03最大化**が成立する場合、[複合契約](compound-drag.md)で両操作を1件ずつ原子保存し、適格な通知を1つへまとめる。ドラッグ開始による派生復元W04は増やさない。

## 5. 検証と残る受入

- `tests/native-policy/WindowStateTests.cs`：W03のcaption／上端、W04のmouse／key／連続キー・repeat・競合、否定例と世代。`tests/window-state.test.ts`／`tests/native-policy.test.ts`で厳格parse→Core→SQLiteを確認。
- `tests/fixture-integration.test.ts`：W03/W04各状態・通知adapter・一覧／記録・保存遅延／失敗・ACK喪失・再送非重複。
- **未確認**：一般アプリ・上端解放許容範囲・遅着結果、混在DPI、複合操作の#113、最終buildの自然入力R02／J04とOS通知。[最終受入 #47](https://github.com/YutoMatsui21/shortcut-expert/issues/47)。Issue #31／#33の局所実装完了を全面受入と混同しない。
