# Page Guide 01 — Dashboard

**Portal Route**: `#/dashboard`  
**Primary Users**: All Staff (Technical Managers, Senior Techs, Duty Techs, Freelancers)  
**Access Tier**: Universal (read/write based on assigned permissions)

---

## 1. Executive Summary & Purpose

The **Dashboard** is the operational nerve center of the Rich Mix Technical Portal. Designed for duty handovers, real-time venue status checks, and day-of-show awareness, it aggregates live data from all connected systems (Advancing, Cinema Screenings, Tasks, Inventory, and Maintenance) into a single actionable overview.

When starting a shift or conducting a technical handover, the Dashboard gives technicians an immediate summary of today's events, open maintenance issues in performance spaces, assigned tasks, and quick shortcuts for logging faults or checking kit.

---

## 2. Core Workflows (Step-by-Step)

### Workflow 2.1: Conducting a Morning Shift Handover
1. **Log in** to the portal and navigate to the **Dashboard** (`#/dashboard`).
2. **Review "Today at a Glance"**:
   - Check the banner at the top for today's active spaces (The Stage, The Studio, The Mix, Screen 1/2/3).
   - Verify start and finish times for upcoming load-ins, soundchecks, and doors.
3. **Inspect Active Maintenance Alerts**:
   - Check the **Active Faults & Maintenance** panel.
   - Note any critical faults tagged to spaces hosting events today (e.g. Screen One amplifier issue or Studio projector lamp hours).
4. **Review My Open Tasks**:
   - Scan the **My Assigned Tasks** widget.
   - Identify urgent pre-show actions (e.g., "Run mic cable check", "Prepare holding slides").
5. **Acknowledge or File Shift Handover Notes**:
   - Read the latest notes in the **Duty Log / Handover** widget.
   - If taking over, add your handover confirmation or any overnight observations.

### Workflow 2.2: Fast Action Event Routing
1. Click any event card in the **Today's Schedule** section.
2. The portal directly navigates to the detailed **Advancing View** for that specific event, highlighting sound, lighting, live schedules, and crew assignments.

---

## 3. UI Component & Field Reference

### 3.1 Header & System Status Bar
- **Venue Clock**: Displays current local UK time (GMT/BST) synchronized with the venue network.
- **Connection Indicator**: Indicates whether the portal is actively connected to the Supabase real-time backend (`Online / Synced` in green; `Reconnecting` in amber).
- **Artifax Polling Badge**: Displays time elapsed since the last Artifax schedule sync (e.g., `Synced 4m ago`).
- **Quick Help Button `(?)`**: Opens the in-app User Guides modal for instant reference.

### 3.2 Today's Performance & Event Schedule
- **Event Card**:
  - **Event Name & Category**: Displays the booking title and colored pill (`Cinema`, `Programme`, `Private Hires`).
  - **Space / Room**: Specific Rich Mix space (`The Stage`, `Screen One`, etc.).
  - **Key Timing Markers**: Doors, Soundcheck, Screening Start, and Curfew times.
  - **Assigned Technicians**: Avatars and names of booked crew.
  - **Advance Status**: `Draft`, `Advancing`, `Confirmed`, or `Complete`.

### 3.3 Cinema Pre-Screening Quick Widget
- **Summary Pill**: Displays number of screenings scheduled for today and tomorrow.
- **QC Status Counts**:
  - `Passed` (Green): Tested and ready for playback.
  - `Caveats` (Amber): Approved with special booth operator notes.
  - `Failed` (Red): Replacement media required before showtime.
  - `Pending` (Grey): Not yet checked in the booth.
- **Link**: Clicking **"View Pre-Screening Tracker &rarr;"** opens the Cinema QC console.

### 3.4 Open Jobs & Maintenance Quick Panel
- **Critical / High Priority Faults**: Lists faults tagged `Urgent` or `High` that affect today's booked spaces.
- **"Log New Fault" Button**: Directly opens the fault reporting modal from the dashboard.
- **"Add Task" Button**: Creates a new quick job in the Jobs & Tasks list.

### 3.5 Quick Launch Shortcuts
- **DCP Test Console**: Jumps directly to Pre-Screening Tracker.
- **Audio Patching**: Opens Patch Sheet generator for today's live bands.
- **Emergency / SOPs**: Jumps to Opening/Closing checklists and fire evacuation protocols.

---

## 4. Troubleshooting & FAQ

- **Q: An event showing in Artifax is missing from the Dashboard today.**  
  *A:* Click the **Sync with Artifax** button in the Advancing or Rota page. If the event was created in Artifax within the last 5 minutes, force-polling will pull it down immediately.
- **Q: A completed task is still showing on my dashboard.**  
  *A:* Click the checkbox next to the task item or open the task and change the status from `In Progress` to `Completed`. The widget updates instantly.
