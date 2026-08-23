#!/bin/bash
# テストがちゃんと効いているかを確かめる。
# コードをわざと 1 か所ずつ壊し、テストが落ちるかを見る。
# 「見逃し」が出たら、そこはテストで守れていない。
set -u
cd "$(dirname "$0")/.."

run() {
  local f="src/$1" from="$2" to="$3" label="$4"
  cp "$f" /tmp/mut_backup.gs
  python3 - "$f" "$from" "$to" <<'PY'
import sys
path, before, after = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
if before not in s:
    sys.exit(3)
open(path, 'w').write(s.replace(before, after, 1))
PY
  if [ $? -eq 3 ]; then
    echo "SKIP:   $label（対象が見つからない）"
    cp /tmp/mut_backup.gs "$f"
    return
  fi
  if node test/e2e.test.js >/dev/null 2>&1 && node test/logic.test.js >/dev/null 2>&1; then
    echo "見逃し: $label"
  else
    echo "検知:   $label"
  fi
  cp /tmp/mut_backup.gs "$f"
}

echo '--- 割り当て'
run 05_assign.gs 'return ctx.seat[seatKey_(day, u)] === undefined;' 'return true;' '同じ日に二重で入れない決まりを外す'
run 05_assign.gs '      var days = availability[u] || [];
      return days.indexOf(s.day) >= 0;' '      return true;' '出られない日を除く決まりを外す'
run 05_assign.gs 'if (ctx.seat[seatKey_(day, v)] !== undefined) continue;' '' '玉突きのときだけ同じ日に二重で入れる'
run 05_assign.gs '  balance_(ctx);' '' '担当回数を均さない'

echo '--- 当番の日'
run 04_plan.gs '  shuffle_(gaps, random);' '' '広い間隔を前に固める'
run 04_plan.gs 'var offset = q > 1 ? Math.floor(random() * q) : 0;' 'var offset = 0;' '開始位置を 1 日に固定する'

echo '--- 進行'
run 09_flow.gs '  if (notAdded_().length) return false;' '' '未追加の人がいても集計する'
run 09_flow.gs 'if (!selected.length && !confirmedZero)' 'if (false)' '0 日で確定したときに聞き返さない'
run 09_flow.gs 'st.ym !== ym || ' '' '古いカードの回答を受け付ける'
run 09_flow.gs '  if (!s.groupId) return;' '  if (false) return;' 'グループIDが空でも送ろうとする'
run 09_flow.gs 'if (!st.days.length) { reply_(replyToken, msgNeedOneDay_()); return; }' '' '0 日のまま日程を確定できる'

echo '--- 受け口'
run 10_webhook.gs '  if (!isAdmin) return;' '' '管理者以外にも管理者の操作をさせる'
run 10_webhook.gs "    case 'publish': return onPublish_(ev.replyToken);" '' 'グループに送るボタンを効かなくする'
run 10_webhook.gs "    case 'open':    return onOpenSheet_(ev.replyToken);" '' '表を開くボタンを効かなくする'
run 11_daily.gs '  if (day === s.dueDay) sendDue_(now, s);' '' '締切日の連絡をしない'
run 11_daily.gs '  if (day === s.noticeDay) sendNotice_(now, s);' '' 'お知らせを送らない'

echo '--- 保存'
run 03_store.gs '    out[id] = parseDays_(values[i][4]);' '    if (!out[id]) out[id] = parseDays_(values[i][4]);' '回答を最新でなく最初の行で見る'
run 07_ui.gs "    if (part === PART.二部) {
      return head + '　午前：' + person_(r.am) + '　午後：' + person_(r.pm);
    }" '' '当番表から午前・午後の表示を消す'
