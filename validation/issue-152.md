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

修正前のNative回帰試験ではボタン不明クリックの開始失敗を確認した。

## 修正後の受入

`deebb8788e8b2654875ce75eece6a5ac2e7221e7`の固定同梱版で、本人が失敗4ケースを再実施した。[結果](evidence/issue-152/product-trials-deebb87.json)は4件とも有効・完了で、W01とW03／W04各1件、通知要求1件、2操作の通知行を確認し、本人のOS通知目視も一致した。ChatGPT最大化→最小化とObsidianの3ケースの取りこぼしを解消した。

Chromeの3件とChatGPT通常起点の2件は旧候補`366b101`、残る4件は修正候補`deebb87`で確認しており、同一最終buildで9件すべてを再実施した結果ではない。人工fixtureの検証と実入力結果は分けて扱う。

修正後はunit 363件、Native 7件（C# policy 1,166件）、型検査・ビルド、通常／同梱smokeが成功した。専用ローカル全体レビューと取消処理の再レビューは追加指摘なし。main取り込み時の競合解決後も、Git treeが実機確認済み`deebb87`と同じ`fbaeb3778bcfd6969db6600a75edaa7249cc9519`であることを確認した。受入記録の追記は製品の動作を変えないため、専用レビューは追加していない。
