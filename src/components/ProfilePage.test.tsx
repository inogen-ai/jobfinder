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
  it('starts empty when there is no profile and goes back', async () => {
    const onBack = vi.fn()
    render(<ProfilePage api={{ get: async () => null, save: vi.fn() }} onBack={onBack} onSaved={() => {}} />)
    expect(await screen.findByLabelText('CV')).toHaveValue('')
    await userEvent.click(screen.getByRole('button', { name: 'Back to pipeline' }))
    expect(onBack).toHaveBeenCalled()
  })
})
