#!/bin/bash
# テストがちゃんと効いているかを確かめる。
# コードをわざと 1 か所ずつ壊し、テストが落ちるかを見る。
# 「見逃し」が出たら、そこはテストで守れていない。
set -u
cd "$(dirname "$0")/.."

# src/ そのものは書き換えない。1 件ごとに使い捨てのコピーを作り、
# テストには GS_SRC でそちらを見せる。作業中のコードに触れないので、
# 途中で止めても壊れたまま残らないし、並列で回せる。
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

# 同時に走らせる数。CPU 数に合わせる
JOBS="$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)"

# 並列なので終わる順はばらばら。結果を番号付きで書き出し、最後に並べ直す
OUT="$WORK/out"
mkdir -p "$OUT"
N=0

section() {
  N=$((N + 1))
  printf -- '--- %s\n' "$1" > "$OUT/$(printf '%04d' "$N")"
}

run() {
  N=$((N + 1))
  one "$N" "$@" &
  # bash 3.2 には wait -n がないので、空きが出るまで見に行く
  while [ "$(jobs -rp | wc -l)" -ge "$JOBS" ]; do sleep 0.05; done
}

one() {
  local n="$1" name="$2" from="$3" to="$4" label="$5"
  local dir="$WORK/src$n"
  local out="$OUT/$(printf '%04d' "$n")"
  cp -R src "$dir"

  python3 - "$dir/$name" "$from" "$to" <<'PY'
import sys
path, before, after = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
if before not in s:
    sys.exit(3)
open(path, 'w').write(s.replace(before, after, 1))
PY
  if [ $? -eq 3 ]; then
    printf 'SKIP:   %s … 対象が見つからない\n' "$label" > "$out"
    rm -rf "$dir"
    return
  fi

  if GS_SRC="$dir" node test/e2e.test.js >/dev/null 2>&1 \
    && GS_SRC="$dir" node test/logic.test.js >/dev/null 2>&1; then
    printf '見逃し: %s\n' "$label" > "$out"
  else
    printf '検知:   %s\n' "$label" > "$out"
  fi
  rm -rf "$dir"
}

report() {
  wait
  cat "$OUT"/* 2>/dev/null
  local hit miss skip
  hit=$(grep -c '^検知' "$OUT"/* 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
  miss=$(grep -c '^見逃し' "$OUT"/* 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
  skip=$(grep -c '^SKIP' "$OUT"/* 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
  printf '\n検知 %s ／ 見逃し %s ／ SKIP %s\n' "$hit" "$miss" "$skip"
  [ "$miss" -eq 0 ] && [ "$skip" -eq 0 ]
}

section '割り当て'
run 05_assign.gs 'return ctx.seat[seatKey_(day, u)] === undefined;' 'return true;' '同じ日に二重で入れない決まりを外す'
run 05_assign.gs '      var days = availability[u] || [];
      return days.indexOf(s.day) >= 0;' '      return true;' '出られない日を除く決まりを外す'
run 05_assign.gs 'if (ctx.seat[seatKey_(day, v)] !== undefined) continue;' '' '玉突きのときだけ同じ日に二重で入れる'
run 05_assign.gs '  balance_(ctx);' '' '担当回数を均さない'

section '当番の日'
run 04_plan.gs '  shuffle_(gaps, random);' '' '広い間隔を前に固める'
run 04_plan.gs 'var offset = q > 1 ? Math.floor(random() * q) : 0;' 'var offset = 0;' '開始位置を 1 日に固定する'

section '進行'
run 09_flow.gs '  if (notAdded_().length) return false;' '' '未追加の人がいても集計する'
run 09_flow.gs '  if (!s.groupId) return;' '  if (false) return;' 'グループIDが空でも送ろうとする'

section '受け口'
run 10_webhook.gs '  if (!isAdmin) return;' '' '管理者以外にも管理者の操作をさせる'
run 10_webhook.gs "    case 'publish': return onPublish_(ev.replyToken);" '' 'グループに送るボタンを効かなくする'
run 08_messages.gs "  return uri_('担当を入れ替える（表を開く）', sheetUrl_(yearSheetName_(ym)));" "  return postback_('担当を入れ替える（表を開く）', 'a=open');" '表を開くのに 1 手はさむ'
run 11_daily.gs '  if (day === s.dueDay) sendDue_(now, s);' '' '締切日の連絡をしない'
run 11_daily.gs '  if (day === s.noticeDay) sendNotice_(now, s);' '' 'お知らせを送らない'

section '保存'
run 03_store.gs '    out[id] = parseDays_(values[i][4]);' '    if (!out[id]) out[id] = parseDays_(values[i][4]);' '回答を最新でなく最初の行で見る'
run 07_ui.gs "    if (part === PART.二部) {
      return head + '\\n午前 ' + person_(r.am) + '\\n午後 ' + person_(r.pm);
    }" '' '当番表から午前・午後の表示を消す'
run 07_ui.gs "  return blocks.join('\\n\\n');" "  return blocks.join('\\n');" '日付ごとの区切りをなくす'

section 'レビューで直したところ'
run 09_flow.gs '  clearAnswers_(target);' '' '中止しても前回の回答を消さない'
run 09_flow.gs '  clearAnswers_(ym);' '' '受付を始めるときに古い回答を消さない'
run 09_flow.gs '  if (!push_(s.groupId, msgPublish_(st.ym, shift.part || st.part, shift.rows))) {
    reply_(replyToken, msgPublishFailed_(st.ym));
    return;
  }' '  push_(s.groupId, msgPublish_(st.ym, shift.part || st.part, shift.rows));
  if (false) {
    return;
  }' '送れなくても「送りました」と返す'
run 09_flow.gs '  missing.forEach(function (p) { rosterUpsert_(p.userId, { inGroup: false }); });' '' '未追加の人を外さない'
run 09_flow.gs "    appendAnswer_(st.ym, p.userId, p.name || '', []);" '' '未回答の人を都合がつく日なしにしない'
run 03_store.gs "  var r = answerRow_(sh, ym, userId);" "  var r = 0;" '答え直しを上書きせず行を増やす'
run 03_store.gs '  var usable = (cands || []).filter(function (name) { return name !== other; });' '  var usable = (cands || []);' '同じ日の相手を除かずに候補を決める'
run 03_store.gs '  var list = usable.length ? cands : (allNames || []);' '  var list = cands;' '選べる人がいない枠に名簿を出さない'
run 03_store.gs "      pickRule_(r.cands, isTwoPart ? r.pm : '', allNames)," "      pickRule_(r.cands, '', allNames)," '午前を決めるときに午後を見ない'

section '実機で気づいたところ'
run 03_store.gs "  sh.getRange(start, 1, values.length, 1).setNumberFormat('@');" '' '当番表の年月を文字として扱わない'
run 03_store.gs '    if (ymLabelOfCell_(values[i][0]) !== label) continue;' "    if (String(values[i][0] || '').trim() !== label) continue;" '日付に化けた年月の行を読めない'
run 03_store.gs '  var hit = col.map(function (r) { return ymLabelOfCell_(r[0]) === label; });' "  var hit = col.map(function (r) { return String(r[0] || '').trim() === label; });" '作り直しで古い月のブロックを消せない'
run 06_line.gs '    messages: forAdmin_(TALK_USER, messages).slice(0, 5)' '    messages: messages.slice(0, 5)' '管理者宛ての返事にメニューを添えない'
run 06_line.gs '    messages: forAdmin_(to, messages).slice(0, 5)' '    messages: messages.slice(0, 5)' '管理者宛ての push にメニューを添えない'
run 06_line.gs '  if (to !== settings_().adminId) return messages;' '' 'メンバーにも管理者のメニューを出す'
run 10_webhook.gs "  if (source.type === 'group' && source.userId) {
    noteGroupSpeaker_(source.groupId, source.userId);
    return;
  }" '' 'グループでの発言から名簿に載せない'
run 10_webhook.gs '  if (!groupId || groupId !== settings_().groupId) return;' '' 'よそのグループの人も名簿に載せる'
run 10_webhook.gs '  if (p) { rosterUpsert_(userId, { name: name }); return; }' '' '外された人をしゃべっただけで戻す'
run 03_store.gs "    if (ymOfCell_(values[i][1]) !== ym) continue;" "    if (String(values[i][1] || '').trim() !== ym) continue;" '日付に化けた対象年月を読めない'
run 09_flow.gs '  if (!sameAsAsked) {
    reply_(replyToken, msgConfirmSkip_(st.ym, waiting, missing));
    return;
  }' '' '外す前に聞き返さない'
run 09_flow.gs '  if (usable < 1) { reply_(replyToken, msgSkipAll_()); return; }' '' '全員いなくなっても進める'
run 09_flow.gs '  if (st.stage === STAGE.回答受付中 && maybeAggregate_()) {' '  if (false) {' '状況で集計を見直さない'
run 09_flow.gs '    reply_(replyToken, msgAggregatedNow_(st.ym));
    return;
  }' '    reply_(replyToken, msgAggregatedNow_(st.ym));
  }' '状況で集計したときに当番表を二重に届ける'
run 09_flow.gs "      reply_(replyToken, shiftMessages_(st.ym, '当番表を確認中です。'));" "      reply_(replyToken, withAdminMenu_([text_('当番表を確認中です。')]));" '状況で当番表そのものを返さない'
run 10_webhook.gs "    case 'ym':      return onPickMonth_(ev.replyToken, data.v);" '' '対象月のボタンを効かなくする'
run 10_webhook.gs "    case 'skip':    return onSkipNotAdded_(ev.replyToken, data);" '' 'この人抜きで進めるボタンを効かなくする'
run 10_webhook.gs '  // この人が最後の未追加者だったなら、これでそろう
  maybeAggregate_();' '' '友だち追加でそろっても集計しない'
run 06_line.gs '  return isOk_(res);' '  return true;' '送信の失敗を無視する'
run 06_line.gs '  var res;
  try {
    res = UrlFetchApp.fetch(url, options);
  } catch (err) {
    log_(' "  var res = UrlFetchApp.fetch(url, options);
  if (false) {
    log_(" 'つながらなかったときに処理を止めてしまう'
run 07_ui.gs '    if (!r.am && !r.pm) { labels.push(head); return; }' '' '両方空の日を 2 回書く'
run 03_store.gs '    if (byId[id] === undefined) order.push(id);' '    order.push(id);' '名簿の重複行をまとめない'

section '2 回目のレビューで直したところ'
run 07_ui.gs '  var body = (lines || []).filter(function (line) { return line; });
  if (body.length) {' '  var body = (lines || []).filter(function (line) { return line; });
  if (true) {' '中身の空の箱を送ってしまう形に戻す'
run 09_flow.gs '    default:
      // 状態シートを手で書き換えられて知らない段階になっていたら、始めからやり直す
      clearState_();
      onStart_(replyToken);' '' '知らない段階のときに黙り込む'
run 08_messages.gs "  return people.map(function (p) {
    return (p.name || '名前未取得') + 'さん';
  }).join('、');" "  return nameList_(people) + 'さん';" '外した人の名前をまとめて「さん」にする'
run 08_messages.gs "  lines.push('この先ずっと外したいときは、名簿シートでその人の行を削除してください。');" '' 'ずっと外す方法を案内しない'
run 10_webhook.gs '    if (name) names.push(name);   // 名前が取れなかった人は並べない' '    names.push(name);' '名前が取れない人も並べる'

section '3 回目のレビューで直したところ'
run 06_line.gs '  return res.code >= 200 && res.code < 300;' '  return res.code < 300;' 'つながらないのを成功と数える'
run 10_webhook.gs "    if (ev.type === 'postback' && ev.replyToken) {" '    if (ev.replyToken) {' '順番待ちの返事を全部のイベントに返す'
run 03_store.gs '  var need = start + values.length - 1;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());' '' '行が減ったシートに足さずに書く'
run 09_flow.gs "  if (monthChoices_(new Date()).indexOf(String(value || '')) < 0) {" "  if (String(value || '').length !== 7) {" '対象月を選択肢と照合しない'
run 09_flow.gs '  var count = members_().filter(function (p) {
    return Object.prototype.hasOwnProperty.call(answered, p.userId);
  }).length;' '  var count = Object.keys(answered).length;' '抜けた人も回答済みに数える'
run 09_flow.gs "  var target = (st.stage === STAGE.回答受付中 || st.stage === STAGE.確認待ち) ? st.ym : '';" '  var target = st.ym;' '公開した月の記録も中止で消す'
run 09_flow.gs '  clearShift_(target);' '' '中止しても作りかけの当番表を残す'
run 09_flow.gs '  if (!s.groupId) { reply_(replyToken, msgNoGroup_()); return; }' '' 'グループ未登録と送信失敗を同じ扱いにする'

section '4 回目のレビューで直したところ'
run 09_flow.gs "  var sameAsAsked = data.c === '1'
    && data.ym === st.ym
    && String(waiting.length) === String(data.n)
    && String(missing.length) === String(data.m);" "  var sameAsAsked = data.c === '1';" '古いカードを別の月で押しても実行する'
run 09_flow.gs '  var usable = members_().filter(function (p) {
    return (answers[p.userId] || []).length > 0;
  }).length;' '  var usable = members_().length - waiting.length;' '全員が都合がつく日なしでも進める'
run 09_flow.gs '    reply_(replyToken, msgAggregatedNow_(st.ym));
    return;' '    return;' '状況で集計したときに何も返さない'
run 10_webhook.gs '    if (ROSTER_EVENTS[ev.type]) {
      try {
        handleEvent_(ev);
      } catch (err) {
        logError_(err);
      }
      return;
    }' '' '順番待ちが切れたら名簿のイベントも捨てる'

section '5 回目のレビューで直したところ'
run 03_store.gs '  var byId = Object.create(null);' '  var byId = {};' '名簿の入れ物を素の {} に戻す'
run 03_store.gs '  var out = Object.create(null);' '  var out = {};' '回答の入れ物を素の {} に戻す'
run 03_store.gs '    if (isNaN(Number(day))) continue;' '' '数にならない「日」も読む'
run 03_store.gs "  return p && p.name ? p.name : '';" '  return String(userId || "").slice(0, 8);' '名前がないとき userId の断片を返す'
run 09_flow.gs '  var days = shift.rows.map(function (r) { return r.day; });
  if (joinDays_(days) !== joinDays_(st.days)) {' '  var days = shift.rows.map(function (r) { return r.day; });
  if (false) {' '当番表が日程とそろっていなくても送る'
run 09_flow.gs '  var nameById = displayNames_(people);' "  var nameById = {}; people.forEach(function (p) { nameById[p.userId] = p.name || ''; });" '同じ表示名の人を区別しない'
run 09_flow.gs '  if (!st.days.length) return;' '' '当番の日が空でも集計する'
run 01_setup.gs "  sh.getRange(2, 1, 1, 4).setNumberFormat('@');" '' '状態シートを文字として扱わない'

section '均等化'
run 05_assign.gs '    if (ctx.load[from] - min < 2) break;   // ここから先はどう渡しても縮まらない
    if (searchChain_(ctx, from)) return true;' '    if (ctx.load[from] !== ctx.load[sorted[0]]) break;
    if (searchChain_(ctx, from)) return true;' '出し手を「担当が最も多い人」だけに戻す'
run 05_assign.gs 'var days = [];
  workDays.forEach(function (d) { if (days.indexOf(d) < 0) days.push(d); });
  days.sort' 'var days = workDays.slice();
  days.sort' '重なった日をまとめない'


section '画面（12_web.gs）'
run 12_web.gs '.filter(function (d) { return d <= last; });' ';' '月にない日も当番の日にする'
run 12_web.gs "  if (!picked.length) return ng_('1日以上選んでください。');" '' '0 日のまま日程を確定できる'
run 12_web.gs '    if (st.stage !== STAGE.回答受付中 || st.ym !== ym) {' '    if (st.stage !== STAGE.回答受付中) {' '古い月の回答を受け付ける'
run 12_web.gs '    var selected = parseDays_(String(days || '"''"')).filter(function (d) {
      return st.days.indexOf(d) >= 0;
    });' '    var selected = parseDays_(String(days || '"''"'));' '当番の日でない日も回答に入れる'
run 12_web.gs '    var adminId = settings_().adminId;
    if (!person || !adminId || person.userId !== adminId) {' '    var adminId = settings_().adminId;
    if (false) {' 'メンバーの鍵でも日程を確定できる'
run 12_web.gs '    if (st.stage !== STAGE.日程編集中 || st.ym !== ym) {' '    if (false) {' '確定ずみの日程を画面から書き換えられる'
run 12_web.gs "'say(\"1日も選ばれていません。都合がつく日なしでよければ、もう一度〔確定〕を押してください。\");return;}'," "'return;}'," '画面で 0 日の聞き返しをしない'
run 12_web.gs '  if (person.userId === settings_().adminId && st.stage === STAGE.日程編集中) {' '  if (false) {' '管理者の画面をひらけなくする'
run 12_web.gs '  if (st.stage === STAGE.回答受付中 && person.inGroup && person.friend) {' '  if (false) {' 'メンバーの画面をひらけなくする'

section '鍵と入口'
run 03_store.gs '  var key = found.key || newKey_();' '  var key = newKey_();' '名簿を書くたびに鍵を作り直す'
run 00_config.gs "  return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'k=' + encodeURIComponent(key);" '  return url;' '入口 URL に鍵を載せない'
run 07_ui.gs '    row.push(dayCell_(d, marked[d] === true, pressable === null || pressable[d] === true, null));' "    row.push(dayCell_(d, marked[d] === true, pressable === null || pressable[d] === true, function (n) { return 'a=atog&d=' + n; }));" 'カードの日付をまた押せるようにする'
run 10_webhook.gs "    if (!webhookAllowed_(e)) return ContentService.createTextOutput('NG');" '' 'webhook の合言葉を確かめない'
run 10_webhook.gs '  var want = settings_().webhookSecret;
  if (!want) return true;' '  var want = settings_().webhookSecret;
  if (true) return true;' '合言葉を決めても素通しにする'
run 08_messages.gs '  if (!url) return msgNoEntry_();' '' '入口が無くてもカードを組み立てる'

report
