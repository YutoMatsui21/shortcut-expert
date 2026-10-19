# 学習一覧とAppShell（#17）

正式画面はFigma `mMfK6fQQzfhUqRHR7jsGne` の `275:6498`。現行の12操作と3/3/5/1構成を使用する。旧IDは再採番せず、W12はタスクバー、W13は上下半分。W09は旧JSONと記録ページで保持し、新一覧から除く。

Sharedの`learning.ts`は正式名・表示順・キー・グループ・準備中を定義する。従来の`operations`は既存の記録画面・保存検証・検出器が使用する互換定義として残す。静的キーを検出成立の証拠に使わない。

Coreの`learningReadModel`は今日を含む7暦日の取得済み回数を集計する。未観測はnull、観測根拠がある0回は0、分母0の率はnull。率は小数1桁へ四捨五入。BigIntで合計し、安全整数を超えるとMainが原本を保持して停止する。旧JSONの取得済み回数も対象とし、不明なcoverageを生成しない。既存mutedは表示上の対象外、それ以外は学習中。習得済みの作成・3状態の変更と保存は#18で実装する。

`getLearning`はMainでローカル日付から7日間を決め、SQLite Workerの有界query（旧JSONではCore snapshot）を集計して返す。Rendererから任意期間・ファイル・SQLを受け取らない。通知窓と子frameには許可しない。`windowCommand`も同じsender検証で最小化・最大化/復元・hideのみを許可する。contextIsolation・sandboxを維持する。

AppShellは単一のuseCoach購読を所有する。一覧/記録は起動中のみ保持される選択とし、DOMを保持して折り畳み・スクロール・既存の日付選択を往復後も維持する。Renderer再読込・再起動では一覧/全展開へ戻す。日付は無操作・停止中もローカル日付へ追従する。記録ページの機能と旧11行は#19まで維持する。

32px TitleBar、48px NavigationRail、固定一覧ヘッダーと本文スクロール。本文は`min(viewport−248,872)`、nav以外の領域の中央。800〜919は2段、920以上は3列。行の背景強調はhoverのみ。最小800×600、初期1120×700の窓を作る。窓boundsの永続化・画面外補正・混在DPI等のV03全体は別の窓管理Issueで検証する。

## Assetsと権利情報

- SVGは上記のユーザー提供Figmaの採用ノードから書き出したものを`src/renderer/src/assets/`へ固定した。元ファイルの再配布許諾を新たなOSSライセンスとして宣言しない。第三者素材の権利確認は公開前に残る。runtimeにFigma URLを残さない。
- `icons.tsx`の名前は取得コードのasset名と一致する。TitleBarはkeyboard 16px、gear内Groupは16.425px（18px slot）、caption操作12px、nav20px。4groupのCategoryIconは13px、Chevron/RateHelp/StatusIconは16px、LearningHelpのInfoIconは18px。SVGのroot寸法と一致する。
- Noto Sans JP：`@fontsource-variable/noto-sans-jp@5.3.1`の124分割WOFF2。Inter：`@fontsource-variable/inter@5.3.0`の7分割WOFF2。font binaryは変更せず、同梱CSSのfamily名とfont-displayをアプリへ合わせる。各SIL Open Font Licenseは`src/renderer/public/licenses/`から配布物へコピーする。[Noto Sans JP原本](https://github.com/google/fonts/tree/main/ofl/notosansjp)、[Inter原本](https://github.com/google/fonts/tree/main/ofl/inter)。外部font APIへの実行時アクセスはない。

## 検証

`tests/learning.test.ts`は12ID/表示順、7暦日・閏日境界、legacy、既知0/未観測/0%、丸め、安全整数超過を確認する。IPC試験はgetLearning/windowCommandのsender・frame・不正commandを確認し、窓試験はcaptionの操作と隔離設定を確認する。

`runLearningSmoke`は既存JSONおよび新規SQLiteの隔離fixtureでmouse1/key1を本番Core/IPC/Reactへ通す。4幅の実viewport・本文の幅/位置・行構成・12準備中・全4group・同梱画像/fontの読み込み・折り畳み/scrollの往復保持を検査し、自アプリのみのPNGと寸法JSONをfixtureフォルダーへ出力する。既存smokeは再読込時の初期一覧/全展開と、記録ページの通知/計測/日付/削除/再購読も引き続き検査する。

この試験は自然入力精度・混在DPI・文字拡大・画面着脱・公開条件の合格証拠ではない。

2026-10-19：Windows build 26300 / Node 24.11.1 / .NET SDK 10.0.401 / Electron 44.7.0で、unit 153件、native 6件（C# policy 63assert）、typecheck、buildが成功。開発版とローカル配布版の両方で旧JSON/new SQLiteの4種類のsmokeが成功した。通常保存先と実入力payloadは使っていない。

DPR 2の実機で、4幅の本文は552/672/872/872px、左端148/148/148/268px、上端191/191/146/146px。Figma `275:6498`のNavy Shell/余白/行/キー/アイコンをfixture画像と照合した。初期窓外形1120に対してviewport1119、各setContentSize指定でも1px不足する既知差を再現したため、試験では外形を1DIP補正して正確なCSS幅で検査し、補正前後の外形/content/viewportを寸法JSONへ残す。この補正は製品の窓bounds保存やDPI対応の完了を意味しない。

画面試験でSVGのdata URLがCSPに拒否される不具合を検出し、ViteのassetsInlineLimitを0として修正した。CSPを緩めず、画像の実読込とfontの実表示文字を検査する。旧mainの40px marginが新一覧の本文に残る問題も画像照合で修正し、本文上端を回帰assertへ追加した。
