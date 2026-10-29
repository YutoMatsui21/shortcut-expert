# Issue #4：Task View表示の調査と限定probe

> 2026-10-27：W08（Win+Z）・W10（Win+Tab）は初回8操作の対象外。関連学習候補にも含めない。本書は対象変更前の実装・調査・証拠として保持する。現行の対象は[確定要件](../../ui-requirements.md)を参照。


2026-10-22。対象は [Issue #4](https://github.com/YutoMatsui21/shortcut-expert/issues/4) のB03/A03。製品検出器の実装ではない。本体の閉→開→閉、mouse/key由来、負例での誤判定0は**未実証**。Issueは未完了。

## 今回確認した範囲

初回調査時のmainのHEADは `e42ff72`。既存ソース・ローカル調査artifactと、Issue #4・#14・#49を読み取った。その後origin/mainを取得し、`844c8df` を基準に `codex/issue-4` で調査専用probeを追加した。製品コードは変更していない。

ユーザーは同日に実入力/UIA/キー送出とcommit/push/PRの別途承認制約を解除し、最後まで進めるよう指示した。Issue本文にある旧承認条件を未承認の根拠として扱わない。Computer Useの初回取得は `Computer Use app approval timed out` で不成功となったが、本人の再試行許可後にexplorerへのアクセスを確認できた。sandboxでは対象root0、同意済みのユーザーデスクトップでの実行ではroot5を取得した。両環境の結果をTask Viewの表示有無として比較しない。キー自動送出・Shell再起動・入力由来の自動測定は行っていない。

Specは `node scripts/dev/github-workflow.mjs issue 14 --repo=YutoMatsui21/shortcut-expert` で検証したcacheを使用した。updatedAtは `2026-10-18T12:50:27Z`、本文SHA-256は `bdb040c9d2311e2f49bd547b46f01ab842f9c86397efa9435106b1983bcc7f89`。§6 A03と§12 B03を参照。旧Specの14操作という総数を現行の12操作要件へ転用しない。

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

## 探索方針

ユーザーの作業承認は受領済み。Computer Useのアプリ承認は再試行で解消した。UI操作とsnapshot取得の時差を考慮し、手動で開いたという回答だけで取得時の表示状態を確定しない。

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

本体provider/selectorの特定、実入力由来との照合、全負例・別画面・Shell再起動の検証が残る。B03とIssue #4はOPENを維持し、後続Issueのblocked/readyラベルは変更しない。

## 再現入口と実施結果

`validation/probes/TaskViewProviderProbe.cs` と `scripts/probes/task-view-probe.mjs` は製品から呼ばれない。Windows標準.NET Frameworkのcscで毎回コンパイルし、workerを別プロセスで実行する。

```powershell
# 実機アクセスなし。今回実施してPASS。
node scripts/probes/task-view-probe.mjs

# 実機アクセスあり。本人の同意があるデスクトップで実行する。
node scripts/probes/task-view-probe.mjs --snapshot

# Desktop直下のShell host候補を列挙する。内部ツリーは探索しない。
node scripts/probes/task-view-probe.mjs --discover-hosts

# 主画面中央の一点から親だけを最大9要素たどる。
node scripts/probes/task-view-probe.mjs --point-host

# 実入力観測なしのself-test後、3方式を60秒間交互に実行する。
# 別途案内された本人の手動操作中に実施する。
node scripts/probes/task-view-sample.mjs --seconds=60
```

実施済みの出力は `TASK_VIEW_PROBE_SELF_TEST_OK (no live observation)`。self-testは入口buttonと本体仮説の分離、候補0・不完全な観測をunknownにする境界を確認する。OS上の表示検出や入力精度の試験ではない。`npm.cmd run dev:check` は依存部品の存在とSDK 10.0.401の解決を確認しただけで、製品受入ではない。

snapshotはexplorer所有の既知5クラスのtop-level窓だけを対象に、最大24root、rootごと256node・深さ8までRawViewを読む。異なるprocessのnodeは探索せず不完全な観測とする。未対象rootは除外件数だけを残す。host-discoveryはDesktop直下の最大128要素のPIDを一時照合し、explorer/ShellHost/ShellExperienceHost/StartMenuExperienceHost/ApplicationFrameHostだけのhost名・class・offscreenを残す。他アプリの内容・任意host内部・自動入力は探索/実装しない。許可classと仮説roleは研究用で、安定selectorの根拠ではない。

Name/titleは読まず、AutomationIdは一時的に固定roleへ分類し原文を出さない。保存するのはcontrolType、既知hostClass、固定role、tree内index/深さ、offscreen、失敗/打切りの集約。出力は `.tools/validation/task-view/` に隔離する。子processは15秒で打ち切り、途中出力を保存してcompleted=falseとする。完走してもsnapshot全体のverdictはunknown、selectorVerified/originMeasuredはfalseのままである。

OS版は [RtlGetVersion](https://learn.microsoft.com/en-us/windows/win32/devnotes/rtlgetversion) で取得する。[EnumWindows](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumwindows) と [GetClassName](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getclassnamew) の失敗を意図的除外と分ける。深さ/node上限の確認後にのみ子・兄弟を要求する。最大深さに達した場合は追加照会をせず保守的に打切りとする。

## 今回の新しい実機証拠

| artifact（`.tools/validation/task-view/` 以下） | 条件 / 結果 |
| --- | --- |
| `snapshot-1792663325332.jsonl` | sandbox側。root0・除外0。本体不在の証拠にはしない |
| `snapshot-1792663392556.jsonl` | ユーザーデスクトップの基準snapshot。root5、入口button2、本体仮説0、読取失敗/上限到達0 |
| `snapshot-1792663473657.jsonl` | 本人の「Win+Tabで開いた」回答後。root3、すべて不可視、入口/本体仮説0。取得時の実表示は未照合であり、開状態の正解ラベルではない |
| `snapshot-1792663602311.jsonl` | Desktop直下host-discovery。直下11要素、対象Shell host4（すべてexplorer）、他host7を除外、読取失敗0。本体host未特定 |
| `snapshot-1792663665221.jsonl` | OS取得修正後。実build **26340**、root5、本体仮説0、cross-process除外/読取失敗/上限到達0 |

最初の2つのユーザーデスクトップsnapshotのosBuild=9200は、manifestなし.NET Frameworkの互換版表示だったため環境比較に使わない。修正後のRtlGetVersionによるbuild26340と、過去記録のbuild26300を区別する。新しいroot5の取得もTask View本体の取得成功ではない。

PR #78の初回CIは成功。初回Codexレビューの6指摘（OS版、探索前の上限確認、cross-process不完全扱い、EnumWindows失敗、offscreen単一読取、GetClassName失敗）をコードと照合して修正した。修正後self-testには列挙失敗・root0・読取失敗・上限・不完全treeをcompletedにしない負例を含む。実機由来の精度を保証するテストではない。

## 150秒の本人操作中サンプリング（追加調査）

2026-10-22、本人の「準備できた」を受け、60秒・60秒・30秒の3回を実施した。最初の2回はWin+Tab→10秒維持→Esc、Task Viewボタン→10秒維持→Escを依頼し、両方の表示・解除を本人が確認した。最後の30秒はWin+Tabによる表示・解除を依頼し、本人が実施を確認した。自動キー送出は使っていない。

結果の正本は [匿名化した試行集約](../../../validation/evidence/task-view-summary-20261022.json)。ローカルJSONLのSHA-256と当時のsource/exe hashを含む。個々のsnapshotに手動ラベルを貼っておらず、本人の回答は各session全体の目視oracleである。採取ごとの表示時刻・開閉時刻・入力由来は測定していない。

当時の3版のソースを `validation/evidence/task-view-sources/<sourceSha256>.cs.txt` に保存した。中間版は前後のcommit差分から復元し、採取時に記録したSHA-256との完全一致を確認した。改行も含めて保持するため、このディレクトリの`.cs.txt`だけGitのtext変換を無効にしている。これらは過去の挙動を監査するための不活性な資料であり、最新の実行入口からコンパイルしない。生入力・窓名等の観測内容を含むソースではない。

`node scripts/probes/verify-task-view-evidence.mjs` で、3採取の記録済みsource hashと保存したsource bytesの一致を実機観測なしで確認できる。これはソース同一性の確認であり、exeとの対応や採取結果の正しさの証明ではない。

| session（`.tools/validation/task-view/` 以下） | 秒 / 採取数 | 探索完了 / 不完全 | 結果 |
| --- | --- | --- | --- |
| `sampling-1792665092630.jsonl` | 60 / 22 | 21 / 1 | snapshotとDesktop直下探索。本体仮説0。最後のworkerは総時間上限で打切り |
| `sampling-1792665337090.jsonl` | 60 / 29 | 18 / 11 | 上記に中央一点の親探索を追加。本体仮説0。親探索10件はすべてShell対象外9要素で上限到達。最後のsnapshotは時間上限で打切り |
| `sampling-1792665519624.jsonl` | 30 / 14 | 8 / 6 | 親探索の対象外プロセスがSystem32/SystemApps由来かを一時照合。本体仮説0。親探索5件はすべて9要素で上限到達し、システムhost候補はunidentified。最後のsnapshotは時間上限で打切り |

合計65採取、本体仮説0。worker正常終了は62件だが、親探索15件は対象外/上限到達で不完全であり、正常終了を探索完了へ読み替えない。時間上限の3件は実providerの15秒timeoutを証明するものではない。

### 中央一点の親探索の範囲

[AutomationElement.FromPoint](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.frompoint) は物理画面座標を受け取るため、worker内でthreadのDPI contextをPerMonitorV2へ変更して主画面中央を求め、終了時に復元する。cursor位置・画像は使わない。主画面だけの診断であり、別画面の受入試験ではない。

中央の要素からRawViewの親を最大9要素たどる。PIDを一時照合し、従来の5種Shell hostだけのclass/controlType/固定role/offscreenを保存する。対象外の親は除外markerのみとし、Name/AutomationId/ClassNameは読まない。対象外processの実行元pathは一時照合だけに使い、保存するのは固定カテゴリ `windows-system32` / `windows-systemapps` / `outside-system-directories` / `metadata-unavailable` のみ。発見した実行ファイル名は保存しない。これは配置場所の確認であり、署名検証・Shell認定ではない。self-testはSystem32/SystemAppsの分類と、類似prefix・`..`でディレクトリを出る負例を確認する。

3回目の採取時の中間版はSystem32/SystemApps配下のprocess名を返す実装だったが、今回の全45件の出力は `unidentified` であり、発見したprocess名は記録されていない。この旧値は両ディレクトリの外、またはmetadata取得不能を含むため、非Windowsプロセスとの断定には使わない。レビュー後の実行版は上記の固定カテゴリへ変更し、過去の採取結果を書き換えていない。

対象外の親を通過しているため、閉→開→閉を識別できるtreeの完全取得は主張しない。除外・上限到達・読取失敗はunknownのまま。サンプリングはこれら3方式を交互に実行し、workerごと最大15秒かつ残り総時間までに制限する。samplingファイルの完走は、各snapshotの完了や検出成功を意味しない。

### 判定と次の技術課題

本人の自然操作でTask Viewが表示・解除されたことは確認できたが、既知root/限定host/中央一点の親探索では本体provider・selectorへ到達しなかった。Task Viewボタンの存在やtaskbar rootの増減は本体表示判定へ採用しない。自然入力の各20回・95%以上、誤判定0、toggle/cancel/別画面/Shell再起動、入力由来の自動照合は未検証であり、**B03とIssue #4はOPENを維持する**。

今回の限定UIA経路では成立を実証できなかった。未探索のhost/providerやMSAA等の別経路の有無は未確定であり、Task Viewの検出が一般に不可能との結論ではない。次段階では候補host/アクセス経路を別に特定する必要がある。同じ限定probeで本人の操作回数だけを増やしても、このselector欠落は解消しないため追加の自然操作は依頼していない。
