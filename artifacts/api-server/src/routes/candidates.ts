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
  documentTemplatesTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { sendOfferLetterEmail, sendOfferLetterWithAttachment } from "../lib/email";
import { processGoogleDocTemplate } from "../lib/google-docs";
import { emailSettingsTable, applicationFormsTable, batchesTable, batchCandidatesTable } from "@workspace/db";
import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs/promises";
import { parseSpecializationString, formatDOBToStandard } from "../lib/utils";
import * as XLSX from "xlsx";

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
    dateOfBirth: formatDOBToStandard(c.dateOfBirth),
    gender: c.gender,
    qualification: c.qualification,
    collegeName: c.collegeName,
    address: c.address,
    preferences: await (async () => {
      let resolvedPrefs = prefs.sort((a, b) => a.preferenceOrder - b.preferenceOrder).map((p) => {
        const sp = specs.find((s) => s.id === p.specialityId);
        const pg = sp ? programs.find((g) => g.id === sp.programId) : null;
        return {
          id: p.id,
          specialityId: p.specialityId,
          specialityName: sp?.name ?? "",
          programName: pg?.name ?? "",
          preferenceOrder: p.preferenceOrder,
        };
      });

      if (resolvedPrefs.length === 0) {
        const [sub] = await db.select().from(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.email, c.email));
        if (sub && sub.specialization) {
          const parsedSpecs = parseSpecializationString(sub.specialization);
          resolvedPrefs = parsedSpecs.map((specName, index) => {
            const sp = specs.find((s) => s.name.toLowerCase() === specName.toLowerCase());
            const pg = sp ? programs.find((g) => g.id === sp.programId) : null;
            return {
              id: -(index + 1), // virtual ID
              specialityId: sp?.id ?? 0,
              specialityName: sp?.name ?? specName,
              programName: pg?.name ?? "",
              preferenceOrder: index + 1,
            };
          });
        }
      }
      return resolvedPrefs;
    })(),
    documents: docs.map((d) => ({
      id: d.id,
      docType: d.docType,
      fileName: d.fileName,
      fileUrl: d.fileUrl ?? null,
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
        amount: sub.paidAmount ? (sub.paidAmount > 100000 ? sub.paidAmount / 100 : sub.paidAmount) : null,
        id: sub.paymentId,
        mode: sub.paymentMode
      };
    })(),
    centerPreference: await (async () => {
      const [sub] = await db.select().from(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.email, c.email));
      return sub?.centerPreference ?? null;
    })(),
    submissionId: await (async () => {
      const [sub] = await db.select().from(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.email, c.email));
      return sub?.id ?? null;
    })(),
    reviewNotes: await (async () => {
      const [sub] = await db.select().from(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.email, c.email));
      return sub?.reviewNotes ?? null;
    })(),
    pgQualifications: await (async () => {
      const [sub] = await db.select().from(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.email, c.email));
      return sub?.pgQualifications ?? null;
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

  let candidates = await db.select().from(candidatesTable)
    .where(eq(candidatesTable.isMock, (req as any).isMockMode))
    .orderBy(desc(candidatesTable.createdAt));
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
    let specializations = prefs
      .map((p) => allSpecs.find((s) => s.id === p.specialityId)?.name ?? "")
      .filter(Boolean);
    if (specializations.length === 0) {
      const sub = allSubmissions.find(s => s.email?.toLowerCase() === c.email?.toLowerCase());
      if (sub && sub.specialization) {
        specializations = parseSpecializationString(sub.specialization);
      }
    }
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
      dateOfBirth: formatDOBToStandard(c.dateOfBirth),
      gender: c.gender,
      qualification: c.qualification,
      collegeName: c.collegeName,
      address: c.address,
      paymentInfo: (() => {
        const sub = allSubmissions.find(s => s.email?.toLowerCase() === c.email?.toLowerCase());
        if (!sub) return null;
        return {
          amount: sub.paidAmount ? (sub.paidAmount > 100000 ? sub.paidAmount / 100 : sub.paidAmount) : null,
          id: sub.paymentId,
          mode: sub.paymentMode
        };
      })(),
      centerPreference: (() => {
        const sub = allSubmissions.find(s => s.email?.toLowerCase() === c.email?.toLowerCase());
        return sub?.centerPreference ?? null;
      })(),
      submissionId: (() => {
        const sub = allSubmissions.find(s => s.email?.toLowerCase() === c.email?.toLowerCase());
        return sub?.id ?? null;
      })(),
      reviewNotes: (() => {
        const sub = allSubmissions.find(s => s.email?.toLowerCase() === c.email?.toLowerCase());
        return sub?.reviewNotes ?? null;
      })(),
      pgQualifications: (() => {
        const sub = allSubmissions.find(s => s.email?.toLowerCase() === c.email?.toLowerCase());
        return sub?.pgQualifications ?? null;
      })(),
    };
  });
  res.json(out);
});

// ── Shared style constants for candidate export ────────────────────────────
const HEADER_FONT  = { bold: true, color: { rgb: "FFFFFF" }, sz: 11, name: "Calibri" };
const HEADER_ALIGN = { horizontal: "center", vertical: "center", wrapText: false };
const ROW_EVEN     = { patternType: "solid", fgColor: { rgb: "E8F0FE" } }; // light blue
const ROW_ODD      = { patternType: "solid", fgColor: { rgb: "FFFFFF" } }; // white
const BODY_FONT    = { sz: 10, name: "Calibri" };
const BODY_ALIGN   = { horizontal: "left", vertical: "center", wrapText: false };
const THIN_BORDER  = {
  top:    { style: "thin", color: { rgb: "C5D3E8" } },
  bottom: { style: "thin", color: { rgb: "C5D3E8" } },
  left:   { style: "thin", color: { rgb: "C5D3E8" } },
  right:  { style: "thin", color: { rgb: "C5D3E8" } },
};
// Retina segment highlight fill
const RETINA_FILL  = { patternType: "solid", fgColor: { rgb: "FFF3CD" } }; // amber-tinted
const RETINA_FONT  = { sz: 10, name: "Calibri", color: { rgb: "7B3F00" }, bold: true };

// Per-sheet header colour palette (one per sheet)
const SHEET_HEADER_COLORS: Record<string, string> = {
  "General":                "0B4A8F", // deep navy
  "Cornea":                 "006064", // teal
  "Glaucoma":               "311B92", // deep purple
  "IOL Fellowship":         "1A237E", // indigo
  "Medical Retina":         "880E4F", // deep pink
  "Oculoplasty":            "BF360C", // deep orange
  "Pediatric Ophthalmology":"1B5E20", // deep green
  "Phaco Refractive":       "4A148C", // purple
  "Vitreo Retina":          "B71C1C", // deep red
};

function buildStyledSheet(rows: Record<string, any>[], sheetName: string): XLSX.WorkSheet {
  if (rows.length === 0) {
    // Return an empty sheet with just headers
    const ws = XLSX.utils.json_to_sheet([]);
    return ws;
  }

  const headers = Object.keys(rows[0]);
  const numCols = headers.length;
  const numRows = rows.length;
  const headerColor = SHEET_HEADER_COLORS[sheetName] ?? "0B4A8F";

  // Build worksheet data array (header + data rows)
  const wsData: any[][] = [headers, ...rows.map(r => headers.map(h => r[h] ?? ""))];
  const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet(wsData);

  // Apply cell styles
  for (let R = 0; R <= numRows; R++) {
    for (let C = 0; C < numCols; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) continue;
      const cell = ws[addr];

      if (R === 0) {
        // Header row
        cell.s = {
          fill:      { patternType: "solid", fgColor: { rgb: headerColor } },
          font:      HEADER_FONT,
          alignment: HEADER_ALIGN,
          border:    THIN_BORDER,
        };
      } else {
        // Data rows — highlight Retina/Anterior column cells
        const colHeader = headers[C];
        const cellVal   = String(cell.v ?? "");
        const isRetina  = colHeader === "Retina/Anterior" && cellVal === "Retina";
        cell.s = {
          fill:      isRetina ? RETINA_FILL : (R % 2 === 0 ? ROW_ODD : ROW_EVEN),
          font:      isRetina ? RETINA_FONT : BODY_FONT,
          alignment: BODY_ALIGN,
          border:    THIN_BORDER,
        };
      }
    }
  }

  // Auto-fit column widths
  ws["!cols"] = headers.map((h) => {
    let maxLen = h.length;
    for (const row of rows) {
      const v = row[h];
      if (v != null) maxLen = Math.max(maxLen, String(v).length);
    }
    return { wch: Math.min(maxLen + 4, 50) };
  });

  // Freeze header row
  ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };

  // Auto-filter
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: numCols - 1, r: numRows } }),
  };

  // Row height for header
  ws["!rows"] = [{ hpt: 22 }, ...Array(numRows).fill({ hpt: 18 })];

  return ws;
}

router.get("/candidates/export", requireAuth, requireRole("super_admin", "program_admin", "central_exam_coordinator"), async (req, res) => {
  try {
    const candidates = await db.select().from(candidatesTable)
      .where(eq(candidatesTable.isMock, (req as any).isMockMode))
      .orderBy(desc(candidatesTable.createdAt));

    // Export ALL candidates (all statuses), not just approved
    const units        = await db.select().from(unitsTable);
    const allPrefs     = await db.select().from(candidatePreferencesTable);
    const allSpecs     = await db.select().from(specialitiesTable);
    const allSubmissions = await db.select().from(applicationSubmissionsTable);

    const resolvedCandidates = candidates.map((c) => {
      const unit  = c.unitId ? units.find((u) => u.id === c.unitId) : null;
      const prefs = allPrefs
        .filter((p) => p.candidateId === c.id)
        .sort((a, b) => a.preferenceOrder - b.preferenceOrder);
      let specializations = prefs
        .map((p) => allSpecs.find((s) => s.id === p.specialityId)?.name ?? "")
        .filter(Boolean);
      if (specializations.length === 0) {
        const sub = allSubmissions.find(s => s.email?.toLowerCase() === c.email?.toLowerCase());
        if (sub?.specialization) specializations = parseSpecializationString(sub.specialization);
      }
      const submission = allSubmissions.find(s => s.email?.toLowerCase() === c.email?.toLowerCase());

      return {
        id: c.id,
        candidateCode: c.candidateCode,
        fullName:      c.fullName,
        email:         c.email,
        phone:         c.phone        || "N/A",
        dateOfBirth:   formatDOBToStandard(c.dateOfBirth),
        gender:        c.gender       || "N/A",
        qualification: c.qualification || "N/A",
        pgQualifications: submission?.pgQualifications || "N/A",
        collegeName:   c.collegeName  || "N/A",
        address:       c.address      || "N/A",
        centerPreference: submission?.centerPreference || "N/A",
        specializations,
        status:        c.status,
        unitName:      unit?.name     || "N/A",
        paymentAmount: (() => {
          if (!submission?.paidAmount) return "N/A";
          const amt = submission.paidAmount > 100000 ? submission.paidAmount / 100 : submission.paidAmount;
          return `Rs. ${amt.toLocaleString("en-IN")}`;
        })(),
        paymentMode:   submission?.paymentMode || "N/A",
        createdAt:     c.createdAt ? new Date(c.createdAt).toLocaleDateString("en-IN") : "N/A",
      };
    });

    const specOrder = [
      "Cornea", "Glaucoma", "IOL Fellowship", "Medical Retina",
      "Oculoplasty", "Pediatric Ophthalmology", "Phaco Refractive", "Vitreo Retina",
    ];

    // Status label map
    const STATUS_LABELS: Record<string, string> = {
      pending:              "Pending",
      approved:             "Approved",
      rejected:             "Rejected",
      interview_completed:  "Interview Completed",
      waitlisted:           "Waitlisted",
      allocated:            "Allocated",
    };

    const mapToExcelRow = (rc: typeof resolvedCandidates[0]) => {
      const specsString = rc.specializations.join(", ");
      const hasRetina   = rc.specializations.some(s => s.toLowerCase().includes("retina"));
      const hasBoth     = hasRetina && rc.specializations.some(s => !s.toLowerCase().includes("retina"));
      const segment     = hasBoth ? "Anterior, Retina" : hasRetina ? "Retina" : "Anterior";
      return {
        "Candidate ID":     rc.candidateCode,
        "Name":             rc.fullName,
        "Email":            rc.email,
        "Phone":            rc.phone,
        "Date of Birth":    rc.dateOfBirth,
        "Gender":           rc.gender,
        "Qualification":    rc.qualification,
        "PG Qualification": rc.pgQualifications,
        "College":          rc.collegeName,
        "Mailing Address":  rc.address,
        "Specialities":     specsString,
        "Retina/Anterior":  segment,
        "Preferred Center": rc.centerPreference,
        "Allotted Unit":    rc.unitName,
        "Status":           STATUS_LABELS[rc.status] ?? rc.status,
        "Payment Amount":   rc.paymentAmount,
        "Payment Mode":     rc.paymentMode,
        "Registration Date": rc.createdAt,
      };
    };

    const wb = XLSX.utils.book_new();

    // General sheet — all candidates
    const generalRows = resolvedCandidates.map(mapToExcelRow);
    const generalWs   = buildStyledSheet(generalRows, "General");
    XLSX.utils.book_append_sheet(wb, generalWs, "General");

    // One sheet per speciality — only approved candidates for speciality sheets
    const approvedResolved = resolvedCandidates.filter(c => c.status === "approved");
    for (const spec of specOrder) {
      const specCandidates = approvedResolved.filter(rc =>
        rc.specializations.some(s => {
          const sN = s.toLowerCase(), spN = spec.toLowerCase();
          return spN === "iol fellowship" ? (sN === "iol" || sN === "iol fellowship") : sN === spN;
        })
      );
      const specRows = specCandidates.map(mapToExcelRow);
      const specWs   = buildStyledSheet(specRows, spec);
      XLSX.utils.book_append_sheet(wb, specWs, spec);
    }

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
    const today  = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Disposition", `attachment; filename="SAV_Candidates_${today}.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to export candidates" });
  }
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
  const { fullName, email, phone, gender, qualification, collegeName, address, unitId, pgQualifications, centerPreference, specialityIds } = req.body as {
    fullName: string; email: string; phone?: string; gender?: string; qualification?: string; collegeName?: string; address?: string; unitId?: number;
    pgQualifications?: string; centerPreference?: string; specialityIds?: number[];
  };
  if (!fullName || !email) { res.status(400).json({ error: "fullName and email required" }); return; }
  
  const cleanEmail = email.toLowerCase().trim();
  const existing = await db.select().from(candidatesTable).where(eq(candidatesTable.email, cleanEmail));
  if (existing.length > 0) {
    res.status(400).json({ error: "Candidate with this email already exists" });
    return;
  }

  const count = await db.select().from(candidatesTable);
  const candidateCode = `CAND-2026-${String(count.length + 1).padStart(3, "0")}`;
  const [c] = await db.insert(candidatesTable).values({
    candidateCode, fullName, email: cleanEmail, phone: phone ?? null,
    gender: gender ?? null, qualification: qualification ?? null, collegeName: collegeName ?? null,
    address: address ?? null, unitId: unitId ?? null, status: "pending",
  }).returning();
  if (!c) { res.status(500).json({ error: "Failed" }); return; }

  // Insert candidate speciality preferences
  const specialityNames: string[] = [];
  if (Array.isArray(specialityIds) && specialityIds.length > 0) {
    const specs = await db.select().from(specialitiesTable);
    let order = 1;
    for (const specId of specialityIds) {
      const spec = specs.find((s) => s.id === specId);
      if (spec) {
        specialityNames.push(spec.name);
        await db.insert(candidatePreferencesTable).values({
          candidateId: c.id,
          specialityId: spec.id,
          preferenceOrder: order++,
        });
      }
    }
  }

  // Create a corresponding stub submission in application_submissions table to ensure qualifications, center preferences, and LORs display perfectly
  const activeForms = await db.select().from(applicationFormsTable).where(eq(applicationFormsTable.isActive, true));
  const formId = activeForms[0]?.id ?? 1;

  await db.insert(applicationSubmissionsTable).values({
    candidateId: c.id,
    formId,
    fullName: c.fullName,
    email: cleanEmail,
    phone: c.phone,
    permanentAddress: c.address,
    degree: c.qualification,
    medicalCollege: c.collegeName,
    pgQualifications: pgQualifications || null,
    centerPreference: centerPreference || null,
    specialization: specialityNames.length > 0 ? JSON.stringify(specialityNames) : null,
    status: "approved",
    readyForReview: true,
    source: "manual",
  });

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

  const updatedAny = updated as any;
  res.json({ id: updated.id, mcqScore: updatedAny.mcqScore != null ? Number(updatedAny.mcqScore) : null, psychometricScore: updatedAny.psychometricScore != null ? Number(updatedAny.psychometricScore) : null });
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
router.post("/candidates/bulk-delete", requireAuth, requireRole("super_admin", "program_admin", "central_exam_coordinator", "exam_coordinator"), async (req, res) => {
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
    const [settings] = await db.select().from(emailSettingsTable).limit(1);
    
    // 1. Get Template ID (priority: passed ID > program ID > global ID)
    let templateId = req.body.templateId; // Use the specific template selected in UI
    
    if (!templateId) {
      // Fallback logic
      templateId = settings?.googleDocsTemplateId;
      const [submission] = await db.select().from(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.email, c.email));
      if (submission?.formId) {
        const [form] = await db.select().from(applicationFormsTable).where(eq(applicationFormsTable.id, submission.formId));
        if (form?.programId) {
          const [prog] = await db.select().from(programsTable).where(eq(programsTable.id, form.programId));
          const progAny = prog as any;
          if (progAny?.offerLetterTemplateId) {
            templateId = String(progAny.offerLetterTemplateId);
          }
        }
      }
    } else {
      // Fetch the actual google doc ID from our templates table
      const [tpl] = await db.select().from(documentTemplatesTable).where(eq(documentTemplatesTable.id, Number(templateId)));
      if (tpl) templateId = tpl.googleDocId;
    }

    if (templateId && settings?.googleServiceAccountJson) {
      // Build replacements
      const replacements: Record<string, string> = {
        letter_date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
        name: c.fullName,
        address: c.address || "",
        interview_date: req.body.interview_date || "—",
        specialization: specialization,
        unit: unitName,
        duration: req.body.duration || "24 Months",
        start_date: req.body.start_date || "—",
        reporting_date: req.body.reporting_date || "—",
        induction_dates: req.body.induction_dates || "—",
        stipend: String(req.body.stipend || "0"),
        stipend_words: req.body.stipend_words || "Zero",
        reporting_doctor: req.body.reporting_doctor || "the Chief Medical Officer",
        signing_authority: req.body.signing_authority || "Director",
        ...(req.body.custom_fields || {})
      };

      const pdfBuffer = await processGoogleDocTemplate({
        templateId,
        serviceAccountJson: settings.googleServiceAccountJson,
        replacements
      });

      await sendOfferLetterWithAttachment({
        toEmail: c.email,
        toName: c.fullName,
        pdfBuffer,
        fileName: `Offer_Letter_${c.candidateCode}.pdf`
      });
    } else {
      // Fallback to HTML template
      await sendOfferLetterEmail({
        toEmail: c.email,
        toName: c.fullName,
        candidateCode: c.candidateCode,
        specialization,
        unitName
      });
    }
    
    // Mark as sent
    const newNotes = reviewNotes + " [OFFER SENT]";
    await db.update(applicationSubmissionsTable)
      .set({ reviewNotes: newNotes })
      .where(eq(applicationSubmissionsTable.email, c.email));

    res.json({ success: true, method: settings?.googleDocsTemplateId ? "google_docs" : "html" });
  } catch (e: any) {
    console.error("[email] Failed to send offer letter", e);
    res.status(500).json({ error: e.message || "Failed to send email." });
  }
});

// Generate and Download PDF
router.post("/candidates/:id/generate-document", requireAuth, requireRole("super_admin", "program_admin"), async (req, res) => {
  const id = Number(req.params.id);
  const [c] = await db.select().from(candidatesTable).where(eq(candidatesTable.id, id));
  if (!c) { res.status(404).json({ error: "Candidate not found" }); return; }

  const [subForNotes] = await db.select().from(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.email, c.email));
  const cReviewNotes = subForNotes?.reviewNotes ?? "";
  const specialization = cReviewNotes.includes("Allocated to ") 
    ? cReviewNotes.replace("Allocated to ", "").split(" [")[0] 
    : "Fellowship";

  const units = await db.select().from(unitsTable);
  const unit = c.unitId ? units.find(u => u.id === c.unitId) : null;
  const unitName = unit?.name || "Sankara Eye Hospital";

  try {
    const [settings] = await db.select().from(emailSettingsTable).limit(1);
    let googleDocId = req.body.templateId; 

    if (googleDocId && !isNaN(Number(googleDocId))) {
       const [tpl] = await db.select().from(documentTemplatesTable).where(eq(documentTemplatesTable.id, Number(googleDocId)));
       if (tpl) googleDocId = tpl.googleDocId;
    }

    if (!googleDocId) googleDocId = settings?.googleDocsTemplateId;

    if (!googleDocId || !settings?.googleServiceAccountJson) {
      return res.status(400).json({ error: "No document template configured." });
    }

    const replacements: Record<string, string> = {
      letter_date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
      name: c.fullName,
      address: c.address || "",
      interview_date: req.body.interview_date || "—",
      specialization: specialization,
      unit: unitName,
      duration: req.body.duration || "24 Months",
      start_date: req.body.start_date || "—",
      reporting_date: req.body.reporting_date || "—",
      induction_dates: req.body.induction_dates || "—",
      stipend: String(req.body.stipend || "0"),
      stipend_words: req.body.stipend_words || "Zero",
      reporting_doctor: req.body.reporting_doctor || "the Chief Medical Officer",
      signing_authority: req.body.signing_authority || "Director",
      ...(req.body.custom_fields || {})
    };

    const pdfBuffer = await processGoogleDocTemplate({
      templateId: googleDocId,
      serviceAccountJson: settings.googleServiceAccountJson,
      replacements
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=Offer_${c.candidateCode}.pdf`);
    res.send(pdfBuffer);
  } catch (e: any) {
    console.error("[doc-gen] failed", e);
    res.status(500).json({ error: e.message || "Failed to generate document." });
  }
});

// GET /candidates/:id/summary-pdf — Full Summary Report
router.get("/candidates/:id/summary-pdf", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [c] = await db.select().from(candidatesTable).where(eq(candidatesTable.id, id));
    if (!c) { res.status(404).json({ error: "Candidate not found" }); return; }

    const full = await fullCandidate(c);
    const [sub] = await db.select().from(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.email, c.email));
    
    // Get Batch info
    const [bc] = await db.select().from(batchCandidatesTable).where(eq(batchCandidatesTable.candidateId, c.id));
    let batch = null;
    if (bc) {
      [batch] = await db.select().from(batchesTable).where(eq(batchesTable.id, bc.batchId));
    }

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `Dossier_${c.fullName.replace(/\s+/g, '_')}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=${filename}`);
    doc.pipe(res);

    const colors = {
      primary: '#0f172a',
      secondary: '#475569',
      accent: '#f97316', // Orange
      muted: '#94a3b8',
      border: '#e2e8f0',
      bgOrange: '#fff7ed'
    };

    // --- Background Accents ---
    doc.save();
    doc.fillColor(colors.bgOrange).opacity(0.1);
    doc.circle(550, 50, 150).fill();
    doc.circle(50, 750, 100).fill();
    doc.restore();

    // --- Header ---
    const logoPath = path.join(process.cwd(), 'artifacts', 'fellowship-exam', 'src', 'assets', 'seh_sav_logo_1777703794142.jpg');
    try {
      doc.image(logoPath, 50, 45, { width: 120 });
    } catch (e) {
      doc.fillColor(colors.accent).font('Helvetica-Bold').fontSize(16).text("SANKARA ACADEMY OF VISION", 50, 50);
    }

    doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(18).text("CANDIDATE DOSSIER", 350, 50, { align: 'right' });
    doc.fillColor(colors.secondary).font('Helvetica').fontSize(10).text(`Protocol ID: ${c.candidateCode}`, 350, 75, { align: 'right' });

    // --- Photo ---
    const photoUrl = sub?.photoUrl;
    if (photoUrl && photoUrl.startsWith("/objects/")) {
      const localPath = path.join(process.cwd(), "uploads", photoUrl.replace("/objects/", ""));
      try {
        doc.image(localPath, 460, 110, { width: 90, height: 110 });
        doc.rect(460, 110, 90, 110).strokeColor(colors.border).lineWidth(1).stroke();
      } catch (e) {
        // Skip if photo file missing
      }
    }

    doc.moveDown(3);

    // --- Section: Primary Profile ---
    doc.rect(50, doc.y, 500, 30).fill(colors.bgOrange);
    doc.fillColor(colors.accent).font('Helvetica-Bold').fontSize(12).text("ACADEMIC IDENTITY & PROFILE", 65, doc.y - 22);
    doc.moveDown(0.5);

    const leftCol = 70;
    const rightCol = 320;
    let currY = doc.y;

    const renderField = (label: string, value: any, x: number, y: number) => {
      doc.fillColor(colors.muted).font('Helvetica-Bold').fontSize(8).text(label.toUpperCase(), x, y);
      doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(11).text(String(value || "—"), x, y + 12);
    };

    renderField("Full Name", full.fullName, leftCol, currY);
    renderField("Contact Identity", full.email, rightCol, currY);
    currY += 40;
    renderField("Mobile Registry", full.phone, leftCol, currY);
    renderField("Academic Year", batch?.name || "JULY 2026 CYCLE", rightCol, currY);
    currY += 40;
    renderField("Clinical Segment", (sub?.reviewNotes ?? "").replace("Allocated to ", "") || "Fellowship Track", leftCol, currY);
    renderField("Reporting Unit", full.unitName || "Pending Allocation", rightCol, currY);
    doc.moveDown(4);

    // --- Section: Academic & Professional Credentials ---
    doc.rect(50, doc.y, 500, 20).fill(colors.bgOrange);
    doc.fillColor(colors.accent).font('Helvetica-Bold').fontSize(10).text("CLINICAL & SURGICAL PEDIGREE", 65, doc.y - 15);
    doc.moveDown(0.5);

    currY = doc.y;
    renderField("Degree / Qualification", sub?.degree || c.qualification, leftCol, currY);
    renderField("Medical College", sub?.medicalCollege || c.collegeName, rightCol, currY);
    currY += 40;
    renderField("Medical Council No.", sub?.medicalCouncilNumber, leftCol, currY);
    renderField("Surgical Experience", sub?.surgicalExperience || "Standard Residency", rightCol, currY);
    currY += 40;
    renderField("Total Surgeries", sub?.totalSurgeries, leftCol, currY);
    renderField("Research / Publications", (sub?.publications ? "PRESENT" : "NONE LISTED"), rightCol, currY);
    doc.moveDown(5);

    // --- Section: Merit Marksheet ---
    doc.rect(50, doc.y, 500, 25).fill(colors.primary);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(10).text("MERIT PERFORMANCE MATRIX", 65, doc.y - 18);
    doc.moveDown(1);

    const marksTableY = doc.y;
    doc.fillColor(colors.muted).font('Helvetica-Bold').fontSize(9);
    doc.text("EVALUATION STAGE", 70, marksTableY);
    doc.text("MAXIMUM", 350, marksTableY);
    doc.text("OBTAINED", 450, marksTableY);
    doc.moveDown(0.5);
    doc.strokeColor(colors.border).lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.5);

    const renderMarkRow = (label: string, max: number, obtained: any) => {
      const y = doc.y;
      doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(10).text(label, 70, y);
      doc.fillColor(colors.secondary).font('Helvetica').fontSize(10).text(String(max), 350, y);
      doc.fillColor(colors.accent).font('Helvetica-Bold').fontSize(11).text(obtained != null ? Number(obtained).toFixed(2) : "—", 450, y);
      doc.moveDown(0.8);
      doc.strokeColor(colors.border).lineWidth(0.5).moveTo(70, doc.y).lineTo(530, doc.y).stroke();
      doc.moveDown(0.5);
    };

    renderMarkRow("MCQ Assessment", batch?.mcqTotalMarks || 50, full.mcqScore);
    renderMarkRow("Psychometry Profile", batch?.psychometricTotalMarks || 50, full.psychometricScore);
    renderMarkRow("Clinical Interview", batch?.interviewTotalMarks || 100, full.interviewScore);
    
    doc.moveDown(1);
    doc.rect(400, doc.y, 130, 30).fill(colors.bgOrange);
    doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(10).text("AGGREGATE", 410, doc.y - 20);
    doc.fillColor(colors.accent).font('Helvetica-Bold').fontSize(14).text(full.totalScore != null ? full.totalScore.toFixed(2) : "—", 480, doc.y - 23);

    doc.moveDown(4);

    // --- Section: Preferences & LORs ---
    doc.fillColor(colors.secondary).font('Helvetica-Bold').fontSize(11).text("STRATEGIC PREFERENCES", 50, doc.y);
    doc.moveDown(0.5);
    
    if (full.preferences.length > 0) {
      full.preferences.forEach((p: any, i: number) => {
        doc.fillColor(colors.primary).font('Helvetica').fontSize(10).text(`${i+1}. ${p.specialityName}`, { indent: 20 });
      });
    } else {
      doc.fillColor(colors.muted).font('Helvetica').fontSize(10).text("Institutional Choice", { indent: 20 });
    }

    doc.moveDown(2);
    doc.fillColor(colors.secondary).font('Helvetica-Bold').fontSize(11).text("PROFESSIONAL REFERENCES (LOR)", 50, doc.y);
    doc.moveDown(0.5);
    
    const renderLOR = (num: number, name: string, contact: string, email: string, status: boolean) => {
      doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(9).text(`LOR ${num}: ${name || "—"}`, { indent: 20 });
      doc.fillColor(colors.secondary).font('Helvetica').fontSize(8).text(`Contact: ${contact || "—"} | Email: ${email || "—"}`, { indent: 35 });
      doc.fillColor(status ? '#10b981' : colors.muted).font('Helvetica-Bold').fontSize(8).text(`STATUS: ${status ? "PROCESSED & VERIFIED" : "PENDING"}`, { indent: 35 });
      doc.moveDown(0.5);
    };

    renderLOR(1, sub?.lor1RefName || "", sub?.lor1RefContact || "", sub?.lor1RefEmail || "", !!sub?.lor1Url);
    renderLOR(2, sub?.lor2RefName || "", sub?.lor2RefContact || "", sub?.lor2RefEmail || "", !!sub?.lor2Url);

    // --- Footer ---
    const bottom = 750;
    doc.strokeColor(colors.accent).lineWidth(2).moveTo(50, bottom).lineTo(550, bottom).stroke();
    doc.fillColor(colors.muted).font('Helvetica').fontSize(8).text("CONFIDENTIAL DOCUMENT - FOR INTERNAL USE ONLY", 50, bottom + 10);
    doc.text("SANKARA ACADEMY OF VISION - FELLOWSHIP ADMISSIONS HUB", 50, bottom + 22);
    doc.text(`Generated on ${new Date().toLocaleString()}`, 350, bottom + 10, { align: 'right' });

    doc.end();
  } catch (e: any) {
    console.error("[summary-pdf] failed", e);
    res.status(500).json({ error: e.message || "Failed to generate summary PDF." });
  }
});

export default router;
