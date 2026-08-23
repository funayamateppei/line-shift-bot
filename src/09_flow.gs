/**
 * ボタンを押されたときの処理。
 *
 * 状態は処理の最後に 1 回だけ書く。途中で失敗しても中途半端な状態が残らない。
 */

// ---------------------------------------------------------------- 管理者

/** 8.3 開始。進行中ならその段階のカードを出しなおす */
function onStart_(replyToken) {
  var st = state_();

  if (!isRunning_(st) || st.stage === STAGE.公開済み) {
    reply_(replyToken, msgAskMonth_(new Date(), null));
    saveState_({ ym: '', stage: STAGE.対象月待ち, part: '', days: [] });
    return;
  }

  var prefix = alreadyStartedPrefix_(st.ym);
  switch (st.stage) {
    case STAGE.対象月待ち:
      reply_(replyToken, msgAskMonth_(new Date(), prefix));
      return;
    case STAGE.部制待ち:
      reply_(replyToken, msgAskPart_(st.ym, prefix));
      return;
    case STAGE.日数待ち:
      reply_(replyToken, msgAskCount_(st.ym, st.part, prefix));
      return;
    case STAGE.日程編集中:
      reply_(replyToken, msgDraft_(st.ym, st.days, false, prefix));
      return;
    case STAGE.回答受付中:
      reply_(replyToken, statusWaitingMessages_(st.ym, prefix));
      return;
    case STAGE.確認待ち:
      reply_(replyToken, shiftMessages_(st.ym, prefix));
      return;
    default:
      // 状態シートを手で書き換えられて知らない段階になっていたら、始めからやり直す
      clearState_();
      onStart_(replyToken);
  }
}

/**
 * 5.2 何月分を作るかを選んだ。
 * 押した瞬間の翌月を機械が決めると、公開した直後に押したときに同じ月をもう一度
 * 始めてしまったり、お知らせを遅れて押したときに月が飛んだりする。管理者に選ばせる。
 */
function onPickMonth_(replyToken, value) {
  var st = state_();
  if (st.stage !== STAGE.対象月待ち) { onStart_(replyToken); return; }

  // 見せた 3 つ以外は受け付けない。古いカードや壊れた値で
  // 「2026年13月」のような月に進んでしまうのを防ぐ
  if (monthChoices_(new Date()).indexOf(String(value || '')) < 0) {
    reply_(replyToken, msgAskMonth_(new Date(), null));
    return;
  }

  reply_(replyToken, msgAskPart_(value, null));
  saveState_({ ym: value, stage: STAGE.部制待ち, part: '', days: [] });
}

/** 5.3 部制を選んだ */
function onPart_(replyToken, value) {
  var st = state_();
  if (st.stage !== STAGE.部制待ち) { onStart_(replyToken); return; }

  var part = value === '2' ? PART.二部 : PART.一部;
  reply_(replyToken, msgAskCount_(st.ym, part, null));
  saveState_({ ym: st.ym, stage: STAGE.日数待ち, part: part, days: [] });
}

/** 5.4 日数を選んだ。たたき台を出す */
function onCount_(replyToken, value) {
  var st = state_();
  if (st.stage !== STAGE.日数待ち) { onStart_(replyToken); return; }

  var count = parseInt(value, 10);
  if (isNaN(count) || count < 1) { onStart_(replyToken); return; }

  var days = spreadDays_(st.ym, count);
  reply_(replyToken, msgDraft_(st.ym, days, true, null));
  saveState_({ ym: st.ym, stage: STAGE.日程編集中, part: st.part, days: days });
}

/**
 * 5.4 たたき台の日付を押した。
 * 編集の途中を〔開始〕でたどり直せるように、選んでいる日はその都度残す。
 * メンバーには何も送らない。
 */
function onAdminToggle_(replyToken, day) {
  var st = state_();
  if (st.stage !== STAGE.日程編集中) { onStart_(replyToken); return; }
  if (isNaN(day) || day < 1 || day > daysInMonth_(st.ym)) {
    reply_(replyToken, msgDraft_(st.ym, st.days, false, null));
    return;
  }

  var days = st.days.slice();
  var i = days.indexOf(day);
  if (i >= 0) days.splice(i, 1); else days.push(day);
  days.sort(function (a, b) { return a - b; });

  reply_(replyToken, msgDraft_(st.ym, days, false, null));
  saveState_({ ym: st.ym, stage: STAGE.日程編集中, part: st.part, days: days });
}

/** 5.5 この日程でOK。ここで初めてメンバーへ送る */
function onFixDays_(replyToken) {
  var st = state_();
  if (st.stage !== STAGE.日程編集中) { onStart_(replyToken); return; }
  if (!st.days.length) { reply_(replyToken, msgNeedOneDay_()); return; }

  // 受付を始める前に、その月の古い回答を消す。
  // 一度作った月をもう一度選び直したとき、前回の回答が「回答済み」として
  // 数えられ、誰か 1 人の確定で集計が走ってしまうのを防ぐ。
  clearAnswers_(st.ym);

  reply_(replyToken, msgFixed_(st.ym, st.days));
  saveState_({ ym: st.ym, stage: STAGE.回答受付中, part: st.part, days: st.days });

  sendCalendars_(st.ym, st.days);
}

/** 追加済みの人へカレンダーを送り、未追加の人にはグループでお願いする */
function sendCalendars_(ym, workDays) {
  members_().forEach(function (p) {
    push_(p.userId, msgAskAvailability_(ym, workDays, []));
  });

  var waiting = notAdded_();
  if (!waiting.length) return;

  var s = settings_();
  if (!s.groupId) return;

  var built = msgAskFriendAdd_(ym, waiting);
  var res = lineCall_('POST', LINE_API + '/message/push', {
    to: s.groupId,
    messages: [built.mention]
  });
  if (!isOk_(res)) push_(s.groupId, [built.plain]);
}

/** 8.2 状況 */
function onStatus_(replyToken) {
  var st = state_();

  // 送信に失敗するなどで集計のきっかけを取りこぼしていた場合の受け皿。
  // 条件がそろっていればここで集計する。当番表は集計のなかで送るので、
  // ここで返すと同じ表が 2 度届いてしまう
  if (st.stage === STAGE.回答受付中) maybeAggregate_();

  st = state_();
  switch (st.stage) {
    case STAGE.対象月待ち:
    case STAGE.部制待ち:
    case STAGE.日数待ち:
    case STAGE.日程編集中:
      reply_(replyToken, msgStatusPlanning_(st.ym));
      return;
    case STAGE.回答受付中:
      reply_(replyToken, statusWaitingMessages_(st.ym, null));
      return;
    case STAGE.確認待ち:
      // 当番表そのものを返す。集計のときの送信に失敗していても、ここで取り出せる
      reply_(replyToken, shiftMessages_(st.ym, '当番表を確認中です。'));
      return;
    case STAGE.公開済み:
      reply_(replyToken, msgStatusPublished_(st.ym));
      return;
    default:
      reply_(replyToken, msgStatusIdle_());
  }
}

function statusWaitingMessages_(ym, prefix) {
  var answered = answersFor_(ym);
  // 数えるのはいまのメンバーだけ。抜けた人の回答は残っているが人数には入れない
  var count = members_().filter(function (p) {
    return Object.prototype.hasOwnProperty.call(answered, p.userId);
  }).length;
  return msgStatusWaiting_(ym, count, pending_(ym), notAdded_(), prefix);
}

/**
 * 8.4 中止。
 * その月の回答も消す。消さないと、同じ月をやり直したときに前回の回答が
 * 「回答済み」として数えられ、誰か 1 人の確定で集計が走ってしまう。
 */
function onCancel_(replyToken) {
  var st = state_();
  // 公開まで終わった月の記録は消さない。誤って押しても失われないように
  var target = (st.stage === STAGE.回答受付中 || st.stage === STAGE.確認待ち) ? st.ym : '';

  clearState_();
  reply_(replyToken, msgCancelled_());
  clearAnswers_(target);   // 時間がかかるので状態と返事のあとに
}

/**
 * 8.2 未追加の人を名簿から外して進める。
 * ブロックされた人などが残ると「未追加ゼロ」にならず、集計が永久に走らない。
 * そこから抜け出すための操作。
 */
function onSkipNotAdded_(replyToken) {
  var st = state_();
  if (st.stage !== STAGE.回答受付中) { onStatus_(replyToken); return; }

  var waiting = notAdded_();
  if (!waiting.length) { onStatus_(replyToken); return; }

  waiting.forEach(function (p) { rosterUpsert_(p.userId, { inGroup: false }); });
  reply_(replyToken, msgSkippedNotAdded_(waiting));

  maybeAggregate_();
}

/** 7.2 表を開く */
function onOpenSheet_(replyToken) {
  var st = state_();
  if (st.stage !== STAGE.確認待ち) { onStatus_(replyToken); return; }
  reply_(replyToken, msgOpenSheet_(sheetUrl_(yearSheetName_(st.ym))));
}

/**
 * 7.3 グループに送る。シートの最新内容をそのまま送る。
 * 送れなかったときは段階を進めない。押し直せば送り直せる。
 */
function onPublish_(replyToken) {
  var st = state_();
  if (st.stage !== STAGE.確認待ち) { onStatus_(replyToken); return; }

  var s = settings_();
  if (!s.groupId) { reply_(replyToken, msgNoGroup_()); return; }

  var shift = readShift_(st.ym);
  if (!push_(s.groupId, msgPublish_(st.ym, shift.part || st.part, shift.rows))) {
    reply_(replyToken, msgPublishFailed_());
    return;
  }

  reply_(replyToken, msgPublished_(st.ym));
  saveState_({ ym: st.ym, stage: STAGE.公開済み, part: st.part, days: st.days });
}

// ---------------------------------------------------------------- メンバー

/** 6.1 カレンダーの日付を押した。押しただけでは保存しない */
function onMemberToggle_(replyToken, ym, mask, day) {
  var st = state_();
  if (st.stage !== STAGE.回答受付中 || st.ym !== ym) {
    reply_(replyToken, msgClosed_(ym, false));
    return;
  }
  var selected = maskToDays_(toggleInMask_(mask, day));
  reply_(replyToken, msgAskAvailability_(ym, st.days, selected));
}

/** 6.2 確定 */
function onMemberConfirm_(replyToken, userId, ym, mask, confirmedZero) {
  var st = state_();

  if (st.ym !== ym || st.stage !== STAGE.回答受付中) {
    var justAggregated = (st.ym === ym && st.stage !== STAGE.なし);
    reply_(replyToken, msgClosed_(ym, justAggregated));
    return;
  }

  var selected = maskToDays_(mask).filter(function (d) {
    return st.days.indexOf(d) >= 0;
  });

  if (!selected.length && !confirmedZero) {
    reply_(replyToken, msgConfirmZero_(ym));
    return;
  }

  appendAnswer_(ym, userId, nameOf_(userId), selected);
  reply_(replyToken, msgAnswerTaken_(ym, selected));

  maybeAggregate_();
}

// ---------------------------------------------------------------- 集計

/**
 * 6.4 未追加ゼロ かつ 未回答ゼロ になった瞬間に 1 回だけ集計する。
 * メンバーには何も送らない。
 */
function maybeAggregate_() {
  var st = state_();
  if (st.stage !== STAGE.回答受付中) return false;
  if (notAdded_().length) return false;

  var people = members_();
  if (!people.length) return false;
  if (pending_(st.ym).length) return false;

  aggregate_(st);
  return true;
}

/** 割り当てて、シートに書いて、管理者に送る */
function aggregate_(st) {
  var people = members_();
  var answers = answersFor_(st.ym);
  var ids = people.map(function (p) { return p.userId; });

  var availability = {};
  ids.forEach(function (id) { availability[id] = answers[id] || []; });

  var isTwoPart = st.part === PART.二部;
  var assigned = buildShift_(st.days, isTwoPart, availability, ids);

  var nameById = {};
  people.forEach(function (p) { nameById[p.userId] = p.name || nameOf_(p.userId); });

  var rows = assigned.map(function (r) {
    var cands = ids
      .filter(function (id) { return (availability[id] || []).indexOf(r.day) >= 0; })
      .map(function (id) { return nameById[id]; });
    return {
      day: r.day,
      weekday: weekdayOf_(st.ym, r.day),
      am: r.am ? nameById[r.am] : '',
      pm: isTwoPart ? (r.pm ? nameById[r.pm] : '') : '—',
      cands: cands
    };
  });

  writeShift_(st.ym, st.part, rows);

  // 段階を先に進める。送信で失敗しても集計をやり直さないため。
  // やり直すと乱数で割り当てが別物に変わり、管理者に違う当番表が二重に届く。
  // 送れなかったときは管理者が〔状況〕で取り出せる
  saveState_({ ym: st.ym, stage: STAGE.確認待ち, part: st.part, days: st.days });

  var s = settings_();
  if (s.adminId) push_(s.adminId, msgShift_(st.ym, st.part, rows, '全員の回答がそろいました。'));
}

/** 確認待ちのときに当番表をもう一度出す */
function shiftMessages_(ym, lead) {
  var st = state_();
  var shift = readShift_(ym);
  return msgShift_(ym, shift.part || st.part, shift.rows, lead);
}
