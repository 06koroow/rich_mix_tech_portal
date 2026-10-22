# Role-Based Permissions & View Streamlining for Duty Techs and Freelancers

A targeted access control and interface streamlining architecture that restricts Duty Technicians and Freelancers to essential operational views (Dashboard, Advancing, Rota & Shifts, Maintenance, Inventory, Procedures, Users), protects event technical specifications with a read-only Advance Sheet and print view, allows inventory transfers while preventing kit deletion, and provides a focused crew contact directory.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following operational access rules and boundaries have been confirmed based on user requirements and clarifying decisions:

- **Confirmed Decision 1 (Event Advance Protection)**: When Duty Techs and Freelancers click an event in Advancing or Rota, the system displays a dedicated **Read-Only Advance Sheet Modal** with full production schedules, timing runs, allocated kit, rider/file viewer, and a 1-click **Print Advance** button. All editing controls, file deletion buttons, and event deletion mechanisms are locked to prevent accidental data loss.
- **Confirmed Decision 2 (Full Administrative Scope)**: Full editing rights for event advancing specs, Venues & Spaces management, and Patch & Preset Manager are strictly limited to **Technical Managers** and **Admins**.
- **Confirmed Decision 3 (Inventory Transfer Control)**: In Inventory, Duty Techs and Freelancers have full permission to move equipment between spaces and stores and scan QR codes, but **Add Item**, **Edit Kit**, **Delete Equipment**, and **Category Setup** are hidden and locked.
- **Confirmed Decision 4 (Users Tab Crew Directory)**: In the Users tab, Duty Techs and Freelancers see a clean, read-only **Crew Contact Directory** with direct email (`mailto:`) and phone (`tel:`) contact actions, completely removing administrative account management and training sign-off manipulation.
- **Confirmed Decision 5 (View Navigation & URL Route Guarding)**: Navigation for Duty Techs and Freelancers only exposes the 7 allowed sections (Dashboard, Advancing, Rota & Shifts, Maintenance, Inventory, Procedures, Users). Both **Patch & Preset Manager** (`#/presets`) and **Venues & Spaces** (`#/venues`) are hidden from navigation and guarded by the router (redirecting to `#/dashboard` with a friendly notice if accessed directly).

---

## 1. Overview & Core Concept

### What It Does
This architecture introduces role-sensitive layout rendering and granular permission gates across the Rich Mix Technical Portal. Depending on the authenticated user's role (or active Dev Override preview), the portal dynamically adapts its navigation menus, route access, event modals, and directory sheets:
- **Duty Technicians & Freelancers** experience a clutter-free, non-destructive workflow focused purely on day-of-show operations: checking call times, printing advance sheets, logging maintenance, moving gear between rooms, reading SOP guides, and finding colleague contact details.
- **Technical Managers & Admins** retain unrestricted administrative authority over event advancing specs, room configurations, patch presets, equipment catalogs, and user permissions.

### Target Audience / Persona
- **Duty Techs & Freelance Crew**: Operating on-site across Rich Mix spaces (The Stage, The Studio, The Mix, Screens 1-3). Need immediate access to run sheets, shift timings, gear locations, and fault reporting without exposure to high-risk administrative settings.
- **Technical Management**: Need peace of mind that touring riders, technical specifications, and room presets cannot be inadvertently altered or erased by shift technicians.

### Key Value
- **Zero Risk of Data Loss**: Eliminates accidental deletions of technical riders, event advance specs, or equipment entries.
- **Cognitive Clarity**: Removes complex setup tabs (Presets, Venues) from technician viewports, reducing navigation noise.
- **Immediate Operational Utility**: Fast, single-click access to print advances, swap shifts, transfer kit, and contact colleagues.

---

## 2. User Experience & Visual Design

### Key User Flows

#### Flow 1: Duty Tech Navigation & View Filtering
```
[User Signs In / Dev Preview as Duty Tech]
   │
   ├─► Sidebar & Mobile Drawer render only 7 permitted items:
   │     1. Dashboard
   │     2. Advancing
   │     3. Rota & Shifts
   │     4. Maintenance
   │     5. Inventory
   │     6. Procedures
   │     7. Users
   │
   └─► Patch & Preset Manager (#/presets) and Venues & Spaces (#/venues) are hidden.
         Direct URL hash navigation to restricted routes triggers clean route-guard fallback to #/dashboard.
```

#### Flow 2: Read-Only Event Advance & Printing
```
[Duty Tech clicks Event in Advancing / Calendar]
   │
   ▼
[Read-Only Advance Sheet Modal]
   ├─► Header: Event title, venue spaces, date, category, status pill
   ├─► Production Timings: Load in, Soundcheck, Doors, Off stage, Curfew, Load out
   ├─► Live Schedule & Set Pieces (Run of Day)
   ├─► Allocated Equipment & Kit List
   ├─► Technical Specifications & Attached Rider Documents (View / Download only; no remove buttons)
   ├─► Lighting & Sound Notes
   └─► Actions:
         ├─► [Print PDF Advance] -> Triggers styled clean printable sheet
         └─► [Close] -> Dismisses modal without mutation
```

#### Flow 3: Safe Inventory Kit Transfers
```
[Duty Tech views Inventory]
   │
   ├─► View catalog, filter by space, search equipment
   ├─► "+ Add Item", "Categories", "Edit", and "Delete" buttons are hidden
   ├─► "Move kit" button and QR scanner remain fully accessible
   └─► Quick modal allows moving kit between spaces and store rooms with immediate state update
```

#### Flow 4: Read-Only Crew Contact Directory in Users Tab
```
[Duty Tech clicks "Users" tab]
   │
   ├─► Page Header: "Crew Directory"
   ├─► Clean list of active technical staff sorted by role and name
   ├─► Each row displays: Avatar/Initials, Full Name, Position, Email, Phone
   ├─► 1-Click Quick Actions: "Call" (tel:) and "Email" (mailto:)
   └─► Administrative access request panels and training signoff checkboxes are suppressed
```

### Visual Identity & Theme
- **Theme Foundations**: Neutral slate surfaces (`bg-panel`, `bg-panel2`), clean borders (`border-line`), and purple accent highlight (`var(--accent)`).
- **Anti-Slop Restraint**: Static metadata uses quiet inline text with typographic separators (`·`, `/`) instead of loud pill clusters. Interactive buttons use defined segmented button styling.
- **Data Densities**: High-density typography with tabular numerals (`tabular-nums`, `font-mono`) for timings, shift call hours, and phone numbers.
- **Print Optimization**: High-contrast, clean black-on-white layout with `@media print` rules hiding navigation, buttons, and browser chrome.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Role Detection & Dev Options Integration
- **Chosen Approach**: Centralize role capabilities in `RMTP.auth.can(cap)` and role checks (`isTechManager`, `isAdmin`, `isDutyTechOrFreelancer`). The Dev Options simulation switcher already allows Technical Managers to toggle roles (`Technical Manager`, `Senior Tech`, `Duty Tech`, `Freelancer`) or preview as specific users.
- **Why**: Allows instant live testing in the browser so the Technical Manager can verify exactly what Duty Techs and Freelancers see and interact with.
- **Alternatives Considered**: Hardcoding checks per view file. Rejected because centralized auth ensures consistent policy across navigation, router, and view renderers.

### Decision 2: Advance Sheet Modal vs Editing Modal
- **Chosen Approach**: When `!canManageEvents`, clicking an event card directly renders the **Read-Only Advance Sheet Modal** with print support, rather than rendering the complex multi-tab form with disabled input fields.
- **Why**: Technicians do not want to see disabled form inputs, save buttons, or complex input tabs. An advance sheet is clean, readable, matches the printed sheet, and eliminates any chance of form submission errors.
- **Alternatives Considered**: Disabling inputs inside the existing `openEventModal`. Rejected because disabling hundreds of inputs across 7 tabs leaves cluttered form fields, file upload dropzones, and deletion buttons that clutter the view.

### Decision 3: Route Guarding in `js/router.js`
- **Chosen Approach**: In `router.js`, inspect the target route. If the route is `presets` or `venues` and the current user is not a Technical Manager or Admin, intercept navigation, display an informative toast (`"Access restricted to Technical Managers"`), and redirect to `#/dashboard`.
- **Why**: Protects against bookmarks, browser history, or manual URL bar typing.

### Decision 4: Users Tab Dual Presentation
- **Chosen Approach**: For Technical Managers and Admins, `views/users.js` provides full user management and competency training signoffs. For Duty Techs and Freelancers, the view renders a streamlined **Crew Contact Directory** with quick phone and email links.
- **Why**: Techs need phone numbers and emails to communicate during show shifts; they do not need access request approvals or training checklists.

---

## 4. Technical Architecture & Data Strategy

### System Architecture & Permission Gates

```
┌────────────────────────────────────────────────────────────────────────┐
│                          RMTP.auth.current()                           │
│  (Real user or Dev Options Override: TM / Senior Tech / Duty Tech / FL)│
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
         ┌─────────────────────────┴─────────────────────────┐
         ▼                                                   ▼
┌───────────────────────────────────┐       ┌────────────────────────────────────┐
│      Technical Manager / Admin    │       │       Duty Tech / Freelancer       │
└────────────────┬──────────────────┘       └────────────────┬───────────────────┘
                 │                                           │
                 ├─► Nav: All 9 sections                     ├─► Nav: 7 sections only
                 │    (incl. Presets & Venues)               │    (Presets & Venues hidden)
                 │                                           │
                 ├─► Router: All routes                      ├─► Router: Guard presets & venues
                 │                                           │    (Redirect to #/dashboard)
                 │                                           │
                 ├─► Advancing: Full Edit/Delete/Upload      ├─► Advancing: Read-Only Advance Sheet
                 │    (openEventModal + bulk delete)         │    (printAdvance + view riders)
                 │                                           │
                 ├─► Rota: Admin scheduling & swaps          ├─► Rota: Month view, availability, swaps
                 │                                           │
                 ├─► Inventory: Add / Edit / Delete / Move   ├─► Inventory: Move kit only
                 │                                           │
                 ├─► Procedures: Edit / Reorder / Delete     ├─► Procedures: View & Print guides
                 │                                           │
                 └─► Users: Management & Sign-offs           └─► Users: Read-Only Contact Directory
```

### Component & File Modifications

| Component / File | Purpose & Changes |
| :--- | :--- |
| **`js/config.js`** | Add route capability tags to `RMTP.nav` items so views know their minimum role requirement (`presets` and `venues` marked for Technical Managers / Admins). |
| **`js/auth.js`** | Add `isTechManagerOrAdmin(u)` helper and expand `auth.can()` capabilities (`events.edit`, `nav.view`, `inventory.manage`, `users.manage`). |
| **`js/app.js`** | Filter desktop sidebar and mobile drawer navigation dynamically based on `auth.can('nav.view', navId)`. Refresh navigation on user change or dev preview toggle. |
| **`js/router.js`** | Implement route guard: if user attempts to load `presets` or `venues` without management permissions, redirect to `#/dashboard` with a notification. |
| **`js/views/advancing.js`** | If user is a Duty Tech or Freelancer, intercept event card clicks to open the clean **Read-Only Advance Sheet Modal** with print support; hide bulk delete checkboxes, sync buttons, and file deletion controls. |
| **`js/views/inventory.js`** | Confirm add, edit, delete, and category configuration buttons remain hidden for non-managers, while the "Move kit" action and QR scanner remain fully enabled. |
| **`js/views/procedures.js`** | Ensure category delete, tab edit, procedure add, and reorder controls are strictly restricted to Technical Managers and Admins; ensure Print Guide button remains visible to all. |
| **`js/views/users.js`** | When accessed by Duty Techs or Freelancers, render a dedicated **Crew Contact Directory** layout featuring avatars, roles, clickable phone numbers (`tel:`), and email links (`mailto:`), omitting training management and access request approvals. |

---

## 5. Verification & Testing Strategy

1. **Dev Options Permutation Testing**:
   - Use the **Dev Options** menu (available to Technical Manager in top right / identity menu) to switch between:
     - `Technical Manager` (Full Access)
     - `Duty Tech` (Restricted)
     - `Freelancer` (Restricted)
   - Verify that switching to `Duty Tech` or `Freelancer` immediately updates sidebar and drawer navigation to only show the 7 permitted views.
2. **Route Guarding Verification**:
   - In `Duty Tech` or `Freelancer` mode, type `#/presets` or `#/venues` in the browser URL bar.
   - Verify redirection to `#/dashboard` with a clear toast notification.
3. **Event Advance Protection Testing**:
   - In Advancing, click any event card as a Duty Tech.
   - Verify the Read-Only Advance Sheet modal opens with complete production timings, set pieces, allocated kit, and technical attachments.
   - Verify that there are no inputs to edit technical specs, no delete buttons, and no file remove icons.
   - Click **Print PDF Advance** to verify clean print preview generation.
4. **Inventory Move Testing**:
   - Verify that kit can be moved between spaces using the "Move kit" action.
   - Verify that "+ Add Item" and "Delete" buttons do not appear.
5. **Users Contact Directory Testing**:
   - Open Users as a Duty Tech or Freelancer.
   - Verify the clean Crew Contact Directory displays each team member with working phone and email links.
   - Verify that training signoff checkboxes and pending request approvals are absent.
