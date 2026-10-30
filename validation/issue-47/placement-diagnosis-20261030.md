# 左側quarterのマウス見逃し

## session7

製品revisionは`e8b6752518aa427990600142566009dabc32ef25`、Native診断OFF、manifest SHA-256は`a7efdd3e4c12c18c26855ceb651f49605c1a5c81db57e78c8f78e4fb0273bd8f`。上下配置の上側画面・エクスプローラーで配置12件を確認した。

- W06左右のmouse/key4件、W07のkey四隅4件、W07右上／右下mouse2件の計10件は、予定操作1件だけの記録と適切な通知要求に一致。
- 左上mouse相当のtrial5と左下mouseのtrial9は、候補・記録・通知要求がすべて0件。本人は窓自体は各quarterに配置されたと明示した。
- trial5は元のパネル選択がP07k-left-topで、同じIDがtrial6にもあった。本人の条件付き訂正指示どおり、最初のtrial5をP07m-left-topの期待値として扱う。元のstatus／caseId／DB件数は変更しない。候補0のため実入力由来の機械証拠は残っておらず、訂正は本人申告として分ける。補正後の期待値はW07 mouse1・通知要求1だが、実測はともに0。

[原本status](../evidence/issue-47/session7-status.json)、[訂正・本人確認](../evidence/issue-47/session7-participant.json)、[build](../evidence/issue-47/session7-build.json)、[正常終了](../evidence/issue-47/session7-exit.json)、[read-only SQLite整合性・build不変](../evidence/issue-47/session7-integrity.json)。

## 次の診断

現状の観測はMain受信前で止まっていることだけを確証する。左だけの失敗を、マウス経路の選択誤り・幾何判定・解放位置・foreground変更・Snap補助UI等の特定の原因へ推測で帰属させない。

既存のNative opt-in診断へ、dragの保持／取消／終端照合、arranged結果、終端形状の各辺・中央線一致、入力・monitor/work/DPI・期限の照合、側端距離の固定範囲カテゴリ、作業域内の解放、上下側一致、採用の理由を追加する。実座標・矩形・距離値・時刻・窓名は保存せず、固定理由ごとの整数0〜1000だけを使う。通常モードは収集しない。

`PlacementGeometry.Shape/Drag`とtrackerへ診断callbackを付けたが、採用条件の2px／1px／期限や除外は変更していない。診断あり／なしの結果一致、形状不明・解放位置・期限・入力不一致、foreground／入力取消の理由を本番C# policyで確認し、C# enumとMain allowlistも照合した。関連unit32件・型検査・C# policy552検証とCore／SQLite結合・helper buildが成功。

次の自然入力は診断ONの隔離sessionで、P07m-left-top／P07m-left-bottomを各1回まとめて行う。成功10件はこの切り分けで繰り返さない。新しい理由集計を得てから製品修正を判断する。

専用ローカルCodexレビューで、早期return分割の同値性、判定・状態遷移の不変、固定カテゴリだけの集計、62理由のC#/TS同期、訂正原本の扱いを確認し、指摘なし。同梱helper hash一致と隔離同梱smokeも成功した。fixtureの成功を左側の自然入力成功として扱わない。
