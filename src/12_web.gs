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

  if (person.userId === settings_().adminId && st.stage === STAGE.確認待ち) {
    return page_(ymLabel_(st.ym) + 'の当番表', shiftHtml_(key, st));
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
 * 管理者の〔この内容で保存〕。
 * 直された枠だけをシートに書き、最新の当番表を管理者へ送る（1 通）。
 */
function webSaveShift(key, ym, slots) {
  return withWebLock_(function () {
    setTalkUser_('');
    if (!isYm_(ym)) return ng_('この画面はもう使えません。');

    var person = rosterByKey_(key);
    var s = settings_();
    if (!person || !s.adminId || person.userId !== s.adminId) {
      return ng_('この画面はもう使えません。');
    }

    var st = state_();
    if (st.stage !== STAGE.確認待ち || st.ym !== ym) {
      return ng_('この当番表はもう直せません。\nLINE で〔状況〕を押して確かめてください。');
    }

    var changed = updateShiftSlots_(ym, cleanSlots_(slots, readShift_(ym), memberNames_()));

    // 直したあとの表をそのまま返す。シートから読み直すので、書けたものが見える
    var shift = readShift_(ym);
    var part = shift.part || st.part;
    push_(s.adminId, msgShift_(ym, part, shift.rows,
      changed ? '当番表を直しました。' : '当番表は変わっていません。', entryUrl_(key)));

    return ok_(
      (changed ? changed + 'つの枠を直しました。' : '直したところはありませんでした。') + '\n'
      + 'LINE に当番表を送りました。\n\n'
      + 'グループに出すときは、LINE で〔グループに送る〕を押してください。\n'
      + 'この画面は閉じてかまいません。');
  });
}

/**
 * 画面から届いた枠を、書いてよいものだけにする。
 *
 * 名前は「空欄」か、いま名簿にいる人か、もとから入っていた名前のどれか。
 * 画面を通さずに呼ばれても、知らない名前が当番表に入らないようにする。
 * もとの名前を通すのは、名簿から抜けた人が入っている枠を触っていないのに
 * 消してしまわないため。
 */
function cleanSlots_(slots, shift, names) {
  if (Object.prototype.toString.call(slots) !== '[object Array]') return [];

  var byDay = Object.create(null);
  shift.rows.forEach(function (r) { byDay[r.day] = r; });
  var ok = Object.create(null);
  names.forEach(function (n) { ok[n] = true; });

  var out = [];
  slots.forEach(function (slot) {
    var day = parseInt(slot && slot.day, 10);
    var row = byDay[day];
    if (!row) return;
    var one = { day: day };
    ['am', 'pm'].forEach(function (k) {
      if (slot[k] === undefined || slot[k] === null) return;
      var name = String(slot[k]).trim();
      if (name === '' || ok[name] === true || name === row[k]) one[k] = name;
    });
    if (one.am !== undefined || one.pm !== undefined) out.push(one);
  });
  return out;
}

/** 当番表に出せる名前。名簿にいる人ぜんぶ */
function memberNames_() {
  var byId = displayNames_(members_());
  return Object.keys(byId).map(function (id) { return byId[id]; });
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

  return '<style>' + pageCss_() + calendarCss_() + '</style>'
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

/**
 * 担当を入れ替える画面。
 *
 * プルダウンには**名簿の全員**を出す。その日に来られる人は別に並べて見せる
 * ので、選択肢そのものを絞る必要がない。絞ると、午前と午後を入れ替えたい
 * ときに一度どちらかを空にしないと選べなくなる。
 *
 * 午前と午後が同じ人でもよい。人が足りない日に、承知のうえで 1 人に
 * 通してもらうことがある。**自動で割り当てるときは禁じたまま**（仕様 5）で、
 * ここは管理者が自分で決めるところなので許す。
 */
function shiftHtml_(key, st) {
  var shift = readShift_(st.ym);
  var part = shift.part || st.part;
  var data = {
    key: key,
    ym: st.ym,
    twoPart: part === PART.二部,
    all: memberNames_(),
    rows: shift.rows.map(function (r) {
      return { day: r.day, weekday: r.weekday, am: r.am, pm: r.pm, cands: r.cands };
    })
  };

  return '<style>' + pageCss_() + shiftCss_() + '</style>'
    + '<div class="wrap">'
    + '<h1>' + esc_(ymLabel_(st.ym)) + 'の当番表</h1>'
    + '<div id="main">'
    + '<p class="note">担当を選び直せます。名簿の全員から選べます。</p>'
    + '<p class="note">「来られる人」は、その日に都合がつくと答えた人です。</p>'
    + '<div id="list"></div>'
    + '<p id="msg" class="msg"></p></div>'
    + '<p id="fin" class="fin" hidden></p>'
    + '</div>'
    + '<div id="bar" class="bar"><button id="ok" class="ok">この内容で保存</button></div>'
    + '<script>var DATA=' + forScript_(data) + ';</script>'
    + '<script>' + shiftJs_() + '</script>';
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
    'body{margin:0;background:#fff;color:#333;-webkit-text-size-adjust:100%;',
    "font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP',sans-serif}",
    '.wrap{max-width:520px;margin:0 auto;padding:16px 12px 100px}',
    'h1{font-size:20px;margin:0 0 10px;color:' + COLOR.ヘッダー背景 + '}',
    '.note{margin:0 0 4px;font-size:13px;line-height:1.7;color:#666}',
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
 * カレンダーの画面だけで使う見た目。
 * 当番表の画面には渡さない。同じ名前の決まりがぶつかると、
 * あとから足したほうが上書きしきれずに形が崩れる（.day の高さで一度やった）。
 */
function calendarCss_() {
  return [
    '.cal{margin-top:14px}',
    '.week{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px}',
    '.head{font-size:11px;font-weight:bold;text-align:center;padding:4px 0;color:#8a8a8a}',
    '.head.sun{color:' + COLOR.日 + '}',
    '.head.sat{color:' + COLOR.土 + '}',
    '.blank{height:46px}',
    '.day{height:46px;padding:0;font-size:15px;background:#fff;color:#333;',
    'border:1px solid ' + COLOR.枠線 + ';border-radius:6px}',
    '.day.off{background:#f7f7f7;border-color:#f0f0f0;color:#c6cbd1}',
    '.day.on{background:' + COLOR.緑 + ';border-color:' + COLOR.緑 + ';color:#fff;font-weight:bold}'
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

/**
 * 当番表の画面だけで使う見た目。スマホで触る前提。
 *
 * ・日付・ラベル・select を縦に積む。横に並べると、画面が狭いときや名前が
 *   長いときに select がはみ出す。積んでしまえば幅を気にしなくてよい
 * ・iOS は select を独自に描くので appearance:none で消し、▼ は自前で置く
 * ・文字は 16px。これより小さいと、iOS が触った瞬間に画面を拡大する
 */
function shiftCss_() {
  return [
    '.dcard{border:1px solid #e5e5e5;border-radius:10px;padding:12px;margin:0 0 12px}',
    '.dhead{font-size:16px;font-weight:bold;margin:0 0 8px;color:' + COLOR.ヘッダー背景 + '}',
    '.dhead .sun{color:' + COLOR.日 + '}',
    '.dhead .sat{color:' + COLOR.土 + '}',
    '.slot{margin:0 0 8px}',
    '.lab{display:block;font-size:12px;color:#666;margin:0 0 3px}',
    '.pick{position:relative}',
    '.pick select{display:block;width:100%;box-sizing:border-box;',
    'height:48px;padding:0 38px 0 12px;font:inherit;font-size:16px;',
    'border:1px solid ' + COLOR.枠線 + ';border-radius:8px;background:#fff;color:#333;',
    '-webkit-appearance:none;appearance:none}',
    '.pick::after{content:"";position:absolute;right:15px;top:50%;margin-top:-6px;',
    'width:9px;height:9px;pointer-events:none;transform:rotate(45deg);',
    'border-right:2px solid #8a8a8a;border-bottom:2px solid #8a8a8a}',
    '.slot.warn .lab{color:' + COLOR.日 + '}',
    '.slot.warn select{border-color:' + COLOR.日 + ';background:#fff5f5}',
    '.slot.warn .pick::after{border-color:' + COLOR.日 + '}',
    '.why{margin:12px 0 0}',
    '.whyhead{font-size:12px;color:#8a8a8a;margin:0 0 6px}',
    // はみ出したら折り返す。長い名前 1 つでも、min-width:0 と
    // overflow-wrap があればチップの中で折り返して幅に収まる
    '.chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.chip{min-width:0;max-width:100%;padding:4px 10px;border-radius:999px;',
    'overflow-wrap:anywhere;background:#f0f3f5;color:#555;font-size:12px;line-height:1.6}',
    '.chip.none{background:none;padding:0;color:#b8b8b8}',
    '.alert{font-size:13px;color:' + COLOR.日 + ';margin:6px 0 0;line-height:1.6}'
  ].join('');
}

/**
 * 当番表の画面の動き。
 * 選び直すたびに、同じ日のもう一方の候補を作り直す（シートのプルダウンは
 * 書いた時点で固まるので、ここだけは画面のほうが正しく出る）。
 */
function shiftJs_() {
  return [
    '(function(){',
    'var EMPTY="（決まっていません）";',
    'var list=document.getElementById("list");',
    'var msg=document.getElementById("msg");',
    'var ok=document.getElementById("ok");',
    'var start={};',
    // 名簿の全員。名簿から抜けた人が入っている枠は、その名前も残す
    'function fill(sel,keep){',
    'var opts=[""].concat(DATA.all);',
    'if(keep&&opts.indexOf(keep)<0){opts.push(keep);}',
    'sel.innerHTML="";',
    'opts.forEach(function(n){',
    'var o=document.createElement("option");o.value=n;o.textContent=n||EMPTY;',
    'if(n===keep){o.selected=true;}sel.appendChild(o);});',
    'sel.value=keep||"";}',
    // 1部制はラベルを置かない。枠が 1 つしかないので日付だけで足りる
    'function slot(row,kind,label){',
    'var box=document.createElement("div");box.className="slot";',
    'if(label){var lab=document.createElement("span");lab.className="lab";',
    'lab.textContent=label;box.appendChild(lab);}',
    'var pick=document.createElement("div");pick.className="pick";',
    'var sel=document.createElement("select");pick.appendChild(sel);box.appendChild(pick);',
    'box._sel=sel;box._kind=kind;box._row=row;',
    'return box;}',
    'DATA.rows.forEach(function(row){',
    'var card=document.createElement("div");card.className="dcard";',
    'var head=document.createElement("div");head.className="dhead";',
    'var wd=row.weekday==="日"?"sun":(row.weekday==="土"?"sat":"");',
    'head.textContent=DATA.ym.slice(5).replace(/^0/,"")+"/"+row.day+" ";',
    'var w=document.createElement("span");if(wd){w.className=wd;}',
    'w.textContent="("+row.weekday+")";head.appendChild(w);',
    'card.appendChild(head);',
    'var am=slot(row,"am",DATA.twoPart?"午前":"");card.appendChild(am);',
    'var pm=DATA.twoPart?slot(row,"pm","午後"):null;if(pm){card.appendChild(pm);}',
    // 名前は 1 つずつチップにして折り返す。1 行に並べると人数が多いとはみ出す
    'var why=document.createElement("div");why.className="why";',
    'var wh=document.createElement("div");wh.className="whyhead";',
    'wh.textContent="来られる人";why.appendChild(wh);',
    'var chips=document.createElement("div");chips.className="chips";',
    'var able=row.cands.length?row.cands:[""];',
    'able.forEach(function(n){var c=document.createElement("span");',
    'c.className=n?"chip":"chip none";c.textContent=n||"いません";chips.appendChild(c);});',
    'why.appendChild(chips);card.appendChild(why);',
    'var alert=document.createElement("p");alert.className="alert";card.appendChild(alert);',
    'row._am=am;row._pm=pm;row._alert=alert;',
    'start[row.day]={am:row.am,pm:row.pm};',
    'function redraw(){',
    'var a=am._sel.value,p=pm?pm._sel.value:"";',
    'var bad=[];',
    'if(!a){bad.push("午前");}',
    'if(pm&&!p){bad.push("午後");}',
    'am.className="slot"+(a?"":" warn");',
    'if(pm){pm.className="slot"+(p?"":" warn");}',
    'alert.textContent=bad.length?(DATA.twoPart?bad.join("と")+"が":"担当が")+"決まっていません。":"";}',
    'fill(am._sel,row.am);',
    'if(pm){fill(pm._sel,row.pm);}',
    'am._sel.onchange=redraw;',
    'if(pm){pm._sel.onchange=redraw;}',
    'redraw();',
    'list.appendChild(card);});',
    // 触った枠だけ送る。触っていない枠はシートを巻き添えにしない
    'function edited(){',
    'var out=[];',
    'DATA.rows.forEach(function(row){',
    'var one={day:row.day},any=false;',
    'var a=row._am._sel.value;',
    'if(a!==start[row.day].am){one.am=a;any=true;}',
    'if(row._pm){var p=row._pm._sel.value;',
    'if(p!==start[row.day].pm){one.pm=p;any=true;}}',
    'if(any){out.push(one);}});',
    'return out;}',
    'ok.onclick=function(){',
    'var slots=edited();',
    'if(!slots.length){msg.textContent="直したところがありません。";return;}',
    'ok.disabled=true;msg.textContent="送っています…";',
    'google.script.run.withSuccessHandler(function(res){',
    'if(res&&res.ok){',
    'document.getElementById("main").hidden=true;',
    'document.getElementById("bar").hidden=true;',
    'var fin=document.getElementById("fin");fin.hidden=false;fin.textContent=res.text;',
    'window.scrollTo(0,0);return;}',
    'ok.disabled=false;msg.textContent=(res&&res.text)||"保存できませんでした。";',
    '}).withFailureHandler(function(){',
    'ok.disabled=false;msg.textContent="送れませんでした。もう一度押してください。";',
    '}).webSaveShift(DATA.key,DATA.ym,slots);',
    '};',
    '})();'
  ].join('');
}
