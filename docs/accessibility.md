# Accessibility

Target: WCAG 2.1 AA.

## Automated (every CI run)

`apps/frontend/tests/a11y.spec.ts` runs axe-core with the WCAG 2.1 A/AA rules on the sign-in pages,
dashboard, projects, board, task dialog, a confirmation, notifications and settings, at desktop and
phone size. All of them pass.

The first scan found these problems, all now fixed:

- **Labels not linked to their fields** on sign-up, sign-in, profile, the invite form and the old
  task/project dialogs. Screen readers announced the placeholder ("Acme Corp") instead of "Company
  name". Form controls now use `Field` (`components/ui/states.tsx`) or `htmlFor`/`id`. Sign-in and
  sign-up fields also have `autocomplete` values.
- **Task cards were buttons containing another button** (the drag handle). Now the card is not a
  control: its title is the button that opens the task, the handle is a separate control, and a click
  anywhere on the card still opens it.
- **Low contrast** on the board's "Live" and "Disconnected" badges.

## Keyboard (2026-11-17; starred items are also browser tests)

- **Dialogs\*** (task, add task, project, confirmations) all use `components/ui/Dialog.tsx`. Focus
  moves into the dialog and stays there (Tab and Shift+Tab wrap), Escape closes it, and focus returns
  to the control that opened it. Confirmations focus **Cancel**, so a stray Enter deletes nothing.
  Closing a task with unsaved edits asks first.
- **Skip link:** "Skip to content" is the first element of the signed-in app, hidden until focused,
  and moves focus to the main content.
- **Navigation\*:** `nav` is labelled "Main" and the current page has `aria-current="page"`. On phones
  the menu button opens a drawer that closes on Escape and returns focus to the button.
- **Board\*:** each card's title is a button (Enter opens the task). The drag handle is keyboard
  operable (Space to lift, arrow keys to move, Space to drop, by `@hello-pangea/dnd`); a test moves a
  task to another column this way and checks it was saved. Status can also
  be changed in the task dialog, so drag and drop is never the only way to move a task.
- **Feedback:** toasts are in live regions (errors `role="alert"`, the rest `role="status"`), and
  loading states announce "Loading".

## Not yet reviewed

- A full pass with a screen reader (NVDA or VoiceOver). The roles and names above are in place, but
  the spoken experience has not been heard end to end.
- Zoom to 200% and 400% (reflow), and Windows high-contrast mode.
- Dark mode is scanned only as far as the CI browser's color scheme (light).
