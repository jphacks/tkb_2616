# GitHub Pages の画面プレビュー

`app/` のデモ画面を、GitHub Actions でビルドして公開する。実際の認証・DB連携を含むルートのアプリとは入口が異なる（[担当範囲](auth-integrations.md)）。ブラウザ内に保存するプロフィールなどは、そのブラウザだけに残る。

## 最初の設定

公開元の設定には、リポジトリの admin または maintainer 権限が要る。

1. リポジトリの **Settings → Pages** を開く。
2. **Build and deployment → Source** で **GitHub Actions** を選ぶ。
3. この設定を含むPRをmainへマージする。すでにmainにある場合は、Actionsで **GitHub Pages preview → Run workflow** をmainに対して実行する。

公開先は https://jphacks.github.io/tkb_2616/ 。公開が完了するまではアクセスできない。

手順と権限の出典：[GitHub公式ドキュメント](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)（2026-10-25確認）。

## 更新

[ワークフロー](../.github/workflows/github-pages.yml)はPRで型検査とビルドを行い、mainへのpush時だけ公開する。生成物はActionsのartifactに置き、既存の`docs/`やDBの設定は更新しない。

ローカルで同じ出力を作る場合：

```sh
npm --prefix app ci
npm --prefix app run typecheck
npm --prefix app run build:web -- ../dist-pages
```

`/tkb_2616/` 配下のパス設定は `app/app.json`、静的ファイルの出力は `app/scripts/build-web.mjs` が受け持つ。画面URLの例は `/tkb_2616/?design=night#/profile`。
