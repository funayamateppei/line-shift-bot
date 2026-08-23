/**
 * 定時処理。毎日 9 時台に動くトリガーを 1 本だけ置く。
 *
 * 送るのは「お知らせ」と「締切の連絡」だけ。当番づくりは一切進めない（仕様 1-24）。
 * 再通知はしない。
 */

function daily() {
  var now = new Date();
  var day = Number(Utilities.formatDate(now, TZ, 'd'));
  var s = settings_();

  if (day === s.noticeDay) sendNotice_(now, s);
  if (day === s.dueDay) sendDue_(now, s);
}

/** 5.1 来月分を始めるかどうかのお知らせ */
function sendNotice_(now, s) {
  if (!s.adminId) return;
  push_(s.adminId, msgNotice_(targetYm_(now)));
}

/** 8.1 締切日の朝。まだそろっていなければ 1 回だけ */
function sendDue_(now, s) {
  if (!s.adminId) return;

  var st = state_();
  if (st.stage !== STAGE.回答受付中) return;

  var waiting = pending_(st.ym);
  var missing = notAdded_();
  if (!waiting.length && !missing.length) return;

  push_(s.adminId, msgDue_(st.ym, waiting, missing));
}
