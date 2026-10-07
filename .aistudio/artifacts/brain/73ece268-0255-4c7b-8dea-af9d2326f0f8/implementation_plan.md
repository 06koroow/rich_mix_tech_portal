# Freelancer Availability, Booking & Rota Management System

A unified scheduling and booking system for Rich Mix, enabling technicians and freelancers to log their availability across day-part blocks or custom hours, and empowering technical managers to rota, pencil, confirm, and manage venue shifts directly within Advancing and a dedicated master Rota board.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions were synthesized and aligned based on your Phase 1 requirements:
> - **Availability Granularity**: Techs can quickly set Day-Part blocks (Morning, Afternoon, Evening, All Day) by default, with an expandable "From/Till" custom timing option for granular hourly availability.
> - **Booking Workflows**: Fully integrated in both the Advancing event shift assignment modal (with inline availability checks) and a dedicated interactive **Rota & Scheduling Board** with day/week/month views.
> - **Booking Status Lifecycle**: Four persistent states across all assignments: `Pencil` (provisional hold), `Confirmed` (firm booking), `Declined` (technician unavailable/rejected), and `Cancelled` (venue-side cancellation with audit note).
> - **Backend Persistence**: Full local cache integration in `RMTP.store` with automatic optimistic synchronization via `RMTP.syncSb` across `availability` and `bookings` collections.

---

## 1. Overview & Core Concept

### What It Does
1. **Technician Availability Submission Portal ("My Availability & Shifts")**:
   - Technicians and freelancers can select any date or multi-date range and mark their status: Available (All Day, Morning, Afternoon, Evening, or custom From/Till hours) or Unavailable.
   - Provides quick multi-day batch selection (e.g., "Available all Fridays & Saturdays next month").
   - Lets freelancers view their upcoming penciled and confirmed venue shifts in one personal timeline.
2. **Integrated Advancing Shift Booking**:
   - When managers add or edit technicians on an event shift in `advancing.js`, the technician picker dynamically displays live availability indicators (e.g. `Available · Full Day`, `Available · 17:00-23:30`, `Unavailable`, `Already Booked on Screen One`).
   - Managers can pencil or confirm the shift immediately upon assignment.
3. **Master Rota & Scheduling Board (`#/rota`)**:
   - A dedicated venue-wide visual rota matrix displaying dates, spaces, and assigned technicians.
   - Shows unfilled shift gaps, pending pencils, and confirmed bookings across all rooms (The Stage, The Studio, The Mix, Cinema screens).
   - Quick status transitions with 1-click status pills (`Pencil` → `Confirmed`, `Cancel`, `Reassign`).
   - Filterable by space, role (Sound, Lighting, Cinema, AV, Support), technician position, and booking status.

### Target Audience & Personas
- **Technical Manager & Senior Techs**: Need a single birds-eye dashboard to identify roster gaps, view which freelancers are free on show nights, pencil technicians, and lock in rotas without cross-referencing external spreadsheets or messages.
- **Duty Technicians & Freelancers**: Need a frictionless, mobile-friendly interface to log their upcoming availability in seconds and check when they are penciled or confirmed for work.

### Key Value
Eliminates double-booking, manual email back-and-forths, and fragmented spreadsheets by bringing the entire technician procurement lifecycle into the Rich Mix Tech Portal with backend persistence.

---

## 2. User Experience & Visual Design

### Key User Flows

#### Flow 1: Freelancer Logs Availability
1. Technician navigates to **"My Availability"** (accessible via sidebar nav or their profile card on Dashboard).
2. A responsive calendar grid highlights upcoming weeks.
3. The technician clicks a day (or drags across a date range) and selects:
   - **Quick Day-Part**: `All Day` (08:00 - 23:30), `Morning` (08:00 - 13:00), `Afternoon` (13:00 - 18:00), `Evening` (18:00 - 23:30).
   - **Custom From/Till**: Toggle switch opens clean time inputs (e.g., `From: 16:30` `Till: 23:00`).
   - **Optional Note**: e.g., "Available for sound or lighting".
4. Submits with 1 click; saved instantly to `RMTP.store` and synced to backend.

```
┌────────────────────────────────────────────────────────────────────────┐
│  My Availability & Roster                                  [+ Add Bulk]│
├────────────────────────────────────────────────────────────────────────┤
│  Mon 12 Oct       Tue 13 Oct       Wed 14 Oct       Thu 15 Oct         │
│  [Available]      [Available]      [Unavailable]    [Custom]           │
│  Full Day         Evening (18:00+) Personal         16:30 - 23:30      │
│  ────────────────────────────────────────────────────────────────────  │
│  Shifts:          Shifts:          Shifts:          Shifts:            │
│  The Stage (17:00) None            None             The Mix (18:00)    │
│  Confirmed        -                -                Pencil             │
└────────────────────────────────────────────────────────────────────────┘
```

#### Flow 2: Manager Books Shifts in Advancing
1. Manager opens an event edit modal in Advancing.
2. In the "Assigned Crew & Freelancers" section, clicking **"+ Add Technician"** opens the crew selector.
3. Next to each candidate's name, the interface shows their live availability on this show's date and times:
   - `Alex Morgan · Duty Tech · Available (All Day)`
   - `Danny Cole · Freelancer · Available (Evening 18:00+)`
   - `Sam Okafor · Duty Tech · Unavailable`
4. The manager selects a candidate and chooses their booking status:
   - **Pencil** (Provisional hold) or **Confirmed**.
5. Saving the event creates or updates the persistent shift booking record.

#### Flow 3: Master Rota Board (`#/rota`)
1. Manager clicks **Rota** in the main navigation.
2. The view defaults to the current week with day columns and venue space swimlanes.
3. Every card clearly reflects:
   - Event Title & Venue Space
   - Shift Role (e.g., Sound Lead, Cinema Tech)
   - Technician Name & Contact
   - Status Badge: `Pencil` (Amber dashed border), `Confirmed` (Emerald solid border), `Declined` (Rose border), `Cancelled` (Muted line-through).
4. Direct actions on each card:
   - Quick button to switch `Pencil` to `Confirmed`.
   - Reassign / Replace with another available freelancer.
   - Cancel shift (prompts for cancellation note, only venue managers can perform).

### Visual Identity & Theme
- **Aesthetic Direction**: High-density, utilitarian broadcast & venue production tool adhering to Rich Mix Tech Portal's dark industrial aesthetic.
- **Color Discipline (60-30-10)**:
  - 60% neutral canvas (`bg-[#0e1217]` dark slate background).
  - 30% structural surfaces (`bg-[#161b22]` cards, 1px subtle hairline borders `border-white/10`).
  - 10% high-intent semantic accents:
    - `Confirmed`: Emerald (`text-emerald-400 bg-emerald-500/10 border-emerald-500/20`)
    - `Pencil`: Amber (`text-amber-400 bg-amber-500/10 border-amber-500/30 border-dashed`)
    - `Declined`: Crimson (`text-rose-400 bg-rose-500/10 border-rose-500/20`)
    - `Cancelled`: Muted slate (`text-muted border-line line-through opacity-70`)
- **Zero-Pill Discipline**:
  - Metadata rendered as unboxed typography (`The Stage · Sound · 17:00 - 23:00`).
  - Status indicators use clean border highlights and status dots with explicit accompanying text labels, never neon pill bubbles.
- **Tabular Figures**:
  - All shift hours, times, and day counts use `font-mono tabular-nums`.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Dedicated Rota Board + Integrated Advancing
- **Chosen Approach**: Build a new top-level view `#/rota` for birds-eye multi-space scheduling AND enrich Advancing's existing technician assignment roster.
- **Why**: Advancing is where show details and tech specs are advanced; the Rota board is where weekly staffing budgets and team balance are evaluated. Having both means managers never have to navigate away to verify coverage.
- **Alternative Considered**: Building only an isolated Rota page without linking Advancing crew fields. Rejected because it would cause data drift between show advances and rota bookings.

### Decision 2: Day-Part Blocks with Optional From/Till
- **Chosen Approach**: Preset day-parts (Morning, Afternoon, Evening, All Day) for 1-click entry, with an accordion toggle for exact From/Till hours.
- **Why**: 80% of venue shifts align with standard venue periods (Get-in/Soundcheck vs Show/Late), but special matinees or festivals require precise hours. This provides rapid entry without sacrificing flexibility.

### Decision 3: Venue-Only Cancellation Authority
- **Chosen Approach**: Only venue managers (Technical Manager, Senior Tech, Admins) can mark a shift as `Cancelled`. Freelancers can accept or decline offers (`Declined`), but cancellation of booked slots is controlled by the venue.
- **Why**: Prevents freelancers from silently erasing booked shifts while allowing clear tracking of cancelled sessions with cancellation reasons.

---

## 4. Technical Architecture & Data Strategy

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             Rich Mix UI                                 │
├───────────────────────────────┬──────────────────────────────────────────┤
│        Technician View        │             Manager View                 │
│   • My Availability Calendar  │   • Master Rota Board (`#/rota`)         │
│   • Day-Part & From/Till Form │   • Advancing Shift Assignment Roster    │
│   • My Penciled/Confirmed Log │   • Crew Availability Checker & Booking  │
└───────────────┬───────────────┴────────────────────┬─────────────────────┘
                │                                    │
                ▼                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                   RMTP Shared Store & State Layer                        │
│   • `store.all('availability')`   — Tech free/busy slots & day parts     │
│   • `store.all('bookings')`       — Event shift bookings & status        │
│   • `store.all('advancing')`      — Core show dates, spaces & requirements│
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                 Persistence & Backend Sync Layer                         │
│   • LocalStorage Cache (Immediate offline-first read/write)             │
│   • `RMTP.syncSb` (Optimistic sync to Supabase `availability`/`bookings`)│
└──────────────────────────────────────────────────────────────────────────┘
```

### Data Models & Schemas

#### 1. `availability` Collection
```typescript
interface AvailabilityRecord {
  id: string;                    // 'avail-xxx'
  userId: string;                // user id (e.g., 'user-3')
  userName: string;              // Cached display name
  date: string;                  // 'YYYY-MM-DD'
  type: 'available' | 'unavailable';
  dayPart: 'all_day' | 'morning' | 'afternoon' | 'evening' | 'custom';
  startTime?: string;            // '16:30' (if custom or day-part bounds)
  finishTime?: string;           // '23:30'
  notes?: string;                // Optional technician note
  updatedAt: string;             // ISO timestamp
}
```

#### 2. `bookings` Collection
```typescript
interface ShiftBookingRecord {
  id: string;                    // 'book-xxx'
  eventId: string;               // linked advancing event id
  eventName: string;             // Cached event title
  space: string;                 // e.g. 'The Stage'
  date: string;                  // 'YYYY-MM-DD'
  startTime: string;             // '17:00'
  finishTime: string;            // '23:30'
  userId: string;                // assigned user id
  userName: string;              // technician name
  role: string;                  // 'Sound' | 'Lighting' | 'Cinema' | 'AV' | 'Support'
  status: 'pencil' | 'confirmed' | 'declined' | 'cancelled';
  penciledAt?: string;           // ISO timestamp
  confirmedAt?: string;          // ISO timestamp
  cancelledAt?: string;          // ISO timestamp
  cancellationReason?: string;   // Venue manager audit note
  notes?: string;                // Shift instructions
  rate?: string;                 // Optional agreed freelancer shift rate
}
```

### Navigation & Views Plan
1. **New Top-Level Navigation Item**:
   - `Rota & Shifts` (id: `rota`, icon: `calendar` or `users`) in `RMTP.nav` inside `js/config.js`.
2. **New View Module**:
   - `js/views/rota.js`: Implements the Master Rota Scheduling Board, weekly grid view, shift status toggles, and modal for creating/editing shift bookings.
3. **Availability Tab / Modal**:
   - Integrated tab in `#/rota` for **"My Availability"** (or accessible from the profile/dashboard), allowing technicians to enter their free/busy calendar.
4. **Advancing View Integration (`js/views/advancing.js`)**:
   - Enhances the existing technician selector with live availability tooltips/badges and booking status dropdown (`Pencil` vs `Confirmed`).
5. **Sync & Backend Support (`js/sync-supabase.js`)**:
   - Register `availability` and `bookings` in `COLLS` for seamless multi-device persistence.
6. **Starter Seed Data (`data/seed.js`)**:
   - Realistic availability records and sample bookings for the demo dataset to ensure zero-state polish.

---

## Next Steps

Once this implementation plan is approved:
1. Register `rota` in `RMTP.nav` (`js/config.js`) and wire backend sync in `js/sync-supabase.js`.
2. Implement `js/views/rota.js` containing both the Manager Master Rota and the Technician Availability Submission interface.
3. Connect the availability lookup engine to `js/views/advancing.js` shift assignments.
4. Add seed availability and bookings in `data/seed.js`.
5. Verify build, styling, and cross-view synchronization.
