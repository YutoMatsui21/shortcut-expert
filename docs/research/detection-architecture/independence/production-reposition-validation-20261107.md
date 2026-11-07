# W02・W06・W07の本番検出条件改善

PR #166は`ab3dd734`としてmainへマージ済み。そのrevisionを基点に、既存Tracker・PlacementGeometry・Coreの条件だけを変更する。新しいGesture管理、Aggregator、独立検出器、保存形式は追加しない。[Shadow実測](shadow-validation-20261107.md)のCurrentは改善前の本番条件を指す。現在のprobeは本番policyをリンクするため、同じ入力でもCurrent結果が変わる。

## 採用範囲

- W02：最大化→最大化の別monitor移動を単独W02として確定。arranged値や上端最大化の条件をW02の証明に使わない。既存の物理押下・START・物理解放・END、同一対象/process、foreground、既知monitor/work/DPI、安定display layout、解放monitor/work一致を維持する。
- W06/W07：開始arranged=falseの一律条件を、開始arranged既知、arranged=trueなら既知のhalf/quarter形状、同monitorなら開始shapeと終了shapeが異なる、へ置換。開始状態は通常または最大化のまま。終端DWM幾何1px、caption、解放strip・上下側・対象・構成・同monitorのwork/DPI整合は変更しない。
- W03と既存複合判定は変更しない。通常A→最大化BはW02＋W03、同画面half→最大化はW03。別monitorの適格quarterはW02＋W07、halfは対象外。不正な複合候補を単独W02へ救済しない。Shadowが研究上返す全monitor差を本番へ移すものではない。
- W01/W04/W11/W12、標準caption判定とmouse-state-fallbackは変更しない。

正本：[W02](../../../operations/monitor-move.md)、[W06/W07](../../../operations/window-placement.md)、[複合ドラッグ](../../../operations/compound-drag.md)。

## 安全性の確認と限界

| リスク                   | 確認した保護・人工負例                                                                                                                | 残る実機確認                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 独自タイトルバーのresize | 明示resize hitを従来どおり除外。未知hitの通常resizeはmonitor/show/配置変化がなく0。配置経路はcaption押下必須                          | 未知hitの独自resizeが同時に別monitor移動等を起こす場合、APIに意味的な原因ラベルはない。一般識別の保証はしない      |
| 混在DPI                  | 各monitorの物理frame/workを使用。同monitorのwork/DPI変更は配置を棄却。別monitorは同一DPIを強制せずW02を許容。既存の形状/DPI試験を維持 | 異なる倍率、負座標、縦配置での物理ドラッグと解放先の照合                                                           |
| 構成変更                 | display layout差・入力取消・対象変更を棄却。構成通知時の既存ClearInputを維持                                                          | 接続/切断/倍率変更の通知順序と実OS挙動                                                                             |
| 遅着                     | 押下→STARTの1000ms、未START/未押下、取消後END、重複END、途中状態不採用を確認。単なる後続状態イベントはFinishMoveを呼ばない            | START/END自体の極端な遅着を一般保証しない。既存実装に解放→ENDの独立期限はなく、本変更でも追加しない                |
| アプリ独自変化           | 物理押下/START/解放なし、通常resize、captionでない配置入力を棄却                                                                      | 適格な入力と同じ窓の独自変化が重なる場合、公開APIから完全な因果識別はできない。通常clickを新しい配置入力へ広げない |
| 取消・戻し               | Esc、解放後取消、同monitor同shape、元monitor復帰、未解放を棄却                                                                        | Snap Assist・Esc・同配置戻しの最終製品buildでの再確認                                                              |

証拠は本番C# policyへの人工イベント列、Mainの厳格parse、Core、隔離SQLite、通知要求のfixture。Shadowの`Resize`等の都合のよいフラグだけを安全性の根拠にせず、`MouseRepositionTests.cs`から本番Trackerへhit/状態/入力を渡す。

## 検証結果

- 修正前：追加した最大化A→最大化B試験が`expected W02, actual empty`で失敗。
- 修正後：右half→左half、左上→右上、最大化A→最大化Bと、未知shape/arranged、resize、取消、構成・process不一致、未解放、期限、foreground、重複の本番policy回帰を追加。
- C#→Main→Core→SQLiteの試験では新しいW02/W06/W07候補を保存・通知要求まで通し、同一候補の再配送が重複加算しないことを確認。
- unit全367件成功。既存W01＋W03/W04、W02＋W03/W07、Win+↓連続操作、Win保持中の方向キー列の回帰を含む。native全8件成功。最終追加負例を含むC# policyは1,280 assertion成功。型検査・build・lint（既存warningあり）・CSharpier成功。通常/storage隔離smoke成功。最新head CIはPRで確認する。
- 既存構成のNuGet脆弱性メタデータ取得でNU1900警告あり。build初回はsandboxの親directory読取り拒否で停止し、通常権限での再実行は成功。

- storage smokeの初回は30秒timeout。範囲外日付の拒否は意図した負例と確認し、コードを変えず通常/storage smokeを再実行してともに成功。初回timeoutの原因は未確定。全体format checkは既存の未追跡`.vscode/settings.json`のみ失敗し、変更対象は別途確認。
- コード全体の専用ローカルレビュー：`bdc55b8`をmainと比較し、追加レビュー規則の4観点と安全性・複合契約・Native→TS→SQLiteを確認。対応が必要な指摘なし。後続はこの検証記録の文書更新のみ。

## 物理試験の境界

今回、新しい物理入力観測は実施していない。PR #166のChrome・Dia・Obsidianでの有効なShadow試行は改善可能性の根拠であり、本変更後の製品全経路の合格ではない。最終buildで、3アプリの正例に加え、独自resize、混在DPI、画面構成変更、遅着、独自状態変化、取消/同配置戻しを本人同意の隔離試験で確認する必要がある。自動試験・smokeを実入力精度や実OS通知表示の証拠としない。
