/**
 * ボタンを押されたときの処理。
 *
 * 状態は処理の最後に 1 回だけ書く。途中で失敗しても中途半端な状態が残らない。
 */

// ---------------------------------------------------------------- 管理者

/** 8.4 開始。進行中ならその段階のカードを出しなおす */
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
      reply_(replyToken, msgDraft_(st.ym, st.days, false, prefix, adminEntryUrl_()));
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
 * 5.3 何月分を作るかを選んだ。
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

/** 5.4 部制を選んだ */
function onPart_(replyToken, value) {
  var st = state_();
  if (st.stage !== STAGE.部制待ち) { onStart_(replyToken); return; }

  var part = value === '2' ? PART.二部 : PART.一部;
  reply_(replyToken, msgAskCount_(st.ym, part, null));
  saveState_({ ym: st.ym, stage: STAGE.日数待ち, part: part, days: [] });
}

/** 5.5 日数を選んだ。たたき台を出す */
function onCount_(replyToken, value) {
  var st = state_();
  if (st.stage !== STAGE.日数待ち) { onStart_(replyToken); return; }

  var count = parseInt(value, 10);
  if (isNaN(count) || count < 1) { onStart_(replyToken); return; }

  var days = spreadDays_(st.ym, count);
  reply_(replyToken, msgDraft_(st.ym, days, true, null, adminEntryUrl_()));
  saveState_({ ym: st.ym, stage: STAGE.日程編集中, part: st.part, days: days });
}

/**
 * 5.6 この日程でOK。ここで初めてメンバーへ送る。
 * 押されるのはウェブ画面のなか。段階と日の確かめは呼ぶ側（12_web.gs）でやっている。
 */
function fixDays_(ym, days) {
  var st = state_();

  // 受付を始める前に、その月の古い回答を消す。
  // 一度作った月をもう一度選び直したとき、前回の回答が「回答済み」として
  // 数えられ、誰か 1 人の確定で集計が走ってしまうのを防ぐ。
  clearAnswers_(ym);

  saveState_({ ym: ym, stage: STAGE.回答受付中, part: st.part, days: days });

  sendCalendars_(ym, days);
}

/** 追加済みの人へカレンダーを送り、未追加の人にはグループでお願いする */
function sendCalendars_(ym, workDays) {
  var base = webAppUrl_();
  members_().forEach(function (p) {
    push_(p.userId, msgAskAvailability_(ym, workDays, entryUrl_(p.key, base)));
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
  // ここで集計が走ったら、当番表は集計のなかで送られている。
  // そのまま下へ進むと段階が「確認待ち」になっていて、同じ表をもう一度返してしまう
  if (st.stage === STAGE.回答受付中 && maybeAggregate_()) {
    reply_(replyToken, msgAggregatedNow_(st.ym));
    return;
  }

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
 * 8.5 中止。
 * その月の回答と、作りかけの当番表も消す。
 *
 * 回答を残すと、同じ月をやり直したときに前回の回答が「回答済み」として
 * 数えられ、誰か 1 人の確定で集計が走ってしまう。
 * 当番表を残すと、公開していない表が公開済みのものと見分けがつかないまま
 * 年度シートに居座る。中止したものは何も残さない。
 */
function onCancel_(replyToken) {
  var st = state_();
  // 公開まで終わった月の記録は消さない。誤って押しても失われないように
  var target = (st.stage === STAGE.回答受付中 || st.stage === STAGE.確認待ち) ? st.ym : '';

  clearState_();
  reply_(replyToken, msgCancelled_());
  // 時間がかかるので状態と返事のあとに
  clearAnswers_(target);
  clearShift_(target);
}

/**
 * 8.3 この人抜きで進める。
 * ブロックされた人や、いつまでも答えない人が残ると集計が走らない。
 * そこから抜け出すための操作。
 *
 * 未回答の人 … その月だけ「都合がつく日なし」として記録する。名簿は触らない
 *              ので、翌月はまた普通にカレンダーが届く
 * 未追加の人 … 名簿から外す。友だち追加し直せばまた入る
 */
function onSkipNotAdded_(replyToken, data) {
  var st = state_();
  if (st.stage !== STAGE.回答受付中) { onStatus_(replyToken); return; }

  var waiting = pending_(st.ym);
  var missing = notAdded_();
  if (!waiting.length && !missing.length) { onStatus_(replyToken); return; }

  // 進めたあとに当番を任せられる人が残らないなら押させない。
  // 「都合がつく日なし」で答えた人は残っても割り当てられないので数に入れない
  var answers = answersFor_(st.ym);
  var usable = members_().filter(function (p) {
    return (answers[p.userId] || []).length > 0;
  }).length;
  if (usable < 1) { reply_(replyToken, msgSkipAll_()); return; }

  // 確認したときと顔ぶれが変わっていたら、もう一度たずねる。
  // 古いカードを別の月で押されたときや、確認のあいだに誰かが友だち追加した
  // ときに、カードに書いていない人を巻き込まないため
  var sameAsAsked = data.c === '1'
    && data.ym === st.ym
    && String(waiting.length) === String(data.n)
    && String(missing.length) === String(data.m);

  if (!sameAsAsked) {
    reply_(replyToken, msgConfirmSkip_(st.ym, waiting, missing));
    return;
  }

  waiting.forEach(function (p) {
    appendAnswer_(st.ym, p.userId, p.name || '', []);
  });
  missing.forEach(function (p) { rosterUpsert_(p.userId, { inGroup: false }); });

  reply_(replyToken, msgSkipped_(st.ym, waiting, missing));
  maybeAggregate_();
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

  // 表が壊れたまま送ると、見出しだけや 9/NaN の混じった表がグループに届いて
  // しかも公開済みになってしまう。当番の日とそろっているか確かめる
  var shift = readShift_(st.ym);
  var days = shift.rows.map(function (r) { return r.day; });
  if (joinDays_(days) !== joinDays_(st.days)) {
    reply_(replyToken, msgNoShift_(st.ym, st.days.length, days.length));
    return;
  }

  if (!push_(s.groupId, msgPublish_(st.ym, shift.part || st.part, shift.rows))) {
    reply_(replyToken, msgPublishFailed_(st.ym));
    return;
  }

  reply_(replyToken, msgPublished_(st.ym));
  saveState_({ ym: st.ym, stage: STAGE.公開済み, part: st.part, days: st.days });
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
  if (!st.days.length) return;

  var people = members_();
  var answers = answersFor_(st.ym);
  var ids = people.map(function (p) { return p.userId; });

  var availability = Object.create(null);
  ids.forEach(function (id) { availability[id] = answers[id] || []; });

  var isTwoPart = st.part === PART.二部;
  var assigned = buildShift_(st.days, isTwoPart, availability, ids);

  var nameById = displayNames_(people);

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

  var allNames = ids.map(function (id) { return nameById[id]; });
  writeShift_(st.ym, st.part, rows, allNames);

  // 段階を先に進める。送信で失敗しても集計をやり直さないため。
  // やり直すと乱数で割り当てが別物に変わり、管理者に違う当番表が二重に届く。
  // 送れなかったときは管理者が〔状況〕で取り出せる
  saveState_({ ym: st.ym, stage: STAGE.確認待ち, part: st.part, days: st.days });

  var s = settings_();
  if (s.adminId) push_(s.adminId, msgShift_(st.ym, st.part, rows, '全員の回答がそろいました。'));
}

/**
 * 当番表に書く名前を決める。
 *
 * 同じ表示名の人が複数いると、表を見ても誰が誰だか分からず、
 * 「午前と午後が同じ人」の警告も誤って出る。区別できるよう後ろに番号を付ける。
 * 表示名が取れていない人は、LINE の userId を出さずに済ませる。
 */
function displayNames_(people) {
  var seen = Object.create(null);
  var out = Object.create(null);

  people.forEach(function (p) {
    var name = p.name || '名前未取得';
    seen[name] = (seen[name] || 0) + 1;
    out[p.userId] = seen[name] === 1 ? name : name + '(' + seen[name] + ')';
  });
  return out;
}

/** 確認待ちのときに当番表をもう一度出す */
function shiftMessages_(ym, lead) {
  var st = state_();
  var shift = readShift_(ym);
  return msgShift_(ym, shift.part || st.part, shift.rows, lead);
}
