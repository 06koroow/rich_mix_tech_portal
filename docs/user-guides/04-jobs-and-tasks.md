# Page Guide 04 — Jobs & Tasks

**Portal Route**: `#/tasks`  
**Primary Users**: All Duty Technicians, Senior Techs, Technical Managers  
**Access Tier**: Operational (all staff)

---

## 1. Executive Summary & Purpose

The **Jobs & Tasks** module is Rich Mix's centralized operational task tracker. It bridges day-of-show handovers, ad-hoc booth and venue tasks, automated DCP follow-up actions, and maintenance work orders into a single prioritized task queue.

Tasks are linked to specific venue spaces, events, cinema screenings, or equipment items, allowing technicians to filter by what needs doing on their shift and mark completions with automatic timestamp and author logging.

---

## 2. Core Workflows (Step-by-Step)

### Workflow 2.1: Logging a New Duty Task
1. Navigate to **Jobs & Tasks** (`#/tasks`).
2. Click the **"New Task"** button at the top right.
3. In the Task Modal:
   - **Task Title**: Enter a concise description of the job (e.g. "Replace stage left monitor wedge lead", "Repatch DMX universe 2 to Stage floor").
   - **Space / Venue**: Select target space (*The Stage*, *Screen One*, *The Mix*, etc.).
   - **Category**: Select *General*, *Cinema*, *Sound*, *Lighting*, *AV*, or *Health & Safety*.
   - **Priority**: Select *Urgent*, *High*, *Medium*, or *Low*.
   - **Assigned Technician**: Assign to a specific team member or leave unassigned for the duty tech pool.
   - **Due Date & Time**: Set deadline if time-sensitive before doors.
4. Click **"Save Task"**.

### Workflow 2.2: Managing Automated DCP Pre-Screening Follow-Ups
- When a cinema technician evaluates a film in the Pre-Screening Tracker and checks **"Yes, further action required"**, a linked task is automatically created in Jobs & Tasks.
- The task is flagged with source `DCP Follow-up` and includes the film title, screen, and distributor/technician comments.
- Once the action is complete (e.g., replacement KDM ingested), open the task, set status to **Completed**, and enter notes. The linked screening in the Pre-Screening Tracker immediately reflects the completed status.

### Workflow 2.3: Completing & Signing Off a Task
1. In the task list, locate your assigned job.
2. Click the task card or row to open details.
3. Change status from `Pending` or `In Progress` to **Completed**.
4. The system logs:
   - Name of technician completing the job.
   - Exact completion timestamp.
5. Click **"Save"**. The task moves to the completed archive.

---

## 3. UI Component & Field Reference

### 3.1 Task Queue Filter Bar
- **Search**: Real-time filtering across titles, descriptions, and assigned technician names.
- **My Tasks Toggle**: Instantly filters the view to show only tasks assigned to the currently signed-in user.
- **Priority Filter**: *All*, *Urgent* (Red), *High* (Amber), *Medium* (Blue), *Low* (Slate).
- **Status Filter**: *Pending*, *In Progress*, *Completed*.
- **Category Filter**: *Sound*, *Lighting*, *Cinema*, *AV*, *Maintenance*, *General*.

### 3.2 Task Card Details
- **Badge Indicators**:
  - `Priority Pill`: Colored by urgency.
  - `Source Pill`: *Manual*, *DCP QC*, or *Maintenance Fault*.
  - `Space Pill`: Venue location.
- **Assigned Crew**: Displayed with avatar and technician title.
- **Quick Action Checkbox**: Completes the task with a single click.

---

## 4. Troubleshooting & FAQ

- **Q: Can I re-open a task that was marked completed by mistake?**  
  *A:* Yes. Set the filter to show `Completed` tasks, open the task, change status back to `In Progress` or `Pending`, and click Save.
- **Q: Who gets notified when an urgent task is created?**  
  *A:* Urgent tasks appear highlighted in red at the top of the Dashboard and show a live badge counter in the navigation sidebar for all active duty technicians.
