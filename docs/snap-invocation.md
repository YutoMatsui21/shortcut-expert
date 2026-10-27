# W08：配置候補を呼び出す

> 2026-10-27：W08（Win+Z）・W10（Win+Tab）は初回8操作の対象外。関連学習候補にも含めない。本書は対象変更前の実装・調査・証拠として保持する。現行の対象は[確定要件](ui-redesign-requirements.md)を参照。


#34の製品経路。Win+Zの最初のZ down、または最大化ボタンで500ms以上継続したhoverを呼び出しとして扱う。
メニュー本体の描画成功・配置結果を保証しない。表示名も「配置候補を呼び出す」に揃える。
一覧の「準備中」は自然入力受入まで維持する。

## Nativeと通信

`SnapInvocationObserver`が既存Observerのhookを共用し、同じmessage threadの50ms timerで照会する。
fixture起動ではtimerを開始せず、実入力payloadも読まない。停止でtimer・pending・キー状態を破棄する。
Win+Zは入力時のforeground rootとprocessを保持する。desktop/taskbar、不可視・最小化・子窓、
最大化ボタン/可変枠styleなし、権限不明・管理者・helper自身は対象外。
追加Ctrl/Alt/Shift、repeat、開始時の押下、注入入力を除外し、注入後は全対象キー解放確認まで再採用しない。
pendingは200ms以内に同じprocessの適格窓として再確認する。

hoverは物理cursorとPer Monitor V2 contextで対象rootを取得し、有効なTITLEBARINFOEX矩形を優先する。
3ボタンすべてゼロ矩形の成功応答だけ、30ms期限のHTMAXBUTTON照会へ進む。
不正矩形、DPI失敗、timeout、対象/process/窓外形の変化はunknown。
ボタンを押したままの時間、注入mouseによる位置、物理mouse移動を一度も観測していない起動状態は採用しない。
注入mouse後は物理移動が必要。入力・座標は一時状態としてのみ使い、通信・保存しない。

Snap全体設定はSPIとWindowArrangementActive（文字列0/1）の一致を要求する。
hoverにはEnableSnapAssistFlyout（DWORD 0/1）も必要。欠落・型不一致・未知値・失敗はunknown。
採用直前も設定を再読し、変化時はpendingを破棄する。200ms超のpoll空白と照会失敗も未計上pendingを破棄する。
計上済み滞在のlatchは設定復旧・照会失敗だけでは解除しない。確認できた退出/対象変更だけを再入場とする。
poll間に終わる退出・再入場は分離できない。

新variant `snap-invocation/snap-invocation-v1`は由来・route、適格性・対象照合、設定判定、
ボタンAPI・滞在時間・入力経過時間・対象monitorを送る。窓handle/process IDは送らない。
既存5操作と同じtransaction採番器と最終sequence採番器を共有し、v1へは送らない。
Mainが必須fieldを検査し、Coreが既知ON・確証済みの入力だけをW08/Win+Zへ変換する。
既存のSQLite日別保存、3学習状態、pause/stop、保存成功後通知と再送防止へ接続する。
稼働能力は引き続き未受入で、設定unknownを既知0やobserved coverageへ変換しない。

## 検証の範囲

- `tests/native-policy/SnapTests.cs`：本番のキー・滞在・設定・幾何policyと最終通信。499/500ms、200ms空白、失敗/復旧、repeat、注入、modifier、不正矩形、v1/停止/旧世代除外。
- `tests/native-policy.test.ts`：本番C#出力→Main厳格parse→CoreのW08/由来/重複ID/同等キー。
- `tests/snap-invocation.test.ts`：否定/unknown証拠、必須field、pause/stop/replay、実SQLiteの保存失敗とretry後非通知。
- `tests/fixture-integration.test.ts`：W08のmouse/key×3状態、実SQLite再open、両ページモデル、保存後通知adapter。
- 通常/同梱smoke：人工v2をfixture helper→Main/Core→保存→Reactへ流し、mouse/key各1・重複除外・pause中非通知を確認する。

人工イベントは自然入力の認識率を示さない。自然入力は2026-10-24の本人指示により各ケース原則1回、予想外の結果だけ再試行する。
標準caption/Chrome等の必要条件、負例で誤記録/誤通知0、同一最終buildのR02/J04と#47再受入は個別に確認する。
実入力の観測は本人の明示同意後に行う。未確認の必要ケースが残る間は#34をOpenとする。

2026-10-23のローカル検証：型検査・helper/Electron build、unit 240件、native 6件（本番C# policy 127ケース）、
通常版と修正後同梱版の隔離smokeが成功。押下中の退出で再入場できない不具合は回帰assert失敗→修正後成功を確認した。
専用ローカルレビューのP2 3件（最終設定不成立時の誤latch、対象外の別窓への退出、押下中の退出）を修正し、
全体再レビューと最後の差分に対する重点再レビューを実施した。最終重点レビューの追加指摘は0。
全unitの初回は既存JSON保存試験1件が保存エラーとなったが、単独実行と全240件再実行は成功した。原因は未特定。
同梱版全347ファイルのhashはGit対象外の`.tools/issue-34-build-hashes.json`に記録する。

## 製品の自然入力受入入口

2026-10-24に本人が自然入力試験へ同意。`--w08-natural-acceptance`は同梱版と新しい空の隔離userDataを必須とし、
通常のObserver/DurableCoach/SQLite/OS通知adapterを使用する。人工候補は注入しない。起動時・試行間は観測停止。
操作パネルのARMからFINISH/CANCELまでだけ観測し、1試行45秒、session20分で終了する。
通常画面の開始操作からは観測を開始できない。パネルはhookや人工入力を持たず、別processに標準captionの対象窓を用意する。

```powershell
node scripts/w08-natural-acceptance.mjs --package-dir release/issue-34-natural --compile-only
# 本人同意後だけ。ARM後は本人が対象窓で1操作し、FINISHを押す。
node scripts/w08-natural-acceptance.mjs --package-dir release/issue-34-natural --observe-consented
```

生成先は`.tools/validation/w08-natural/session-*`。同梱全体hash、panelソースhash、本人が指定する試行の期待値と
W08の日別集計の差分、通知要求数、取消/timeout・保存障害等による無効判定を保持する。キー列・入力時刻列・座標・窓名・他アプリ画像は保存しない。
keyはmouse0/key1、mouseはmouse1/key0、負例は両0が正解。学習中・通知有効のmouseだけ通知要求1を期待し、
習得済み/対象外/通知pauseでは0を期待する。通知要求をOS可視表示の合格へ読み替えない。
キャンセル・timeoutは機能確認の合格に数えず、未完了として残す。予想外の結果も除外せず、実施結果を記録する。
同じ正常条件を回数確保のために反復しない。1ケースの期待どおりの結果を確認したら、次の未確認条件へ進む。

入口の検証：全unit 244件成功後、追加の仮想時計試験1件でも、ファイル読取中の期限到達・遅いFINISH・session終了retryを確認。
型検査・helper/Electron build・panel compile・修正後同梱版fixture smokeが成功した。初回の全unitでは新FS importに未対応の起動mockを修正し、
既存JSON保存試験の保存エラー/timeoutも記録した。全244件の再実行は成功。自然入力結果をこれらの人工試験へ混ぜない。
専用レビューで見つかったpause順序・途中中断の保持・他操作通知の分離・期限競合・session終了retry・panel異常終了の6件を修正し、
全体再レビューと最後の終了処理に対する重点再レビューを実施した。最後の追加指摘は0。

## 2026-10-24 製品の自然入力確認結果

本人の明示同意と手動操作で、Windows build 26340／Chrome 155.0.8059.85の同じ同梱版を使用した。
各ケース原則1回という本人指示に従い、以下の13ケースが期待するW08記録・通知要求と一致した。
通常userData、人工入力、他アプリ画像は使っていない。対象アプリ・実操作と通知の可視表示は本人の報告で照合した。

| ケース | mouse / key差分 | W08通知要求 |
| --- | --- | --- |
| 標準captionでWin+Z | 0 / 1 | 0 |
| 標準captionで最大化hover | 1 / 0 | 1。本人が可視通知を確認 |
| ChromeでWin+Z | 0 / 1 | 0 |
| Chromeで最大化hover | 1 / 0 | 1。本人が可視通知を確認 |
| 閉じるボタンhover | 0 / 0 | 0 |
| Ctrl+Win+Z | 0 / 0 | 0 |
| 左ボタンを押したまま最大化領域へ移動 | 0 / 0 | 0 |
| 習得済みでhover | 1 / 0 | 0 |
| 対象外でhover | 1 / 0 | 0 |
| 通知pauseでhover | 1 / 0 | 0 |
| デスクトップでWin+Z | 0 / 0 | 0 |
| Snap全体OFFでWin+Zとhover | 0 / 0 | 0 |
| Snap ON・hover表示OFFでWin+Zとhover | 0 / 1 | 0 |

記録は`.tools/validation/w08-natural/session-dyk2nB`（11試行）と`session-FxZsHQ`（3試行）。
最初のsessionの試行3はpanelの期待値がmouseのままWin+Zを押したと本人が訂正し、実測key1・mouse0・通知要求0と一致した。
この設定取り違えを別注記し、元の`detectorPassed=false`等を上書きしていない。正常条件の追加反復は求めなかった。
13ケースとは別のこの1試行を含め、生の試行記録は計14件である。

両sessionの全347ファイルmanifest SHA-256は`babae0994d6280309db7122badd95aab7e77026d2f57ef2182b6e53a718123f8`で一致する。
実行コードのcommitは`68d41f696be09134268851b729f976cc720405fe`。その後の試行方針変更は文書のみで、本番コード・実行物を変えていない。
試行の設定・集計差分は各`data/status.json`、本人の訂正・目視報告は`manual-oracle.json`、build全体hashは`build.json`に分けて保持する。

本人がSnap全体とhover表示をONへ復元し、本人アカウントのWindowArrangementActive文字列1・EnableSnapAssistFlyout DWORD 1を読取照合した。
両製品processは終了code 0。終了後に隔離SQLiteをread-onlyで再openし、`integrity_check=ok`とW08集計を確認した。
最初のsessionはmouse5/key3（設定取り違えのkey1を含む）、次のsessionはmouse0/key1で、試行差分の総和と一致する。

これは改定R02による当該ケースの機能確認であり、95%精度や他OS build・全アプリへの保証ではない。
499/500ms・200ms空白・query失敗/unknown・注入・repeat/再入場・保存障害後の非再送等は、本番policyと隔離fixtureの結果を別の証拠として保持する。
11操作が完成した最終buildでの#47再受入、通知のNSIS登録/履歴click等の#44受入、アプリ公開は完了していない。
