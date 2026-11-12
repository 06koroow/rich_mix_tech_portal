# Page Guide 09 — Inventory & Equipment Tracking

**Portal Route**: `#/inventory`  
**Primary Users**: All Technicians, Senior Techs, Technical Managers  
**Access Tier**: Operational (all staff can view and update locations; kit creation/deletions managed by Senior Tech / TM)

---

## 1. Executive Summary & Purpose

The **Inventory** module is Rich Mix's master asset register for all sound, lighting, projection, backline, staging, and rigging equipment.

It provides real-time kit tracking across performance spaces and storage rooms, unique asset reference numbers, QR barcode scanning for instant mobile lookup, displacement tracking (monitoring gear temporarily borrowed from one room to another), and complete movement audit histories.

---

## 2. Core Workflows (Step-by-Step)

### Workflow 2.1: Checking Out Kit / Displacing to Another Space
- Example: 2x RCF NX10-SMA stage monitors are borrowed from *The Stage* to *The Mix* for an evening show.
1. Navigate to **Inventory** (`#/inventory`).
2. Search for the item or scan the QR code using your phone or tablet camera.
3. Click the item row to open the **Movement & Location Modal**.
4. Select the **New Location**: *The Mix*.
5. Select **Reason**: *Event Displacement* (or *Temporary Borrow*).
6. Enter quantity (e.g. `2`).
7. Enter **Held By**: Your name.
8. Click **"Confirm Movement"**.
   - The portal flags the item as **Displaced** with a yellow badge.
   - The movements audit log records the technician name, origin room, destination room, and timestamp.

### Workflow 2.2: Returning Displaced Kit to Home Location
1. In the Inventory view, click the filter **"Show Displaced Kit Only"**.
2. Locate the borrowed equipment.
3. Click **"Return to Home Location"**.
4. The system automatically sets the location back to its permanent home (e.g. *The Stage*) and clears the displacement warning.

### Workflow 2.3: Scanning QR Codes on Venue Hardware
1. Click the **"Scan QR Code"** button in the top search bar.
2. Allow camera access.
3. Point your device at the QR sticker on the equipment flightcase or chassis (format: `RMTP-INV:<tag>`).
4. The portal instantly pulls up the asset card, condition status, active faults, and location history.

---

## 3. UI Component & Field Reference

### 3.1 Inventory Table Columns
- **Asset Ref & Tag**: Unique asset reference (e.g. `STG-001`, `MIX-004`).
- **Item Name & Model**: Manufacturer and model description.
- **Category**:
  - `Sound — PA/Speakers`, `Sound — Console/Stageboxes`, `Sound — Microphones`, `Sound — DI/Stands`
  - `Lighting — Fixtures`, `Lighting — Control`, `Lighting — Rigging/Other`
  - `AV — Projection/Screens`, `Network — Projection/Screens`
  - `Backline`, `DJ Equipment`, `Staging/Flooring`, `Power`
- **Location**: Current physical location (*The Stage*, *Store*, *Workshop*, etc.).
- **Qty**: Total quantity and available in-stock count.
- **Condition**: `Excellent` (Green), `Good` (Blue), `Fair` (Amber), `Poor` (Orange), `Faulty` (Red).
- **Status**: `In` (Available in room), `Displaced` (Borrowed elsewhere), `Out` (External hire/service).

### 3.2 Inventory Filters
- **Search Bar**: Instant text filter matching names, models, serial numbers, tags, and QR barcodes.
- **Location Dropdown**: Filter to see all gear currently inside a specific venue space.
- **Category Filter**: Filter by technical discipline.
- **Condition Filter**: Filter by health rating.

---

## 4. Troubleshooting & FAQ

- **Q: What should I do if an inventory item is missing or lost?**  
  *A:* Open the item card, change status to `Missing / Lost`, enter handover notes detailing when it was last seen, and notify the Technical Manager.
- **Q: Can we print QR code asset label sheets?**  
  *A:* Yes. Click **"Export Asset Tags & QR Codes"** to generate printable PDF sticker sheets formatted for standard label printers.
