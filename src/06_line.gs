/**
 * LINE Messaging API。
 *
 * 通数は「送信対象の人数 × push の回数」で数える。1 回の push に吹き出しは 5 つまで
 * 入れられるので、同じ相手への連続した知らせは 1 回にまとめる（仕様 2）。
 * ボタンへの返事（reply）は通数に入らない。
 */

var LINE_API = 'https://api.line.me/v2/bot';

/**
 * いま処理しているイベントの相手（1 対 1 のときだけ入る）。
 *
 * 管理者のメニューは quick reply なので、最後のメッセージにしか残らない。
 * 管理者もメンバーの一人で、カレンダーなどメンバー向けのものが届くたびに
 * メニューが消えてしまう。相手が管理者なら、何を送るときでも必ず添える。
 * グループ宛てには添えない（quick reply はその場の全員に見えるため）。
 */
var TALK_USER = '';

function setTalkUser_(userId) {
  TALK_USER = userId || '';
}

/** 相手が管理者ならメニューを添える */
function forAdmin_(to, messages) {
  if (!to || !messages || !messages.length) return messages;
  if (to !== settings_().adminId) return messages;
  return withAdminMenu_(messages);
}

/** ボタンへの返事。通数 0 */
function reply_(replyToken, messages) {
  if (!replyToken || !messages || !messages.length) return;
  lineCall_('POST', LINE_API + '/message/reply', {
    replyToken: replyToken,
    messages: forAdmin_(TALK_USER, messages).slice(0, 5)
  });
}

/**
 * こちらから送る。通数は相手の人数分。
 * 送れたかどうかを返す。届いていないのに「送りました」と言わないため。
 */
function push_(to, messages) {
  if (!to || !messages || !messages.length) return false;
  var res = lineCall_('POST', LINE_API + '/message/push', {
    to: to,
    messages: forAdmin_(to, messages).slice(0, 5)
  });
  return isOk_(res);
}

/** 送れたか。つながらなかったとき（code 0）を成功と数えないこと */
function isOk_(res) {
  return res.code >= 200 && res.code < 300;
}

/** 送信。つながらなかった場合も落とさず、失敗として返す */
function lineCall_(method, url, payload) {
  var options = {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop_('CHANNEL_ACCESS_TOKEN') },
    muteHttpExceptions: true
  };
  if (payload) options.payload = JSON.stringify(payload);

  var res;
  try {
    res = UrlFetchApp.fetch(url, options);
  } catch (err) {
    log_('LINE ' + method + ' ' + url + ' → つながりませんでした: ' + err);
    return { code: 0, text: '' };
  }
  var code = res.getResponseCode();
  if (code >= 300) {
    log_('LINE ' + method + ' ' + url + ' → ' + code + ' ' + res.getContentText());
  }
  return { code: code, text: res.getContentText() };
}

/** 1 対 1 の表示名 */
function profileName_(userId) {
  var res = lineCall_('GET', LINE_API + '/profile/' + encodeURIComponent(userId), null);
  return pickName_(res);
}

/** グループでの表示名。無料アカウントでも 1 人ずつなら取れる */
function groupMemberName_(groupId, userId) {
  var res = lineCall_('GET',
    LINE_API + '/group/' + encodeURIComponent(groupId) + '/member/' + encodeURIComponent(userId), null);
  return pickName_(res);
}

function pickName_(res) {
  if (res.code >= 300) return '';
  try {
    return String(JSON.parse(res.text).displayName || '');
  } catch (e) {
    return '';
  }
}

/**
 * メンション付きの文。
 * people: [{userId, name}]
 * 本文の先頭に {u0} {u1} … を置き、その位置にメンションが入る。
 */
function mentionText_(people, body) {
  var keys = [];
  var substitution = {};
  people.forEach(function (p, i) {
    var key = 'u' + i;
    keys.push('{' + key + '}');
    substitution[key] = {
      type: 'mention',
      mentionee: { type: 'user', userId: p.userId }
    };
  });
  return {
    type: 'textV2',
    text: keys.join(' ') + '\n' + body,
    substitution: substitution
  };
}

/** メンションが使えなかったときに送る、名前を並べただけの文 */
function plainMentionText_(people, body) {
  var names = people.map(function (p) { return (p.name || '') + 'さん'; }).join(' ');
  return text_(names + '\n' + body);
}
