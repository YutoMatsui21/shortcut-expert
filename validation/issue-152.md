# Issue #152：実機確認と残る原因切り分け

## 固定した製品候補

- revision: `366b101ff289fe3d49f2c43ab5d60de8dae3aa24`
- manifest SHA-256: `e65d7b3ecb0051d48689ff1d985f0d49fc78b7ecae03346a886b5e5a231a0c3d`
- [隔離製品経路の集計](evidence/issue-152/product-trials-366b101.json)。本人の物理クリックとOS通知の目視。試行6は未完了として除外し、同じケースを完了した試行7を評価する。

| ケース                       | 記録・通知要求・本人目視                     |
| ---------------------------- | -------------------------------------------- |
| Chrome 3ケース               | W01＋W03/W04各1件、通知要求1件、本人目視一致 |
| ChatGPT 通常→最大化／最小化  | W01＋W03/W04各1件、通知要求1件、本人目視一致 |
| ChatGPT 最大化→最小化        | 記録0件、通知要求0件                         |
| Obsidian 通常→最大化         | W01だけ1件、通知要求1件。2行の期待と不一致   |
| Obsidian 通常／最大化→最小化 | 記録0件、通知要求0件                         |

## 確認した失敗境界

Obsidianはrootと同processのchildとも`HTCLIENT`、captionボタン経路を確定できず、新しい複合経路に入らない。通常→最大化では既存W01だけが成立し、最小化では既存W01の一時前面化後の取消も確認した。現行の状態変化fallbackは入力開始時の前面一致を必要とするため、今回の非アクティブ起点を補えない。

ChatGPT最大化→最小化ではボタン経路と状態変化は観測されたが、候補は`target-unmatched`で棄却された。新しい複合envelopeも既存W01候補もない。`switching.MousePending`／前面と対象の適格性のどの入口条件が不成立だったかは現在の集計だけでは確定できない。caption消失は仮説であり、このケースの押下時に確認した事実として扱わない。

## 追加診断と修正

判定を変えない追加診断でChatGPT最大化→最小化を1件再確認した。[集計](evidence/issue-152/chatgpt-admission-diagnosis.json)では`CaptionInactivePress=1`、`CaptionStyleMissing=1`、`CaptionSwitchMissing=1`、`RawMinButton=1`。押下時にcaptionがなく、旧W01候補を必要とする複合入口で止まることを確認した。

修正では、中立状態と前面／対象の適格性を複合クリック用に再確認し、その対象確認だけはWS_CAPTIONに依存しない。他のstyle・process・root・owner・可視性・cloaked・権限の条件と、通常W01の条件を維持する。ObsidianのHTCLIENT起点は、500ms以内の状態変化・同一対象の物理解放・4px以内の移動に加え、対象への前面化を確認してfallbackする。状態が変わらなければW01のみ、復元は追加しない。client面の既存ドラッグ追跡は残す。

修正前のNative回帰試験ではボタン不明クリックの開始失敗を確認した。製品受入は未完了。自動テスト・レビュー・smokeの成功を、この4件の実入力成功へ置き換えない。
