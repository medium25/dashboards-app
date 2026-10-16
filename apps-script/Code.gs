// Google Apps Script: lets the dashboard write "found today" (TOPILDI) into the sheet.
// Setup: open the spreadsheet -> Extensions -> Apps Script -> paste this -> set TOKEN ->
// Deploy -> New deployment -> type "Web app" -> Execute as: Me, Who has access: Anyone -> copy the URL.
// Put the URL and the same TOKEN into shared/core.js (project.scriptUrl / project.token).
const TOKEN = 'CHANGE_ME';

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function toNum(v) {
  if (typeof v === 'number') return v;
  const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}
function doGet() { return out({ ok: true, hello: 'dashboard script' }); }

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.token !== TOKEN) return out({ ok: false, error: 'bad token' });
    const day = Number(d.day), value = Math.round(Number(d.value));
    if (!(day >= 1 && day <= 31) || !isFinite(value) || value < 0) return out({ ok: false, error: 'bad input' });
    const sh = SpreadsheetApp.getActive().getSheets().find(s => s.getSheetId() === Number(d.gid));
    if (!sh) return out({ ok: false, error: 'sheet not found' });
    const col = sh.getRange(1, 1, Math.min(40, sh.getMaxRows()), 1).getValues().map(r => String(r[0]).trim());
    const i = col.indexOf(String(day));
    if (i < 0) return out({ ok: false, error: 'day row not found' });
    const cell = sh.getRange(i + 1, 2); // column B = TOPILDI
    const next = d.mode === 'add' ? toNum(cell.getValue()) + value : value;
    cell.setValue(next);
    return out({ ok: true, day, value: next });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
