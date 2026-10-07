import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfilePage } from './ProfilePage'
import { EMPTY_PROFILE, type ProfileApi } from '../lib/profile'

describe('ProfilePage', () => {
  it('loads the existing profile and saves edits', async () => {
    const api: ProfileApi = {
      get: vi.fn(async () => ({ ...EMPTY_PROFILE, headline: 'AI engineer', cvText: 'Old CV' })),
      save: vi.fn(async (p) => p),
    }
    const onSaved = vi.fn()
    render(<ProfilePage api={api} onBack={() => {}} onSaved={onSaved} />)
    const cv = await screen.findByLabelText('CV')
    expect(cv).toHaveValue('Old CV')
    await userEvent.clear(cv)
    await userEvent.type(cv, 'New CV')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ cvText: 'New CV', headline: 'AI engineer' }))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalled()
  })
  it('counts CV characters and refuses to save an over-long CV instead of cutting it', async () => {
    const api: ProfileApi = { get: vi.fn(async () => ({ ...EMPTY_PROFILE, cvText: 'x'.repeat(40_000) })), save: vi.fn(async (p) => p) }
    render(<ProfilePage api={api} onBack={() => {}} onSaved={() => {}} />)
    const cv = await screen.findByLabelText('CV')
    expect(screen.getByText('40,000 / 40,000 characters')).toBeInTheDocument()
    await userEvent.type(cv, 'yz')
    expect(cv).toHaveValue('x'.repeat(40_000) + 'yz')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(api.save).not.toHaveBeenCalled()
    expect(screen.getByText('Your CV is over 40,000 characters. Shorten it before saving.')).toBeInTheDocument()
  })
  it('prompts for a CV when it is empty', async () => {
    render(<ProfilePage api={{ get: async () => null, save: vi.fn() }} onBack={() => {}} onSaved={() => {}} />)
    expect(await screen.findByText('Add your CV to start generating documents.')).toBeInTheDocument()
  })
  it('starts empty when there is no profile and goes back', async () => {
    const onBack = vi.fn()
    render(<ProfilePage api={{ get: async () => null, save: vi.fn() }} onBack={onBack} onSaved={() => {}} />)
    expect(await screen.findByLabelText('CV')).toHaveValue('')
    await userEvent.click(screen.getByRole('button', { name: 'Back to pipeline' }))
    expect(onBack).toHaveBeenCalled()
  })
})
