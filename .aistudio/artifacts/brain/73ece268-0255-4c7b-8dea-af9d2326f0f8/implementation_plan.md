# Implementation Plan: Multi-Room Takeovers, Space Basic Crew & Responsive Density

Enhance the Rich Mix Tech Portal with automated multi-room takeover consolidation, basic crew capacity calculations per venue space, and dynamic responsive density scaling for both light and event-heavy weeks.

---

## 1. User Choices & Clarifications Confirmed
* **Multi-Room Takeover Display**: Single consolidated card on the Master Rota Board showing all booked spaces, assigned crew count, and unfilled crew gaps.
* **Basic Crew Calculation**: Sum the "Basic Crew" requirement across all spaces booked for that event, comparing total assigned technicians against total crew required.
* **Heavy Week Compression**: Dynamic density scaling that automatically condenses row heights, card padding, and badges when viewing busy days, keeping all information glanceable without clipping.

---

## 2. Database Schema Changes & Required SQL / TS

### A. SQL Migration Snippet (Supabase PostgreSQL)
Run the following idempotent SQL statements in the **Supabase SQL Editor**:

```sql
-- ============================================================
-- 1. Venues Table: Add Basic Crew requirement column
-- ============================================================
alter table public.venues 
add column if not exists "basicCrew" integer default 1;

-- Seed default basic crew sizing for standard Rich Mix spaces
update public.venues set "basicCrew" = 2 where name in ('The Stage', 'The Studio') and ("basicCrew" is null or "basicCrew" = 1);
update public.venues set "basicCrew" = 1 where name in ('The Mix', 'Screen One', 'Screen Two', 'Screen Three', 'Streetside', 'Foyer') and "basicCrew" is null;

-- ============================================================
-- 2. Advancing Table: Support multi-space arrays and takeover flags
-- ============================================================
alter table public.advancing 
add column if not exists "spaces" jsonb default '[]'::jsonb;

-- Ensure groupId index exists for rapid grouping of multi-room arrangements
create index if not exists idx_advancing_group_id on public.advancing ("groupId") where "groupId" is not null;

-- ============================================================
-- 3. Bookings Table: Support multi-room takeover space linkage
-- ============================================================
alter table public.bookings 
add column if not exists "isTakeover" boolean default false;
```

### B. TypeScript Interfaces & Data Models

#### 1. Venue Model (`src/types/venue.ts` / `venues.js`)
```typescript
export interface VenueSpec {
  id: string;
  name: string;
  capacity: string;
  stageDimensions: string;
  inventory: string;
  basicCrew: number; // Target crew count per shift in this space
  audio: {
    inputChannels: number;
    localInputChannels: number;
    outputChannels: number;
    localOutputChannels: number;
    prefix: string;
    mixingDeskInvId?: string;
    mixingDeskProtocol?: string;
    stageboxes: Array<{
      letter: string;
      name: string;
      location: string;
      sockets?: number;
      analogIn?: number;
      analogOut?: number;
      digitalIn?: number;
      digitalOut?: number;
      invId?: string;
      connectionProtocol?: string;
    }>;
  };
  dmx: Array<{
    idNum: number;
    makeModel: string;
    mode: string;
    channels: number;
    universe: number;
    address: number;
    location: string;
  }>;
  createdAt?: string;
}
```

#### 2. Multi-Room Takeover Schedule Model (`js/views/rota.js`)
```typescript
export interface MultiRoomTakeoverItem {
  key: string;              // 'takeover_' + (groupId || eventId)
  type: 'takeover';
  eventId: string;
  groupId?: string;
  eventName: string;
  date: string;
  startTime: string;
  finishTime: string;
  spaces: string[];         // e.g. ['The Stage', 'The Studio', 'The Mix']
  totalCrewNeeded: number;  // Sum of basicCrew for each space in spaces
  totalCrewAssigned: number;// Count of unique booked technicians
  spaceBreakdown: Array<{
    space: string;
    basicCrew: number;
    assignedCrew: number;
    technicians: Array<{
      id: string;
      name: string;
      role: string;
      status: 'confirmed' | 'pencil' | 'declined';
    }>;
    isFilled: boolean;
  }>;
  isFullyStaffed: boolean;
  unfilledSpaces: string[];
}
```

#### 3. Edge Function Sync Alignment (`supabase/functions/artifax-sync/index.ts`)
* When Artifax returns events with matching `groupId` and `date`, they are recognized as rooms of the same overall arrangement.
* Clean sanitization ensures `"basicCrew"` and `"spaces"` are persisted safely without PostgREST parameter rejections.

---

## 3. Architecture & Feature Specifications

### A. Spaces Setup & Basic Crew Requirement (`js/views/venues.js`)
* **Default Sizing**:
  * *The Stage*: 2 crew members (e.g. Lead Sound + Stage AV/Lighting)
  * *The Studio*: 2 crew members
  * *The Mix*: 1 crew member
  * *Screen One / Two / Three*: 1 crew member
  * *Streetside / Foyer*: 1 crew member
* **Configuration Form**:
  * Add a dedicated **"Basic Crew Required"** numeric field in `venues.js` under *Overview & Specs* alongside Capacity and Stage Dimensions.
  * When saving, `saveVenueData()` updates `store.upsert('venues', m.venueData)` and syncs to Supabase.

### B. Multi-Room Takeover Card Consolidation (`js/views/rota.js`)
* **Consolidation Logic**:
  * In `getDaySchedule(dateStr)`, inspect events sharing a common `groupId` or events with multiple spaces defined in `ev.spaces` or `ev.space`.
  * Collapse all matching spaces into a single **Multi-Space Takeover Card** instead of creating redundant individual cards in the same day column.
* **Takeover Card Design**:
  * **Header**: Event Title, Time window, and a consolidated multi-space tag showing all rooms (e.g., `3 Spaces: Stage · Studio · Mix`).
  * **Crew Fulfillment Status**:
    * Compute total required crew: $\sum (\text{Basic Crew for each booked space})$.
    * Compare with count of assigned technicians/freelancers across those spaces.
    * Display clear indicator: e.g., `✓ 4/4 Crew Assigned` (green) or `⚠️ 2/4 Crew · 2 Gaps (Studio, Mix)` (amber/rose).
  * **Space & Tech List**: Condensed inline tags indicating assigned technicians per room, with a 1-click **"+ Assign Crew"** button targeting unassigned rooms.
  * **Click Routing**: Clicking the card opens the shift inspector with multi-room context or lets managers assign technicians to specific rooms.

### C. Slick Responsive Design & Dynamic Density Scaling
* **Dynamic Density Detection**:
  * On days with $> 3$ events/shifts, automatically enable micro-compact card scaling so the day column remains sleek, legible, and unclipped.
  * On light days ($\le 3$ events), cards retain comfortable spacing with rich metadata.
* **Responsive Layout Rules**:
  * Mobile ($\le 768\text{px}$): Horizontal swipeable day selector, full-width takeover cards, clean unboxed typographic metadata.
  * Desktop ($1024\text{px}$–$1440\text{px}+$): 7-day grid where multi-room takeovers stand out distinctly with clear space badges and zero horizontal scroll clipping.
  * Day View (Room Swimlanes): Displays the event in each participating room swimlane with a subtle "Part of Multi-Room Takeover" link badge.

---

## 4. Implementation Steps

1. **Database & Schema Updates**:
   * Add SQL migration to `docs/supabase-setup.sql` and `docs/venues-setup.sql`.
   * Update `js/sync-supabase.js` to ensure `"basicCrew"` is synced to/from Supabase.
2. **Venues Configuration (`js/views/venues.js`)**:
   * Add the Basic Crew input field in `venues.js` under Overview & Specs.
   * Provide sensible fallback defaults (`2` for Stage/Studio, `1` for Screens/Mix).
3. **Multi-Room Grouping Engine (`js/views/rota.js`)**:
   * Enhance `getDaySchedule(dateStr)` to aggregate multi-space advancing events and linked shifts into a single consolidated takeover item.
   * Helper `getSpaceBasicCrew(spaceName)` reads from venue specifications.
4. **Card Renderer Enhancements (`renderCardHtml` in `js/views/rota.js`)**:
   * Create dedicated multi-room takeover card markup with crew progress badge, room breakdown, and quick assignment triggers.
   * Implement dynamic density classes for high-density vs light-density days.
5. **Verification & Testing**:
   * Test editing Basic Crew in Venues view and verify persistence.
   * Verify single and multi-room events render properly on the Master Rota Board in light and heavy days.
   * Run compilation and linting to ensure zero build errors.
