import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Pipeline } from './Pipeline'
import { makeRole } from '../test/factories'
import { RoleError, type RoleChange, type LiveStatus, type RolesApi } from '../lib/roles'
import type { Role } from '../lib/types'
import { RunStore } from '../lib/runStore'

const now = new Date(2026, 9, 6, 9)

function fakeApi(roles: Role[]) {
  let push: (c: RoleChange) => void = () => {}
  let status: (s: LiveStatus) => void = () => {}
  const api: RolesApi = {
    list: vi.fn(async () => roles),
    create: vi.fn(async (input) => ({ ...makeRole(), ...input })),
    update: vi.fn(async (id, patch) => ({ ...roles.find((r) => r.id === id)!, ...patch } as Role)),
    remove: vi.fn(async () => {}),
    subscribe: vi.fn((onChange, onStatus) => { push = onChange; status = onStatus; return () => {} }),
  }
  return { api, push: (c: RoleChange) => act(() => push(c)), status: (s: LiveStatus) => act(() => status(s)) }
}

const props = { userEmail: 'michael.snow@inogen.ai', onSignOut: vi.fn(), onAuthError: vi.fn(), now }

describe('Pipeline', () => {
  beforeEach(() => localStorage.clear())

  it('shows roles sorted by stage', async () => {
    const { api } = fakeApi([makeRole({ id: 'a', title: 'Shortlisted role' }), makeRole({ id: 'b', title: 'Applied role', status: 'Applied' })])
    render(<Pipeline api={api} {...props} />)
    const titles = await screen.findAllByText(/role$/, { selector: '.role-t' })
    expect(titles.map((t) => t.textContent)).toEqual(['Applied role', 'Shortlisted role'])
  })

  it('reverts a failed status change and says why', async () => {
    const { api } = fakeApi([makeRole({ id: 'a', title: 'Role A' })])
    vi.mocked(api.update).mockRejectedValueOnce(new RoleError('down', 'network'))
    render(<Pipeline api={api} {...props} />)
    const select = await screen.findByLabelText('Status for Role A')
    await userEvent.selectOptions(select, 'Applied')
    await waitFor(() => expect(select).toHaveValue('Shortlist'))
    expect(screen.getByText("Couldn't save. Check your connection and try again.")).toBeInTheDocument()
  })

  it('signs out on an auth error', async () => {
    const { api } = fakeApi([makeRole({ id: 'a', title: 'Role A' })])
    vi.mocked(api.update).mockRejectedValueOnce(new RoleError('jwt', 'auth'))
    render(<Pipeline api={api} {...props} />)
    await userEvent.selectOptions(await screen.findByLabelText('Status for Role A'), 'Applied')
    await waitFor(() => expect(props.onAuthError).toHaveBeenCalled())
  })

  it('closes the editor when someone else deletes the open role', async () => {
    const { api, push } = fakeApi([makeRole({ id: 'a', title: 'Role A' })])
    render(<Pipeline api={api} {...props} />)
    await userEvent.click(await screen.findByText('Role A'))
    expect(screen.getByLabelText('Notes')).toBeInTheDocument()
    push({ type: 'delete', id: 'a' })
    await waitFor(() => expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument())
  })

  it('says so when you save a role someone else deleted', async () => {
    const { api } = fakeApi([makeRole({ id: 'a', title: 'Role A' })])
    vi.mocked(api.update).mockRejectedValueOnce(new RoleError('0 rows', 'missing'))
    render(<Pipeline api={api} {...props} />)
    await userEvent.click(await screen.findByText('Role A'))
    await userEvent.type(screen.getByLabelText('Notes'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('This role was deleted by someone else.')).toBeInTheDocument()
    expect(screen.queryByText('Role A')).not.toBeInTheDocument()
  })

  it('a slow failed status change cannot undo a later successful one', async () => {
    const { api } = fakeApi([makeRole({ id: 'a', title: 'Role A' })])
    let failFirst!: () => void
    vi.mocked(api.update)
      .mockImplementationOnce(() => new Promise((_, reject) => { failFirst = () => reject(new RoleError('down', 'network')) }))
      .mockImplementationOnce(async (_id, patch) => ({ ...makeRole({ id: 'a', title: 'Role A' }), ...patch } as Role))
    render(<Pipeline api={api} {...props} />)
    const select = await screen.findByLabelText('Status for Role A')
    await userEvent.selectOptions(select, 'Applied')
    await userEvent.selectOptions(select, 'Interviewing')
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2))
    await act(async () => failFirst())
    expect(screen.getByLabelText('Status for Role A')).toHaveValue('Interviewing')
  })
  it('a status change on a role someone deleted removes the row', async () => {
    const { api } = fakeApi([makeRole({ id: 'a', title: 'Role A' })])
    vi.mocked(api.update).mockRejectedValueOnce(new RoleError('0 rows', 'missing'))
    render(<Pipeline api={api} {...props} />)
    await userEvent.selectOptions(await screen.findByLabelText('Status for Role A'), 'Applied')
    expect(await screen.findByText('This role was deleted by someone else.')).toBeInTheDocument()
    expect(screen.queryByText('Role A')).not.toBeInTheDocument()
  })
  it('the clock ticks: the countdown changes at midnight', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      vi.setSystemTime(new Date(2026, 9, 6, 23, 59, 30))
      const { api } = fakeApi([])
      const { now: _ignored, ...noClock } = props
      render(<Pipeline api={api} {...noClock} />)
      expect(await screen.findByText('25')).toBeInTheDocument()
      await act(async () => { vi.advanceTimersByTime(60_000) })
      expect(screen.getByText('24')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
  it('applies live upserts from colleagues', async () => {
    const { api, push } = fakeApi([])
    render(<Pipeline api={api} {...props} />)
    await screen.findByText('No roles yet.')
    push({ type: 'upsert', role: makeRole({ id: 'n', title: 'New from Herman' }) })
    expect(await screen.findByText('New from Herman')).toBeInTheDocument()
  })

  it('shows the paused banner and reloads after reconnecting', async () => {
    const { api, status } = fakeApi([])
    render(<Pipeline api={api} {...props} />)
    await screen.findByText('No roles yet.')
    status('paused')
    expect(screen.getByText('Live updates paused. Reconnecting…')).toBeInTheDocument()
    status('live')
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Live updates paused. Reconnecting…')).not.toBeInTheDocument()
  })

  it('adds a role', async () => {
    const { api } = fakeApi([])
    render(<Pipeline api={api} {...props} />)
    await screen.findByText('No roles yet.')
    await userEvent.click(screen.getByRole('button', { name: 'Add role' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Role title'), 'ML Engineer')
    await userEvent.type(within(dialog).getByLabelText('Company or agency'), 'Acme')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add role' }))
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'ML Engineer', org: 'Acme', status: 'Shortlist', market: 'UK' }))
    expect(await screen.findByText('ML Engineer')).toBeInTheDocument()
  })
  it('shows each role\'s draft count and opens the profile', async () => {
    const { api } = fakeApi([makeRole({ id: 'a', title: 'Role A' })])
    const onOpenProfile = vi.fn()
    const docs = {
      api: { list: vi.fn(async () => []), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), countByRole: vi.fn(async () => ({ a: 2 })) },
      client: { generate: vi.fn(), fetchPosting: vi.fn() },
      runs: new RunStore({ generate: vi.fn(), fetchPosting: vi.fn() }),
      profileReady: true,
      onOpenProfile,
    }
    render(<Pipeline api={api} {...props} docs={docs} />)
    expect(await screen.findByText('2 docs')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'My profile' }))
    expect(onOpenProfile).toHaveBeenCalled()
  })
})
