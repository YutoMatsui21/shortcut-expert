# マウス検出条件のShadow検証結果（2026-11-07）

> 本書は本番条件改善前の調査・Shadow記録。W02の最大化維持移動とW06/W07の既知配置からの再配置は、後続の[本番改善検証](production-reposition-validation-20261107.md)と現行操作仕様を参照。過去のCurrent結果は当時のrevisionに対する証拠であり、現在のリンク済みprobeのCurrent出力とは区別する。その他の提案は採用を意味しない。

本番条件を置き換えず、隔離probe・人工入力・本人による物理マウス操作で比較した。[実行手順](shadow-live-guide.md)、[事前調査](technical-validation-20261107.md)。初期Draftで未完成だったライブアダプタと同一クリック列の3方式比較は実装済み。

## 比較の境界

- Currentは変更していない本番CandidateTracker/PlacementGeometryをリンクしたNative候補層の結果。製品Observer全体、TS採用、SQLite、通知を実アプリで検証した結果ではない。
- Shadowは同じ押下前snapshot、対象・process照合、物理解放、END snapshotを使う。W02の状態制限とW06/W07のarranged起点条件だけを研究対象とする。caption入力、解放位置、配置幾何、構成・対象・競合の保護を維持。
- 通常helperへのリンク・フックは追加しない。検証専用projectだけが研究用コードをリンクし、明示起動・ARM時だけhookを設置。Candidateの正式送信、SQLite、記録・学習・通知を呼ばない。
- W03はライブCurrentが確証した最大化だけをShadowへ渡す。synthetic再構成で失敗したCurrentを成功へ変えない。W02+W06が研究上成立しても製品契約へ追加しない。
- EのStandard/Fallbackは同じライブTracker候補をrouteで分ける。Doubleは同じ物理クリック列で計算し、判定snapshotと時刻を同時に固定。後から別状態のsnapshotと古い時刻を組み合わせない。

## 結果と採用判断

| 対象                    | 現行判定                                           | Shadow判定                                 | 改善効果                                               | 誤検出リスク                                                          | 採用判断             |
| ----------------------- | -------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------- | -------------------- |
| A 最大化A→最大化B       | 棄却                                               | W02のみ                                    | 3アプリの有効な実操作で漏れを回避                      | 独自resize・別原因の移動、混在DPI等は一般保証なし                     | 追加検証             |
| A 通常A→最大化B         | W02+W03                                            | W02+W03                                    | 既存複合を維持                                         | 旧複合全体棄却との境界は別途仕様判断                                  | 追加検証             |
| B 配置済み→最大化       | W03                                                | W03                                        | 既存の許容条件を確認、緩和不要                         | イベント欠落・遅着の一般化は未確認                                    | 採用推奨（現行維持） |
| C 右half→左half         | 配置済み起点を棄却                                 | W06                                        | 3アプリの有効実操作で改善                              | 未知配置は推測せず棄却、解放strip外は見逃し得る                       | 追加検証             |
| D 左上→右上             | 配置済み起点を棄却                                 | W07                                        | 3アプリで改善、Snap Assist後のforegroundとの区別も確認 | 四隅の完全な公開hit領域を取得したわけではない                         | 追加検証             |
| E 2クリックへの全面置換 | 標準またはfallbackで最大化・復元・単クリック最小化 | Doubleは最大化・復元、single最小化は不成立 | 一部のsingle-click相関を除外                           | 本文double-click＋別原因の状態変更は識別不能。独自single-buttonを失う | 不採用               |

「追加検証」は今回の実装未完成を意味しない。製品条件の採用には、未知hitの独自resize、混在DPI、画面構成変更、終端遅着、アプリが入力と無関係に状態変更する負例などが残る。今回の少数の有効試行から検出率・誤検出率を推定しない。

## 具体的な条件差

A：単独W02のnormal/non-arranged終端制限をShadowでは要求しない。最大化→最大化でW03を足さず、monitor差だけをW02へ反映する。未知の開始配置はW06/W07の証明に使わないが、確証済みW02まで消さない。最大化・通常以外の無効状態、対象/構成/解放先不一致は維持して棄却。

B：arranged=trueを許容する現行W03を維持。非最大化→最大化、上端入力、対象・物理解放・終端の対応を緩和しない。

C/D：開始arranged=falseの一律条件を、既知の開始配置と終端配置の差へ置換。通常非配置起点は既知の非配置として扱い、未知shapeを「異なる」と推測しない。caption入力、HasCaption、DWM frame/作業域の1px照合、release stripとquarterの上下側、同一monitorのwork/DPI整合は維持。同monitor同配置への戻しは0。

E：同root/process、物理down/up×2、OSのdouble-click時間・距離、競合/注入/dragなし、2回目直前状態と500ms以内の結果を比較。最初のクリックで状態が変わった列をdouble-clickへ結合しない。最小化single-clickは既存方式を残す。標準部位を取得できたかと、アプリが独自タイトルバーかは同義ではない。

## 人工入力と回帰

- 本番C# policy＋TS契約試験：1,217 assertion成功。従来1,166に研究ケース51を追加。
- 既存unit全体：366件成功。
- ライブprobe build試験：成功。観測を開始せず隔離projectだけをbuildする。
- 型検査とCSharpier全体check：成功。
- キャンセル、注入、競合、未解放、入力期限、対象変更/消滅、構成変更、resize、未知配置、中間状態、同配置戻しを人工列で確認。
- Eは同一列で標準/fallback/Doubleを比較。foreground離脱、解放後の無効化、長押し、移動距離、対象変更も負例にした。
- 本文double-click＋別原因最大化は、fallbackとDoubleの双方が肯定する反例を残した。原因を表す都合のよいフラグで除外しない。

## 実機の観測方法と除外

本人がChrome・Dia・Obsidianを物理操作。自動入力は使用していない。app/scenarioは固定選択肢の手動ラベルであり、実行ファイル名を保存して同定したものではない。Windows APIからshow/arranged/frame/work/monitorを読み、一時的に対象・入力を照合した。OSの観測値は10.0.26340.0。観測できたFileVersionはChrome 156.0.8078.81、Dia 157.0.8103.39。未取得のアプリ版は推測しない。

タブを掴めなかった等の余分な操作について本人から申告があった。API/状態/物理解放/ENDが揃わないもの、ケース名と始終状態が違うものは成功率の母数に混ぜず、元の固定カテゴリ結果に残す。追加の成功試行だけを選んで失敗率を隠す扱いにはしない。

最初のprobeはENDの150ms後にCurrentを評価したため、quarter後のSnap Assistによるforeground移動を対象不一致と誤って扱った。本人のSnap Assist申告と、修正版のEND時foreground=true／後続foreground=falseで原因を確認。修正版では本番と同じEND callbackでCurrentを確定し、そのsnapshotをShadowにも使った。保護条件の緩和ではない。初期quarter2試行は検出条件の評価へ使わない。

実機の定量表とbuild別の固定カテゴリ証拠は、本書の追記および[証拠ディレクトリ](../../../../validation/evidence/mouse-shadow-20261107/)を参照。

## 限界

全アプリ・全Windows設定の安全性、因果の完全識別、製品への保存・通知、W01/W04/W11/W12の実機全面受入は今回の証拠ではない。製品コードは変えておらず、それらの人工回帰は既存suiteで維持した。新アーキテクチャ、Gesture管理、Aggregatorは変更していない。

## 実機の定量記録

以下は期待結果を得た試行数で、検出率ではない。全試行はbuild別JSONLに残し、操作不成立・ラベル違い・初期probeの欠陥を成功へ読み替えない。

| 操作            | Chrome | Dia | Obsidian | Current → Shadow  |
| --------------- | ------ | --- | -------- | ----------------- |
| 最大化A→最大化B | 3      | 2   | 2        | 0 → W02           |
| 通常A→最大化B   | 1      | 2   | 2        | W02+W03 → W02+W03 |
| half→最大化     | 2      | 2   | 2        | W03 → W03         |
| quarter→最大化  | 1      | 1   | 1        | W03 → W03         |
| 右half→左half   | 2      | 2   | 2        | 0 → W06           |
| 左上→右上       | 2      | 2   | 2        | 0 → W07           |

- 最終Chrome normal-maxはAPI上monitorChanged=false、Current/ShadowともW03。画面移動の成功には数えず、同画面ではW02を足さない負例として残した。
- Chromeのsame-placementはログ上app=obsidianだが、本人がChrome操作・ラベル変更忘れと確認。final-checksのindex5も本人確認によりObsidian操作・app=diaのままと注記した。原ログは変更せずmanifestに訂正根拠を記録。
- 同配置戻し、通常resize、Esc取消はCurrent/Shadowとも0。本文single/double-clickは3アプリとも無変化・3方式とも0。
- API不可の1行はDia normal-maxの操作前manual-stopでbefore/afterともunknown。成立性確認に含めない。ほかの初期68行中67行はapiAvailable=true。全68行でhooksRemoved=true。
- 初期quarter2行は比較時点のprobe欠陥。操作不成立・未確証として残す主な行は、drag-preliminary index2、drag-end-snapshot index3/4/6/7/10/11/15/23、clicks-and-negatives index11/20/21/24。いずれも成功件数に加えない。

| Eの実クリック                         | Chrome                                           | Dia                             | Obsidian                        |
| ------------------------------------- | ------------------------------------------------ | ------------------------------- | ------------------------------- |
| タイトルバーdouble-click最大化/復元   | StandardでW03/W04、Doubleも成立                  | FallbackでW03/W04、Doubleも成立 | StandardでW03/W04、Doubleも成立 |
| single-click最小化                    | W04観測あり。ただし最終再試行はCurrent 0（後述） | Fallback W04、Double 0          | Fallback W04、Double 0          |
| 本文single/double-click・状態変化なし | すべて0                                          | すべて0                         | すべて0                         |

Chromeの最小化はclicks-and-negatives index3でnormal→minimized・Standard W04を観測したが、scenarioはrestoreのままだったため正式なsingle-minimize正例に読み替えない。final-checks index3は正しいscenarioでnormal→minimized・物理解放・同process・API取得を確認したが、Current 0だった。原ログに押下時foreground/route/入力期限の内訳がないため、原因は断定しない。Native入力照合または候補確定/投影の境界に未解決点があるものとして残し、製品全体の欠陥や2クリック案の優位性とは扱わない。診断用に固定カテゴリのclickDiagnosticを追加し、前面/背後の2条件を追加確認する。

実機で製品の途中W04/W06計上数を測定したものではない。Shadowは終端のみを評価し、途中状態の不採用と現行Trackerの所有中抑制は人工列・静的照合の証拠である。

## Chrome最小化の追加診断

本人指定に従いclick-target-diagnostic index3/4だけを評価し、index1/2は操作ノイズとして残す。評価した2試行は次のとおり。

| 条件                         | 押下時foreground | route      | 対象一致 | 入力期限  | Current      | Double |
| ---------------------------- | ---------------- | ---------- | -------- | --------- | ------------ | ------ |
| 前面Chromeのsingle最小化     | true             | min-button | true     | 500ms以内 | Standard W04 | 0      |
| 背後Chromeの直接single最小化 | false            | min-button | false    | 500ms以内 | 0            | 0      |

ともに物理解放・normal→minimized・API取得・同process、非注入・非競合を確認。背後条件の0は通常Trackerの押下時foreground照合に由来する。製品には別途InactiveCaptionPolicyがあるため、この0を製品の最小化不具合と扱わない。製品全経路を含めない比較境界を実機でも確認した。

原試行final-checks index3には押下時foregroundが残っていないため、同じ原因だったとは断定しない。追加の成功を使って過去の未確定な見逃しをノイズへ変更しない。単クリック最小化を2クリック方式へ置換すると、前面窓でも拾えなくなることは確認できた。

全72行のtrialでhooksRemoved=true。apiAvailable=falseは操作前manual-stopの1行のみ。人工試験と物理試験は別の証拠であり、この件数は検出精度の統計ではない。

## 最終確認

コードのローカルレビュー・必要な再レビューを実施。終端時点の一致、解放後競合、foreground、時刻とsnapshotの対応、既存caption gate、固定カテゴリ診断のプライバシーを確認した。文書・固定カテゴリ証拠だけの最終追記は原ログとの整合とリンクを確認し、専用コード再レビューは省略する。CIはPRの最新headで別途確認する。
