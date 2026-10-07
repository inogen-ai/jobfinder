import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GenerateButtons } from './GenerateButtons'

describe('GenerateButtons', () => {
  it('is disabled with a link to the profile when there is no CV', async () => {
    const onOpenProfile = vi.fn()
    render(<GenerateButtons profileReady={false} busy={false} onGenerate={vi.fn()} onOpenProfile={onOpenProfile} />)
    expect(screen.getByText('Add your CV to your profile first.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cover letter' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Open my profile' }))
    expect(onOpenProfile).toHaveBeenCalled()
  })
  it('passes the instruction, and answers need questions first', async () => {
    const onGenerate = vi.fn()
    render(<GenerateButtons profileReady busy={false} onGenerate={onGenerate} onOpenProfile={() => {}} />)
    await userEvent.type(screen.getByLabelText('Instructions (optional)'), 'Lead with GCP')
    await userEvent.click(screen.getByRole('button', { name: 'Recruiter email' }))
    expect(onGenerate).toHaveBeenCalledWith('pitch', { instruction: 'Lead with GCP', questions: '' })
    await userEvent.click(screen.getByRole('button', { name: 'Application answers' }))
    const go = screen.getByRole('button', { name: 'Generate answers' })
    expect(go).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Application questions'), 'Why this role?')
    await userEvent.click(go)
    expect(onGenerate).toHaveBeenLastCalledWith('answers', { instruction: 'Lead with GCP', questions: 'Why this role?' })
  })
})
