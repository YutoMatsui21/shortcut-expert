# W08：配置候補を呼び出す

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

人工イベントは自然入力の認識率を示さない。実OS照会による製品hoverの成立、標準caption/Chrome等で各入力20回以上・95%以上、
負例20回以上で誤記録/誤通知0、同一最終buildのR02/J04と#47再受入は未確認。
実入力の観測は本人の別途明示同意後に行う。#34はこれらを残してOpenを維持する。

2026-10-23のローカル検証：型検査・helper/Electron build、unit 240件、native 6件（本番C# policy 127ケース）、
通常版と修正後同梱版の隔離smokeが成功。押下中の退出で再入場できない不具合は回帰assert失敗→修正後成功を確認した。
専用ローカルレビューのP2 3件（最終設定不成立時の誤latch、対象外の別窓への退出、押下中の退出）を修正し、
全体再レビューと最後の差分に対する重点再レビューを実施した。最終重点レビューの追加指摘は0。
全unitの初回は既存JSON保存試験1件が保存エラーとなったが、単独実行と全240件再実行は成功した。原因は未特定。
同梱版全347ファイルのhashはGit対象外の`.tools/issue-34-build-hashes.json`に記録する。
