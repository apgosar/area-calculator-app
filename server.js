import express from 'express';
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

// ---- CSV download endpoint (linked from inside the PDF) ----
// Data is URL-safe base64 JSON in the query string — self-contained, no server state.
app.get('/api/download-csv', (req, res) => {
  try {
    // Decode URL-safe base64 back to standard base64 before decoding
    const b64  = req.query.data.replace(/-/g, '+').replace(/_/g, '/');
    const raw  = Buffer.from(b64, 'base64').toString('utf-8');
    const { customerName, unit, rooms, total } = JSON.parse(raw);
    const label = unit === 'ft' ? 'sq ft' : unit === 'm' ? 'sq m' : 'sq in';

    // UTF-8 BOM ensures Excel opens with correct encoding automatically
    let csv = '﻿';
    csv += `Customer Name,${customerName}\n\n`;
    csv += `Room Name,Length (${unit}),Width (${unit}),Area (${label})\n`;
    rooms.forEach(r => { csv += `"${r.name}",${r.length},${r.width},${r.area}\n`; });
    csv += `TOTAL AREA,,,${total} ${label}\n`;

    const safe = customerName.replace(/[^a-z0-9]/gi, '_') || 'Report';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="VDS_Area_Data_${safe}.csv"`);
    res.send(csv);
  } catch {
    res.status(400).json({ error: 'Invalid data parameter' });
  }
});

// ---- PDF generation endpoint ----
app.post('/api/generate-pdf', async (req, res) => {
  const { customerName, unit, rooms, total } = req.body;

  if (!customerName || !rooms?.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const label = unit === 'ft' ? 'sq ft' : unit === 'm' ? 'sq m' : 'sq in';
  const date  = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  // Build self-contained CSV download URL using URL-safe base64
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const origin   = `${protocol}://${req.get('host')}`;
  const payload  = Buffer.from(JSON.stringify({ customerName, unit, rooms, total }))
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const csvUrl   = `${origin}/api/download-csv?data=${payload}`;

  const rowsHtml = rooms.map((r, i) => `
    <tr class="${i % 2 === 1 ? 'even' : ''}">
      <td>${r.name}</td>
      <td>${r.length}</td>
      <td>${r.width}</td>
      <td>${r.area}</td>
    </tr>`).join('');

  // Chromium converts <a href="..."> tags into real PDF link annotations automatically.
  // No post-processing needed — the button just works in any PDF viewer.
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    @page { margin: 20mm; }
    body  { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #333; margin: 0; }
    .header { border-bottom: 3px solid #003366; padding-bottom: 12px; margin-bottom: 18px; }
    .header h1 { color: #003366; font-size: 18pt; margin: 0 0 4px 0; }
    .header .tagline { color: #666; font-size: 10pt; }
    .meta { margin-bottom: 18px; font-size: 11pt; line-height: 1.7; }
    table { width: 100%; border-collapse: collapse; }
    thead th { background-color: #003366; color: white; padding: 10px 12px; text-align: left; font-size: 11pt; }
    tbody td { padding: 9px 12px; border: 1px solid #ccc; font-size: 11pt; }
    tr.even td { background-color: #f8f9fa; }
    tfoot td { padding: 10px 12px; border: 1px solid #adb5bd; background-color: #e2e6ea; font-weight: bold; color: #003366; font-size: 11pt; }
    .download-bar {
      margin-top: 22px;
      padding-top: 16px;
      border-top: 1px solid #dee2e6;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .download-btn {
      display: inline-block;
      background-color: #003366;
      color: white !important;
      padding: 10px 20px;
      text-decoration: none !important;
      border-radius: 5px;
      font-weight: bold;
      font-size: 10.5pt;
      white-space: nowrap;
    }
    .download-note {
      font-size: 9pt;
      color: #666;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>VDS Advisory &mdash; Room Area Report</h1>
    <div class="tagline">Strategic Real Estate &amp; Funding Advisory</div>
  </div>
  <div class="meta">
    <strong>Customer:</strong> ${customerName}<br>
    <strong>Date:</strong> ${date}<br>
    <strong>Unit System:</strong> ${unit} &mdash; area in ${label}
  </div>
  <table>
    <thead>
      <tr>
        <th>Room Name</th>
        <th>Length (${unit})</th>
        <th>Width (${unit})</th>
        <th>Area (${label})</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot>
      <tr>
        <td colspan="3" style="text-align:right;">TOTAL AREA:</td>
        <td>${total} ${label}</td>
      </tr>
    </tfoot>
  </table>

  <div class="download-bar">
    <a href="${csvUrl}" class="download-btn">Download Excel Data (.csv)</a>
    <span class="download-note">
      Click to download &mdash; opens directly in Excel<br>
      with each room on its own row and each value in its own cell.
    </span>
  </div>
</body>
</html>`;

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--no-zygote',
        '--disable-gpu'
      ],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfData = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
    });

    const safe = customerName.replace(/[^a-z0-9]/gi, '_') || 'Report';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="VDS_Area_Report_${safe}.pdf"`);
    res.send(Buffer.from(pdfData));
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: 'PDF generation failed' });
  } finally {
    await browser?.close();
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
