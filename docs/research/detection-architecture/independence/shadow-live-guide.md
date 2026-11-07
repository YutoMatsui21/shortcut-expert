# Shadow実機比較の実行手順

本番アプリとは独立したWinForms probe。製品のCandidate送信・保存・通知は呼ばない。本人が物理操作し、合成入力を使わない。

```powershell
# buildだけ（観測なし）
node scripts/probes/mouse-detection-shadow.mjs --build
# 本人の実入力観測同意後に起動
node scripts/probes/mouse-detection-shadow.mjs --observe-consented
```

appはchrome/dia/obsidianの手動ラベル。実行ファイル名で対象アプリを推測しない。scenarioを選び、開始状態を作ってからARM。5秒以内に対象へ戻り、ARMED後に1操作。FINISH表示とhooksRemoved=trueを確認する。1試行20秒、session20分で自動停止。FINISH/STOPまたは窓を閉じてもhookを解除する。timeoutは成功ではない。

| scenario                      | 物理操作                                               | 期待                        |
| ----------------------------- | ------------------------------------------------------ | --------------------------- |
| max-max                       | A最大化→Bへdragして最大化                              | W02のみ                     |
| normal-max                    | A通常→Bへdragして最大化                                | W02+W03                     |
| half-max / quarter-max        | 同画面の配置済み→上端最大化                            | W03                         |
| half-half                     | 同画面右half→左half                                    | W06                         |
| quarter-quarter               | 同画面左上→右上                                        | W07                         |
| same-placement                | dragして同じ画面の同じ配置へ戻す                       | 0                           |
| resize                        | 普通の辺・角のresize                                   | 0                           |
| cancel                        | drag中Esc                                              | 0                           |
| custom-double-max / restore   | 独自タイトルバーの空白をdouble-click                   | W03 / W04                   |
| standard-double-max / restore | 標準captionをdouble-click                              | W03 / W04                   |
| custom-single-minimize        | 最小化ボタンsingle-click                               | 現行W04を維持、2クリック案0 |
| body-single / body-double     | 本文をclick / double-click（状態変化を起こさない場所） | 0                           |

クリックのStandard/Fallbackは、同じライブCandidateTrackerの結果をrouteで分けたもの。Doubleは同じ物理押下/解放とsnapshotから計算する。人工試験では同じ列をTrackerへ再生して比較する。ライブは50ms timerで結果を確認し、そのsnapshotと判定時刻を一緒に固定する。製品Observer全体の完全な複製ではなく、Native候補層の比較である。

dragは本番と同じMOVESIZEEND callbackでCurrentを確定し、その時のsnapshot/foregroundをShadowにも渡す。150ms後の安定確認を、END時点のforegroundの代わりに使わない。後続Snap Assistによるforeground移動は独立した固定booleanで残す。END後にshow/process/monitorが変わればShadowは安定性不明として棄却する。

## ログ

`.tools/validation/mouse-shadow/trials-*.jsonl`。session行にDLL SHA256。trial行は手動app/scenario、Current/Shadowの操作ID、クリック3方式結果、固定理由、始終show/shape、monitor変更boolean、API可否、物理解放、move開始/終了、対象照合boolean、hook解除booleanのみ。HWND/process/座標/入力時刻はメモリ内の一時照合に限定し、保存しない。画像・タイトル・URL・キー列も保存しない。

期待と異なる場合、入力未取得、snapshot取得不能、始終状態不一致、foreground、解放/終端順序、配置形状、解放位置、取消/競合の順に固定カテゴリで切り分ける。ラベルだけを信じて成功扱いしない。別原因の状態変更との因果をAPIが保証するものではない。

本文double-click＋別原因最大化の反例は人工試験で再現する。通常本文の無変化負例が成功しても、因果の識別不能性は解決しない。W02+W06はShadowの研究結果に限り、本番仕様へ追加しない。

クリックの3方式結果はclicks.Standard/Fallback/Doubleを読む。clickDiagnosticはクリック数カテゴリ、押下時foreground、候補の有無、固定route/origin、対象一致、期限カテゴリ、注入/競合booleanだけを追加出力する。Current/Shadowの最上位配列はdrag用である。
