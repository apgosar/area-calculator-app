import { useState, useRef } from 'react';

const INITIAL_ROOMS = [
  { id: 1, name: 'Living Room', length: '', width: '' },
  { id: 2, name: 'Kitchen',     length: '', width: '' },
  { id: 3, name: 'Bedroom',     length: '', width: '' },
  { id: 4, name: 'Bathroom',    length: '', width: '' },
];

function areaLabel(unit) {
  return unit === 'ft' ? 'sq ft' : unit === 'm' ? 'sq m' : 'sq in';
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [empId, setEmpId]         = useState('');
  const [authError, setAuthError] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [unit, setUnit]                 = useState('ft');
  const [rooms, setRooms]               = useState(INITIAL_ROOMS);
  const [nextId, setNextId]             = useState(5);
  const [errors, setErrors]             = useState({});
  const [results, setResults]           = useState(null);

  const [downloading, setDownloading] = useState(false);
  const [copyLabel, setCopyLabel]     = useState('Copy Table (Word / Excel)');

  const resultRef = useRef(null);

  // ---- AUTH ----
  function checkAuth() {
    if (empId.trim() === 'vinitvds') {
      setAuthenticated(true);
    } else {
      setAuthError(true);
    }
  }

  // ---- ROOM MANAGEMENT ----
  function addRoom() {
    setRooms(prev => [...prev, { id: nextId, name: '', length: '', width: '' }]);
    setNextId(n => n + 1);
  }

  function removeRoom(id) {
    setRooms(prev => prev.filter(r => r.id !== id));
  }

  function updateRoom(id, field, value) {
    setRooms(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  // ---- CALCULATE ----
  function calculate() {
    const newErrors = {};

    if (!customerName.trim() || !/^[a-zA-Z0-9\s]+$/.test(customerName.trim())) {
      newErrors.customerName = true;
      setErrors(newErrors);
      alert('Please enter a valid alphanumeric Customer Name.');
      return;
    }

    for (const room of rooms) {
      const hasLen = room.length !== '';
      const hasWid = room.width  !== '';
      if (hasLen !== hasWid) {
        if (!hasLen) newErrors[`${room.id}_len`] = true;
        if (!hasWid) newErrors[`${room.id}_wid`] = true;
        setErrors(newErrors);
        alert(`Error in "${room.name || 'room'}": you entered one dimension but forgot the other.`);
        return;
      }
    }

    setErrors({});
    const computed = [];
    let total = 0;

    for (const room of rooms) {
      const len = parseFloat(room.length);
      const wid = parseFloat(room.width);
      if (!isNaN(len) && len > 0 && !isNaN(wid) && wid > 0) {
        const area = len * wid;
        total += area;
        computed.push({ name: room.name || 'Unnamed Room', length: len, width: wid, area: area.toFixed(2) });
      }
    }

    if (computed.length === 0) {
      alert('Please enter dimensions for at least one room.');
      return;
    }

    setResults({ rooms: computed, total: total.toFixed(2), unit });
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  // ---- DOWNLOAD PDF ----
  async function downloadPDF() {
    if (!results || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: customerName.trim(),
          unit: results.unit,
          rooms: results.rooms,
          total: results.total,
        }),
      });

      if (!res.ok) throw new Error('PDF generation failed');

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      const safe = customerName.trim().replace(/[^a-z0-9]/gi, '_') || 'Report';
      a.download = `VDS_Area_Report_${safe}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      await copyHtmlToClipboard();
      setCopyLabel('✓ Table also copied — paste in Word/Excel');
      setTimeout(() => setCopyLabel('Copy Table (Word / Excel)'), 4000);
    } catch {
      alert('Failed to generate PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  // ---- CLIPBOARD ----
  async function copyHtmlToClipboard() {
    const al  = areaLabel(results.unit);
    const trs = results.rooms.map((r, i) => `
      <tr style="background:${i % 2 === 1 ? '#f8fafc' : '#fff'}">
        <td style="padding:8px 10px;border:1px solid #e2e8f0">${r.name}</td>
        <td style="padding:8px 10px;border:1px solid #e2e8f0">${r.length}</td>
        <td style="padding:8px 10px;border:1px solid #e2e8f0">${r.width}</td>
        <td style="padding:8px 10px;border:1px solid #e2e8f0">${r.area}</td>
      </tr>`).join('');

    const html = `
      <table style="border-collapse:collapse;font-family:Segoe UI,sans-serif;font-size:11pt">
        <thead><tr>
          <th style="background:#020617;color:#fff;padding:9px 10px;text-align:left">Room Name</th>
          <th style="background:#020617;color:#fff;padding:9px 10px;text-align:left">Length (${results.unit})</th>
          <th style="background:#020617;color:#fff;padding:9px 10px;text-align:left">Width (${results.unit})</th>
          <th style="background:#020617;color:#fff;padding:9px 10px;text-align:left">Area (${al})</th>
        </tr></thead>
        <tbody>${trs}</tbody>
        <tfoot><tr>
          <td colspan="3" style="padding:9px 10px;border:1px solid #e2e8f0;font-weight:700;text-align:right">TOTAL AREA:</td>
          <td style="padding:9px 10px;border:1px solid #e2e8f0;font-weight:700">${results.total} ${al}</td>
        </tr></tfoot>
      </table>`;

    let plain = `Room Name\tLength (${results.unit})\tWidth (${results.unit})\tArea (${al})\n`;
    results.rooms.forEach(r => { plain += `${r.name}\t${r.length}\t${r.width}\t${r.area}\n`; });
    plain += `TOTAL AREA\t\t\t${results.total} ${al}\n`;

    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html':  new Blob([html],  { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      }),
    ]);
  }

  async function copyToClipboard() {
    if (!results) return;
    try {
      await copyHtmlToClipboard();
      setCopyLabel('✓ Copied — paste in Word/Excel');
      setTimeout(() => setCopyLabel('Copy Table (Word / Excel)'), 4000);
    } catch {
      alert('Could not copy automatically.');
    }
  }

  // ---- AUTH SCREEN ----
  if (!authenticated) {
    return (
      <div className="auth-overlay">
        <div className="auth-box">
          <h3>Employee Access</h3>
          <p>Enter your Employee ID to continue.</p>
          <input
            type="text"
            placeholder="Employee ID"
            value={empId}
            onChange={e => { setEmpId(e.target.value); setAuthError(false); }}
            onKeyDown={e => e.key === 'Enter' && checkAuth()}
            autoFocus
          />
          {authError && <p className="auth-error">Invalid Employee ID. Please try again.</p>}
          <button className="btn-grant" onClick={checkAuth}>Grant Access</button>
        </div>
      </div>
    );
  }

  const al = results ? areaLabel(results.unit) : areaLabel(unit);

  // ---- MAIN APP ----
  return (
    <>
      <header className="site-header">
        <img src="/logo.png" alt="VDS Advisory" className="logo-img" />
        <div className="brand-text">
          <span className="brand-name">VDS ADVISORY</span>
          <span className="brand-tagline">Strategic Real Estate &amp; Funding Advisory</span>
        </div>
      </header>

      <main className="page-body">
        <div className="calc-card">
          <div className="calc-card-header">
            <h2>Room Area Calculator</h2>
            <p>Enter room dimensions to generate a client area report</p>
          </div>

          <div className="calc-card-body">
            {/* Settings */}
            <div className="settings-bar">
              <div className="settings-row">
                <label>Customer Name <span style={{ color: '#ef4444' }}>*</span></label>
                <input
                  type="text"
                  placeholder="Enter customer name"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  className={errors.customerName ? 'error' : ''}
                />
              </div>
              <div className="settings-row">
                <label>Unit System</label>
                <select value={unit} onChange={e => setUnit(e.target.value)}>
                  <option value="ft">Feet (ft)</option>
                  <option value="m">Metres (m)</option>
                  <option value="in">Inches (in)</option>
                </select>
              </div>
            </div>

            {/* Room rows */}
            <div className="rooms-list">
              {rooms.map((room, idx) => (
                <div className="room-row" key={room.id}>
                  <input
                    type="text"
                    className="room-name"
                    placeholder="Room name"
                    value={room.name}
                    onChange={e => updateRoom(room.id, 'name', e.target.value)}
                  />
                  <input
                    type="number"
                    className={`input-dim${errors[`${room.id}_len`] ? ' error' : ''}`}
                    placeholder="Length"
                    min="0"
                    step="any"
                    value={room.length}
                    onChange={e => updateRoom(room.id, 'length', e.target.value)}
                  />
                  <input
                    type="number"
                    className={`input-dim${errors[`${room.id}_wid`] ? ' error' : ''}`}
                    placeholder="Width"
                    min="0"
                    step="any"
                    value={room.width}
                    onChange={e => updateRoom(room.id, 'width', e.target.value)}
                  />
                  {idx >= 4 && (
                    <button type="button" className="btn-remove" onClick={() => removeRoom(room.id)}>✕</button>
                  )}
                </div>
              ))}
            </div>

            <button type="button" className="btn-add" onClick={addRoom}>+ Add Room</button>
            <button type="button" className="btn-calc" onClick={calculate}>Calculate Total Area</button>

            {/* Results */}
            {results && (
              <div className="result-section" ref={resultRef}>
                <hr className="result-divider" />
                <h3>
                  Summary — {customerName.trim()}
                  <span style={{ fontWeight: 400, color: 'var(--text-lt)', fontSize: '0.85rem', marginLeft: 8 }}>
                    ({results.unit} / {al})
                  </span>
                </h3>
                <div className="table-responsive">
                  <table>
                    <thead>
                      <tr>
                        <th>Room Name</th>
                        <th>Length ({results.unit})</th>
                        <th>Width ({results.unit})</th>
                        <th>Area ({al})</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.rooms.map((r, i) => (
                        <tr key={i}>
                          <td>{r.name}</td>
                          <td>{r.length}</td>
                          <td>{r.width}</td>
                          <td>{r.area}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="total-row">
                        <td colSpan={3} style={{ textAlign: 'right' }}>TOTAL AREA</td>
                        <td>{results.total} {al}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="action-buttons">
                  <button
                    type="button"
                    className="btn-pdf"
                    onClick={downloadPDF}
                    disabled={downloading}
                  >
                    {downloading ? 'Generating…' : 'Download PDF'}
                  </button>
                  <button
                    type="button"
                    className={`btn-copy${copyLabel.startsWith('✓') ? ' copied' : ''}`}
                    onClick={copyToClipboard}
                  >
                    {copyLabel}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
