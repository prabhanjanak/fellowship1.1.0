/**
 * Robust specialization parser to handle PostgreSQL array string representation (e.g. '{"Cornea","Phaco Refractive"}'),
 * JSON arrays (e.g. '["Cornea", "Phaco Refractive"]'), and standard comma-separated lists.
 */
export function parseSpecializationString(spec: string | null | undefined): string[] {
  if (!spec) return [];
  let s = spec.trim();
  if (!s) return [];

  // Handle PostgreSQL curly-brace array format: {"Cornea", "Phaco Refractive"}
  if (s.startsWith("{") && s.endsWith("}")) {
    s = s.substring(1, s.length - 1);
    const list: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < s.length; i++) {
      const char = s[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        list.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    if (current.trim() || list.length > 0) {
      list.push(current.trim());
    }
    return list.map(item => {
      let cleaned = item;
      if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        cleaned = cleaned.substring(1, cleaned.length - 1);
      }
      return cleaned.trim();
    }).filter(Boolean);
  }

  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch { /* not JSON */ }
  
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

/**
 * Robust Date of Birth standardizer to format incoming flexible date expressions as DD/MM/YYYY.
 */
export function formatDOBToStandard(dob: string | null | undefined): string {
  if (!dob) return "N/A";
  const s = String(dob).trim();
  if (!s || s.toLowerCase() === "n/a" || s === "0") return "N/A";

  const ymdRegex = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:T.*)?$/;
  const dmyRegex = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/;

  let match = s.match(ymdRegex);
  if (match) {
    const [_, year, month, day] = match;
    return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
  }

  match = s.match(dmyRegex);
  if (match) {
    const [_, day, month, year] = match;
    return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
  }

  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    }
  } catch {
    // ignore
  }

  return s;
}

