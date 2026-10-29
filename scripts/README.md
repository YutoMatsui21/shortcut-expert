# Scripts

用途ごとに分けた開発用の実行入口です。普段はルートの `package.json` に定義された `npm run` コマンドを使用します。

- `dev/`：開発環境、ビルド、SDK準備、GitHub作業補助
- `test/`：unit/nativeテストの起動、隔離smoke、CIの並列実行
- `acceptance/`：同梱版の保存・UI・自然入力の受入確認（実入力は本人の明示同意後のみ）
- `probes/`：採用方法の技術検証に使う単独probe。通常製品の受入試験ではありません

スクリプトは**リポジトリのルートを作業ディレクトリとして実行**します。実行方法・安全境界は[開発ガイド](../docs/development.md)と各[技術調査](../docs/research/)を参照してください。
