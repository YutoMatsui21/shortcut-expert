# リファクタリングの移行計画

**状態：独立検出方式への移行計画。共通基盤は段階導入中、独立結果の本番切替は未実施。** [目標アーキテクチャ](target.md)を実現するため、各PRを小さく保ちながら本番経路を段階的に切り替える。

目的は、8操作の判定を互いに独立させ、GestureManagerとResultComposerで入力系列・結果を管理できるようにすること。**ArbitrationPolicyは当初作らず、実際に必要な調整が確認された場合にのみ検討する。**

## 移行の基本ルール

1. **共通入力の正当性**（対象、物理性、入力源、取消、期限、generation）は緩めない。
2. **操作ごとの独立性**を優先する。他の操作の成功・失敗を成立条件にしない。
3. 同じジェスチャの途中状態を送信しない。結果確定前にW04や中間W06を計上しない。
4. **複合の全体棄却は新仕様へ持ち込まない。** 共通入力が有効なら、確証できた操作だけを採用する。ただし、各検出器自身の成立条件は満たす必要がある。
5. 「意図した仕様変更」と「既存機能の不具合」を分離し、テストも分ける。設計変更を理由にすべての失敗期待値を書き換えない。
6. 任意の複合結果を旧Protocol v2へそのまま送れるとは仮定しない。通信契約の切替を独立した工程とする。
7. 実機での誤検出・検出漏れは基本的に**該当検出器**を改善する。調停層の追加は最後の手段とする。

## 作業順序

### 1. 回帰基準と仕様変更の固定

- PR #166・#167で改善したW02/W06/W07を含む、現行8操作の正常・負例を固定する。
- PR #169で比較した49fixtureを、独立検出後の設計テストとして再利用する。
- 特にW02＋W03/W07の**一部採用**を新しい期待結果として別テストに明記する。旧仕様の全体棄却のテストは、旧実装の保護・差分確認に用いる。
- W01＋W03/W04、W01/W12の排他、Win保持列、W11のDESTROY、Stop/Reset、非同期遅延、保存の原子性と重複排除を確認する。
- 新仕様によって変わるケースと、同等性を守るケースの一覧を作る。

**完了条件：** 今後の差分が意図した変更か回帰か判別できる。

### 2. 共通のCandidate出口とtransaction管理

- 現行の各Tracker/ObserverからのCandidate出口を、既存v2を維持したまま単一のSinkへ寄せる。
- generation・transaction・sequenceの採番と重複排除の境界を明確にし、ID衝突・旧世代復活を防ぐ。
- ObserverHostのstdout書込排他を維持する。
- この段階ではまだ新しい複合Evidenceへ変更しない。

**完了条件：** Nativeの全候補の送信順・型・結果が変更前と一致する。

### 3. ObserverとGestureManagerの分離

- Win32 hook/WinEvent/WindowFacts取得をObserverにまとめ、個別操作の判定から切り離す。
- 物理入力ID、対象、開始・終端snapshot、ドラッグとキー保持列、取消、確定、期限、generationの共通管理をGestureManagerへ移す。
- ジェスチャの状態管理に状態機械を採用し、`未開始 → 観測中 → 結果待ち → 確定／取消` の遷移をテストする。
- W11のDESTROYやW12のUIA照合など、操作固有のpending/timeoutは各検出器に残せる。
- 移行期間中は旧Trackerへのアダプターで既存処理を動かし、すべてを一度に書き換えない。

**完了条件：** 共通入力系列が一意に識別でき、途中候補や取消後の結果が送信されない。

### 4. DetectionRouterと独立検出器への段階移行

- Routerは関心のあるイベントを各検出器へ配送し、検出器の完了・保留を収集する。
- **W02・W03・W07**から独立させ、モニター移動／最大化／四隅配置が他の成立結果を参照しないことを確認する。
- 次に**W01・W04**、**W06**、**W11**、**W12**を段階移行する。
- 非アクティブ窓のボタン操作、クリックからドラッグへの移行、Win保持方向キー、タスクバー入力と通常W01の区別を重点検証する。
- 各検出器は成立・不成立・結果待ちを区別し、単独起動と全検出器同時起動で自身の判定が不要に変わらないことを確認する。

**完了条件：** 8操作の各判定に他検出器の内部状態・結果への依存がなく、共通観測から単独に評価できる。

### 5. ResultComposerと通信契約の更新

- 同じGesture ID・generation・対象の結果だけを統合し、1入力に対して原則1Envelopeを発行する。
- 入力源、最終確定、取消、期限、送信済み状態の共通チェックを行い、**個々の操作の採否を相互依存させない**。
- PR #169で単純統合と不一致になった3ケースは、新仕様どおり「証明されたW02だけ採用」として検証する。
- C#の独立Evidenceを表現する新しい通信variantを設計する。v2へ互換追加できるかを確認し、できない場合は明示的にprotocolを更新する。
- TypeScriptの厳格parser、Classifier、DurableCoach、SQLite原子保存と通知を同じ切替単位で変更する。
- [#177の確定契約](result-envelope.md)に従いW02＋W06・部分採用・3件以上も接続する。組合せallowlistを設けず、各Detectorの証明条件は維持する。#178は受信Expandのみ、#179はfixture経由で統合し、本番Detectorの切替は後続Issue。

**完了条件：** 結果の部分採用、0〜N件の全件記録、原子性、再配送、単一通知（3件以上の表示を含む）が仕様どおりに動く。通信変更の前後で意図しない二重計上がない。

### 6. TypeScriptの分類責務を整理

- `classifyGesture`などの既存公開入口を必要な期間維持する。
- Evidenceの種類ごとの純粋な判定へ整理する。C#にW IDを固定して判定責務を移さない。
- shortcut不明の場合の記録のみ、学習中の通知だけという既存の区別を維持する。

**完了条件：** 新しいEvidenceの全経路と互換経路が期待どおり分類・保存される。

### 7. 旧経路の撤去と全体受け入れ

- 使われなくなったTracker内の横断分岐、Observerの操作固有呼出し、暫定アダプターを削除する。
- すべての候補出口・生JSONL・世代とtransaction・保存/通知の回帰を実行する。
- Windows 11で代表アプリと独自caption、複数画面・DPI、背後窓ボタン、取消、Win+↓連続、W01/W12排他を実機確認する。
- 独立検出器を仮追加し、既存検出器を変更せず登録できることをテストする。

**完了条件：** 各操作を独立に保守でき、実機での重大な誤検出・記録漏れ・二重計上がない。

## 想定する配置（実装時に調整可）

```text
native-helper/
  Core/
    Observer.cs
    CandidateProtocol.cs
    ObserverHost.cs
    Detection/
      GestureManager.cs
      GestureContext.cs
      DetectionRouter.cs
      DetectionSession.cs
      DetectionContracts.cs
      ResultComposer.cs
      CandidateSink.cs
  Platform/
    WindowFacts.cs
  Detectors/
    WindowSwitchDetector.cs
    MonitorMoveDetector.cs
    MaximizeDetector.cs
    RestoreMinimizeDetector.cs
    HalfPlacementDetector.cs
    QuarterPlacementDetector.cs
    WindowCloseDetector.cs
    TaskbarDetector.cs
src/
  core/
    detector.ts
    detection/
```

**フォルダ名・ファイル数は目標ではない。** 名前や配置は変更可能。共通化のためだけの巨大な基底クラス、全操作を知るArbitrationPolicy、既存Policyの無意味なラップは作らない。

## 調停が本当に必要になった場合

まず該当検出器の入力源・対象・結果確定条件、GestureManagerの共通事実、Composerの確定barrierで解決できないかを調べる。

それでも解決できない**具体的な反例**が見つかった場合に限り、必要な操作の組合せ・優先順位・取消ルールを文書化し、最小限の調停処理を導入する。最初から万能なArbitrationPolicyを前提にしない。

## 中止・切戻しの条件

- 未確定の入力が記録される、取消後に再発行される、異なるジェスチャが誤統合される。
- 旧世代の候補が復活する、同じtransactionが二重保存される、原子保存・通知の意味が崩れる。
- 未許可の生入力・ウィンドウ情報が通信・保存される。
- 意図した仕様変更以外の回帰を、テストの期待値を緩めて隠す必要が生じる。

重大な問題が出た場合は、当該段階の移行を停止し旧経路へ切り戻す。新設計の妥当性を前提として機能を壊したまま進めない。

## 根拠資料

- [現行検出構成](current.md)
- [検証・回帰条件](verification.md)
- [独立検出の調査](independence/findings.md)
- [PR #169の実験結果](independence/composition-experiment-20261107.md)
- [本番のW02/W06/W07改善](independence/production-reposition-validation-20261107.md)
