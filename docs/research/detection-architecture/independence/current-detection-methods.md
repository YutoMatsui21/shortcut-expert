# 現行8操作の検出方法

**位置づけ**：独立検出を検討する前に、**今のコードが何を根拠にCandidateを発行するか**を整理した静的調査。製品として望ましい検出条件の提案ではない。

**確認対象**：2026-11-07の`main` [33f6b403](https://github.com/YutoMatsui21/shortcut-expert/tree/33f6b403df8b409170432dd4bc7f3017998f4cdb)。C# Observer/Policy、TypeScript `classifyGesture`・`classifyWindow`。**テスト実行・自然入力確認は未実施**。仕様の正本は[製品要件](../../../ui-requirements.md)と[操作別設計](../../../operations/README.md)。

## 1. 共通の検出方法

```text
Windowsの入力（マウス・キー）＋WinEvent／Win32の状態読取
  → C#が同じ対象・入力由来・開始時情報と結果を照合
  → 条件が成立すればEvidence付きCandidate（protocol v2）を発行
  → TypeScriptが再検証してW01等の操作IDと案内キーに分類
```

- **入力の由来は取得する**。マウス左押下/解放、キーdown/up、押下位置、対象窓、`WinEvent`、窓の状態・monitor・配置幾何などを取得する。ただしWindowsが「この状態変更の原因はこの入力」と直接教えるのではなく、**同じ対象・入力・時間・結果を照合して判断**する。
- **開始と終了だけを無条件に比較しているわけではない**。ドラッグ開始/終了（`MOVESIZESTART/END`）、クリック解放、キー保持と解放、閉じる窓の破棄確認などを、操作が終わったかどうかの証拠として使う。**中間のサイズ変化を逐一操作として記録する必要はない**が、入力の継続や確定時点は把握する。
- **C#の発行＝記録ではない**。TypeScriptが`origin/route`、入力前後の状態、注入/競合、対象一致、期限、幾何等をチェックし、不正なら記録しない。未知のキー同等性では、操作だけ記録して案内しないケースもある。
- 各操作の条件は**入力・対象・結果の組合せ**。単なるウィンドウ状態の変化だけでは記録しない。候補の発行・消費と送信順、古い世代・同一transaction重複の排除もある。

## 2. 8操作の早見表

| ID | マウス操作として認める入力 | キー操作として認める入力 | 結果確定の要点 |
| --- | --- | --- | --- |
| **W01 切替** | 別の適格ウィンドウを直接左クリック | Alt+Tab | 別窓への確定したforeground移行。**W12は除外** |
| **W02 別画面移動** | ウィンドウを別monitorへドラッグ | Win+Shift+←/→ | 始終monitorが異なる。**単独マウス経路は終了時「通常サイズ・非整列」** |
| **W03 最大化** | 最大化ボタン、captionダブルクリック、上端ドラッグ | Win+↑ | **通常サイズ→最大化**。ドラッグ経路は端での物理解放も必要 |
| **W04 復元・最小化** | 復元/最小化ボタン、captionダブルクリック、限定fallback | Win+↓ | 最大化→通常、または通常/最大化→最小化。Win+↓連続の二重計上を抑える |
| **W06 左右半分** | 左右端へのドラッグ | Win保持＋方向キー | 最終形状が左右half。キー操作ではWin保持系列の**終了時**に判定 |
| **W07 四隅** | 四隅の配置を成立させる端ドラッグ | Win保持＋方向キー列 | 最終形状がquarter。途中のhalfは別計上しない |
| **W11 閉じる** | 閉じるボタンの明示的押下・解放 | Alt+F4 | **同一窓のDESTROY＋実際の消滅**を確認 |
| **W12 タスクバー** | 主タスクバーのアプリアイコン押下・解放 | Win+1〜9/0 | タスクバー項目の番号をUIA snapshotで前後照合。起動済みか否かは問わない |

以下は**現行実装で実際に絞り込んでいる条件**。`normal`＝通常サイズ、`maximized`＝最大化、`minimized`＝最小化、`arranged`＝Windowsの整列状態。

## 3. 個別の検出条件

### W01：ウィンドウ切替

| 入力 | 開始・途中の根拠 | 終了・成立条件 |
| --- | --- | --- |
| **マウス** | 別の適格root窓を左押下。通常のW01経路では可視・非最小化・非cloaked・caption等の窓条件を確認。注入や追加修飾キーを除外 | 同じ対象で解放、foregroundイベント＋最終foregroundがその窓と一致。**解放後50ms以上**の照合 |
| **キー** | Alt保持→Tab。Shellの一時的な切替画面は最終結果としない | Alt解放後に**別の適格窓**が最終foreground。**解放後300ms以上**の照合 |

- マウスは押下から原則1.5秒、キーはAlt開始から15秒以内、解放後のsettle上限もある。Esc/他入力、同一窓へ戻る、注入、ドラッグ開始で取消。
- **タスクバークリック/Win+数字はW12専属**。W12が不成立でも、foreground変化だけでW01へfallbackしない。
- 通常のW01窓判定はcaption条件を要求するが、**背後窓の最大化/最小化ボタン操作は専用`InactiveCaptionPolicy`が別の条件でW01も扱う**（後述）。通常のW01をそのまま動かすだけでは代替できない。

**主なコード**：[WindowSwitchObserver.cs](../../../../native-helper/Window/WindowSwitchObserver.cs)・[WindowSwitchPolicy.cs](../../../../native-helper/Window/WindowSwitchPolicy.cs)。

### W02：別画面移動

| 入力 | 開始・途中の根拠 | 終了・成立条件 |
| --- | --- | --- |
| **マウス** | 押下した対象窓と`MOVESIZESTART`を関連付ける（`CandidateTracker`）。物理解放位置と`MOVESIZEEND`を保持 | 別monitorへの移動、同じ対象/process、安定した画面構成・対象一致・解放monitor等。**単独Candidateは終了状態`normal`かつ`arranged=false`が必須** |
| **キー** | Win+Shift+←/→の入力対象と開始monitorを保持 | 方向キー解放後、対象/表示構成が安定し、monitorが変わったことを確証。開始・終了は`normal`または`maximized`を許容 |

- **マウス単独経路は終了が最大化/四隅なら使わない**。終了が最大化または四隅の場合は、別途「複合ドラッグ」を判定する（§4）。
- 入力前の状態は`normal`または`maximized`を許容。ただし最終状態とその分岐次第で、実際に採用される候補は異なる。**W02の記録可否と、Win+Shift+←/→を案内できるかは別判定**。
- 元monitorへ戻したドラッグ、画面構成変更、結果不明、注入・競合、対象不一致は棄却。

**主なコード**：[CandidateTracker.cs `MoveStart/FinishMove`](../../../../native-helper/Core/CandidateTracker.cs)・[MonitorMovePolicy.cs](../../../../native-helper/Window/MonitorMovePolicy.cs)。

### W03：最大化

| 入力 | 開始状態・根拠 | 終了・成立条件 |
| --- | --- | --- |
| **マウスのボタン/ダブルクリック** | `normal`から、最大化ボタン/タイトルバーのダブルクリック（または限定fallback）と対象を照合 | 同一窓が`maximized` |
| **マウスの上端ドラッグ** | **`normal`開始**、対象ドラッグの開始と物理解放を照合 | 上端の許容位置で解放、`MOVESIZEEND`、`maximized`。**単独W03では始終monitorが同じ** |
| **キー** | **`normal`でWin+↑**を受け、対象を保持 | 対象が`maximized`になったことをWinEvent・50msタイマー等で確証。必ずしもWin解放まで待たない |

- 最大化への**状態変化だけでなく、適格な入力経路**が必要。注入、他入力との競合、対象不一致等は拒否。
- 上端ドラッグでは公開mouse docking閾値（取得不能時の下限2px）や始終の配置情報を確認。**別monitorで`normal→maximized`ならW02＋W03の複合候補**になり得る。
- **`maximized→maximized`は単独W03として成立しない**。上端ドラッグの実装上も、開始時が`normal`であることを要求する。

**主なコード**：[CandidateTracker.cs `ConfirmMaximize/FinishMove/Complete`](../../../../native-helper/Core/CandidateTracker.cs)・[detector.ts](../../../../src/core/detector.ts)。

### W04：最大化解除・最小化（統合ID）

| 結果 | 開始→終了状態 | 認める経路 |
| --- | --- | --- |
| **最大化解除** | **`maximized→normal`**（終了`arranged=false`） | 復元ボタン、captionダブルクリック、Win+↓、限定fallback |
| **最小化** | **`normal/maximized→minimized`** | 最小化ボタン、Win+↓、限定fallback |

- Win+↓について、**最初の確定したW04を先に計上**し、同じ窓で1000ms以内の2回目の物理Win+↓が「最大化解除→最小化」の続きに当たる場合は**追加計上しない**。**2回目まで待って最終状態だけを比較する実装ではない**。
- ドラッグ途中の「最大化→通常」は派生状態なので、`CandidateTracker.Complete`がドラッグ中の確定を抑制する。
- arranged/開始状態によっては**記録できてもWin+↓の同等性が不明で通知しない**ことがある。キー経路は同等性不明を採用しない。

**主なコード**：[CandidateTracker.cs `Complete`](../../../../native-helper/Core/CandidateTracker.cs)・[detector.ts](../../../../src/core/detector.ts)。

### W06：左右半分、W07：四隅への配置

| 入力 | 開始・途中の根拠 | 終了・成立条件 |
| --- | --- | --- |
| **マウス** | captionドラッグの始終、物理解放位置。開始`normal`または`maximized`で**`arranged=false`、前後でcaptionを確認** | `MOVESIZEEND`で`normal`かつ`arranged=true`、DWM frameが作業域の正確なhalf/quarter幾何に合致。対応する左右端で解放 |
| **キー** | Winを保持して方向キー列を追跡（Win+←/→、さらに↑/↓等） | **Winキー全解放後**、最後の入力方向と最終half/quarter形状が一致。途中のhalfや同形状への戻りは採用しない |

- マウス経路は側端の公開閾値または下限8px以内、quarterでは上下領域も照合。**開始時`arranged=true`のマウス再配置は現行の`PlacementGeometry.Drag`で除外**する。
- キー経路は開始のcaption・配置情報・display layoutが必要。保持列15秒、最後の入力から解放まで1000ms。**最初の←/→でhalfになっても、同じWin保持列でquarterへ進めばW07だけ**。
- **別monitorへのquarterドラッグは単独W07ではなくW02＋W07の複合Candidate**。別monitorへのhalfドラッグ（W02＋W06）は現行の対象外。

**主なコード**：[PlacementPolicy.cs `PlacementGeometry/PlacementPolicy`](../../../../native-helper/Window/PlacementPolicy.cs)・[CandidateTracker.cs `FinishMove/FinishKey`](../../../../native-helper/Core/CandidateTracker.cs)。

### W11：ウィンドウを閉じる

| 入力 | 開始条件 | 確定条件 |
| --- | --- | --- |
| **マウス** | **前景の適格窓**の閉じるボタンを押下・同じボタンで解放。TITLEBARINFOEXの矩形、または安全なHTCLOSE照合 | 同じ対象の`EVENT_OBJECT_DESTROY`と**本当に窓が消えたこと**を確認 |
| **キー** | 中立状態から、適格な前景窓に対する**Alt+F4** | 同じ対象のDESTROYと消滅確認 |

- 1000ms以内で、HWND/process/threadを一時的に照合。DESTROY callback時点でまだ窓が生きていれば50msのtimerで消滅を待つ。
- **最終状態が「閉じたらしい」だけでは足りない**。HIDEや別窓へのforeground変更だけではW11にしない。注入、対象不明、caption等の除外条件、破棄確認なしは棄却。

**主なコード**：[WindowCloseObserver.cs](../../../../native-helper/Window/WindowCloseObserver.cs)・[WindowClosePolicy.cs](../../../../native-helper/Window/WindowClosePolicy.cs)。

### W12：タスクバーのアプリアイコン操作

| 入力 | 開始条件 | 確定条件 |
| --- | --- | --- |
| **マウス** | **主タスクバー**の対象アイコンを左押下→同じslotで解放 | UIAのアイコン列・slot・配置が入力前後で一致 |
| **キー** | 注入・repeat・追加修飾なしのWin+数字（1〜9/0）の初回keydown | 対象slotが実在し、UIA照合で確証できる |

- UIAはHook内で重い読取りをせず、別workerでsnapshotを取得。**入力前snapshotは750ms以内、入力後の照合は2500ms以内**。不明なslotや並び替えは棄却。
- **ウィンドウが新規起動したか、既に起動していたかは見ない**。「タスクバーのアプリを操作した」ことを検出する現行仕様を維持し、W01へ重複計上しない。

**主なコード**：[TaskbarInputObserver.cs](../../../../native-helper/Taskbar/TaskbarInputObserver.cs)・[TaskbarInputPolicy.cs](../../../../native-helper/Taskbar/TaskbarInputPolicy.cs)。

## 4. 1回の操作が複数W IDになるケース

| 入力 | 現行の判断 | 主な制約 |
| --- | --- | --- |
| **背後窓の最大化/最小化ボタンクリック** | 専用`InactiveCaptionPolicy`がforegroundと終端状態を確認。**1 CandidateからW01＋W03/W04**（片方だけ成立も可） | 通常W01のcaptionフィルタをそのまま利用しない。ボタン不明は前景化・解放・状態変化の追加証拠が必要。復元W04はこの専用経路で追加しない |
| **別monitorへドラッグして最大化** | `CandidateTracker.FinishMove`が**1 CandidateからW02＋W03**へ展開する複合Evidenceを作る | **開始が`normal`、終了が`maximized`**。安定した始終monitor/画面構成、上端解放・対象確証 |
| **別monitorへドラッグしてquarter配置** | **1 CandidateからW02＋W07** | 開始が`normal`または`maximized`の**非整列**、caption必須、適格なquarter終端、側端の解放 |
| **別monitorへドラッグしてhalf配置** | **複合対象外** | W02＋W06として採用しない |

**現行の重要な性質**：複合Evidenceが不正なら**全体を棄却**し、W02だけを拾い直すことはしない。複合結果を2つのCandidateに分けて送ることもしない（`DurableCoach`がtransactionを分類前に消費するため）。詳細は[複合ドラッグ](../../../operations/compound-drag.md)と[複合caption](../../../operations/compound-caption-click.md)。

## 5. 「なぜその条件が必要？」を別途判断する箇所

以下は**現行コードの制限として確認できた事実**。**不具合と断定したり、独立化と同時に無条件で緩和したりしない**。

| 現行の制限 | 何が起きるか | 独立化の前に判断したい問い |
| --- | --- | --- |
| **単独マウスW02は終了`normal`・非整列** | 最終状態が最大化なら単独W02の経路を通らない | W02の本質がmonitor差なら、終了時の状態制限が必要なのはどの範囲か |
| **最大化へのドラッグは開始`normal`を要求** | **最大化A→ドラッグ→最大化B**は、単独W02でも複合W02＋W03でも採用できない経路になる | 「最大化は同じまま・monitorだけ変わった」はW02にすべきか。ユーザーが検討している改善候補 |
| **マウス配置は開始`arranged=false`** | 左右半分など**配置済み状態から別の配置へドラッグ**すると、最終形状が正しくてもW06/W07から漏れ得る | 既存の誤採用防止条件をどこまで維持しつつ、開始状態の許容範囲を広げられるか |
| **通常W01の対象判定とcaption専用経路が異なる** | 独自タイトルバーでは、通常経路が成立しなくても専用caption経路が成立する場合がある | 共通の窓適格性/入力証拠に整理できるか。拡張による誤検出をどう抑えるか |
| **W04の連続Win+↓は1回目で既に計上** | 全キー解放後の開始/終了比較だけに置き換えると、記録タイミングや重複除外が変わる | 現行仕様を保つなら「一連の入力」の区切りを何で定義するか |
| **W11はDESTROY、W12はUIAの照合を待つ** | マウス/キーupの瞬間の状態だけでは成立しない | 入力終了と結果確定を分ける共通表現が必要か |

**暫定的な整理**：各操作に共通して必要そうなのは、(1)入力の種類と経路、(2)同じ対象に対する入力である証拠、(3)入力開始前の状態、(4)確定した最終状態/結果、(5)操作の区切りと取消・期限。これを独立検出器へ渡せるかは**次の実験テーマ**であり、現行実装済みの共通`Gesture`型があるという意味ではない。

## 6. 検証範囲

- **確認済み**：現行コード上の条件分岐、Candidate生成経路、TypeScriptによる最終採用条件の静的確認。
- **未確認**：実Windows上での再現頻度、全アプリの対応、制限を外しても誤採用しないか、独立したHandlerの同時動作、共通Gesture方式の可否。
- **今回変更しないもの**：実装コード、製品要件、[既存の目標アーキテクチャ](../target.md)と[移行計画](../migration.md)。本書はその見直し材料であり、正式な仕様変更ではない。
