# W11：入力と同じ窓の破棄の照合（#39）

正本は[確定要件](../ui-redesign-requirements.md)。[G-W11の限定的な着手根拠](../research/eight-operation-validation.md)を引き継ぎ、通常権限の前面top-level窓を対象にする。製品検出器の自然入力受入と最終buildのR02は[#47](https://github.com/YutoMatsui21/shortcut-expert/issues/47)で別途確認する。

[2026-10-29の検証結果・見逃し原本・buildと制約](window-close-validation.md)。

## 判定と寿命

- `WindowCloseObserver`が本番Observerの既存hookから入力とWinEventを受け、`WindowClosePolicy`で一時照合する。アプリ名のallowlistには依存しない。desktop、Shell、owned/tool/child窓、最小化・非表示・cloaked窓、自己process、昇格窓と確認不能な対象は除外する。
- mouseは入力前から前面の同じ窓に対する左押下と解放。両方で有効な`TITLEBARINFOEX`の閉じる矩形を確認する。タブの×、独自ボタン、hit-testだけのfallbackは採用しない。
- keyは中立状態からのAlt+F4。追加modifier・競合・注入を除外し、repeatで期限を延長しない。
- 入力前のHWND/process/thread/monitorとnative tickを一時保持する。同じHWND/threadの`EVENT_OBJECT_DESTROY`、`OBJID_WINDOW`/`CHILDID_SELF`、入力以降のイベント時刻を照合し、HWNDが存在しなくなったことを確認して確定する。DESTROYのcallback時点ではまだHWNDが有効な実測があるため、その場合は有界に保留し50ms周期で消滅を確認する。生存中のprocess/thread不一致・再作成・期限切れでは保留も取り消す。古いイベント、別の窓の破棄、消滅だけでは確定しない。
- 入力から消滅確認まで1000ms以内とする。これは実装上の保守的な期限であり実測の認識精度ではない。別入力・対象のowned確認画面/無効化・対象の同一性変更・HWND再作成・画面設定変更・停止で取り消す。通常閉鎖でも、HIDEや次の窓への前面変更が破棄前に届くことを実測したため、これらだけで成功/取消とせず同一対象の破棄を待つ。hideのみはDESTROYがなく期限切れとなり0件。確認待ちの後の閉鎖は、通常の即時閉鎖の成功へ読み替えない。
- 停止/再開でpolicyを作り直す。破棄結果は候補を一度だけ消費する。W01は独立した直接クリック/Alt+Tab証拠だけを採用し、閉鎖後のforeground変更単独を切替として数えない。

v2の`window-close/window-close-v1`は`targetMatched`、`destroyed`、有界な`inputAgeMs`、入力前monitorだけを渡す。HWND/PID/thread/native tick・窓名・app名・生入力は渡さず、保存は既存の日別集計と設定のまま。旧window証拠のparseは互換のため残すが、新helperの本番閉鎖経路はv2専用とする。

## 自動試験

- `tests/native-policy/WindowCloseTests.cs`：mouse/key同一対象、要求だけ・取消・hide・別対象・未解放・遅延・時刻逆行/ラップ・HWND再利用中・thread不一致・注入/競合・repeat・停止。閉じる矩形とタブ相当領域の区別。
- `tests/native-policy.test.ts`：本番C#生成→v2 JSON→Main parse→Core→SQLite。duplicateの再配送と保存後通知。
- `tests/window-close.test.ts`：型付き証拠の必須項目・未知/不正profile・由来/route・期限・未確証・注入/競合。
- `tests/fixture-integration.test.ts`：3学習状態、ページモデル、SQLite再open、通知adapter、pause/stop/保存失敗/ACK消失とretry。
- `src/main/storage-smoke.ts`：隔離fixtureでhelper輸送→Main→SQLite→実Rendererの記録/一覧。

人工fixtureの結果は実入力精度・OS通知可視表示・配布合格の証拠にはしない。

## 同意後の手動試験

`validation/window-close`は本番helperを別processで起動する手動専用パネル。自動入力は送らない。ARMから4秒後にhookを開始し、F8/FINISHで停止する。1試行30秒、セッション15分の上限を設け、停止ACKを確認する。固定case ID、W11のmouse/key数、W01数、自作A/Bの破棄数と停止成否のみをローカルJSONLへ記録する。helper stdoutの原文は保存しない。通常userData・窓画像・キー列を使用しない。

診断を使う場合は明示的な`--close-validation-consented`だけで`CloseReason`の固定カテゴリを各1000まで集計し、stop後にまとめて返す。通常の`--observe`は診断を返さない。入力列・イベント順序・native tick・対象識別子は診断に含めない。開始前のF8はカウントダウンを取り消し、stop ACKが3秒以内に返らなければhelperの終了を試みる。JSONLには終了理由と操作の本人確認待ちを明記する。

| case ID | 本人の手動操作 | 期待する結果 |
| --- | --- | --- |
| mouse-close | Aの通常の右上× | A破棄1、W11 mouse1/key0、W01 0 |
| key-close | AでAlt+F4、キーを解放 | A破棄1、W11 mouse0/key1、W01 0 |
| cancel | A右上×→確認No | A破棄0、W11 0 |
| hide | A右上×→Aをhide | A破棄0、W11 0 |
| other-destroy | A右上×→Bだけ破棄 | A破棄0/B破棄1、W11 0 |
| program | A内部のPROGRAM CLOSE | A破棄1、W11 0 |
| delay-confirm | A右上×→確認で2秒以上待つ→Yes | A破棄1、W11 0 |
| tab-close | A内部のTAB Xだけ消す | A破棄0、W11 0 |

開始前に操作せず時間切れになった試行は未操作として保持し、成功/製品失敗のどちらにも数えない。予想外の結果は原本を残し、失敗した境界を絞って再試行する。自作窓の結果だけで一般アプリ・独自枠・実tray・多段階確認の対応や#47の合格を宣言しない。
