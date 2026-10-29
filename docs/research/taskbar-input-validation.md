# W12：タスクバー操作を検出する方法の調査

**いつ読むか**：Win+数字・タスクバークリックを認識できない／誤番号を出すとき、別タスクバーや並び替え・overflowの対応を検討するとき。現行の採用条件は[W12設計](../operations/taskbar-input.md)、製品受入は[#47](https://github.com/YutoMatsui21/shortcut-expert/issues/47)。

## 1. 解決したい問題と採用方法

タスクバークリックの対象アプリと**Win+数字の番号**は、クリック座標やprocess名だけでは特定できない。採用した方式は次の組合せ。

1. `Shell_TrayWnd`下のUIA Buttonを`AutomationId Appid:`・`ClassName TaskListButton`・可視矩形で限定し、主タスクバーの左から番号を対応付ける。
2. **別processの有界な照会**でUIAを実行し、hookを止めない。250ms間隔・最大1照会、2秒timeout／2.5秒worker監視。
3. 入力前の照会（開始から750ms以内）と**入力後の再照会**で、同一項目・番号・配置が揃う場合だけ採用。変化・不明・古い照会はunknownにする。
4. クリックは同じapp Button上でdown/up、キーは有効slotの初回`Win+1〜9／Win+0`。結果の前面化は待たない。W01と二重計上しない。

## 2. 試した方法と失敗から得た判断

| 試行・事象 | 得た知見 | 次に試すこと |
| --- | --- | --- |
| 初期の主タスクバーmouseが候補0 | 物理座標API／per-monitor DPI対応の診断後、主rootと対象矩形が一致し候補1。**どちらが単独原因かは未分離** | 画面スケール差やsecondaryの座標を別々に切り分ける |
| Win長押しが`stale-snapshot` | 毎照会の新process起動から**worker再利用**へ変更し、再試行で750ms以内に取得 | 高負荷時・変動時もfreshnessを観測し、期限を推測で延長しない |
| 並び替え中・overflow | 変化中はunknown、24自作窓追加時のoverflowはARM拒否 | 安定化確認やShell UIA provider差に別方式が必要。番号を推測しない |
| 10番・Win+0 | 自作窓込みの10項目でclick／keyの番号一致 | 通常アプリ10種類、11番以降の有効な案内は未実証 |
| secondaryのtaskbar | 別画面クリックはW12の主タスクバー番号へ帰属させなかった | 別taskbarの番号規則を別途実測する |

**研究での判断**：2026-10-25の限られたWindows環境で**制約付き着手可**。UIA providerはWindows全buildで同じ構造を保証せず、照会間で変化して戻るABAも完全には防げない。UIAのName／タイトル／キー生ログは採取しない。

## 3. 代替案と検証入口

- **候補の新しい取得方法**を試すなら、UIA識別→物理座標→前後照会のうち失敗した層を先に特定する。番号が不明なままWin+数字通知を出す、process名から直接推定する、W01へfallbackする案は採用しない。
- [probe source](../../validation/probes/TaskbarInputProbe.cs)、[実行入口](../../scripts/probes/taskbar-input-probe.mjs)、[初期原本](../../validation/evidence/taskbar-input-20261025-initial.jsonl)・[物理座標診断](../../validation/evidence/taskbar-input-20261025-diagnostics.jsonl)・[worker再利用](../../validation/evidence/taskbar-input-20261025-worker.jsonl)。
- 再実行は`node scripts/probes/taskbar-input-probe.mjs --self-test`。本人の明示同意後のみ`--observe-consented`。通常アプリやpin／配置を変える試験は変更内容を事前に確認する。人工・自作窓の試行を、最終製品の実入力／OS通知／全環境の合格と混同しない。
