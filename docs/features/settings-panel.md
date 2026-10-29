# 設定パネル・計測制御

**責務**：通知の一時停止、計測の停止・再開、全記録削除への入口を提供し、トレイと画面の状態を矛盾なく同期する。表示要件は[製品要件](../ui-requirements.md)、[Figmaの設定パネル](https://www.figma.com/design/mMfK6fQQzfhUqRHR7jsGne?node-id=349-2456)を参照。

## 1. UIと操作

- 共通タイトルバーの歯車から`SettingsPopover`（330×262px）を開く。通知・計測の2スイッチと削除入口を配置し、本文スクロールと独立させる。
- Enter／Spaceで操作可能。開いたときは**最初の有効な設定スイッチ**へfocusし、すべて無効なら歯車に留める。削除ボタンへ自動focusしない。
- Esc・外側クリック・歯車再クリック・画面切替・窓非表示／blurで閉じ、必要な場合はfocusを歯車へ戻す。一度設定したfocusを後続snapshotで奪わない。
- 削除入口はパネルを閉じて確認ダイアログへ引き継ぐ。実際の削除・単回確認tokenはMainの[保存・削除契約](../storage/history-deletion.md)で扱う。

## 2. 状態と保存・競合

| 操作 | 期待する状態 |
| --- | --- |
| 通知一時停止 | 計測・保存は継続、通知だけ停止 |
| 計測全停止 | 観測・保存対象の新規採用・通知を停止。通知希望値は保持 |
| 計測再開 | 保留保存・エラーがない場合だけ新しい観測世代で再開 |
| 再起動 | 通知pauseを解除して通常の計測開始状態へ戻す（永続の学習状態は維持） |

- Rendererとトレイは**同じMain command／SerialQueue**を利用する。通知の実効状態は「計測中かつ通知pauseなし」。全停止中は通知スイッチをdisabledにするが希望値を破棄しない。
- 保存失敗・時計異常・helper故障による安全停止をUI操作で勝手に解除しない。停止前に受理した記録の保存は保全し、保存待ちや失敗時の再開は拒否する。旧世代候補と遅延した通知を採用しない。
- `CoachWindow`が非永続の`stateVersion`を配信し、`useCoach`は古いsnapshot／IPC応答を無視する。**画面のstateVersionと保存のrevisionは別**であり、遅い応答からトレイ状態を巻き戻さない。

## 3. 検証と限界

- `tests/settings-state.test.ts`：古いIPC応答・トレイcommandとの競合。`tests/learning-state.test.ts`：保存保留・停止／再開・世代と通知。
- 隔離`node scripts/test/smoke.mjs --settings`（配布版は`--packaged --settings`）：2ページ×4幅、focusと閉じ方、スイッチ状態、保存中の禁止操作、トレイcallbackとの同期を確認する。
- **実機で別途必要**：OSトレイのクリック配送、DPI／文字拡大、実入力認識と標準通知。fixture結果はそれらの合格証拠ではない。
