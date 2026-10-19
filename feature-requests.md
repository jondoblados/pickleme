# PickleMe feature requests

Tracks requested features and their status. When a feature ships, its status changes to **Implemented** with the
version and date, and the details go in `changelog.md`.

**Process:** new feature ideas raised by Jon or in discussion are added here only after Jon confirms.

Status key: **Requested** · **In progress** · **Implemented** · **Declined**

## Summary

| ID | Feature | Status | Requested | Implemented |
|---|---|---|---|---|
| FR-001 | Create group | Requested | 2026-10-19 | — |
| FR-002 | Group switcher | Requested | 2026-10-19 | — |
| FR-003 | Group-aware invites and game links | Requested | 2026-10-19 | — |

## Details

### FR-001 — Create group
- **Status:** Requested
- **Requested:** 2026-10-19 by Jon
- **Description:** Admins can create a new group from the app by giving it a name, default player limit and timezone.
  The person who creates it becomes that group's admin.
- **Notes:** The database already supports multiple groups; this needs a secure `create_group` function and a form in the app.
  Decide who may create groups (e.g. only existing admins).

### FR-002 — Group switcher
- **Status:** Requested
- **Requested:** 2026-10-19 by Jon
- **Description:** A group picker in the header that remembers the last group you used. The games list, New game and
  Members & invites all follow the selected group. Players in several groups can also see a combined "My games" list
  with each game labelled by group.
- **Notes:** Today the app always uses the user's first group (`me.groups[0]`).

### FR-003 — Group-aware invites and game links
- **Status:** Requested
- **Requested:** 2026-10-19 by Jon
- **Description:** Invite links add players to the correct group (already true in the database), and opening a game link
  from another group switches the app to that group automatically.
- **Notes:** Depends on FR-002.
