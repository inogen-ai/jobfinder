import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DraftEditor } from './DraftEditor'

describe('DraftEditor', () => {
  it('while streaming shows the text read-only with Stop', async () => {
    const onStop = vi.fn()
    render(<DraftEditor title="Cover letter · unsaved" body="Dear" streaming onStop={onStop} />)
    expect(screen.getByLabelText('Draft')).toHaveValue('Dear')
    expect(screen.getByLabelText('Draft')).toHaveAttribute('readonly')
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalled()
  })
  it('saves edits and passes the instruction and current text to regenerate', async () => {
    const onSave = vi.fn(async () => null)
    const onRegenerate = vi.fn()
    render(<DraftEditor title="t" body="Hello" streaming={false} onSave={onSave} onRegenerate={onRegenerate} />)
    await userEvent.type(screen.getByLabelText('Draft'), ' world')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith('Hello world')
    await userEvent.type(screen.getByLabelText('Regenerate instruction'), 'shorter')
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(onRegenerate).toHaveBeenCalledWith('shorter', 'Hello world')
  })
  it('previews markdown as headings and lists', async () => {
    render(<DraftEditor title="t" body={'# Title\n\n- one'} streaming={false} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
    expect(screen.getByRole('listitem')).toHaveTextContent('one')
  })
  it('copies to the clipboard', async () => {
    const user = userEvent.setup() // installs a clipboard stub on navigator; spy on it after setup
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    render(<DraftEditor title="t" body="Copy me" streaming={false} />)
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('Copy me')
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })
})
