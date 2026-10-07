import { FITS, MARKETS } from '../lib/types'
import type { Filters } from '../lib/pipeline'

export function FilterBar({ filters, onChange, onAdd }: {
  filters: Filters; onChange: (f: Filters) => void; onAdd: () => void
}) {
  return (
    <div className="toolbar">
      <div className="seg" role="group" aria-label="Market">
        {(['All', ...MARKETS] as const).map((m) => (
          <button key={m} aria-pressed={filters.market === m} onClick={() => onChange({ ...filters, market: m })}>{m}</button>
        ))}
      </div>
      <div className="seg" role="group" aria-label="Fit">
        {(['Any', ...FITS] as const).map((f) => (
          <button key={f} aria-pressed={filters.fit === f} onClick={() => onChange({ ...filters, fit: f })}>{f === 'Any' ? 'Any fit' : f}</button>
        ))}
      </div>
      <input id="q" type="search" aria-label="Search" placeholder="Search roles, companies, notes"
        value={filters.query} onChange={(e) => onChange({ ...filters, query: e.target.value })} />
      <button className="btn primary" onClick={onAdd}>Add role</button>
    </div>
  )
}
