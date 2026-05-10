/**
 * Google Apps Script — Lead Magnet Collector
 *
 * À COLLER dans : Google Sheet "OS - Email Magnet"
 *   → Extensions → Apps Script
 *   → Coller ce code, sauvegarder, puis Déployer en "Web app"
 *
 * Setup du sheet : 4 colonnes en ligne 1
 *   A: Date | B: Email | C: Prénom | D: Source
 */

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // Validation basique
    if (!data.email) {
      return _json({ ok: false, error: 'email_required' }, 400);
    }

    // Récupère le sheet actif
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // S'assure que les headers existent
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Date', 'Email', 'Prénom', 'Source']);
      sheet.getRange('A1:D1').setFontWeight('bold').setBackground('#0f0b09').setFontColor('#F47B3B');
    }

    // Dédupe : si l'email existe déjà, on update la date au lieu de re-ajouter
    const data_range = sheet.getDataRange();
    const values = data_range.getValues();
    let foundRow = -1;
    for (let i = 1; i < values.length; i++) {
      if (values[i][1] && values[i][1].toString().toLowerCase() === data.email.toLowerCase()) {
        foundRow = i + 1;
        break;
      }
    }

    if (foundRow > 0) {
      // Update la date du re-opt-in
      sheet.getRange(foundRow, 1).setValue(new Date(data.date || Date.now()));
      return _json({ ok: true, status: 'updated', row: foundRow });
    }

    // Sinon append nouvelle ligne
    sheet.appendRow([
      new Date(data.date || Date.now()),
      data.email.toLowerCase().trim(),
      (data.prenom || '').trim(),
      (data.source || 'direct').trim()
    ]);

    return _json({ ok: true, status: 'created' });

  } catch (err) {
    return _json({ ok: false, error: err.message }, 500);
  }
}

function doGet() {
  return _json({ ok: true, service: 'OS Lead Magnet Collector', timestamp: new Date().toISOString() });
}

function _json(obj, status) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
