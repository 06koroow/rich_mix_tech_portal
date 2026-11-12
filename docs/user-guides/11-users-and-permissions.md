# Page Guide 11 — Users & Role-Based Permissions

**Portal Route**: `#/users`  
**Primary Users**: Technical Managers, System Administrators  
**Access Tier**: Restricted (Technical Managers and Admins only)

---

## 1. Executive Summary & Purpose

The **Users & Permissions** module manages user accounts, staff profiles, technical disciplines, and Role-Based Access Control (RBAC) across the Rich Mix Technical Portal.

It defines who can access restricted venue modules (such as the Cinema QC Console, Venues & Spaces, or Patch Presets), who can sign off technician safety qualifications, and how duty rotas map to house staff and freelancers.

---

## 2. Staff Roles & Permission Hierarchy

The portal implements 5 standardized technical roles:

| Role Title | Access Scope | Specific Privileges |
|---|---|---|
| **Technical Manager** | Full Administrative | Full read/write access to all 11 modules. Can override DCP QC outcomes, configure venue profiles, create DMX profiles, manage staff pay rates, publish rotas, and edit user accounts. |
| **Administrator** | Full Administrative | System-level permissions, database schema migrations, and user administration. |
| **Senior Technician** | Advanced Operational | Full operational access to Advancing, Pre-Screenings, Tasks, Maintenance, Inventory, Procedures, and Rota. Can sign off trainees if granted Trainer status. |
| **Duty Technician** | Standard Operational | Daily operations: Advancing specs, DCP pre-screening tests, task completion, maintenance fault reporting, kit movement check-in/out, and procedure viewing. |
| **Freelancer** | Limited Operational | Restricted access to personal rota/shifts, assigned event technical sheets, and safety procedures. Blocked from DCP Pre-Screening Tracker, Patch/Presets, Venues, and User administration. |

---

## 3. Core Workflows (Step-by-Step)

### Workflow 3.1: Creating a New Staff or Freelancer Account
1. Navigate to **Users & Permissions** (`#/users`).
2. Click **"New User"**.
3. **Basic Information**:
   - `First Name` & `Last Name`.
   - `Email Address`: Used for portal login and report dispatch.
   - `Position / Job Title`: Technical Manager, Senior Tech, Duty Tech, Freelancer, Apprentice.
4. **Discipline & Skills**:
   - Select primary discipline: *Sound*, *Lighting*, *AV*, *Cinema*, *Stage / Rigging*.
5. **System Privileges**:
   - Check **"Admin"** if user requires full management access.
   - Check **"Trainer Qualification"** if user has authority to certify competency sign-offs in the Procedures module.
6. **Account Status**:
   - Set to `Active`.
7. Click **"Save User"**.

### Workflow 3.2: Deactivating a Former Staff Member or Inactive Freelancer
1. Locate the user in the user table.
2. Click **"Edit"**.
3. Change `Status` from `Active` to `Inactive`.
4. Click **"Save"**.
   - The user is immediately blocked from logging in.
   - Historical records (e.g. past DCP tests, maintenance work orders, shift logs) preserve their name for audit continuity.

---

## 4. UI Component & Field Reference

### 4.1 User Directory Table
- **Name & Avatar**: Full name with colored initials avatar.
- **Position**: Job title badge.
- **Discipline**: Technical specialty pill (Sound = Blue, Lighting = Amber, Cinema = Purple, AV = Green).
- **Trainer Badge**: Star icon indicating certified trainer rights.
- **Admin Badge**: Key icon indicating administrative credentials.
- **Status**: `Active` (Green) or `Inactive` (Slate).

---

## 5. Troubleshooting & FAQ

- **Q: Why is a newly registered user unable to see the DCP Tracker?**  
  *A:* Check the user's `Position`. If set to `Freelancer`, the DCP Tracker is automatically hidden by security policy. Change their role to `Duty Tech` or `Senior Tech` to grant access.
- **Q: Can a technician edit their own permissions?**  
  *A:* No. Permission escalation and role updates can only be executed by confirmed Technical Managers or Administrators.
