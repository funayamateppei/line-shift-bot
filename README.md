# 当番Bot

毎月の当番決めを LINE だけで済ませる Bot。

管理者がボタンを押すと、メンバーに「都合がつく日」をカレンダーで聞いて回り、全員の回答が揃ったら担当を公平に割り振って当番表をグループに送る。メンバーはスマホの LINE 以外を触らない。

## 費用

すべて無料枠の中で動く。

| サービス | 料金 | 無料枠 | この Bot の使用量 |
|---|---|---|---|
| LINE Messaging API | コミュニケーションプラン（無料） | 月 200 通 | メンバー 20 人で月 43〜63 通ほど |
| Google Apps Script | 無料 | 1 日あたり実行 90 分・トリガー 90 分・URL 取得 20,000 回 など | 1 日に数秒〜数十秒 |
| Google スプレッドシート | 無料 | — | シート 1 つ |

LINE の通数は「送った相手の人数」で数える（グループに 1 通送ると在籍人数分）。ボタンへの返事（reply）は数えない。
目安としてメンバー 60 人あたりまでは無料枠に収まる。

根拠：
- [LINE Messaging API の料金](https://developers.line.biz/ja/docs/messaging-api/pricing/) — 通数の数え方、reply が無料であること
- [LINE 公式アカウント 料金プラン](https://www.lycbiz.com/jp/service/line-official-account/plan/) — コミュニケーションプラン 200 通/月
- [Google Apps Script の割り当て](https://developers.google.com/apps-script/guides/services/quotas) — 無料アカウントの 1 日あたりの上限

## 文書

- [仕様](docs/design.md)
- [運用マニュアル](docs/運用マニュアル.html) — 管理者向け
- [デプロイ手順](docs/デプロイ手順.html)
