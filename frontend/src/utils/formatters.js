import { SUSPICION_COLOURS } from "./constants";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function toDate(value) {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Format an ISO timestamp as ``25 Jun 2026, 14:30``.
 */
export function formatDate(isoString) {
  const date = toDate(isoString);
  if (!date) return "—";
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}`;
}

/**
 * Relative time such as ``2 hours ago`` / ``3 days ago``.
 */
export function formatDateRelative(isoString, now = Date.now()) {
  const date = toDate(isoString);
  if (!date) return "—";

  const nowMs = typeof now === "number" ? now : Date.now();
  const diffMs = Math.max(0, nowMs - date.getTime());
  const seconds = Math.floor(diffMs / 1000);

  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return months === 1 ? "1 month ago" : `${months} months ago`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

/**
 * Human-readable byte size (``1.0 GB``, ``256 KB``).
 */
export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "0 B";
  if (value === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1
  );
  const scaled = value / 1024 ** exponent;
  const decimals = exponent === 0 ? 0 : 1;
  return `${scaled.toFixed(decimals)} ${units[exponent]}`;
}

/**
 * Duration from seconds: ``2m 34s``, ``1h 15m``.
 */
export function formatDuration(seconds) {
  let remaining = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(remaining / 3600);
  remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  const secs = remaining % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Truncate a hash/digest with ellipsis.
 */
export function formatHash(hash, length = 8) {
  if (!hash) return "—";
  const text = String(hash);
  if (text.length <= length) return text;
  return `${text.slice(0, length)}...`;
}

/**
 * Percentage string with configurable decimals.
 */
export function formatPercentage(value, decimals = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `${num.toFixed(decimals)}%`;
}

/**
 * Artefact ID display — first 8 characters.
 */
export function formatArtefactId(uuid) {
  if (!uuid) return "—";
  return String(uuid).slice(0, 8);
}

/**
 * Case ID display — ``CASE-{first 6 chars}``.
 */
export function formatCaseId(uuid) {
  if (!uuid) return "—";
  return `CASE-${String(uuid).slice(0, 6)}`;
}

/**
 * Evidence ID display — ``EVD-{first 6 chars}``.
 */
export function formatEvidenceId(uuid) {
  if (!uuid) return "—";
  return `EVD-${String(uuid).slice(0, 6)}`;
}

/**
 * Title-case a snake_case or camelCase field key.
 */
export function humanizeFieldKey(key) {
  return String(key || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a value looks like a UUID.
 */
export function isUuid(value) {
  return UUID_RE.test(String(value || "").trim());
}

/**
 * Human-readable actor label for audit/status/custody entries.
 */
export function humanizeActor(name, userId) {
  const label = String(name || "").trim();
  if (label) return label;
  const id = String(userId || "").trim();
  if (!id || id.toLowerCase() === "system") return "System";
  if (isUuid(id)) return "Investigator";
  return id;
}

/**
 * Replace embedded UUIDs in custody/status reasons with readable labels.
 */
export function humanizeEvidenceReason(reason, context = {}) {
  let text = String(reason || "").trim();
  if (!text) return "";

  const caseId = context.caseId || context.case_id;
  const caseName = humanizeLabel(context.caseName || context.case_name, "");
  if (caseId && caseName) {
    text = text.replace(new RegExp(caseId, "gi"), caseName);
  }

  text = text.replace(
    /Acquired into case\s+([0-9a-f-]{36})/gi,
    (_, id) =>
      `Linked to case ${humanizeLabel(context.caseName, formatCaseId(id))}`
  );

  text = text.replace(
    /Analysis via pipeline\s+([0-9a-f-]{36})/gi,
    (_, id) => `Analysis pipeline run ${formatJobId(id)}`
  );

  return text;
}

/**
 * Format a metadata field value for display (not raw JSON).
 */
export function formatMetadataValue(key, value) {
  if (value == null || value === "") return "—";

  const field = String(key || "").toLowerCase();

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (field.includes("_at") || field.endsWith("_date")) {
    return formatDate(value);
  }

  if (field.includes("size") && field.includes("byte")) {
    return formatBytes(value);
  }

  if (field === "evidence_id") {
    return formatEvidenceId(value);
  }

  if (field === "mime_detected_from") {
    return humanizeFieldKey(value);
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string" && isUuid(value)) {
    if (field.includes("case")) return formatCaseId(value);
    if (field.includes("evidence")) return formatEvidenceId(value);
    if (field.includes("job") || field.includes("pipeline")) {
      return formatJobId(value);
    }
    return `${String(value).slice(0, 8)}…`;
  }

  if (Array.isArray(value)) {
    if (!value.length) return "—";
    return value.map((item) => String(item)).join("; ");
  }

  if (typeof value === "object") {
    return null;
  }

  return String(value);
}

/**
 * Flatten evidence metadata into labelled rows for tables.
 */
export function buildEvidenceMetadataRows(metadata = {}, options = {}) {
  const skip = new Set([
    ...(options.skipKeys || []),
    "hash_set",
  ]);
  const rows = [];

  Object.entries(metadata).forEach(([key, value]) => {
    if (skip.has(key) || value == null || value === "") return;
    const formatted = formatMetadataValue(key, value);
    if (formatted != null) {
      rows.push({ key, label: humanizeFieldKey(key), value: formatted });
    }
  });

  const hashSet = metadata.hash_set;
  if (hashSet && typeof hashSet === "object") {
    if (hashSet.md5) {
      rows.push({ key: "hash_md5", label: "MD5", value: hashSet.md5 });
    }
    if (hashSet.sha1) {
      rows.push({ key: "hash_sha1", label: "SHA-1", value: hashSet.sha1 });
    }
    if (hashSet.sha256 || hashSet.primary_hash) {
      rows.push({
        key: "hash_sha256",
        label: "SHA-256",
        value: hashSet.sha256 || hashSet.primary_hash,
      });
    }
    if (hashSet.computed_at) {
      rows.push({
        key: "hash_computed_at",
        label: "Hashes computed",
        value: formatDate(hashSet.computed_at),
      });
    }
  }

  return rows;
}

/**
 * Pipeline job ID display — ``JOB-{first 6 chars}``.
 */
export function formatJobId(uuid) {
  if (!uuid) return "—";
  return `JOB-${String(uuid).slice(0, 6)}`;
}

/**
 * Strip seed/E2E timestamp suffixes and object wrappers from display names.
 * e.g. ``E2E Case 1786661719092`` → ``E2E Case``, ``Dev Sample — Active`` → ``Dev Sample``.
 */
export function humanizeLabel(value, fallback = "—") {
  let text = value;
  if (text != null && typeof text === "object") {
    text =
      text.label ||
      text.name ||
      text.case_name ||
      text.file_name ||
      text.title ||
      "";
  }
  text = String(text || "").trim();
  if (!text) return fallback;

  text = text
    // Trailing epoch-style numeric ids: "E2E Case 1786661719092"
    .replace(/\s+\d{10,}$/g, "")
    // Trailing status baked into titles: "Dev Sample — Active"
    .replace(
      /\s*[—–-]\s*(Created|Open|Active|Under[ _]Review|Closed|Archived|Registered|Validating|Validated|Processing|Processed|Quarantined)$/i,
      ""
    )
    .trim();

  return text || fallback;
}

/**
 * Human-readable evidence file name.
 * e.g. ``inventory-1786663537723.dd`` → ``inventory.dd``.
 */
export function humanizeFileName(value, fallback = "Untitled file") {
  let name = value;
  if (name != null && typeof name === "object") {
    name = name.file_name || name.name || name.label || "";
  }
  name = String(name || "").trim();
  if (!name) return fallback;

  // Basename only if a path sneaks through
  name = name.replace(/^.*[\\/]/, "");

  // Strip -{long digits} before the extension: inventory-1786663537723.dd
  const cleaned = name.replace(/[-_](\d{10,})(?=\.[^.]+$)/, "");
  if (cleaned !== name) return cleaned;

  // Or trailing -{digits} with no extension
  return name.replace(/[-_](\d{10,})$/, "") || fallback;
}

/**
 * Human-readable pipeline / parser error for job detail views.
 */
export function humanizePipelineError(message) {
  if (message == null || message === "") {
    return "An unexpected error occurred during pipeline execution.";
  }
  if (Array.isArray(message)) {
    return message.map((item) => humanizePipelineError(item)).join(" ");
  }

  const parts = String(message)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 1) {
    return parts.map((part) => humanizePipelineError(part)).join(" ");
  }

  const raw = String(message).trim();
  const stripped = raw
    .replace(/^\[[A-Za-z]+Error\]\s*/i, "")
    .replace(/\s*\(context:\s*\{[\s\S]*\}\)\s*$/i, "")
    .trim();
  const lower = stripped.toLowerCase();

  if (
    lower.includes("placeholder") ||
    lower.includes("demo failed job") ||
    lower.includes("placeholder image")
  ) {
    return (
      "This evidence file is a placeholder demo image and cannot be parsed like a real " +
      "disk image. Upload a valid forensic disk image (E01, DD, or raw) and run the " +
      "pipeline again."
    );
  }

  if (lower.includes("parsing stage failed")) {
    return (
      "The parsing stage could not extract artefacts from this evidence. Confirm the " +
      "file is a valid forensic disk image, then try running the pipeline again."
    );
  }

  if (
    lower.includes("diskparsingerror") ||
    lower.includes("cannot determine file system type") ||
    lower.includes("failed to open filesystem") ||
    lower.includes("failed to open filesystem at offset") ||
    lower.includes("unable to open the image as a filesystem")
  ) {
    return (
      "This disk image does not contain a recognisable file system. " +
      "Use a valid forensic disk image (for example E01, DD, or raw) from " +
      "data/datasets/ or a real acquisition, then run the pipeline again."
    );
  }

  if (lower.includes("failed to open disk image")) {
    return (
      "The disk image could not be opened. The file may be corrupt, " +
      "truncated, or not a supported disk image format."
    );
  }

  if (
    lower.includes("integrityverificationerror") ||
    lower.includes("integrity verification failed")
  ) {
    return (
      "Evidence integrity verification failed. The file may have been " +
      "modified since it was registered."
    );
  }

  if (lower.includes("evidence not found")) {
    return "The evidence file could not be found or accessed for this job.";
  }

  if (lower.includes("unsupported") && lower.includes("format")) {
    return "The evidence format is not supported for automated pipeline analysis.";
  }

  if (lower.includes("timed out")) {
    return "The pipeline timed out before completing. Try again or use a smaller evidence file.";
  }

  if (lower.includes("cancelled")) {
    return "This pipeline job was cancelled.";
  }

  if (lower.includes("all parsers failed")) {
    return (
      "No forensic parsers could extract artefacts from this evidence. " +
      "Check that the image type matches the registered evidence category."
    );
  }

  if (lower.includes("no evidence available for parsing")) {
    return "No evidence was loaded for parsing. Re-run the pipeline from validated evidence.";
  }

  if (lower.includes("reporting requires")) {
    return "Reporting could not start because earlier stages did not produce artefacts.";
  }

  const parserPrefix = stripped.match(/^([A-Za-z]+Parser):\s*(.+)$/);
  if (parserPrefix) {
    return `${parserPrefix[1]}: ${humanizePipelineError(parserPrefix[2])}`;
  }

  return stripped || "An unexpected error occurred during pipeline execution.";
}

function validationFailuresText(details) {
  if (!details || typeof details !== "object") return "";
  const failures = details.validation_failures;
  if (Array.isArray(failures)) {
    return failures.filter(Boolean).join(" ");
  }
  return "";
}

/**
 * Human-readable API error for alert components (422 validation, network, etc.).
 */
export function humanizeApiError(error) {
  if (!error) {
    return "Something went wrong. Please try again.";
  }

  const status = error.status ?? 0;
  const message = String(error.message || "").trim();
  const detailsText = validationFailuresText(error.details);
  const combined = `${message} ${detailsText}`.toLowerCase();

  if (
    combined.includes("no parsed artefacts") ||
    combined.includes("no artefacts are available")
  ) {
    if (message && !/^validation (error|failed)/i.test(message)) {
      return message;
    }
    return (
      "No artefacts are available for this evidence yet. Run the analysis pipeline on " +
      "a valid forensic image, or choose evidence that has already been processed."
    );
  }

  if (status === 401) {
    return "Your session has expired. Please sign in again.";
  }
  if (status === 403) {
    return "You don't have permission to perform this action.";
  }
  if (status === 404) {
    return message && !/^not found$/i.test(message)
      ? message
      : "The requested item could not be found.";
  }
  if (status === 422) {
    if (message && !/^validation (error|failed)/i.test(message)) {
      return message;
    }
    return "Some of the information provided was invalid. Review your selection and try again.";
  }
  if (status === 429) {
    return "Too many requests. Please wait a moment and try again.";
  }
  if (status === 0) {
    return "Unable to reach the server. Check your connection and try again.";
  }
  if (status >= 500) {
    return "The server encountered a problem. Please try again later.";
  }

  return message || "Something went wrong. Please try again.";
}

/**
 * Suspicion level as title case with associated colour.
 * @returns {{ label: string, colour: string }}
 */
export function formatSuspicionLevel(level) {
  const key = String(level || "").toLowerCase();
  const label = key
    ? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Unknown";
  const colour = SUSPICION_COLOURS[key] || "#6c757d";
  return { label, colour };
}
