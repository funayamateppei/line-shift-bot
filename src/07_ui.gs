/**
 * 画面と文面。
 *
 * ・操作はすべてボタン。文字入力は使わない（仕様 1-21）
 * ・年月は必ず「2026年9月」と書く（仕様 1-2）
 * ・用途を示す具体的な言葉は使わない（仕様 1-1）
 */

// ---------------------------------------------------------------- 部品

function text_(body) {
  return { type: 'text', text: body };
}

function postback_(label, data) {
  return { label: label, data: data };
}

/**
 * URL を開くボタン。
 * Flex の文字は URL を書いてもリンクにならない（自動でリンクになるのは
 * 普通のテキストメッセージだけ）。開かせたいときはボタンにする。
 */
function uri_(label, url) {
  return { label: label, uri: url };
}

/** 管理者にはいつでも押せるボタンを添える */
function withAdminMenu_(messages) {
  if (!messages.length) return messages;
  messages[messages.length - 1].quickReply = {
    items: [
      quickItem_('開始', 'a=start'),
      quickItem_('状況', 'a=status'),
      quickItem_('中止', 'a=cancel')
    ]
  };
  return messages;
}

function quickItem_(label, data) {
  return { type: 'action', action: { type: 'postback', label: label, data: data } };
}

/**
 * 文とボタンを 1 枚のカードにする。
 * 文がないときは本文の箱をまるごと置かない。中身の空の箱は送れない。
 */
function promptFlex_(altText, lines, actions) {
  var bubble = { type: 'bubble' };
  var body = (lines || []).filter(function (line) { return line; });
  if (body.length) {
    bubble.body = {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: body.map(function (line) {
        return { type: 'text', text: line, wrap: true, size: 'md', color: '#333333' };
      })
    };
  }
  if (actions && actions.length) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: actions.map(function (a) {
        if (a.uri) {
          return {
            type: 'button',
            style: 'link',
            height: 'sm',
            action: { type: 'uri', label: a.label, uri: a.uri }
          };
        }
        return {
          type: 'button',
          style: 'primary',
          color: COLOR.緑,
          height: 'sm',
          action: { type: 'postback', label: a.label, data: a.data }
        };
      })
    };
  }
  return { type: 'flex', altText: altText, contents: bubble };
}

// ---------------------------------------------------------------- カレンダー

/**
 * 1 か月のカレンダーカード。
 * opt: {
 *   altText, ym, title, lines,
 *   marked:[日],            緑にする日
 *   pressable:[日]|null,    押せる日。null なら全部押せる
 *   dataFor:function(day),  押したときの postback
 *   footer:{label, data}
 * }
 */
function calendarFlex_(opt) {
  var D = daysInMonth_(opt.ym);
  var first = firstWeekday_(opt.ym);
  var marked = {};
  (opt.marked || []).forEach(function (d) { marked[d] = true; });
  var pressable = null;
  if (opt.pressable) {
    pressable = {};
    opt.pressable.forEach(function (d) { pressable[d] = true; });
  }

  var head = { type: 'box', layout: 'horizontal', spacing: 'xs', contents: [] };
  WEEKDAY_JP.forEach(function (w, i) {
    head.contents.push({
      type: 'text',
      text: w,
      flex: 1,
      align: 'center',
      size: 'xs',
      weight: 'bold',
      color: i === 0 ? COLOR.日 : (i === 6 ? COLOR.土 : '#8a8a8a')
    });
  });

  var weeks = [];
  var row = [];
  for (var i = 0; i < first; i++) row.push(blankCell_());
  for (var d = 1; d <= D; d++) {
    row.push(dayCell_(d, marked[d] === true, pressable === null || pressable[d] === true, opt.dataFor));
    if (row.length === 7) { weeks.push(weekBox_(row)); row = []; }
  }
  if (row.length) {
    while (row.length < 7) row.push(blankCell_());
    weeks.push(weekBox_(row));
  }

  var body = { type: 'box', layout: 'vertical', spacing: 'sm', contents: [] };
  body.contents.push({
    type: 'text', text: ymLabel_(opt.ym), weight: 'bold', size: 'lg', color: COLOR.ヘッダー背景
  });
  (opt.lines || []).forEach(function (line) {
    body.contents.push({ type: 'text', text: line, wrap: true, size: 'sm', color: '#666666' });
  });
  body.contents.push({ type: 'separator', margin: 'md' });
  body.contents.push(head);
  weeks.forEach(function (w) { body.contents.push(w); });

  var bubble = { type: 'bubble', size: 'giga', body: body };
  if (opt.footer) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [{
        type: 'button',
        style: 'primary',
        color: COLOR.緑,
        height: 'sm',
        action: { type: 'postback', label: opt.footer.label, data: opt.footer.data }
      }]
    };
  }
  return { type: 'flex', altText: opt.altText, contents: bubble };
}

function weekBox_(cells) {
  return { type: 'box', layout: 'horizontal', spacing: 'xs', contents: cells };
}

function blankCell_() {
  return {
    type: 'box', layout: 'vertical', flex: 1, height: '38px',
    contents: [{ type: 'filler' }]
  };
}

function dayCell_(day, isMarked, canPress, dataFor) {
  var cell = {
    type: 'box',
    layout: 'vertical',
    flex: 1,
    height: '38px',
    cornerRadius: '6px',
    justifyContent: 'center',
    backgroundColor: isMarked ? COLOR.緑 : (canPress ? '#ffffff' : '#f7f7f7'),
    borderWidth: '1px',
    borderColor: isMarked ? COLOR.緑 : (canPress ? COLOR.枠線 : '#f0f0f0'),
    contents: [{
      type: 'text',
      text: String(day),
      align: 'center',
      size: 'sm',
      weight: isMarked ? 'bold' : 'regular',
      color: isMarked ? '#ffffff' : (canPress ? '#333333' : '#c6cbd1')
    }]
  };
  if (canPress && dataFor) {
    cell.action = { type: 'postback', data: dataFor(day) };
  }
  return cell;
}

/** 1〜その月の日数のボタン */
function numberGridFlex_(ym) {
  var D = daysInMonth_(ym);
  var rows = [];
  var row = [];
  for (var d = 1; d <= D; d++) {
    row.push(dayCell_(d, false, true, function (n) { return 'a=num&v=' + n; }));
    if (row.length === 7) { rows.push(weekBox_(row)); row = []; }
  }
  if (row.length) {
    while (row.length < 7) row.push(blankCell_());
    rows.push(weekBox_(row));
  }
  return {
    type: 'flex',
    altText: '当番の日数を選んでください',
    contents: {
      type: 'bubble',
      size: 'giga',
      body: { type: 'box', layout: 'vertical', spacing: 'xs', contents: rows }
    }
  };
}

// ---------------------------------------------------------------- 一覧の文

/** 「Aさん、Bさん」 */
function nameList_(people) {
  return people.map(function (p) { return p.name || '名前未取得'; }).join('、');
}

/** コピーしてグループに送ってもらう文 */
function askCopyText_(pendingPeople, notAddedPeople) {
  var parts = [];
  if (pendingPeople.length) {
    parts.push(pendingPeople.map(function (p) {
      return (p.name || '名前未取得') + 'さん';
    }).join('、') + '、回答お願いします。');
  }
  if (notAddedPeople.length) {
    parts.push(notAddedPeople.map(function (p) {
      return (p.name || '名前未取得') + 'さん';
    }).join('、') + '、Bot の友だち追加をお願いします。');
  }
  return parts.join('');
}

/**
 * 当番表の本文。日付ごとに区切って読ませる。
 *
 *   9/3
 *   午前 Aさん
 *   午後 Bさん
 *
 *   9/5
 *   午前 Cさん
 *   午後 —
 *
 * 1部制は日付の下に名前を 1 行だけ。
 */
function shiftText_(ym, part, rows) {
  var m = ymMonth_(ym);
  var blocks = rows.map(function (r) {
    var head = m + '/' + r.day;
    if (part === PART.二部) {
      return head + '\n午前 ' + person_(r.am) + '\n午後 ' + person_(r.pm);
    }
    return head + '\n' + person_(r.am);
  });
  return blocks.join('\n\n');
}

function person_(name) {
  if (!name || name === '—') return '—';
  return name + 'さん';
}

/** 決まっていない枠の、コピー用の文 */
function shortageCopyText_(ym, part, rows) {
  var labels = [];
  rows.forEach(function (r) {
    var head = ymLabel_(ym) + r.day + '日';
    if (part !== PART.二部) {
      if (!r.am) labels.push(head);
      return;
    }
    // 午前も午後も決まっていない日は、まとめて 1 つに書く
    if (!r.am && !r.pm) { labels.push(head); return; }
    if (!r.am) labels.push(head + '(午前)');
    if (!r.pm) labels.push(head + '(午後)');
  });
  if (!labels.length) return '';
  return labels.join('、') + 'の担当が決まっていません。ご都合がつく方は連絡をお願いします。';
}

