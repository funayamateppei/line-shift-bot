/**
 * 送る文の一覧。仕様 4〜8 の文面をそのまま置く。
 * 文言を直すときはここだけを見ればよい。
 */

// ---------------------------------------------------------------- 4. 導入

/** 4.2 友だち追加された */
function msgFollowed_() {
  return [text_('友だち追加ありがとうございます。\n当番の相談はこちらに届きます。')];
}

/** 4.3 Bot がグループに招待された */
function msgJoinedGroup_() {
  return [text_('当番の連絡を担当する Bot です。\nこの Bot を友だち追加してください。\n当番の相談はこの Bot から届きます。')];
}

/** 4.4 新しい人がグループに参加した */
function msgMemberJoined_(name) {
  var head = name ? name + 'さん、はじめまして。' : 'はじめまして。';
  return [text_(head + '\n当番の相談を送るため、この Bot を友だち追加してください。')];
}

// ---------------------------------------------------------------- 5. 管理者（前半）

/** 5.1 お知らせ */
function msgNotice_(ym) {
  return withAdminMenu_([
    promptFlex_(ymLabel_(ym) + '分の当番づくりを始めますか？',
      [ymLabel_(ym) + '分の当番づくりを始めますか？'],
      [postback_('開始', 'a=start')])
  ]);
}

/** 選べる対象月。当月・翌月・翌々月 */
function monthChoices_(now) {
  var base = ymOf_(now);
  var next = nextYm_(base);
  return [base, next, nextYm_(next)];
}

/** 5.2 何月分を作るかたずねる。当月・翌月・翌々月から選ぶ */
function msgAskMonth_(now, prefix) {
  var choices = monthChoices_(now);
  var lines = [];
  if (prefix) lines.push(prefix);
  lines.push('何月分の当番づくりをしますか？');
  return withAdminMenu_([
    promptFlex_('何月分の当番づくりをしますか？', lines,
      choices.map(function (ym) {
        return postback_(ymLabel_(ym) + '分', 'a=ym&v=' + ym);
      }))
  ]);
}

/** 5.3 部制をたずねる */
function msgAskPart_(ym, prefix) {
  var lines = [];
  if (prefix) lines.push(prefix);
  lines.push(ymLabel_(ym) + '分の当番づくりを始めます。');
  lines.push('1日の担当人数を選んでください。');
  return withAdminMenu_([
    promptFlex_('1日の担当人数を選んでください', lines, [
      postback_('1部制（1人）', 'a=part&v=1'),
      postback_('2部制（午前・午後）', 'a=part&v=2')
    ])
  ]);
}

/** 5.3 日数をたずねる */
function msgAskCount_(ym, part, prefix) {
  var lines = [];
  if (prefix) lines.push(prefix);
  lines.push(part + 'ですね。');
  lines.push(ymLabel_(ym) + 'の当番の日数を選んでください。');
  return withAdminMenu_([
    text_(lines.join('\n')),
    numberGridFlex_(ym)
  ]);
}

/** 5.4 たたき台のカレンダー */
function msgDraft_(ym, days, isFirst, prefix) {
  var lines = [];
  if (prefix) lines.push(prefix);
  if (isFirst) {
    lines.push(ymLabel_(ym) + 'に' + days.length + '日、均等に散らした案です。');
    lines.push('日付を押すと当番の日を付け外しできます。');
  } else {
    lines.push('いま' + days.length + '日です。');
  }
  lines.push('よければ〔この日程でOK〕を押してください。');

  return withAdminMenu_([
    calendarFlex_({
      altText: ymLabel_(ym) + 'の当番の日',
      ym: ym,
      lines: lines,
      marked: days,
      pressable: null,
      dataFor: function (d) { return 'a=atog&d=' + d; },
      footer: { label: 'この日程でOK', data: 'a=aok' }
    })
  ]);
}

/** 5.4 0 日のまま押された */
function msgNeedOneDay_() {
  return withAdminMenu_([text_('1日以上選んでください。')]);
}

/** 5.5 日程を確定した */
function msgFixed_(ym, days) {
  return withAdminMenu_([
    promptFlex_(ymLabel_(ym) + 'の当番の日を確定しました', [
      ymLabel_(ym) + 'の当番の日を確定しました（' + days.length + '日）。',
      daysLabel_(ym, days),
      'メンバーに都合を聞きます。全員の回答がそろったら当番表を送ります。'
    ], [postback_('状況', 'a=status')])
  ]);
}

// ---------------------------------------------------------------- 6. メンバー

/** 6.1 都合がつく日をたずねるカレンダー */
function msgAskAvailability_(ym, workDays, selected) {
  return [
    calendarFlex_({
      altText: ymLabel_(ym) + 'の当番で都合がつく日を選んでください',
      ym: ym,
      lines: [
        ymLabel_(ym) + 'の当番で、都合がつく日を押してください。',
        '押した日は緑になります。',
        '選び終わったら〔確定〕を押してください。'
      ],
      marked: selected || [],
      pressable: workDays,
      dataFor: function (d) {
        return 'a=mtog&ym=' + ym + '&s=' + daysToMask_(selected || []) + '&d=' + d;
      },
      footer: { label: '確定', data: 'a=mok&ym=' + ym + '&s=' + daysToMask_(selected || []) }
    })
  ];
}

/** 6.1 未追加の人へ、グループでお願いする */
function msgAskFriendAdd_(ym, people) {
  var body = ymLabel_(ym) + 'の当番の相談を送るため、この Bot を友だち追加してください。\n'
    + '追加していただいた方から順にお聞きしています。';
  return { mention: mentionText_(people, body), plain: plainMentionText_(people, body) };
}

/** 6.2 回答を受け付けた */
function msgAnswerTaken_(ym, days) {
  var list = days.length ? daysLabel_(ym, days) : '都合がつく日なし';
  return [text_(
    'ありがとうございます。' + ymLabel_(ym) + 'は次の日で受け付けました。\n'
    + list + '\n'
    + '変えたいときは、もう一度カレンダーで選んで〔確定〕を押してください。'
  )];
}

/** 6.2 1 日も選ばずに確定した 1 回目 */
function msgConfirmZero_(ym) {
  return [
    promptFlex_('都合がつく日がないということでよろしいですか？', [
      '1日も選ばれていません。',
      ymLabel_(ym) + 'は都合がつく日がない、ということでよろしいですか？',
      'よろしければもう一度〔確定〕を押してください。'
    ], [postback_('確定', 'a=mok&ym=' + ym + '&s=0&c=1')])
  ];
}

/** 6.3 受け付けられないとき */
function msgClosed_(ym, isJustAggregated) {
  var body = ymLabel_(ym) + '分の回答は締め切りました。';
  if (isJustAggregated) body += '\n変更は管理者に連絡してください。';
  return [text_(body)];
}

// ---------------------------------------------------------------- 7. 管理者（後半）

/**
 * 7.1 当番表。
 * lead は先頭に添える 1 行。集計が終わった直後と、あとから見に来たときで変わる。
 */
function msgShift_(ym, part, rows, lead) {
  var messages = [];
  var shortage = shortageCopyText_(ym, part, rows);
  if (shortage) {
    messages.push(text_(
      '担当が決まらなかった日があります。\n'
      + '表を直してから〔グループに送る〕を押してください。\n'
      + 'グループで協力を募るときは、次の文をコピーして送ってください。'
    ));
    messages.push(text_(shortage));
  }
  messages.push(text_(
    (lead ? lead + '\n' : '') + ymLabel_(ym) + 'の当番表です。\n' + shiftText_(ym, part, rows)
  ));
  messages.push(promptFlex_(ymLabel_(ym) + 'の当番表', [], [
    postback_('グループに送る', 'a=publish'),
    postback_('担当を入れ替える（表を開く）', 'a=open')
  ]));
  return withAdminMenu_(messages);
}

/** 7.2 表を開く */
function msgOpenSheet_(url) {
  return withAdminMenu_([
    promptFlex_('当番表を開いて担当を直してください', [
      '当番表を開いて担当を直してください。',
      '直したあと〔グループに送る〕を押すと、シートの内容でそのまま送ります。',
      url
    ], [postback_('グループに送る', 'a=publish')])
  ]);
}

/** 7.3 グループへ送る当番表 */
function msgPublish_(ym, part, rows) {
  return [text_(ymLabel_(ym) + 'の当番表です。\n' + shiftText_(ym, part, rows))];
}

/** 7.3 グループに送れなかった */
function msgPublishFailed_() {
  return withAdminMenu_([
    promptFlex_('グループに送れませんでした', [
      'グループに送れませんでした。',
      'しばらく待ってから、もう一度〔グループに送る〕を押してください。'
    ], [
      postback_('グループに送る', 'a=publish'),
      postback_('担当を入れ替える（表を開く）', 'a=open')
    ])
  ]);
}

/** 7.3 グループが登録されていない */
function msgNoGroup_() {
  return withAdminMenu_([
    promptFlex_('送り先のグループがわかりません', [
      '送り先のグループがわかりません。',
      'Bot をグループに招待してください。招待すると送れるようになります。'
    ], [postback_('グループに送る', 'a=publish')])
  ]);
}

/** 7.3 送ったあとの返事 */
function msgPublished_(ym) {
  return withAdminMenu_([text_('グループに送りました。' + ymLabel_(ym) + '分はこれで完了です。')]);
}

// ---------------------------------------------------------------- 8. 途中操作

/** 8.1 締切日の連絡 */
function msgDue_(ym, pendingPeople, notAddedPeople) {
  var lines = [ymLabel_(ym) + 'の回答がまだそろっていません。'];
  if (pendingPeople.length) lines.push('未回答：' + nameList_(pendingPeople));
  if (notAddedPeople.length) lines.push('未追加：' + nameList_(notAddedPeople));
  lines.push('次の文をコピーしてグループに送ってください。');
  return withAdminMenu_([
    text_(lines.join('\n')),
    text_(askCopyText_(pendingPeople, notAddedPeople))
  ]);
}

/** 8.2 状況：何も進めていない */
function msgStatusIdle_() {
  return withAdminMenu_([
    promptFlex_('いま進めているものはありません', ['いま進めているものはありません。'],
      [postback_('開始', 'a=start')])
  ]);
}

/** 8.2 状況：日程を決めている途中 */
function msgStatusPlanning_(ym) {
  var body = ym ? ymLabel_(ym) + '分の日程を決めている途中です。'
                : '何月分を作るか選んでいる途中です。';
  return withAdminMenu_([
    promptFlex_(body, [body], [postback_('中止', 'a=cancel')])
  ]);
}

/** 8.2 状況：回答受付中 */
function msgStatusWaiting_(ym, answeredCount, pendingPeople, notAddedPeople, prefix) {
  var lines = [];
  if (prefix) lines.push(prefix);
  lines.push(ymLabel_(ym) + '分の回答を受け付け中です。');
  var counts = ['回答済み：' + answeredCount + '人'];
  if (pendingPeople.length) counts.push('未回答：' + nameList_(pendingPeople));
  if (notAddedPeople.length) counts.push('未追加：' + nameList_(notAddedPeople));
  lines.push(counts.join('　'));

  var messages = [];
  var copy = askCopyText_(pendingPeople, notAddedPeople);
  if (copy) {
    lines.push('次の文をコピーしてグループに送れます。');
    messages.push(text_(lines.join('\n')));
    messages.push(text_(copy));
  } else {
    messages.push(text_(lines.join('\n')));
  }
  var actions = [];
  if (pendingPeople.length || notAddedPeople.length) {
    actions.push(postback_('この人抜きで進める', 'a=skip'));
  }
  actions.push(postback_('中止', 'a=cancel'));
  messages.push(promptFlex_('操作', [], actions));
  return withAdminMenu_(messages);
}

/** 「Aさん、Bさん」 */
function withSan_(people) {
  return people.map(function (p) {
    return (p.name || nameOf_(p.userId)) + 'さん';
  }).join('、');
}

/** 8.3 進める前に一度たずねる */
function msgConfirmSkip_(ym, pendingPeople, notAddedPeople) {
  var lines = [];
  if (pendingPeople.length) {
    lines.push(withSan_(pendingPeople) + 'は、' + ymLabel_(ym) + 'は都合がつく日なしとして進めます。');
  }
  if (notAddedPeople.length) {
    lines.push(withSan_(notAddedPeople) + 'は名簿から外します。友だち追加すればまた入ります。');
  }
  lines.push('よろしければもう一度〔この人抜きで進める〕を押してください。');

  return withAdminMenu_([
    promptFlex_('この人抜きで進めてよろしいですか？', lines, [
      postback_('この人抜きで進める', 'a=skip&c=1'),
      postback_('やめる', 'a=status')
    ])
  ]);
}

/** 8.3 進めた */
function msgSkipped_(ym, pendingPeople, notAddedPeople) {
  var lines = [];
  if (pendingPeople.length) {
    lines.push(withSan_(pendingPeople) + 'を' + ymLabel_(ym) + 'は都合がつく日なしとしました。');
  }
  if (notAddedPeople.length) {
    lines.push(withSan_(notAddedPeople) + 'を名簿から外しました。');
  }
  lines.push('残りの人で当番表を作ります。');
  lines.push('この先ずっと外したいときは、名簿シートでその人の行を削除してください。');
  return withAdminMenu_([text_(lines.join('\n'))]);
}

/** 8.3 全員がいなくなってしまうので進められない */
function msgSkipAll_() {
  return withAdminMenu_([
    promptFlex_('全員がいなくなってしまいます', [
      '進めると当番を割り当てられる人がいなくなります。',
      'このまま待つか、〔中止〕してやり直してください。'
    ], [postback_('中止', 'a=cancel')])
  ]);
}

/** 8.2 状況：公開済み */
function msgStatusPublished_(ym) {
  return withAdminMenu_([
    promptFlex_(ymLabel_(ym) + '分は公開済みです', [ymLabel_(ym) + '分は公開済みです。'],
      [postback_('開始', 'a=start')])
  ]);
}

/** 8.3 進行中に開始を押したときの前置き */
function alreadyStartedPrefix_(ym) {
  if (!ym) return 'すでに当番づくりを始めています。続きはこちらです。';
  return 'すでに' + ymLabel_(ym) + '分は開始されています。続きはこちらです。';
}

/** 混み合って順番が回ってこなかった */
function msgBusy_() {
  return [text_('いま混み合っています。\nもう一度押してください。')];
}

/** 8.4 中止 */
function msgCancelled_() {
  return withAdminMenu_([text_('中止しました。')]);
}
