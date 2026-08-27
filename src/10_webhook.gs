/**
 * Webhook。LINE から届くイベントの入口。
 *
 * ヘッダが読めないので署名の検証はしない。代わりに、URL に合言葉を付けられる
 * ようにしてある（設定シートの「webhook合言葉」）。
 *
 * カレンダーの画面（12_web.gs）を配るようになって、ウェブアプリの URL は
 * メンバー全員の知るところになった。「URL を知っているのは LINE と管理者だけ」
 * という前提が崩れるので、合言葉を知らない POST は受け取らない。
 * 合言葉が空のあいだは、いままでどおり誰でも通す。
 */

function doPost(e) {
  try {
    if (!webhookAllowed_(e)) return ContentService.createTextOutput('NG');

    var body = JSON.parse(e.postData.contents);
    var events = body.events || [];
    if (events.length) withLock_(events, function () {
      events.forEach(function (ev) {
        try {
          handleEvent_(ev);
        } catch (err) {
          logError_(err);
        }
      });
    });
  } catch (err) {
    logError_(err);
  }
  return ContentService.createTextOutput('OK');
}

/**
 * この POST を受け取ってよいか。
 * 合言葉を決めていれば、LINE に登録した URL の ?w= と一致するときだけ通す。
 */
function webhookAllowed_(e) {
  var want = settings_().webhookSecret;
  if (!want) return true;
  var got = (e && e.parameter && e.parameter.w) || '';
  return String(got) === want;
}

/**
 * シートの読み書きが重ならないようにする。
 *
 * 順番が回ってこなかったときは、ボタンを押した人に「もう一度押してください」と返す。
 * LINE は送り直してくれないので、黙って捨てると本人が気づけない。
 * 返すのはボタン（postback）だけ。友だち追加やグループの発言に返すと、
 * 押すもののない人に妙な返事をしたり、グループの雑談に割り込んだりする。
 */
function withLock_(events, fn) {
  var lock = LockService.getScriptLock();
  if (lock.tryLock(20000)) {
    try {
      fn();
    } finally {
      lock.releaseLock();
    }
    return;
  }

  log_('ほかの処理が動いているため見送りました');
  events.forEach(function (ev) {
    // 名簿を書くだけのイベントは捨てない。
    // 捨てるとその人が名簿に載らず、未追加のまま集計を止め続ける。
    // 同じ人の行を上書きするだけなので、重なっても壊れない
    if (ROSTER_EVENTS[ev.type]) {
      try {
        handleEvent_(ev);
      } catch (err) {
        logError_(err);
      }
      return;
    }
    if (ev.type === 'postback' && ev.replyToken) {
      var src = ev.source || {};
      setTalkUser_(src.type === 'user' ? src.userId : '');
      reply_(ev.replyToken, msgBusy_());
    }
  });
}

/** 名簿を書くだけのイベント */
var ROSTER_EVENTS = {
  follow: true,
  unfollow: true,
  join: true,
  memberJoined: true,
  memberLeft: true
};

function handleEvent_(ev) {
  // 1 対 1 のときだけ相手を覚える。グループ宛てにメニューを添えないため
  var src = ev.source || {};
  setTalkUser_(src.type === 'user' ? src.userId : '');

  switch (ev.type) {
    case 'follow':      return onFollow_(ev);
    case 'unfollow':    return onUnfollow_(ev);
    case 'join':        return onJoin_(ev);
    case 'memberJoined': return onMemberJoined_(ev);
    case 'memberLeft':  return onMemberLeft_(ev);
    case 'postback':    return onPostback_(ev);
    case 'message':     return onMessage_(ev);
    default:            return;
  }
}

// ---------------------------------------------------------------- 名簿に関わるもの

/** 4.2 友だち追加された */
function onFollow_(ev) {
  var userId = ev.source && ev.source.userId;
  if (!userId) return;

  var name = profileName_(userId);
  var saved = rosterUpsert_(userId, { name: name, friend: true, inGroup: true });

  var messages = msgFollowed_();
  var st = state_();
  if (st.stage === STAGE.回答受付中 && !hasAnswered_(st.ym, userId)) {
    messages = messages.concat(
      msgAskAvailability_(st.ym, st.days, entryUrl_(saved ? saved.key : ''))
    );
  }
  reply_(ev.replyToken, messages);

  // この人が最後の未追加者だったなら、これでそろう
  maybeAggregate_();
}

/** 友だち追加を外された。こちらからは送れないので記録だけ */
function onUnfollow_(ev) {
  var userId = ev.source && ev.source.userId;
  if (!userId) return;
  rosterUpsert_(userId, { friend: false });
}

/** 4.3 Bot がグループに招待された */
function onJoin_(ev) {
  var groupId = ev.source && ev.source.groupId;
  if (groupId) setSetting_('グループID', groupId);
  reply_(ev.replyToken, msgJoinedGroup_());
}

/** 4.4 新しい人がグループに参加した */
function onMemberJoined_(ev) {
  var groupId = ev.source && ev.source.groupId;
  var joined = (ev.joined && ev.joined.members) || [];
  var names = [];

  var any = false;
  joined.forEach(function (m) {
    if (!m.userId) return;
    var name = groupId ? groupMemberName_(groupId, m.userId) : '';
    rosterUpsert_(m.userId, { name: name, inGroup: true });
    any = true;
    if (name) names.push(name);   // 名前が取れなかった人は並べない
  });

  if (any) reply_(ev.replyToken, msgMemberJoined_(names.join('さん、')));
}

/** 4.5 グループを抜けた。何も送らない */
function onMemberLeft_(ev) {
  var left = (ev.left && ev.left.members) || [];
  left.forEach(function (m) {
    if (m.userId) rosterUpsert_(m.userId, { inGroup: false });
  });
  // 抜けたことで残りがそろうことがある
  maybeAggregate_();
}

// ---------------------------------------------------------------- ボタン

function onPostback_(ev) {
  var data = parseData_(ev.postback && ev.postback.data);
  var userId = ev.source && ev.source.userId;
  var isAdmin = userId && userId === settings_().adminId;

  switch (data.a) {
    // 差し替える前のカード。トークに残り続けるので、黙って捨てずに入口を返す
    case 'mtog':
    case 'mok':
      return onOldCard_(ev.replyToken, userId);
  }

  // ここから先は管理者だけ。ほかの人にはボタン自体が出ないので何も返さない
  if (!isAdmin) return;

  switch (data.a) {
    case 'start':   return onStart_(ev.replyToken);
    case 'status':  return onStatus_(ev.replyToken);
    case 'cancel':  return onCancel_(ev.replyToken);
    case 'skip':    return onSkipNotAdded_(ev.replyToken, data);
    case 'ym':      return onPickMonth_(ev.replyToken, data.v);
    case 'part':    return onPart_(ev.replyToken, data.v);
    case 'num':     return onCount_(ev.replyToken, data.v);
    case 'atog':
    case 'aok':     return onOldCard_(ev.replyToken, userId);
    case 'publish': return onPublish_(ev.replyToken);
  }
}

/**
 * 差し替える前のカレンダーカードを押されたとき。
 * いま開ける画面があればその入口を返す。どれも reply なので通数 0。
 */
function onOldCard_(replyToken, userId) {
  var st = state_();
  var isAdmin = userId && userId === settings_().adminId;

  if (isAdmin && st.stage === STAGE.日程編集中) {
    reply_(replyToken, msgDraft_(st.ym, st.days, false, '画面で選ぶように変わりました。', adminEntryUrl_()));
    return;
  }
  if (st.stage === STAGE.回答受付中 && isMember_(userId)) {
    reply_(replyToken,
      msgAskAvailability_(st.ym, st.days, entryUrl_(keyFor_(userId)), '画面で選ぶように変わりました。'));
    return;
  }
  reply_(replyToken, msgOldCard_());
}

/** 'a=start&v=1' → {a:'start', v:'1'} */
function parseData_(raw) {
  var out = {};
  String(raw || '').split('&').forEach(function (pair) {
    if (!pair) return;
    var i = pair.indexOf('=');
    if (i < 0) { out[pair] = ''; return; }
    out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
  });
  return out;
}

// ---------------------------------------------------------------- そのほかの発言

/**
 * 文字入力は使わない決まりだが、押すものを見失ったときの戻り道は用意しておく。
 * 管理者には状況を返し、メンバーには受付中なら入口を出しなおす（どちらも通数 0）。
 */
function onMessage_(ev) {
  var source = ev.source || {};

  // グループでの発言から名簿に載せる。
  // メンバー一覧は無料アカウントでは取れないが、話した人の userId は届く。
  // Bot が入る前からいた人を見つけられる数少ない手がかりなので、
  // 返事はせずに記録だけする（グループの雑談に割り込まない）。
  if (source.type === 'group' && source.userId) {
    noteGroupSpeaker_(source.groupId, source.userId);
    return;
  }

  if (source.type !== 'user') return;

  var userId = source.userId;
  if (!userId) return;

  if (userId === settings_().adminId) {
    onStatus_(ev.replyToken);
    return;
  }

  var st = state_();
  if (st.stage === STAGE.回答受付中) {
    var p = rosterFind_(userId);
    if (p && p.inGroup && p.friend) {
      reply_(ev.replyToken, msgAskAvailability_(st.ym, st.days, entryUrl_(keyFor_(userId))));
    }
  }
}

/**
 * グループで話した人を名簿に載せる。
 *
 * 在籍を立てるのは、まだ名簿にいない人だけ。既にいる人には名前を入れるだけで、
 * 在籍は触らない。〔この人抜きで進める〕で外した人が、しゃべっただけで
 * 戻ってきては困るため（管理者の判断を打ち消し、集計がまた止まる）。
 * グループを抜けた人が戻るときは memberJoined が飛ぶので、そちらで足りる。
 */
function noteGroupSpeaker_(groupId, userId) {
  // 設定してあるグループ以外は見ない。Bot は 1 つのグループにしか入れない
  // 前提だが、入れ違いや招待ミスで別のグループの人が混ざらないようにする
  if (!groupId || groupId !== settings_().groupId) return;

  var p = rosterFind_(userId);
  if (p && p.name) return;

  var name = groupMemberName_(groupId, userId);
  if (p) { rosterUpsert_(userId, { name: name }); return; }
  rosterUpsert_(userId, { name: name, inGroup: true });
}
