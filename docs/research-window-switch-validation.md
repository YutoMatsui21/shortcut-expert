# W01：直接クリック・Alt+Tabによる切替の技術検証（#7）

2026-10-25。対象は[#7](https://github.com/YutoMatsui21/shortcut-expert/issues/7)、取得時updatedAt `2026-10-25T08:05:08Z`、本文SHA-256 `c9914e349d22cf77f6790e1418f349a279ddf90d465ee15400e900f898a8c2da`。

**結論：G-W01は制約付きで基本実装へ着手可。** 本人の明示同意・準備完了後、自作の通常窓A/B/Cで直接clickとAlt+Tabの入力・最終HWNDを照合し、複数Tabの最終1候補、取消・元窓・同窓・program・W12入口・混合入力の非採用を実測した。任意の外部アプリ・Edgeタブ・owner付き窓への一般化は未成立。タスクバー番号対応もunknownで、基本案内はAlt+Tabのみとする。製品検出器・保存・通知・UIは変更せず、#29/#47の製品受入や精度率の合格ではない。

初期Alt+Tabのunknownと、診断版で原因未特定の追加keyによるunknownは原本に保持する。G-W01の判定は「実装のための基本API経路を実測できた」という範囲に限り、通常利用での入力因果・対応範囲を保証しない。

## 一次資料から分かることと仮説

- [EVENT_SYSTEM_FOREGROUND / SWITCHSTART / SWITCHEND](https://learn.microsoft.com/en-us/windows/win32/winauto/event-constants)：foregroundイベントは前面窓の変化。切替UIの終了は補助事象で、入力原因や最終結果の成功を単独では証明しない。
- [SetWinEventHook](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook)：out-of-context配送にはmessage loopが必要。コールバックの再入や入力hookとの到着順を考慮する。今回のprobeは同一WinFormsスレッドで入力hookとWinEventを処理する。
- [GetAncestor](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getancestor)：GA_ROOTとGA_ROOTOWNERは異なる。owner付きpopupを通常窓へ無条件に読み替えない。
- [KBDLLHOOKSTRUCT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-kbdllhookstruct)：LLKHF_INJECTEDで注入を除外する。非注入だから物理操作の意味や因果まで確定するとは解釈しない。

直接クリックは、物理座標のhit test→root HWND→非注入down/up→foregroundイベント→最終pollを照合する仮説。Alt+Tabは、Alt保持中のTab数とAlt解除→短いsettle→最終foregroundを追う。SWITCHENDの有無・順序は診断用。いずれも他プログラムが同時に同じ窓を前面化した場合の因果を証明できない。出力の`mouse`/`key`は研究候補であり`causalAttributionProven=false`を維持する。

## probeの範囲と実行

[C# probe](../validation/probes/WindowSwitchProbe.cs)と[Node入口](../scripts/window-switch-probe.mjs)。Windows x64の.NET Framework cscでsource hashごとのexeをcompileする。通常のuserData、helper、製品IPC、通知は使わない。

```powershell
node scripts/window-switch-probe.mjs --self-test
# 本人の明示同意・準備完了後のみ
node scripts/window-switch-probe.mjs --observe-consented
```

- `--self-test`はcompileと純粋policyのfixtureのみ。hook・窓表示・実入力観測なし。
- liveはpanelと自作A/B/Cの3窓。ARM後4秒以内に開始窓をクリックし、countdown終了時のforegroundがA/B/Cで入力解放済みの場合だけhookを開始する。開始窓がexternal/panelなら拒否する。
- 1試行20秒・1session20分上限。FINISH、panelへの左down、自動期限、終了で解除する。panelのclickは前面化する前に試行を終える。起動時・countdown・試行間にhookはない。
- 対象はownerなし・可視・rootが自身の自作A/B/Cに限定する。外部窓・popup・Edgeタブ等はunknown。実アプリ一般の成立を自作窓の結果から推測しない。
- mouseはdown/upが同じ候補root、1.5秒以内の一致foregroundが必要。keyはAlt解放後300msでpoll、解放から250〜2000ms、Alt開始から15秒以内を仮の期限とする。期限は実測済み最適値ではない。診断版ではcallback時にもforegroundをpollし、イベントHWNDと一致するものだけを現在の結果の裏付けに使う。不一致イベントも原本に残す。settle時pollと最後の裏付け済みforegroundが不一致ならunknown。候補は一度だけfreezeする。settle前のFINISHでは候補を採用せずunknownにする。
- Esc、元の窓、前面窓clickは非採用。追加修飾・注入・他のkey・複合mouse・入力競合・イベント不一致はunknown。Winを含む入力とタスクバーrootのclickはW01から除外するだけで、有効W12番号の成立はこのprobeでは証明しない。
- 試行中に取得するHWND/root/ownerはsession内aliasへ変換。記録は限定したAlt/Tab/Esc/Win・click・foreground・SWITCHSTART/END・pollの到着順、候補分類、Tab数、最終結果までの経過集計だけ。診断版ではcallback時のforeground alias、staleイベント数、API timestampから配送までの遅れの最大値を加える。文字、その他のkey値、scan code、入力時刻列、座標、窓タイトル、URL、process名/パス、画像は保存しない。原本は`.tools/validation/window-switch/trials-*.jsonl`。source/exe hashをsessionへ付ける。

## 手動試験と結果

各ケース原則1回。予想外の結果だけ理由を残して再試行する。Alt+Tabは実際の候補を目視してA/B/Cへ確定する。panelや外部窓が選ばれた試行を成功に置き換えない。

| ケース | 操作と確認点 | 期待 |
| --- | --- | --- |
| 2窓mouse | A開始→背後に見えるBのclientを直接click | 前後aliasと候補Bが一致、mouse候補1件 |
| 2窓key | A開始→Alt+TabでBに確定 | 最終B、key候補1件 |
| 3窓key | A開始→Alt保持で複数Tab→B/Cへ確定 | Tab複数でも最終候補1件 |
| 取消 | Alt+Tab→Esc→Alt解放 | 非採用 |
| 元窓 | Alt保持中にAまで戻って解放 | 非採用 |
| 同窓click | A開始→Aのclientをclick | 非採用 |
| program | 専用scenarioでARMから3秒後にB.Activate、本人の入力なし | unknown、W01候補なし |
| W12 mouse | taskbarのアプリアイコンclick | W01非採用。W12の成立自体は別経路 |
| W12 key | Win+1 | W01非採用。taskbar列挙・有効番号とW12採用は別確認 |
| switcher mouse | Alt+Tab UIをmouse選択 | unknown、W01候補なし |
| external/popup/Edge | 自作窓以外の対象へ切替 | unknown。対応条件・設定確認は別試行で同意を得る |

## 追加案内：タスクバー番号

[MicrosoftのAppUserModelID説明](https://learn.microsoft.com/en-us/windows/win32/shell/appids)では、明示IDは任意で、システムが付けた内部AppUserModelIDは取得できない。window単位のoverrideもあるため、process名一致でtaskbar項目を確定できない。#6のUIA `Appid:`と左からの番号はtaskbar側の観測であり、任意の切替先HWNDとのidentity照合を証明していない。

現段階では**番号対応はunknown、案内はAlt+Tabのみへfallback**する。G-W01の基本ゲートとは独立。#96へはwindow property storeの明示ID、process identityとの優先順位、taskbar UIA identity、前後の配置・期限照合が必要という調査課題を渡す。単一/複数窓、pin、並べ替え、1/10/11番、taskbar非表示対象の実測は未実施。番号を実取得して一致を確証したとの主張はしない。

## 検証環境・原本・失敗例

- Windows x64、OSDescription `Microsoft Windows 10.0.26340`（kernel版表記）、Node `v24.11.1`。.NET Framework64 `v4.0.30319/csc.exe`でcompileした。`dev:check`はwrite/renameとElectron/SDK/helperの存在に成功。availabilityの確認で、製品再buildの結果ではない。画面設定・Edge設定・pin配置は変更していない。
- 初期版`--self-test`：26 fixture checksに成功。直接click、同窓、program foreground、対象不一致、期限切れ、W12入口の除外、Alt+Tab、複数Tab、元窓、Esc、switcher mouse、追加key、external、settle期限、注入、up不一致、Tab単独、repeat、Shell中間foreground、Alt再押下、mouse中のAlt、早期停止、補助button競合。診断版はcallback時の一致、不一致の後着Shellイベント、不一致のtargetイベントを採用しない3件を追加し29件成功。実入力・hookの到達性・Shell仕様の実証ではない。
- `node --check scripts/window-switch-probe.mjs`：成功。
- 専用`codex review`で全3ファイルを確認。初回のP2指摘3件（早期FINISHの証拠検査迂回、確定待ち中のAlt再押下、XBUTTON競合）を修正し、26件の自己検査と静的再レビューを実施。再レビューは重大な追加問題なし。ログは`.tools/validation/window-switch/local-review.txt`と`local-review-followup.txt`。実機検証の代替ではない。
- [初期session原本](../validation/evidence/window-switch-20261025-initial.jsonl)：2完了試行、session-endあり。source hash `67c90b8bf78a559b99a20f53a07b3be3a1f140902aee1dbd9161fedd754ad851`、exe hash `1ce11d6e2dd94d611c2d3af07886adb3f4c5e714fd557410c90cfcca11aa3588`。同一sourceでもcompile環境でexe hashは変わるため実行sessionの値を正本とする。
- 試行1：本人がA→Bを直接click。`armed A → left-down B → foreground B → left-up B → settle-poll B`、mouse候補1件、unknownなし。settledMs 4492はARMからfreezeまでの試行内経過で、click処理のlatencyではない。
- 試行2：本人がAlt+TabでBへ切替。Tab 2回、最終poll B。イベントはAlt解除後にexternal-7→B→external-6の順で到着し、最後のイベントとpollの不一致でunknown。external aliasの窓の種類は取得していないため、Shell窓だと断定しない。SWITCHSTART/ENDはこの2試行には出現しなかった。元ログを訂正せず、callback時の現在foregroundと配送遅れを診断する版でこの予想外のケースを再試行した。
- 診断版は29件のfixture自己検査と変更箇所の専用静的レビューに成功（`.tools/validation/window-switch/local-review-diagnostics.txt`）。source hash `59a02f597559dc0200d6f05fd0778a6c612a53685e1cc101c2bf394555f65933`、実行exe hash `2a43599fc54dca7171ac219c9e3fe9d28cce4310077597764452c42aa33eb253`。[診断版session原本](../validation/evidence/window-switch-20261025-diagnostics.jsonl)は10完了試行、session-endあり。終了要求は起動したexeの絶対パスを照合して通常の窓終了で行った。
- 診断版試行1：A→B、Tab 7回、最終poll Bとcallback時Bが一致。後着external-6はcallback時にはBで、stale 1件、最大callback lag 16ms。ただし`unsupported-or-competing-key`でunknown。本人は他のkeyを押していないと思うと申告。任意key値は記録していないため、keyの種類や発生原因は特定できない。本人の誤操作ともprobeの誤判定とも断定しない。
- 本人が「もう一度だけ」を希望した診断版試行2：A→B、Tabの初回down 11回（保持中repeatは別計上しない）、key候補1件、`alt-release-and-final-window`。callback時Bと最終poll Bが一致、後着external-6はstale 1件、最大callback lag 0ms。本人は指定操作以外何もしていないと申告。成功したため同ケースは追加反復しない。Alt+Tab任意対象への単押し到達や通常利用全般の精度の証拠にはしない。
- 診断版の残る試行は下表。各ケース1回で、成功ケースの反復なし。初期2試行＋診断版10試行の合計12試行には再試行2件を含み、独立12ケースや精度の標本数とは扱わない。

| 診断版index | ケース | 実測結果 | 評価・制限 |
| --- | --- | --- | --- |
| 3 | 3窓・複数Tab | A→C、Tab 8回、key候補1件 | callback現在Cと最終poll Cが一致、stale 1、最大lag 15ms |
| 4 | Esc取消 | A→A、`excluded/cancelled` | W01候補0 |
| 5 | 元窓へ戻る | A→A、Tab 6回、`excluded/same-window` | W01候補0 |
| 6 | 前面窓click | A→A、`excluded/same-window` | W01候補0 |
| 7 | program前面化 | 入力事象なし、A→B、`unknown/stopped-before-settle` | W01候補0。入力なしではsettleを開始しない。Finish時のreasonが元の`foreground-without-input`を上書きする診断上の制限があるが、原本イベントに入力なしのB前面化が残る |
| 8 | taskbarアイコンclick | A→external、`excluded/taskbar-input-w12-only` | W01候補0。taskbar rootで除外。アイコン名・番号は採取していない |
| 9 | Win+1 | Win down/up、A→external、`unknown/stopped-before-settle` | W01候補0。Win入力ではAlt/mouseのsettleを開始しないため、Finishでunknown。有効slotの照会・W12製品採用はこのprobeの対象外 |
| 10 | Alt+Tab UIのmouse選択 | A→B、`unknown/competing-input` | W01候補0。mouseとの混合を除外 |

「2窓」は切替の前後対象がA/Bという意味で、sessionには常に自作3窓とpanelが存在した。本人の既存アプリもAlt+Tab候補にあり、B/Cまで複数Tabを要した。候補数を2/3に制限した専用desktopやMRUの再現は行っていない。SWITCHSTART/ENDは全12試行に出現せず、この環境では必須の成功根拠に使えない。

## #29へ進む条件と未確認事項

1. **基本API経路に限る着手PASS**。直接clickのhit root・同窓down/up・foregroundとpoll、およびAlt保持/Tab/解除・最終foregroundを型付き証拠で結ぶ。研究候補をそのまま記録・通知しない。製品は試行panelや自作窓リストに依存しない有界な状態機械を設ける。300ms/1.5秒等は仮の期限で、製品採用時に取りこぼし・遅延・競合を検証する。
2. **過去のforegroundイベントで現在の結果を上書きしない**。callback時の現在foregroundと照合し、最終pollでも同じ対象を確認する。SWITCHENDの有無やイベント単独、時間の近接だけでは採用しない。実測した後着イベントと不明入力によるunknownを回帰条件に含める。
3. **W12由来をW01から除外する**。今回のtaskbar click/Win+1でW01候補0は確認したが、W12本体と同時稼働させた統合の「W12のみ1件・二重計上0」は未検証。#29で#28の実経路と統合し、taskbar/Win入力によるforegroundだけをW01へ流さない。Winが押されたというだけで有効番号のW12成立を主張しない。
4. **未対応の窓や入力はunknown**。自作窓の結果をChrome/Edge等へ一般化しない。今回の対象はownerなし・可視・GA_ROOTが自身のWinForms通常窓。child clickはrootへ正規化するが、owner付きpopup、独自窓、EdgeのAlt+Tabタブ表示設定を実機で調べたわけではない。研究probeはA/B/C以外を非採用にする。製品は代表アプリで通常窓の識別・Edgeタブ混在時の除外を実測してから対応範囲を広げる。
5. **入力因果の限界を保持する**。今回のprogram前面化単独は非採用。同時に別プログラムが同じ候補を前面化する場合の因果は未証明で、`causalAttributionProven=false`を維持する。競合を観測できればunknownにし、検出不能な競合を通常利用でどう扱えるかは#29/#47で評価する。
6. **番号対応は基本ゲートから独立**。明示AppIDの実読取・任意HWNDとのtaskbar identity照合、単一/複数窓・pin・並べ替え・1/10/11番・taskbar非表示対象は未実測。一般的な番号対応は成立済みとせずunknown、Alt+Tabのみへfallbackする。#96はこの対応が確証できたケースだけWin+数字を追加し、同一個別窓への到達を保証しない。
7. **製品受入は別**。通常環境、保存・3状態・pause/stop・通知・UI、R02/J04、最終buildの#47は未実施。単発の本人操作は自然入力の機能確認で、95%精度・誤通知率・全Windows buildの保証ではない。
