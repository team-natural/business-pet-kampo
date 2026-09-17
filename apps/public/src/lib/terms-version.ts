// The version recorded in applications.agreed_terms_version. The terms are a page, not a row, so
// this string is the only way to tell afterwards which wording someone agreed to.
//
// Change the wording of /terms and change this in the same commit — leaving it behind makes the
// consent record untraceable (DEV-06 §1-1, DEV-07 §5-1).
export const CURRENT_TERMS_VERSION = "2026-09-17";
