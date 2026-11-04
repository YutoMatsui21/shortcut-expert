# W02/W03 タイトルバー非依存ドラッグ検証

対象は今回作成した `release/drag-validation/win-unpacked/Shortcut Expert.exe`。
PR・merge・公開は行わない。Chrome/Diaの自然入力は利用者が確認する。

## 判定の変更

- 変更前：caption押下をMOVESIZESTARTへ引き継ぎ、W02では入力・結果のWS_CAPTIONも要求。
- 変更後：クリック判定とは別に左押下を一時保持し、1000ms以内の同一HWNDのMOVESIZESTARTへ引き継ぐ。HTCLIENTやhit test不明でも対象。移動によるクリック取消でドラッグの押下証拠は失わない。
- 物理解放前の移動開始とMOVESIZEEND、同一HWND/process、前景整合、画面・作業域・DPI等の既存判定を維持。注入、修飾キー、競合キー、取消、既知のresize境界・captionボタンは採用しない。
- W02は実際の窓の始終monitorが異なる場合だけ。W03は通常→最大化と上端解放。W02＋W03もcaption不要。W06/W07とW02キー経路のcaption条件は維持。
- protocolの`caption-drag` / `caption-top-drag`というroute名は互換性のため維持し、実際のcaption hitを保証する意味には使わない。

## 起動

通常利用中のShortcut Expertをトレイの「終了」で完全終了してから、リポジトリ直下のPowerShellで実行する。

```powershell
node scripts/acceptance/final-natural-acceptance.mjs --package-dir release/drag-validation --diagnostics --observe-consented
```

このコマンドは本人が実入力の観測に同意して実行する。自動操作は送らない。専用panelからARMした試行だけを確認する。
通常データとは別の `.tools/validation/issue-47/session-*/data` を使う。
Chromeはアプリ種別chrome、Diaはexternalを選び、対応関係を手元で控える。

1. IDLEで通常・未配置の起点窓を準備する。
2. W02は`P02m-left` / `P02m-right`、W03は`S03-drag`を選ぶ。
3. ARMを押し、4秒以内に対象窓を前面へ。ARMED後2秒待つ。
4. 物理マウスで指定操作を1回行い、解放して3秒待つ。
5. 実際の結果と通知を選んでFINISH。Chrome/DiaそれぞれW02/W03を確認。
6. panelを閉じて観測とプロセスを終了する。1試行45秒・session20分の制限がある。

W02は別画面の中央の通常位置へ移し、端への配置を避ける。W03は同じ画面の上端へ通常窓をドラッグする。
追加負例はカーソルだけを別画面へ移す、`N02-return`（元画面へ戻す）、`N02-cancel`（Esc取消）。W02は0件を期待。

## 失敗時の確認

セッションパスはコンソールの`FINAL_SESSION`に出る。`data/status.json`の`results`に試行ごとの`counts`、`classified`、`diagnostics`、`nativeDiagnostics`がある。
窓タイトル・URL・入力生ログは追加しない。

- `MouseDown` / `MouseUp`、`MoveStart` / `MoveEnd`：物理入力・Windowsイベントの到達。
- `TargetMissing` / `TargetRejected`：入力対象のcache／適格性。今回の変更だけでは解決しない場合がある。
- `RawClient` / `FinalOther`：caption以外のhitでも今回のドラッグは候補化可能。
- `DragNoSource`：押下と移動開始の対象・期限・競合などを確認。単独の理由値だけで原因を断定しない。
- `DragNoResult` / `DragTargetChanged` / `DragLayoutChanged` / `DragReleaseUnknown`：終端読取・対象・画面構成・解放の照合失敗。
- W02：`MoveSameMonitor`、`MoveUnstable`、`MoveInputInvalid`、`MoveForegroundMismatch`、`MoveAccepted`。
- W03：`MaxStartInvalid`、`MaxRelease*`、`MaxDockThresholdChanged`、`MaxAccepted`。
- native側で採用されても件数が増えなければ、`classified`とMain/Coreの`diagnostics`を確認する。

MOVESIZESTART/ENDのないアプリは対象外。自動fixtureの成功とChrome/Diaの実機成功は別の証拠として扱う。

## 自動検証結果

- unit全体：332件成功、skipなし。
- helper再build後のnative全体：7件成功（本番C# policy 910ケースを含む）、skipなし。
- build／型検査、package、同梱版fixture smoke、診断panel compile：成功。
- 未コミット差分全体の専用ローカルレビュー：指摘なし。
- build時にNuGet脆弱性情報の取得警告あり。コンパイル・同梱版作成は成功。
- Chrome/Dia実入力：未実施。CI・PR・merge・公開は実施していない。
- ビルド識別情報は同じフォルダーの`build.json`。元headと未コミット修正を含むビルドである。

## 2026-11-04 Dia上端最大化の切り分け

前buildと一致する`session-uxdHlY`の4試行を確認した。externalは利用者申告からDiaに対応する。
Chrome/DiaのW02は各1記録・1通知要求。ChromeのW03も1記録・1通知要求。
DiaのW03は`MoveStart=1`・`MoveEnd=1`・`DragMaximizedResult=1`まで到達したが、`MaxStartInvalid=1`で棄却され、候補・記録・通知要求は0だった。通知表示経路の故障ではない。

`MaxStartInvalid`は開始show、開始arranged、結果arrangedの複数条件をまとめていたため、どの条件かは既存ログから確定できない。直前のDiaのW02では`before-arranged-true`があるが、別試行なのでW03の起点を証明しない。利用者も起点状態は覚えていない。要約は`dia-top-drag-20261104.json`。

今回は判定条件を維持して、既存の棄却理由を以下へ細分化した。複数条件が不成立なら全て計上する。診断なし／ありの採否が同一であることもfixtureで確認する。

- `MaxStartNotNormal`：押下時が通常状態ではない。
- `MaxStartArranged`：押下時に配置済み。
- `MaxStartArrangedUnknown`：押下時の配置状態が不明。
- `MaxResultArrangedUnknown`：最大化終端の配置状態が不明。

再検証buildは`release/drag-validation-state-diagnostics`。前のbuildを残して比較する。

```powershell
node scripts/acceptance/final-natural-acceptance.mjs --package-dir release/drag-validation-state-diagnostics --diagnostics --observe-consented
```

Diaを通常サイズに戻し、画面中央へ移動して解放した窓を起点に`S03-drag`を1回確認する。次にChromeでも同じ条件で比較する。配置済み起点での成功は今回保証しない。
新ログに上の理由が出れば、状態読取失敗・配置済み起点・最大化済み起点を区別して次の修正を判断できる。現時点ではDiaの不検出を直したとは扱わない。

診断追加後の検証：unit 332件、native 7件（C# policy 916ケース）、型検査・build・package・同梱版fixture smokeが成功。未コミット差分全体の専用ローカルレビューは指摘なし。新build識別情報は`state-diagnostics-build.json`。新buildの自然入力は未実施。

## 2026-11-04 代表キーへの方針変更（上の診断段階の判断を更新）

利用者の明示承認により、W03では開始状態からの厳密なキー同等性ではなく、操作の代表キー`Win + ↑`を案内する。
Nativeの上端最大化はarranged=true起点も採用し、CoreもW03の代表キーを返す。別画面最大化W02＋W03も同じ扱い。arranged不明、最大化済み起点、入力・対象・終端・解放等の不成立は従来どおり棄却する。
W04の最大化→最小化ボタンの通知文字列は`Win + ↓`に統一し、実機panelの期待文字列も更新した。

再確認用build：`release/drag-representative-keys`。既存アプリを完全終了して実行する。

```powershell
node scripts/acceptance/final-natural-acceptance.mjs --package-dir release/drag-representative-keys --diagnostics --observe-consented
```

Dia/Chromeで通常サイズ起点と右半分配置起点の`S03-drag`を確認し、W03がmouse +1、通知が`Win + ↑`となることを期待する。`S04-min-max`ではW04がmouse +1、通知が`Win + ↓`となることを確認する。自然入力は新buildで未実施。

代表キー版の検証：unit 332件、native 7件（C# policy 917ケース）、型検査・build・package・同梱版fixture smoke成功。ローカル専用レビュー指摘なし。ビルド識別情報は`representative-keys-build.json`。PR・mergeは実施していない。
