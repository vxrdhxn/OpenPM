# Using OpenPM

## Getting started

1. **Create a workspace** at `/register`: your company name, a workspace slug (the short name in
   links, lowercase), and your own account. You become its owner.
2. The dashboard welcomes a new workspace with three steps. **Create your first project**: a project
   holds a board of tasks for one piece of work.
3. **Invite your team** from Settings → Organization. Each invite has a role, and the invite link
   expires after 7 days.

## Roles

| Role | Can |
| --- | --- |
| Viewer | See projects, tasks, comments and attachments. |
| Member | Everything a viewer can, plus create and edit projects and tasks, comment, attach files, and create, rename and apply labels. |
| Admin | Everything a member can, plus delete projects, tasks and labels, and invite and manage members. |
| Owner | Everything an admin can, plus manage other admins and owners, transfer ownership and delete the workspace. Every workspace has at least one. |

## Working with tasks

- **Add a task** with *Add task* on a project's board: title, priority, assignee, due date and
  description. New tasks start in *To Do*.
- **Move a task** by dragging its card to another column, or open it and change *Status*. With a
  keyboard, focus a card's drag handle, press Space, use the arrow keys, and press Space again.
- **Open a task** by clicking its card. In the dialog you can edit every field (then *Save changes*),
  add labels, attach files, and comment. Type `@` in a comment to mention someone; they are notified.
- **Delete a task** (admins) from its dialog. You are asked first, and its comments and attachments
  are deleted with it.
- **Find tasks** with the search box and the priority, assignee and label filters above the board.

A task's due date is the end of that day in your time zone. It counts as overdue from the next day.

## Your workspace

Settings → Organization (admins and owners):

- **Rename** the workspace. Its slug stays the same.
- **Transfer ownership** (owners): the crown next to a member makes them the owner, and you become an
  admin. A workspace always has an owner, so the last owner transfers ownership before leaving.
- **Delete the workspace** (owners): type its slug and your password. Everything in it is deleted
  and everyone is signed out. This cannot be undone.

Someone who receives an invitation they don't want can **decline** it from the invitation page.
Admins see it marked declined and can invite them again later.

## Projects

*Edit project* on a board renames it, changes its description, or **archives** it. Archived projects
keep their tasks but leave the dashboard. Admins can delete a project from the same dialog, which
deletes all of its tasks. To keep the history, archive instead.

**Private projects.** A project is open to everyone in the workspace unless you make it private
(*Who can see it* when creating or editing it). A private project shows a *Private* badge, and only
the people added to it, plus the workspace's admins and owners, can see it or anything in it. Use
*People* on its board to add people, remove them, or leave. Tasks can only be assigned to people
who can see the project, so making a project private, or removing someone from it, unassigns their
tasks there. Changing an existing project's visibility is for admins, owners and whoever created it.

## Live updates and notifications

Boards update live when someone else changes a task. The **Live** badge shows the connection; if it
says *Disconnected*, the board catches up when the connection returns. The bell in the sidebar counts
your unread notifications (assignments and mentions).

## Your account

Settings → Profile changes your name and password. Changing the password signs you out everywhere
else. *Sign out* is at the bottom of the sidebar (in the menu on a phone).
