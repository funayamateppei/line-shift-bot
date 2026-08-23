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
    var ym = targetYm_(new Date());
    reply_(replyToken, msgAskPart_(ym, null));
    saveState_({ ym: ym, stage: STAGE.部制待ち, part: '', days: [] });
    return;
  }

  var prefix = alreadyStartedPrefix_(st.ym);
  switch (st.stage) {
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
      reply_(replyToken, shiftMessages_(st.ym));
      return;
  }
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
  if (res.code >= 300) push_(s.groupId, [built.plain]);
}

/** 8.2 状況 */
function onStatus_(replyToken) {
  var st = state_();
  switch (st.stage) {
    case STAGE.部制待ち:
    case STAGE.日数待ち:
    case STAGE.日程編集中:
      reply_(replyToken, msgStatusPlanning_(st.ym));
      return;
    case STAGE.回答受付中:
      reply_(replyToken, statusWaitingMessages_(st.ym, null));
      return;
    case STAGE.確認待ち:
      reply_(replyToken, msgStatusReviewing_());
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
  var waiting = pending_(ym);
  return msgStatusWaiting_(ym, Object.keys(answered).length, waiting, notAdded_(), prefix);
}

/** 8.4 中止 */
function onCancel_(replyToken) {
  reply_(replyToken, msgCancelled_());
  clearState_();
}

/** 7.2 表を開く */
function onOpenSheet_(replyToken) {
  var st = state_();
  if (st.stage !== STAGE.確認待ち) { onStatus_(replyToken); return; }
  reply_(replyToken, msgOpenSheet_(sheetUrl_(yearSheetName_(st.ym))));
}

/** 7.3 グループに送る。シートの最新内容をそのまま送る */
function onPublish_(replyToken) {
  var st = state_();
  if (st.stage !== STAGE.確認待ち) { onStatus_(replyToken); return; }

  var shift = readShift_(st.ym);
  var s = settings_();
  if (s.groupId) push_(s.groupId, msgPublish_(st.ym, shift.part || st.part, shift.rows));

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

  var s = settings_();
  if (s.adminId) push_(s.adminId, msgShift_(st.ym, st.part, rows));

  saveState_({ ym: st.ym, stage: STAGE.確認待ち, part: st.part, days: st.days });
}

/** 確認待ちのときに当番表をもう一度出す */
function shiftMessages_(ym) {
  var st = state_();
  var shift = readShift_(ym);
  return msgShift_(ym, shift.part || st.part, shift.rows);
}
