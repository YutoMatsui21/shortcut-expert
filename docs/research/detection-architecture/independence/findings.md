# 各操作の独立性・依存関係：静的調査

**基準**：2026-11-06の`main` [86439f6f](https://github.com/YutoMatsui21/shortcut-expert/tree/86439f6f4062c36d1f7016049c308f2fa1f0066f)。C#の`Observer`・`CandidateTracker`・操作別Observer/Policy・TypeScriptの`detector.ts`/`durable-coach.ts`と[操作別設計](../../../operations/README.md)を照合。**コード変更・テスト実行・自然入力検証は未実施**。

## 1. 先に結論

**8操作とも「ほかの操作が成功した」という結果を成立条件にする必要は基本的にない**。ただし、**現行コードで各検出器が既に独立していることは意味しない**。入力の相関情報・候補の確定タイミング・抑制条件を共有するため、単独Handlerへ切り出すだけでは既存動作を壊し得る。

独立化では、次の3つを別物として扱う。

- **判定の独立**：W03の証拠を作るのに「W01が採用された」という結果そのものは不要。
- **入力の共有**：W01とW03は同じクリックのroot/押下位置/対象/前後状態/時刻を使う場合がある。**共通の入力相関基盤**は必要。
- **記録の関係**：W01とW12は**同時に計上しない**、ドラッグ派生のW04/W06は**計上しない**など、単に候補をすべて受け入れると間違う。

## 2. 8操作の調査結果

「単独成立」は**製品仕様上、他W IDの採用結果を使わずに判断できる見込み**。「実装」は現行の検出処理が他検出器の状態やObserverの横断制御に依存するかを示す。**可否の実証判定ではない**。

| 操作                 | 単独成立の見込み                                                 | 現行実装と他検出器への依存                                                                                                                                                                            | 独立化する際の重点                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W01 切替**         | **あり**。通常クリック/Alt+Tabの入力とforeground確定を照合できる | `WindowSwitchPolicy`は独自状態を保持。ただし`Observer`がcaption成功時やMOVESIZESTARTで`switching.Cancel()`し、タスクバー入力からの計上も防ぐ。通常マウス経路の対象選択にはcaption条件がある           | W01入力の発生源を共通イベントで区別し、**W12・drag由来のforegroundをW01へ計上しない**。非アクティブcaptionで使う緩和された対象判定と通常W01の範囲を混同しない |
| **W02 別画面移動**   | **あり**。同じ窓の始終monitor差と入力/ドラッグ確証               | `CandidateTracker`がdrag press、MOVESIZESTART/END、release、Win+Shift+方向キー、配置/最大化判定と状態を共有。複合では`FinishMove`が最終結果全体を作る                                                 | 同じドラッグの終端から、**W02とW03/W07を個別評価する条件**を定義。画面移動の派生restoreは不採用。monitor未確証とキー方向だけ不明を区別                        |
| **W03 最大化**       | **あり**。対象の通常→最大化と確証済み入力を照合                  | 通常は`CandidateTracker`。Win+↑、ドラッグ、captionで異なる状態を保持。背後窓ボタンでは`InactiveCaptionPolicy`が通常Tracker/WindowSwitchを抑制して同じ結果を扱う。複合ドラッグは`FinishMove`がまとめる | **非アクティブ窓でもW03を単独確証できる入力/終状態**を定義し、W01採用結果には依存しない。ドラッグによる最大化とWin+↑/ボタンを混同しない                       |
| **W04 復元・最小化** | **あり**。確証済み入力と結果の最大化解除/最小化                  | `CandidateTracker`の`completedWinDown`と`PlacementPolicy`、`Observer`の取消が絡む。背後窓の最小化は`InactiveCaptionPolicy`が別に照合。drag中の復元を`CandidateTracker.Complete`が抑制                 | **Win+↓連続2押下＝W04一件**を変えない。ドラッグ派生restoreを除き、背後窓ボタン最小化をW01不成立でも確証できるようにする                                       |
| **W06 左右半分**     | **あり**。配置幾何＋対象と入力の照合                             | `PlacementPolicy`がWin保持の連続入力状態を持ち、`CandidateTracker`がドラッグ終端と共同で扱う。W07への途中状態として発生し得る                                                                         | **同じWin保持列の途中halfを記録しない**。dragとキーで異なる終了・確証条件を保持                                                                               |
| **W07 四隅**         | **あり**。最終の四隅形状＋確証済み入力                           | W06と`PlacementPolicy`のWin保持系列を共有。別画面のquarterは`FinishMove`がW02と一つの`compound-drag`へまとめる                                                                                        | 中間W06を除外。W02同時成立は許すが、複合終端全体に必要な対象・monitor・layout・releaseの妥当性を落とさない                                                    |
| **W11 閉じる**       | **あり**。閉じる入力と同一対象のDESTROY/消滅を照合               | `WindowCloseObserver/Policy`は比較的自己完結。共通transaction採番と`Observer.OnMouse/OnKey`からの呼出し、caption確定時の`closing.Cancel()`が横断依存                                                  | 閉鎖入力から破棄までの遅延・HWND再利用対策を維持。**閉鎖後のforegroundをW01と誤認しない**                                                                     |
| **W12 タスクバー**   | **あり**。slotクリック/Win+数字とUIA照合                         | `TaskbarInputObserver`は専用状態・非同期queryを保持。共有transaction/Protocolに依存し、`Observer.OnKey`がWin+数字をTrackerへ渡さない。通常W01の非計上条件もある                                       | W12の確定と**W01の除外**を同時に維持。未対応slot/照合不明でもW01へfallbackしない                                                                              |

**暫定評価**：各操作の**成立条件の分離は有望**。一方、W03/W04の背後窓ボタン、W02/W03/W07の同じドラッグ、W06/W07の連続キー、W01/W12の排他は**単純な独立ファイル化では成立しない難所**。

## 3. 依存を具体的に分類

| 依存の種類                     | 現行コードで確認した例                                                                                                                                                  | 解消の見込み                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **他の検出器の内部状態を読む** | `Observer.OnMouse`が`switching.CaptionPressReady`を読み、`InactiveCaptionPolicy.EligiblePress`に渡す                                                                    | **共通の入力セッション/中立条件**へ置ける可能性。ただしW01の通常対象フィルタとの相違を維持                                             |
| **他の検出器を直接取り消す**   | caption開始で`switching.Cancel()`/`closing.Cancel()`、キー入力・MOVESIZESTARTでcaption/Tracker/switchの取消                                                             | **生入力側の取消と操作間の抑制を分離**する余地。ただし不要な取消で誤採用するなら調整が必要                                             |
| **状態機械が共有**             | `CandidateTracker`に`input`/`dragPress`/`drags`/`completedWinDown`/`Placement`が集中                                                                                    | 押下・ドラッグ・Win保持列の**共有ジェスチャ事実**と操作別判定へ分割できるか要検証                                                      |
| **候補確定が複数操作を抱える** | `CandidateTracker.FinishMove`は`WindowCandidate`/`PlacementResult`/`CompoundMoveResult`から1結果を選択。caption専用Policyは`switched`と`terminal`を一つのEvidenceに保持 | **同じgestureの証拠を複数の操作判定へ渡す**構造に変更できる余地。先に「何を一つのgestureとするか」を定義する                           |
| **出力・重複排除の契約**       | `CandidateProtocol`の複数専用メソッド、`DurableCoach`のtransactionを分類前に消費する仕様                                                                                | **複数の独立CandidateをそのままTSへ送る案は現行契約と非互換**。同じgestureを1Envelopeにまとめるか、wire/保存を別案件として変更する必要 |
| **製品上の排他・包含関係**     | W12とW01の排他、W02＋W03/W07の同時成立、ドラッグ派生W04・中間W06の除外                                                                                                  | **排他規則が不要になるとは限らない**。入力の由来/因果を証拠化できれば操作組合せの総当たりは減らせる可能性                              |

### 依存関係の実装根拠

- [Observer.cs](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Core/Observer.cs)：`OnMouse`でTaskbar→Switch→Close→Trackerを呼び、caption開始時に他候補を取り消す。`OnKey`ではWin+数字をTrackerから除外。`OnEvent`はcaption保留・閉鎖・foreground・MOVESIZE/状態変化の順序を保持。
- [WindowSwitchObserver.cs](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Window/WindowSwitchObserver.cs)、[WindowSwitchPolicy.cs](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Window/WindowSwitchPolicy.cs)：通常W01はcaptionを要求する対象条件がデフォルト、caption専用経路は`Read(..., requireCaption: false)`と専用のクリック期限・foreground確認を使用。
- [InactiveCaptionPolicy.cs](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Window/InactiveCaptionPolicy.cs)：押下位置・窓状態・switch確証・ボタン不明fallbackを内部で保留し、500ms頃に結果を確定。
- [CandidateTracker.cs](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Core/CandidateTracker.cs)：`Complete`が`drags`・`Placement.Owns`中の候補を抑え、`FinishMove`がmonitor変更＋終端shapeを1結果へ統合。Win+↓連続も内部状態でまとめる。
- [TaskbarInputObserver.cs](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Taskbar/TaskbarInputObserver.cs)：専用snapshot/UIA/workerでW12候補を生成。
- [src/core/detector.ts](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/src/core/detector.ts)、[durable-coach.ts](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/src/core/durable-coach.ts)：`caption-click`/`compound-drag`は**1Candidate→2Observation**、同一transactionの2候補目は分類前に重複排除。

## 4. 特に重要な独立化の実験仮説

| 仮説                                   | 何が確認できれば支持されるか                                                                                                                             | 失敗パターン                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **H1：W01とW03/W04を別々に判定できる** | 共通のクリックID・前後状態・foreground確証を渡せば、通常W01とW03/W04が**互いの成立結果を参照せず**独立に判定できる。caption専用経路の対象条件/期限と同等 | caption専用経路を外すと、captionなし窓・ボタン不明時にW01/W03が抜ける、あるいは未確認foregroundを誤採用 |
| **H2：W02とW03/W07を別々に判定できる** | 共通ドラッグID/始終monitor/配置shape/解放位置を与え、各操作に必要な条件を保てる。複合終端の一部だけ不確定な場合の扱いは**従来と同じ**                    | 旧`compound-drag`の**全体棄却**なのに個別判定でW02のみ計上する、派生W04/中間W06が余分に出る             |
| **H3：W06とW07を独立に評価できる**     | Win保持列・キーup・最終shapeが共通であり、同じ列内の中間halfが確定扱いされない                                                                           | W07途中のW06を別記録、Win再押下や異なる入力列を誤結合                                                   |
| **H4：W12とW01の独立判定を両立できる** | W01が入力源とW12由来を区別でき、**タスクバー操作だけではW01成立しない**。W12が不成立でもW01へfallbackしない                                              | タスクバークリックによるforegroundをW01で誤計上、W12失敗時だけW01が出る                                 |

**ここでは仮説を採用決定にしない**。特にH2では、「2つの証拠が別々に成立する」という一般原則と、**既存複合ドラッグは不正なEvidenceを全体棄却**するという現行仕様が衝突し得る。この点は**製品仕様を変えない独立化ができるか**の判定条件となる。

## 5. 独立性を実証するためのテスト設計（未実施）

1. **基準イベント列の固定**：同一OS入力・WinEvent・window snapshot・期限・generationを再生し、現行の候補数/証拠/Observation/保存件数を取得。対象はW01〜W12の8操作の正常・否定例とH1〜H4。
2. **各Handlerの単独検証**：対象操作用Handlerだけで証拠を確定できるか確認。共通の入力相関/WindowFactsは使ってよいが、**他Handlerの`Pending`や`Completed`は参照禁止**。
3. **同時検証**：同じ入力列で2つ以上のHandlerを動かし、単独時の正/負結果が不要に変わらないか検証。**同時に成立してはいけない操作**（W12/W01、drag派生W04、中間W06）を負例に含める。
4. **統合検証**：同じ物理gestureに属することを**時刻の近さだけでなく、発生源/対象/入力IDと確証済み結果で照合**する。異なるクリックのW01とW03を誤結合しない。期限切れ・片方遅延・stop後到着・ID衝突・同じ操作の重複発行も試す。
5. **通信・保存**：現行v2を維持するなら**Aggregatorが1Candidateに統合してから送る**必要があり、新しいEvidence schema/Parser/Classifierの変更を独立の契約変更として扱う。wire変更を許すなら、Coreのtransaction排除・原子保存・通知も含めて比較する。
6. **自然入力**：最終buildで物理入力、独自caption、複数モニター等を本人の明示同意で確認。人工fixtureの成功だけでWindows全体の独立動作を主張しない。

### 合格・不合格の判定

- **合格**：他Handlerの結果を読まず、適切な共通イベントから必要な証拠を生成でき、単独/同時/統合時に[製品要件](../../../ui-requirements.md)と既存回帰条件を守る。
- **要追加基盤**：操作の成立は独立するが、共有ジェスチャID・入力因果・前後snapshot・確定待ちなど**横断的な観測事実**が不足。これは検出器同士の直接依存とは区別する。
- **不合格/仕様変更が必要**：単独化により既存の対象・除外・複合全体棄却・記録・通知が変わる。新案を自動採用せず、旧仕様との違いを明示して判断する。

## 6. 現時点の判断

**独立した証拠生成＋後段統合は検討する価値が高いが、まだ実証されていない。** 特にH1（非アクティブcaption）とH2（複合ドラッグ）を最初の試作対象とする。まず基準入力列と必要な共通ジェスチャ情報を洗い出し、現行の特別扱いを外しても成立するかを比較する。

**採用済み[target.md](../target.md)と[migration.md](../migration.md)は現時点では変更しない**。独立検出案が採用可能だと判定できた時点で、競合/統合の責務を再設計したうえで正式文書を更新する。
