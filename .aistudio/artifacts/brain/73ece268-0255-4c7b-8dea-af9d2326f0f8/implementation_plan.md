# Multi-Space Event Tabbed Editing

A seamless workflow for technical managers and technicians to navigate, edit, and coordinate multi-room events across spaces within a single edit session without losing state or backing out of the editor.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following product behaviors have been confirmed through user feedback and will govern the implementation:

- **Confirmed Decision 1 (Tab State Preservation)**: Form input state will be auto-preserved in memory when switching between space tabs. Technicians can freely move back and forth between rooms without losing in-progress edits or being prompted with modal blockers.
- **Confirmed Decision 2 (Cross-Space Field Sync)**: Universal event details—specifically Event Name, Date, and Artist/Client Contact—will automatically synchronize across all room tabs in the event group to maintain consistency.
- **Confirmed Decision 3 (Dual Save Strategy)**: The editing window will feature a primary **"Save All Spaces"** action alongside a secondary **"Save Current Space"** option, allowing technicians to either commit the entire multi-room run or lock in one room individually.

---

## 1. Overview & Core Concept

### What It Does
When an event spans multiple venue spaces (such as The Stage, The Studio, The Mix, or Cinema screens), technicians can currently view tabs for each room in the detail pop-up, but clicking "Edit" previously forced them into editing a single space in isolation. 

This enhancement embeds interactive **Space Tabs** directly into the event editor header. Technicians can click any space tab to switch the active editing context, adjust space-specific live set pieces, equipment bookings, lighting fixtures, and tech crew allocations, and save all spaces simultaneously without ever exiting the modal.

### Target Audience & Persona
- **Technical Managers & Senior Techs**: Setting up complex venue-wide takeovers and festivals across multiple rooms simultaneously.
- **Duty Technicians & Production Crew**: Quick-advancing schedules, rider updates, and channel patch changes across rooms during production shifts.

### Key Value
- **Zero Friction**: Eliminates 4 to 6 repetitive steps (save, close, scroll list, locate sibling room, open modal, click edit).
- **Reduced Human Error**: Guarantees date and title coherence across sibling room records while isolating room-specific technical riders.

---

## 2. User Experience & Visual Design

### Key User Flows

```
┌────────────────────────────────────────────────────────────────────────┐
│                        EVENT EDITING WINDOW                            │
├────────────────────────────────────────────────────────────────────────┤
│ Title: Summer Jazz Festival 2026                 [x] Close             │
│                                                                        │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │  [ The Stage ]*     [ The Studio ]       [ The Mix ]    [+ Add]    │ │ <-- Interactive Space Tabs
│ └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─ Shared Event Details (Synced Across Spaces) ─────────────────────┐ │
│  │ Name: [Summer Jazz Festival 2026]     Date: [2026-10-15]          │ │
│  │ Client: [Blue Note Records / Sarah]   Category: [Live Music]      │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─ Room-Specific Technical Advancing (Active: The Stage) ───────────┐ │
│  │ Times: In [14:00]  Soundcheck [17:00]  Doors [19:30]  Curfew [23] │ │
│  │ Assigned Crew: [Alex M. (Lead) ×]  [Jordan T. (Audio) ×]          │ │
│  │ Live Set Pieces & Channels: 3 Acts, 24-ch Midas Patch             │ │
│  │ Production Specials: Hazer [ON]  Heavy Power [ON]                 │ │
│  │ Equipment Bookings: 4x d&b M4, 2x Shure Axient                    │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│ [Delete Space]          [Cancel]   [Save Current Space]  [Save All Spaces]
└────────────────────────────────────────────────────────────────────────┘
```

1. **Opening Edit Window**:
   - From grouped cards, clicking "Edit" opens the modal with the first space tab active.
   - From the detail modal (`openEventModal`), clicking "Edit" opens the modal with the exact space tab that was currently active in the detail view.
   - For standalone events with multi-room arrays, space tabs are synthesized automatically.
2. **Switching Space Tabs**:
   - Clicking a sibling space tab (e.g. `The Studio`) immediately harvests the form inputs for `The Stage` into the in-memory cache.
   - The UI reconfigures seamlessly: updates space dropdown, switches live schedule vs. cinema DCP inputs depending on space type, repopulates room-specific equipment bookings, crew assignments, and lighting fixtures.
   - Shared fields (Name, Date, Client) carry over into the new tab automatically.
   - A subtle dot indicator (`*`) marks any space tab that has modified unsaved drafts.
3. **Saving**:
   - Clicking **"Save All Spaces"** writes all dirty space records to `RMTP.store` and syncs with Supabase, showing a success toast (`"Saved 3 spaces for Summer Jazz Festival 2026"`).
   - Clicking **"Save Current Space"** commits only the active room's draft, keeping the modal open with confirmation.

### Visual Styling & Theme
- **Tab Bar Design**: Uses the established dark panel aesthetic (`bg-panel2/80 border-b border-line`). Active tab features a clean contrast accent border (`border-b-2 border-accent text-accent font-semibold`) with subtle unboxed metadata counters.
- **Unsaved Dirty Indicator**: A clean 6px accent dot adjacent to the room title rather than obtrusive alert badges.
- **Typography & Proportions**: Monospace tabular numerals for timings and channel counts; full desktop width constraint (`max-w-4xl`) with smooth flex-wrap support for tablet/mobile.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: In-Memory Draft Store per Space (`draftsBySpace`)**
  - *Chosen Approach*: Keep uncommitted space forms in an in-memory dictionary indexed by room ID or space name.
  - *Why*: Fast client-side tab switching without touching persistent storage or generating partial ghost records before the user confirms.
  - *Alternatives Considered*: Direct continuous auto-saving to IndexedDB/Supabase on every tab switch was rejected because discarding or canceling would leave half-updated states.

- **Decision 2: Automatic Sibling Detection**
  - *Chosen Approach*: `openForm` automatically scans for sibling records sharing the same `groupId` or matching `(name, date)` in `store.all('advancing')`, even if opened from search or calendar view.
  - *Why*: Ensures multi-space events always present tabs regardless of how the user navigated into the editor.

- **Decision 3: Cinema vs. Live Space Context Switching**
  - *Chosen Approach*: Fully re-execute room workflow rendering (`updateSpaceWorkflow`) upon tab change so if Space 1 is a live theater and Space 2 is Screen One, the cinema DCP workflow, film duration, and projection checklists switch cleanly without DOM artifacts.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                        RMTP Advancing Module                           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
           ┌────────────────────────┴────────────────────────┐
           ▼                                                 ▼
   [renderGroupedCard]                              [openEventModal]
           │                                                 │
           └────────────────────────┬────────────────────────┘
                                    ▼
                             openForm(ev, group, activeIndex)
                                    │
    ┌───────────────────────────────┴───────────────────────────────┐
    ▼                                                               ▼
[detectEventSiblings]                                      [initDraftsBySpace]
Discovers sibling records                                  Populates memory cache
for same groupId / (name, date)                            for all linked rooms
    │                                                               │
    └───────────────────────────────┬───────────────────────────────┘
                                    ▼
                         [renderSpaceTabBar]
                         Interactive room tabs
                         with dirty state tracking
                                    │
         ┌──────────────────────────┴──────────────────────────┐
         ▼                                                     ▼
[switchSpaceTab(targetIdx)]                         [commitAllSpaces(drafts)]
- Scrape current form -> active draft               - Validate all drafts
- Sync shared fields (name, date, client)           - Upsert each room to store
- Hydrate form with target draft                    - Trigger Supabase sync
- Re-run updateSpaceWorkflow()                      - Toast & refresh router
```

### Data Model & State Mapping

1. **State Shape in `openForm`**:
   ```javascript
   const multiSpaceContext = {
     isMulti: true,
     groupId: '...',
     spaces: ['The Stage', 'The Studio', 'The Mix'],
     activeIndex: 0,
     drafts: [
       { id: 'evt-1', space: 'The Stage', name: '...', isDirty: false, ... },
       { id: 'evt-2', space: 'The Studio', name: '...', isDirty: false, ... }
     ]
   };
   ```
2. **Form Scraping & Hydration**:
   - `scrapeCurrentFormState()` extracts: timings, assigned crew, schedule items, channel lists, DMX fixtures, equipment bookings, production packages, notes, and attachments.
   - `hydrateFormState(draft)` populates all form inputs, resets custom dropdowns, and triggers workflow updates.
   - `syncSharedFields()` updates `name`, `date`, `clientContact`, and `status` across all drafts whenever changed.
3. **Save Handlers**:
   - `Save All Spaces`: Iterates over all drafts, assigns shared `groupId` and synced attributes, upserts each record into `advancing`, drains sync queue, closes modal, and refreshes the view.
   - `Save Current Space`: Upserts only the active draft, marks it clean (`isDirty = false`), and displays inline toast.

---

## 5. Verification Plan

1. **Multi-Space Tab Navigation**:
   - Open a multi-room event with 3 spaces.
   - Switch between Space 1, Space 2, Space 3. Verify each space displays its correct crew, timings, and technical riders.
2. **State Preservation**:
   - Edit notes and crew in Space 1. Switch to Space 2. Make an edit in Space 2.
   - Switch back to Space 1; verify all inputs remain intact.
3. **Shared Field Synchronization**:
   - Change event title in Space 1. Switch to Space 2; verify the title has automatically synced.
4. **Save All Spaces**:
   - Click "Save All Spaces"; verify all modified spaces update in the store and reflect on the calendar/dashboard.
5. **Single-Space Events**:
   - Open a regular single-space event; verify standard editing functions normally without unnecessary multi-space overhead.
6. **Codebase Lint & Compilation**:
   - Run Node syntax checks and applet verification tools.
