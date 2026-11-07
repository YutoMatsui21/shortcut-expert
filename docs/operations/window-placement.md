# W06・W07：左右半分／四隅への配置

**責務**：ドラッグ終端またはWin保持中の方向キー列から、左右half（W06）・四隅quarter（W07）を確証し、中間のhalfや派生復元を誤計上しない。[製品要件](../ui-requirements.md)、[技術再審査](../research/compound-drag-validation.md)。

## 1. 配置形状と共通条件

- `PlacementGeometry`はDWM可視frameとmonitor作業域・DPI・arranged・通常状態を照合し、**左右half／四隅quarterのみ**分類する。座標丸めは最大1物理px。任意比率、サイズ制限、arranged不明・API失敗、最大化／最小化結果は配置として推測しない。
- 対象・process、入力由来、同一monitorまたは複合候補の始終monitor、画面構成・作業域の一貫性を必要とする。ウィンドウ矩形、HWND、入力列を通信・保存に含めない。

## 2. マウス・キーの判定

| 経路   | 判定上の約束                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| マウス | caption押下→MOVESIZESTART→物理解放→同一対象のMOVESIZEENDと最終形状を照合。通常／最大化・非arranged起点を扱う |
| キー   | `Win`保持中の物理方向入力を一連の列として保留し、**両Winキーの解放後**に最終形状を確認                       |

- **マウス**：解放位置は、最終形状に対応する作業域側端から公開mouse docking閾値と8物理pxの大きい方以内（取得不能時8px）。quarterでは上下側も照合。旧2pxは、入力・対象・quarter形状が成立した自然入力の「端から3〜8px」の区分を棄却したため修正した。8pxはこの区分を取りこぼさないためのfallback／下限で、WindowsのSnap領域を実測・保証した値ではない。Snap Layout内部の配置選択、端から離れた解放、結果遅着、独自captionの任意実装は一般対応未証明。
- **キー**：同じWin保持列のhalf→quarterは途中W06を計上せず、**最終W07の1件だけ**。Win解放でW06が確定した後の独立した入力でquarterになれば、別のW07として計上する。入力方向と最終形状が違うもの、起点が不明なものは採用しない。
- **除外**：cancel、注入、repeatによる期限延長、競合入力、別対象・foreground変更、画面構成／世代変更、対象破棄、停止、重複終端。棄却した入力列の途中から新しい正常列を作らない。Win+↑の最大化結果は[W03の入力時状態と期限付き再照会](window-state.md#2-w03最大化)で確定し、配置列を消費する。既にarrangedのウィンドウも対象とする。
- **期限**：Win保持列15秒、最後の物理方向入力→解放1000ms、mouse押下→移動開始1000ms。いずれも実装上限で、自然入力の精度実証ではない。

## 3. 通信・複合配置との境界

Nativeの`placement-v1`証拠へ終端shape・対象一致・入力の経過・monitor変更・通知monitorを載せる。Mainが厳格parse、Coreが由来・経路・期限・結果を再確認。W06/W07は操作別の件数・キー率・学習状態として保存し、W07は**Winを保持した順次方向キー**として案内する。

**別monitorのW02＋W07**は[複合契約](compound-drag.md)で各1件を原子保存し、通知を1つへまとめる。cross-monitor quarterは`CompoundMoveResult`へ変換し、単独placementとして部分送信しない。W02＋W06は未検証のため送信しない。

## 4. 検証と未確認条件

- `tests/native/policy/PlacementTests.cs`：DPI・作業域・負座標・形状・サイズ制限、同一Win列と独立操作、取消・途中状態・注入・重複の人工列。
- `tests/operations/window-snap-placement.test.ts`、`tests/native/native-operation-policy.test.ts`、`tests/integration/candidate-to-page-model-data-flow.test.ts`：v2 parse→Core→SQLite、mouse／keyと3学習状態、保存後通知、停止・ACK喪失・再配送、一覧／記録の整合。隔離smokeで本番Rendererへ接続する。
- **未確認**：側端8pxの上限で一般Windowsの自然ドラッグを十分に扱えるか、実機の結果遅着／混在DPI／画面構成変更、実OS通知、最終buildのR02／J04。配置済み起点は現在のmouse判定で除外される制約として残し、通常サイズ起点の受入と混同しない。単独W06/W07の局所実装と[最終受入 #47](https://github.com/YutoMatsui21/shortcut-expert/issues/47)を区別する。

## OSの早期スナップ閾値

Windowsは端まで運ばなくてもSnapできる設定を持つ。[公式説明](https://support.microsoft.com/en-us/windows/experience/snap-your-windows)。W06/W07のdirect side解放は、従来8 physical pxを下限／fallbackとし、[SPI_GETMOUSEDOCKTHRESHOLD](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfow)で取得した有効値1〜256と大きい方を使う。現在の環境は64。これはdocking距離を使う保守的なstripであり、Windows11の四隅preview全体のpolygonやhysteresisを取得した意味ではない。256は実装上の妥当値上限で、公式の最大値ではない。

getterはSYSTEM_AWAREのthread contextで呼び、finallyで元へ戻す。ForDpi版はこのactionをサポートしないため使わない。Native起動時にcacheし、設定変更前は候補とcacheを無効化、変更後に再取得。fixtureではgetterを呼ばない。gesture前後で設定値が異なる場合は採用しない。window/frame形状1px、対象・構成・monitor/work・DPI・入力・release・期限のチェックは維持する。W03も同じgetter値を利用し、取得不能時fallback／下限だけ2pxとする。

実測・取得値・回帰と未確認範囲は[session19の調査](../../validation/issue-47/corner-release-diagnosis-20261030.md)。中央のSnap bar選択を無条件に受け入れず、新buildの自然入力では早期quarterとbar選択の負例を別々に確認する。
