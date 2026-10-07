import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoleEditor } from './RoleEditor'
import { makeRole } from '../test/factories'

const now = new Date(2026, 9, 6, 9)

describe('RoleEditor', () => {
  it('keeps an unsaved draft when a live update to the same role arrives', async () => {
    const role = makeRole({ id: 'r1', notes: 'old' })
    const { rerender } = render(<RoleEditor role={role} now={now} onSave={vi.fn()} onDelete={vi.fn()} />)
    const notes = screen.getByLabelText('Notes')
    await userEvent.clear(notes)
    await userEvent.type(notes, 'my draft')
    rerender(<RoleEditor role={{ ...role, rate: '€100/h', updatedBy: 'herman@inogen.ai' }} now={now} onSave={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByLabelText('Notes')).toHaveValue('my draft')
  })
  it('resets when a different role is shown', async () => {
    const { rerender } = render(<RoleEditor role={makeRole({ id: 'r1', notes: 'one' })} now={now} onSave={vi.fn()} onDelete={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Notes'), ' edited')
    rerender(<RoleEditor role={makeRole({ id: 'r2', notes: 'two' })} now={now} onSave={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByLabelText('Notes')).toHaveValue('two')
  })
  it('saves a cleared date as null', async () => {
    const onSave = vi.fn(async () => null)
    render(<RoleEditor role={makeRole({ deadline: '2026-10-18' })} now={now} onSave={onSave} onDelete={vi.fn()} />)
    await userEvent.clear(screen.getByLabelText('Deadline'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ deadline: null }))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })
  it('shows the save error', async () => {
    render(<RoleEditor role={makeRole()} now={now} onSave={async () => 'This role was deleted by someone else.'} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('This role was deleted by someone else.')).toBeInTheDocument()
  })
  it('asks before deleting', async () => {
    const onDelete = vi.fn(async () => null)
    render(<RoleEditor role={makeRole()} now={now} onSave={vi.fn()} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete role' }))
    expect(onDelete).toHaveBeenCalled()
  })
  it('shows who last updated it', () => {
    render(<RoleEditor role={makeRole({ updatedBy: 'herman.wigge@inogen.ai', updatedAt: new Date(now.getTime() - 2 * 3_600_000).toISOString() })} now={now} onSave={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('Updated by Herman, 2h ago')).toBeInTheDocument()
  })
})
