# 8操作の検出成立性：判断と代替策

**いつ読むか**：操作の検出範囲を広げるとき、入力と結果の対応が曖昧なとき、別のWindows API／判定方法を検討するとき。**現在の製品仕様・実装状態の正本ではない**。要件は[製品要件](../ui-requirements.md)、操作別の実装契約は[operations](../operations/)。技術ゲートの最新決定は[#14](https://github.com/YutoMatsui21/shortcut-expert/issues/14)、実機最終受入は[#47](https://github.com/YutoMatsui21/shortcut-expert/issues/47)。

## 1. 調査で分かったこと

2026-10-28の[#9](https://github.com/YutoMatsui21/shortcut-expert/issues/9)では、自作標準WinForms窓・上下2画面を中心に**33件の自然操作を観測**。その時点では5操作が制約付き着手可、3操作が必要範囲未成立だった。その後[#14の16件追加調査](compound-drag-validation.md)により、**8操作すべて制約付き着手PASS**へ変更された。これは**検出実装・製品受入PASSではない**。

| 操作 | 実測で得た手掛かり | 再調査時の障壁・代替案 |
| --- | --- | --- |
| W12 | 主タスクバーの番号・Win+数字 | UIA Buttonの識別・番号の前後一致。secondary／overflow等は不明扱い。[詳細](taskbar-input-validation.md) |
| W01 | 直接クリック、Alt+Tab後の別窓確定 | foreground変化だけでは因果を示さない。入力対象＋WinEvent＋最後の照会を照合。[詳細](window-switch-validation.md) |
| W03 | ボタン／ダブルクリック／上端drag→最大化 | 同じ形状でもSnap Layout選択・program変化がある。caption入力・drag終端・結果の相関が必要 |
| W04 | 復元／最小化、連続Win+↓ | `WM_NCHITTEST`だけでは最小化ボタンをcaptionと誤認した。`TITLEBARINFOEX`の有効矩形を代替根拠にする |
| W06 | 左右halfのdrag／Win+方向 | `IsWindowArranged`とDWM形状だけでは入力原因不明。終端までの同一対象・物理解放を照合 |
| W07 | 四隅quarterとWin保持中のhalf→quarter | 中間halfをW06として先に記録しない。上側隅は画面移動を伴い、W02との複合計測が必要 |
| W02 | 始終monitorの違い、Win+Shift+方向 | monitor番号を左右の物理方向と同一視しない。戻し・取消・画面構成変更を区別 |
| W11 | ×／Alt+F4と同じ窓の破棄 | クリック・前景変更だけで確定しない。対象・thread・破棄を照合し、hide・確認取消を除外 |

## 2. 再利用する判断原則

- **入力・対象・結果は3つの別の証拠**。結果形状が似ても、別の操作として記録しない。採用と同等キー案内も別の判定にする。
- captionボタンは有効な`TITLEBARINFOEX`、窓状態は`DWM`／`IsWindowArranged`、画面移動は始終monitorを参考にする。ただしAPIが**原因や一般アプリ全体の動作を保証するわけではない**。
- 戻しdrag／Esc／programによる変化、Win保持途中のhalf、閉鎖後のforeground変化を成功候補として数えない。W01/W12、W02/W03/W07の境界を混ぜない。
- 従来の「画面跨ぎ最大化はW03のみ」は**過去の判断**。現在の複合仕様は[別の調査](compound-drag-validation.md)と[要件](../ui-requirements.md#compound-gesture)を優先する。W08／W10は初回対象外。

## 3. 証拠と再検討時の手順

- [33試行の原本 1](../../validation/evidence/eight-operation-20261028-session1.jsonl)・[2](../../validation/evidence/eight-operation-20261028-session2.jsonl)・[3](../../validation/evidence/eight-operation-20261028-session3.jsonl)、[使用した調査source](../../validation/probes/EightOperationProbe.cs)、[#9での判断](https://github.com/YutoMatsui21/shortcut-expert/issues/9)。
- 新しい問題があれば、**該当する入力経路・結果・不足した証拠**をまず特定する。原本の自作窓・上下2画面の結果を一般アプリ／横並び／混在DPIへ一般化せず、未確認条件を負例と一緒に試験する。
- 調査入口は`node scripts/eight-operation-probe.mjs --self-test`。実入力観測は本人の明示同意後に限り`--observe-consented`。自然入力の観測と製品の保存／通知・OS可視バナーは別に受け入れる。
