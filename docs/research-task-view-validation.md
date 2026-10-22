# Issue #4：Task View表示の調査と限定probe

2026-10-22。対象は [Issue #4](https://github.com/YutoMatsui21/shortcut-expert/issues/4) のB03/A03。製品検出器の実装ではない。本体の閉→開→閉、mouse/key由来、負例での誤判定0は**未実証**。Issueは未完了。

## 今回確認した範囲

初回調査時のmainのHEADは `e42ff72`。既存ソース・ローカル調査artifactと、Issue #4・#14・#49を読み取った。その後origin/mainを取得し、`844c8df` を基準に `codex/issue-4` で調査専用probeを追加した。製品コードは変更していない。

ユーザーは同日に実入力/UIA/キー送出とcommit/push/PRの別途承認制約を解除し、最後まで進めるよう指示した。Issue本文にある旧承認条件を未承認の根拠として扱わない。ただし、Computer Useでexplorer.exeの状態を取得しようとした呼出しは `Computer Use app approval timed out` で不成功となった。これはproviderの不応答・Task View本体の不在を示す証拠ではない。アプリ承認経路を別手段で迂回せず、実機観測を保留している。キー送出・Shell再起動・自然入力試験は行っていない。

Specは `node scripts/github-workflow.mjs issue 14 --repo=YutoMatsui21/shortcut-expert` で検証したcacheを使用した。updatedAtは `2026-10-18T12:50:27Z`、本文SHA-256は `bdb040c9d2311e2f49bd547b46f01ab842f9c86397efa9435106b1983bcc7f89`。§6 A03と§12 B03を参照。旧Specの14操作という総数を現行の12操作要件へ転用しない。

## 過去の失敗証拠の再確認

以下は今回の実機試験ではなく、既存JSONLの内容を再集計した結果。

| ローカルsession / sequence | ラベル | 記録された結果 |
| --- | --- | --- |
| `.tools/validation/shell-blockers/20261017-123340-843` / 4 | `taskview-key` | `shellRead=completed`、`shellRoots=[]`、`originMeasured=false` |
| `.tools/validation/shell-blockers/20261017-152728-511` / 2 | `taskview-key` | `strategy=desktop-direct-children-shell-pid-raw-view`、候補2・適格0・除外2、`shellRoots=[]`、`rootFailures=0`、`rootLimitReached=false`、`originMeasured=false` |

後者のsession metadataはOS build 26300、`desktopShellRoots=true`、`inputHooks=false`、`keysSent=false`、`shellUIAOnly=true`。これは当時の環境であり、今回のhostの確認結果ではない。

候補の除外理由やTask Viewの実際のhostは上記の要約から確定できない。例外なし・読取完了・button候補の取得を本体表示の成功へ読み替えない。手動ラベルは実測した入力由来ではない。

## Probeの再利用条件

現チェックアウトの `validation/probes/` にShellOperationProbeのソースはなく、既存実行ファイルだけが `.tools/validation/shell-blockers/` にある。Issueが参照する基準commit `fb3329f13b1eccfb3d6c020c11e4ee0ce67c1171` にも `validation/probes/ShellOperationProbe.cs` は存在しなかった。現在のローカル履歴で同パスの変更履歴も見つからなかった。ソースの所在・取得設定の限界を含む結果であり、過去にソースが存在しなかったとの断定ではない。

| ファイル | 今回計算したSHA-256 |
| --- | --- |
| ShellOperationProbe.exe | `369FA74676D19F81EF3A48AD123E287214FCE3B5F1C32CE457BEA3F7DF858C3F` |
| ShellOperationProbeV2.exe | `7B2CFA37BCB8B8BEF4C5874B8354F48CB6C9578ABDF9EC714BA4E1B56A0B676A` |
| ShellOperationProbeDesktop.exe | `90B31FA24AC892B59B27DBC560DF183518EC69785F27CB64D1DB6F249FFFAB69` |

hashは動作・安全性・ソース対応の証明ではない。過去の承認やself-testを今回の実行許可として流用しない。実行前にソースを回収するか、探索範囲・保存項目・終了処理を確認できる調査専用probeを用意する。

## 承認後の実施案

ユーザーの作業承認は受領済み。残る実行上の制約はComputer Useのアプリ承認であり、ユーザーへ承認画面の操作を依頼している。

1. 対象hostを明示し、まずexplorer所有の既知Shell rootに限定する。対象外hostが必要になったら、候補と必要性を提示して再承認を得る。デスクトップ全体の無制限なUIA descendants探索をしない。
2. プロセス別worker、全体timeout、root数・深さ・node数の上限と、読取失敗・除外理由・打切りを設ける。timeout・provider不応答・上限到達はclosedではなくunknownとする。
3. Name、窓タイトル、文字、URL、パス、画像、任意AutomationId、入力時刻列、生入力を保存・送信しない。selector照合に必要な値は一時利用し、結果は事前定義したroleと試行単位の集約だけにする。
4. 本体selectorが未知の間は、候補snapshotと本人の目視回答を比較する段階に留める。buttonやWin+Tabだけでopenを立てない。開閉の連続観測、表示結果と入力の一時照合が成立するまで自然入力検出済みとはしない。
5. hookが必要なら対象経路だけをメモリ上で照合し、保存は試行の由来・注入有無・集約結果に限定する。手動ラベルと実測値を分け、失敗・競合・期限超過はunknown。probe終了時にはhookを解除する。

## 必要な試験と判定

| 条件 | 必要な証拠 |
| --- | --- |
| Task View buttonの自然click | 本体closed→open→closed、実測mouse由来、一意な本体selector |
| 自然Win+Tab | 同じ本体と遷移、実測key由来、注入入力との区別 |
| 既表示でtoggle / Escape解除 | open→closedを新規表示として数えない |
| 表示前cancel / 競合入力 | 本体が出なければ成功0、対応が不明ならunknown |
| button非表示 / 別画面 | button不在を本体closedと混同せず、monitor対応と適用限界を示す |
| Shell再起動 | 別途実施範囲を確認し、古いPID/root/cacheを失効させる。復旧途中を表示成功としない |

まずprovider成立性を確認し、成立後に正例・負例を試行する。認識率の受入はSpecのA00/R02（両自然入力各20回以上・95%以上、負例の誤記録/誤通知0）と区別して記録する。snapshotの成功だけではこの受入を満たさない。

## 残作業

ツール側のアプリ承認、現host/build確認、本体provider/selectorの特定、実入力由来との照合、全負例・別画面・Shell再起動の検証が残る。B03とIssue #4はOPENを維持し、後続Issueのblocked/readyラベルは変更しない。

## 再現入口と実施結果

`validation/probes/TaskViewProviderProbe.cs` と `scripts/task-view-probe.mjs` は製品から呼ばれない。Windows標準.NET Frameworkのcscで毎回コンパイルし、workerを別プロセスで実行する。

```powershell
# 実機アクセスなし。今回実施してPASS。
node scripts/task-view-probe.mjs

# 実機アクセスあり。ツール側アプリ承認の解消後に実施する。今回は未実施。
node scripts/task-view-probe.mjs --snapshot
```

実施済みの出力は `TASK_VIEW_PROBE_SELF_TEST_OK (no live observation)`。self-testは入口buttonと本体仮説の分離、候補0・不完全な観測をunknownにする境界を確認する。OS上の表示検出や入力精度の試験ではない。`npm.cmd run dev:check` は依存部品の存在とSDK 10.0.401の解決を確認しただけで、製品受入ではない。

snapshotはexplorer所有の既知5クラスのtop-level窓だけを対象に、最大24root、rootごと256node・深さ8までRawViewを読む。異なるprocessのnodeは探索しない。未対象rootは除外件数だけを残す。任意host探索や自動入力は実装していない。許可classと仮説roleは研究用で、安定selectorの根拠ではない。

Name/titleは読まず、AutomationIdは一時的に固定roleへ分類し原文を出さない。保存するのはcontrolType、既知hostClass、固定role、tree内index/深さ、offscreen、失敗/打切りの集約。出力は `.tools/validation/task-view/` に隔離する。子processは15秒で打ち切り、途中出力を保存してcompleted=falseとする。完走してもsnapshot全体のverdictはunknown、selectorVerified/originMeasuredはfalseのままである。
