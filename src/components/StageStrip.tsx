import type { StageFilter } from '../lib/pipeline'

const STAGES: Array<[StageFilter, string]> = [
  ['Active', 'Active'], ['Shortlist', 'Shortlist'], ['Applied', 'Applied'], ['Interviewing', 'Interviewing'],
  ['Offer', 'Offer'], ['Due14', 'Deadline ≤ 14 days'], ['Archive', 'Archived'],
]

export function StageStrip({ counts, value, onChange }: {
  counts: Record<StageFilter, number>; value: StageFilter; onChange: (s: StageFilter) => void
}) {
  return (
    <nav className="stages" aria-label="Filter by stage">
      {STAGES.map(([key, label]) => (
        <button key={key} className="stage" aria-pressed={value === key}
          onClick={() => onChange(value === key && key !== 'Active' ? 'Active' : key)}>
          <span className="n">{counts[key]}</span>
          <span className="l">{label}</span>
        </button>
      ))}
    </nav>
  )
}
