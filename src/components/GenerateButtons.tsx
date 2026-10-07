import { useState } from 'react'
import { DOC_KINDS, DOC_KIND_LABEL, type DocKind } from '../lib/documents'

export function GenerateButtons({ profileReady, busy, onGenerate, onOpenProfile }: {
  profileReady: boolean; busy: boolean
  onGenerate: (kind: DocKind, opts: { instruction: string; questions: string }) => void
  onOpenProfile: () => void
}) {
  const [instruction, setInstruction] = useState('')
  const [asking, setAsking] = useState(false)
  const [questions, setQuestions] = useState('')
  const disabled = busy || !profileReady

  return (
    <div className="gen">
      {!profileReady && (
        <p className="notice">Add your CV to your profile first. <button type="button" className="linkish" onClick={onOpenProfile}>Open my profile</button></p>
      )}
      <label className="gen-instr"><span>Instructions (optional)</span>
        <input value={instruction} maxLength={1000} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. shorter, in Dutch, lead with GCP" /></label>
      <div className="gen-kinds">
        {DOC_KINDS.map((kind) => (
          <button key={kind} type="button" className="btn" disabled={disabled}
            onClick={() => (kind === 'answers' ? setAsking((a) => !a) : onGenerate(kind, { instruction, questions: '' }))}>
            {DOC_KIND_LABEL[kind]}
          </button>
        ))}
      </div>
      {asking && (
        <div className="gen-questions">
          <label><span>Application questions</span>
            <textarea value={questions} maxLength={8000} onChange={(e) => setQuestions(e.target.value)} placeholder="Paste the questions from the application form" /></label>
          <button type="button" className="btn primary" disabled={disabled || !questions.trim()}
            onClick={() => onGenerate('answers', { instruction, questions })}>Generate answers</button>
        </div>
      )}
    </div>
  )
}
