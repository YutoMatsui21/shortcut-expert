# W03・W04：最大化／最大化解除・最小化

**責務**：同一ウィンドウの入力前後の状態を確証し、最大化（W03）と最大化解除・最小化（W04）を分類する。ドラッグ中の派生復元や連続キーによる二重計上を防ぐ。[製品要件](../ui-requirements.md)、[技術調査](../research/compound-drag-validation.md)。

## 1. 共有する判定

`CandidateTracker`で入力対象・process・入力由来・結果・期限・競合・dragの始終を照合。標準captionのボタン矩形は`WindowCaption`を共用し、有効な`TITLEBARINFOEX`を優先する。全ボタン矩形が空なら既存hit testへ戻す。独自captionの矩形が不整合でも、root自身が明示的に返したHTCAPTION／HTMINBUTTON／HTMAXBUTTON／HTCLOSEは維持する。不整合な矩形から位置を推測せず、client／resize／不明から操作を作らない。有効な矩形の優先・無効状態の棄却と、取得失敗時の扱いは維持する。

通常のNative→Main厳格parse→Core→SQLite→学習・記録画面→保存後通知を使用する。W03/W04の学習状態は別に保持し、旧W05を新W04へ合算しない。

対象は実行ファイル名の許可リストではなく、通常の可視root窓・非owned／非tool／非cloaked・非昇格の条件で判定する。Shell／desktop／自己process、判定情報不明は除外する。最小化結果を読むため、結果窓の`IsIconic`だけでは除外しない。Nativeは実行ファイル名を取得・通信せず、固定カテゴリ`ordinary-window`を送る。旧4カテゴリは既存fixtureの互換読取だけに残し、一般アプリ受入の代用にはしない。W03/W04は入力・結果とも`WS_CAPTION`を必須としない。対象読取はW02／W06／W07と複合dragにも使うが、captionの有無を一時状態として保持し、これらの操作には入力・結果とも従来のcaption条件を維持する。

rootのボタン矩形照合後も`WM_NCHITTEST`が`HTCLIENT`の場合は、実際のヒット先の子窓を10ms上限で照会する。同じroot祖先・同じprocessを照会前後で確認し、子窓が明示的に`HTCAPTION`を返した場合だけcaptionとして扱う。rootのボタン／resize／不明判定を上書きせず、子窓のclient・不明・別対象・別processも採用しない。子窓のHWND・process・座標は一時照合だけで、通信・保存へ追加しない。W03/W04以外のcaption dragも同じ入力照合を使う。

## 2. W03：最大化

| 入力   | 成立条件                                                                         |
| ------ | -------------------------------------------------------------------------------- |
| マウス | 最大化ボタン、captionダブルクリック、**上端への直接ドラッグ**と通常→最大化の結果 |
| キー   | `Win+↑`と対象窓の最大化結果                                                      |

キー経路は物理的な`Win+↑`の初回keydown時にforegroundのHWND・process・`GetWindowPlacement`の状態を取得する。既存cacheへの登録は要求せず、通常状態（`SW_SHOWNORMAL`）だけを起点にする。最大化済み・読取不能・注入・競合入力は候補にしない。スナップ配置中を含み、キー経路には`IsWindowArranged`の値・配置形状・monitor/work/DPIの一致を要求しない。マウス経路の条件は変更しない。

入力時と結果読取で`WS_CAPTION`を要求しない。保留中のW03キー候補と一致するHWNDの結果読取は、従来どおり入力時processとの一致も再確認する。WinEvent・50ms timer・キー解放の全てで同じ結果読取を使う。マウスのヒット位置・入力由来、対象照合、結果・期限・競合などの操作条件は維持する。

入力・結果のstyle／extended styleは`GetWindowLongPtrW`を`SetLastError=true`で呼び、戻り値0かつエラーありを読取不能として棄却する。0かつエラーなしは既知のstyle値として扱う（[API仕様](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowlongptrw)、[.NETのエラー初期化・保持](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.dllimportattribute.setlasterror)）。Placement・process等の取得不能も従来どおり棄却する。

同一HWND／processかつforegroundが一致し、入力後1000ms以内に`SW_SHOWMAXIMIZED`を読めたら1件確定する。WinEventと、候補がある間だけ動く50ms間隔のWinForms timerが同じ確定処理を使う。timerはhook／WinEventと同じmessage-loop thread上で動作し、常時ポーリングや並行した状態更新を行わない。イベント欠落・キー解放後の遅延も期限内なら確認し、期限超過時は棄却する。timerの配送が遅れた場合に期限を延長しない。

↑のrepeatは候補・期限を更新せず、確定で候補と進行中の配置列を消費するため、イベント・再照会・Win解放が重なっても重複しない。別キー／マウス入力・注入・foreground離脱・対象破棄・process不一致・移動開始・画面設定変更・停止／世代変更で取消す。arranged不明でもキー記録は採用するが、マウス操作へのキー案内は従来どおりarranged=falseの確証を必要とする。

状態APIの根拠：[GetWindowPlacement](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowplacement)は最大化時のshowCmdを`SW_SHOWMAXIMIZED`と定義する。1000ms／50msは実装上の有界な確認期間・頻度であり、一般アプリの実測精度を保証する値ではない。

上端ドラッグはcaption押下→MOVESIZESTART→物理解放→同一対象のMOVESIZEEND／最大化を確認し、**終端だけ**1件計上。解放位置は作業域上端から公開API `SPI_GETMOUSEDOCKTHRESHOLD` の検証済み値（1〜256px）と2pxの大きい方以内・作業域内のX、解放先monitorと結果monitorが一致することを必要とする。取得不能／範囲外は従来の2pxへfallbackし、gesture前後で値が変わった場合は採用しない。

[SystemParametersInfoWの公開仕様](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfow)は、mouse dockingの距離と上端・左右端のdocking設定を定義する。getterのDPI context／cache lifecycleは[配置設計](window-placement.md#osの早期スナップ閾値)と共通。これは完全なWindows 11 preview領域を返すAPIではなく、256pxは実装上限でMicrosoftの公表上限ではない。Snap Layoutの内部選択、解放不明・取消・注入・対象変更・構成変更・重複・遅着の未検証結果は採用しない。

## 3. W04：最大化解除・最小化

| 経路       | 成立条件                                                |
| ---------- | ------------------------------------------------------- |
| 最大化解除 | 復元ボタン／captionダブルクリック／`Win+↓`で最大化→通常 |
| 最小化     | 通常／最大化中の最小化ボタン、または`Win+↓`で最小化     |

- 同一窓／processへの確定済み`Win+↓`の**物理的な再押下**が1000ms以内なら、最大化解除→最小化を**W04の1操作**へまとめる。キーrepeatは再押下として扱わず、期限を延長しない。
- 他入力・別対象・foreground変更・停止／世代変更・期限超過で連続関係を終了する。1000msは実装上の境界で、実機精度の統計ではない。
- 最大化中のマウス最小化には、必要に応じて`Win+↓`を繰り返す案内をする。arranged／不明な起点では操作記録とキー同等性を分離し、確証できないキーは通知しない。arranged起点の`Win+↓`を無条件に最小化として採用しない。

## 4. 複合ドラッグとの関係

同じドラッグで**W02画面移動＋W03最大化**が成立する場合、[複合契約](compound-drag.md)で両操作を1件ずつ原子保存し、適格な通知を1つへまとめる。ドラッグ開始による派生復元W04は増やさない。

## 5. 検証と残る受入

- `tests/native/policy/WindowStateTests.cs`：W03のcaption／上端、W04のmouse／key／連続キー・repeat・競合、否定例と世代。`tests/operations/window-maximize-minimize.test.ts`／`tests/native/native-operation-policy.test.ts`で厳格parse→Core→SQLiteを確認。
- `tests/integration/candidate-to-page-model-data-flow.test.ts`：W03/W04各状態・通知adapter・一覧／記録・保存遅延／失敗・ACK喪失・再送非重複。
- **未確認**：一般アプリ・上端解放許容範囲・遅着結果、混在DPI、複合操作の#113、最終buildの自然入力R02／J04とOS通知。[最終受入 #47](https://github.com/YutoMatsui21/shortcut-expert/issues/47)。Issue #31／#33の局所実装完了を全面受入と混同しない。
