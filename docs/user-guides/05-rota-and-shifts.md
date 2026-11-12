# Page Guide 05 — Rota & Shifts

**Portal Route**: `#/rota`  
**Primary Users**: All Technical Staff, Freelancers, Technical Managers  
**Access Tier**: Universal View (Editing shifts reserved for Technical Managers and Admins)

---

## 1. Executive Summary & Purpose

The **Rota & Shifts** module coordinates all technical staffing across Rich Mix venues. It manages house staff duty schedules, freelance technician bookings, discipline roles (*Sound*, *Lighting*, *AV*, *Cinema*, *Duty Tech*), booking confirmation statuses (*Pencil* vs *Confirmed*), and technician availability.

Shifts synchronize bidirectionally with **Artifax**, ensuring that changes made to room bookings or staffing requirements in the central diary are immediately reflected on the technical schedule.

---

## 2. Core Workflows (Step-by-Step)

### Workflow 2.1: Viewing Your Upcoming Shifts (Technician Workflow)
1. Navigate to **Rota & Shifts** (`#/rota`).
2. The view displays the current week's schedule by default.
3. Use the **"My Shifts"** toggle button to filter the view exclusively to your shifts.
4. Each shift card displays:
   - Event name and assigned space.
   - Shift start and finish time.
   - Assigned role (e.g. `Lead Sound`, `Stage AV`, `Duty Cinema Tech`).
   - Confirmation status: `Confirmed` (solid border) vs `Pencil` (dashed border).
   - Rate and operational shift notes.

### Workflow 2.2: Booking a Technician on an Event (Manager Workflow)
1. Switch to the **Weekly Master View**.
2. Locate the event date and space.
3. Click **"Add Booking"** on the target event or date cell.
4. Select the **Technician** from the dropdown (filter by discipline).
5. Specify:
   - **Role**: Sound, Lighting, AV, Stage, Cinema, Duty Tech.
   - **Start & Finish Times**: Call time to wrap/de-rig.
   - **Status**: Set to `Pencil` (initial hold) or `Confirmed` (firm booking).
   - **Rate / Notes**: Agreed pay rate or specific instructions (e.g., "Prep monitor rig before band arrival").
6. Click **"Save Shift"**. An email notification or calendar sync is logged.

### Workflow 2.3: Logging Availability & Unavailability
1. In the Rota view, click **"My Availability"**.
2. Select target dates on the calendar.
3. Mark dates as **Available** (Green) or **Unavailable** (Red).
4. Add optional notes (e.g. "Available from 17:00 onwards", "Touring with band").
5. Technical Managers will see availability markers when assigning staff to shifts.

---

## 3. UI Component & Field Reference

### 3.1 View Switcher & Filters
- **Calendar Navigation**: `< Previous Week` | `Today` | `Next Week >`.
- **View Modes**:
  - `Day View`: Hour-by-hour breakdown across all spaces.
  - `Week View`: 7-day venue-wide matrix.
  - `Month View`: High-level event and coverage heatmap.
- **Discipline Filter**: Filter by *Sound*, *Lighting*, *AV*, *Cinema*, *Duty Manager*.
- **"Sync Shifts" Button**: Pulls latest shift updates directly from Artifax.

### 3.2 Shift Card Indicators
- **Green Pill (`Confirmed`)**: Finalized booking confirmed with technician.
- **Amber Pill (`Pencil`)**: Provisional booking holding technician's availability.
- **Red Stripe (`Cancelled`)**: Cancelled shift with recorded cancellation reason.
- **Blue Pill (`Takeover`)**: Shift handed over or swapped between technicians.

---

## 4. Troubleshooting & FAQ

- **Q: Can freelancers see other technicians' shift rates?**  
  *A:* No. Freelancers only see their own shifts and personal pay rates. Venue-wide staff rates are strictly restricted to Technical Managers and Administrators.
- **Q: What happens if an event's times change in Advancing?**  
  *A:* The system flags the shift with a time-mismatch indicator so the Technical Manager can approve updated technician call times.
