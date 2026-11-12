# 独立結果Envelope契約（Issue #177）

**状態：採用する設計。製品コードは未変更。** 調査基準は `feba87e`。#178で受信形式をExpandし、#179でfixtureから分類・保存・通知を接続する。本番Detectorの切替は #180〜#184、旧経路撤去・実機受入は #186。現行実装の成功を新契約の実装済み証拠にはしない。

## 1. 決定事項と調査結果

成立した既存8操作をすべて採用する。組合せのallowlist・優先順位・2件上限を置かない。W02＋W06も、W02のみの部分採用も、3件以上も対象。各Detectorは自身の物理入力・入力源・対象・時系列・終端の証拠を保証し、他Detectorの成功・失敗を参照しない。同じ操作は1Gestureにつき1件。新しいW番号や代替キー候補は追加しない。

| 現行箇所                                                                      | 調査で確認した制約 / 後続の変更                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `native-helper/Core/CandidateProtocol.cs`                                     | `CompoundDragEvidence`はW02＋最大化/quarter、`CaptionClickEvidence`はswitch＋terminal専用。任意結果リストがない。新variantを追加する                                                                                                                      |
| `native-helper/Core/CandidateSink.cs`                                         | `Compound`/`CaptionClick`は専用形式、`Placement`はmonitorChangedを拒否。旧出口は維持し、新Composer用Submitを接続する                                                                                                                                      |
| `native-helper/Core/DetectionSession.cs`                                      | generation内でtransaction共有、欠番許容、停止/同世代再開始でも古いallocator lease失効。維持する                                                                                                                                                           |
| `src/main/observer.ts` `candidateV2`                                          | kindごとの構造検証。unknown fieldは全階層で厳格拒否されるとは限らず、正規化で落ちるものもある。新variantだけは以下の完全一致契約にする。行の上限16,384文字は維持                                                                                          |
| `src/shared/coach.ts` `Evidence` / `classifyGesture`                          | 型は専用compound variant。Coreはcompound全体棄却、placementはmonitorChangedを拒否。旧variantの分類は維持、新variantを独立分類する                                                                                                                         |
| `src/core/durable-coach.ts` `prepare` / `accept`                              | `prepare(count, reset, additional)`、`prepare(counts[0], undefined, counts[1])`が2件前提で3件目を渡せない。全件配列へ変更必須                                                                                                                             |
| `src/shared/storage.ts` `RecordMutation.counts` / `src/main/storage-store.ts` | countsの型は配列だが、StorageStore.commitはlength===2・mouse・W02＋W03/W07またはW01＋W03/W04のallowlistで制限。#179で任意件数・同日・同由来・対応8操作・操作重複なしの検証へ置換する。checkpointと原子保存ループを再利用。新DB列・Native IDの永続化は不要 |
| `src/shared/coach.ts` `ShortcutNotice` / `src/main/standard-notification.ts`  | itemsは配列、全行join。明示的2件制限はないが、3件以上の表示上限・残件数表現が未定義。下記で定義                                                                                                                                                           |

## 2. Native内部の完了barrier

Gestureの内部キーは `(session lease, generation, transaction, target identity)`。transactionをGesture IDとして使い、wireに別IDを増やさない。HWND/PID・再利用検出用identity・入力source・物理入力相関・単調時計・deadlineはNativeメモリ内だけに保持する。

1. Routerは開始時に当該Gestureの購読Detector集合を固定する。未登録の完了を受け付けず、途中追加でbarrierを閉じない。
2. 各Detectorは `pending | rejected | confirmed(proof)`。pendingは不成立ではない。各Detectorの既存期限でpendingをrejectedへ終端化し、無期限待ちにしない。共通Gesture自体の取消/期限切れは全件破棄する。
3. 受取時と最終発行直前にキー・対象process/reuse・generation/lease・入力有効性を照合。不一致結果を混ぜず、共通identityの破綻はGesture全体を取消。Stop/Resetはbarrierとworker leaseを失効させる。
4. 共通入力が終端確定し、全購読者がconfirmed/rejectedになってから一度だけ閉じる。未解放、Win保持中、MOVESIZE途中、各Detectorの成立に必要なforegroundが未確定なら送信しない（W12に新たなforeground結果要件を加えない）。操作固有の不成立だけならそのproofを除く。確定後の遅延完了・重複完了は無視し再発行しない。
5. 同じ操作を表すproofは正規化し重複排除。内部のsemantic keyは下記表の操作区分であり、wireのW IDではない。同一区分の同一proof再提出は1件、同一区分の矛盾したproof（方向/終端/由来等の相違）はその区分をrejectedとして残りを確定する。先着勝ちでキーを推測しない。
6. 0件ならSinkを呼ばない。1件以上なら同じtransactionの1Envelope。旧出口と新出口を同じGestureで同時発行しない。既存単一/compoundを新形式へ変換する場合も分割送信禁止。

Nativeのキー照合はwire parserでは再検証できない。下記のtrueはNativeが照合を済ませた証明であり、OSの事実を受信側が推測するための代用品ではない。別Gesture/対象の混入は本番Composerを用いる負例で必ず検出する。

## 3. 厳密wire契約

Protocol **v2への追加variant** `kind=independent-results`, `profile=independent-results-v1` を採用。既存Envelopeのフィールドは変えない。以下の型表と制約をJSON Schema同等の規範とする。すべてのobjectは**列挙したキーだけ、全キー必須、追加キー禁止**。optionalは使用せず、nullableだけ明記する。JSONの重複プロパティ名も拒否する（JSON.parse前の検査を含む）。enumの大小文字・文字列型は完全一致。非有限数・数値文字列・欠落・余分なnullは拒否する。

```typescript
// 型案。実装時は旧CandidateV2とdiscriminated unionにする。
type Id = number; // integer 1..2147483647
// Bounds: x/yは有限数、width/heightは有限かつ>0。キーはこの4個のみ。
type Bounds = { x: number; y: number; width: number; height: number };
type NewCandidate = {
  type: "candidate";
  protocolVersion: 2;
  generation: Id;
  sequence: Id;
  transaction: Id;
  date: string; // 実在するローカル暦日 YYYY-MM-DD、時計高水位規則を適用
  origin: "mouse" | "key";
  route: "independent-results";
  injected: false;
  conflicted: false;
  evidence: {
    kind: "independent-results";
    profile: "independent-results-v1";
    targetMatched: true;
    released: true;
    final: true;
    results: Proof[]; // 1件以上。maxItems=2等の製品件数制限なし
  };
};
type Proof =
  | {
      kind: "switch";
      route: "direct-click" | "alt-tab";
      windowsDifferent: true;
      eligible: true;
      foregroundMatched: true;
      inputAgeMs: number;
      settleMs: number;
      monitor: Bounds | null;
    }
  | {
      kind: "monitor-move";
      route: "caption-drag" | "win-shift-left" | "win-shift-right";
      moveConfirmed: true;
      layoutStable: true;
      inputAgeMs: number;
      fromMonitor: Bounds;
      toMonitor: Bounds;
      moveDirection: "left" | "right" | null;
      twoDisplayLayoutConfirmed: boolean;
    }
  | {
      kind: "state";
      route:
        | "max-button"
        | "min-button"
        | "caption-double-click"
        | "caption-top-drag"
        | "mouse-state-fallback"
        | "win-up"
        | "win-down";
      action: "maximize" | "restore" | "minimize";
      before: "normal" | "maximized";
      after: "normal" | "maximized" | "minimized";
      beforeArranged: boolean | null;
      afterArranged: boolean | null;
      inputAgeMs: number;
      monitor: Bounds | null;
    }
  | {
      kind: "placement";
      route: "caption-edge-drag" | "win-held-arrows";
      shape:
        | "left-half"
        | "right-half"
        | "left-top"
        | "right-top"
        | "left-bottom"
        | "right-bottom";
      placementConfirmed: true;
      layoutStable: true;
      inputAgeMs: number;
      monitor: Bounds;
    }
  | {
      kind: "close";
      route: "close-button" | "alt-f4";
      destroyed: true;
      inputAgeMs: number;
      monitor: Bounds | null;
    }
  | {
      kind: "taskbar";
      route: "taskbar-click" | "win-digit";
      slot: number;
      mappingConfirmed: true;
      snapshotAgeMs: number;
      confirmationAgeMs: number;
      monitor: Bounds | null;
    };
```

C#型案は `IndependentResultsEvidence(bool targetMatched, bool released, bool final, IReadOnlyList<IndependentProof> results) : Evidence("independent-results-v1")`。`IndependentProof`はkindによる上記6派生record（Switch/MonitorMove/State/Placement/Close/Taskbar）、route/action/shapeは対応enum、nullableは表の通り、Idはint、ageはlong、Boundsは既存MonitorBoundsを使用。C#のJSON discriminatorはcamelCaseのkind、enumも上記文字列に固定する。bool型でもfalseを出せば不正。W番号や任意のshortcut文字列はC#型に置かない。再帰Proofや旧compoundのネストは禁止。

### 意味制約と分類

構造・次の意味制約に1つでも違反したwireは**Envelope全体を拒否**。不正な1要素を黙って読み飛ばさない。Detectorがrejectedの結果を送らないことと、壊れたwireから部分救済することを混同しない。parserは型/範囲/route対応、Coreも採用条件を防御的に検証する。

ageは整数ms、下限0（生の入力時刻・時刻列ではない）。inputAgeMs上限はmonitor-move/state/closeが由来にかかわらず1000、stateのmouse-state-fallbackは500。switchはmouse 1500/key 15000、placementはmouse 1000/key 15000。switchのsettleMsは0以上inputAgeMs以下、mouseは1500以下、keyは250〜2000。taskbarはslotが整数1〜10、snapshotAgeMsは0〜750、confirmationAgeMsは0〜2500。期限は操作固有であり、このwire上限のためにNative期限を延長しない。

| proof / TS分類                       | 必須の因果・終端・キー規則                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| switch → W01                         | mouseはdirect-click、keyはalt-tab。入力対象一致・適格な別窓への確定切替。最小化前の一時前景は既存captionクリックの証明条件で扱う。タスクバーや閉じる結果のforegroundだけで作らない。案内Alt + Tab                                                                                                                                                                                                                                  |
| monitor-move → W02                   | mouseはcaption-drag、keyはwin-shift-left/right。異なるfrom/to Bounds、安定したレイアウトと実移動、既知開始・有効終端をDetectorが証明。最終normal/最大化/half/quarterを許容し、配置の成否は参照しない。元画面へ復帰は不成立。方向と幾何の同等性は現行W02式（同じy、非重複の左右、key route方向一致）で判定、成立ならWin + Shift + ←/→。方向不明でも完全な2画面構成を別途確認し非重複なら既存代表キー。確証不足はshortcut=nullで記録 |
| state maximize → W03                 | normal→maximized、mouseはmax-button/caption-double-click/caption-top-drag/mouse-state-fallback、keyはwin-up。mouseのbeforeArrangedは既知。caption-top-dragの同画面限定は新形式で外し、別画面移動の成否と独立に最終最大化を証明。Win + ↑                                                                                                                                                                                            |
| state restore/minimize → W04         | restoreはmaximized→normalかつafterArranged=false、mouseはmax-button/caption-double-click/mouse-state-fallback、keyはwin-down。minimizeはnormal/maximized→minimized、mouseはmin-button/mouse-state-fallback、keyはwin-down。最小化のkeyはbeforeArranged=false必須、mouseの案内条件は現行通りbeforeArranged=falseならWin + ↓、それ以外null。restoreはWin + ↓。派生の一時復元は禁止                                                   |
| placement half → W06 / quarter → W07 | mouseはcaption-edge-drag、keyはwin-held-arrows。最終形状と入力方向列をDetectorが照合、mouseは既知開始配置と異なる終端・OS docking/DPI等の条件を維持。monitorChanged=falseという旧variant限定条件は引き継がない。halfはWin + ←/→、quarterはWin保持の横→縦。中間halfはproofにしない                                                                                                                                                  |
| close → W11                          | mouse close-button/key alt-f4。対象同一性とDESTROY/消滅確認必須。HIDEや別対象destroyだけでは証明にならない。Alt + F4                                                                                                                                                                                                                                                                                                               |
| taskbar → W12                        | mouse taskbar-click/key win-digit。入力後UIA/slot照合、stale/不明/追加修飾/repeatは不可。slot10はWin + 0。それ以外Win + slot。不成立時にW01へfallbackしない                                                                                                                                                                                                                                                                        |

この表は組合せ制限ではない。W01/W12も各々が自身の入力源を証明できることが必要で、一律禁止の調停テーブルを作らない。同じ入力を2つのsourceだと推測して両方生成しない。

## 4. 順序・重複・再配送

- Nativeは区分順 `switch, monitor-move, state(maximize), state(restore/minimize), placement(half), placement(quarter), close, taskbar` で並べる。restore/minimizeは同一区分。TSはW01,W02,W03,W04,W06,W07,W11,W12順に正規化。これは表示・payload安定用で採否の優先順位ではない。
- wireの同一proof重複は許容しTSで同一operationを1件にする。異なるproofでも同じoperationで全フィールド一致なら同様。矛盾する同一operationのproofはwire全体拒否。片方を恣意的に採らない。順序違いも受信可能だが分類結果は常に正規順。
- generationはMain開始時の観測世代、transactionはDetectionSessionがGestureに1回割当、sequenceはSinkが送信確定順に発行。各Idは正整数int32、overflowで安全停止し巻き戻さない。取消のtransaction欠番と、非同期完了によるtransaction順の逆転は合法。
- Mainは現世代・sequence単調増加と既存4096transaction窓を維持。同sequence再配送は除外、新sequenceでも同transactionは除外。窓より古いtransactionは再採用せず、長時間pendingの結果も窓条件を緩めない。IDの再利用や同transactionの別payloadで訂正しない。Stop/再起動後は旧worker結果を送らない。
- Native IPCには候補の永続再送キュー/ACKを新設しない。保存のACK再送は別境界。同一EnvelopeをNativeから再送してカウントの回復を図らない。強制終了で未保存メモリ結果を復元する保証は追加しない。

## 5. 保存と通知（#179）

`classifyGesture`は0〜N個のObservationを返し、全件同じgeneration/transaction由来のid・date・originを持つ。0件では記録mutationも通知も作らない（既存のcoverage tickは独立）。8操作だけが対象なので重複排除後は現在最大8種類だが、2件等の製品上限でtruncateしない。

DurableCoachのprepareを全counts配列を受け取れる形に変更し、単件・2件・3件以上を同じ経路へ通す。RecordMutationはcountとcountsを同時使用せず、新経路はcountsのみ。全件＋coverage＋revision＋checkpointを**同じSQLite transaction**でcommit。i件目のINSERT/UPDATEやcheckpoint失敗で全件rollbackし、途中のUI件数・通知をpublishしない。StorageStore.commitの2件/組合せallowlistを除去し、counts全件の同日・同由来・対応操作・操作ID一意性を検証する。countとの同時指定は拒否する。DB schemaは変更不要。

Nativeのtransaction重複排除と、保存の`epoch/writeSession/sequence/payload hash`は別。保存エラー/ACK喪失は同一mutation（全件・順序・coverageを含む）を保持し、同session/sequence/payloadで再試行。COMMIT済みならcheckpointが二重加算を防ぐ。再試行時にNative idを新writer sequenceへ翻訳し直さない。pending中は停止、復旧だけで自動計測再開や旧通知の再発行をしない。payload不一致、旧session/epoch、sequence異常の拒否を維持する。

通知は保存成功後に最大1要求。適格条件は既存通り「マウス由来・学習中・確証済みキー・通知/計測継続・取消token有効」。記録件数と別に全操作を評価し、キー不明や習得済みでも記録を落とさない。

- 適格0件：通知なし。1件：既存のキーtitle/操作名body。
- 適格2件：既存の「ショートカットのヒント」title、2操作のlabel: shortcutを別行。
- 適格3件以上：正規順の**最初の2件を別行＋「ほかN件のショートカット」**（N=適格件数−2）。内部itemsには適格全件を保持し、表示上限を保存上限に流用しない。通知クリックは既存一覧を開く。個別履歴画面は追加しない。
- 複合全体をキー列が再現できるとは表現しない。OSによる行省略・集中モードとAPI要求成功を区別。unknown/failed・停止/学習変更・ACK再試行で再通知しない。Windowsでの3件以上の表示受入は #186で確認する。

## 6. 正常JSONと契約ベクトル

下記はW02＋W06の**合成証拠**。開始配置・最終配置・物理相関の妥当性はNativeのfixtureで別途検証する。

```json
{
  "type": "candidate",
  "protocolVersion": 2,
  "generation": 7,
  "sequence": 11,
  "transaction": 4,
  "date": "2026-11-12",
  "origin": "mouse",
  "route": "independent-results",
  "injected": false,
  "conflicted": false,
  "evidence": {
    "kind": "independent-results",
    "profile": "independent-results-v1",
    "targetMatched": true,
    "released": true,
    "final": true,
    "results": [
      {
        "kind": "monitor-move",
        "route": "caption-drag",
        "moveConfirmed": true,
        "layoutStable": true,
        "inputAgeMs": 200,
        "fromMonitor": { "x": 0, "y": 0, "width": 1920, "height": 1080 },
        "toMonitor": { "x": 1920, "y": 0, "width": 1920, "height": 1080 },
        "moveDirection": "right",
        "twoDisplayLayoutConfirmed": true
      },
      {
        "kind": "placement",
        "route": "caption-edge-drag",
        "shape": "left-half",
        "placementConfirmed": true,
        "layoutStable": true,
        "inputAgeMs": 200,
        "monitor": { "x": 1920, "y": 0, "width": 1920, "height": 1080 }
      }
    ]
  }
}
```

3件例は上記resultsの先頭へ以下を追加した同一Envelope。構造・下流の件数試験としてW01,W02,W06の3件と原子保存を期待する。これが実OSで自然に同時成立する証明ではなく、Detectorのsource/終端検証を省略する許可でもない。

```json
{
  "kind": "switch",
  "route": "direct-click",
  "windowsDifferent": true,
  "eligible": true,
  "foregroundMatched": true,
  "inputAgeMs": 200,
  "settleMs": 100,
  "monitor": { "x": 1920, "y": 0, "width": 1920, "height": 1080 }
}
```

以下のJSONは**上の正常EnvelopeへのRFC 6902形式の編集指示**。適用後のJSONが試験入力。/evidence/results/0はmonitor-move、/1はplacement。省略キーを勝手に補うfixtureにしない。

| 入力の編集/Native操作列                                                            | 期待値 / 担当Issue                                                                |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `[{"op":"remove","path":"/evidence/results/1"}]`                                   | 1件W02。W03 rejected/W07 rejectedでも同じ。#179                                   |
| 無編集                                                                             | W02,W06の2件、両方保存、通知1件。#178/#179                                        |
| 上記switch追加                                                                     | 3件、正規順、保存3件、適格全件なら2行＋ほか1件。#179                              |
| resultsに同一monitor-moveを追加                                                    | W02は1件。正規化順・重複でhashが揺れない。#179                                    |
| `[{"op":"replace","path":"/evidence/results","value":[]}]`                         | wireは不正。Native全rejectedならそもそも送信0件。#178/#179                        |
| `[{"op":"add","path":"/evidence/results/0/title","value":"forbidden"}]`            | unknown/禁止fieldで全拒否。#178                                                   |
| `[{"op":"add","path":"/evidence/results/0/generation","value":6}]`                 | 個別IDはwireに存在せず全拒否。#178                                                |
| `[{"op":"replace","path":"/evidence/final","value":false}]`                        | 途中状態、全拒否。#178                                                            |
| `[{"op":"replace","path":"/evidence/released","value":false}]`                     | 未解放、全拒否。#178                                                              |
| `[{"op":"replace","path":"/evidence/results/1/placementConfirmed","value":false}]` | 不成立proofをwireへ載せた不正、全拒否。正常な部分採用は当該要素を除いて送る。#178 |
| `[{"op":"replace","path":"/evidence/results/0/inputAgeMs","value":"200"}]`         | 型不正、全拒否。負数/小数/上限超も拒否。#178                                      |
| `[{"op":"remove","path":"/evidence/results/0/layoutStable"}]`                      | 必須欠落、全拒否。null置換も拒否。#178                                            |
| `[{"op":"replace","path":"/generation","value":6}]`                                | parse可能でもMainの現世代7と不一致で0件。#178/#179                                |
| transaction4を同sequence11/新sequence12で再配送                                    | いずれも追加記録/通知0件。#179                                                    |
| 同じW02区分でmoveDirectionだけleftのproofを追加                                    | 矛盾した重複、全拒否。#179                                                        |
| 別transaction/世代/対象/leaseの完了を混入、Stop後完了                              | Nativeで誤結合・復活なし、無効Gestureの送信0件。#179                              |
| W02 confirmed、配置pending→期限内confirmed                                         | pending中は0 Envelope、barrier後1 Envelope。#179                                  |
| W02 confirmed、配置pending→個別期限rejected                                        | 共通Gesture有効ならW02のみ1 Envelope。共通期限切れなら0。#179                     |
| 取消、未物理、入力source不明、共通対象不一致                                       | 他のconfirmedがあっても送信0件。#179                                              |
| 3件の2件目/3件目/最後/checkpointでDB故障                                           | counts/coverage/revision/checkpoint全rollback、通知0、同payload再試行。#179       |
| 3件commit後ACK喪失→再接続→retry                                                    | 全件各+1のみ、旧通知再発行0。#179                                                 |
| 3件でキー不明/習得済み/対象外を混在、保存中pause/stop/状態変更                     | 記録全件、発行直前の適格件数だけ1通知以下。#179                                   |

各6proofの合法route両由来、age境界（特にkey monitor-move/stateの1000は合法・1001は不正、15000を流用しない）、null/形状/slot不正、unknown kind/profile、top/evidence/proof/Boundsのunknown field・重複キー、末尾不正JSON、16,384文字超の行も #178で検証する。巨大resultsを分割/truncateして記録せず、行上限超は既存通信エラー処理で安全停止する。これは2件の製品制限ではなく資源防御。

## 7. 互換性・移行・プライバシー

v2の既存variantとEnvelopeの意味を維持するためv3は不要。ただし**古いstrict parserが新kindを受信可能という意味の後方互換性ではない**。Mainと同梱helperの対応を揃え、Expand中は新形式をfixtureのみから渡す。外部helperとの混在を自動許可しない。

- #178：C#/TSの新variant、全階層完全一致parser、重複JSONキー拒否、合法/違法wire fixture。旧単一・compoundと全baselineは無変更。送信切替や保存改修はしない。
- #179：barrier/重複排除、独立分類、全件prepare、SQLite故障列、通知全件評価/表示上限。既存8操作以外を登録しない。互換アダプター/合成fixtureで0/1/2/3以上を通す。本番の検出切替はしない。
- #180〜#184：Detector単位に新出口へ切替。Gesture所有を旧新両方に持たせず、同Gestureに旧Envelopeと新Envelopeを二重送信しない。旧variantは未移行経路専用で部分採用へ読み替えない。
- #185：分類責務の整理。#186：旧経路撤去、全回帰、本人同意の同一最終buildによるWindows受入。

#179の「0〜2件」「未採用W02＋W06」「3件以上の通知は対象外」は本契約と矛盾するため、**0〜N件、W02＋W06成立、3件以上の通知表示を実装範囲へ変更**する。親 #171の未決事項・W01/W12一律排他の表現も入力源の独立証明へ更新する。

通信は上記の固定カテゴリ、経過msの単一値、日付、限定monitor幾何、証明フラグのみ。生キー/文字・入力時刻列・活動履歴・HWND/PID・タイトル・URL・パス・clipboard・画面画像・カーソル軌跡・任意文字列の診断情報は禁止。内部identityはwireへ出さず、wire/経過値/幾何をDBや診断ログへ保存しない。DBへは既存の日付・操作ID・由来の集計と必要なcoverage/checkpointだけ。Nativeの**生JSONL**とparser後の両方で禁止fieldを検査する。

[固定回帰](verification.md)の現行期待値は旧経路のまま残す。意図差分はinvalid-max-release/invalid-quarter-release等のW02部分採用、unsupported-cross-halfのW02＋W06採用、3件以上。共通入力不正・途中half/W04・Win保持・取消・別対象・旧世代・キー不明の記録のみ等は維持。fixtureは型/保存/要求の証拠であり、自然入力精度・実OS通知表示・配布受入は未検証。
