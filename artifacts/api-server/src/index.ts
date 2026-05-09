import app from "./app";
import { logger } from "./lib/logger";
import { db, usersTable, applicationFormsTable, programsTable } from "@workspace/db";
import { eq, sql, ilike } from "drizzle-orm";
import { DEFAULT_SECTIONS } from "./lib/default-sections";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Correct bcrypt hash for Saravanan@2026 — used to normalise both dev and prod
const SARAVANAN_PASSWORD_HASH = "$2b$10$tzKB/Dj.bn.MPCUj5GJQz.V6.ijFrypzqkwSjMW458ni7dCAx0MuS";

async function runStartupFixes() {

  // Migration: add new columns if they don't exist
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS designation TEXT`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_seed TEXT`);

  // Migration: create seat_matrix_entries table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS seat_matrix_entries (
      id SERIAL PRIMARY KEY,
      speciality TEXT NOT NULL,
      unit_name TEXT NOT NULL,
      total_seats INTEGER NOT NULL DEFAULT 0,
      allocated_seats INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Migration: add program_id column to seat_matrix_entries
  await db.execute(sql`ALTER TABLE seat_matrix_entries ADD COLUMN IF NOT EXISTS program_id INTEGER REFERENCES programs(id)`);
  await db.execute(sql`ALTER TABLE seat_matrix_entries DROP CONSTRAINT IF EXISTS seat_matrix_entries_speciality_unit_name_key`);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seat_matrix_entries_prog_spec_unit_key') THEN
        ALTER TABLE seat_matrix_entries ADD CONSTRAINT seat_matrix_entries_prog_spec_unit_key UNIQUE (program_id, speciality, unit_name);
      END IF;
    END $$
  `);
  await db.execute(sql`
    UPDATE seat_matrix_entries SET program_id = (SELECT id FROM programs ORDER BY id LIMIT 1) WHERE program_id IS NULL
  `);

  // Migration: create payment_settings table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS payment_settings (
      id SERIAL PRIMARY KEY,
      program_id INTEGER,
      razorpay_key_id TEXT,
      razorpay_key_secret TEXT,
      amount INTEGER NOT NULL DEFAULT 275000,
      currency TEXT NOT NULL DEFAULT 'INR',
      description TEXT NOT NULL DEFAULT 'Fellowship Application Fee',
      mode TEXT NOT NULL DEFAULT 'test',
      upi_id TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Migration: add upi_id column if missing (for existing tables)
  await db.execute(sql`ALTER TABLE payment_settings ADD COLUMN IF NOT EXISTS upi_id TEXT`);

  // Migration: custom fields on application_forms
  await db.execute(sql`ALTER TABLE application_forms ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '[]'::jsonb`);

  // Migration: custom answers on application_submissions
  await db.execute(sql`ALTER TABLE application_submissions ADD COLUMN IF NOT EXISTS custom_answers JSONB DEFAULT '{}'::jsonb`);

  // Migration: google_forms_config on application_forms
  await db.execute(sql`ALTER TABLE application_forms ADD COLUMN IF NOT EXISTS google_forms_config JSONB DEFAULT NULL`);

  // Migration: source column on application_submissions ('internal' | 'google_forms')
  await db.execute(sql`ALTER TABLE application_submissions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'internal'`);

  // Migration: ready_for_review flag on application_submissions
  await db.execute(sql`ALTER TABLE application_submissions ADD COLUMN IF NOT EXISTS ready_for_review BOOLEAN NOT NULL DEFAULT FALSE`);

  // Migration: google_forms_response_id for deduplication
  await db.execute(sql`ALTER TABLE application_submissions ADD COLUMN IF NOT EXISTS google_forms_response_id TEXT`);

  // Migration: google_sheets_config on application_forms
  await db.execute(sql`ALTER TABLE application_forms ADD COLUMN IF NOT EXISTS google_sheets_config JSONB DEFAULT NULL`);

  // Migration: google_sheets_row_id for deduplication
  await db.execute(sql`ALTER TABLE application_submissions ADD COLUMN IF NOT EXISTS google_sheets_row_id TEXT`);

  // Migration: add display_operator role to enum (must run outside transaction - best-effort)
  try { await db.execute(sql`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'display_operator'`); } catch (_) { /* already exists */ }

  // Migration: interview_panels table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS interview_panels (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      room_number TEXT NOT NULL,
      program_id INTEGER REFERENCES programs(id),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Migration: interview_panel_members table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS interview_panel_members (
      id SERIAL PRIMARY KEY,
      panel_id INTEGER NOT NULL REFERENCES interview_panels(id) ON DELETE CASCADE,
      doctor_id INTEGER NOT NULL REFERENCES users(id),
      is_main BOOLEAN NOT NULL DEFAULT FALSE,
      UNIQUE(panel_id, doctor_id)
    )
  `);

  // Migration: panel_queue table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS panel_queue (
      id SERIAL PRIMARY KEY,
      panel_id INTEGER NOT NULL REFERENCES interview_panels(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      queue_position INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'waiting',
      called_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(panel_id, candidate_id)
    )
  `);

  // Fix 1: correct old placeholder email → canonical super admin email + password
  const [oldEmail] = await db.select().from(usersTable).where(eq(usersTable.email, "admin@sankaraeye.com"));
  if (oldEmail) {
    await db.update(usersTable)
      .set({ email: "saravanan@sankaraeye.com", passwordHash: SARAVANAN_PASSWORD_HASH })
      .where(eq(usersTable.id, oldEmail.id));
    logger.info("Corrected super admin email + password (admin@ → saravanan@)");
  }

  // Fix 2: ensure password hash is correct even if email was already updated
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, "saravanan@sankaraeye.com"));
  if (existing) {
    if (existing.passwordHash !== SARAVANAN_PASSWORD_HASH) {
      await db.update(usersTable)
        .set({ passwordHash: SARAVANAN_PASSWORD_HASH })
        .where(eq(usersTable.id, existing.id));
      logger.info("Corrected super admin password hash for saravanan@sankaraeye.com");
    }
  } else {
    // Fix 3: Create the user if they don't exist at all
    await db.insert(usersTable).values({
      email: "saravanan@sankaraeye.com",
      passwordHash: SARAVANAN_PASSWORD_HASH,
      role: "super_admin",
      fullName: "Saravanan",
    });
    logger.info("Created super admin saravanan@sankaraeye.com");
  }

  // Fix 4: Ensure the July 2026 Program and Form exist
  let [prog] = await db.select().from(programsTable).where(ilike(programsTable.name, "%July 2026%"));
  
  if (!prog) {
    [prog] = await db.insert(programsTable).values({
      name: "Fellowship Program July 2026",
      code: "FP-JUL-2026",
      academicYear: "2026",
      description: "Sankara Academy of Vision Fellowship Intake July 2026"
    }).returning();
    logger.info("Created missing July 2026 program");
  }

  const [targetForm] = await db.select().from(applicationFormsTable).where(ilike(applicationFormsTable.title, "%July 2026%"));
  
  if (targetForm) {
    await db.update(applicationFormsTable)
      .set({ sectionsConfig: DEFAULT_SECTIONS as any })
      .where(eq(applicationFormsTable.id, targetForm.id));
    logger.info("Updated existing July 2026 fellowship form configuration");
  } else {
    // Create it using the program we found or created
    await db.insert(applicationFormsTable).values({
      programId: prog.id,
      title: "Fellowship Program - July 2026",
      description: "Sankara Academy of Vision Fellowship Program for July 2026 batch.",
      isActive: true,
      token: "JULY2026",
      sectionsConfig: DEFAULT_SECTIONS as any,
      programName: prog.name,
    });
    logger.info("Created new July 2026 fellowship form with standard sections");
  }
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  runStartupFixes().catch((e) => logger.error({ err: e }, "Startup fixes failed"));
});
