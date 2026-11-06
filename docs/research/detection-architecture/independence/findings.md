# 初回8操作の独立検出可能性：静的調査

**調査対象**：`main` [`86439f6f`](https://github.com/YutoMatsui21/shortcut-expert/tree/86439f6f4062c36d1f7016049c308f2fa1f0066f)（2026-11-06）。**実施したこと**：現行C#/TSの入力・判定・競合制御、操作仕様、既存テストの静的照合。**実施していないこと**：検出器の切離し、単独/同時実行比較テスト、実Windows自然入力。以下の「可能性」は**実証済みの判定ではない**。

## 1. 何を「独立」と呼ぶか

**検出の独立性**：ある操作の成立/不成立を、**ほかの操作の検出結果や専用複合Handlerの成否を参照せず**、自分の入力・結果の証拠から判断できること。

次は「依存」と区別する。

- **共有してよい**：Windowsイベント、押下時/終端時の窓状態、対象同一性、単調時刻、入力の注入・競合、**ジェスチャID**などの共通観測情報。共通観測器は「W01が成立した」といった**製品上の判定を代行しない**。
- **分離したい**：W03がW01の成立結果を読む、W02がW03専用の処理結果なしでは成立できない、別Handlerのprivate pending状態を直接参照する、操作の組合せごとに専用の検出コードを増やすこと。
- **独立性とは別問題**：同じ物理入力のグループ化、途中状態の非計上、異なる結果の原子保存、製品で対象外の組合せの棄却。これらは**結果確定/統合のルール**として必要な可能性がある。

独立性の判定は「A HandlerがいなくてもBの**生の成立証拠**が同じか」で行い、「Aggregatorが最終的にBを記録したか」だけでは判断しない。

## 2. 操作別評価（現行コード）

| 操作 | 自分だけで確かめたい証拠 | 現在ほかと結びついている部分 | 独立化の見込み・未解決点 |
| --- | --- | --- | --- |
| **W01 切替** | ユーザーの直接クリック/Alt+Tabと、対象が別の通常窓へ前景化したこと | `Observer`が非アクティブcaption開始時に`switching.Cancel()`。通常`WindowSwitchObserver.Read`はcaptionを要求するが、専用caption経路の前景・対象照合はcaption不要 | **条件付き**。通常切替のPolicyは単体で判断可能。ただし背後窓の最大化/最小化と、最小化後の前景遷移を含めて同じ証拠を保持できるか未検証 |
| **W02 別画面移動** | 1つのドラッグ/Win+Shift方向列、同じ窓の始終monitor差、対象・配置/環境の整合 | `CandidateTracker.FinishMove()`は**通常終端なら単独W02**、最大化/quarter終端は複合結果に分岐。Win+Shift中の派生変化も同じTrackerが抑制 | **条件付き**。monitor差はW03の結果を読まなくても判定できそう。ただし**最大化/quarter終端を許すか**など、専用複合経路にある整合条件を共通証拠に移す必要がある |
| **W03 最大化** | 同じ窓の入力に伴う通常→最大化（ボタン/ダブルクリック/上端ドラッグ/Win+↑） | 背後窓captionのマウス入力を通常Trackerに渡さない場合がある。cross-monitorのドラッグ最大化は`CompoundMoveResult`分岐で、単独window候補と別扱い | **条件付き**。変化自体は独立に確認できそう。ただし背後窓のクリック証拠とcross-monitorドラッグの始終証拠を失わずに受け取る設計が必要 |
| **W04 復元・最小化** | 同じ窓の入力に伴う最大化解除/最小化 | Win+↓の連続入力を同一操作へ統合する`completedWinDown`、ドラッグ中の派生復元の抑制、非アクティブcaptionの最小化経路がTrackerと別 | **条件付き**。W01の結果は不要。ただし**「何を1回のW04と数えるか」**を自身の入力系列/ジェスチャ境界で扱う必要がある |
| **W06 左右半分** | 最終形状がhalfで、対応するドラッグ/Win保持方向列が成立したこと | `PlacementPolicy`はW07と**同じseries**を保持。途中halfを確定せずWin解放後の終端で決める。cross-monitor halfは現行対象外 | **条件付き**。最終形状でW07と排他的に判定可能。ただしhalfの途中状態を早期に発行しない仕組みと、対象外のW02＋W06を誤解放しない仕様が必要 |
| **W07 四隅** | 最終形状がquarterで、対応するドラッグ/方向キー列が成立したこと | W06と`PlacementPolicy`の入力系列を共有。cross-monitor quarterは単独`placement`でなく`compound-drag`として送出 | **条件付き**。最終形状が確定すれば独立判断できそう。ただしcross-monitorの終端証拠とWin保持列の完了待ちが必要 |
| **W11 閉じる** | 閉じる入力/Alt+F4と**同じ窓のDESTROY/消滅** | 専用`WindowCloseObserver/Policy`が独自pending・timerを持つ。Observerの共通キー/マウス例外・取消ルールには従う | **比較的高い**。他のW IDの成立結果を読まず、専用Policyだけで閉鎖証拠を作れる。別窓foreground変更からW01を誤計上しないことは併走テストで確認が必要 |
| **W12 タスクバー** | 存在するslotへのクリック/Win+数字、前後UIA snapshotの照合 | 専用`TaskbarInputObserver`の非同期照会。Observer側でWin+数字をTrackerへ渡さず、W01重複を避けている | **比較的高い**。W01の成立結果は不要。ただしWin+数字/タスクバークリックによる**W01誤発行の防止**は併走試験が必要 |

**総評**：既存コードに「W03を採用するにはW01の`Observation`が必要」といった**結果間の依存は確認されなかった**。しかし、**入力系列・対象判定・取消ルールの共有**は多く、独立化に必要な入力/証拠インターフェースはまだ整っていない。**W11/W12は比較的切り出しやすく、W01/W02/W03/W04/W06/W07は条件付き**、というのが静的分析の結論。

### 根拠：変更が必要な現行コード

- **イベント配送と競合**：[Observer.cs OnMouse](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Core/Observer.cs#L293)、[OnKey](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Core/Observer.cs#L593)、[OnEvent](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Core/Observer.cs#L760)。caption成立時の`switching.Cancel()`、Win+数字の早期return、drag開始時のCancelなど。
- **W01との隠れた結合**：[InactiveCaptionPolicy.EligiblePress](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Window/InactiveCaptionPolicy.cs#L14)は`switching.CaptionPressReady`から渡される**切替検出器の内部状態**に依存。[WindowSwitchObserver.Read](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Window/WindowSwitchObserver.cs#L63)は通常caption要求だが、専用caption経路では`requireCaption:false`。[切替Policy](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Window/WindowSwitchPolicy.cs#L161)は自前の押下・前景・settle条件を持つ。
- **単独W02と複合W02の分岐**：[CandidateTracker.FinishMove](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Core/CandidateTracker.cs#L566)は終端がarranged/maximizedなら複合化、通常状態なら単独monitor move。**複合証拠が不正な場合に単独W02だけへフォールバックしない**のが現行仕様。
- **W03/W04と配置の共有状態**：[CandidateTracker.Complete](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Core/CandidateTracker.cs#L832)の`Placement.Owns`・`drags.ContainsKey`による抑制、Win+↓連続の`completedWinDown`。[PlacementPolicy](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Window/PlacementPolicy.cs#L181)はWin保持列を1つとして扱う。
- **専用Observer**：[WindowCloseObserver](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Window/WindowCloseObserver.cs#L1)、[TaskbarInputObserver](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Taskbar/TaskbarInputObserver.cs#L1)はいずれも自前のPolicy/timerを持つ。
- **現在は1 Candidateに複数結果を収納**：[CandidateProtocol](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/native-helper/Core/CandidateProtocol.cs#L191)の`compound-drag`/`caption-click`、[classifyGesture](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/src/core/detector.ts#L11)の2件展開。[DurableCoach.accept](https://github.com/YutoMatsui21/shortcut-expert/blob/86439f6f4062c36d1f7016049c308f2fa1f0066f/src/core/durable-coach.ts#L445)は**分類前にtransactionを消費**するため、2つのHandlerから同一transactionのCandidateを別々に送る方式はそのままでは成立しない。

## 3. 独立検出を阻む課題は4種類

| 種類 | 現在の実例 | 独立化の仮説 |
| --- | --- | --- |
| **観測不足** | 背後窓のボタン入力・一時foregroundが通常W01/W03に届かない/条件から外れる | 物理入力と結果を関連付けた**共通の観測事実**を各検出器へ渡す |
| **状態・取消の結合** | `switching.CaptionPressReady`、`tracker.Placement`、drag中の通常状態抑制 | 他操作の成否ではなく、**入力系列・最終状態・ジェスチャの有効性**を各検出器が確認できるようにする。共有事実と製品判定の責務を区別 |
| **途中状態と最終状態** | half→quarter、drag中のrestore、Win+↓連続 | 各検出器は**確定条件を満たすまで保留**し、途中の派生結果を送らない |
| **最終出力の統合** | `caption-click`と`compound-drag`の専用v2 Evidence、transaction重複排除 | 各検出器の出力を**通信前にジェスチャ単位で収集**する案を検討。正しいグループ化・期限・全体棄却ルールを別に検証し、Aggregator採用はまだ決定しない |

**注意**：単純な「同じ時刻なら統合」「全Handlerを常時broadcast」「成立したものをすべて記録」では現行動作を維持できない。必要な制限は[操作別設計](../../../operations/README.md)に従い、**W02＋W06は現時点で対象外**、不正な複合dragは片方だけ記録してはいけない。全組合せを無条件に許可することと、独立検出は別問題。

## 4. 次に行う検証（まだ実行していない）

まず**同じ観測イベント列**で「Aだけ有効」「Bだけ有効」「A/B同時」「必要な統合」を比較する。Windows APIと時間は外側だけfakeにし、実際のHandler/共通観測経路を通す。**別々のテスト用検出器だけで成功したことにしない**。

| 優先 | ケース | 独立性を認めるための確認 |
| --- | --- | --- |
| **P0** | **背後窓の最大化クリック：W01＋W03** | W01だけでも前景証拠、W03だけでも最大化証拠を作れ、併走しても両者が消えない。**2候補ではなく1gestureの確定結果**として重複なしで渡せる |
| **P0** | **背後窓の最小化クリック：W01＋W04** | W04単体で最小化、W01単体で**最小化後に前景が別窓へ移るケース**も扱える。片方の条件だけ不成立なら確認できた結果だけが残る |
| **P0** | **別画面へのドラッグ最大化：W02＋W03** | W02が最大化終端で失われず、W03が別画面終端でも証拠を作れる。drag由来の途中W04は出ない。不正な複合証拠から片方だけ誤採用しない |
| **P0** | **別画面への四隅ドラッグ：W02＋W07** | W02とW07の独立証拠、配置側の同等条件、終端形状・環境照合を維持 |
| **P0** | **Win保持でhalf→quarter：W06/W07** | W06は**途中状態では未確定**、最終W07だけ成立。Win解放後に別ジェスチャなら2件の独立記録 |
| **P0** | **タスクバー操作：W12とW01** | W12は単独成立するが、タスクバー起因の前景変更からW01を生成しない。Win+数字、click、mapping不明の負例 |
| **P1** | **閉じる：W11とW01** | 閉じた結果の自動前景変更をW01にしない。W11はW01の状態に依存せずDESTROY/消滅を確認できる |
| **P1** | **異なる連続クリック** | 時間が近いだけの別ジェスチャを統合しない。別窓、別入力、失効・旧generationでも混ざらない |
| **P1** | **W02＋W06（対象外）と不正な複合** | 検出器が個別に真の証拠を出したとしても**未承認の組合せを勝手に採用しない**。不正なcompoundの片方だけを記録しない |

さらに、各ケースで**どちらか片方のHandlerを無効化しても他方の証拠生成が変わらないか**を確認する。異常入力・注入・取消・期限・画面構成変更・古いtimer結果も再生する。

### 合格基準

1. **単独性**：ほかのHandlerの出力を参照せず、単独で成立/不成立を判断できる。
2. **不干渉**：同じ観測列でHandlerを併走させても、各Handlerの**確定前の証拠・判定**が単独時と一致する。重複・不成立・対象外の組合せの扱いは**出力統合の段階で別途検証**する。
3. **1gesture**：同じ物理操作から発生した結果と、時間の近い別操作を確実に区別。入力IDが必要なら**ObserverのOS観測から付与**し、窓タイトルや入力列をJSONLへ渡さない。
4. **互換性**：既存v2通信・0〜2件のObservation・原子保存・通知、対象8操作を維持。新しい内部Aggregator案が既存wire形式に収まるか、既存`caption-click/compound-drag` Evidenceとの表現整合も確認する。
5. **実証の区別**：ソース/既存fixtureの静的調査では「成立可能性」にとどめ、**新しい独立Handlerを動作させた自動比較テストがPASSするまで証明完了とはしない**。実Windows自然入力はさらに別の段階で判断する。

**現時点の設計判断**：ArbitrationPolicy/InactiveCaptionHandlerを廃止する・Aggregatorを追加する、のどちらも**未決定**。まずP0の代表例で独立検出と不干渉の成立を実証する。その結果を踏まえて[目標構成](../target.md)と[移行計画](../migration.md)を改訂する。
