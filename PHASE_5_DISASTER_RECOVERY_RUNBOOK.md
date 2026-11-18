# NEXTRADE AI — PHASE 5 DISASTER RECOVERY RUNBOOK

## 1. Runtime Backup Capability Truth Table

| Runtime Dialect | Full Physical DB Backup (`pg_dump` / `VACUUM INTO`) | Configuration Snapshot (`CONFIG_SNAPSHOT`) | Primary Physical Recovery Authority |
|---|---|---|---|
| **Supabase PostgreSQL** *(Production / Preview)* | **NOT_CONFIGURED** in app server *(no `pg_dump` binary or remote object-storage backup token in container)* | **AVAILABLE** *(JSON snapshot + SHA-256 verification)* | **Supabase Managed Backups / PITR** in Supabase Dashboard |
| **File-Backed SQLite** *(Local / File DB)* | **AVAILABLE** *(`VACUUM INTO` + `PRAGMA integrity_check` + SHA-256)* | **AVAILABLE** *(JSON snapshot + SHA-256 verification)* | Local `.data/backups/*.sqlite` snapshots |
| **In-Memory SQLite** *(`:memory:` tests)* | **NOT_CONFIGURED** | **AVAILABLE** | Ephemeral test memory |

---

## 2. Standard Procedures

### 2.1 Taking a Verified Governance & Config Snapshot (PostgreSQL or SQLite)
1. Sign in as a user with `admin:backup:create` (e.g., `super_admin`, `admin`, `security_admin`).
2. Open `/admin/backups` -> click **Create Configuration Snapshot**.
3. The server captures sanitized `platform_settings`, `feature_flags`, and `ai_prompt_templates` (strictly omitting API keys, database URLs, and credentials), computes its SHA-256 digest, and writes an immutable entry in `admin_audit_logs` and `backup_records`.
4. Click **Verify Integrity** on the snapshot row to re-compute SHA-256 and structure validation (`status -> VERIFIED`).

### 2.2 Full Database Backup & Recovery (PostgreSQL Production)
1. **Do NOT rely on in-app triggers for physical PostgreSQL dumps** unless `pg_dump` and managed remote storage credentials are explicitly provisioned.
2. Open the **Supabase Dashboard -> Database -> Backups** for Point-in-Time Recovery (PITR) or daily physical snapshots.
3. Before executing any destructive Supabase restore, place Nextrade AI into maintenance mode via `/admin/releases` (activating a Maintenance Window with `super_admin` bypass enabled) so user writes pause cleanly.

### 2.3 Guarded In-App Snapshot Restore (Super Admin Only)
1. Only `super_admin` holds `admin:backup:restore`.
2. Target snapshot must hold status `VERIFIED`.
3. Select **Restore** on `/admin/backups`, enter current `super_admin` password (fresh re-authentication), and type the exact confirmation phrase: `RESTORE BACKUP`.
4. Behavior by snapshot type:
   - **`CONFIG_SNAPSHOT`:** Restores `platform_settings` and `feature_flags` inside the active DB and logs `RESTORE_COMPLETED`.
   - **`SQLITE_SNAPSHOT`:** Automatically writes a pre-restore safety snapshot of the active SQLite file before replacing the database file.

---

## 3. Maintenance Mode & Admin Recovery Path

- **Locking User Traffic:** Use `/admin/releases` to schedule or immediately activate a `maintenance_windows` record, or `/admin/configuration` to toggle `maintenance_mode`.
- **Bypass Guarantee:** `super_admin` always retains access to `/admin/*`, `/api/admin/*`, and `/api/auth/*` during maintenance windows.
- **Public Verification:** Confirm live status via `GET /api/health` and `GET /api/maintenance/status`.
