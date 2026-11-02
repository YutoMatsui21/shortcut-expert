# W11：ウィンドウを閉じる

**責務**：閉じるボタンまたはAlt+F4という入力と、**その同じ通常窓の破棄**を照合し、hide・確認取消・別窓破棄を計上しない。[製品要件](../ui-requirements.md)、[研究](../research/eight-operation-validation.md)、[局所実測と原因](https://github.com/YutoMatsui21/shortcut-expert/issues/39)。

## 1. 対象と操作の成立

| 入力 | 採用する条件 |
| --- | --- |
| マウス | 前面の同一窓で左押下と解放を確認し、双方で有効な`TITLEBARINFOEX`閉じる矩形と一致、または矩形が使えない独自captionで同一root／process／threadを再確認した明示的`HTCLOSE` |
| キー | 中立状態からの`Alt+F4`。追加修飾・注入・repeat・競合を除外 |

- `WindowCloseObserver`が既存hookとWinEventを受け、`WindowClosePolicy`が同一対象を一時照合。desktop／Shell、owned／tool／child、最小化・非表示・cloaked、自己process・昇格／不明な窓は除外する。アプリ名のallowlistへ依存しない。
- タブの×やclient／resize／不明判定、独自UIの位置だけから閉鎖を推測しない。矩形が空／不整合の場合のroot照会はWM_NCHITTEST・10ms上限とし、照会後にも同じroot・process・threadを確認する。有効な矩形がある場合は状態と位置の照合を優先し、この代替経路で無効状態や範囲外を迂回しない。**入力だけ・窓の消滅だけではW11を確定しない**。

## 2. 破棄確認と誤計上防止

- 入力前のHWND／process／thread・monitorとnative tickを**一時的に**照合する。入力後の同じ窓の`EVENT_OBJECT_DESTROY`（`OBJID_WINDOW`／`CHILDID_SELF`）、イベント時刻、HWNDの消滅を確認して成立とする。
- DESTROY callback時点ではHWNDがまだ有効なケースがあるため、**有界に保留し50msごとに消滅確認**を行う。process／threadが変わった再利用や期限切れは取消。
- 入力から消滅確認まで**1000ms以内**。別入力・別対象破棄・確認待ち・世代変更・画面構成変更・停止も取消す。ただし**HIDE／別窓へのforeground変更だけでは取消さない**。通常閉鎖でも破棄より先に届く場合が実測されたため。hideのみはDESTROYが来ないまま期限切れとなる。
- 破棄結果は一度だけ消費。閉鎖後のforeground変更だけをW01へ計上しない。1000msは保守的な実装期限であり、認識率の保証ではない。

## 3. 通信と記録

専用v2の`window-close/window-close-v1`に同一対象照合・`destroyed`・有界な`inputAgeMs`・入力前monitorを渡す。HWND／PID／thread／tick、生入力・ウィンドウ名は渡さず、既存の日別集計を使う。Mainの厳格parse→Core採用→SQLite保存後通知と3学習状態を共用する。旧window型の読み取り互換は残すが、新helperの閉鎖経路はv2専用。

## 4. テスト・実測の限界

- `tests/native/policy/WindowCloseTests.cs`：入力・破棄・取消・hide・別対象・遅延／HWND再利用・repeat・世代停止。`tests/operations/window-close-detection.test.ts`／`tests/native/native-operation-policy.test.ts`でv2検証・Core／SQLiteへ接続。
- `tests/integration/candidate-to-page-model-data-flow.test.ts`と隔離smoke：3学習状態、ページモデル、通知adapter、停止・保存失敗／ACK喪失の非重複と復旧。
- **実機検証入口**：本人の明示同意後、`validation/window-close/`の手動パネルでARMからFINISHまで（自動キー送出なし）。8ケースの結果・途中の見逃し原因・同じbuildかどうかの区別は[検証記録](https://github.com/YutoMatsui21/shortcut-expert/issues/39)に保存。
- **未受入**：自作WinForms窓での局所8ケース成功は、代表外部アプリ、独自枠／多段確認、実OS Toast、同一最終buildのR02／J04を保証しない。[最終受入 #47](https://github.com/YutoMatsui21/shortcut-expert/issues/47)。

Chromeの矩形不整合による復元棄却と、全矩形空によるmouse閉鎖候補未生成を[Issue #47のsession14](../../validation/issue-47/chrome-diagnosis-20261030.md)で観測。HTCLOSEは[WM_NCHITTESTの閉じるボタン判定](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-nchittest)に基づき、対象照合と破棄確認を併用する。修正の自然入力は別途確認し、fixtureを実機精度の証拠にしない。
