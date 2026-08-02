/**
 * ROZPOČET RODINY RIEFLER — synchronizační server + týdenní e-mail report
 * -----------------------------------------------------------------------
 * Tento skript dělá dvě věci:
 *   A) SYNCHRONIZACE — drží sdílená data rozpočtu v souboru na Google Drive
 *      (rozpocet-riefler-data.json) a vystavuje je appce přes web app URL.
 *   B) REPORT — každou neděli v 19:00 pošle e-mail oběma.
 *
 * Nastavení (jednorázově):
 *   1. Otevři svůj projekt na https://script.google.com, Cmd+A → vlož CELÝ tento soubor → Cmd+S
 *   2. Vpravo nahoře „Implementovat" (Deploy) → „Nová implementace" →
 *      ozubené kolo → „Webová aplikace":
 *        - Spustit jako: Já (riefler.thomas@gmail.com)
 *        - Kdo má přístup: KDOKOLI (Anyone)
 *      → Implementovat → povolit oprávnění → ZKOPÍROVAT „URL webové aplikace"
 *        (končí na /exec) a poslat Claudovi.
 *   3. Nahoře vyber funkci „setup" a ▶ Spustit (obnoví nedělní trigger reportu).
 */

// ═══════════ NASTAVENÍ ═══════════
const RECIPIENTS = ['thomas@2din.cz', 'ancikk90@gmail.com'];
const APP_URL    = 'https://thomasriefler.github.io/rozpocet/';
const DATA_FILE  = 'rozpocet-riefler-data.json';

// ═══════════ A) SYNCHRONIZAČNÍ SERVER (web app) ═══════════
function getDataFile_(){
  const it = DriveApp.getFilesByName(DATA_FILE);
  if (it.hasNext()) return it.next();
  return DriveApp.createFile(DATA_FILE, JSON.stringify({plan:{},tx:{}}), 'application/json');
}
function readState_(){
  try { return JSON.parse(getDataFile_().getBlob().getDataAsString() || '{}'); }
  catch(e){ return {plan:{},tx:{}}; }
}
function newer_(x,y){ return (!x) ? y : (!y) ? x : ((y.ts||0) > (x.ts||0) ? y : x); }
function mergeStates_(a,b){
  const out = {plan:{}, tx:{}};
  const keys = o => Object.keys(o||{});
  keys(a.plan).concat(keys(b.plan)).forEach(k => out.plan[k] = newer_((a.plan||{})[k],(b.plan||{})[k]));
  keys(a.tx).concat(keys(b.tx)).forEach(k => out.tx[k] = newer_((a.tx||{})[k],(b.tx||{})[k]));
  const lk = keys(a.labels).concat(keys(b.labels));
  if (lk.length){
    out.labels = {};
    lk.forEach(k => out.labels[k] = newer_((a.labels||{})[k],(b.labels||{})[k]));
  }
  return out;
}
function doGet(){
  return ContentService.createTextOutput(JSON.stringify(readState_()))
    .setMimeType(ContentService.MimeType.JSON);
}
function doPost(e){
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let incoming = {};
    try { incoming = JSON.parse(e.postData.contents || '{}'); } catch(err){}
    const merged = mergeStates_(readState_(), incoming);
    getDataFile_().setContent(JSON.stringify(merged));
    return ContentService.createTextOutput(JSON.stringify(merged))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

const CATS = [
  { key:'bydleni',  full:'🏠 Bydlení & Domácnost',  color:'#D96B4F', plan:36000 },
  { key:'jidlo',    full:'🍽️ Jídlo & Restaurace',   color:'#DFA23E', plan:35000 },
  { key:'zdravi',   full:'🏥 Zdraví & Rozvoj',      color:'#9268C7', plan:27000 },
  { key:'sporeni',  full:'💰 Spoření & Investice',  color:'#3BA372', plan:25000 },
  { key:'vzdelani', full:'🎓 Vzdělání (Sebastian)', color:'#4A7FC1', plan:20000 },
  { key:'dovolena', full:'✈️ Dovolená',             color:'#35A6A0', plan:20000 },
  { key:'auta',     full:'🚗 Auta & Doprava',       color:'#7D8899', plan:15000 },
  { key:'zabava',   full:'🎉 Zábava & Oblečení',    color:'#D2617E', plan:6000  },
];

// ═══════════ 1× SPUSTIT: zapne týdenní odesílání + pošle test ═══════════
function setup(){
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendWeeklyReport')
    .timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(19).create();
  sendWeeklyReport(); // zkušební odeslání hned teď
}

// ═══════════ HLAVNÍ FUNKCE ═══════════
function sendWeeklyReport(){
  const state = fetchState();
  const now = new Date();
  const tz = 'Europe/Prague';

  // výdaje aktuálního měsíce (bez smazaných)
  const y = now.getFullYear(), m = now.getMonth();
  const tx = Object.values(state.tx || {}).filter(t => !t.del);
  const monthTx = tx.filter(t => {
    const d = new Date(t.d + 'T12:00:00');
    return d.getFullYear() === y && d.getMonth() === m;
  });
  // výdaje posledních 7 dní
  const weekAgo = new Date(now.getTime() - 7*24*3600*1000);
  const weekTx = tx.filter(t => new Date(t.d + 'T12:00:00') >= weekAgo);

  // čerpání z fondů (fund:'out') se nepočítá do útraty měsíce
  const FUND_CATS = ['dovolena','vzdelani'];
  const spentBy = {}; CATS.forEach(c => spentBy[c.key] = 0);
  monthTx.forEach(t => { if (t.fund !== 'out' && spentBy[t.cat] !== undefined) spentBy[t.cat] += t.amt; });

  // zůstatky fondů (napříč všemi měsíci)
  const fundBal = {};
  FUND_CATS.forEach(k => fundBal[k] = 0);
  tx.forEach(t => { if (FUND_CATS.indexOf(t.cat) > -1) fundBal[t.cat] += (t.fund === 'out' ? -t.amt : t.amt); });

  // podkategorie (štítky) za měsíc: cat -> {note: suma}
  const subsBy = {};
  monthTx.forEach(t => {
    if (t.fund === 'out') return;
    const note = (t.note || '').trim() || 'Ostatní';
    (subsBy[t.cat] = subsBy[t.cat] || {})[note] = ((subsBy[t.cat] || {})[note] || 0) + t.amt;
  });

  const planOf = c => (state.plan && state.plan[c.key] && state.plan[c.key].v != null) ? state.plan[c.key].v : c.plan;
  const totalPlan  = CATS.reduce((s,c) => s + planOf(c), 0);
  const totalSpent = CATS.reduce((s,c) => s + spentBy[c.key], 0);
  const left = totalPlan - totalSpent;
  const pct  = totalPlan > 0 ? Math.round(totalSpent/totalPlan*100) : 0;

  const weekTotal = weekTx.filter(t => t.fund !== 'out').reduce((s,t) => s + t.amt, 0);
  const weekFundOut = weekTx.filter(t => t.fund === 'out').reduce((s,t) => s + t.amt, 0);
  const byWho = {};
  weekTx.filter(t => t.fund !== 'out').forEach(t => { byWho[t.who] = (byWho[t.who]||0) + t.amt; });
  const whoLine = Object.keys(byWho).sort()
    .map(w => (w==='Thomas'?'👨 ':'👩 ') + w + ' ' + fmt(byWho[w])).join(' &nbsp;·&nbsp; ') || 'žádné výdaje';

  const overCats = CATS.filter(c => spentBy[c.key] > planOf(c));

  const dateRange = Utilities.formatDate(weekAgo, tz, 'd. M.') + '–' + Utilities.formatDate(now, tz, 'd. M. yyyy');
  const subject = '💎 Týdenní report rozpočtu · zbývá ' + fmt(Math.max(left,0)) +
    (overCats.length ? ' · ⚠️ ' + overCats.length + '× překročeno' : '');

  const html = buildHtml({dateRange, left, totalPlan, totalSpent, pct, weekTotal, weekFundOut, fundBal, whoLine, spentBy, subsBy, planOf, overCats, FUND_CATS});
  const plain = 'Zbývá z plánu: ' + fmt(left) + ' z ' + fmt(totalPlan) + ' (utraceno ' + pct + ' %). ' +
    'Tento týden: ' + fmt(weekTotal) + '. Detail v HTML verzi nebo v appce: ' + APP_URL;

  MailApp.sendEmail({
    to: RECIPIENTS.join(','),
    subject: subject,
    body: plain,
    htmlBody: html,
    name: 'Rozpočet rodiny Riefler'
  });
}

// ═══════════ POMOCNÉ ═══════════
function fetchState(){
  return readState_(); // data čteme přímo z Google Drive
}

function fmt(n){
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Kč';
}

function bar(color, widthPct){
  const w = Math.max(0, Math.min(100, Math.round(widthPct)));
  return '<td colspan="2" style="background:#F0E9DB;border-radius:6px;height:7px;">' +
    (w > 0 ? '<table role="presentation" width="' + w + '%" cellpadding="0" cellspacing="0"><tr>' +
      '<td style="background:' + color + ';border-radius:6px;height:7px;font-size:0;">&nbsp;</td></tr></table>' : '') +
    '</td>';
}

function buildHtml(d){
  let catRows = '';
  CATS.forEach(c => {
    const sp = d.spentBy[c.key], pl = d.planOf(c);
    const over = sp > pl;
    const color = over ? '#C4473B' : c.color;

    // nenápadný rozpad na podkategorie (max 3 nejvyšší + ostatní)
    let subLine = '';
    const g = d.subsBy[c.key];
    if (g && sp > 0) {
      const subs = Object.keys(g).map(n => [n, g[n]]).sort((a,b) => b[1]-a[1]);
      if (!(subs.length === 1 && subs[0][0] === 'Ostatní')) {
        const top = subs.slice(0,3);
        const rest = subs.slice(3).reduce((s,x) => s+x[1], 0);
        const parts = top.map(x => x[0] + ' ' + fmt(x[1]));
        if (rest > 0) parts.push('ostatní ' + fmt(rest));
        subLine = '<tr><td colspan="2" style="font-size:11px;color:#B3A78F;padding-top:4px;">' + parts.join(' &nbsp;·&nbsp; ') + '</td></tr>';
      }
    }
    const fundLine = (d.FUND_CATS.indexOf(c.key) > -1 && d.fundBal[c.key] !== 0)
      ? '<tr><td colspan="2" style="font-size:11px;font-weight:700;color:' + (d.fundBal[c.key] < 0 ? '#C4473B' : '#2E8E89') + ';padding-top:3px;">🏦 ve fondu naspořeno: ' + fmt(d.fundBal[c.key]) + '</td></tr>'
      : '';

    catRows +=
    '<tr><td style="background:#FFFFFF;padding:10px 24px 4px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
      '<tr><td style="font-size:13px;font-weight:700;color:#241D14;padding-bottom:3px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">' + c.full + '</td>' +
      '<td align="right" style="font-size:12px;color:#9C8F7C;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;"><b style="color:' + color + ';">' + fmt(sp) + '</b> / ' + fmt(pl) + '</td></tr>' +
      '<tr>' + bar(color, pl > 0 ? sp/pl*100 : 0) + '</tr>' +
      (over ? '<tr><td colspan="2" align="right" style="font-size:11px;font-weight:700;color:#C4473B;padding-top:3px;">⚠️ překročeno o ' + fmt(sp-pl) + '</td></tr>' : '') +
      subLine + fundLine +
      '</table></td></tr>';
  });

  const leftColor = d.left >= 0 ? '#241D14' : '#C4473B';
  const leftLabel = d.left >= 0 ? 'ZBÝVÁ Z MĚSÍČNÍHO PLÁNU' : '⚠️ MĚSÍČNÍ PLÁN PŘEKROČEN O';

  return '<!DOCTYPE html><html lang="cs"><head><meta charset="UTF-8"></head>' +
  '<body style="margin:0;padding:0;background:#F6F1E8;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F1E8;padding:24px 0;"><tr><td align="center">' +
  '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">' +

  '<tr><td style="background:#352C22;border-radius:16px 16px 0 0;padding:22px 24px;border-bottom:3px solid #C8924A;">' +
    '<table role="presentation" width="100%"><tr>' +
    '<td style="font-size:20px;font-weight:800;color:#F0CB7E;">🛡️ Rozpočet rodiny Riefler</td>' +
    '<td align="right" style="font-size:11px;color:#B8A88E;letter-spacing:1px;">TÝDENNÍ REPORT<br>' + d.dateRange + '</td>' +
    '</tr></table></td></tr>' +

  '<tr><td style="background:#FFFFFF;padding:26px 24px 18px;text-align:center;">' +
    '<div style="font-size:11px;font-weight:800;color:#7A6B54;letter-spacing:2px;">' + leftLabel + '</div>' +
    '<div style="font-size:38px;font-weight:800;color:' + leftColor + ';margin:6px 0 2px;">' + fmt(Math.abs(d.left)) + '</div>' +
    '<div style="font-size:13px;color:#9C8F7C;">z plánu ' + fmt(d.totalPlan) + ' · utraceno ' + d.pct + ' %</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr>' + bar(d.pct > 100 ? '#C4473B' : '#C8924A', d.pct) + '</tr></table>' +
  '</td></tr>' +

  '<tr><td style="background:#FFFFFF;padding:0 24px 8px;">' +
    '<table role="presentation" width="100%" style="background:#FBF7EF;border:1px solid #EAE2D4;border-radius:12px;"><tr>' +
    '<td style="padding:14px 16px;font-size:13px;color:#241D14;">' +
    '<b>Tento týden utraceno: ' + fmt(d.weekTotal) + '</b><br>' +
    '<span style="color:#9C8F7C;font-size:12px;">' + d.whoLine + '</span>' +
    (d.weekFundOut > 0 ? '<br><span style="color:#2E8E89;font-size:12px;">🏦 tento týden čerpáno z fondů: ' + fmt(d.weekFundOut) + '</span>' : '') +
    '</td></tr></table></td></tr>' +

  '<tr><td style="background:#FFFFFF;padding:16px 24px 6px;">' +
    '<div style="font-size:11px;font-weight:800;color:#7A6B54;letter-spacing:2px;border-bottom:1px solid #EAE2D4;padding-bottom:8px;">KATEGORIE</div></td></tr>' +
  catRows +

  '<tr><td style="background:#FFFFFF;height:10px;font-size:0;">&nbsp;</td></tr>' +
  '<tr><td style="background:#352C22;border-radius:0 0 16px 16px;padding:16px 24px;text-align:center;">' +
    '<a href="' + APP_URL + '" style="color:#F0CB7E;font-size:13px;font-weight:700;text-decoration:none;">Otevřít aplikaci →</a>' +
    '<div style="font-size:10px;color:#8A7A62;margin-top:6px;">Automatický týdenní report · každou neděli v 19:00</div>' +
  '</td></tr>' +

  '</table></td></tr></table></body></html>';
}
