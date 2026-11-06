# 09 Step 1〜3ドキュメントの客観レビュー（2026-11-06）

> **レビュー結果：修正前は「そのままDispatcherの実装Issueに流用する」のは不適切。今回の事実誤認・誤解しやすい記述を訂正したうえで、後述の未確定設計をStep 4で解決するなら、設計・実装Issueの入力資料として利用可能。** これはドキュメントの静的レビューであって、検出アプリの動作保証・Windows実機の受入を意味しない。

## 1. 対象・レビュー方法

- 対象：`docs/research/detection-architecture/README.md` と `01`〜`08`、参照される製品要件・操作別設計。
- 照合元：2026-11-06の`main`コミット [51a1914](https://github.com/YutoMatsui21/shortcut-expert/tree/51a1914e4ff90cdad1fac72a397cb4d7a5773bbf) の `native-helper/Core/`、`Window/`、`Taskbar/`、`src/core/detector.ts`、`src/core/durable-coach.ts`、`src/main/observer.ts`、`src/shared/coach.ts` と関連テスト。
- 手法：記述を実装の制御フロー・所有状態・契約と照合し、**事実の誤認／実装前に残る設計決定／自動テストの保証の限界**を分類。生成ドキュメントの相対リンクとコードフェンス・変更ファイルを静的に点検。
- **未実施**：コード編集、C#/Nodeテスト実行、Windows自然入力、配布物検証。過去のPRのPASSをこのレビューの実行証拠に流用しない。

## 2. 指摘・修正記録

| ID | 重要度 | 指摘と根拠 | 対応 |
| --- | --- | --- | --- |
| **F01** | **高・実装ブロッカー** | `IEvidenceHandler.OnEvent(event, context)`のvoid型だけでは、既存`Observer.OnMouse/OnKey/OnEvent`が行う**入力の専有・他Handlerの取消・配信の抑制**をどう表すか決まらない。単純なfan-outでは誤採用の恐れ（[Observer.cs](https://github.com/YutoMatsui21/shortcut-expert/blob/51a1914e4ff90cdad1fac72a397cb4d7a5773bbf/native-helper/Core/Observer.cs#L293-L377)、[OnEvent](https://github.com/YutoMatsui21/shortcut-expert/blob/51a1914e4ff90cdad1fac72a397cb4d7a5773bbf/native-helper/Core/Observer.cs#L760-L869)） | [04](04-target-architecture.md)・[05](05-contracts-and-state.md)・[06](06-decisions-and-evaluation.md)に**未確定の実装前提**として明記。具体的な調停APIはG01テストで既存順序を固定してからStep 4で確定。未確定のまま実装しない |
| **F02** | **高** | 複数のHandlerが1gestureの部分証拠を**別Candidate**で送信すると、`DurableCoach`が分類前にtransactionを消費するので後続が捨てられる（[durable-coach.ts](https://github.com/YutoMatsui21/shortcut-expert/blob/51a1914e4ff90cdad1fac72a397cb4d7a5773bbf/src/core/durable-coach.ts#L462-L489)）。複合結果は[1Envelope → Observation[]](https://github.com/YutoMatsui21/shortcut-expert/blob/51a1914e4ff90cdad1fac72a397cb4d7a5773bbf/src/core/detector.ts#L11-L112) | [04](04-target-architecture.md)・[05](05-contracts-and-state.md)に、非アクティブcaption用・複合ドラッグ用の**最終候補所有Handler**を明記。同一transactionの別送信はしない |
| **F03** | **高** | 採番を`NextTransaction()`のみから移すと漏れる。`CandidateTracker`内部でも`Mouse`/`Key`/`Build`等が直接`++transaction`を行う（[CandidateTracker.cs](https://github.com/YutoMatsui21/shortcut-expert/blob/51a1914e4ff90cdad1fac72a397cb4d7a5773bbf/native-helper/Core/CandidateTracker.cs#L366-L423)、[Build](https://github.com/YutoMatsui21/shortcut-expert/blob/51a1914e4ff90cdad1fac72a397cb4d7a5773bbf/native-helper/Core/CandidateTracker.cs#L965-L1009)） | [03](03-dependencies.md)・[05](05-contracts-and-state.md)・[06](06-decisions-and-evaluation.md)に全発番経路・世代ごとの一意性を追記し、**取消によるtransactionの欠番は許容**すると明記 |
| **F04** | 中 | `CandidateProtocol.gate`（candidate発行順）と`ObserverHost.outputLock`（stdout書込み排他）を「出力lock」として混同し得る（[Protocol](https://github.com/YutoMatsui21/shortcut-expert/blob/51a1914e4ff90cdad1fac72a397cb4d7a5773bbf/native-helper/Core/CandidateProtocol.cs#L168-L189)、[Host](https://github.com/YutoMatsui21/shortcut-expert/blob/51a1914e4ff90cdad1fac72a397cb4d7a5773bbf/native-helper/Core/ObserverHost.cs#L4-L12)） | [01](01-current-flow.md)・[02](02-responsibilities.md)・[03](03-dependencies.md)・[04](04-target-architecture.md)・[05](05-contracts-and-state.md)で責務を区別 |
| **F05** | 中 | [`classifyWindow`](https://github.com/YutoMatsui21/shortcut-expert/blob/51a1914e4ff90cdad1fac72a397cb4d7a5773bbf/src/core/detector.ts#L344-L420)は移動の成立とキー方向同等性を分ける。方向不明は**W02自体を棄却する理由ではなく、shortcut=nullで記録できる**（既存2画面配置のキー確証例外あり） | [07](07-regression-contract.md) R08の負例を「不明な移動は棄却／確認済み移動のキー不明は記録のみ」と明記 |
| **F06** | 中 | `CandidateTracker.Build`で生成される**内部レコード`WindowCandidate`はprotocolVersion=1**だが、`CandidateProtocol.V2`で外部`CandidateEnvelope`はv2へ変換される（[Tracker](https://github.com/YutoMatsui21/shortcut-expert/blob/51a1914e4ff90cdad1fac72a397cb4d7a5773bbf/native-helper/Core/CandidateTracker.cs#L965-L1009)、[Protocol](https://github.com/YutoMatsui21/shortcut-expert/blob/51a1914e4ff90cdad1fac72a397cb4d7a5773bbf/native-helper/Core/CandidateProtocol.cs#L401-L444)） | [01](01-current-flow.md)に内部／wireのバージョン差を明記。内部legacyの値だけを理由にwire変更をしない |
| **F07** | 中・プライバシー | `candidateV2`は許可fieldへ投影して余分なfieldを**黙って捨てる場合がある**。**TS受信結果だけ**の確認ではNativeの生JSONLへの機密混入を発見できない（[observer.ts](https://github.com/YutoMatsui21/shortcut-expert/blob/51a1914e4ff90cdad1fac72a397cb4d7a5773bbf/src/main/observer.ts#L113-L440)） | [01](01-current-flow.md)・[08](08-test-coverage.md) G06で**送信前の生JSONL**を検査。既存`MonitorBounds.x/y`は許可された表示幾何であり、**マウス座標列ではない**と明記 |
| **F08** | 中・テストの実効性 | 配信のためのfake Dispatcherを新設し、そのfakeだけ通すテストでは本番`Observer`の競合順序を保証できない。またhandlerのtimer/非同期照会の所有者変更時にP1の寿命テストだけでは不十分 | [08](08-test-coverage.md) G01は**本番の配送/調停実装**を対象に外部Win32・時計をfakeにするよう修正。`G03`は寿命移行IssueでP0へ格上げ |
| **F09** | 低 | [05](05-contracts-and-state.md)の「主要な3種類のデータ」という見出しの表には実際は`ObservedEvent`/`CandidateDraft`/`CandidateEnvelope`/`Observation[]`の4種類があった | 4種類に修正 |

## 3. レビュー後も未決定の重要事項

**コードを変更する前にStep 4で解決すること（実装をCodexへ委譲するための明確な前提条件）**：

1. **調停APIの具体形**：各イベントでどのHandlerが入力を専有し、他Handlerの取消・抑制・複合確定をどう通知するか。順序が変更される場合の回帰G01を本番経路で実行できるテスト境界。**ここが未確定ならDispatcher移行を実装させない**。
2. **候補最終所有の契約**：`caption-click`と`compound-drag`は1つのHandlerが最終Evidenceを構成し、別Handlerの候補との重複を防止。どのイベントからいつ所有権が移るかをG01/G02と結び付ける。
3. **内部型とwire DTOの境界**：`CandidateDraft`が既存C#の`Evidence`階層を直接持つか、独立型とするか。**最初の構造変更ではv2の出力を維持**。
4. **イベントsnapshotと配信**：いつ対象窓を読むか、Windowsのhook callbackへの負荷増加を避ける方法、timer/worker結果がどのsession/generationに属するか。
5. **移行の受入基準**：G01/G02を最小限補強し、変更前後で候補数・順序・ID・Evidence・0〜2件のObservation・原子保存・通知要求を比較。自然入力は別の受入でありテストfixtureだけで合格にしない。

## 4. レビューの最終判定

- **Step 1（現行構成の観察）**：記述に不正確なロック所有と内部protocol番号の説明不足があったが、訂正後は**現状調査資料として利用可能**。
- **Step 2（将来設計）**：方向性は妥当。ただし**Dispatcher/ArbitrationのAPIを確定せずに実装するのは不可**。完成した実装仕様とは判定しない。
- **Step 3（回帰条件・テスト）**：主要な操作・故障境界を広く扱っている。**テスト実行なし・本番Observerの配信経路の保証不足**を明記。G01/G02/G03/G06の補強方法を具体化した。
- **次の工程へ進める条件**：本書の未確定事項をStep 4の最初に設計決定し、各Issueを**依存順・対象ファイル・具体契約・R/Gテスト・受入条件**まで書く。現行コードを変更する実装PRには、その段階のWindows CI等の実行結果を記録する。

以上はレビュー時点の静的判定。**実機での検出精度向上や既存不具合の解決を主張しない**。
