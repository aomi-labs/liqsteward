import { useState } from 'react';
import { relationships, type Relationship } from './data';

export function Concept({ kind, hero = false }: { kind: number; hero?: boolean }) {
  return <svg className={`st-concept ${hero ? 'st-concept-hero' : ''}`} viewBox="0 0 420 230" role="img" aria-label={['Nested claims converge into a source-backed valuation', 'A defined shock propagates into alternative portfolio states', 'Candidate routes pass through mandate checks into a transaction package'][kind]}>
    <defs><pattern id={`grid-${kind}-${hero}`} width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="currentColor" opacity=".15" /></pattern></defs>
    <rect width="420" height="230" fill={`url(#grid-${kind}-${hero})`} />
    {kind === 0 ? <>
      {[45, 115, 185].map((y, i) => <g key={y}><path d={`M42 ${y} H95 Q125 ${y} 155 115 H203`} fill="none" stroke="currentColor" opacity=".5" /><circle cx="42" cy={y} r="6" fill="var(--st-lime)" stroke="currentColor" /><text x="14" y={y - 15}>{['Claims', 'Assets', 'Debt'][i]}</text></g>)}
      <circle cx="225" cy="115" r="64" fill="var(--st-lime)" opacity=".5" /><circle cx="225" cy="115" r="49" fill="none" stroke="currentColor" /><circle cx="225" cy="115" r="28" fill="none" stroke="currentColor" /><path d="M225 63V167 M173 115H277" stroke="currentColor" opacity=".4" /><circle cx="225" cy="115" r="6" fill="currentColor" /><path d="M290 115H347" stroke="currentColor" /><rect x="347" y="83" width="45" height="64" fill="var(--st-paper)" stroke="currentColor" /><path d="M356 100h27m-27 10h27m-27 10h18m-18 10h23" stroke="currentColor" /><text x="183" y="210">Valuation lens</text>
    </> : kind === 1 ? <>
      <path d="M30 115H130C210 115 195 45 280 45H386 M130 115H386 M130 115C210 115 195 185 280 185H386" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="130" cy="115" r="38" fill="var(--st-blue)" stroke="currentColor" /><path d="M107 115h12l8-18 11 37 9-19h7" fill="none" stroke="currentColor" strokeWidth="2" />
      {[45, 115, 185].map((y, i) => <g key={y}><circle cx="330" cy={y} r="16" fill={i === 2 ? 'var(--st-peach)' : 'var(--st-blue)'} stroke="currentColor" /><text x="264" y={y - 24}>{['Baseline', 'Liquidity stress', 'Threshold breach'][i]}</text></g>)}
      <text x="87" y="181">Defined shock</text>
    </> : <>
      {[50, 115, 180].map((y, i) => <path key={y} d={`M30 ${y}H115C160 ${y} 170 115 205 115H300`} fill="none" stroke="currentColor" strokeWidth={i === 1 ? 3 : 1} strokeDasharray={i === 1 ? undefined : '4 5'} opacity={i === 1 ? 1 : .4} />)}
      <rect x="185" y="55" width="44" height="120" fill="var(--st-peach)" stroke="currentColor" /><path d="m196 115 8 8 15-19" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="306" y="73" width="75" height="84" fill="var(--st-paper)" stroke="currentColor" /><path d="M319 94h48m-48 13h48m-48 13h31m-31 20h24" stroke="currentColor" /><text x="155" y="207">Policy gates</text><text x="292" y="183">Unsigned batch</text>
    </>}
  </svg>;
}

const palette = ['var(--st-blue)', 'var(--st-lime)', 'var(--st-peach)', '#aebfa6', '#cfb8a0', '#c5bfdb'];
export function Ecosystem() {
  const [economic, setEconomic] = useState(false);
  const [focus, setFocus] = useState('All parties');
  const [selected, setSelected] = useState<Relationship>(relationships[0]!);
  const rows = relationships;
  const columns = [Array.from(new Set(rows.map(r => r.operator))), Array.from(new Set(rows.map(r => r.venue))), Array.from(new Set(rows.map(r => r.tool)))];
  const heights = columns.map((names, column) => names.map(name => rows.filter(r => [r.operator, r.venue, r.tool][column] === name).length * 19));
  const height = Math.max(...heights.map(h => h.reduce((a, b) => a + b, 0) + (h.length - 1) * 23)) + 95;
  const offsets = heights.map(h => { let y = 65 + (height - 95 - h.reduce((a, b) => a + b, 0) - (h.length - 1) * 23) / 2; return h.map(value => { const start = y; y += value + 23; return start; }); });
  const x = [210, 565, 930];
  const cursor: Record<string, number> = {};
  const focused = (r: Relationship) => focus === 'All parties' || [r.operator, r.venue, r.tool].includes(focus);
  function selectParty(name: string) { setFocus(name); const r = rows.find(r => [r.operator, r.venue, r.tool].includes(name)); if (r) setSelected(r); }
  return <>
    <div className="st-map-tools"><div className="st-segment" aria-label="Map view"><button aria-pressed={!economic} onClick={() => setEconomic(false)}>Operating relationships</button><button aria-pressed={economic} onClick={() => setEconomic(true)}>Capital & control</button></div>
    </div>
    {economic ? <div className="st-economic">
      <div className="st-control-line"><span>Curator / strategist<br /><b>Mandate & allocation decisions</b></span><i>Instructions →</i><span>Execution controls<br /><b>Roles · policy · signing</b></span></div>
      <p className="st-caption">CAPITAL PLANE · assets move between wallets and contracts</p>
      <div className="st-money-flow">{[['Capital owners','Institutions · DAOs · depositors'],['Vault contracts','Shares · accounting · withdrawals'],['Strategy venues','Lending · DEXs · restaking'],['Economic users','Borrowers · traders · networks']].map(([name, detail], i) => <div key={name}><b>{name}</b><span>{detail}</span>{i < 3 && <i aria-hidden="true">→</i>}</div>)}</div>
      <div className="st-yield-line">← Interest, fees and rewards accrue to positions; redemption returns available principal and yield.</div>
      <div className="st-data-line">Data & risk monitoring → valuation, scenario analysis, and manager review</div>
      <p className="st-note">Conceptual operating model. Returns and withdrawals depend on the strategy; losses and liquidity constraints remain possible. Curators and execution tools are not capital destinations.</p>
    </div> : <>
      <div className="st-map-filter"><label>Focus <select value={focus} onChange={e => selectParty(e.target.value)}><option>All parties</option>{Array.from(new Set(columns.flat())).map(name => <option key={name}>{name}</option>)}</select></label><span><i /> Relationship count, not TVL · faded ribbons indicate supported options</span></div>
      <div className="st-ribbon-wrap"><svg className="st-ribbons" viewBox={`0 0 1240 ${height}`} role="group" aria-label="Named curator, venue and execution-control relationships">
        {['CURATOR / OPERATOR','VAULT VENUE','EXECUTION / CONTROL'].map((label, i) => <text key={label} x={[8,565,945][i]} y="25" className="st-svg-caption">{label}</text>)}
        {rows.map((r, i) => [0,1].map(segment => {
          const names = [r.operator, r.venue, r.tool]; const a = columns[segment]!.indexOf(names[segment]!); const b = columns[segment+1]!.indexOf(names[segment+1]!);
          const startKey = `${segment}:${names[segment]}:out`; const endKey = `${segment+1}:${names[segment+1]}:in`;
          const y1 = offsets[segment]![a]! + (cursor[startKey] || 0) + 9.5; const y2 = offsets[segment+1]![b]! + (cursor[endKey] || 0) + 9.5;
          cursor[startKey] = (cursor[startKey] || 0) + 19; cursor[endKey] = (cursor[endKey] || 0) + 19;
          const sx = x[segment]! + 9, ex = x[segment+1]!, mid = (sx + ex)/2;
          return <path key={`${i}-${segment}`} d={`M${sx} ${y1}C${mid} ${y1} ${mid} ${y2} ${ex} ${y2}`} fill="none" stroke={palette[columns[1]!.indexOf(r.venue)%palette.length]} strokeWidth="18" opacity={focused(r) ? r.supported ? .38 : .78 : .08} onClick={() => { setSelected(r); setFocus(r.operator); }}><title>{`${r.operator} → ${r.venue} → ${r.tool}${r.supported ? ' · supported option' : ''}`}</title></path>;
        }))}
        {columns.map((names, column) => names.map((name, i) => <g key={`${column}-${name}`} role="button" tabIndex={0} aria-label={`Focus ${name}`} onClick={() => selectParty(name)} onKeyDown={e => { if(e.key==='Enter'||e.key===' ') { e.preventDefault(); selectParty(name); } }} className="st-map-node">
          <rect x={x[column]} y={offsets[column]![i]} width="9" height={heights[column]![i]} rx="3" fill={column === 1 ? palette[i%palette.length] : 'var(--st-ink)'} />
          <text x={column === 0 ? 8 : x[column]!+17} y={offsets[column]![i]!+heights[column]![i]!/2+5}>{name}</text>
        </g>))}
      </svg></div>
      <div className="st-mobile-routes">{rows.filter(focused).map((r,i) => <button key={i} onClick={() => setSelected(r)}><b>{r.operator}</b><span>↓ {r.venue} ↓</span><b>{r.tool}</b></button>)}</div>
      <div className="st-map-detail" aria-live="polite"><span className="st-caption">{selected.supported ? 'VENUE-SUPPORTED OPTION' : 'DOCUMENTED OPERATING RELATIONSHIP'}</span><h3>{selected.operator} <span>→</span> {selected.venue} <span>→</span> {selected.tool}</h3><p>{selected.note}</p><a href={selected.source} target="_blank" rel="noreferrer">Inspect source ↗</a></div>
      <p className="st-note">Representative research map, compiled September 2026. Roles and relationships can change. Named organizations are not implied Steward customers, endorsers, or supported integrations.</p>
    </>}
    <div className="st-support"><strong>STEWARD</strong><span>Portfolio valuation</span><span>Scenario analysis</span><span>Transaction preparation</span><small>Supporting operations. Not a destination for funds.<br />Integration scope is confirmed per engagement.</small></div>
  </>;
}
