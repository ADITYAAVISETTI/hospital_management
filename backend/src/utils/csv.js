// Builds a CSV file that opens cleanly in Excel.

function cell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  // Stop spreadsheet formula injection (e.g. a patient named "=HYPERLINK(...)").
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** columns: [[header, row => value], ...] */
function toCsv(rows, columns) {
  const lines = [columns.map(([h]) => cell(h)).join(',')];
  for (const row of rows) lines.push(columns.map(([, get]) => cell(get(row))).join(','));
  // BOM so Excel detects UTF-8 (₹, names in other scripts).
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function sendCsv(res, filename, csv) {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

module.exports = { toCsv, sendCsv };
