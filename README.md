# 2026-fest-stats

学園祭の受付で来場者が答えるキオスク型アンケート。
マウスだけ、または4キー（← → 決定 戻る）だけで操作する。

- フロント: GitHub Pages（`index.html` / `app.js` / `style.css` / `config.js`。ビルド不要）
- 保存先: ブラウザの localStorage（全件の控え + 未送信キュー）と、GAS 経由の Google スプレッドシート
- 認証: 端末に登録したトークンを GAS 側で照合する。URL を知っているだけでは書き込めない

## セットアップ

### 名前の一覧

| 対象 | 名前 |
|---|---|
| スプレッドシート | `2026-fest-stats` |
| Apps Script プロジェクト | `2026-fest-stats-api` |
| Apps Script のファイル | `Code.gs`（作成時の既定のファイルをそのまま使う） |
| 回答のシート | `responses`（`setup` が作る。名前は変えない） |
| 集計のシート | `集計`（`setup` が作る。名前は変えない） |
| 既定の `シート1` | 削除してよい |
| スクリプト プロパティ | `TOKEN`（`setup` が作る） |
| ウェブアプリのデプロイの説明 | `prod`（再デプロイのたびに `prod v2`, `prod v3`, … と版を足す） |
| キオスクの端末名 | `reception-1`（既定値。2台目からは `reception-2`, …） |
| Edge のキオスク用プロファイル | `%LOCALAPPDATA%\fest-kiosk`（`kiosk.bat` が作る） |

`responses` と `集計` のシート名、および `TOKEN` は、コードの中で名前を指定して参照している。名前を変えると動かなくなる。

### 1. スプレッドシートと GAS
1. Google ドライブでスプレッドシートを新規作成し、名前を `2026-fest-stats` にする。共有は開発チームだけにする
2. 拡張機能 → Apps Script を開く。左上のプロジェクト名（「無題のプロジェクト」）を `2026-fest-stats-api` に変える
3. `Code.gs` の中身をすべて [gas/Code.gs](gas/Code.gs) の内容に置き換えて保存する
4. 上部の関数選択で `setup` を選んで実行する（初回は権限の承認が出る）
   - `responses` シートと `集計` シートが作られる
   - トークンが発行され、実行ログに `TOKEN: …` と表示される（コピーしておく。リポジトリには書かない）
5. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」を選び、説明 `prod`、次のユーザーとして実行「自分」、アクセスできるユーザー「全員」でデプロイする
6. 表示された「ウェブアプリ」の URL（`https://script.google.com/macros/s/…/exec`）を [config.js](config.js) の `GAS_URL` に貼る

`Code.gs` を変更したら、デプロイ → デプロイを管理 → `prod` を編集 → バージョン「新しいバージョン」で再デプロイする（URL は変わらない）。このとき説明を `prod v2` などに更新する。

### 2. GitHub Pages
Settings → Pages → Deploy from a branch → `main` / `(root)` を選ぶ。
公開 URL は `https://gdgoc-chuo.github.io/2026-fest-stats/`。

### 3. キオスク PC
1. 初回だけ `kiosk.bat <TOKEN>` を実行する。トークンが端末に保存され、URL からはすぐに消える
2. 端末名は最初から `reception-1` になっている（シートの `device` 列に入る）。2台目を使うときだけ、管理パネル →「端末名」で `reception-2` などに変える
3. 2回目以降は `kiosk.bat` だけで起動する
4. 左下に点が出ていなければ正常（灰 = 未確認・オフライン、朱 = トークンが未設定または拒否された）
5. 終了は Alt+F4

カスタムキーボードのキーは [config.js](config.js) の `keys` に `KeyboardEvent.code` で割り当てる。

## 当日の操作

| やりたいこと | 操作 |
|---|---|
| 管理パネルを開く | 戻るを押したまま決定を3秒長押し / 画面左下の隅を3秒長押し / Ctrl+Shift+A |
| 未送信分を送る | 管理パネル →「今すぐ再送」（通常は自動で送られる） |
| テストデータを入れる | 管理パネル →「テストモード: ON」（`is_test=1` になり、集計から除外される）。**本番前に OFF に戻す** |
| ローカルの控えを保存する | 管理パネル →「CSV」/「JSON」（ダウンロードフォルダに保存される） |

- 回答の途中で 20 秒操作がないと、10 秒のカウントダウンが出る。そのまま放置すると `status=partial` として保存され、最初の設問に戻る
- 結果画面は 8 秒で最初に戻る（キリ番のときは 14 秒）

## ローカルでの確認

```sh
npx serve .
# http://localhost:3000/?mock  — GAS に送らずに、通信を模擬して動かす
```

## データ

`responses` シートの1行が1回答。

| 列 | 内容 |
|---|---|
| received_at | GAS が受け取った時刻（JST, ms） |
| id | 回答 UUID（重複排除のキー） |
| seq | 端末内の通し番号 |
| status | `complete` / `partial`（途中で離脱） |
| is_test | 1 = テストモードで入力したデータ |
| party_size | 1〜5（5 は「5人以上」） |
| attribute | `student` `applicant` `alumni` `other_univ` `family_friend` `general` |
| with_kids | 1 / 0 / 空（1人で来た組には聞いていない） |
| started_at / answered_at | 最初の操作 / 回答確定の時刻（端末側、JST, ms） |
| duration_ms | 回答にかかった時間 |
| q_ms | 設問ごとの所要時間（JSON） |
| input | `key` / `mouse` / `mixed` |
| device / app_version | 端末名 / アプリの版 |

`集計` シートは数式で自動更新され、属性別・人数別・子どもづれの率・時間帯別をまとめる。
