# 記録ページの集計・期間・フィルタ・ソート・比較（#19〜#21）

今日を含むローカル暦日7日／30日と、同日数の直前期間を扱う。11操作は学習一覧と同じregistry・正式名・キーを使い、全行に準備中を表示する。現在の学習状態から「学習中・習得済み」（初期値）、「学習中のみ」、「すべて」のいずれかで操作集合を選び、その同じ集合を両期間の操作行・KPI・率・比較・欠損判定へ適用する。「すべて」は対象外の継続記録も含める。保存済みcountsは変更せず、状態変更履歴や表示設定は保存しない。W09/W14/W13の履歴は保持するが今回の表示集計には含めない。

CoreのrecordsReadModelが期間・集合・集約・比較・ソートを担当する。現在期間はtoday−(N−1)〜today、前期間はtoday−(2N−1)〜today−N（両端含む）。daysBeforeの暦日演算を使い、当日途中の補正はしない。KPIはキー合計÷（キー合計＋マウス合計）で、操作率の平均ではない。回数合計の安全整数超過は保全エラーとする。

countsまたはobservedの根拠がある値だけを既知とする。根拠なしはnull／「—」、観測済み0件は0回、分母0の率はnull、mouseのみ正なら0.0%。対象集合0件もnullの空状態とし、0件を作らない。J01に従い部分観測・legacy countsも取得済み値で比較し、いずれかの値に根拠がなければ比較をnullにする。片方が既知0件なら回数差は計算できるが、率差は両方の分母が正の場合だけ。

比較値と独立にhasMissingCoverageを返す。選択操作について両期間の各日を調べ、coverage欠落・非observed・gap・部分日のどれかがあればtrueとする。日付のローカル午前0時同士から日長を求め、DSTを24時間固定にしない。除外した操作の欠損は混ぜない。対象集合0件は警告なし。

5ソートはキー率昇順／mouse降順／改善pt降順／key降順／total降順。指標のnullは末尾、同値はregistry順。率と改善ptはBigIntの分数の整数積で比較し、丸め前の順序を守る。率・ptの表示用値は小数1桁、ちょうど中間は絶対値側へ四捨五入、負0を正規化する。バーには丸め前の率を返す。

## 比較と欠損info（#21）

Spec v2 §8.3/J01（#14）を適用し、#20から渡された比較値とhasMissingCoverageをそのまま表示する。KPIは率のpt差、key/mouseの回数差、操作行は率のpt差。正数に+、率差は小数1桁のpt、回数差は整数を使う。比較のどちらかに根拠がない場合は「—」。観測済み0件は0回・率「記録なし」、分母0の率差は「—」。mouseのみの正回数は0.0%とする。対象集合0件は空状態でinfoを表示しない。

KPIは対象集合全体、行はその操作の両期間について欠損を示す。数値や「—」の横に既存18px info assetを置き、「一部の時間帯で記録を取得できていないため、実際の利用状況と異なる可能性があります。」を表示する。hover/focusで開き、クリック（Enter/Spaceを含む）で固定・解除、Esc/外側pointerdownで閉じる。説明へポインターを移動でき、フォーカス中はマウスが外れても維持する。配置はスクロール・リサイズに追従し、画面の左右端・下端で切れない。既存のキー率計算helpとはasset・accessible name・説明を分ける。query/設定/revision変更で古いモデルを破棄し、古いinfoも破棄する。

Figmaの参照は[欠損あり・説明表示 367:3715](https://www.figma.com/design/mMfK6fQQzfhUqRHR7jsGne?node-id=367-3715)、[欠損あり4幅 370:4129](https://www.figma.com/design/mMfK6fQQzfhUqRHR7jsGne?node-id=370-4129)、[観測済み0回 371:3664](https://www.figma.com/design/mMfK6fQQzfhUqRHR7jsGne?node-id=371-3664)。#12の完了契約と367:3715/371:3664のdesign context・画像を照合した。既存Shell/controlsは保持し、比較・info・既知0の表示を今回の対象とした。

SharedがRecordsQueryと限定された型・検証を所有し、Preloadはその値だけを専用IPCへ渡す。Mainは既存mainFrameと7/30・3フィルタ・5ソートを検査し、追加のfieldや不正値を拒否する。省略時は初期queryを使う。Mainが現在localDateを決め、DurableCoachの直列キュー内で両期間を単一Repository.query（14日／60日）で読み、確定settingsと同じrevisionを確認する。Rendererへは選択行・KPI・期間・比較値・欠損flag・query・revisionだけを返す。任意SQL・保存先・全履歴の複製は追加しない。旧JSON経路は隔離回帰fixture用に同じCore集計を使う。

AppShellが期間・フィルタ・ソートをsession状態として所有する。画面往復で保持し、再起動／Renderer再読込では7日・学習中/習得済み・キー率昇順へ戻す。単一購読は維持し、日付・revision・設定・エラー・query変化で再読込する。日次タイマーは停止中や無操作でも表示期間を進める。古い非同期応答・旧query・旧日付・旧revisionを表示しない。対象集合0件では専用の空文言を表示する。本文scrollは画面往復で保持する。

共通Shell/font/SVG/keycapを再利用し、期間・対象・ソートはキーボード操作とaccessible nameを持つselectにする。本文幅はviewport−248（上限872）、800pxはKPI縦積み・操作2段行、920px以上はKPI横並び・4列表。操作別ヘッダーは必要時に折り返して選択肢を切らない。準備中の表示と12行は現行要件を優先し、Figmaの例示11行・数値をコピーしない。#20のcontrolsの厳密なFigma外観照合、混在DPI／文字拡大は未確認。

## 検証

records.testは7/30暦日・現在/前期間・閏日/年境界・両端・期間外・旧ID除外・重み付きKPI・既知0/未観測/0%・丸め・バーの未丸め値・全体安全整数超過を確認する。records-query.testは本番SQLite WorkerとDurableCoachの並行書込/設定/query、同一revision、日次移動、削除と設定保持を確認する。3フィルタの両期間適用、状態変更・空集合、J01の根拠なし/既知0/legacy比較、欠損の除外・5ソート・丸め前の微差と正確な同値順も確認する。IPC/preload試験は専用channel・送信元制限・不正query拒否・引数配送を確認する。

records-smokeは隔離JSON/SQLiteの人工mouse1/key1を本番IPCとReactへ接続し、4幅でKPI・12行・準備中・未知値・SVG読込・縦横配置・横はみ出しなし・scroll保持、controlsによる期間/対象/5ソートのqueryとの一致、状態変更時の再集計、往復保持・再読込resetを検査し、自アプリのPNGと寸法JSONを出力する。SQLite query故障後の停止・エラー・再開時再読込と、移行後の古い履歴保全も既存smokeで確認する。人工入力を自然入力精度の証拠にしない。

2026-10-20：Windows build 26300 / Node 24.11.1 / .NET SDK 10.0.401 / Electron 44.7.0でtypecheck/build、unit 179件、native 6件（C# policy 63assert）が成功。開発版とローカル配布版で旧JSON・SQLite・移行再起動の全6種類のsmokeが成功。4幅の自アプリPNGを確認し、ヘッダーの2px差と表のキー列見出し位置を修正した。リサイズの描画反映を待ってからDIP差を補正し、800/920/1120/1360pxの実CSS幅で検証する。初期依存導入のEPERMとElectron実行の制限は権限付きで解消した。実入力精度、混在DPI/文字拡大、標準Toast、NSIS導入、公開受入は未確認。

## #20の検証（2026-10-20）

Windows build 26300 / Node 24.11.1 / .NET SDK 10.0.401 / Electron 44.7.0。型検査・build、unit 185件、native 6件（本番C# policy 63assert）が成功。通常版と`release/issue-20/win-unpacked/Window Shortcut Coach.exe`で旧JSON・SQLite・移行プロセス再起動の6種類の隔離smokeが成功した。4幅の寸法・自アプリPNG、期間/3フィルタ/5ソート、対象外・習得済みへの変更、往復保持・再読込reset、移行先でのプロセス再起動reset、query障害後の復旧を確認した。SQLite試験のTEMPはこのworktreeの`.tools/test-temp`へ限定した。Electron取得/同梱生成のcache renameと画面起動のsandbox制限は権限付き再実行で解消した。

すべて隔離fixtureであり実入力の精度証拠ではない。実入力・混在DPI/文字拡大・#20 controlsの厳密なFigma外観照合・標準Toast・NSIS・通常60分・公開受入は未実施。比較値とinfoの画面表示は#21の範囲として残す。

## #21の検証（2026-10-20）

Windows build 26300 / Node 24.11.1 / .NET SDK 10.0.401 / Electron 44.7.0（同梱Node 24.21.0）。型検査・build、unit全体、native 6件が成功。`--comparison`では実SQLite Worker→DurableCoach→Main/Preload→Reactを通し、取得済み合計・legacy正回数の警告付き比較、前期間不明/現在期間不明、部分観測の既知0、完全coverageの既知0、分母0、0.0%、3フィルタ・期間/状態変更を検証する。各判断を操作行・KPIの表示値でassertし、fixture用JSONへ結果を保存する。SQLiteのcommit契約は移行後のgapを消せないため、欠損なしのfixtureは初めからobservedとして作る。

800/920/1120/1360pxで寸法・自アプリPNGを確認。infoのhover/focus/Space/クリック/Esc/外側pointerdown、行の画面端配置、フィルタ変更による開いた説明の破棄、キー率helpとの区別が成功。通常版・ローカル配布版の比較smokeに同じ入口を追加し、CIでも実行する。実入力認識率、混在DPI/文字拡大、スクリーンリーダーの実読上げ、標準Toast、NSIS導入/通常60分・公開受入は未確認。自アプリ画像以外や通常userDataは使用していない。
