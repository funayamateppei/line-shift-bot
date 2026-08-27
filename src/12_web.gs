/**
 * ウェブ画面。カレンダーはここでひらく。
 *
 * Flex Message は送ったあとに書き換えられない。カードの上で日付を選ばせると、
 * 1 タップごとにカードを送り直すことになり、トークがカレンダーで埋まる。
 * 選ぶところだけを LINE のアプリ内ブラウザに逃がし、〔確定〕のときに 1 回だけ
 * 書き込む。画面をひらいてから閉じるまで、LINE には 1 通も飛ばない（仕様 15）。
 *
 * 誰がひらいているかは、URL に載せた鍵（名簿シートの「鍵」列）で見る。
 * 鍵が漏れてもできるのはその人の回答を書き換えることだけで、名簿も当番表も
 * 読めない。webhook の URL と同じ考え方（10_webhook.gs の冒頭）。
 *
 * webAnswer と webFixDays に末尾の _ が付いていないのは、画面から
 * google.script.run で呼ぶため。GAS は _ で終わる関数を画面に見せない。
 */

// ---------------------------------------------------------------- 入口

function doGet(e) {
  try {
    return routeGet_((e && e.parameter && e.parameter.k) || '');
  } catch (err) {
    logError_(err);
    return page_('当番の画面',
      closedHtml_('うまくひらけませんでした。', 'しばらく待ってから、もう一度押してください。'));
  }
}

/** 鍵とそのときの段階で、出す画面を決める */
function routeGet_(key) {
  var person = rosterByKey_(key);
  if (!person) {
    return page_('当番の画面', closedHtml_(
      'この画面はひらけません。',
      'LINE に届いたカードのボタンから開いてください。'));
  }

  var st = state_();

  if (person.userId === settings_().adminId && st.stage === STAGE.日程編集中) {
    return page_(ymLabel_(st.ym) + 'の当番の日', calendarHtml_({
      key: key,
      ym: st.ym,
      mode: 'admin',
      selectable: null,
      selected: st.days,
      lines: [
        '当番にする日を押してください。',
        'もう一度押すと外れます。',
        '決まったら〔この日程でOK〕を押してください。'
      ],
      okLabel: 'この日程でOK'
    }));
  }

  if (st.stage === STAGE.回答受付中 && person.inGroup && person.friend) {
    return page_(ymLabel_(st.ym) + 'の都合', calendarHtml_({
      key: key,
      ym: st.ym,
      mode: 'member',
      selectable: st.days,
      selected: answersFor_(st.ym)[person.userId] || [],
      lines: [
        '当番の日のうち、都合がつく日を押してください。',
        'もう一度押すと外れます。',
        '選び終わったら〔確定〕を押してください。'
      ],
      okLabel: '確定'
    }));
  }

  return page_('当番の画面', closedHtml_(
    'いまひらける画面はありません。',
    'LINE に新しいカードが届いたら、そこから開いてください。'));
}

// ---------------------------------------------------------------- 確定

/**
 * メンバーの〔確定〕。
 * 画面を通さずに呼ばれてもよいように、受け取った日はここでも絞る。
 */
function webAnswer(key, ym, days) {
  return withWebLock_(function () {
    setTalkUser_('');
    if (!isYm_(ym)) return ng_('この画面はもう使えません。');

    var person = rosterByKey_(key);
    if (!person || !person.inGroup || !person.friend) {
      return ng_('この画面はもう使えません。\nLINE に届いたカードから開き直してください。');
    }

    var st = state_();
    if (st.stage !== STAGE.回答受付中 || st.ym !== ym) {
      return ng_(ymLabel_(ym) + '分の回答は締め切りました。\n変更は管理者に連絡してください。');
    }

    var selected = parseDays_(String(days || '')).filter(function (d) {
      return st.days.indexOf(d) >= 0;
    });

    appendAnswer_(ym, person.userId, nameOf_(person.userId), selected);
    maybeAggregate_();

    return ok_(
      'ありがとうございます。\n'
      + ymLabel_(ym) + 'は次の日で受け付けました。\n'
      + (selected.length ? daysLabel_(ym, selected) : '都合がつく日なし') + '\n\n'
      + 'この画面は閉じてかまいません。\n'
      + '変えたいときは、もう一度この画面をひらいて〔確定〕を押してください。');
  });
}

/** 管理者の〔この日程でOK〕。ここで初めてメンバーへ送る */
function webFixDays(key, ym, days) {
  return withWebLock_(function () {
    setTalkUser_('');
    if (!isYm_(ym)) return ng_('この画面はもう使えません。');

    var person = rosterByKey_(key);
    var adminId = settings_().adminId;
    if (!person || !adminId || person.userId !== adminId) {
      return ng_('この画面はもう使えません。');
    }

    var st = state_();
    if (st.stage !== STAGE.日程編集中 || st.ym !== ym) {
      return ng_('この日程はもう確定しています。\nLINE で〔状況〕を押して確かめてください。');
    }

    var last = daysInMonth_(ym);
    var picked = parseDays_(String(days || '')).filter(function (d) { return d <= last; });
    if (!picked.length) return ng_('1日以上選んでください。');

    fixDays_(ym, picked);

    return ok_(
      ymLabel_(ym) + 'の当番の日を確定しました（' + picked.length + '日）。\n'
      + daysLabel_(ym, picked) + '\n\n'
      + 'メンバーに都合を聞いています。全員の回答がそろったら当番表を送ります。\n'
      + 'この画面は閉じてかまいません。');
  });
}

/**
 * シートの読み書きが重ならないようにする。
 * webhook と同じシートを触るので、ここを外すと同時に押されたときに壊れる。
 */
function withWebLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return ng_('いま混み合っています。\nもう一度押してください。');
  }
  try {
    return fn();
  } catch (err) {
    logError_(err);
    return ng_('うまく保存できませんでした。\nもう一度押してください。');
  } finally {
    lock.releaseLock();
  }
}

function ok_(text) {
  return { ok: true, text: text };
}

function ng_(text) {
  return { ok: false, text: text };
}

/** 'YYYY-MM' の形か。画面から届いた値をそのまま文面に混ぜないため */
function isYm_(ym) {
  return /^\d{4}-\d{2}$/.test(String(ym || ''));
}

// ---------------------------------------------------------------- 画面

/**
 * HTML を返す。
 * GAS のエディタには .html を別に置けるが、そうすると「1 枚貼るだけ」で
 * 済まなくなる（tools/bundle.js は .gs しかまとめられない）。文字列で組み立てる。
 */
function page_(title, body) {
  return HtmlService.createHtmlOutput(body)
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 開くものがないときの画面 */
function closedHtml_(head, note) {
  return '<style>' + pageCss_() + '</style>'
    + '<div class="wrap">'
    + '<h1>' + esc_(head) + '</h1>'
    + '<p class="note">' + esc_(note) + '</p>'
    + '</div>';
}

/**
 * カレンダーの画面。
 * opt: {key, ym, mode:'admin'|'member', selectable:[日]|null, selected:[日], lines, okLabel}
 */
function calendarHtml_(opt) {
  var data = {
    key: opt.key,
    ym: opt.ym,
    days: daysInMonth_(opt.ym),
    first: firstWeekday_(opt.ym),
    can: opt.selectable,
    on: opt.selected || [],
    mode: opt.mode
  };
  var notes = (opt.lines || []).map(function (line) {
    return '<p class="note">' + esc_(line) + '</p>';
  }).join('');

  return '<style>' + pageCss_() + '</style>'
    + '<div class="wrap">'
    + '<h1>' + esc_(ymLabel_(opt.ym)) + '</h1>'
    + '<div id="main">' + notes + '<div id="cal" class="cal"></div>'
    + '<p id="msg" class="msg"></p></div>'
    + '<p id="fin" class="fin" hidden></p>'
    + '</div>'
    + '<div id="bar" class="bar"><button id="ok" class="ok">' + esc_(opt.okLabel) + '</button></div>'
    + '<script>var DATA=' + forScript_(data) + ';</script>'
    + '<script>' + pageJs_() + '</script>';
}

/** HTML に埋める文字 */
function esc_(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** <script> のなかに埋める値。'</script>' で閉じられないようにする */
function forScript_(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

function pageCss_() {
  return [
    ':root{color-scheme:light}',
    '*{box-sizing:border-box}',
    'body{margin:0;background:#fff;color:#333;',
    "font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP',sans-serif}",
    '.wrap{max-width:520px;margin:0 auto;padding:16px 12px 100px}',
    'h1{font-size:20px;margin:0 0 10px;color:' + COLOR.ヘッダー背景 + '}',
    '.note{margin:0 0 4px;font-size:13px;line-height:1.7;color:#666}',
    '.cal{margin-top:14px}',
    '.week{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px}',
    '.head{font-size:11px;font-weight:bold;text-align:center;padding:4px 0;color:#8a8a8a}',
    '.head.sun{color:' + COLOR.日 + '}',
    '.head.sat{color:' + COLOR.土 + '}',
    '.blank{height:46px}',
    '.day{height:46px;padding:0;font-size:15px;background:#fff;color:#333;',
    'border:1px solid ' + COLOR.枠線 + ';border-radius:6px}',
    '.day.off{background:#f7f7f7;border-color:#f0f0f0;color:#c6cbd1}',
    '.day.on{background:' + COLOR.緑 + ';border-color:' + COLOR.緑 + ';color:#fff;font-weight:bold}',
    '.msg{margin:14px 0 0;min-height:20px;font-size:13px;line-height:1.7;color:' + COLOR.日 + '}',
    '.fin{margin:0;font-size:15px;line-height:1.9;white-space:pre-line}',
    '.bar{position:fixed;left:0;right:0;bottom:0;padding:12px;',
    'background:#fff;border-top:1px solid #e5e5e5}',
    '.ok{display:block;width:100%;max-width:496px;margin:0 auto;height:48px;',
    'border:0;border-radius:8px;font-size:16px;font-weight:bold;',
    'background:' + COLOR.緑 + ';color:#fff}',
    '.ok:disabled{background:#b9c6c0}'
  ].join('');
}

/**
 * 画面のなかの動き。
 * 押しても送らない。〔確定〕のときだけ google.script.run で 1 回書き込む。
 */
function pageJs_() {
  return [
    '(function(){',
    'var W=["日","月","火","水","木","金","土"];',
    'var sel={};DATA.on.forEach(function(d){sel[d]=true;});',
    'var can=null;if(DATA.can){can={};DATA.can.forEach(function(d){can[d]=true;});}',
    'var cal=document.getElementById("cal");',
    'var msg=document.getElementById("msg");',
    'var ok=document.getElementById("ok");',
    'var head=document.createElement("div");head.className="week";',
    'W.forEach(function(w,i){var c=document.createElement("div");',
    'c.className="head"+(i===0?" sun":(i===6?" sat":""));c.textContent=w;head.appendChild(c);});',
    'cal.appendChild(head);',
    'var row=null;',
    'function newRow(){row=document.createElement("div");row.className="week";cal.appendChild(row);}',
    'function blank(){var b=document.createElement("div");b.className="blank";row.appendChild(b);}',
    'function paint(el,d){el.className="day"+(sel[d]?" on":"");}',
    'function cell(d){var el=document.createElement("button");el.type="button";',
    'el.textContent=String(d);',
    'if(can&&!can[d]){el.className="day off";el.disabled=true;return el;}',
    'paint(el,d);',
    'el.onclick=function(){if(sel[d]){delete sel[d];}else{sel[d]=true;}paint(el,d);say("");};',
    'return el;}',
    'newRow();var n=0;',
    'for(var i=0;i<DATA.first;i++){blank();n++;}',
    'for(var d=1;d<=DATA.days;d++){if(n===7){newRow();n=0;}row.appendChild(cell(d));n++;}',
    'while(n>0&&n<7){blank();n++;}',
    'function say(t){msg.textContent=t;}',
    'function chosen(){var out=[];for(var d=1;d<=DATA.days;d++){if(sel[d]){out.push(d);}}return out;}',
    'var askedZero=false;',
    'ok.onclick=function(){',
    'var days=chosen();',
    'if(!days.length&&DATA.mode==="admin"){say("1日以上選んでください。");return;}',
    'if(!days.length&&!askedZero){askedZero=true;',
    'say("1日も選ばれていません。都合がつく日なしでよければ、もう一度〔確定〕を押してください。");return;}',
    'ok.disabled=true;say("送っています…");',
    'var call=google.script.run.withSuccessHandler(function(res){',
    'if(res&&res.ok){finish(res.text);return;}',
    'ok.disabled=false;say((res&&res.text)||"受け付けられませんでした。");',
    '}).withFailureHandler(function(){',
    'ok.disabled=false;say("送れませんでした。もう一度押してください。");});',
    'if(DATA.mode==="admin"){call.webFixDays(DATA.key,DATA.ym,days);}',
    'else{call.webAnswer(DATA.key,DATA.ym,days);}',
    '};',
    'function finish(text){',
    'document.getElementById("main").hidden=true;',
    'document.getElementById("bar").hidden=true;',
    'var fin=document.getElementById("fin");fin.hidden=false;fin.textContent=text;',
    'window.scrollTo(0,0);}',
    '})();'
  ].join('');
}
