# Mouse detection Shadow比較（2026-11-07）

## 範囲

検証専用の `validation/probes/MouseDetectionShadow.cs` をpolicy試験プロジェクトだけにリンクする。本番helper/Observerにはリンク・フックを追加しないため、通常起動の性能・Candidate・SQLite・学習・通知への影響はない。現行比較は実物CandidateTrackerのNative候補であり、TS採用・保存・通知までの新条件比較ではない。

`Current`と`Evaluate`は同じ開始/終了WindowStateと解放位置を使う。Shadowは既存PlacementGeometryの終端幾何・解放条件を再利用し、arranged起点だけを緩和する。W03は現行Trackerで確証された場合だけ追加する。入力有効性等はハーネスから渡す事実であり、実Windowsで自動取得できた証拠ではない。

## 実行

```powershell
node scripts/test/test.mjs native --file=native/native-operation-policy.test.ts
npm.cmd run test:unit -- --test-concurrency=2
```

人工fixtureだけで実行する。新規34ケースを含むC#1200 assertion成功。既存unit全体366件成功。通常製品へprobeを組み込まない。HWND/process/座標はfixture・メモリ内だけで、出力は固定試験名と成否。製品への正式送信は行わない。

## 比較結果（人工入力）

| 対象                  | 現行判定                           | Shadow判定             | 改善効果                     | 誤検出リスク                        | 採用判断 |
| --------------------- | ---------------------------------- | ---------------------- | ---------------------------- | ----------------------------------- | -------- |
| A 最大化A→最大化B     | なし                               | W02のみ                | 最大化起点の漏れを回避       | 独自resizeとmoveの識別が未実証      | 追加検証 |
| A 通常A→最大化B       | W02+W03                            | W02+W03                | 既存正例を維持               | 終端遅着とAPI取得は未検証           | 追加検証 |
| B half/quarter→最大化 | W03                                | W03                    | 不要な緩和なし               | 実アプリのイベント順序              | 追加検証 |
| C 右half→左half       | なし                               | W06                    | 配置済み起点の漏れを回避     | 未知shapeは棄却、同形状戻しも棄却   | 追加検証 |
| D 左上→右上           | なし                               | W07                    | 同上                         | corner/Snap bar識別は実機未確認     | 追加検証 |
| E 近接2クリック       | 標準とfallbackの既存回帰試験を維持 | 条件を満たすと相関成立 | single-click相関を除外できる | 本文2クリック＋別原因状態変化も成立 | 不採用   |

Eの不採用は「汎用の安全な代替として置換する案」に対する判断。研究継続を否定するものではない。Shadowのstate-changeはW03/W04の正式判定ではなく、クリック相関の評価。最小化single-clickをこの方式へ置換しないため、既存min-button/fallbackは失われない。

## 負例と限界

cancel/resize/競合/注入/別対象/別process/消滅/構成不安定/未解放/期限超過/中間状態/未知shape/非arranged resizeを棄却する人工例を追加。同じ配置へ戻る場合も0件。途中restore/halfはTerminal=falseとして不採用であり、実OSのイベント順序を収集・再現した試験ではない。

本文double-clickとcustom-captionに同一の観測事実を与えると同じ肯定結果になる反例を明示した。原因を示すフラグで都合よく除外していない。状態変化がない本文クリックは棄却するが、別原因で状態変化した場合の偽陽性は防げない。

W02+W06はShadow情報として成立し得るが製品契約へ追加しない。Shadowの個別結果と、既存複合の全体棄却契約の違いは未解決。Shadowをそのまま製品判定へ移植しない。

## 実機検証：未実施

Chrome/Dia/Obsidianで物理マウス比較は行っていない。今回のハーネスはfixture専用であり、ライブ比較コマンドは未実装。既存probeのログだけで本ハーネスのShadow結果が得られると扱わない。

実施に必要な追加作業は、隔離probeから同じ開始/終端snapshotと物理入力相関をCurrent/Evaluateへ渡すアダプタ。MOVESIZEのmove/resize識別、押下前snapshot、release/ENDの順序、取消と構成変更、2クリック距離・間隔をメモリ内で確証する必要がある。

実機手順とログの制約は[技術検証](technical-validation-20261107.md)の「実機手順」を参照。各アプリで表の5操作を5回ずつ、同配置戻し・resize・取消・本文クリック等の負例も同条件で実施。開始設定後ARM、操作、終端待機、FINISH、hook解除まで確認する。固定カテゴリの期待/現行/Shadow/棄却理由/API取得可否のみを保存する。

このPRで完了したのは隔離判定比較と人工負例検証。実機アダプタ、3方式を同一ライブ観測で比較する試験、検出率評価は未完了であり、採用推奨へ進めない。

ローカルレビュー実施：解放monitor/workの独立照合欠落を修正し負例2件を追加。ライブアダプタとEの同一入力3方式比較のP2指摘は未解決。Draft PRとして共有し、完成・merge可能とは扱わない。
