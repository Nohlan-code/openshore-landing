/**
 * Google Apps Script — Lead Magnet Collector (Openshore)
 *
 * Setup : Apps Script (script.google.com) ou Extensions → Apps Script depuis le Sheet
 * Coller TOUT ce code, sauver (Cmd+S), Déployer en "Application Web".
 *
 * Colonnes du sheet créées automatiquement :
 *   A: Date | B: Email | C: Prénom | D: Source
 */

// ID du Google Sheet "OS - Email Magnet"
const SHEET_ID = '1KXlgSeIq8Q0o1HzLHtpoyEy17RBfSX3hV-EgNYGhhZY';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (!data.email) {
      return _json({ ok: false, error: 'email_required' });
    }

    const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();

    // Headers automatiques à la première soumission
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Date', 'Email', 'Prénom', 'Source']);
      sheet.getRange('A1:D1').setFontWeight('bold').setBackground('#0f0b09').setFontColor('#F47B3B');
    }

    // Dédupe : si l'email existe déjà, on update la date au lieu de re-ajouter
    const values = sheet.getDataRange().getValues();
    let foundRow = -1;
    for (let i = 1; i < values.length; i++) {
      if (values[i][1] && values[i][1].toString().toLowerCase() === data.email.toLowerCase()) {
        foundRow = i + 1;
        break;
      }
    }

    if (foundRow > 0) {
      sheet.getRange(foundRow, 1).setValue(new Date(data.date || Date.now()));
      return _json({ ok: true, status: 'updated', row: foundRow });
    }

    sheet.appendRow([
      new Date(data.date || Date.now()),
      data.email.toLowerCase().trim(),
      (data.prenom || '').trim(),
      (data.source || 'direct').trim()
    ]);

    return _json({ ok: true, status: 'created' });

  } catch (err) {
    return _json({ ok: false, error: err.message });
  }
}

function doGet() {
  return _json({ ok: true, service: 'OS Lead Magnet Collector', timestamp: new Date().toISOString() });
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
