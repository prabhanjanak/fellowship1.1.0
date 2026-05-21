import { Router } from "express";
import { db, applicationSubmissionsTable, candidatesTable, usersTable, interviewScoresTable, allocationsTable, programsTable, unitsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import * as XLSX from "xlsx";
import { formatDOBToStandard } from "../lib/utils";

const router: Router = Router();

router.get("/reports/cycle-report", requireAuth, requireRole("super_admin", "program_admin", "central_exam_coordinator"), async (req, res) => {
  try {
    // 1. Fetch All Data
    const submissions = await db.select().from(applicationSubmissionsTable);
    const candidates = await db.select().from(candidatesTable);
    const users = await db.select().from(usersTable);
    const scores = await db.select().from(interviewScoresTable);
    const allocations = await db.select().from(allocationsTable);
    const programs = await db.select().from(programsTable);
    const units = await db.select().from(unitsTable);

    // 2. Prepare Detailed Financial & Admissions Sheet
    const financialAdmissionsData = submissions.map(s => {
      const cand = candidates.find(c => c.email === s.email);
      const prog = programs.find(p => p.id === s.formId);
      const unit = cand?.unitId ? units.find(u => u.id === cand.unitId) : null;
      
      return {
        "Student Name": s.fullName,
        "Email ID": s.email,
        "Phone Number": s.phone,
        "Program Applied": prog?.name || "Fellowship",
        "Application Status": s.status.toUpperCase(),
        "Payment Status": s.paymentId ? "SUCCESS" : "PENDING",
        "Transaction ID / Payment ID": s.paymentId || "N/A",
        "Amount Received": s.paymentId ? "₹5000.00" : "₹0.00",
        "Payment Mode": "Online (Razorpay)",
        "Submission Date": s.submittedAt ? new Date(s.submittedAt).toLocaleDateString("en-IN") : "N/A",
        "Submission Time": s.submittedAt ? new Date(s.submittedAt).toLocaleTimeString("en-IN") : "N/A",
        "Approval Status": s.status === "approved" ? "APPROVED" : "PENDING REVIEW",
        "Allotted Center": unit?.name || "NOT ALLOTTED"
      };
    });

    // 3. Prepare Staff Activity & Evaluation Sheet
    const staffActivityData = scores.map(sc => {
      const doc = users.find(u => u.id === sc.doctorId);
      const cand = candidates.find(c => c.id === sc.candidateId);
      
      return {
        "Staff/Doctor Name": doc?.fullName || "Unknown",
        "Staff Role": doc?.role?.replace("_", " ").toUpperCase() || "N/A",
        "Candidate Evaluated": cand?.fullName || "Unknown",
        "Candidate ID": cand?.candidateCode || "N/A",
        "Score Awarded": sc.score,
        "Maximum Score": 100,
        "Staff Remarks": sc.remarks || "No remarks provided",
        "Activity Timestamp": new Date(sc.submittedAt).toLocaleString("en-IN")
      };
    });

    // 4. Prepare Summary Sheet
    const totalPayments = submissions.filter(s => !!s.paymentId).length * 5000;
    const summaryData = [
      { "Metric": "Total Applications Received", "Value": submissions.length },
      { "Metric": "Total Payments Confirmed", "Value": submissions.filter(s => !!s.paymentId).length },
      { "Metric": "Total Revenue Collected", "Value": `₹${totalPayments.toLocaleString("en-IN")}` },
      { "Metric": "Total Candidates Approved", "Value": candidates.length },
      { "Metric": "Total Interviews Conducted", "Value": scores.length },
      { "Metric": "Total Centers (Units) Involved", "Value": units.length },
      { "Metric": "Active Staff Members", "Value": users.length },
      { "Metric": "Report Generation Date", "Value": new Date().toLocaleString("en-IN") }
    ];

    // 5. Create Workbook
    const wb = XLSX.utils.book_new();

    const addAutoFilter = (ws: XLSX.WorkSheet) => {
      if (!ws["!ref"]) return;
      try {
        const range = XLSX.utils.decode_range(ws["!ref"]);
        ws["!autofilter"] = {
          ref: XLSX.utils.encode_range({
            s: { c: 0, r: 0 },
            e: { c: range.e.c, r: range.e.r }
          })
        };
      } catch (err) {
        console.error("Failed to add autofilter:", err);
      }
    };
    
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    wsSummary["!cols"] = [{ wch: 35 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, "Cycle Summary Overview");

    const wsFinance = XLSX.utils.json_to_sheet(financialAdmissionsData);
    wsFinance["!cols"] = financialAdmissionsData[0] ? Object.keys(financialAdmissionsData[0]).map(() => ({ wch: 25 })) : [];
    addAutoFilter(wsFinance);
    XLSX.utils.book_append_sheet(wb, wsFinance, "Student Payments & Status");

    const wsStaff = XLSX.utils.json_to_sheet(staffActivityData);
    wsStaff["!cols"] = staffActivityData[0] ? Object.keys(staffActivityData[0]).map(() => ({ wch: 25 })) : [];
    addAutoFilter(wsStaff);
    XLSX.utils.book_append_sheet(wb, wsStaff, "Staff Usage & Appraisals");

    // 6. Write to Buffer
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    // 7. Send Response
    const date = new Date().toISOString().split('T')[0];
    res.setHeader("Content-Disposition", `attachment; filename=SAV_Full_Cycle_Report_${date}.xlsx`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);

  } catch (error: any) {
    console.error("[cycle-report] error:", error);
    res.status(500).json({ error: "Failed to generate cycle report", details: error.message });
  }
});

router.get("/reports/daily-report", requireAuth, requireRole("super_admin", "program_admin", "central_exam_coordinator"), async (req, res) => {
  try {
    // 1. Fetch All Data
    const submissions = await db.select().from(applicationSubmissionsTable);
    const candidates = await db.select().from(candidatesTable);
    const users = await db.select().from(usersTable);
    const scores = await db.select().from(interviewScoresTable);
    const allocations = await db.select().from(allocationsTable);
    const programs = await db.select().from(programsTable);
    const units = await db.select().from(unitsTable);

    const todayStr = new Date().toDateString();
    const isToday = (dateVal: any) => {
      if (!dateVal) return false;
      return new Date(dateVal).toDateString() === todayStr;
    };

    // Filter records for today
    const submissionsToday = submissions.filter(s => isToday(s.submittedAt));
    const candidatesToday = candidates.filter(c => isToday(c.createdAt));
    const scoresToday = scores.filter(sc => isToday(sc.submittedAt));

    // 2. Prepare Detailed Financial & Admissions Sheet
    const financialAdmissionsData = submissionsToday.map(s => {
      const cand = candidates.find(c => c.email === s.email);
      const prog = programs.find(p => p.id === s.formId);
      const unit = cand?.unitId ? units.find(u => u.id === cand.unitId) : null;
      
      const specs = s.specialization ? JSON.parse(s.specialization) : [];
      const specCount = Array.isArray(specs) ? specs.length : 1;
      const expectedAmount = 2750 * specCount;

      return {
        "Student Name": s.fullName,
        "Email ID": s.email,
        "Phone Number": s.phone,
        "Program Applied": prog?.name || "Fellowship",
        "Application Status": s.status.toUpperCase(),
        "Payment Status": s.paymentId || s.paidAmount ? "SUCCESS" : "PENDING",
        "Transaction ID / Payment ID": s.paymentId || "N/A",
        "Amount Received": s.paidAmount 
          ? `₹${(s.paidAmount > 100000 ? s.paidAmount / 100 : s.paidAmount).toLocaleString("en-IN")}`
          : `₹${expectedAmount.toLocaleString("en-IN")}`,
        "Payment Mode": s.paymentMode || "Online (Razorpay)",
        "Submission Date": s.submittedAt ? new Date(s.submittedAt).toLocaleDateString("en-IN") : "N/A",
        "Submission Time": s.submittedAt ? new Date(s.submittedAt).toLocaleTimeString("en-IN") : "N/A",
        "Approval Status": s.status === "approved" ? "APPROVED" : "PENDING REVIEW",
        "Allotted Center": unit?.name || "NOT ALLOTTED"
      };
    });

    // 3. Prepare Enrolled Candidates Sheet
    const candidatesData = candidatesToday.map(c => {
      const unit = c.unitId ? units.find(u => u.id === c.unitId) : null;
      return {
        "Candidate ID": c.candidateCode,
        "Full Name": c.fullName,
        "Email": c.email,
        "Phone": c.phone || "N/A",
        "DOB": formatDOBToStandard(c.dateOfBirth),
        "Gender": c.gender || "N/A",
        "Qualification": c.qualification || "N/A",
        "College": c.collegeName || "N/A",
        "Status": c.status.toUpperCase(),
        "Allotted Unit": unit?.name || "N/A",
        "Created At": new Date(c.createdAt).toLocaleString("en-IN")
      };
    });

    // 4. Prepare Staff Activity & Evaluation Sheet
    const staffActivityData = scoresToday.map(sc => {
      const doc = users.find(u => u.id === sc.doctorId);
      const cand = candidates.find(c => c.id === sc.candidateId);
      
      return {
        "Staff/Doctor Name": doc?.fullName || "Unknown",
        "Staff Role": doc?.role?.replace("_", " ").toUpperCase() || "N/A",
        "Candidate Evaluated": cand?.fullName || "Unknown",
        "Candidate ID": cand?.candidateCode || "N/A",
        "Score Awarded": sc.score,
        "Maximum Score": 100,
        "Staff Remarks": sc.remarks || "No remarks provided",
        "Activity Timestamp": new Date(sc.submittedAt).toLocaleString("en-IN")
      };
    });

    // 5. Prepare Summary Sheet
    const totalPayments = submissionsToday.reduce((acc, s) => {
      if (s.paidAmount) {
        const amt = s.paidAmount > 100000 ? s.paidAmount / 100 : s.paidAmount;
        return acc + amt;
      }
      return acc;
    }, 0);

    const summaryData = [
      { "Metric": "Applications Received Today", "Value": submissionsToday.length },
      { "Metric": "Candidates Approved/Registered Today", "Value": candidatesToday.length },
      { "Metric": "Payments Recorded Today", "Value": submissionsToday.filter(s => !!s.paymentId || !!s.paidAmount).length },
      { "Metric": "Total Daily Revenue", "Value": `₹${totalPayments.toLocaleString("en-IN")}` },
      { "Metric": "Interviews Evaluated Today", "Value": scoresToday.length },
      { "Metric": "Report Generation Date", "Value": new Date().toLocaleString("en-IN") }
    ];

    // 6. Create Workbook
    const wb = XLSX.utils.book_new();

    const addAutoFilter = (ws: XLSX.WorkSheet) => {
      if (!ws["!ref"]) return;
      try {
        const range = XLSX.utils.decode_range(ws["!ref"]);
        ws["!autofilter"] = {
          ref: XLSX.utils.encode_range({
            s: { c: 0, r: 0 },
            e: { c: range.e.c, r: range.e.r }
          })
        };
      } catch (err) {
        console.error("Failed to add autofilter:", err);
      }
    };
    
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    wsSummary["!cols"] = [{ wch: 40 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, "Daily Summary");

    const wsFinance = XLSX.utils.json_to_sheet(financialAdmissionsData);
    wsFinance["!cols"] = financialAdmissionsData[0] ? Object.keys(financialAdmissionsData[0]).map(() => ({ wch: 25 })) : [];
    addAutoFilter(wsFinance);
    XLSX.utils.book_append_sheet(wb, wsFinance, "Today's Payments & Status");

    const wsCandidates = XLSX.utils.json_to_sheet(candidatesData);
    wsCandidates["!cols"] = candidatesData[0] ? Object.keys(candidatesData[0]).map(() => ({ wch: 25 })) : [];
    addAutoFilter(wsCandidates);
    XLSX.utils.book_append_sheet(wb, wsCandidates, "Today's Enrolled Candidates");

    const wsStaff = XLSX.utils.json_to_sheet(staffActivityData);
    wsStaff["!cols"] = staffActivityData[0] ? Object.keys(staffActivityData[0]).map(() => ({ wch: 25 })) : [];
    addAutoFilter(wsStaff);
    XLSX.utils.book_append_sheet(wb, wsStaff, "Today's Appraisals");

    // 7. Write to Buffer
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    // 8. Send Response
    const date = new Date().toISOString().split('T')[0];
    res.setHeader("Content-Disposition", `attachment; filename=SAV_Daily_Report_${date}.xlsx`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);

  } catch (error: any) {
    console.error("[daily-report] error:", error);
    res.status(500).json({ error: "Failed to generate daily report", details: error.message });
  }
});

export default router;
