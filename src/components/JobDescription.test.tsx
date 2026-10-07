import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { JobDescription } from './JobDescription'
import { makeRole } from '../test/factories'
import type { GenerateClient } from '../lib/generate'

const client = (r: Awaited<ReturnType<GenerateClient['fetchPosting']>>): GenerateClient => ({ generate: vi.fn(), fetchPosting: vi.fn(async () => r) })

describe('JobDescription', () => {
  it('previews fetched text and saves it on Use this', async () => {
    const onSave = vi.fn(async () => null)
    render(<JobDescription role={makeRole({ url: 'https://x' })} client={client({ text: 'We need RAG.' })} onSave={onSave} />)
    await userEvent.click(screen.getByRole('button', { name: 'Fetch from link' }))
    expect(await screen.findByText('We need RAG.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))
    expect(onSave).toHaveBeenCalledWith('We need RAG.')
    expect(screen.getByLabelText('Job description')).toHaveValue('We need RAG.')
  })
  it('Discard leaves the description untouched', async () => {
    const onSave = vi.fn(async () => null)
    render(<JobDescription role={makeRole({ url: 'https://x', jobDescription: 'Mine' })} client={client({ text: 'Fetched' })} onSave={onSave} />)
    await userEvent.click(screen.getByRole('button', { name: 'Fetch from link' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Job description')).toHaveValue('Mine')
  })
  it('explains when the site blocks fetching', async () => {
    render(<JobDescription role={makeRole({ url: 'https://linkedin.com/x' })} client={client({ unavailable: true })} onSave={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Fetch from link' }))
    expect(await screen.findByText("This site doesn't allow fetching — paste the job description instead.")).toBeInTheDocument()
  })
  it('follows a colleague\'s update when there are no local edits, and warns when there are', async () => {
    const c = client({ unavailable: true })
    const { rerender } = render(<JobDescription role={makeRole({ jobDescription: 'v1' })} client={c} onSave={vi.fn()} />)
    rerender(<JobDescription role={makeRole({ jobDescription: 'v2 from Herman' })} client={c} onSave={vi.fn()} />)
    expect(screen.getByLabelText('Job description')).toHaveValue('v2 from Herman')
    await userEvent.type(screen.getByLabelText('Job description'), ' + mine')
    rerender(<JobDescription role={makeRole({ jobDescription: 'v3' })} client={c} onSave={vi.fn()} />)
    expect(screen.getByLabelText('Job description')).toHaveValue('v2 from Herman + mine')
    expect(screen.getByText('A colleague updated this description. Saving will replace their version.')).toBeInTheDocument()
  })
  it('saves pasted text', async () => {
    const onSave = vi.fn(async () => null)
    render(<JobDescription role={makeRole()} client={client({ unavailable: true })} onSave={onSave} />)
    expect(screen.getByRole('button', { name: 'Fetch from link' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Job description'), 'Pasted')
    await userEvent.click(screen.getByRole('button', { name: 'Save description' }))
    expect(onSave).toHaveBeenCalledWith('Pasted')
  })
})
