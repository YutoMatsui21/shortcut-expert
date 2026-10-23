# Snap Layout呼び出しの推定検証（Issue #83）

## 範囲

製品の検出器・保存・通知は変更しない。Win+Z／最大化ボタンの継続ホバーから呼び出し操作を推定する独立probeである。表示成功の直接検出や、#5／#34の成立条件の変更は行わない。[APIの保証範囲と一次資料](research-snap-invocation-api.md)。

## 実行と試行の記録

`--query-self-test`は自分の別processのmessage-only窓でtimeoutを発生させ、実入力なしで失敗処理を検証する。`--geometry-self-test`は自分の隔離窓だけを短時間表示し、ボタン矩形内の9点とhit testを比較する診断で、実入力は観測しない。実操作を観測するのは`--observe-consented`だけである。

```powershell
node scripts/snap-invocation-probe.mjs --self-test
node scripts/snap-invocation-probe.mjs --query-self-test
node scripts/snap-invocation-probe.mjs --geometry-self-test
node scripts/snap-invocation-probe.mjs --observe-consented
```

後者は本人の明示的な許可と画面確認が必要。起動だけでは観測しない。2窓の可視表示を本人が確認してから、panelでケース・対象アプリ・active/inactive・候補閾値を選び、ARMを押す。対象を操作した後、実際のSnap Layout表示を`displayed`／`not-displayed`／`unknown`で選び、FINISHで試行単位の集約を保存する。各試行は60秒で自動停止する。時間切れ・取消・表示不明は精度の分母に加えない。panelを閉じると終了し、runnerの上限は20分。継続する場合は新しいsessionを開始する。

ARM前にWinとZを離す。FINISHまでの操作は原則1回とし、押し続け・退出再入場の試行だけは期待する回数を別途記録する。panelへ戻る途中に最大化ボタンを横切らない。対象アプリ選択は本人の期待ラベルであり、観測対象をそのアプリだけに制限するスイッチではない。

出力先はGit対象外の`.tools/validation/snap-invocation/trials-*.jsonl`。source/exeのSHA-256、Windows build、session番号、設定候補、試行ラベル、表示oracle、候補数、試行内だけの対象ID・カテゴリ、問い合わせ成功の集約を残す。現行runnerはcompile対象のsource snapshotも同じ出力先に保存する。文字、任意のキー列、入力時刻列、座標、窓タイトル、ファイルパス、他アプリ画像は保存しない。製品userDataは使わない。入力hookはARMからFINISHまでで、Win/Z以外のキーは保持しない。

### 判定と限界

- Win+Zは左右Win・Zのdown/up状態を内部管理し、Zのkeyupまで重複採用しない。注入flag付き入力は対象外。hookでは対象foregroundのrootを採取し、問い合わせはtimer側で行う。登録成功はhookの全期間健全性の証明ではない。
- foreground非NULLだけでは採用しない。desktop/Shell handle、既知のdesktop／taskbar class、probe panelを除き、可視・非最小化・top-level・最大化ボタンと可変枠のstyleを候補条件にする。Explorer process全体は除外しない。このstyle条件はSnap対応保証ではない。
- ホバーは50ms timerでカーソル直下のrootを調べ、後述の最終API選択で同じ対象の最大化領域が500ms以上続けば1候補。閾値はOS内部の表示時間ではなく、呼び出し推定の観測上の定義。同じ継続滞在では再計上せず、確認できた退出・対象変更で再入場を受け付ける。200ms超の観測空白は未計上の滞在時間をリセットし、既に計上した滞在は空白だけでは再計上しない。ポーリング間に完結した退出・再入場は分離しない。
- 初期版では`WM_NCHITTEST`だけを候補根拠としたが、追加調査で誤分類が再現したため撤回した。最終版は有効な`TITLEBARINFOEX`矩形を優先し、成功応答で全ボタン矩形が空の場合だけhit testへ進む。取得失敗や部分的・範囲外・重なった矩形をfallbackの理由にはしない。外部queryは各30ms、同queueの自作窓ではこの期限が適用されない。
- probe本体は設定を読むだけ。欠落時の実験では別途本人の明示許可を得て、`EnableSnapAssistFlyout`という1値の型・値だけをbackup、一時削除、復元した。欠落をON扱いしない。`rawKeyCandidates`／`rawHoverCandidates`は設定除外前の数。初期版の`settingGatedVerdict`はunknownのまま残し、最終版では`experimentalGatedKeyCandidates`／`experimentalGatedHoverCandidates`へ既知ON・既知OFF・unknownを分けた結果を出す。unknownはnullで、既知0と区別する。
- 本人の期待アプリと対象カテゴリ・対象数を照合し、期待と異なる対象は正答にしない。試行内対象IDはsessionをまたいだ窓追跡に使わない。非アクティブ試行では候補時のforeground一致数も確認する。

## 必須8ケース

| ケース | Windows設定と操作 | 仮説上の推定 | 実表示・設定値・実測結果 |
| --- | --- | --- | --- |
| 1 | Snap ON、通常アプリでWin+Z | 記録 | 表示あり、key候補1。A trial 1 |
| 2 | Snap ON、デスクトップにfocusしてWin+Z | 除外 | 表示なし、key候補0、desktop除外1。B trial 1 |
| 3 | Snap全体OFF、通常アプリでWin+Z | 除外 | 表示なし、key候補1。SPI=false、arrangement="0"。B trial 4 |
| 4 | Snap ON、hover表示OFF、通常アプリでWin+Z | 記録 | 表示あり、key候補1。SPI=true、arrangement="1"、flyout=0。B trial 6 |
| 5 | 両設定ON、最大化ボタンの閾値以上hover | 記録 | 表示あり、hover候補1、非アクティブ窓。B trial 2（ケース番号の訂正あり） |
| 6 | 両設定ON、最大化ボタンの閾値未満hover | 除外 | 表示なし、hover候補0。B trial 3（目視結果の訂正あり） |
| 7 | Snap全体OFF、最大化ボタンhover | 除外 | 表示なし、hover候補1。SPI=false、arrangement="0"。B trial 5 |
| 8 | Snap ON、hover表示OFF、最大化ボタンhover | 除外 | 表示なし、hover候補1。SPI=true、arrangement="1"、flyout=0。B trial 7 |

A=`trials-1792750663856.jsonl`、B=`trials-1792750819748.jsonl`。表の候補数は**設定除外前の実測**。ケース3/7/8は入力／hit testだけなら余計に数える。表の仮説列を実装済みの出力として扱わない。

B trial 2の保存scenarioは2だが、本人が実施した操作はケース5と回答し、hover候補1・key候補0・対象standard-fixture・候補時foreground不一致を確認した。B trial 3の保存displayOracleはdisplayedだが、本人が追って「表示されなかった（選択欄を変更し忘れた）」と訂正した。元のJSONLは変更せず、本表で訂正を明示する。原因となった目視選択欄の保持は、現行ソースでARM時にunknownへ戻すよう修正した。

標準captionとChromeで比較する。追加で非アクティブ窓、最小化／閉じる等の別ボタン、継続滞在、Win+Zキーリピート、退出再入場、閾値の短／境界／長を検証する。Snap設定を変える段階では本人へ内容を示し、元の設定を記録して復元する。

## 実施状況

2026-10-23：self-testの純粋状態機械16assertionとrunnerの構文確認は成功。ホバーの閾値未満／一致、重複抑止、退出再入場、対象変更、左右Win、Zリピート、注入modifierの除外を人工状態列で確認した。これは自然入力精度の証拠ではない。

最初のsandboxアカウント起動ではready応答があったが、本人には2窓が見えなかった。試行は保存されておらず、この起動を実機表示・入力観測の証拠に採用しない。本人アカウントで再起動すると2窓を確認できた。

本人アカウントでの最初の試行（`trials-1792750484774.jsonl` trial 1）は表示oracleがdisplayed、Win+Z候補0。診断不足で原因は未特定。この失敗を成功へ置換しない。hook callback数・Win/Z事象数、対象除外のカテゴリ、cursor query失敗数・poll数を追加した版で再採取している。診断追加だけで最初の原因が解消したとは断定しない。

診断版のWin+Z試行（`trials-1792750663856.jsonl` trial 1）はdisplayed、候補1、対象standard-fixture、候補時foreground一致1、Win事象4／Z事象2、問い合わせ失敗0だった。desktop試行（`trials-1792750819748.jsonl` trial 1）はnot-displayed、候補0、desktop除外1、Win/Z事象各2。Windows buildは26340。設定値はSPI成功・window arranging=true・WindowArrangementActive="1"・EnableSnapAssistFlyout欠落。欠落をhover ONの根拠にしない。

標準captionの8ケースは上表の通り。本人がWindows設定UIでSnap全体ON→OFF→ON、hover表示ON→OFF→ONを操作し、復元完了を回答した。設定変更はprobeから行っていない。Win+Zはhover表示OFFでも表示、Snap全体OFFでは非表示だった。hoverはどちらのOFFでも非表示だった。

非アクティブ標準窓の長いhoverではhit一致68sample、TITLEBARINFOEXの最大化矩形一致67sample、各問い合わせ失敗0、hover候補1だった。継続滞在の重複はなかった。短いhoverはhit一致1sample、矩形一致3sample、候補0。500msは今回の候補閾値であり、実OSの表示閾値を測定して決定したものではない。各滞在時間は本人への操作指示による長短の区分で、正確な自然入力時間を保存・計測した証拠ではない。

### Chrome比較・境界

比較アプリはChrome 155.0.8059.85。下表はBの続き。Win+Zではhook callback時のforeground rootを対象にしており、timer側の計上時にはShellの表示へforegroundが移る場合があった。`foregroundAtCount=0`をWin+Z開始時に対象が非アクティブだった証拠に使わない。

| 試行 | 本人が行った操作・表示 | probeの結果 | 評価 |
| --- | --- | --- | --- |
| B trial 8 | ChromeでWin+Zを約2秒押し続け、表示あり | key候補1、対象chrome。Z事象78、追加down76を非採用 | キーリピートで重複しないことを1試行で確認 |
| B trial 9 | 非アクティブChromeの最大化ボタンへ約2秒hover、退出後再入場。2回とも表示あり | hover候補2、対象chrome、foreground一致0。hit一致60sample、最大化矩形一致0、問い合わせ失敗0 | 継続中1回、退出再入場で2回。Chromeでは矩形取得を根拠にできない |
| B trial 10 | Chromeの最小化ボタンへ約2秒hover、表示なし | 両候補0。ただしhit／矩形query失敗が各2回 | 保存scenarioは6だが、別ボタンの試行と本人が確認。取得失敗を含むため安定した負例成功とは扱わない |

設定復元後のB trial 8〜10はSPI=true、arrangement="1"、flyout=1。開始前後の設定値は同じだった。最後に本人がpanelを閉じ、runnerの`SNAP_INVOCATION_CLOSED`と正常終了を確認した。入力観測は終了している。

### 精度と未達項目

診断版の正のWin+Zは標準窓2試行とChrome押し続け1試行で、それぞれ対象一致の候補1。正のホバーは標準窓1試行で候補1、Chromeの再入場1試行で期待する候補2だった。これらは少数の指示付き自然入力で、各入口20回以上の精度評価ではない。Chrome再入場の2候補も独立した20試行の代用にはしない。最初の診断前のWin+Z候補0を含め、異なるprobe版の件数を合算して精度を主張しない。

診断版の設定除外前の負例はdesktop・短いhoverが候補0、Snap全体OFFのWin+Z／hoverとhover表示OFFのhoverは各候補1。別ボタンは候補0だが取得失敗あり。したがって**生の入力／hit testだけを使う方式は負例の誤記録0を満たさない**。設定による自動除外はprobeに実装しておらず、全試行の`settingGatedVerdict`はunknownのまま保存した。表の設定対応から導く評価を自動分類の合格へ読み替えない。

閾値500msの短長区分・継続重複・退出再入場は今回の操作で対応したが、境界付近の時刻付き実測はない。poll間の退出、timer停止、別modifier付きWin+Z、管理者窓、独自captionの網羅性、問い合わせによる表示遅延等の副作用を未評価。問い合わせ失敗時はunknownとして次の審査に持ち越す。各自然入力20回以上・95%以上、負例20回以上・誤記録0はいずれも**未達（未評価）**。

### 証拠の固定

原本は`.tools/validation/snap-invocation/`に保持し、後日の訂正は上表で明示して原本へ上書きしていない。

| 原本 | SHA-256 |
| --- | --- |
| 診断前 `trials-1792750484774.jsonl` | `faa1a42ae3c6ec7c01c1af8915a9bef2c3ed6044013670cd0198df107de02817` |
| A `trials-1792750663856.jsonl` | `afcd42a0557da681291dbed1630c0d53129025a59a674c094c0977a7f68c3cc2` |
| B `trials-1792750819748.jsonl` | `da258581a8f8b2fc02b299a95fc5f468930b20d9da6538af1acd35286efb4bdb` |

A/Bのsource SHA-256は`58988961f22ca4f3642dba8293762f4f87e35ccec218be694af96654c5ca682c`。同hashのsource snapshotを照合して保持した。Bのexe SHA-256は`2af2ee9d938ff189e75680511de10d9898f61fa91f205d5ade980f53a7df6463`で、原本と一致するexe copyを保持した。現行ソースはARM時の目視欄リセットを追加しているため実測版とhashが異なる。変更後のcompile・16assertion self-test・runner構文確認は成功。リセット後の画面操作は再試験していない。

## 追加調査で確定した実装判断

本人から「各入力20回・95%以上は今回不要。それ以外の実装判断をこのPRで終わらせたい」と指示を受け、以下を追加確認した。製品リリースの精度条件を解除する指示ではない。追加原本はC=`trials-1792752031092.jsonl`、D=`trials-1792752676927.jsonl`、E=`trials-1792753391798.jsonl`、F=`trials-1792753941862.jsonl`。

### 設定欠落：ONに補完しない

元のDWORD 1をbackupし、本人が設定UIでOFFにしたDWORD 0を確認してから1値だけ削除した。設定画面を開き直すとONになり、値も1へ再作成された（C trial 2）。これは欠落状態のままの試験ではない。

設定画面を開かない直接試行をやり直したD trial 1では、本人が最大化ボタンとLive hit=maximizeを確認し、開始前後ともflyout値は欠落、最大化hit 53sample、hover候補1だったが表示なしだった。初期の欠落状態（B trial 2）では表示ありだったため、**欠落という読取結果から実効ON/OFFを一意に決められない**。原因をShell cacheと断定せず、欠落はunknownで確定する。D trial 1の設定込みhover結果はnullである。C trial 3は滞在先に疑いが残り、本人も確信できないため採用しない。

各一時削除後に元のDWORD 1へ復元して型と値を照合した。さらに本人がUIでON→OFF→ONへ戻し、実表示を再確認した。復元確認後、設定を再変更していない。

| 条件 | Win+Zの設定判定 | hoverの設定判定 |
| --- | --- | --- |
| SPI成功・falseとarrangement文字列"0"が一致 | OFF | OFF |
| SPI成功・trueとarrangement文字列"1"が一致、flyout DWORD 0 | ON | OFF |
| 同上、flyout DWORD 1 | ON | ON |
| 同上、flyout欠落・型違い・未知値・読取失敗 | ON | unknown |
| SPI失敗、arrangement欠落・型違い・未知値・失敗、両者不一致 | unknown | unknown |

known ONなら候補を採用、known OFFなら不採用、unknownなら計上・通知せず観測不能として扱う。unknownを既知0の精度・coverageにしない。本実装では採用直前にも設定を読み、能力状態変更でpendingを破棄する。probeの設定込み集約は開始・終了の設定が一致する隔離試行を対象とし、設定変化を含む稼働中の製品実装を代替しない。

### 問い合わせ失敗：原因と回復を確認

C trial 1でChromeのhit／title query各1回がerror 1460（timeout）となり、最大応答時間36ms。Chrome最小化を58sample正常に識別し、候補は0だった。元のB trial 10はlast error未記録なので同じ原因とは断定しない。

別processの自作message-only窓を250ms応答待ちにするfixtureでは、30ms期限のhit queryがerror 1460で約34〜44ms後に失敗することを確認した。失敗を肯定hitにせず、未計上のpendingをリセットして新しい500msが必要になる。既に計上した滞在は、失敗・timer空白だけでは再armせず、確認できた退出までlatchを保持する。この回帰も最終版のself-testで確認した。error 0／5／1400等もAPIの戻り値0という同じunknown経路に入れる。[APIの失敗分類とbuffer寿命](research-snap-invocation-api.md#追加調査問い合わせ失敗buffer寿命入力の境界)。

### ボタンの特定：矩形優先、空の場合だけhit test

D trial 2は表示あり・最大化矩形一致86sampleなのに、hitは最小化85sample、hover候補0だった。これは採用した初期方式の失敗として残す。

自作窓のgeometry診断でも、process DPI設定成功、thread／targetともPer Monitor aware、DPI 192を確認した状態で、最大化矩形の左寄りがHTMINBUTTON、閉じる矩形の左寄りがHTMAXBUTTONとなった。物理→論理変換は座標を変えず、返値も同じだった。したがって今回は「DPI設定さえすればhit testだけでよい」とは結論しない。内部の根因を推測する必要はなく、実装で単独採用しない根拠がある。

最終API選択は次の通り。

1. query threadをPer Monitor V2へ設定してfinallyで戻し、`GetPhysicalCursorPos`の座標を使う。
2. TITLE query成功、最大化・閉じる矩形が非空、窓外／重なりなしなら矩形を優先する。最大化要素はvisible・enabled・非offscreenが必要。
3. TITLE query成功かつ最小化・最大化・閉じるの全矩形が空の場合だけ`WM_NCHITTEST=HTMAXBUTTON`へfallbackする。送信座標はsigned 16bitに収まる場合に限る。
4. query失敗、不正な部分矩形、DPI context設定失敗、採用APIの結果不明はunknownとしてpendingを破棄する。TITLEが有効な場合の診断用hit失敗は、そのTITLE結果を無効にはしない。
5. query前後で対象root・窓の外形・最大化領域内にいることを再照合する。使用するAPI経路が変わっても同じ滞在を再計上しない。

| 試行 | 実測と本人の確認 | 結果 |
| --- | --- | --- |
| E trial 2 | 標準窓へ1回hover。hitは最小化64、矩形最大化64 | 矩形経路でhover 1、設定込み1、表示あり |
| E trial 3 | Ctrl+Win+Z、表示なし | key 0。追加modifierを除外 |
| E trial 4 | 非アクティブChromeのhover、表示あり | 空矩形を確認したhit fallbackでhover 1、設定込み1 |
| E trial 5 | 標準窓の閉じるボタン左寄り、表示なし。hitは最大化57 | 矩形経路でhover 0。hit単独の誤計上を防いだ |
| F trial 1 | 本文で左down→押したまま最大化へ→本文へ戻ってup、表示なし | 押下中182sample、最大化矩形114sample、候補0、設定込み0 |

E trial 1は比較中にhover候補3となり、ARM後の入退場回数が確定しないため重複精度の証拠に使わず、本人がE trial 2を再実施した。E trial 6は最大化上でdownした試行で、同UI threadが約6秒停止し、押す前の滞在を分離できず候補1。成功扱いせず、先に押してから入るF trial 1へ置き換えた。Fの182sampleで押下の観測も確認できた。

本人は標準窓でARMしないIdle時とARM時を比較し、双方で表示され、focus・見た目に違いなしと回答した。これを全アプリで副作用がない保証へ拡張しない。E/F終了時の全trialはhookRemoved=true。Fは残っていた自分のprobeだけをsource hash・実行パスで照合して閉じ、正常終了markerを確認した。

### 実装時に使う残りの境界

- Win+Zは最初のZ downだけ。Ctrl／Alt／Shift付き、注入flag付き、開始時に既に押されているキーは不採用。注入でキー状態が不確かになったepochは、全キー解放を確認して初期化するまで再採用しない。
- hoverの閾値は500ms以上、pollは50ms、未計上pendingは200ms超の観測空白でリセット。閾値499／500、短・長、退出再入場、対象変更、空白・失敗からの復帰を状態機械で検証した。入力時刻列は保存しない。
- 左／右／中／X1／X2のいずれかがdownならhover時間を貯めない。取得失敗を退出と同一視せず、既に計上した滞在を勝手に再armしない。
- 本体表示の成功は推定しない。入力由来の確証・通常の保存・通知・coverageへの接続は後続の製品実装で既存契約を維持する。本調査のcursor観測だけで注入されていないマウス入力を証明したとはしない。

手動試行終了時のpure self-testは63assertion成功、別processのquery故障fixture成功、geometry診断完走、runner構文・diff検査成功。F試行のsource snapshotはPR初回headのソースと一致する。その後Codexレビューで指摘された、注入後の全キー解放を確認しても試行内復帰しない点を修正した。各pollで全対象キーupを確認した場合だけ状態を初期化し、非neutralでは復帰しない／neutral確認後は同じ試行内の物理Win+Zが復帰する2assertionを追加、最終self-testは65assertion成功。レビュー修正後の実操作は再試験せず、純粋状態機械と故障fixtureで検証した。自然入力各20回・95%以上は本人の指示で今回の完了判定から除外した。製品受入の合格にはしない。

## 結論と引継ぎ

**制約付き成立・技術調査完了**。Windows build 26340／Chrome 155.0.8059.85で、Win+Zの対象とdesktop除外、最大化hover、非アクティブ窓、重複抑止と再入場、設定による入口別の除外方針を確定した。hit test単独方式は採用しない。設定欠落・取得失敗・不正な幾何はunknownとして計上しない。この制約を維持して、上記のAPI選択と閾値で実装へ進める。

成立する範囲は、この環境で観測した**呼び出し候補の取得と設定の対応**である。製品で8ケースを自動分類する方式や、自然入力精度の成立を示したものではない。採用候補の除外方針は、Snap全体OFFでは両入口を除外、hover表示OFFではhoverだけを除外とする。ただしSPIはSnap Layout専用の保証APIではなく、2つのレジストリ値も互換性保証を確認できていない。初期状態ではflyout値が欠落したままhover表示がONだったため、値の欠落を自動でONに補完する設計は採用しない。読取失敗・不一致・欠落時はunknownが必要になる。

本調査で保留していた「欠落値の補完」「失敗時の扱い」「ボタンAPI」「時間・重複・modifier」の判断は上記へ固定した。別Windows build／アプリでの互換性と、完成した同一製品版での自然入力精度は製品受入で確認する。#83の技術調査完了だけで#5はCloseせず、#34のG-W08もPASSへ変更しない。直接の本体検出から呼び出し推定へ仕様を変える判断は別途必要である。

追加原本のSHA-256：C=`fd46ce0d04bc04e58b6c71b942d346942b0d61284ab4f90f73a70a3b89326e4f`、D=`b1bbabf21aada023139a08eea06522e4eabf43505669bc6f65160a2314b7de4f`、E=`2f9402593f898048f61354c0af2eb15877d83aad7fe83b867a85d79d79440898`、F=`ede5f5ab311e691f27056f9a8d5ffe1d7343f30283f5928b2e3e7e7ec376a9cb`。現行compile対象snapshot、最終query／geometryのlogも同じ.tools配下に保持する。
