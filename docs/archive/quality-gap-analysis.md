> **履歴資料／現行仕様ではありません。** 当時の調査や合意です。現在の[確定要件](../ui-requirements.md)・[設計](../design.md)・[開発・検証ガイド](../development.md)を優先してください。

# 現行リポジトリの品質保証・テスト・CIの不足

調査日：2026-10-12。対象：調査開始時の`2a83b76d2fe30cc979dff0f017d9c5e0b98977ea`と作業ツリー。開始時に未コミット変更なし。一般原則と一次資料は[品質保証のベストプラクティス調査](quality-best-practices.md)、要件の正本は[MVP要件](mvp-requirements.md)、責務配置の正本は[現行アーキテクチャ](../design.md#architecture)。本書は調査・提案であり、新しい公開条件や実装方針の承認を意味しない。

後続の依頼で自動試験・回帰修正・CI定義を追加した。以下は調査時点の記録であり、最新の層・責務・確認範囲は[テスト設計](../design.md#test-design)、実行方法は[開発・検証ガイド](../development.md)を参照する。

## 1. 結論

このリポジトリには、単なる正常系を超えた良いテストが既にある。特に通知期限、頻度の境界、保存中の停止、世代・sequenceによる重複排除、破損文書の拒否と原本保持は強みである。

不足の中心は、**それらを毎回自動で実行するCI、本番C#入力判定のテスト、境界通信の異常系、失敗後に別操作を挟む状態遷移、実際のUI操作、配布物と実入力の受入証拠**である。テスト件数を増やすだけでは埋まらない。

実際に既存60件が全て成功した状態でも、設定保存失敗後の再試行が最新の設定を古い値に戻すケースを隔離データで再現した。まず、この種の具体的な不具合を回帰ケースにし、既存検証をCIに載せ、本番の判定境界をテスト可能にする順序が妥当である。

| 優先 | 不足 | 主な影響 | 最初の対応 |
| --- | --- | --- | --- |
| P0・次の開発前 | CIと必須チェックの運用 | ローカルで通る変更しか確認できず、実行漏れを防げない | PR・mainに型検査、純粋テスト、helper/Electronビルドを設定する |
| P0・次の修正 | 設定保存失敗後の複合遷移 | 再試行で古い通知設定が復活する、実再現あり | 失敗→別の設定変更→再試行の回帰テストと修正 |
| P0・検出機能の拡張前 | 本番Observerの入力・状態ロジック試験 | マウス／キー由来の誤分類、取りこぼし、重複 | 本番の候補生成を人工イベント列で検証できる小さな境界を設ける |
| P1・公開前 | helper通信・終了・再開の異常系 | 停止解除失敗、待ち続けるUI、旧世代の通知・記録 | 応答遅延、異常終了、壊れたJSON、古い応答の契約試験 |
| P1・公開前 | 通知とUI制御の自動回帰 | 設定・削除・停止・日付選択の故障がsmokeを通過 | 利用者操作による少数のUI試験、通知の遅延応答試験 |
| P1・公開前 | 配布物・導入・再導入・終了の試験 | 開発版だけ起動し、配布物ではhelper不足やデータ消失 | 新規buildから同梱smoke、隔離VMでNSISライフサイクル |
| P1・公開前 | 実入力と対応条件を結ぶ受入表 | 人工試験成功を認識精度と取り違える | 既存のmouse/key/負例/60分基準を成果物に結び付ける |
| P1・公開前 | Electron・プライバシー境界の回帰 | IPC権限の広がり、試験データ混入、生データ保存 | 不正sender／payload拒否と許可された保存内容の検証 |
| P2・段階導入 | coverage、mutation、依存更新、静的解析 | 見逃している分岐や依存リスクが見えにくい | 対象を明示したcoverage、重要条件だけmutation、更新後に再検証 |
| P2・段階導入 | 性能・耐久・アクセシビリティ・診断 | 入力への影響や長時間の劣化、操作しづらさ、原因不明 | 隔離負荷試験、キーボード操作、内容を含まない診断設計 |

P0は全機能を停止させる緊急度の意味ではなく、次の開発で先に整備する項目。P1は既存の公開条件を満たすための検証基盤を含む。P2は実測・工数に応じて段階導入する。

## 2. 今回確認した事実と限界

### 実行結果

| 確認 | 今回の結果 | 言える範囲 |
| --- | --- | --- |
| `npm.cmd test` | helper publish成功、60件成功・失敗0・skip0。サブテストを含む | 現行の自動ケースの成功。実入力認識率ではない |
| `npm.cmd run typecheck` | 成功 | 現行tsconfigの型検査 |
| `npm.cmd run build` | helper・型検査・main/preload/rendererビルド成功 | 開発環境でのビルド成立 |
| `npm.cmd run smoke` | 制限環境では出力なしで失敗。GUI起動許可を得た再実行で成功 | 人工mouse1/key1、重複・unknown除外、React反映、focus不変、通知消去、hook停止。`realDisplayContext=false` |
| 純TSテストのcoverage | 56件成功。読み込まれた対象のline 91.55%、branch 95.15%、function 91.23% | C#・Renderer・Electron制御・observer・notificationを含む製品全体の率ではない |
| 設定の複合遷移の追加probe | 古い設定の復活を再現 | インメモリーrepositoryによる失敗注入。実入力・通常の保存データは不使用 |
| GitHub Actions一覧 | `total_count=0` | GitHub APIで確認した登録workflow数 |
| ローカルCI定義 | `.github`なし。Git追跡ファイルに別CI定義も見当たらない | この作業ツリーで確認した範囲 |
| リポジトリ情報・rulesets | `main`、private。rulesets照会はプラン要件で403 | rulesets・必須チェックの適用状況は確認できていない。不存在とは断定しない |

Node.jsは24.11.1、npmは10.9.2、ローカル.NET SDKは10.0.401。SDKは[global.json](../../global.json)と整合。過去のdesign.mdにある成功記録を今回の成功として転記していない。

同梱版・開発server版のsmoke、インストーラー、実画面の全画面判定、実入力認識率、通常作業60分、アクセシビリティ、性能、依存の脆弱性監査は今回実行していない。実入力の観測を伴う試験は、実施時に明示的な同意が必要である。

### 見つかった既存の良い設計

| 仕組み | 根拠 | 評価 |
| --- | --- | --- |
| Coreへの時計・保存・通知の注入 | [Coach](../../src/core/coach.ts)、[coach.test.ts](../../tests/coach.test.ts) | 時間境界と失敗を決定的に再現できる。維持すべき |
| 期限1999/2000/2001ms、頻度10秒/60秒の境界 | [coach.test.ts](../../tests/coach.test.ts) | 実装の条件式が変わった時に有効 |
| 世代・sequence・除外候補の消費 | [Coach](../../src/core/coach.ts)、関連テスト | 重複と停止後の候補を排除する基盤 |
| 保存文書の厳格な検証と原本保持 | [repository.ts](../../src/main/repository.ts)、[repository.test.ts](../../tests/repository.test.ts) | 27サブケースを含む異常文書試験。集計の黙った初期化を防ぐ |
| 書込み直列化・一時ファイル・sync・rename | [repository.ts](../../src/main/repository.ts) | 通常の途中書込みに備える。電源断までの保証は別検証 |
| SerialQueueの失敗後の継続を試験 | [serial-queue.test.ts](../../tests/serial-queue.test.ts) | Promise失敗で後続が詰まる回帰を検出する |
| 隔離データ・入力payloadを読まないfixture | [main/index.ts](../../src/main/index.ts)、[Observer](../../native-helper/Observer.cs) | 既存データと実入力を使わず接続試験できる |
| Electron sandbox・contextIsolation・Node無効・狭いpreload | [coach-app.ts](../../src/main/coach-app.ts)、[notification.ts](../../src/main/notification.ts)、[preload](../../src/preload/index.ts) | 基本防御は実装済み。欠けているのは主に回帰検証 |
| 人工入力・技術probe・実入力の区別 | [開発・検証ガイド](../development.md)、[research](../research/overview.md#measurements) | 製品の認識精度を過大に説明しない良い方針 |
| lockfile、依存版、SDKの指定、publish後のhelper置換 | [package.json](../../package.json)、[build-helper](../../scripts/build-helper.mjs) | 再現性の基盤がある。クリーンCIと配布物の照合が次の課題 |

## 3. 再現できた不具合：設定の再試行が最新操作を取り消す

対象：[Coach.setMuted / retrySave](../../src/core/coach.ts)。`setMuted`の保存失敗で`pendingSettings`を保持する一方、後の`setMuted`成功では、その古い保留値を解消しない。

| 手順 | 保存結果・状態 |
| --- | --- |
| 1. W03をmuteする設定保存を意図的に失敗させる | 保存済みは通知ON、保留は通知OFF。観測停止・pendingSaveあり |
| 2. 保存先を復旧し、もう一度W03をmuteして正常保存する | 通知OFFを保存。ただし古い保留が残る |
| 3. W03のmute解除を正常保存する | 最新の正常保存は通知ON。それでも古い通知OFFの保留が残る |
| 4. 「保存を再試行」に相当する`retrySave()`を呼ぶ | 古い保留が保存され、通知OFFに戻る |

今回の人工repositoryで、手順3後の`settings.muted=[]`、手順4後の`settings.muted=['W03']`をassertして再現した。[UI](../../src/renderer/src/CoachApp.tsx)もmute操作を`pendingSave`だけでは無効化していないため、この操作列を排除している設計ではない。ただし、実UIでディスク障害を起こす試験は未実施。

必要なのは、保留設定と最新の利用者操作の関係を決め、それを試験すること。例として「後の成功を最新値とし、古い保留を消す」か「保留中の変更を保留へ統合して最新意図を保存する」などがある。今回は不具合修正や挙動変更をしていない。

回帰ケースは、保存1回失敗→再試行成功だけでなく、失敗→別の操作→再試行、再度失敗→終了取消→復旧まで含める。テストは期待する最新値をassertし、現行の誤動作を期待値に固定しない。

## 4. 本番のC#候補生成が自動テストの外にある

[native.test.ts](../../tests/native.test.ts)は、DisplayPolicyの7例、hook登録・解除、stdin終了、start/stop/再開/shutdownを検証する。一方、`Observer.OnMouse / OnKey / OnEvent`はfixture中に処理を早期終了する。[smoke](../../src/main/smoke.ts)も完成済みCandidateをhelperに渡している。従って、**OS入力からそのCandidateを作る本番ロジックは、これらの成功では検証されない**。

[validation/probes/OriginCandidateTests.cs](../../validation/probes/OriginCandidateTests.cs)は過去のprobe用ロジックの試験で、製品Observerを直接試験しておらず、`npm test`にも入っていない。単にこのprobe試験をCIへ足しても、本番の穴は埋まらない。

提案は、Win32の読み取り・hook登録はNative helperへ残し、読み取った最小イベントと状態から候補を作る部分だけ、同じ本番コードを人工イベント列で試験できるようにすること。TypeScript側の採用・同等キー判定をC#へ移さず、現行Moduleの責務を守る。巨大な全Win32 APIモックや独立した「テスト専用判定器」は不要。

最初のケース：

| イベント・条件 | 期待する性質 |
| --- | --- |
| 標準max button→同一窓の通常→最大化 | mouse候補を一度だけ出す |
| captionの2click、時間・距離の内外 | 成立時だけdouble-click経路。設定されたWindows条件も確認 |
| Win+↑、左右Win、不要なmodifier、キーrepeat | 成立経路以外をkeyと断定せず、重複しない |
| injected／lower integrity injected、mouseとkeyの競合 | 誤通知・誤計上につながる確定候補を作らない |
| 999/1000/1001ms、配送遅延、イベント重複、順序違い | 入力寿命と実際の状態遷移の契約を守る |
| 対象窓の破棄、foreground移動、API失敗、arranged不明 | unknownまたは見送り。古い対象へ関連付けない |
| program最大化、無関係なclickの近接 | 時間的近さだけでユーザー由来を保証しない |
| move-size開始・終了、途中復元、停止・再開 | 派生変化と旧入力を次世代に持ち越さない |
| 起動時／起動後に作られた対象窓、HWND再利用 | 別窓・別プロセスの古い状態を流用しない |

入力hookの処理時間には別のリスクがある。OnMouse内でplacement、token、hit test等を同期照会し、OnEventでは同じmessage loopからstdoutへ候補を出している。遅い読取側や対象プロセスの状態で、入力処理がどれほど遅れるかは未測定。Microsoftはlow-level hookのタイムアウト時に無通知で解除され得ることを明記している。`Active`は保存したhookハンドルから計算しており、実際の配送が継続している証拠ではない。hookにI/Oや高価な処理をどこまで置くかを計測し、配送欠落時の扱いと限界を設計する。ただし「heartbeatだけでhookの健全性を保証できる」とはしない。[Microsoft mouse hook](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelmouseproc)、[keyboard hook](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc)

## 5. 通信・停止・復旧の契約試験が足りない

[ObserverClient](../../src/main/observer.ts)には候補の型検証、requestId、応答timeout、世代、fault時の停止がある。これらの正常・異常分岐を直接確認するテストはない。現行native.testは実helperへ直接通信するため、TypeScript側ObserverClientの異常処理を通さない。

テストしやすくする境界は、子プロセスの起動・入出力・終了と時計でよい。候補parserはElectronをimportするファイルに同居しているため、必要なら通信の純粋検証部分をMain内の小さなモジュールへ分ける。SharedをElectronやNode依存にしない。

最低限の試験は以下を含む。

- readyが来ない、protocol版不一致、arranged APIなし、spawn失敗。一定時間で失敗し、観測中と表示しない。
- started/stoppedの誤type、異なるrequestId、重複応答、期限後の応答。古いPromiseや別の要求を成功扱いしない。
- malformed JSON、候補の必須項目欠落、NaN/Infinity相当、巨大な数値、負・0のsequence、無効な画面。受理可否と停止／見送りの方針を明文化する。
- 大きい行、改行が来ないchunk、JSON Linesの分割／結合。現在の行長チェックは完全な行を読み取った後なので、受信中の上限まで保証しているとは言えない。
- request待ちの間のEOF、stdin書込失敗、プロセス異常終了。未完了要求を解決し、UIへ停止を伝える。
- stop応答timeout・解除失敗・shutdownのack後に終了しないhelper。観測を継続せず、終了を確認またはkillし、失敗を表示する。
- 再開直後に旧helperのcandidate・exit・faultが到着。新世代の記録やプロセスを壊さない。

最後のケースは特に重要である。exit handlerは子プロセスが現在のものか確認して`this.child`を消すが、続く`failed()`呼出しは同じ条件で保護されていない。旧プロセスのexitと新しいstartが競合する列を試験すべきである。これはコードから見つけたリスクで、今回再現済みの不具合とは区別する。

親EOFでhelperが終了する良い試験は既にある。しかし、通常アプリの終了、未保存時の終了取消、Mainの二重quit、helper異常後の手動復帰まで保証するものではない。[coach-app](../../src/main/coach-app.ts)も含むライフサイクル試験が必要。

## 6. 状態遷移・保存・日付の不足

Coachには個々の境界試験が充実しているが、設定保存失敗、delete失敗、opened保存失敗を組み合わせた試験は薄い。coverageでも未実行の設定復旧分岐とopenedが見えた。

| 追加する列 | 確認点 |
| --- | --- |
| 設定失敗→別の設定変更→retry | 最新意図、保留・error・観測状態の整合。3章の不具合 |
| counts失敗とsettings失敗が同時に残る→片方だけ復旧 | 成功した片方で他方のエラーを消さない、再開不可を正しく表示 |
| 保存中→全削除取消／確定→旧候補到着 | 取消時は保持、確定後に古いデータが復活しない、設定は保持 |
| delete書込み失敗→再試行／再開 | 消去できていない記録を削除済みと表示せず、失敗時停止を維持 |
| 初回opened保存失敗→再開→再起動 | 初回画面flagとエラーが実際の保存結果に一致 |
| 稼働→通知停止→全停止→再開 | 停止前の通知設定を保持、旧世代を数えない |
| 全停止中に通知停止／復帰を操作→再開 | design.mdの「全停止中は通知停止flagを変更しない」と整合 |
| 23:59完了→00:00配送、月末・年末・閏日、TZ変更 | helperの操作日付へ一度計上、30暦日保持 |
| 未来日記録あり→tick→日付復帰／全削除 | 記録を黙って消さず、明示した復帰経路で再開 |
| count最大安全整数からの加算 | 不正整数を正常保存と扱わず、error・pending状態を説明できる |

全停止中の通知flagは、現在のMain commandが常に`pauseNotifications`を呼び、Renderer／trayも停止中に操作を禁止していない。現行設計との不整合が静的に見えるため、期待動作の試験を先に書く価値がある。今回はUIでの操作再現をしていない。

保存側は、tmpを開けない失敗と後続再試行を既に試験している。追加はwrite途中、sync、close、rename、読込権限エラー、未完tmpが残った再起動のように段階を分ける。試験対象は隔離したdirectoryに限定する。通常終了の保存完了と、crash／電源断での保証は分けて記述し、ファイルrenameの成功だけで電源断耐性を主張しない。

property/model-based testingは、この状態列と「停止中は新規観測を数えない」「同一候補は高々1回」「削除後に旧世代が復活しない」「設定は最新の意図」という不変条件に向いている。最初は手書きの回帰列で十分。fast-check等の導入は列が増えてからでよく、検出器自身を正解モデルに使わない。[fast-check model-based](https://fast-check.dev/docs/advanced/model-based-testing/)

## 7. UIと通知は、表示成功以外の経路が未自動化

現行smokeはReactのmouse1/key1と通知の文字をDOMから確認するが、pause/start/mute/delete/day選択のボタン・select操作は行わない。fixtureではtray・通常起動の初回画面経路も通らない。過去の手動検証記録はあり、未実装とは言えないが、継続的な回帰検出にはなっていない。

提案するUIの最小ケースは、日付選択と合計、通知停止でも記録継続、全停止と再開、muteと再起動後の保持、削除取消／確定と設定保持、保存エラーと再試行、窓を閉じても常駐、trayから再表示、二重起動、正常終了である。Rendererの細かい状態はbridge fixtureで試験し、Main/Preloadを含む少数のElectron E2Eで結線を確認する。PlaywrightのElectron支援はexperimentalなので、現行Electron版・sandboxと組み合わせて小さく互換性を確かめる。[Playwright Electron](https://playwright.dev/docs/api/class-electron)

[NotificationWindow](../../src/main/notification.ts)では、表示前と後の再照会、期限、epoch、画面消失、poll、focus、click-through、4秒消去を分けて確認する。人工画面adapterと遅延応答を使い、次の条件を再現する。

- 全画面・不明・照会失敗・画面不一致なら集計は保持し、通知だけ抑制。
- 読込中の停止／mute、表示直前の全画面化、表示中の全画面化。
- 古い通知のpollが遅れて戻り、新しい通知を消さない。
- 負座標、縦画面、100/125/150/200%と混在DPI、狭いworkAreaで対象画面へ配置。
- フォーカスを奪わない、clickを遮らない、見送りを後から表示しない、同時1件。

現行pollはawait後に通知世代を確認せず`dismiss()`するため、古い照会応答と新しい表示が競合するケースは特に試験する。これは未再現のリスク。

smokeの改善は、固定4200ms待ちの成功確認だけでなく、通知開始／終了eventや有界の条件待機を使うこと。4秒そのものの仕様試験はfake clockで行い、少数の実時間試験で結線を確認する。現在、smokeのcatchは`COACH_SMOKE_FAILED`にまとめられるため、どの段階で失敗したかを特定しづらい。fixture用に段階名・終了コード・秘匿情報を含まない原因分類を出す。[smoke](../../src/main/smoke.ts)、[coach-app](../../src/main/coach-app.ts)

## 8. CIの具体的な設計案

現在は[package.json](../../package.json)に入口があるが、`test`が毎回helper publishを行う。pure、実helper、Electron、同梱版の粒度を分けて、速い失敗を先に返す。これまでの確認範囲を失わないよう、現行`npm test`相当のまとめ入口を残す。

以下は提案する実行段階であり、workflowファイルや新しいnpm scriptはまだ作っていない。

| 段階 | トリガー | 内容 | 失敗時の扱い |
| --- | --- | --- | --- |
| fast | PR・main | `npm ci`、型検査、pure/Core/Repository/契約試験。必要なTS/C#静的検査 | 必須チェック。失敗をtestのretryで隠さない |
| build/native | PR・main | global.jsonに合うSDK導入、helper publish、native fixture試験、Electron build | 必須チェック。OS/API条件不足でskipした試験を合格と扱わない |
| app integration | 表示可能な隔離runner／必要なPR | 完成した同じbuildで人工候補smoke、少数の利用者操作E2E | 必須にするならrunner能力を先に確認。表示環境がないなら明示的な別ゲート |
| packaged | main・公開候補、配布設定変更時のPR | `build`→`package:dir`→同じ出力dirの`smoke:packaged`、helper・runtime同梱確認 | 公開候補の必須。古いreleaseフォルダーを使わない |
| release acceptance | 公開候補を指定して手動実行 | Windows 11 x64通常権限、NSIS導入／再導入／削除、実入力・2画面・60分確認 | 既存受入条件が未合格なら公開未合格。CI緑で代用しない |
| maintenance | 定期または依存更新PR | 脆弱性・Electron/.NET更新、選んだmutation、負荷・耐久 | 結果をissue等で追跡。必要性に応じて頻度を決める |

PRとmainのイベントは信頼境界が異なる。PR品質確認に署名鍵・公開tokenは要らず、公開workflowを別にする。日常PCをPR用self-hosted runnerにしない。trustedな公開候補を隔離VMで扱う方が、このアプリの観測機能と相性がよい。[GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use)

CIで最初から必要な設定は以下。

1. `permissions: contents: read`を基本にし、追加権限は必要jobだけ。Actionsを検証したfull commit SHAへ固定する。
2. Node 24系の採用patch、SDK実版、runner image、実行commitを結果に残す。global.jsonは`latestPatch`なので、指定版と実際に選ばれた版の違いも記録する。
3. `npm ci`とlockfileを使い、キャッシュはnpm/NuGet等の取得データを中心にする。`.tools/tests`や通常データ、古いout/releaseを共有しない。
4. jobとプロセスにtimeout、同じPRの古い実行をcancelするconcurrencyを設ける。中断でも今回起動したhelperとElectronを片付ける。
5. 失敗時にテスト結果、buildログ、fixtureの診断・必要な自アプリ画像を短期間artifact保存する。人の窓タイトル・入力・画面や通常保存フォルダーをuploadしない。
6. 小さなworkflowは全PRに実行し、PRイベントで判定対象を明記する。path filterでrequired checkが未実行のまま待つ設計を避ける。
7. 許可されたプランでbranch protection/rulesetsのrequired checksへ結び付ける。今回rulesetsは確認できていないため、実装時に利用条件を確認する。

これらは[GitHubの権限・固定・runnerの一次資料](https://docs.github.com/en/actions/reference/security/secure-use)、[依存キャッシュ](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows)、[必須チェック](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)に基づく適用案。

**Windows hosted CIの成功はWindows 11利用者環境の成功ではない。** 調査時点の標準x64 runnerはWindows Server系で、GitHubのWindows VMは管理者・UAC無効の条件で動く。公開対象はWindows 11 x64通常権限・1〜2画面なので、Win32の取得、UIPI、独自枠、DPI、対話desktopの確認を別に残す。Windows 11 ARM runnerがあっても、今回のwin-x64公開条件の代替と断定しない。[GitHub runner仕様](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[Windows Server 2025 image](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md)

## 9. 配布・実機受入を成果物に結び付ける

[electron-builder.yml](../../electron-builder.yml)にはNSISのユーザー単位配布、helper同梱、appData保持が設定されている。入口の`package:dir`／`package:installer`はbuildを前提とするが、script自身でbuildは行わない。このため、単にpackageの成功だけでは最新コードの配布物と判断できない。公開候補はclean checkoutから作り、commit、製品版、helper protocol、SDK/runtime版、SHA-256、検証結果を一つのmanifestで結ぶ。

配布試験は、SDK/Node未導入、通常ユーザー、日本語・空白を含むpath、再導入、記録と設定の引継ぎ、削除後の残存データ方針、完全削除、helperが残らない終了、READMEのコマンド導入で確認する。インストーラー成功・同梱smoke成功・SmartScreenの実際の起動経路は別項目である。署名をするかは公開準備の判断であり、署名済みなら警告が絶対にないとしない。[electron-builder NSIS](https://www.electron.build/nsis.html)、[Microsoft SmartScreen](https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/)

公開受入は新しい点数基準を作る必要がない。[既存要件](mvp-requirements.md)にある「採用操作ごとにmouse10/key10で各8以上、誤キー案内・キーへの誤通知0、負例20で誤通知0、通常作業60分」を、実施した条件・成果物版と結び付ける。

受入表には、操作ID、対象app/版、Windows build、通常権限、入力経路、開始・終了状態、画面数・倍率・配置、正解の根拠、正しく認識／unknown／未検出／重複／誤認／誤通知、試験回数、実施日、成果物hashを持つ。正解は利用者の実施操作と目視した結果で付け、検出器の出力から作らない。必要以上のwindow titleや入力内容を含めない。

W03以外の10候補は現在準備中であり、「不足テスト」と「未実装」を混同しない。実装時には操作×app×成立条件ごとの同等キーを正解として追加する。11候補の削減や受入基準の緩和をこの調査で提案していない。10回で8回という基準の通過も、未試験の全アプリ／全条件に認識率を一般化する根拠にはならない。

## 10. セキュリティ・プライバシー・依存更新

Electronの基本防御は既にある。追加するのは、未知sender／別frame／通知窓からの制御、未知command、operation、誤型のmuteを拒否し、拒否前後で保存・観測状態が変わらない試験。contextIsolation、sandbox、nodeIntegration無効、window open/navigation拒否、CSP、狭いpreloadの実行時assertも有効。型定義だけではIPC payloadを検証したことにならない。[Electron security](https://www.electronjs.org/docs/latest/tutorial/security)

プライバシーは、counts/settingsのschemaが厳格という強みを、通常実行・失敗経路・試験artifactへ広げる。隔離fixtureの正常・保存失敗・helper失敗・終了で書き出された全ファイルを調べ、許可した集計と設定のみか確認する。アプリ自身の通信を確認する際は、OSや他アプリの通信と区別する。自動crash uploadや外部telemetryを新設する案は、外部送信なしの現要件と合わない。

fixtureは起動引数で同梱版にも入っている。現状、通常時に人工候補を受理する経路ではないが、試験モードの保存先が確実に隔離されること、通常モードではfixture命令を拒否することを回帰テストする価値がある。[index.ts](../../src/main/index.ts)、[ObserverHost](../../native-helper/ObserverHost.cs)

依存監査・定期更新のworkflowは見当たらない。ただし今回、脆弱性があると断定する監査はしていない。npmの実行依存だけを見る監査では、devDependenciesに置かれているが配布に含まれるElectronや、self-containedで同梱する.NET runtimeが抜ける。npm依存、Electron/Chromium/Node runtime、.NET runtime、builder/Actionsを分けて更新・監査し、更新後の配布smokeを行う。現在C#に明示的PackageReferenceはないため、「NuGet lockがない」ことだけを直ちに欠陥とはしない。[Electron versions](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)、[.NET self-contained](https://learn.microsoft.com/en-us/dotnet/core/deploying/)

最低限のOSSライセンス、依存の告知、公開用の製品versionはREADMEでも未決事項。公開候補manifest・SBOM・署名・attestationは必要性に合わせて増やす。全てのプランでGitHubのCodeQL/dependency review/保護機能が使える前提にはしない。

## 11. coverage・静的解析・性能・診断の扱い

今回のcoverage計測コマンドは以下。ファイル選択は既存の純TSテストに限定した。

```powershell
node --experimental-test-coverage --test '--test-coverage-include=src/**/*.ts' tests/coach.test.ts tests/detector.test.ts tests/repository.test.ts tests/serial-queue.test.ts
```

| 表に現れた対象 | line | branch | function |
| --- | --- | --- | --- |
| Core/coach.ts | 85.28% | 91.55% | 85.19% |
| Core/dates.ts | 83.33% | 100.00% | 66.67% |
| Core/detector.ts | 100.00% | 100.00% | 100.00% |
| Core/serial-queue.ts | 100.00% | 100.00% | 100.00% |
| Main/repository.ts | 100.00% | 96.72% | 100.00% |
| Shared/coach.ts | 100.00% | 100.00% | 100.00% |

表にMain/observer・notification・coach-app、Preload、Renderer、C#がない。`all files`の91.55%を製品全体のcoverageとして報告してはいけない。detectorのbranch100%でも、全ての経路・app・時間・条件の組合せを試験したことにはならない。現在のdetector.testにはkey正例、caption正例、4app別の正例、inputAge1000ms、validDate/sequence境界等の独立ケースが不足している。[Node 24.11.1 test runner](https://nodejs.org/download/release/v24.11.1/docs/api/test.html)

coverageは対象の分母・未importファイル・native別集計を先に決め、未実行分岐を探すために使う。初手で根拠なく全体90%を必須にはしない。mutationは注入／競合／停止／重複／通知期限のような重大条件を反転・削除した際にテストが落ちるか、狭い対象から試す。mutation100%を品質と同一視せず、同等mutantや工数を考慮する。[Stryker mutation](https://stryker-mutator.io/docs/mutation-testing-elements/)

静的検査は既存のstrict TypeScriptを維持し、Promise未処理、React hooks、Core→Main等の依存違反、C# compiler/analyzer warning、workflow誤記を主に狙う。formattingだけを「バグ検出」として数えない。pre-commitは補助であり、CIの代わりではない。

性能と耐久は、人工候補のburst、遅い保存、遅いstdout、繰返すstart/stop、helper終了、React購読解除、画面変更の繰返しでqueue長・memory・handle・CPU・遅延が増え続けないか測る。通常作業60分の要求は別に維持する。負荷の許容値は現状baselineと目的から相談して決め、架空のp95値を新しい合格条件にしない。

アクセシビリティはsemantic button/select/label、focus style、alert/statusが既にある。追加はkeyboardのみの操作、focus順序、縮小画面／文字拡大、高contrast、checkboxのON/OFF伝達、通知が操作対象を奪わないこと。自動チェックは補助で、必要な実機操作まで保証するものではない。[W3C WAI評価](https://www.w3.org/WAI/test-evaluate/)

診断は、通常の候補・キー・タイトル等を保存しない制約を守る。まずCIのfixture失敗を段階名で識別し、通常アプリでは現在の稼働／停止／保存状態・内容を含まないエラー分類を画面に出す設計を検討する。新たな通常診断ファイルの永続化やcrash dumpは、現行の保存方針を変更する可能性があるため別判断とする。

## 12. 着手順と完了の判定

1. **最小CIと再現した設定不具合**：既存検証をPR・mainへ載せ、純TSとhelperの入口を分ける。設定複合列を追加し、修正前に失敗・修正後に成功することを確認する。完了はCI緑と、適用できる必須チェックの設定確認。
2. **本番Observerと通信の境界**：候補生成へ小さな人工イベント入力を設け、C#の本番ロジック、ObserverClientの遅延・破損・終了・旧世代を試験する。完了はfixtureの迂回ではなく、本番条件の変更で関連テストが落ちること。
3. **状態遷移と少数UI試験**：保存／delete／停止／再開／日付の列を増やし、利用者の操作をMain/Preload/Renderer経由で通す。通知の非同期応答競合も含める。完了はボタンの存在でなく、その後の集計・設定・観測状態の一致。
4. **公開候補の配布・受入ゲート**：新規build由来の同梱版・NSIS・Windows 11通常権限・1〜2画面・実入力・60分を既存基準で確認する。実入力試験は同意後。完了は同一hashの成果物と条件別結果が結び付いていること。
5. **維持コストに合わせて強化**：coverageの分母、限定mutation、静的解析、依存更新、負荷・アクセシビリティ、内容を保存しない診断を段階追加する。

次の実装で一度に網羅E2E、全OS matrix、外部監視SaaS、100%coverage、常時実入力ログを揃える必要はない。現在の目的に直結するのは、**本番の誤判定を試験できること、失敗後の操作列を再現できること、同じ配布物について継続的に結果を確認できること**である。

## 13. 調査の成果と未確認事項

今回追加したのは、この不足分析と一次資料による背景調査、READMEからの参照。品質改善の実装、CIの登録、受入基準の変更、コミット・push・PR作成は行っていない。再現用probeはGit対象外の`.tools/quality-audit`にあり、独立の永続テストsuiteとして整備したものではない。

未確認は、既存GitHub保護設定、各プランのセキュリティ機能、現依存の脆弱性有無、packaged/dev smoke、NSIS、実入力精度、通常作業60分、混在DPI、hookの継続健全性、長時間性能、実機アクセシビリティ、3章以外の指摘リスクの実再現。これらを調査済み・公開合格とは扱わない。
