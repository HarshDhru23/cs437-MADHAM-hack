import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';

/** CR-72 (CP-31): closing a dialog, however it is closed, puts keyboard focus back on the button that opened it. */
function Host({ kind }: { kind: 'dialog' | 'confirm' }) {
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  return (
    <div>
      {gone ? null : <button onClick={() => setOpen(true)}>Open it</button>}
      <button onClick={() => setGone(true)}>Remove opener</button>
      {kind === 'dialog' ? (
        <Dialog open={open} title="A dialog" onClose={() => setOpen(false)} actions={<button onClick={() => setOpen(false)}>Done</button>}>
          <p>Body</p>
        </Dialog>
      ) : (
        <ConfirmDialog open={open} title="Sure?" confirmLabel="Yes" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)}>
          <p>Body</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

describe('dialogs return focus to their opener', () => {
  it('the close button puts focus back on the button that opened the dialog', async () => {
    render(<Host kind="dialog" />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    await userEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'A dialog' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close A dialog' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('an action button that closes the dialog does too', async () => {
    render(<Host kind="dialog" />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(opener).toHaveFocus();
  });

  it('Escape (the dialog cancel event) does too', async () => {
    render(<Host kind="dialog" />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    await userEvent.click(opener);
    screen.getByRole('button', { name: 'Done' }).focus();   // focus is inside the dialog when Escape is pressed
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(opener).toHaveFocus();
  });

  it('a confirm dialog returns focus after Cancel', async () => {
    render(<Host kind="confirm" />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(opener).toHaveFocus();
  });

  it('focus stays where it is while the dialog is open', async () => {
    // Negative: only closing moves focus; opening or re-rendering an open dialog does not steal it back.
    render(<Host kind="dialog" />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }).closest('dialog')!.querySelector('h2')!);
    expect(opener).not.toHaveFocus();
  });

  it('an opener that has left the page is not an error, and nothing else is focused instead', async () => {
    render(<Host kind="dialog" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    // The dialog's own buttons are reachable; remove the opener behind it, then close.
    fireEvent.click(screen.getByRole('button', { name: 'Remove opener', hidden: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open it' })).not.toBeInTheDocument();
  });
});
