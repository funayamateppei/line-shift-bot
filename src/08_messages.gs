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

/** 5.4 日数をたずねる */
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

/**
 * 5.5 たたき台のカレンダー。
 *
 * カードは見せるだけ。付け外しと〔この日程でOK〕は画面のなかにある。
 * Flex は送ったあとに書き換えられないので、カードの上で選ばせると
 * 1 タップごとにカードを送り直すことになる。
 */
function msgDraft_(ym, days, isFirst, prefix, url) {
  if (!url) return withAdminMenu_(msgNoEntry_());

  var lines = [];
  if (prefix) lines.push(prefix);
  if (isFirst) {
    lines.push(ymLabel_(ym) + 'に' + days.length + '日、均等に散らした案です。');
  } else {
    lines.push('いま' + days.length + '日です。');
  }
  lines.push('〔日程を直す〕を押すと画面がひらきます。');
  lines.push('画面で日付を付け外しして〔この日程でOK〕を押してください。');

  return withAdminMenu_([
    calendarFlex_({
      altText: ymLabel_(ym) + 'の当番の日',
      ym: ym,
      lines: lines,
      marked: days,
      pressable: null,
      actions: [uri_('日程を直す', url)]
    })
  ]);
}

// ---------------------------------------------------------------- 6. メンバー

/**
 * 6.1 都合がつく日をたずねるカレンダー。
 * カードは当番の日を見せるだけ。選ぶのは画面のなか（msgDraft_ と同じ理由）。
 */
function msgAskAvailability_(ym, workDays, url, prefix) {
  if (!url) return msgNoEntry_();

  var lines = [];
  if (prefix) lines.push(prefix);
  lines.push(ymLabel_(ym) + 'の当番の日です。');
  lines.push('〔都合を選ぶ〕を押すと画面がひらきます。');
  lines.push('都合がつく日を押して〔確定〕を押してください。');

  return [
    calendarFlex_({
      altText: ymLabel_(ym) + 'の当番で都合がつく日を選んでください',
      ym: ym,
      lines: lines,
      marked: [],
      pressable: workDays,
      actions: [uri_('都合を選ぶ', url)]
    })
  ];
}

/**
 * 入口 URL が作れないとき。
 * ウェブアプリを公開していないか、設定シートの「入口URL」が要る状態。
 */
function msgNoEntry_() {
  return [text_(
    '画面をひらけませんでした。\n'
    + 'ウェブアプリが公開されているか、設定シートの「入口URL」を確かめてください。'
  )];
}

/** 差し替え前のカードを押されたが、いま開けるものがないとき */
function msgOldCard_() {
  return [text_('この操作は画面に移りました。\nいま開けるものはありません。')];
}

/** 6.1 未追加の人へ、グループでお願いする */
function msgAskFriendAdd_(ym, people) {
  var body = ymLabel_(ym) + 'の当番の相談を送るため、この Bot を友だち追加してください。\n'
    + '追加していただいた方から順にお聞きしています。';
  return { mention: mentionText_(people, body), plain: plainMentionText_(people, body) };
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
    openSheet_(ym)
  ]));
  return withAdminMenu_(messages);
}

/**
 * 7.2 当番表のシートを開くボタン。
 * URL を直接ひらくので、押してから開くまでに 1 手はさまらない。
 */
function openSheet_(ym) {
  return uri_('担当を入れ替える（表を開く）', sheetUrl_(yearSheetName_(ym)));
}

/** 7.3 グループへ送る当番表 */
function msgPublish_(ym, part, rows) {
  return [text_(ymLabel_(ym) + 'の当番表です。\n' + shiftText_(ym, part, rows))];
}

/** 7.3 グループに送れなかった */
function msgPublishFailed_(ym) {
  return withAdminMenu_([
    promptFlex_('グループに送れませんでした', [
      'グループに送れませんでした。',
      'しばらく待ってから、もう一度〔グループに送る〕を押してください。'
    ], [
      postback_('グループに送る', 'a=publish'),
      openSheet_(ym)
    ])
  ]);
}

/** 7.3 当番表が当番の日とそろっていない */
function msgNoShift_(ym, wantCount, gotCount) {
  return withAdminMenu_([
    promptFlex_('当番表を確かめてください', [
      ymLabel_(ym) + 'の当番表が、決めた日程とそろっていません。',
      '決めた日は' + wantCount + '日、表にあるのは' + gotCount + '日です。',
      '行を消したり「日」の欄を書き換えたりしていないか、表を開いて確かめてください。'
    ], [openSheet_(ym)])
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
  lines.push(counts.join(' '));

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
    return (p.name || '名前未取得') + 'さん';
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

  // どの月の・何人についての確認だったかをボタンに持たせる。
  // このカードはトークに残り続けるので、あとから押されたときに
  // 別の月の人を巻き込まないようにする
  var data = 'a=skip&c=1&ym=' + ym
    + '&n=' + pendingPeople.length + '&m=' + notAddedPeople.length;

  return withAdminMenu_([
    promptFlex_('この人抜きで進めてよろしいですか？', lines, [
      postback_('この人抜きで進める', data),
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

/** 8.2 状況を押したところで集計が走った */
function msgAggregatedNow_(ym) {
  return withAdminMenu_([
    promptFlex_('当番表を送りました', [
      ymLabel_(ym) + 'の当番表ができました。別のメッセージで送っています。',
      '届いていないときは、もう一度〔状況〕を押してください。'
    ], [postback_('状況', 'a=status')])
  ]);
}

/** 8.2 状況：公開済み */
function msgStatusPublished_(ym) {
  return withAdminMenu_([
    promptFlex_(ymLabel_(ym) + '分は公開済みです', [ymLabel_(ym) + '分は公開済みです。'],
      [postback_('開始', 'a=start')])
  ]);
}

/** 8.4 進行中に開始を押したときの前置き */
function alreadyStartedPrefix_(ym) {
  if (!ym) return 'すでに当番づくりを始めています。続きはこちらです。';
  return 'すでに' + ymLabel_(ym) + '分は開始されています。続きはこちらです。';
}

/** 8.6 混み合って順番が回ってこなかった */
function msgBusy_() {
  return [text_('いま混み合っています。\nもう一度押してください。')];
}

/** 8.5 中止 */
function msgCancelled_() {
  return withAdminMenu_([text_('中止しました。')]);
}
