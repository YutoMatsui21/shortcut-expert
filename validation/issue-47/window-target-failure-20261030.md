# ExplorerのW03/W04見逃しと修正

## 観測事実

旧製品候補のソースは`e42974da3512f05e49710ce4aa752fbc774f2894`、manifest SHA-256は`512d826d344cad1dea4979c68d926d87bca906a6ac54a6d0e787eac020310d8e`。本人同意済みの隔離session2で、エクスプローラーのW03/W04を手動確認した。

- 本人申告：10ケースを実施し、mouseの通知は全て出なかった。
- 保存された試行は9件。P03m／P04m／P03k／P04k／S03-double／S04-double／S03-drag／S04-min-max／S04-repeatはすべて候補0・件数差分0・通知要求0。学習中、pauseなし、stopなし、期限内で中断なし。
- S04-min-normalは保存された試行がなく`unknown`。本人の実施申告を否定せず、成功／検出失敗のいずれにも置き換えない。
- [原本status](../evidence/issue-47/session2-status.json)、[本人申告](../evidence/issue-47/session2-participant.json)、[build](../evidence/issue-47/session2-build.json)、[正常終了](../evidence/issue-47/session2-exit.json)、[SQLite read-only整合性と旧build不変](../evidence/issue-47/session2-integrity.json)。

これはToastの表示だけの障害ではない。Main受信時点の候補が0なので、通知API・SQLite以前で止まっている。

## 原因と修正範囲

`native-helper/Core/Observer.cs`の`Read`がプロセス名を取得し、Chrome／Obsidian／Code／ChatGPT以外を除外していた。`src/core/detector.ts`の`classifyWindow`にも同じ旧制限が残っていた。Explorerを案内した受入準備ではこの制限を見落としていた。

live経路のプロセス名取得・許可リストを通常窓の構造判定に置き換えた。可視root窓、caption、非owned／非tool／非noactivate／非cloaked、非昇格、Shell／desktop／自己process除外、API結果不明の棄却を必要とし、送信するアプリ欄は固定カテゴリ`ordinary-window`とする。最小化結果も読めるよう、`IsIconic`だけで結果窓を棄却しない。Coreは固定カテゴリを追加で受理する。入力・同一対象・結果・時間・画面構成の確証条件、Win+↓の注入flagマスク、W03/W04の別IDは維持する。

同じ`Read`を使うW02／W06／W07・複合dragにも影響するため、局所のW03/W04だけで全面受入とはしない。

## 検証と次の確認

- 修正前に`ordinary-window`のW03/W04回帰テストのassert失敗を確認。
- 修正後に関連unit47件、全unit293件、型検査、本番C# policy538検証とC#→Main→Core→実SQLiteのnative-policy結合試験が成功。
- 専用ローカルCodexレビューで、追加レビュー規則の4観点と通常窓除外・最小化・privacy・複合操作の影響を確認し、追加指摘なし。
- 同梱fixtureと修正版の自然入力は別証拠。修正版のW03/W04自然入力はこの記録時点では未実施。最終buildを変更するため、既存成功ケースを含む#47の同一build条件を再確認する。

環境は上下配置の1440×900と2560×1440。Windows buildはmanifest-aware PowerShellの`Environment.OSVersion.Version.Build`で26340を確認。既存WinFormsパネルの`environment.json`にある9200は互換APIの報告値であり、実OS buildの根拠には使わない。OS／registry設定は変更していない。
