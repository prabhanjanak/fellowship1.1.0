import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  db,
  candidatesTable,
  unitsTable,
  usersTable,
  programsTable,
  specialitiesTable,
  candidatePreferencesTable,
  documentsTable,
  examAttemptsTable,
  examsTable,
  interviewScoresTable,
  allocationsTable,
  doctorAssignmentsTable,
  candidateExamAssignmentsTable,
  applicationSubmissionsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { sendOfferLetterEmail } from "../lib/email";

const router: Router = Router();

async function fullCandidate(c: typeof candidatesTable.$inferSelect) {
  const units = await db.select().from(unitsTable);
  const unit = c.unitId ? units.find((u) => u.id === c.unitId) : null;
  const prefs = await db.select().from(candidatePreferencesTable).where(eq(candidatePreferencesTable.candidateId, c.id));
  const specs = await db.select().from(specialitiesTable);
  const programs = await db.select().from(programsTable);
  const docs = await db.select().from(documentsTable).where(eq(documentsTable.candidateId, c.id));
  const attempts = await db.select().from(examAttemptsTable).where(eq(examAttemptsTable.candidateId, c.id));
  const exams = await db.select().from(examsTable);
  const interviews = await db.select().from(interviewScoresTable).where(eq(interviewScoresTable.candidateId, c.id));
  const alloc = await db.select().from(allocationsTable).where(eq(allocationsTable.candidateId, c.id));

  const mcqAttempts = attempts.filter((a) => {
    const e = exams.find((x) => x.id === a.examId);
    return e?.kind === "mcq";
  });
  const psychoAttempts = attempts.filter((a) => {
    const e = exams.find((x) => x.id === a.examId);
    return e?.kind?.startsWith("psychometric");
  });
  const mcqScore = mcqAttempts.length > 0
    ? mcqAttempts.reduce((s, a) => s + (a.score ?? 0), 0) / mcqAttempts.length
    : null;
  const psychometricScore = psychoAttempts.length > 0
    ? psychoAttempts.reduce((s, a) => s + (a.score ?? 0), 0) / psychoAttempts.length
    : null;
  const interviewScore = interviews.length > 0
    ? interviews.reduce((s, i) => s + i.score, 0) / interviews.length
    : null;

  const totalScore = (mcqScore != null || psychometricScore != null || interviewScore != null)
    ? (mcqScore ?? 0) + (psychometricScore ?? 0) + (interviewScore ?? 0)
    : null;

  return {
    id: c.id,
    candidateCode: c.candidateCode,
    fullName: c.fullName,
    email: c.email,
    phone: c.phone,
    unitId: c.unitId,
    unitName: unit?.name ?? null,
    status: c.status,
    mcqScore,
    psychometricScore,
    interviewScore,
    totalScore,
    rank: alloc[0]?.rank ?? null,
    createdAt: c.createdAt.toISOString(),
    dateOfBirth: c.dateOfBirth,
    gender: c.gender,
    qualification: c.qualification,
    collegeName: c.collegeName,
    address: c.address,
    preferences: prefs.sort((a, b) => a.preferenceOrder - b.preferenceOrder).map((p) => {
      const sp = specs.find((s) => s.id === p.specialityId);
      const pg = sp ? programs.find((g) => g.id === sp.programId) : null;
      return {
        id: p.id,
        specialityId: p.specialityId,
        specialityName: sp?.name ?? "",
        programName: pg?.name ?? "",
        preferenceOrder: p.preferenceOrder,
      };
    }),
    documents: docs.map((d) => ({
      id: d.id,
      docType: d.docType,
      fileName: d.fileName,
      uploadedAt: d.uploadedAt.toISOString(),
    })),
    attempts: attempts.map((a) => {
      const e = exams.find((x) => x.id === a.examId);
      return {
        id: a.id,
        examId: a.examId,
        examTitle: e?.title ?? "",
        examKind: e?.kind ?? "",
        score: a.score,
        maxScore: a.maxScore,
        submittedAt: a.submittedAt?.toISOString() ?? null,
        startedAt: a.startedAt.toISOString(),
      };
    }),
    paymentInfo: await (async () => {
      const [sub] = await db.select().from(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.email, c.email));
      if (!sub) return null;
      return {
        amount: sub.paidAmount ? sub.paidAmount / 100 : null,
        id: sub.paymentId,
        mode: sub.paymentMode
      };
    })(),
    centerPreference: await (async () => {
      const [sub] = await db.select().from(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.email, c.email));
      return sub?.centerPreference ?? null;
    })(),
    reviewNotes: await (async () => {
      const [sub] = await db.select().from(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.email, c.email));
      return sub?.reviewNotes ?? null;
    })(),
  };
}

router.get("/candidates", requireAuth, requireRole("super_admin", "program_admin", "central_exam_coordinator", "unit_coordinator", "doctor"), async (req, res) => {
  const programId = req.query["programId"] ? Number(req.query["programId"]) : undefined;
  const unitIdRaw = req.query["unitId"] ? Number(req.query["unitId"]) : undefined;
  const status = req.query["status"] as string | undefined;

  // Unit coordinator: force-filter to their unit
  let effectiveUnit = unitIdRaw;
  if (req.user!.role === "unit_coordinator") {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId));
    effectiveUnit = u?.unitId ?? -1;
  }

  let candidates = await db.select().from(candidatesTable).orderBy(desc(candidatesTable.createdAt));
  if (effectiveUnit !== undefined) candidates = candidates.filter((c) => c.unitId === effectiveUnit);
  if (status) candidates = candidates.filter((c) => c.status === status);

  if (programId) {
    const prefs = await db.select().from(candidatePreferencesTable);
    const specs = await db.select().from(specialitiesTable).where(eq(specialitiesTable.programId, programId));
    const specIds = new Set(specs.map((s) => s.id));
    const candidateIds = new Set(prefs.filter((p) => specIds.has(p.specialityId)).map((p) => p.candidateId));
    candidates = candidates.filter((c) => candidateIds.has(c.id));
  }

  const units = await db.select().from(unitsTable);
  const allPrefs = await db.select().from(candidatePreferencesTable);
  const allSpecs = await db.select().from(specialitiesTable);
  const allDocs = await db.select().from(documentsTable);
  const allSubmissions = await db.select().from(applicationSubmissionsTable);

  const out = candidates.map((c) => {
    const unit = c.unitId ? units.find((u) => u.id === c.unitId) : null;
    const prefs = allPrefs
      .filter((p) => p.candidateId === c.id)
      .sort((a, b) => a.preferenceOrder - b.preferenceOrder);
    const specializations = prefs
      .map((p) => allSpecs.find((s) => s.id === p.specialityId)?.name ?? "")
      .filter(Boolean);
    const documents = allDocs
      .filter((d) => d.candidateId === c.id)
      .map((d) => ({ id: d.id, docType: d.docType, fileName: d.fileName, fileUrl: d.fileUrl }));
    return {
      id: c.id,
      candidateCode: c.candidateCode,
      fullName: c.fullName,
      email: c.email,
      phone: c.phone,
      unitId: c.unitId,
      unitName: unit?.name ?? null,
      status: c.status,
      specializations,
      documents,
      mcqScore: null,
      psychometricScore: null,
      interviewScore: null,
      totalScore: null,
      rank: null,
      createdAt: c.createdAt.toISOString(),
      paymentInfo: (() => {
        const sub = allSubmissions.find(s => s.email === c.email);
        if (!sub) return null;
        return {
          amount: sub.paidAmount ? sub.paidAmount / 100 : null,
          id: sub.paymentId,
          mode: sub.paymentMode
        };
      })(),
      centerPreference: (() => {
        const sub = allSubmissions.find(s => s.email === c.email);
        return sub?.centerPreference ?? null;
      })(),
      reviewNotes: (() => {
        const sub = allSubmissions.find(s => s.email === c.email);
        return sub?.reviewNotes ?? null;
      })(),
    };
  });
  res.json(out);
});

router.get("/candidates/me", requireAuth, requireRole("student"), async (req, res) => {
  const [c] = await db.select().from(candidatesTable).where(eq(candidatesTable.userId, req.user!.userId));
  if (!c) { res.status(404).json({ error: "Candidate not found" }); return; }
  res.json(await fullCandidate(c));
});

router.patch("/candidates/me", requireAuth, requireRole("student"), async (req, res) => {
  const [c] = await db.select().from(candidatesTable).where(eq(candidatesTable.userId, req.user!.userId));
  if (!c) { res.status(404).json({ error: "Candidate not found" }); return; }
  const body = req.body as Record<string, string | undefined>;
  const update: Record<string, unknown> = {};
  for (const k of ["fullName", "phone", "dateOfBirth", "gender", "qualification", "collegeName", "address"]) {
    if (body[k] !== undefined) update[k] = body[k];
  }
  const [updated] = await db.update(candidatesTable).set(update).where(eq(candidatesTable.id, c.id)).returning();
  if (!updated) { res.status(500).json({ error: "Failed" }); return; }
  res.json(await fullCandidate(updated));
});

router.patch("/candidates/:candidateId", requireAuth, requireRole("super_admin", "program_admin", "central_exam_coordinator"), async (req, res) => {
  const id = Number(req.params["candidateId"]);
  const body = req.body as Record<string, unknown>;
  const allowed = ["status", "fullName", "phone", "dateOfBirth", "gender", "qualification", "collegeName", "address", "unitId"];
  const update: Record<string, unknown> = {};
  for (const k of allowed) { if (body[k] !== undefined) update[k] = body[k]; }

  // Get current state before update for allocation tracking
  const [before] = await db.select().from(candidatesTable).where(eq(candidatesTable.id, id));
  if (!before) { res.status(404).json({ error: "Not found" }); return; }

  const [updated] = await db.update(candidatesTable).set(update).where(eq(candidatesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  // Support updating reviewNotes on submission
  if (body.reviewNotes !== undefined) {
    await db.update(applicationSubmissionsTable)
      .set({ reviewNotes: String(body.reviewNotes) })
      .where(eq(applicationSubmissionsTable.email, updated.email));
  }

  // Track seat matrix: increment on → allocated, decrement on allocated →
  const oldStatus = before.status;
  const newStatus = updated.status;
  if (newStatus !== oldStatus && (newStatus === "allocated" || oldStatus === "allocated")) {
    const delta = newStatus === "allocated" ? 1 : -1;
    const allUnits = await db.select().from(unitsTable);
    const unitObj = updated.unitId ? allUnits.find((u) => u.id === updated.unitId) : null;
    const unitName = unitObj?.name ?? null;
    let specialityName: string | null = null;
    
    // Extract speciality from reviewNotes if formatted like "Allocated to X"
    if (body.reviewNotes && typeof body.reviewNotes === 'string' && body.reviewNotes.startsWith('Allocated to ')) {
      specialityName = body.reviewNotes.replace('Allocated to ', '').trim();
    } else {
      const prefs = await db.select().from(candidatePreferencesTable).where(eq(candidatePreferencesTable.candidateId, id));
      const firstPref = prefs.sort((a, b) => a.preferenceOrder - b.preferenceOrder)[0];
      if (firstPref) {
        const [spec] = await db.select().from(specialitiesTable).where(eq(specialitiesTable.id, firstPref.specialityId));
        specialityName = spec?.name ?? null;
      }
    }
    
    if (unitName && specialityName) {
      await db.execute(sql`
        INSERT INTO seat_matrix_entries (speciality, unit_name, total_seats, allocated_seats)
        VALUES (${specialityName}, ${unitName}, 0, ${delta > 0 ? 1 : 0})
        ON CONFLICT (speciality, unit_name) DO UPDATE
          SET allocated_seats = GREATEST(0, seat_matrix_entries.allocated_seats + ${delta}), updated_at = NOW()
      `);
    }
  }

  const allUnits = await db.select().from(unitsTable);
  const unit = updated.unitId ? allUnits.find((u) => u.id === updated.unitId) : null;
  res.json({ id: updated.id, candidateCode: updated.candidateCode, fullName: updated.fullName, email: updated.email, phone: updated.phone, unitId: updated.unitId, unitName: unit?.name ?? null, status: updated.status });
});

router.post("/candidates", requireAuth, requireRole("super_admin", "program_admin", "central_exam_coordinator"), async (req, res) => {
  const { fullName, email, phone, gender, qualification, collegeName, address, unitId } = req.body as {
    fullName: string; email: string; phone?: string; gender?: string; qualification?: string; collegeName?: string; address?: string; unitId?: number;
  };
  if (!fullName || !email) { res.status(400).json({ error: "fullName and email required" }); return; }
  const count = await db.select().from(candidatesTable);
  const candidateCode = `CAND-2026-${String(count.length + 1).padStart(3, "0")}`;
  const [c] = await db.insert(candidatesTable).values({
    candidateCode, fullName, email: email.toLowerCase(), phone: phone ?? null,
    gender: gender ?? null, qualification: qualification ?? null, collegeName: collegeName ?? null,
    address: address ?? null, unitId: unitId ?? null, status: "pending",
  }).returning();
  if (!c) { res.status(500).json({ error: "Failed" }); return; }
  res.json({ id: c.id, candidateCode: c.candidateCode, fullName: c.fullName, email: c.email, phone: c.phone, unitId: c.unitId, unitName: null, status: c.status });
});

// CEC or admin: update MCQ / psychometric scores (+ optionally assign to panel queue)
router.patch("/candidates/:candidateId/marks", requireAuth, requireRole("super_admin", "program_admin", "central_exam_coordinator"), async (req, res) => {
  const id = Number(req.params["candidateId"]);
  const { mcqScore, psychometricScore, panelId } = req.body as { mcqScore?: number | null; psychometricScore?: number | null; panelId?: number | null };
  const update: Record<string, unknown> = {};
  if (mcqScore !== undefined) update["mcqScore"] = mcqScore;
  if (psychometricScore !== undefined) update["psychometricScore"] = psychometricScore;
  const [updated] = await db.update(candidatesTable).set(update).where(eq(candidatesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  // Optionally add to panel queue
  if (panelId) {
    const [maxRow] = (await db.execute(sql`
      SELECT COALESCE(MAX(queue_position), -1) as max_pos FROM panel_queue WHERE panel_id = ${panelId}
    `)).rows as Array<Record<string, unknown>>;
    const nextPos = Number(maxRow!["max_pos"]) + 1;
    await db.execute(sql`
      INSERT INTO panel_queue (panel_id, candidate_id, queue_position, status)
      VALUES (${panelId}, ${id}, ${nextPos}, 'waiting')
      ON CONFLICT (panel_id, candidate_id) DO NOTHING
    `);
  }

  res.json({ id: updated.id, mcqScore: updated.mcqScore, psychometricScore: updated.psychometricScore });
});

router.get("/candidates/:candidateId", requireAuth, async (req, res) => {
  const id = Number(req.params["candidateId"]);
  const [c] = await db.select().from(candidatesTable).where(eq(candidatesTable.id, id));
  if (!c) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await fullCandidate(c));
});

router.post("/candidates/:candidateId/assign-unit", requireAuth, requireRole("super_admin", "program_admin", "central_exam_coordinator"), async (req, res) => {
  const id = Number(req.params["candidateId"]);
  const { unitId } = req.body as { unitId: number };
  const [c] = await db.update(candidatesTable).set({ unitId }).where(eq(candidatesTable.id, id)).returning();
  if (!c) { res.status(404).json({ error: "Not found" }); return; }
  const units = await db.select().from(unitsTable);
  const unit = c.unitId ? units.find((u) => u.id === c.unitId) : null;
  res.json({
    id: c.id,
    candidateCode: c.candidateCode,
    fullName: c.fullName,
    email: c.email,
    phone: c.phone,
    unitId: c.unitId,
    unitName: unit?.name ?? null,
    status: c.status,
    mcqScore: null,
    psychometricScore: null,
    interviewScore: null,
    totalScore: null,
    rank: null,
    createdAt: c.createdAt.toISOString(),
  });
});

// Helper: cascade-delete all related records for a set of candidate IDs
async function cascadeDeleteCandidates(ids: number[]) {
  const { inArray } = await import("drizzle-orm");
  await db.delete(interviewScoresTable).where(inArray(interviewScoresTable.candidateId, ids));
  await db.delete(doctorAssignmentsTable).where(inArray(doctorAssignmentsTable.candidateId, ids));
  await db.delete(documentsTable).where(inArray(documentsTable.candidateId, ids));
  await db.delete(allocationsTable).where(inArray(allocationsTable.candidateId, ids));
  await db.delete(candidateExamAssignmentsTable).where(inArray(candidateExamAssignmentsTable.candidateId, ids));
  await db.delete(examAttemptsTable).where(inArray(examAttemptsTable.candidateId, ids));
  await db.delete(candidatePreferencesTable).where(inArray(candidatePreferencesTable.candidateId, ids));
  await db.delete(candidatesTable).where(inArray(candidatesTable.id, ids));
}

// DELETE single candidate
router.delete("/candidates/:id", requireAuth, requireRole("super_admin", "program_admin", "central_exam_coordinator"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await cascadeDeleteCandidates([id]);
  res.json({ success: true });
});

// POST bulk-delete candidates
router.post("/candidates/bulk-delete", requireAuth, requireRole("super_admin", "program_admin", "central_exam_coordinator"), async (req, res) => {
  const { ids } = req.body as { ids: number[] };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids array required" }); return; }
  await cascadeDeleteCandidates(ids);
  res.json({ success: true, deleted: ids.length });
});

// Send formal offer letter email
router.post("/candidates/:id/send-offer", requireAuth, requireRole("super_admin", "program_admin"), async (req, res) => {
  const id = Number(req.params.id);
  const [c] = await db.select().from(candidatesTable).where(eq(candidatesTable.id, id));
  if (!c) { res.status(404).json({ error: "Candidate not found" }); return; }

  // Must be allocated
  if (c.status !== "allocated") {
    res.status(400).json({ error: "Candidate must be allocated before sending an offer letter" });
    return;
  }

  const [sub] = await db.select().from(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.email, c.email));
  const reviewNotes = sub?.reviewNotes || "";
  
  let specialization = "Fellowship";
  if (reviewNotes.startsWith("Allocated to ")) {
    specialization = reviewNotes.replace("Allocated to ", "");
  }

  const units = await db.select().from(unitsTable);
  const unit = c.unitId ? units.find(u => u.id === c.unitId) : null;
  const unitName = unit?.name || "Sankara Eye Hospital";

  try {
    await sendOfferLetterEmail({
      toEmail: c.email,
      toName: c.fullName,
      candidateCode: c.candidateCode,
      specialization,
      unitName
    });
    
    // Mark as sent in reviewNotes or similar (optional but good for UI)
    const newNotes = reviewNotes + " [OFFER SENT]";
    await db.update(applicationSubmissionsTable)
      .set({ reviewNotes: newNotes })
      .where(eq(applicationSubmissionsTable.email, c.email));

    res.json({ success: true });
  } catch (e) {
    console.error("[email] Failed to send offer letter", e);
    res.status(500).json({ error: "Failed to send email. Please check SMTP settings." });
  }
});

export default router;
