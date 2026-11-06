# Yomeru（よめる）

<p align="center"><img src="docs/hero.webp" alt="Yomeru — Webを、読みやすい日本語に。ページをその場で翻訳。" width="100%"></p>

<p align="center">
  <strong>英語の Web ページを、その場で「読める」に。</strong><br>
  翻訳サイトへコピペせず、ページを離れず、自然な日本語で読み進める。
</p>

<p align="center">
  <a href="#3分で使い始める"><strong>3分で使ってみる</strong></a>
  ·
  <a href="#こんな読み方ができます">できることを見る</a>
  ·
  <a href="#料金の目安">料金を確認する</a>
</p>

Yomeru は、自分の Anthropic / OpenAI API キーで動く個人用 Chrome 拡張です。
海外の技術資料も長い記事も、翻訳から質問まで今開いているページの中で完結します。
両方のキーを同時に保存でき、Claude を選べば Anthropic、GPT を選べば OpenAI の API を自動で使います。
GPT は GPT-6.1 Sol / GPT-6.1 Terra / GPT-6 Luna / GPT-6 Astra を選べます。

- **ページを丸ごと読む** — レイアウトやリンクを保ちながら、本文を日本語に置き換える
- **原文と読み比べる** — 段落ごとに原文と訳文を並べる対訳モード
- **その場で深掘りする** — 気になる箇所だけを翻訳・解説し、自由に質問できる
- **動画も自然な字幕で見る** — YouTube の字幕を英語・日本語に翻訳し、再生位置に合わせて表示する
- **画像の文字もその場で読む** — 画像を右クリックし、元の文字を訳文で直接置き換える
- **翻訳中は広告を隠す** — 明確に識別できる広告枠を画面と翻訳対象から除外し、原文表示へ戻すと復元する

> [!NOTE]
> 必要なのはデスクトップ版 Chrome と、使うモデルの API キーです。現在は Chrome ウェブストア未公開のため手動インストールですが、ビルドや Node.js は必要ありません。

## 読み慣れたページのまま、日本語で

![Yomeru によるサンプル文書の原文と翻訳の比較](docs/shots/compare.webp)

リンクや太字、コードを保ちながら、本文を文脈に沿った日本語へ置き換えます。

<sub>サンプル文書と用意した訳文を使い、実際の Yomeru で撮影したデモ画面です。</sub>

## 3分で使い始める

Anthropic または OpenAI API キーをすでにお持ちなら、ビルド不要で数分。ダウンロードしたフォルダを Chrome に読み込むだけです。

### 必要なもの

- デスクトップ版 Google Chrome
- [Claude Console](https://platform.claude.com/) または [OpenAI Platform](https://platform.openai.com/) で作成した API キー
- 使う API の利用枠またはクレジット（[料金の目安](#料金の目安)）

### 1. Yomeru をダウンロード

[**Yomeru を ZIP でダウンロード →**](https://github.com/HiyokoSauna37/yomeru/archive/refs/heads/main.zip)

ダウンロードした ZIP を展開します。フォルダは、Chrome に読み込んだあとも削除・移動しない場所に置いてください。

<details>
<summary>Git を使う場合</summary>

```sh
git clone https://github.com/HiyokoSauna37/yomeru.git
```

</details>

### 2. Chrome に読み込む

1. Chrome で `chrome://extensions` を開く
2. 右上の **デベロッパーモード**を ON
3. **パッケージ化されていない拡張機能を読み込む**を押す
4. 展開した `yomeru-main/`（Git の場合は `yomeru/`）フォルダを選ぶ
5. Chrome の拡張機能（パズル）アイコンから、Yomeru のピンを ON

### 3. API キーを設定

1. Claude 用は [Claude Console の API Keys](https://platform.claude.com/settings/keys)、GPT 用は [OpenAI の API Keys](https://platform.openai.com/api-keys) で API キーを作成する
2. Chrome のツールバーで Yomeru アイコンを押し、**設定**を開く（見つからない場合は `chrome://extensions` → Yomeru の **詳細** → **拡張機能のオプション**）
3. **Anthropic API キー**、**OpenAI API キー**の対応する欄へ貼る（片方だけでも、両方でも可）
4. 「翻訳」の **モデル** を選び、**選択中のモデルで接続テスト** → **設定を保存**

接続テストは選択中のモデルに小さな API リクエストを 1 回送ります。両方を確認する場合は、Claude と GPT に切り替えてそれぞれテストしてください。
既存の Anthropic キーは更新後も引き継ぎます。モデルを切り替えても、もう片方のキーは消えません。
ページ・画像翻訳のモデル、解説パネルのモデル、字幕のモデルは、それぞれ選択したモデルの API キーを使います。選択した提供元のキーが未登録の場合は、その提供元のキーを登録する案内を表示します。

### 4. 好きなページで翻訳

翻訳したい Web ページを開き、Yomeru アイコンから **このページを翻訳**。
原文へ戻すときは Yomeru アイコンから **原文に戻す**、またはもう一度 <kbd>Alt</kbd> + <kbd>T</kbd> を押します。

<details>
<summary>Yomeru を更新する方法</summary>

- ZIP で入れた場合: 新しい ZIP を取得し、Chrome に登録したフォルダの中身を置き換える
- Git で入れた場合: Yomeru のフォルダで `git pull` を実行する

更新後は `chrome://extensions` を開き、Yomeru の **再読み込み**ボタンを押してください。

</details>

## こんな読み方ができます

### ページを離れず、丸ごと読む

ツールバーのアイコン、右クリック、または <kbd>Alt</kbd> + <kbd>T</kbd> でページ翻訳を開始。
まず画面に見えている部分から訳すため、長いページでも読み始めを待たされにくい設計です。
SPA で後から追加された文章や、開いた `<details>` の中身も追いかけて翻訳します。

### 原文と見比べながら読む

「対訳」なら原文を消さず、そのすぐ下に訳文を表示します。
技術文書や学習用途など、原文のニュアンスを確認しながら読みたいときに便利です。

![原文の下に訳文を表示する Yomeru の対訳モード](docs/shots/bilingual.webp)

### 分からない一文を、その場で深掘りする

テキストを選ぶと、横に **翻訳・解説・質問** ボタンが現れます。
単語だけを切り離さず、前後の文章や同じページ内の関連箇所も踏まえて回答します。
回答中の `[1]` などは「参考箇所」から確認でき、同じ文脈のまま「もっとやさしく」「詳しく」と頼むこともできます。

解説の下にある **質問** を押すと、解説を見ながら続けて質問できます。元の選択箇所・ページの文脈・直近の会話を引き継ぐので、「具体例は？」「さっきの説明のここがわからない」と聞き返せます。
パネル上部にはモデル選択と、コピー・原文・参考箇所のアイコンがあります。モデル変更は次の質問・解説から適用され、選ぶだけでは API を呼びません。タイトル部分をドラッグすると、パネルを好きな位置へ移動できます。

<table>
<tr>
<td width="50%"><img src="docs/shots/selection.webp" alt="選択した文章だけを翻訳する画面"></td>
<td width="50%"><img src="docs/shots/question.webp" alt="選択した文章についてページ内の文脈を使って質問する画面"></td>
</tr>
<tr>
<td align="center"><strong>選んだ箇所だけ翻訳</strong></td>
<td align="center"><strong>ページの文脈ごと質問</strong></td>
</tr>
</table>

<details>
<summary>「解説」の画面も見る</summary>

![ページ内の文脈を使った選択範囲の解説](docs/shots/explanation.webp)

</details>

### 画像の中の文字を翻訳する

Web ページの画像を右クリックし、**画像を翻訳** を選びます。Claude が文字・訳文・文字領域を返し、Yomeru が HTML Canvas で元の文字を隠して同じ場所へ訳文を描画します。結果モーダルは開きません。画像上の **原文／訳文** で表示を切り替え、**戻す** で上書きを外せます。

画像翻訳は画像そのものを Claude に送信します。画像を右クリックするだけでは API を呼びません。PNG・JPEG・WebP・GIF・SVGに対応し、SVGはブラウザ内でPNGに変換します。大きい画像は長辺2,048ピクセル以内に縮小して送信します。文字位置はClaudeによる近似で、背景色・文字色・折り返し・文字サイズはブラウザ内で推定します。図表や単色背景では自然に置き換えやすい一方、写真・模様・曲線文字では塗り跡や位置ずれが出ることがあります。

### 翻訳中の広告を非表示にする

ページを翻訳すると、広告用のタグや属性で識別できる枠を非表示にします。翻訳後に追加された広告も対象です。広告の文章は、ページ翻訳や解説の周辺文脈として API に送りません。本文を誤って隠さないため、単に「広告」「ad」と書かれた文章や記事を除外することはしません。

**原文に戻す** を押すと、元の本文と広告の表示を復元します。広告通信を遮断する機能ではなく、翻訳中の表示と送信対象を整理する機能です。広告として判別できない独自の枠は残る場合があります。

### YouTube の字幕を、自然な言葉に

1. デスクトップ版 YouTube で字幕付きの通常動画を開く
2. Yomeru アイコンを押し、**YouTube** 欄で字幕の言語と表示方法を選ぶ（既定は日本語・Haiku 5.5・原文と併記）
3. **字幕を翻訳** を押す

字幕は前後の発話を参照し、意味を保った自然な日本語に翻訳します。英語も選べ、その場合は英語字幕の不自然な表現を整える用途にも使えます。API キーは既存の設定を共有し、字幕の言語・モデルはページ翻訳とは別に保存します。字幕の既定モデルは Haiku 5.5 です。

再生位置の約40秒先までを必要に応じて翻訳し、巻き戻しでは取得済みの訳文を再利用します。開始直後や先の位置へシークした直後は、訳文が届くまで原文を表示します。初めから動画全体を一括翻訳しないため、停止すれば新しい API リクエストも止まります。

停止はポップアップの **字幕を停止**、または動画左上の **yomeru ×** から。動画が切り替わると自動で停止します。字幕の取得時には YouTube の文字起こし欄を開くことがあります。うまく取得できないときは、動画の **文字起こしを表示** を開いて、もう一度開始してください。

### 読み方を、自分向けに整える

モデルや表示方法はポップアップですぐ変更できます。
設定画面では、翻訳先の言語、文体、分野別の追加指示、用語集、自動翻訳するサイトまで調整できます。

<table>
<tr>
<td width="30%" valign="top"><img src="docs/shots/popup.webp" alt="Yomeru のポップアップ"></td>
<td width="70%" valign="top"><img src="docs/shots/options.webp" alt="Yomeru の設定画面"></td>
</tr>
</table>

<details>
<summary>操作早見表</summary>

| やりたいこと | 操作 |
|---|---|
| ページ全体を翻訳 | Yomeru アイコン → **このページを翻訳** / 右クリック / <kbd>Alt</kbd> + <kbd>T</kbd> |
| 原文に戻す | ポップアップの **原文に戻す** / <kbd>Alt</kbd> + <kbd>T</kbd> |
| 選択箇所を深掘り | テキストを選択 → **翻訳** / **解説** / **質問** |
| 解説に続けて質問 | 解説パネル下部の **質問** |
| パネルを移動 | タイトル部分をドラッグ |
| 画像の文字を翻訳 | 画像を右クリック → **画像を翻訳** |
| YouTube 字幕を翻訳 | YouTube の動画ページ → Yomeru アイコン → **字幕を翻訳** |
| 毎回自動で翻訳する | ポップアップで **このサイトは常に翻訳**を ON |
| 翻訳を途中で止める | 右下の進行表示から **中止** |

</details>

## Yomeru が読みやすい理由

Web ページの文章は、リンクや太字などの HTML 要素で細かく分かれています。
断片ごとに訳すと、日本語にしたときの語順や装飾の位置が不自然になりがちです。

Yomeru は **段落全体をひとまとまり**として選択したモデルに渡し、リンクや太字も日本語の語順に合わせて並べ直します。
コード、識別子、画像など翻訳すべきでない要素はそのまま残します。

- 構造が同じなら元のテキストだけを書き換え、React などのページを壊しにくくする
- 語順が変わっても、リンク先や要素の属性を保つ
- マーカーが壊れた場合は単体で再試行し、それでも復元できなければ見た目で分かるように表示する
- 型名、識別子、オプション名、`true` / `false` は原語のまま残すよう指示する

<details>
<summary>語順を保つ仕組みを見る</summary>

Yomeru はリンクや太字を `<i0>…</i0>`、コードや画像などを `<i1/>` という一時マーカーに変換します。
モデルは文章だけでなくマーカーごと並べ替え、Yomeru が応答を DOM に戻します。

```text
原文: See <i0>the documentation</i0> for <i1>details</i1>.
訳文: <i1>詳細</i1>は<i0>ドキュメント</i0>を参照してください。
```

`<code>` / `<pre>` / 個別要素の `translate="no"` / `.notranslate` / 非表示要素 / `nav`・`aside`（設定で変更可）は翻訳しません。
`html`・`body` 全体の翻訳禁止指定は、ユーザーが明示的に翻訳した場合に限って妨げない設計です。

</details>

## 料金の目安

既定の **Claude Sonnet 5.5** なら、英文 1 万字のページで **約 $0.08（約 ¥12）**が目安です。
まず安く試したい場合は、設定から **Claude Haiku 5.5** を選べます。

| モデル | 入力 / 出力（$ / MTok） | 英文 1 万字の目安 |
|---|---:|---:|
| Claude Haiku 5.5 | 0.10 / 0.50 | 約 $0.004 / ¥0.6 |
| **Claude Sonnet 5.5（既定）** | 2 / 10 | 約 $0.08 / ¥12 |
| Claude Opus 5.5 | 4 / 20 | 約 $0.16 / ¥24 |
| Claude Fable 5.1 | 10 / 50 | 約 $0.40 / ¥60 |

目安は入力 5,000 token、出力 7,000 token、1 USD = ¥150 で計算しています。
GPT モデルの概算単価とページあたりの目安は、設定画面でモデルを選ぶと表示されます。
実際の料金はページ、設定、為替、各 API の価格改定によって変わります。最新の単価は [Claude API の公式料金表](https://platform.claude.com/docs/en/about-claude/pricing) と [OpenAI API の公式料金表](https://developers.openai.com/api/docs/pricing) を確認してください。

- ポップアップに **このページ**と**累計**の概算料金を表示
- キャッシュが有効で、モデル・翻訳先・指示・用語集・原文が一致する訳文は端末内から返し、新しい API リクエストを送らない
- 解説と質問も、キャッシュが有効で、選択内容・ページ内の文脈・質問・詳しさが一致すればキャッシュを利用
- 続きの質問は会話履歴とモデル、字幕は動画・前後の発話・翻訳先・モデルも含めてキャッシュを区別

## プライバシーと権限

Yomeru はページを扱う拡張だからこそ、何を保存し、何を送るかを明示します。

- **API キー** — この Chrome プロファイルのローカル領域（`chrome.storage.local`）に保存し、Chrome Sync では同期しません
- **ページ・選択範囲の翻訳で送るもの** — 翻訳対象のテキスト、ページタイトル、URL
- **解説・質問で送るもの** — 選択箇所、質問、周辺とページ内の関連テキスト、ページタイトル、URL。続けて質問するときは直近の会話も送信（最大8メッセージ・合計12,000文字）
- **YouTube 字幕で送るもの** — 動画ID、タイトル、字幕のテキストと時刻、前後の発話。動画や音声そのものは送信しません
- **画像翻訳で送るもの** — 選択した画像の内容、ページタイトル、ページURL（クエリとフラグメントを除く）。画像は必要に応じて縮小します
- **送信先** — Claude は `api.anthropic.com`、GPT は `api.openai.com` へ拡張から直接送信。それぞれ対応する API キーだけを使います。Yomeru 独自の中継・分析サーバーはありません
- **送信するタイミング** — 翻訳・解説・質問を実行したとき。「常に翻訳するサイト」に登録したホストではページを開いたとき。字幕は **字幕を翻訳** を押した動画でのみ先読み翻訳します
- **キャッシュ** — 翻訳・解説・字幕・画像翻訳の結果をこの Chrome プロファイル内の IndexedDB に保存。設定から削除できます。画像翻訳のキャッシュには画像そのものではなく画像のハッシュと文字領域・読み取り結果・訳文を使います。会話履歴は開いているパネルのメモリ内で保持し、閉じるとリセットします

全サイトへのアクセス権限は、開いている Web ページ上で翻訳 UI と DOM 操作を動かすために使います。
提供元ごとの API ベース URL を変更した場合、その提供元のリクエストは指定した URL に送られます。
機密情報を含む社内ページなどでは、その内容を設定先の API へ送ってよいか確認してから使ってください。

## 主な設定

- Anthropic / OpenAI API キーと、提供元ごとの API ベース URL
- 翻訳先の言語と、既定の表示（置き換え / 対訳）
- モデルと `effort`
- 文体・分野などの追加指示
- `原語 = 訳語` 形式の用語集
- 選択範囲の解説・質問ボタンの ON / OFF
- nav / aside の除外、キャッシュ、自動翻訳するホスト
- 1 リクエストの文字数、同時リクエスト数、表示用の USD / JPY レート

## 既知の制限

- `chrome://` ページや Chrome ウェブストアなど、Chrome が拡張機能の実行を許可しないページでは使えません
- iframe の中身（別フレーム）は翻訳しません
- 画像の `alt`、`placeholder`、`title` 属性は翻訳しません
- 画像翻訳は右クリックした画像が対象です。外部から取得する画像は5MB以下に限ります。ログインが必要な画像・転送される画像など、一部の画像は取得できません。GIFは読み取った時点の静止画として扱います。Canvasによる上書きのため、複雑な背景を生成補完したり元のフォントを完全再現したりはできません
- 解説はページ内の表示テキストを対象とし、関連箇所を最大 8 件・合計約 1 万文字まで参照します。リンク先や iframe は取得しません
- YouTube 字幕は `www.youtube.com/watch` の通常動画が対象です。ライブ・Shorts・埋め込み動画・字幕のない動画・映像に焼き込まれた字幕の読み取りには対応していません
- YouTube の字幕取得はページの構造や文字起こしの提供状況に依存します。YouTube 自身が文字起こしを取得できない場合や、仕様変更時には動作しないことがあります
- 文字起こし欄から取得した字幕は、表示される秒単位の時刻を使います。発話の正確な終了時刻がないため、次の字幕まで表示が続く場合があります。音声の誤認識を AI だけで確実に修正することはできません
- React などが翻訳後に本文を書き戻した場合、その段落は再翻訳の対象になります（追い翻訳は 60 回まで）
- 閉じた Shadow DOM の中身は読み取れません

<details>
<summary><strong>開発者向け情報</strong></summary>

### 構成

```text
manifest.json          MV3
background.js          service worker: ブラウザイベント・メッセージ受付・スクリプト注入
background/requests.js API 通信・再試行・セッション単位の中止とタイムアウト
background/translations.js ページ翻訳と接続テスト
background/subtitles.js 字幕翻訳、専用モデル・文脈・キャッシュ
background/images.js   画像取得・画像翻訳
background/explanation.js 解説・続きの質問
content/exclusions.js  広告の判定・抽出除外・非表示と復元
content/segmenter.js   DOM → セグメント化（マーカー直列化 / 復元 / in-place 適用）。純粋な DOM ロジック
content/page.js        ページ翻訳の DOM 適用・復元と、翻訳済みノードの状態管理
content/context.js     選択箇所と質問の語をもとに、周辺やページ内の関連する定義・用例を収集
content/ui.js          ページ内 UI（進行バッジ・選択操作・結果パネル）の Shadow DOM
content/selection.js   選択範囲の翻訳・解説・質問、スクロール追従、リクエストの中止
content/image.js       画像翻訳の開始・通信・中止のセッション管理
content/image-codec.js  画像の取得・SVG変換・API向け縮小
content/image-renderer.js 背景色推定・文字組み・翻訳Canvas生成
content/image-layout.js 画像の配置・object-fit・ヘッダー遮蔽計算
content/image-overlay.js Canvas表示・原文切替・スクロール追従・後片付け
content/content.js     ページ翻訳の進行、MutationObserver による追い翻訳、メッセージ処理
content/subtitle-timeline.js 字幕の時刻・バッチ・先読み範囲
content/youtube.js     YouTube 字幕の開始/停止、先読み翻訳、再生同期
content/youtube-ui.js  YouTube 字幕の表示、元字幕の表示復元
content/content.css    対訳モードの訳文スタイルと UI 用フォント
popup/popup.js         ページ翻訳のポップアップ操作
popup/youtube.js       字幕用の言語・モデル・開始/停止・進行表示
options/               設定ページ
shared/                モデル・API・プロンプト・解説・キャッシュ・設定・UI の共通モジュール
shared/subtitles.js    字幕専用プロンプトと入出力の検証
shared/youtube.js      YouTube の字幕トラック・文字起こし欄からの取得
shared/image.js        画像データの検証・取得、OCR/翻訳プロンプト
fonts/                 M PLUS Rounded 1c（OFL、ページ本文には不使用）
icons/                 y マーク（SVG / PNG、16〜128px）
tools/                 構文チェック、アイコン・README 画像の生成
tests/                 Chromium E2E、実 API 確認、テスト用 fixture
```

画像用 content script は `manifest.json` の順序で読み込む classic script。`image-codec` → `image-renderer`、`image-layout` → `image-overlay`、最後にセッション管理の `image.js` を初期化する。background からの動的注入も同じ manifest の一覧を使う。

### テスト

```sh
npm run check
npm install
npx playwright install chromium
npm test
ANTHROPIC_API_KEY=... npm run real -- [model]
```

- `npm test`: APIキーと送信先の分離・既存設定の互換性・使用量計算、字幕・画像の入出力検証と、モック API に対する翻訳・復元・対訳・解説・続きの質問・モデル選択・パネル移動・字幕再生同期・画像内Canvas翻訳・広告非表示/復元の E2E。実 API への通信や課金はありません
- テストには Node.js 20 以上が必要です。既存 Chromium を使う場合は `PW_EXECUTABLE_PATH` に実行ファイルのパスを指定できます
- `npm run real`: Apache Camel AS2 の実セグメントを Claude API で翻訳（API 利用料が発生）

### README 画像

デモ画像は、サンプル文書と用意した訳文を使って実際の拡張機能から撮影します。API キーは不要です。

```sh
node tools/capture_demo.mjs
python tools/make_readme_assets.py
```

実ページ・実 API の撮影には `ANTHROPIC_API_KEY=... node tools/capture_readme.mjs` を使えます。
メイン画像の生成条件は [`docs/hero.prompt.json`](docs/hero.prompt.json) に記録しています。
`tests/fixture/as2.html` は [Apache Camel の AS2 コンポーネント文書](https://camel.apache.org/components/4.22.x/as2-component.html)（Apache License 2.0）の検証用スナップショットです。

</details>

---

**Yomeru** は「読める」から。
小文字の **y** に、開いた本のページとしおりを重ねたマークです。
