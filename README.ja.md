# LuoguSP

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg?style=flat-square)](LICENSE)
![Userscript](https://img.shields.io/badge/userscript-Tampermonkey-00485B.svg?style=flat-square)
[![Version: 2.14.6](https://img.shields.io/badge/version-2.14.6-2f80ed.svg?style=flat-square)](LuoguSP.user.js)

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文(TW)](README.zh-TW.md) | [日本語](README.ja.md)

Luogu の問題ページ、プロフィール、IDE モード、記事、ペーストを拡張する Tampermonkey ユーザースクリプトです。

リポジトリ：[GitHub](https://github.com/ShanireZ/LuoguSP) · [CNB ミラー](https://cnb.cool/Round1/LuoguSP)。

## 機能

- **問題の難易度別配色**：対応ページの問題番号を Luogu の難易度で色分けし、提出一覧の標準色は維持します。
- **問題のホバープレビュー**：リンクの隣に題名、難易度、正答／提出数、制限、折りたたみ可能なタグ、個人の状態を表示します。
- **ユーザーのホバープレビュー**：名前／アバターのカードにプロフィール、受賞歴、利用可能なフォロー、メッセージ、記事、通報、ブロック操作を追加します。
- **自己紹介**：プロフィールのホームで省略された紹介を表示します。
- **制限された記事とペースト**：[Luogu Saver](https://www.luogu.me/) の保存内容を取得し、対応する記事の再読み込みや操作を提供します。
- **IDE のサンプル一括テスト**：全サンプルを実行し、結果、時間、メモリー、出力差分を確認します。
- **ページ内設定**：ナビゲーションの設定から機能を切り替えます。

配色は初回描画、ページ切り替え、クライアント側ナビゲーションに追従します。利用できる標準データは次の描画前に適用し、データがない場合はマウント後 300 ms 待ってからキャッシュまたは既存の要求キューを使います。練習ページでは挑戦済みの問題だけを処理し、正答済み一覧を維持します。最初に見える結果はスクリプトの注入時刻にも左右されます。

難易度キャッシュは問い合わせで期限を延長せず、五分で失効し、最大 1,000 件です。ホバープレビューには独立した五分・60 件のキャッシュがあります。どちらもタブ内メモリーに置き、クライアント側ナビゲーションでは維持し、再読み込みで消去します。期限切れの内容は利用時に更新し、静的ページを定期取得しません。

## インストール

1. [Tampermonkey](https://www.tampermonkey.net/) をインストールします。
2. [CNB Raw](https://cnb.cool/Round1/LuoguSP/-/git/raw/main/LuoguSP.user.js) または [GitHub Raw](https://raw.githubusercontent.com/ShanireZ/LuoguSP/main/LuoguSP.user.js) を開き、インストールを確認します。

LuoguSP.user.js の全ソースを新しいユーザースクリプトへ貼り付けるか、ダウンロードしたファイルを Tampermonkey にドラッグする方法もあります。

## 更新

いずれかの Raw リンクを再度開いて更新を確認するか、Tampermonkey の更新確認を使うか、インストール済みスクリプトを最新の全ソースで置き換えます。

## 開発

[プロジェクトガイド](AGENTS.md)と[ドキュメント](docs/index.md)を参照してください。`pnpm check` は作業ツリーを検証します。ローカルブラウザー用の `node scripts/qa/problem-color-local.mjs` は、表示される URL で初回描画の配色、ページ切り替え、ナビゲーション、要求遅延を確認します。公開済みバイト列のブラウザー QA や、Luogu にログインした実環境の検証を置き換えるものではありません。

## 作者とライセンス

ShanireZ が保守しています。1.8.2 までの各版は realskc が保守しました。[GNU General Public License v3.0](LICENSE) に基づいて配布します。
