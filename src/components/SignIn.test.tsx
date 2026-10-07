import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignIn } from './SignIn'

describe('SignIn', () => {
  it('calls onSignIn', async () => {
    const onSignIn = vi.fn()
    render(<SignIn refused={false} onSignIn={onSignIn} />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }))
    expect(onSignIn).toHaveBeenCalled()
  })
  it('explains why the user was signed out', () => {
    render(<SignIn refused={false} message="Your session has ended. Sign in again." onSignIn={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Your session has ended. Sign in again.')
  })
  it('explains a refusal', () => {
    render(<SignIn refused onSignIn={() => {}} />)
    expect(screen.getByText('This tracker is limited to InoGen accounts.')).toBeInTheDocument()
  })
})
