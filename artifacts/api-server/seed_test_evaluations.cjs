const pg = require('pg');
const { Pool } = pg;

const pool = new Pool({
  connectionString: "postgresql://postgres:admin@localhost:5432/fellowship_db"
});

async function main() {
  const client = await pool.connect();
  console.log("Connected to Fellowship DB local server successfully!");

  try {
    await client.query("BEGIN");

    // Enable mock_mode automatically so test candidates are displayed
    await client.query("UPDATE global_settings SET value = 'true' WHERE key = 'mock_mode'");
    console.log("Mock Mode auto-toggled to 'true' in global_settings.");

    // 1. Get Specialities from Database
    console.log("Fetching specializations...");
    const specsRes = await client.query("SELECT id, name, code FROM specialities");
    const specialities = specsRes.rows;
    console.log(`Found ${specialities.length} specialities:`, specialities.map(s => s.name));

    // Resolve specific speciality IDs or use fallback
    const glaucomaSpec = specialities.find(s => s.name.toLowerCase().includes('glaucoma')) || specialities[0];
    const retinaSpec = specialities.find(s => s.name.toLowerCase().includes('retina')) || specialities[1];
    const corneaSpec = specialities.find(s => s.name.toLowerCase().includes('cornea')) || specialities[2];

    if (!glaucomaSpec || !retinaSpec) {
      throw new Error("Could not find Glaucoma or Retina specialities in database. Please run migrations/setup first.");
    }

    // 2. Fetch Doctor Users
    const docRes = await client.query("SELECT id, full_name, email FROM users WHERE role = 'doctor' AND active = true");
    const doctors = docRes.rows;
    console.log(`Found ${doctors.length} active doctors:`, doctors.map(d => d.full_name));

    if (doctors.length === 0) {
      console.log("No doctors found in database. Inserting mock doctor users...");
      const mockDocs = [
        { name: "Dr. Vasudha Hariprasad", email: "vasudha.h@fellowship.org" },
        { name: "Dr. Prabhanjan K", email: "prabhanjan.k@fellowship.org" },
        { name: "Dr. Sankara Narayanan", email: "sankara.n@fellowship.org" }
      ];
      for (const md of mockDocs) {
        const insDoc = await client.query(
          "INSERT INTO users (full_name, email, password_hash, role, active, created_at, updated_at) VALUES ($1, $2, '$2b$10$xyz', 'doctor', true, NOW(), NOW()) RETURNING id, full_name, email",
          [md.name, md.email]
        );
        doctors.push(insDoc.rows[0]);
      }
      console.log(`Inserted ${doctors.length} mock doctors!`);
    }

    // 3. Insert or Re-create Mock Candidates
    console.log("Cleaning old mock test data (with email domain '@mocktest.com')...");
    
    // We clean cascading entries first
    await client.query("DELETE FROM interview_scores WHERE candidate_id IN (SELECT id FROM candidates WHERE email LIKE '%@mocktest.com')");
    await client.query("DELETE FROM panel_queue WHERE candidate_id IN (SELECT id FROM candidates WHERE email LIKE '%@mocktest.com')");
    await client.query("DELETE FROM doctor_assignments WHERE candidate_id IN (SELECT id FROM candidates WHERE email LIKE '%@mocktest.com')");
    await client.query("DELETE FROM batch_candidates WHERE candidate_id IN (SELECT id FROM candidates WHERE email LIKE '%@mocktest.com')");
    await client.query("DELETE FROM candidates WHERE email LIKE '%@mocktest.com'");
    await client.query("DELETE FROM application_submissions WHERE email LIKE '%@mocktest.com'");

    const mockCandidates = [
      {
        name: "Aravind Swaminathan",
        email: "aravind.s@mocktest.com",
        code: "SAV-GL-101",
        phone: "9876543210",
        college: "LV Prasad Eye Institute",
        qualification: "MS Ophthalmology",
        pgQual: "MS Ophthalmology, FICO",
        specId: glaucomaSpec.id,
        specName: glaucomaSpec.name,
        mcq: 44.5,
        psych: 8.5,
        prefCenters: ["Glaucoma: Coimbatore", "Cornea: Bengaluru"]
      },
      {
        name: "Meera Krishnan",
        email: "meera.k@mocktest.com",
        code: "SAV-RT-102",
        phone: "9876543211",
        college: "Aravind Eye Hospital",
        qualification: "DNB Ophthalmology",
        pgQual: "DNB Ophthalmology, MNAMS",
        specId: retinaSpec.id,
        specName: retinaSpec.name,
        mcq: 41.0,
        psych: 9.0,
        prefCenters: ["Retina: Bengaluru", "Glaucoma: Coimbatore"]
      },
      {
        name: "Rohan Deshmukh",
        email: "rohan.d@mocktest.com",
        code: "SAV-CO-103",
        phone: "9876543212",
        college: "Maulana Azad Medical College",
        qualification: "MS Ophthalmology",
        pgQual: "MS Ophthalmology",
        specId: corneaSpec ? corneaSpec.id : glaucomaSpec.id,
        specName: corneaSpec ? corneaSpec.name : glaucomaSpec.name,
        mcq: 46.5,
        psych: 7.5,
        prefCenters: ["Cornea: Coimbatore", "Retina: Chennai"]
      },
      {
        name: "Nisha Patel",
        email: "nisha.p@mocktest.com",
        code: "SAV-GL-104",
        phone: "9876543213",
        college: "Sankara Eye Hospital, Shimoga",
        qualification: "DNB Ophthalmology",
        pgQual: "DNB Ophthalmology",
        specId: glaucomaSpec.id,
        specName: glaucomaSpec.name,
        mcq: 38.0,
        psych: 8.0,
        prefCenters: ["Glaucoma: Chennai"]
      },
      {
        name: "Siddharth Verma",
        email: "siddharth.v@mocktest.com",
        code: "SAV-RT-105",
        phone: "9876543214",
        college: "Grant Medical College, Mumbai",
        qualification: "MS Ophthalmology",
        pgQual: "MS Ophthalmology, FRCS Part 1",
        specId: retinaSpec.id,
        specName: retinaSpec.name,
        mcq: 43.5,
        psych: 9.5,
        prefCenters: ["Retina: Coimbatore"]
      },
      // --- Unassigned Candidates for Manual Testing ---
      {
        name: "Karthik Ramasamy",
        email: "karthik.r@mocktest.com",
        code: "SAV-GL-106",
        phone: "9876543215",
        college: "Madras Medical College, Chennai",
        qualification: "MS Ophthalmology",
        pgQual: "MS Ophthalmology",
        specId: glaucomaSpec.id,
        specName: glaucomaSpec.name,
        mcq: 45.0,
        psych: 8.0,
        prefCenters: ["Glaucoma: Coimbatore"],
        isUnassigned: true
      },
      {
        name: "Divya Nair",
        email: "divya.n@mocktest.com",
        code: "SAV-RT-107",
        phone: "9876543216",
        college: "Amrita School of Medicine, Kochi",
        qualification: "DNB Ophthalmology",
        pgQual: "DNB Ophthalmology",
        specId: retinaSpec.id,
        specName: retinaSpec.name,
        mcq: 42.5,
        psych: 7.0,
        prefCenters: ["Retina: Bengaluru"],
        isUnassigned: true
      },
      {
        name: "Vijay Kumar",
        email: "vijay.k@mocktest.com",
        code: "SAV-GL-108",
        phone: "9876543217",
        college: " Stanley Medical College, Chennai",
        qualification: "MS Ophthalmology",
        pgQual: "MS Ophthalmology",
        specId: glaucomaSpec.id,
        specName: glaucomaSpec.name,
        mcq: 41.5,
        psych: 8.5,
        prefCenters: ["Glaucoma: Chennai"],
        isUnassigned: true
      },
      {
        name: "Priya Sharma",
        email: "priya.s@mocktest.com",
        code: "SAV-RT-109",
        phone: "9876543218",
        college: "Christian Medical College, Vellore",
        qualification: "MS Ophthalmology",
        pgQual: "MS Ophthalmology",
        specId: retinaSpec.id,
        specName: retinaSpec.name,
        mcq: 44.0,
        psych: 9.0,
        prefCenters: ["Retina: Coimbatore"],
        isUnassigned: true
      }
    ];

    console.log("Inserting mock candidates and application submissions...");
    const candidatesDb = [];
    for (const mc of mockCandidates) {
      // a. Insert submission
      const subIns = await client.query(`
        INSERT INTO application_submissions 
          (form_id, full_name, email, phone, specialization, center_preference, status, form_data, submitted_at, is_mock, medical_college, pg_qualifications)
        VALUES 
          (18, $1, $2, $3, $4, $5, 'approved', '{}', NOW(), true, $6, $7)
        RETURNING id
      `, [
        mc.name, 
        mc.email, 
        mc.phone, 
        JSON.stringify([mc.specName]), 
        JSON.stringify(mc.prefCenters), 
        mc.college, 
        mc.pgQual
      ]);
      const subId = subIns.rows[0].id;

      // b. Insert candidate
      const candIns = await client.query(`
        INSERT INTO candidates 
          (full_name, candidate_code, email, phone, status, mcq_score, psychometric_score, is_mock, qualification, college_name, created_at, updated_at)
        VALUES 
          ($1, $2, $3, $4, 'approved', $5, $6, true, $7, $8, NOW(), NOW())
        RETURNING id, full_name, candidate_code, email
      `, [
        mc.name, 
        mc.code, 
        mc.email, 
        mc.phone, 
        mc.mcq, 
        mc.psych, 
        mc.qualification, 
        mc.college
      ]);
      const cand = candIns.rows[0];
      cand.submissionId = subId;
      cand.specId = mc.specId;
      cand.specName = mc.specName;
      cand.mcq = mc.mcq;
      cand.psych = mc.psych;
      cand.isUnassigned = !!mc.isUnassigned;
      candidatesDb.push(cand);
    }
    console.log(`Successfully created ${candidatesDb.length} test candidates!`);

    // 4. Create Mock Panels
    console.log("Setting up mock panels...");
    
    // Deactivate previous active mock panels to avoid cluttering
    await client.query("UPDATE interview_panels SET is_active = false WHERE name LIKE '%Test%'");
    
    const panel1Ins = await client.query(`
      INSERT INTO interview_panels (name, room_number, is_active, speciality_id, is_mind_matter, is_mock, created_at)
      VALUES ('Test Glaucoma Panel', 'Room A-102', true, $1, false, true, NOW())
      RETURNING id
    `, [glaucomaSpec.id]);
    const glaucomaPanelId = panel1Ins.rows[0].id;

    const panel2Ins = await client.query(`
      INSERT INTO interview_panels (name, room_number, is_active, speciality_id, is_mind_matter, is_mock, created_at)
      VALUES ('Test Retina Panel', 'Room B-105', true, $1, false, true, NOW())
      RETURNING id
    `, [retinaSpec.id]);
    const retinaPanelId = panel2Ins.rows[0].id;

    const panel3Ins = await client.query(`
      INSERT INTO interview_panels (name, room_number, is_active, speciality_id, is_mind_matter, is_mock, created_at)
      VALUES ('Test Mind Matter Station', 'Counseling Room 2', true, null, true, true, NOW())
      RETURNING id
    `, []);
    const mindMatterPanelId = panel3Ins.rows[0].id;

    console.log("Mock panels created successfully! Mapped IDs:", { glaucomaPanelId, retinaPanelId, mindMatterPanelId });

    // 5. Assign Doctor Members to Panels
    console.log("Assigning doctors to panels...");
    // Assign Doctor 1 & 2 to Glaucoma panel
    if (doctors[0]) {
      await client.query("INSERT INTO interview_panel_members (panel_id, doctor_id, is_main) VALUES ($1, $2, true)", [glaucomaPanelId, doctors[0].id]);
      console.log(`Assigned doctor ${doctors[0].full_name} to Glaucoma Panel.`);
    }
    if (doctors[1]) {
      await client.query("INSERT INTO interview_panel_members (panel_id, doctor_id, is_main) VALUES ($1, $2, false)", [glaucomaPanelId, doctors[1].id]);
      console.log(`Assigned doctor ${doctors[1].full_name} to Glaucoma Panel.`);
    }
    // Assign Doctor 3 to Retina panel
    const doc3 = doctors[2] || doctors[0];
    if (doc3) {
      await client.query("INSERT INTO interview_panel_members (panel_id, doctor_id, is_main) VALUES ($1, $2, true)", [retinaPanelId, doc3.id]);
      console.log(`Assigned doctor ${doc3.full_name} to Retina Panel.`);
    }
    // Assign Doctor 2 to Mind Matter panel
    const docForMM = doctors[1] || doctors[0];
    if (docForMM) {
      await client.query("INSERT INTO interview_panel_members (panel_id, doctor_id, is_main) VALUES ($1, $2, true)", [mindMatterPanelId, docForMM.id]);
      console.log(`Assigned doctor ${docForMM.full_name} to Mind Matter Panel.`);
    }

    // 6. Insert Panel Queues & Mock Evaluations
    console.log("Queueing candidates and inserting mock grades...");
    
    // Filter candidates by spec matching panel (excluding unassigned ones for manual testing)
    const glaucomaCands = candidatesDb.filter(c => c.specId === glaucomaSpec.id && !c.isUnassigned);
    const retinaCands = candidatesDb.filter(c => c.specId === retinaSpec.id && !c.isUnassigned);

    // a. Glaucoma panel queue
    let queuePos = 1;
    for (const c of glaucomaCands) {
      const status = queuePos === 1 ? 'in_progress' : 'waiting';
      await client.query(`
        INSERT INTO panel_queue (panel_id, candidate_id, queue_position, status, called_at, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
      `, [glaucomaPanelId, c.id, queuePos, status, status === 'in_progress' ? new Date() : null]);
      
      // Let's create doctor assignments for panel doctors
      if (doctors[0]) {
        await client.query("INSERT INTO doctor_assignments (doctor_id, candidate_id, status, speciality_id, scheduled_at) VALUES ($1, $2, $3, $4, NOW())", 
          [doctors[0].id, c.id, status === 'in_progress' ? 'pending' : 'pending', glaucomaSpec.id]
        );
      }
      if (doctors[1]) {
        await client.query("INSERT INTO doctor_assignments (doctor_id, candidate_id, status, speciality_id, scheduled_at) VALUES ($1, $2, $3, $4, NOW())", 
          [doctors[1].id, c.id, status === 'in_progress' ? 'pending' : 'pending', glaucomaSpec.id]
        );
      }

      // If they are queue position 2, let's pre-grade them to demonstrate average marks calculation on marksheet!
      if (queuePos > 1) {
        if (doctors[0]) {
          await client.query("INSERT INTO interview_scores (candidate_id, doctor_id, speciality_id, score, remarks, submitted_at) VALUES ($1, $2, $3, 44, 'Very knowledgeable in intraocular pressure dynamics', NOW())",
            [c.id, doctors[0].id, glaucomaSpec.id]
          );
        }
        if (doctors[1]) {
          await client.query("INSERT INTO interview_scores (candidate_id, doctor_id, speciality_id, score, remarks, submitted_at) VALUES ($1, $2, $3, 48, 'Excellent clinical reasoning skills. Ideal candidate.', NOW())",
            [c.id, doctors[1].id, glaucomaSpec.id]
          );
        }
        // Mark their queue status as completed (done) since both graded
        await client.query("UPDATE panel_queue SET status = 'done' WHERE panel_id = $1 AND candidate_id = $2", [glaucomaPanelId, c.id]);
      }
      queuePos++;
    }

    // b. Retina panel queue
    queuePos = 1;
    for (const c of retinaCands) {
      const status = queuePos === 1 ? 'in_progress' : 'waiting';
      await client.query(`
        INSERT INTO panel_queue (panel_id, candidate_id, queue_position, status, called_at, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
      `, [retinaPanelId, c.id, queuePos, status, status === 'in_progress' ? new Date() : null]);

      if (doc3) {
        await client.query("INSERT INTO doctor_assignments (doctor_id, candidate_id, status, speciality_id, scheduled_at) VALUES ($1, $2, $3, $4, NOW())", 
          [doc3.id, c.id, 'pending', retinaSpec.id]
        );
      }

      // Pre-grade the second candidate
      if (queuePos > 1) {
        if (doc3) {
          await client.query("INSERT INTO interview_scores (candidate_id, doctor_id, speciality_id, score, remarks, submitted_at) VALUES ($1, $2, $3, 42, 'Good visual acuity evaluation methods.', NOW())",
            [c.id, doc3.id, retinaSpec.id]
          );
        }
        await client.query("UPDATE panel_queue SET status = 'done' WHERE panel_id = $1 AND candidate_id = $2", [retinaPanelId, c.id]);
      }
      queuePos++;
    }

    // c. Mind Matter panel queue (receives ALL glaucoma and retina candidates, excluding unassigned ones)
    queuePos = 1;
    for (const c of candidatesDb.filter(x => !x.isUnassigned)) {
      const status = queuePos === 1 ? 'in_progress' : 'waiting';
      await client.query(`
        INSERT INTO panel_queue (panel_id, candidate_id, queue_position, status, called_at, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
      `, [mindMatterPanelId, c.id, queuePos, status, status === 'in_progress' ? new Date() : null]);

      if (docForMM) {
        await client.query("INSERT INTO doctor_assignments (doctor_id, candidate_id, status, speciality_id, scheduled_at) VALUES ($1, $2, $3, null, NOW())", 
          [docForMM.id, c.id, 'pending']
        );
      }

      // Pre-grade even positions
      if (queuePos % 2 === 0) {
        if (docForMM) {
          await client.query("INSERT INTO interview_scores (candidate_id, doctor_id, speciality_id, score, remarks, submitted_at) VALUES ($1, $2, null, 45, 'Strong empathetic attributes.', NOW())",
            [c.id, docForMM.id]
          );
        }
        await client.query("UPDATE panel_queue SET status = 'done' WHERE panel_id = $1 AND candidate_id = $2", [mindMatterPanelId, c.id]);
      }
      queuePos++;
    }

    console.log("Populated waitlists and scores successfully!");

    // 7. Insert mock values into batch_candidates for strict checks
    console.log("Linking candidates to batch parameters...");
    const activeBatchRes = await client.query("SELECT id FROM batches LIMIT 1");
    const activeBatchId = activeBatchRes.rows[0]?.id;
    if (activeBatchId) {
      for (const c of candidatesDb) {
        await client.query(`
          INSERT INTO batch_candidates (batch_id, candidate_id, speciality_id, mcq_score, psychometric_score, is_allocated)
          VALUES ($1, $2, $3, $4, $5, false)
        `, [activeBatchId, c.id, c.specId, c.mcq, c.psych]);
      }
      console.log(`Successfully mapped all candidates to Batch ID: ${activeBatchId}`);
    }

    await client.query("COMMIT");
    console.log("\n🚀 TEST DATA GENERATION COMPLETE SUCCESSFULLY!");
    console.log("You can now open the app, assign panels, view live boards, and check consolidated marksheets with full aggregates out of 110 marks!");

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Fatal error during seeding: ", error);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
