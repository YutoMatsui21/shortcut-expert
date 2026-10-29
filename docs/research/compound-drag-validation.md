# 複合ドラッグの技術再審査（#14）

2026-10-28。正本は[現行要件](../ui-redesign-requirements.md)の複合ドラッグ契約。開始revisionは`26021f3ff7f74e9614bd85c869bfd07fb9548806`。製品機能#31/#37/#38/#113は実装しない。

## 再利用する証拠と不足

[#9の33完了試行](eight-operation-validation.md)の原本・失敗・当時の判断は保持する。旧排他的分類は現行仕様ではなく、観測事実だけを再利用する。

| ゲート | 再利用する実測 | 今回必要な追加証拠 |
| --- | --- | --- |
| G-W03 | S1-1 double click、S1-2 別画面上端drag・最大化・monitor変更・開始終了各1。初期max button/key実測 | 同一monitor上端drag、移動先でのWin+↑。複合dragの対象・終端対応を再評価 |
| G-W07 | S2-15〜18四隅mouse、S2-19/20/22とS3-3のWin保持quarter。上側mouse2隅はmonitor変更 | 移動先monitor内のquarterキー同等性。上側mouseのreleaseZoneはtop-centerで直接隅経路の証拠不足を残す |
| G-W02 | S1-3最大化起点の別画面中央dragと派生復元 | 現在の上下配置の方向付きWin+Shift+左右、途中跨ぎから戻す/取消、複合終端 |
| 共通負例 | S2-24自由resize、S2-25 Esc取消、S3-4 Snap Layout、Win保持の中間half | 画面跨ぎの戻し/取消、program変化と別対象。既存正常例は反復しない |

W12/W01/W04/W06/W11の既存の制約付き着手PASSを再利用し、最終製品受入とは区別する。初期状態はPASS 5／BLOCKED 3。未実測をPASSにしない。

## 実測方法と保存境界

本人から自作窓限定の実入力観測の明示同意を得た。UIA・自動キー送出は使用しない。本人は上下2画面のままと回答。設定・配置・registry・通常userDataを変更しない。

既存[研究probe](../../validation/probes/EightOperationProbe.cs)に研究用計測のみ追加。手動ケース選択・画面選択→Prepare→ARM→Target Aを前面→入力解放→6秒待機→手動操作→F8/FINISH。試行45秒、session20分上限。各ケース原則1回、異常時のみ原因を区別して再試行する。

保存対象は固定カテゴリ・集計・始終状態/shape、monitorのprimary/secondary役割、途中monitor遷移回数、drag開始/終了イベント時の状態、環境・source/exe hash。monitorの実識別子・座標は一時メモリのみ。生キー列・入力時刻列・窓名・URL・座標履歴・画像を保存しない。方向の集計は入力順序の証拠ではなく、複合キーの順次実行は本人の操作確認と別に照合する。

drag終了イベント時の状態とFINISH時の状態を分ける。遅着・競合・対象不一致・経路不明は因果成立へ読み替えない。`causalAttributionProven=false,productPass=false`は維持し、単発観測を全アプリ・因果一般・認識率の証明にしない。

監視なし自己検査30件成功。実測source SHA-256は`b0ba41fab039b5a3c278bee1effaf495935cd6d016b5a290fa18094e11fcef47`。追加レビュー規則の4観点を明示したローカル専用レビューは指摘なし（環境表示のrole追加はその後の静的確認）。製品suiteは変更せず、無関係な全件試験を追加しない。

## 結果と原本

新規16完了試行（正常予定15ケース、異常trial 6に対する独立再試行16を含む）。[原本](../../validation/evidence/compound-drag-20261028-session1.jsonl)・[本人確認](../../validation/evidence/compound-drag-20261028-session1-operator.jsonl)・[source bytes](../../validation/evidence/eight-operation-sources/b0ba41fab039b5a3c278bee1effaf495935cd6d016b5a290fa18094e11fcef47.cs.txt)。原本SHA-256は`ece0a836b18cca7ab7c32579369a39e2897fc166f824b3ca4aaaa5f2875615c9`、exe SHA-256は`255ad6c9b623d47c007af661c87a501fc7f165bcce85d454ed7e4aed64f68a96`。Windows `10.0.26340`、per-monitor DPI aware、主2880×1800/作業域2880×1704・副2560×1440/作業域2560×1392。本人確認により主=下側、副=上側。scale数値・絶対座標・相対offsetは採取していない。

| trial | 実測と評価 |
| --- | --- |
| 1/2 | 上側secondary-1で同一monitor上端直接drag／Win+↑。双方が通常→最大化、monitor変更0。dragは開始/終了各1、終了イベントでも最大化。キーはup1・Win解放1。競合/注入0 |
| 3/4 | 下側primaryからWin+Shift+←／→がともに上側secondary-1へ通常状態のまま移動。各方向1押下・monitor遷移1・競合/注入0。左右キーを物理的な左右monitor位置と同一視しない |
| 5 | 上側secondary-1からWin+Shift+←で下側primaryへ通常状態のまま移動。逆向きの←を確認。上→下の→は今回未試験 |
| 6 | 上側左上quarterへは到達したがroute=mixed、mouse1、repeat13、Win解放3、競合2、注入2。本人は操作誤りの可能性と再操作を申告。原本は1trialなので再操作を独立成功に分割しない。原因はunknown、正常キー同等性の根拠から除外 |
| 7/16 | 上側の右上／左上quarter。Win保持2方向・解放1、mouse/repeat/競合/注入0、同一monitor。中間half1→quarter1。trial 16は6の異常後の独立再試行で、初回原因の解明とは別 |
| 8/9 | 下側primaryから上側secondary-1の左上／右上quarterへ直接drag。開始/終了各1、monitor遷移1、caption-drag、終了イベントとFINISH時とも目的のquarter/arranged。外部click/競合/注入0。本人も直接隅dragと結果を確認 |
| 10 | 上側へ途中移動後、下側へ戻して解放。monitorTransitions=2だが始終primary、monitorChanged=false、通常、drag開始/終了各1。途中変化からW02を出さない根拠 |
| 11 | 上側へ途中移動後Esc取消。monitorTransitions=2、始終primary、escape1、通常。route=mixed/競合2は取消キーを通常経路外とする研究計測によるもの。正常移動へ採用しない |
| 12 | F6で研究コードがTarget Aを最大化。program-control、mouse/keyPresses/drag0だがmaximize1。同じ最大化結果だけではW03にできない |
| 13 | F6でOther Bを最大化（本人確認）。Target Aの最大化0・状態変化0、program-control。研究probeはBの形状を保存しないので、Bの結果そのものは本人確認と内部操作であり外部観測の一般化ではない |
| 14 | 下側通常からWin+Shift+←→全キー解放→Win+↑。上側最大化、shiftLeft1/up1/Win解放2、monitor遷移1、注入0、repeat0。本人が指定順序と結果を確認 |
| 15 | 下側通常からWin+Shift+←→全キー解放→Win保持←/↑。上側左上quarter、shiftLeft1/left1/up1/Win解放2、half1/quarter1、注入0、repeat1。本人が指定順序と結果を確認。repeatを独立押下に数えない |

trial 14/15のroute=mixed・競合集計1/2は、旧研究probeが異種キー経路の切替を混在として記録するため。これは通常の単一Win保持列の成功根拠には使わず、**本人確認した順次操作の最終monitor/状態を再現できた証拠**としてだけ採用する。入力順序を保存していないため、集計値だけから順序を復元したとは主張しない。監視中の全trialでhookFault=false、unhookFailures=0。最後にsession-endのtrials=16・hooksRemoved=true・unhookFailures=0と、対象研究exe残存0を確認した。

### releaseZoneの限界

trial 8/9は旧S2-15/16同様にreleaseZone=top-center。この分類は作業域の端から**16物理px以内**だけをleft/rightとする研究用の狭い固定区分であり、Windowsがquarterにする領域の境界を実証したものではない。top-centerだけから上端中央への意図・Snap Layout選択を推定しない。今回の直接経路の根拠は、本人による直接隅drag確認、同じTarget Aのcaption入力・単一MOVESIZE始終、外部click0、始終monitorと終端quarterの一致を合わせたもの。OSの正確なcorner hit領域、ポインタ解放時のmonitorと結果monitorの全条件での一致は未実証。製品で16pxを直接quarterの必須閾値としてコピーしない。経路・終端が結び付かない実入力はunknownとする。

### Session 1・trial 1：同一monitor上端直接drag

本人は上下構成の上側画面を使い、最大化とFINISHEDを確認した。[本人確認](../../validation/evidence/compound-drag-20261028-session1-operator.jsonl)。原本ではsecondary-1の通常窓→同じsecondary-1の最大化、caption-drag、releaseZone=top-center、moveStarts/Ends各1、maximizeTransitions=1、monitorTransitions=0。drag開始/終了時の対象状態とFINISH時の結果が整合する。競合/注入/外部click/hookFault/解除失敗は0、movingAtStop=false。上側画面のこの条件で不足していた同一monitor上端経路を取得した。この試行単独ではG-W03全体のキー同等性を証明せず、最終ゲートは他の証拠と合わせて下表で判定する。

## 8ゲートの再判定

**全8ゲートを制約付き着手PASSとする。無条件PASS・製品完全対応・リリースPASSは0。** #14は操作ごとの技術的成立性を確認するゲートであり、#31/#37/#38/#113や#47の完了を代行しない。

| ゲート | 判定と根拠 | 実装・受入に渡す条件 |
| --- | --- | --- |
| G-W12 | 既存の制約付き着手PASSを維持。#6/#28 | 安定主タスクバー1〜10番。secondary/overflow等はunknown、#96は初回依存外 |
| G-W01 | 既存の制約付き着手PASSを維持。#7/#29 | 直接click/Alt+TabとW12非重複。通常Edge等の未確認を保持 |
| G-W03 | **BLOCKED→制約付き着手PASS**。旧button/double-click、旧S1-2の別画面上端drag、今回1/2/14 | 自作標準窓・確認した入力/結果の基本経路。移動先最大化はWin+↑で案内可だが移動全体の単独代替とはしない。別monitor上端dragをW02+W03とする根拠は旧S1-2の観測事実＋新仕様。新規に同じ成功dragを反復していない |
| G-W04 | 既存の制約付き着手PASSを維持。#9 | 移動開始時の派生復元は独立計上しない。TITLEBARINFOEX等の制約保持 |
| G-W06 | 既存の制約付き着手PASSを維持。#9 | 同一monitorの左右half。Win保持中間halfはW07に含める。画面跨ぎhalf+W02は未検証 |
| G-W07 | **BLOCKED→制約付き着手PASS**。旧四隅mouse/key、今回7/8/9/16・順次操作15 | 上側quarterでもキーと同じ終端monitor/形状が成立。別monitorの直接dragはW02+W07。16px zoneをOS仕様と誤認しない。Win保持中の中間halfを独立W06にしない |
| G-W02 | **BLOCKED→制約付き着手PASS**。旧S1-3の通常終端移動/派生復元、今回3/4/5/8/9/10/11/14/15 | 安定した今回の上下2画面で下→上は←/→、上→下は←を実証。物理左右方向から推定しない。構成変化後は旧対応を無効化し、未確証構成/方向はunknown・記録のみ・完全対応PASSにしない |
| G-W11 | 既存の制約付き着手PASSを維持。#9 | 同一対象DESTROYと取消/hide/別対象の負例。一般アプリ等は未確認 |

W02+W03/W07は異なる操作IDとして各1件を意図する。途中monitor変化・戻し・取消はW02 0件、派生W04・中間W06は0件という判定条件を実装へ渡す。**研究probeは製品Candidate/件数を発行していない**ので、操作別二重確定0・原子保存・ACK再試行・1Toastを実測済みとはしない。#113の本番policy/厳格parse/保存/通知fixtureで検証する。

横並び/別の非整列/負座標/混在scale/着脱・構成変更の実入力、独自caption/一般アプリ、同時program競合、HWND再利用/世代・遅着、停止/重複callback等の製品境界は未確認。今回の上下構成の結果を任意構成へ一般化せず、必要な人工policy試験と#47の実機受入へ渡す。未確認を除外する設計条件は維持するが、初回の完全対応条件そのものを縮小しない。

各操作キーの同等性と、移動キー→最大化/quarterキーで複合操作全体を再現する同等性を別々に判定する。原子保存・操作別カウント・1Toastは#113、一般アプリ・最終build R02/J04は#47で別途確認する。

## 検証とレビュー

研究probeのコンパイル・監視なし自己検査30件、16原本trialの項目allowlist/固定monitorカテゴリ/連番/手動終了/解除失敗0、本人確認の参照先、原本と保全コピーのbyte一致、source SHA-256・exe SHA-256、文書リンクと`git diff --check`を確認した。原本JSONLとsource bytesは`.gitattributes`の`-text`で改行正規化を止めてhashを保持する。全製品テストはローカルで反復せず、PRの必須Windows CIを維持する。

本人の送信許可後、研究コード・原本・本人確認・審査文書・旧#9証拠・現行要件を対象に、追加レビュー規則の4観点を明示した専用ローカル全体レビューで指摘なし。製品完了との区別、zoneとmixed-routeの限界、trial 6/16の分離、hashとprivacyを確認した。レビュー側のprocess照会は権限不足だったため、残存0は親Agentの`Get-Process`照会、解除完了は原本session-end、パネル終了は本人確認という独立した根拠で記録する。
