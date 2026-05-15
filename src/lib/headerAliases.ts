/**
 * Shared header-alias map. Used by both the upload parser (to map Excel
 * columns to logical fields) and the data table (to hide duplicate raw
 * columns whose headers are already shown as mapped columns).
 */
export const FIELD_ALIASES: Record<string, string[]> = {
  expense_number: [
    "expense#", "expense #", "expense no", "expense no.", "expense number",
    "expense num", "expensenumber", "expense_number",
    "exp#", "exp #", "exp no", "exp number",
  ],
  employee:       ["employee", "employee name", "emp name", "emp", "user", "user name", "name"],
  user_id_field:  ["user id", "userid", "user_id", "employee id", "emp id", "empid"],
  user_location:  ["user location", "userlocation", "user_location", "location", "user loc"],
  approved_by:    ["approved by", "approvedby", "approved_by", "approver", "approver name", "approved name"],
  date_submitted: ["date submitted", "submitted date", "submission date", "date", "submitted"],
  category:       ["category", "expense category", "type"],
  amount:         ["amount", "branch amount", "total amount", "expense amount"],
  currency:       ["currency", "branch currency", "ccy"],
  branch:         ["branch", "branch name", "office"],
  project:        ["project", "project name", "project code"],
  merchant:       ["merchant", "vendor", "supplier", "merchant name"],
};

export const REQUIRED_FIELDS = ["expense_number"] as const;

/** Normalize a header for comparison: lowercase, drop all non-alphanumerics. */
export const normHeader = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** All known aliases, normalized — used to hide duplicates from "Excel extras". */
export const ALL_KNOWN_ALIASES_NORM: Set<string> = new Set(
  Object.values(FIELD_ALIASES).flat().map(normHeader),
);

export interface HeaderMap {
  fieldToHeader: Map<string, string>;
  headerToField: Map<string, string>;
  unmapped: string[];
  missingRequired: string[];
}

/**
 * Build mapping from Excel headers (in order) to logical fields.
 * If multiple Excel columns map to the same field, the FIRST one with a
 * non-empty value wins per row (handled at read time via `getStrSmart`).
 */
export const buildHeaderMap = (excelHeaders: string[]): HeaderMap => {
  const normAliasToField = new Map<string, string>();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) normAliasToField.set(normHeader(alias), field);
  }
  const fieldToHeader = new Map<string, string>();
  const headerToField = new Map<string, string>();
  const unmapped: string[] = [];
  for (const h of excelHeaders) {
    const field = normAliasToField.get(normHeader(h));
    if (field && !fieldToHeader.has(field)) {
      fieldToHeader.set(field, h);
      headerToField.set(h, field);
    } else if (field) {
      // Duplicate alias for an already-mapped field — also tag it so the
      // table can hide it from "Excel extras".
      headerToField.set(h, field);
    } else {
      unmapped.push(h);
    }
  }
  const missingRequired = REQUIRED_FIELDS.filter((f) => !fieldToHeader.has(f));
  return { fieldToHeader, headerToField, unmapped, missingRequired };
};
