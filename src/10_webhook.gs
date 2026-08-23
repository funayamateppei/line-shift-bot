/**
 * Webhook。LINE から届くイベントの入口。
 *
 * ヘッダが読めないので署名の検証はしない。ウェブアプリの URL が推測できない長さ
 * であることで足りるとする（漏れて困る情報を持たない）。
 */

function doPost(e) {
  try {
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
 * シートの読み書きが重ならないようにする。
 *
 * 順番が回ってこなかったときは、ボタンを押した人に「もう一度押してください」と返す。
 * LINE は送り直してくれないので、黙って捨てると本人が気づけない。
 * 返すのはボタン（postback）だけ。友だち追加やグループの発言に返すと、
 * 押すもののない人に妙な返事をしたり、グループの雑談に割り込んだりする。
 */
function withLock_(events, fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    log_('ほかの処理が動いているため見送りました');
    events.forEach(function (ev) {
      if (ev.type === 'postback' && ev.replyToken) reply_(ev.replyToken, msgBusy_());
    });
    return;
  }
  try {
    fn();
  } finally {
    lock.releaseLock();
  }
}

function handleEvent_(ev) {
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
  rosterUpsert_(userId, { name: name, friend: true, inGroup: true });

  var messages = msgFollowed_();
  var st = state_();
  if (st.stage === STAGE.回答受付中 && !hasAnswered_(st.ym, userId)) {
    messages = messages.concat(msgAskAvailability_(st.ym, st.days, []));
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
    // メンバーの操作。誰でも押せる
    case 'mtog':
      return onMemberToggle_(ev.replyToken, data.ym, data.s, parseInt(data.d, 10));
    case 'mok':
      return onMemberConfirm_(ev.replyToken, userId, data.ym, data.s, data.c === '1');
  }

  // ここから先は管理者だけ。ほかの人にはボタン自体が出ないので何も返さない
  if (!isAdmin) return;

  switch (data.a) {
    case 'start':   return onStart_(ev.replyToken);
    case 'status':  return onStatus_(ev.replyToken);
    case 'cancel':  return onCancel_(ev.replyToken);
    case 'skip':    return onSkipNotAdded_(ev.replyToken);
    case 'ym':      return onPickMonth_(ev.replyToken, data.v);
    case 'part':    return onPart_(ev.replyToken, data.v);
    case 'num':     return onCount_(ev.replyToken, data.v);
    case 'atog':    return onAdminToggle_(ev.replyToken, parseInt(data.d, 10));
    case 'aok':     return onFixDays_(ev.replyToken);
    case 'open':    return onOpenSheet_(ev.replyToken);
    case 'publish': return onPublish_(ev.replyToken);
  }
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
 * 管理者には状況を返し、メンバーには受付中ならカレンダーを出しなおす（どちらも通数 0）。
 */
function onMessage_(ev) {
  var source = ev.source || {};
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
      reply_(ev.replyToken, msgAskAvailability_(st.ym, st.days, []));
    }
  }
}
