/**
 * 1 か月を通しで動かす。
 * ボタンを押した順に処理が進み、送られる文と状態が仕様どおりかを見る。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeGas } = require('./fakegas');

const SRC = path.join(__dirname, '..', 'src');
const FILES = fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort();

let failures = 0;
function check(name, ok, detail) {
  if (!ok) { failures++; console.log('NG  ' + name + (detail ? '\n    ' + detail : '')); }
}
function section(n) { console.log('--- ' + n); }

// ---------------------------------------------------------------- 環境

const RealDate = Date;

function newEnv(nowDate) {
  const gas = makeGas();
  if (nowDate) gas.setNow(nowDate);

  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(gas.getNow().getTime());
      else super(...args);
    }
  }
  FakeDate.now = () => gas.getNow().getTime();

  const sandbox = {
    console, JSON, Object, Array, String, Number, Math, isNaN, parseInt, parseFloat,
    Infinity, encodeURIComponent, decodeURIComponent, Set, Proxy,
    Date: FakeDate,
    SpreadsheetApp: gas.SpreadsheetApp,
    UrlFetchApp: gas.UrlFetchApp,
    LockService: gas.LockService,
    ContentService: gas.ContentService,
    Utilities: gas.Utilities
  };
  const ctx = vm.createContext(sandbox);
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  }

  ctx.setup();
  ctx.setSetting_('管理者ID', 'Uadmin');
  gas.sent.length = 0;
  return { ctx, gas };
}

function ev(env, obj) { env.ctx.handleEvent_(obj); }

function postback(env, data, userId, token) {
  ev(env, {
    type: 'postback',
    replyToken: token || 'tok',
    source: { type: 'user', userId: userId },
    postback: { data: data }
  });
}

function replies(env) {
  return env.gas.sent.filter(s => s.url.endsWith('/message/reply'));
}
function pushes(env) {
  return env.gas.sent.filter(s => s.url.endsWith('/message/push'));
}
function lastReplyText(env) {
  const r = replies(env);
  if (!r.length) return '';
  return flatten(r[r.length - 1].payload.messages);
}
function pushTextTo(env, to) {
  const p = pushes(env).filter(x => x.payload.to === to);
  if (!p.length) return '';
  return flatten(p[p.length - 1].payload.messages);
}
/** メッセージの中の文字をぜんぶ拾う */
function flatten(messages) {
  const out = [];
  (function walk(v) {
    if (v === null || v === undefined) return;
    if (typeof v === 'string') { out.push(v); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') { Object.keys(v).forEach(k => walk(v[k])); }
  })(messages);
  return out.join('\n');
}
function buttonData(env) {
  const r = replies(env);
  const found = [];
  (function walk(v) {
    if (!v || typeof v !== 'object') return;
    if (v.type === 'postback' && v.data) found.push(v.data);
    Object.keys(v).forEach(k => walk(v[k]));
  })(r[r.length - 1].payload.messages);
  return found;
}

function joinGroupWith(env, people) {
  ev(env, { type: 'join', replyToken: 'tok', source: { type: 'group', groupId: 'Cgroup' } });
  people.forEach(p => {
    env.gas.names[p.id] = p.name;
    ev(env, {
      type: 'memberJoined',
      replyToken: 'tok',
      source: { type: 'group', groupId: 'Cgroup' },
      joined: { members: [{ type: 'user', userId: p.id }] }
    });
  });
}

function follow(env, id) {
  ev(env, { type: 'follow', replyToken: 'tok', source: { type: 'user', userId: id } });
}

const PEOPLE = [
  { id: 'Ualice', name: '山田' },
  { id: 'Ubob', name: '佐藤' },
  { id: 'Ucarol', name: '鈴木' }
];

// ---------------------------------------------------------------- 通し

section('導入から公開まで');
{
  const env = newEnv(new RealDate(2026, 7, 15, 9, 0));
  const { ctx } = env;

  joinGroupWith(env, PEOPLE);
  check('招待の案内が出る', flatten(replies(env)[0].payload.messages).includes('友だち追加してください'));
  check('参加した人に声をかける', flatten(replies(env)[1].payload.messages).includes('はじめまして'));
  check('この時点では全員が未追加', ctx.notAdded_().length === 3 && ctx.members_().length === 0);

  PEOPLE.forEach(p => follow(env, p.id));
  check('友だち追加で名簿がそろう', ctx.members_().length === 3 && ctx.notAdded_().length === 0);

  // 15 日のお知らせ
  env.gas.sent.length = 0;
  ctx.daily();
  check('15日に管理者へお知らせが 1 通',
    pushes(env).length === 1 && pushes(env)[0].payload.to === 'Uadmin');
  check('お知らせは来月分', pushTextTo(env, 'Uadmin').includes('2026年9月分の当番づくりを始めますか？'));

  // 開始 → 部制 → 日数
  env.gas.sent.length = 0;
  postback(env, 'a=start', 'Uadmin');
  check('部制をたずねる', lastReplyText(env).includes('1日の担当人数を選んでください'));
  check('段階は部制待ち', ctx.state_().stage === '部制待ち' && ctx.state_().ym === '2026-09');

  postback(env, 'a=part&v=2', 'Uadmin');
  check('日数をたずねる', lastReplyText(env).includes('2026年9月の当番の日数を選んでください'));
  check('日数のボタンは 1〜30', buttonData(env).includes('a=num&v=30') && !buttonData(env).includes('a=num&v=31'));

  postback(env, 'a=num&v=4', 'Uadmin');
  check('たたき台が出る', lastReplyText(env).includes('均等に散らした案です'));
  check('段階は日程編集中', ctx.state_().stage === '日程編集中');
  const draft = ctx.state_().days.slice();
  check('4 日ぶん', draft.length === 4, JSON.stringify(draft));

  // 日付を 1 つ足す
  const extra = [...Array(30).keys()].map(i => i + 1).find(d => !draft.includes(d));
  postback(env, 'a=atog&d=' + extra, 'Uadmin');
  check('押した日が足される', ctx.state_().days.length === 5);
  check('文が「いま5日です。」', lastReplyText(env).includes('いま5日です。'));

  postback(env, 'a=atog&d=' + extra, 'Uadmin');
  check('もう一度押すと外れる', ctx.state_().days.length === 4);

  // メンバーには何も送っていない
  check('確定前はメンバーに何も送らない', pushes(env).length === 0);

  // この日程でOK
  env.gas.sent.length = 0;
  postback(env, 'a=aok', 'Uadmin');
  const workDays = ctx.state_().days.slice();
  check('段階は回答受付中', ctx.state_().stage === '回答受付中');
  check('メンバー 3 人にカレンダーを送る',
    pushes(env).length === 3 && PEOPLE.every(p => pushes(env).some(x => x.payload.to === p.id)));
  check('未追加がいないのでグループには送らない',
    !pushes(env).some(x => x.payload.to === 'Cgroup'));
  check('確定の返事', lastReplyText(env).includes('当番の日を確定しました（4日）'));

  // メンバーの回答
  env.gas.sent.length = 0;
  const mask = ctx.daysToMask_(workDays);
  postback(env, `a=mok&ym=2026-09&s=${mask}`, 'Ualice');
  check('回答を受け付ける', lastReplyText(env).includes('受け付けました'));
  check('1 人ではまだ集計しない', ctx.state_().stage === '回答受付中');

  postback(env, `a=mok&ym=2026-09&s=${mask}`, 'Ubob');
  check('2 人でもまだ集計しない', ctx.state_().stage === '回答受付中');

  env.gas.sent.length = 0;
  postback(env, `a=mok&ym=2026-09&s=${mask}`, 'Ucarol');
  check('全員そろって集計が走る', ctx.state_().stage === '確認待ち');
  const adminMsg = pushTextTo(env, 'Uadmin');
  check('当番表が管理者に届く', adminMsg.includes('全員の回答がそろいました。2026年9月の当番表です。'));
  check('入れ替えのボタンがある', adminMsg.includes('担当を入れ替える（表を開く）'));
  check('2部制の行は「9/2　午前：山田さん　午後：佐藤さん」の形',
    /\d+\/\d+　午前：\S+さん　午後：\S+さん/.test(adminMsg), adminMsg);

  // 全員が全日出られるので空欄は出ない
  const shift = ctx.readShift_('2026-09');
  check('当番表が年度シートに載る', shift.rows.length === 4, JSON.stringify(shift));
  check('部制が記録される', shift.part === '2部制');
  check('空欄がない', shift.rows.every(r => r.am && r.pm));
  check('午前と午後は別人', shift.rows.every(r => r.am !== r.pm));

  const load = {};
  shift.rows.forEach(r => { load[r.am] = (load[r.am] || 0) + 1; load[r.pm] = (load[r.pm] || 0) + 1; });
  const counts = PEOPLE.map(p => load[p.name] || 0);
  check('担当回数が均等（差は 1 以内）',
    Math.max(...counts) - Math.min(...counts) <= 1, JSON.stringify(counts));

  // 表を開く
  env.gas.sent.length = 0;
  postback(env, 'a=open', 'Uadmin');
  check('シートの URL を返す', lastReplyText(env).includes('docs.google.com/spreadsheets'));

  // 公開
  env.gas.sent.length = 0;
  postback(env, 'a=publish', 'Uadmin');
  const groupText = pushTextTo(env, 'Cgroup');
  check('グループに当番表を送る', groupText.includes('2026年9月の当番表です。'));
  check('グループへの当番表も同じ形', /\d+\/\d+　午前：\S+さん　午後：\S+さん/.test(groupText), groupText);
  check('管理者に完了を返す', lastReplyText(env).includes('これで完了です'));
  check('段階は公開済み', ctx.state_().stage === '公開済み');
}

// ---------------------------------------------------------------- 未追加者

section('未追加の人がいるとき');
{
  const env = newEnv(new RealDate(2026, 7, 15, 9, 0));
  const { ctx } = env;
  joinGroupWith(env, PEOPLE);
  follow(env, 'Ualice');
  follow(env, 'Ubob');   // 鈴木は追加しない

  postback(env, 'a=start', 'Uadmin');
  postback(env, 'a=part&v=1', 'Uadmin');
  postback(env, 'a=num&v=3', 'Uadmin');
  env.gas.sent.length = 0;
  postback(env, 'a=aok', 'Uadmin');

  check('追加済みの 2 人にだけ送る',
    pushes(env).filter(x => x.payload.to === 'Ualice' || x.payload.to === 'Ubob').length === 2);
  const group = pushTextTo(env, 'Cgroup');
  check('グループに追加のお願いを 1 通', group.includes('友だち追加してください'));
  check('お願いは「順にお聞きしています」', group.includes('追加していただいた方から順にお聞きしています'));
  check('メンション付き', JSON.stringify(pushes(env)).includes('"mention"'));

  const workDays = ctx.state_().days.slice();
  const mask = ctx.daysToMask_(workDays);
  postback(env, `a=mok&ym=2026-09&s=${mask}`, 'Ualice');
  postback(env, `a=mok&ym=2026-09&s=${mask}`, 'Ubob');
  check('未追加がいる間は集計しない', ctx.state_().stage === '回答受付中');

  // 状況
  env.gas.sent.length = 0;
  postback(env, 'a=status', 'Uadmin');
  const st = lastReplyText(env);
  check('状況に未追加が出る', st.includes('未追加：鈴木'));
  check('コピー用の文が出る', st.includes('鈴木さん、Bot の友だち追加をお願いします。'));

  // 締切日
  env.gas.setNow(new RealDate(2026, 7, 25, 9, 0));
  env.gas.sent.length = 0;
  ctx.daily();
  check('25日に管理者へ 1 通', pushes(env).length === 1 && pushes(env)[0].payload.to === 'Uadmin');
  check('締切の連絡に未追加が出る', pushTextTo(env, 'Uadmin').includes('未追加：鈴木'));

  // 鈴木が追加 → その場でカレンダー、答えたら集計
  env.gas.sent.length = 0;
  follow(env, 'Ucarol');
  check('追加した人にカレンダーを返す', lastReplyText(env).includes('都合がつく日を押してください'));
  check('通数は増えない（reply）', pushes(env).length === 0);

  postback(env, `a=mok&ym=2026-09&s=${mask}`, 'Ucarol');
  check('そろって集計が走る', ctx.state_().stage === '確認待ち');
}

// ---------------------------------------------------------------- 空欄

section('誰も出られない日があるとき');
{
  const env = newEnv(new RealDate(2026, 7, 15, 9, 0));
  const { ctx } = env;
  joinGroupWith(env, PEOPLE);
  PEOPLE.forEach(p => follow(env, p.id));

  postback(env, 'a=start', 'Uadmin');
  postback(env, 'a=part&v=2', 'Uadmin');
  postback(env, 'a=num&v=3', 'Uadmin');
  postback(env, 'a=aok', 'Uadmin');

  const workDays = ctx.state_().days.slice();
  // 1 日目だけ 1 人、2 日目は誰も出られない、3 日目は全員
  const only = ctx.daysToMask_([workDays[0], workDays[2]]);
  const third = ctx.daysToMask_([workDays[2]]);
  env.gas.sent.length = 0;
  postback(env, `a=mok&ym=2026-09&s=${only}`, 'Ualice');
  postback(env, `a=mok&ym=2026-09&s=${third}`, 'Ubob');
  postback(env, `a=mok&ym=2026-09&s=${third}`, 'Ucarol');

  check('集計は走る', ctx.state_().stage === '確認待ち');
  const msg = pushTextTo(env, 'Uadmin');
  check('決まらなかった日を知らせる', msg.includes('担当が決まらなかった日があります。'));
  check('コピー用の文が出る', msg.includes('担当が決まっていません。ご都合がつく方は連絡をお願いします。'));

  const shift = ctx.readShift_('2026-09');
  const day2 = shift.rows.find(r => r.day === workDays[1]);
  check('誰も出られない日は空欄', day2.am === '' && day2.pm === '');
  const day1 = shift.rows.find(r => r.day === workDays[0]);
  check('1 人しか出られない日は午後が空欄', day1.am === '山田' && day1.pm === '');
}

// ---------------------------------------------------------------- 回答まわり

section('回答の受け付け');
{
  const env = newEnv(new RealDate(2026, 7, 15, 9, 0));
  const { ctx } = env;
  joinGroupWith(env, PEOPLE);
  PEOPLE.forEach(p => follow(env, p.id));
  postback(env, 'a=start', 'Uadmin');
  postback(env, 'a=part&v=2', 'Uadmin');
  postback(env, 'a=num&v=3', 'Uadmin');
  postback(env, 'a=aok', 'Uadmin');
  const workDays = ctx.state_().days.slice();

  // 日付を押しただけでは保存しない
  env.gas.sent.length = 0;
  postback(env, `a=mtog&ym=2026-09&s=0&d=${workDays[0]}`, 'Ualice');
  check('押しただけでは回答にならない', !ctx.hasAnswered_('2026-09', 'Ualice'));
  check('押した日が緑になる', JSON.stringify(replies(env)).includes('a=mtog&ym=2026-09&s=' + ctx.daysToMask_([workDays[0]])));

  // 0 日で確定 → 聞き返し → 2 回目で受け付ける
  env.gas.sent.length = 0;
  postback(env, 'a=mok&ym=2026-09&s=0', 'Ualice');
  check('1 回目は聞き返す', lastReplyText(env).includes('都合がつく日がない、ということでよろしいですか？'));
  check('まだ保存しない', !ctx.hasAnswered_('2026-09', 'Ualice'));
  check('もう一度押すボタンが付く', buttonData(env).includes('a=mok&ym=2026-09&s=0&c=1'));

  postback(env, 'a=mok&ym=2026-09&s=0&c=1', 'Ualice');
  check('2 回目で受け付ける', ctx.hasAnswered_('2026-09', 'Ualice'));
  check('「都合がつく日なし」と返す', lastReplyText(env).includes('都合がつく日なし'));

  // 出し直し
  env.gas.sent.length = 0;
  postback(env, `a=mok&ym=2026-09&s=${ctx.daysToMask_(workDays)}`, 'Ualice');
  check('あとから変えられる', ctx.answersFor_('2026-09')['Ualice'].length === workDays.length);

  // 先月のカード
  env.gas.sent.length = 0;
  postback(env, 'a=mok&ym=2026-08&s=1', 'Ubob');
  check('古いカードは締め切り扱い', lastReplyText(env).includes('2026年8月分の回答は締め切りました。'));
  check('古いカードは今月に混ざらない', !ctx.hasAnswered_('2026-09', 'Ubob'));

  // 当番の日でない日を混ぜても落とす
  const dirty = ctx.daysToMask_(workDays.concat([workDays[0] === 1 ? 28 : 1]).filter((v, i, a) => a.indexOf(v) === i));
  postback(env, `a=mok&ym=2026-09&s=${dirty}`, 'Ubob');
  check('当番の日でない日は無視する',
    ctx.answersFor_('2026-09')['Ubob'].every(d => workDays.includes(d)));

  // 集計後
  postback(env, `a=mok&ym=2026-09&s=${ctx.daysToMask_(workDays)}`, 'Ucarol');
  check('そろって集計', ctx.state_().stage === '確認待ち');
  env.gas.sent.length = 0;
  postback(env, `a=mok&ym=2026-09&s=${ctx.daysToMask_(workDays)}`, 'Ualice');
  check('集計後は締め切り', lastReplyText(env).includes('締め切りました'));
  check('管理者に連絡するよう案内', lastReplyText(env).includes('変更は管理者に連絡してください'));
}

// ---------------------------------------------------------------- 途中操作

section('開始・状況・中止');
{
  const env = newEnv(new RealDate(2026, 7, 15, 9, 0));
  const { ctx } = env;
  joinGroupWith(env, PEOPLE);
  PEOPLE.forEach(p => follow(env, p.id));

  postback(env, 'a=status', 'Uadmin');
  check('何もしていないとき', lastReplyText(env).includes('いま進めているものはありません。'));

  postback(env, 'a=start', 'Uadmin');
  env.gas.sent.length = 0;
  postback(env, 'a=start', 'Uadmin');
  check('進行中の開始は前置きを添える', lastReplyText(env).includes('すでに2026年9月分は開始されています。続きはこちらです。'));
  check('その段階のカードを出しなおす', lastReplyText(env).includes('1日の担当人数を選んでください'));

  postback(env, 'a=part&v=2', 'Uadmin');
  postback(env, 'a=num&v=3', 'Uadmin');
  const days = ctx.state_().days.slice();
  env.gas.sent.length = 0;
  postback(env, 'a=start', 'Uadmin');
  check('日程編集中は編集途中の状態が戻る',
    JSON.stringify(ctx.state_().days) === JSON.stringify(days) && lastReplyText(env).includes('いま3日です。'));

  postback(env, 'a=status', 'Uadmin');
  check('日程を決めている途中', lastReplyText(env).includes('分の日程を決めている途中です。'));

  postback(env, 'a=cancel', 'Uadmin');
  check('中止の文はこれだけ', lastReplyText(env).includes('中止しました。'));
  check('進行中のものが消える', ctx.state_().stage === 'なし');

  postback(env, 'a=cancel', 'Uadmin');
  check('進行中でなくても同じ文', lastReplyText(env).includes('中止しました。'));

  postback(env, 'a=start', 'Uadmin');
  check('中止のあとまた始められる', ctx.state_().stage === '部制待ち');

  // 0 日のまま確定
  postback(env, 'a=part&v=1', 'Uadmin');
  postback(env, 'a=num&v=2', 'Uadmin');
  ctx.state_().days.slice().forEach(d => postback(env, 'a=atog&d=' + d, 'Uadmin'));
  env.gas.sent.length = 0;
  postback(env, 'a=aok', 'Uadmin');
  check('0 日では進めない', lastReplyText(env).includes('1日以上選んでください。'));
  check('段階は変わらない', ctx.state_().stage === '日程編集中');
}

// ---------------------------------------------------------------- 権限とそのほか

section('権限・グループ離脱・そのほか');
{
  const env = newEnv(new RealDate(2026, 7, 15, 9, 0));
  const { ctx } = env;
  joinGroupWith(env, PEOPLE);
  PEOPLE.forEach(p => follow(env, p.id));

  env.gas.sent.length = 0;
  postback(env, 'a=start', 'Ualice');
  check('管理者以外の管理操作は何も返さない', env.gas.sent.length === 0);
  check('状態も変わらない', ctx.state_().stage === 'なし');

  // 進行中に 1 人が抜けたらそろう
  postback(env, 'a=start', 'Uadmin');
  postback(env, 'a=part&v=1', 'Uadmin');
  postback(env, 'a=num&v=2', 'Uadmin');
  postback(env, 'a=aok', 'Uadmin');
  const mask = ctx.daysToMask_(ctx.state_().days);
  postback(env, `a=mok&ym=2026-09&s=${mask}`, 'Ualice');
  postback(env, `a=mok&ym=2026-09&s=${mask}`, 'Ubob');
  check('まだ 1 人残っている', ctx.state_().stage === '回答受付中');

  ev(env, {
    type: 'memberLeft',
    source: { type: 'group', groupId: 'Cgroup' },
    left: { members: [{ type: 'user', userId: 'Ucarol' }] }
  });
  check('抜けたことでそろえば集計する', ctx.state_().stage === '確認待ち');
  check('抜けた人は当番表に入らない',
    !JSON.stringify(ctx.readShift_('2026-09')).includes('鈴木'));

  // 管理者の発言は状況を返す
  env.gas.sent.length = 0;
  ev(env, { type: 'message', replyToken: 'tok', source: { type: 'user', userId: 'Uadmin' }, message: { type: 'text', text: 'あ' } });
  check('管理者の発言には状況を返す', lastReplyText(env).includes('当番表を確認中です。'));
}

section('1部制の当番表');
{
  const env = newEnv(new RealDate(2026, 7, 15, 9, 0));
  const { ctx } = env;
  joinGroupWith(env, PEOPLE);
  PEOPLE.forEach(p => follow(env, p.id));
  postback(env, 'a=start', 'Uadmin');
  postback(env, 'a=part&v=1', 'Uadmin');
  postback(env, 'a=num&v=3', 'Uadmin');
  postback(env, 'a=aok', 'Uadmin');
  const mask = ctx.daysToMask_(ctx.state_().days);
  env.gas.sent.length = 0;
  PEOPLE.forEach(p => postback(env, `a=mok&ym=2026-09&s=${mask}`, p.id));

  const msg = pushTextTo(env, 'Uadmin');
  check('1部制の行は「9/2　山田さん」の形',
    /\d+\/\d+　\S+さん/.test(msg) && !msg.includes('午前：'), msg);
  const shift = ctx.readShift_('2026-09');
  check('1部制の午後は —', shift.rows.every(r => r.pm === '—'));
  check('1部制でも空欄はない', shift.rows.every(r => r.am));
}

section('グループIDが未設定でも動く');
{
  const env = newEnv(new RealDate(2026, 7, 15, 9, 0));
  const { ctx } = env;
  // 招待イベントを受けていないのでグループIDは空のまま
  PEOPLE.forEach(p => {
    env.gas.names[p.id] = p.name;
    ev(env, {
      type: 'memberJoined', replyToken: 'tok',
      source: { type: 'group', groupId: 'Cgroup' },
      joined: { members: [{ type: 'user', userId: p.id }] }
    });
  });
  follow(env, 'Ualice');   // 佐藤・鈴木は未追加のまま

  check('グループIDは空', ctx.settings_().groupId === '');
  postback(env, 'a=start', 'Uadmin');
  postback(env, 'a=part&v=1', 'Uadmin');
  postback(env, 'a=num&v=2', 'Uadmin');
  env.gas.sent.length = 0;
  postback(env, 'a=aok', 'Uadmin');

  check('追加済みの人には送る', pushes(env).some(x => x.payload.to === 'Ualice'));
  check('宛先のない送信をしない', pushes(env).every(x => x.payload.to));
  check('段階は進む', ctx.state_().stage === '回答受付中');
}

section('締切日：そろっていれば送らない');
{
  const env = newEnv(new RealDate(2026, 7, 15, 9, 0));
  const { ctx } = env;
  joinGroupWith(env, PEOPLE);
  PEOPLE.forEach(p => follow(env, p.id));
  postback(env, 'a=start', 'Uadmin');
  postback(env, 'a=part&v=1', 'Uadmin');
  postback(env, 'a=num&v=2', 'Uadmin');
  postback(env, 'a=aok', 'Uadmin');
  const mask = ctx.daysToMask_(ctx.state_().days);
  PEOPLE.forEach(p => postback(env, `a=mok&ym=2026-09&s=${mask}`, p.id));

  env.gas.setNow(new RealDate(2026, 7, 25, 9, 0));
  env.gas.sent.length = 0;
  ctx.daily();
  check('そろっていれば締切の連絡はしない', pushes(env).length === 0);

  env.gas.setNow(new RealDate(2026, 7, 20, 9, 0));
  ctx.daily();
  check('お知らせ日でも締切日でもない日は何もしない', pushes(env).length === 0);
}

console.log(failures === 0 ? '\nすべて通過' : `\n${failures} 件の不一致`);
process.exit(failures === 0 ? 0 : 1);
