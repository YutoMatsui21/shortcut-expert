# W01：ウィンドウ切替を検出する方法の調査

**いつ読むか**：直接クリック／Alt+Tabの見逃し、Shellの中間窓・イベント到着順の問題、タスクバー番号への案内拡張を検討するとき。現在の実装契約は[W01設計](../operations/window-switch.md)、受入は[#47](https://github.com/YutoMatsui21/shortcut-expert/issues/47)。

## 1. 検出に必要な根拠

| 経路         | 研究で採用した候補の組立て                                                                |
| ------------ | ----------------------------------------------------------------------------------------- |
| 直接クリック | 非注入のdown／up、同じroot窓、入力前と異なるforegroundイベント、最終pollの一致            |
| Alt+Tab      | Alt保持→Tab（複数でも1操作）→解放、補助foregroundを経由した**最終的な別の通常窓**との一致 |

`EVENT_SYSTEM_FOREGROUND`や`SWITCHEND`は**窓の変化を伝えるだけ**で、入力が原因であることを証明しない。後着イベントがあるためcallback時のforegroundと最終pollを使い、入力・対象・結果を相関付ける。旧研究では自作A/B/Cへの直接クリック・Alt+Tabと取消／元窓／W12入力の負例を確認したが、製品の全環境の精度は証明していない。

## 2. 見逃しから得た判断

| 失敗・未確証の点                       | 分かったこと／代替方針                                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alt+Tab中の後着foreground／Shell相当窓 | **最後に届いたイベント＝最終結果とは限らない**。入力後の時刻と現在のforeground・最終pollを照合                                                                 |
| `SWITCHSTART/END`が届かない            | 研究で確認した試行では発生しなかった。切替UIイベントを成功の必須条件にしない                                                                                   |
| 製品でのAlt+Tab中間窓                  | 同じShell processの可視switcher／不可視staging等は**確定結果ではなく一時通過**。中間HWND一致だけを頼らず、最終の対象窓を再確認                                 |
| 研究の追加keyによるunknown             | 原本には不明入力が残ったが生キーは収集していない。本人の誤操作・Windows側の原因を断定しない                                                                    |
| Win+数字やtaskbar click                | W12の独立検出。結果のforeground変化だけでW01にも加算しない                                                                                                     |
| 任意の切替先にWin+数字を付ける         | windowのAppUserModelIDとtaskbar項目の**同一性は未証明**。基本案内はAlt+Tab、追加候補は[#96](https://github.com/YutoMatsui21/shortcut-expert/issues/96)で別検証 |

**因果の限界**：入力と同時に別programが同じ窓を前面化する可能性を、時刻の近接だけで排除できない。owner窓・Edgeの通常窓とタブ、複数displayの一般化も保留する。実装にない対応範囲は[W01設計](../operations/window-switch.md)で確認する。

## 3. 再調査時に比較する方法

1. **入力の到達漏れか**：hookのdown/up・Alt解放・追加修飾・停止世代を確認。
2. **対象の誤分類か**：root／owner／Shell中間窓を分け、対象の有効条件を検査。
3. **結果イベントの遅れか**：WinEventと入力hookのWindows message timestampを比較し、古いイベントを新しい結果にしない。期限だけmonotonic時計で判定する。
4. **W12や別操作との重複か**：入力経路別の排除条件を検証。キー候補の追加は別Issueで扱う。

[研究C# source](../../validation/probes/WindowSwitchProbe.cs)、[初回の見逃し原本](../../validation/evidence/window-switch-20261025-initial.jsonl)、[診断版の再試行原本](../../validation/evidence/window-switch-20261025-diagnostics.jsonl)。`node scripts/probes/window-switch-probe.mjs --self-test`で人工確認、本人の明示同意後のみ`--observe-consented`。当時の12試行（再試行含む）を独立した12ケースや精度率とみなさない。
