import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useHistory, useLocation } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Col,
  Container,
  Form,
  Pagination,
  Row,
  Spinner,
} from "@themesberg/react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheckCircle,
  faClock,
  faCopy,
  faDatabase,
  faEye,
  faFileAlt,
  faFolderOpen,
  faHdd,
  faMemory,
  faPlus,
  faShieldAlt,
} from "@fortawesome/free-solid-svg-icons";
import { CopyToClipboard } from "react-copy-to-clipboard";
import {
  Chart as ChartJS,
  ArcElement,
  Legend,
  Tooltip as ChartTooltip,
} from "chart.js";
import { Doughnut } from "react-chartjs-2";

import PageHeader from "components/common/PageHeader";
import SearchInput from "components/common/SearchInput";
import StatusBadge from "components/common/StatusBadge";
import ApiErrorDisplay from "components/common/ApiErrorDisplay";
import EmptyState from "components/common/EmptyState";
import SkeletonLoader from "components/common/SkeletonLoader";
import StatCard from "components/forensic/StatCard";
import {
  EVIDENCE_STATUS,
  EVIDENCE_STATUS_COLOURS,
  EVIDENCE_TYPE,
} from "utils/constants";
import {
  formatBytes,
  formatCaseId,
  formatDateRelative,
  formatEvidenceId,
  formatHash,
  humanizeFileName,
  humanizeLabel,
} from "utils/formatters";
import usePagination from "hooks/usePagination";
import usePermission from "hooks/usePermission";
import useNotification from "hooks/useNotification";
import evidenceService from "services/evidence.service";
import {
  fetchCasesCached,
  fetchEvidenceInventoryCached,
  fetchEvidenceStatisticsCached,
  normaliseCasesList,
} from "services/referenceData";
import { Routes } from "routes";

ChartJS.register(ArcElement, Legend, ChartTooltip);

const PAGE_SIZE = 6;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: EVIDENCE_STATUS.REGISTERED, label: "Registered" },
  { value: EVIDENCE_STATUS.VALIDATING, label: "Validating" },
  { value: EVIDENCE_STATUS.VALIDATED, label: "Validated" },
  { value: EVIDENCE_STATUS.PROCESSING, label: "Processing" },
  { value: EVIDENCE_STATUS.PROCESSED, label: "Processed" },
  { value: EVIDENCE_STATUS.QUARANTINED, label: "Quarantined" },
  { value: EVIDENCE_STATUS.ARCHIVED, label: "Archived" },
];

function sha256Of(row) {
  const set = row.hash_set || {};
  return set.sha256 || set.SHA256 || row.original_hash || "";
}

function typeLabel(type) {
  if (type === EVIDENCE_TYPE.DISK_IMAGE) return "Disk Image";
  if (type === EVIDENCE_TYPE.MEMORY_DUMP) return "Memory Dump";
  return String(type || "—")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function caseDisplayName(row) {
  return humanizeLabel(row?.case_name, formatCaseId(row?.case_id) || "Untitled case");
}

function HashCell({ hash }) {
  const { info } = useNotification();
  if (!hash) return "—";
  return (
    <span className="d-inline-flex align-items-center">
      <code className="small me-1 text-break">{formatHash(hash, 12)}</code>
      <CopyToClipboard
        text={hash}
        onCopy={() => info("Copied", "SHA-256 hash copied to clipboard.")}
      >
        <Button
          variant="link"
          size="sm"
          className="p-0 text-muted"
          title="Copy SHA-256"
          aria-label="Copy SHA-256 hash"
        >
          <FontAwesomeIcon icon={faCopy} />
        </Button>
      </CopyToClipboard>
    </span>
  );
}

function EvidenceCard({ row, busy, canUpdate, onValidate, onVerify }) {
  const detailPath = Routes.EvidenceDetail.path.replace(":id", row.evidence_id);
  const hash = sha256Of(row);
  const isMemory = row.evidence_type === EVIDENCE_TYPE.MEMORY_DUMP;

  return (
    <Card border="light" className="shadow-sm h-100">
      <Card.Body className="d-flex flex-column">
        <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
          <Link
            to={detailPath}
            className="fw-bold text-decoration-none"
            title={row.evidence_id}
          >
            {formatEvidenceId(row.evidence_id)}
          </Link>
          <StatusBadge status={row.status} type="evidence" />
        </div>

        <h5 className="h6 mb-2">
          <Link to={detailPath} className="text-dark text-decoration-none">
            {humanizeFileName(row.file_name, formatEvidenceId(row.evidence_id))}
          </Link>
        </h5>

        <div className="mb-3">
          <Badge bg={isMemory ? "info" : "secondary"}>{typeLabel(row.evidence_type)}</Badge>
        </div>

        <ul className="list-unstyled small text-muted mb-3 flex-grow-1">
          <li className="d-flex align-items-start mb-2">
            <FontAwesomeIcon icon={faFolderOpen} className="me-2 mt-1" />
            <span>
              <span className="text-uppercase" style={{ fontSize: "0.7rem" }}>
                Case
              </span>
              <br />
              {row.case_id ? (
                <Link
                  to={Routes.CaseDetail.path.replace(":id", row.case_id)}
                  className="text-dark"
                  title={row.case_name || row.case_id}
                >
                  {caseDisplayName(row)}
                </Link>
              ) : (
                <span className="text-dark">—</span>
              )}
            </span>
          </li>
          <li className="d-flex align-items-start mb-2">
            <FontAwesomeIcon icon={faDatabase} className="me-2 mt-1" />
            <span>
              <span className="text-uppercase" style={{ fontSize: "0.7rem" }}>
                Size
              </span>
              <br />
              <span className="text-dark">{formatBytes(row.file_size_bytes)}</span>
            </span>
          </li>
          <li className="d-flex align-items-start mb-2">
            <FontAwesomeIcon icon={faFileAlt} className="me-2 mt-1" />
            <span>
              <span className="text-uppercase" style={{ fontSize: "0.7rem" }}>
                MIME
              </span>
              <br />
              <span className="text-dark text-break">{row.mime_type || "—"}</span>
            </span>
          </li>
          <li className="d-flex align-items-start mb-2">
            <FontAwesomeIcon icon={faShieldAlt} className="me-2 mt-1" />
            <span>
              <span className="text-uppercase" style={{ fontSize: "0.7rem" }}>
                Hash
              </span>
              <br />
              <HashCell hash={hash} />
            </span>
          </li>
          <li className="d-flex align-items-start">
            <FontAwesomeIcon icon={faClock} className="me-2 mt-1" />
            <span>
              <span className="text-uppercase" style={{ fontSize: "0.7rem" }}>
                Registered
              </span>
              <br />
              <span className="text-dark">{formatDateRelative(row.registered_at)}</span>
            </span>
          </li>
        </ul>

        <div className="d-flex flex-wrap gap-2 mt-auto pt-2 border-top border-light">
          <Button
            as={Link}
            to={detailPath}
            variant="outline-primary"
            size="sm"
            title="View"
          >
            <FontAwesomeIcon icon={faEye} className="me-1" />
            View
          </Button>
          {canUpdate ? (
            <>
              <Button
                variant="outline-success"
                size="sm"
                disabled={busy}
                title="Re-run evidence validation"
                onClick={() => onValidate(row)}
              >
                {busy ? (
                  <Spinner animation="border" size="sm" className="me-1" />
                ) : (
                  <FontAwesomeIcon icon={faCheckCircle} className="me-1" />
                )}
                Validate
              </Button>
              <Button
                variant="outline-info"
                size="sm"
                disabled={busy}
                title="Verify SHA-256 integrity"
                onClick={() => onVerify(row)}
              >
                {busy ? (
                  <Spinner animation="border" size="sm" className="me-1" />
                ) : (
                  <FontAwesomeIcon icon={faShieldAlt} className="me-1" />
                )}
                Verify
              </Button>
            </>
          ) : null}
        </div>
      </Card.Body>
    </Card>
  );
}

/**
 * Evidence inventory with filters, statistics, and integrity actions.
 */
export default function EvidenceInventory() {
  const history = useHistory();
  const location = useLocation();
  const { canCreate, canUpdate } = usePermission("evidence");
  const { success, error: notifyError } = useNotification();

  const queryCaseId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("caseId") || "";
  }, [location.search]);

  const [cases, setCases] = useState([]);
  const [stats, setStats] = useState(null);
  const [caseFilter, setCaseFilter] = useState(queryCaseId);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [actionBusy, setActionBusy] = useState(null);

  const filtersRef = useRef({
    caseFilter,
    statusFilter,
    typeFilter,
    search,
  });
  filtersRef.current = { caseFilter, statusFilter, typeFilter, search };

  useEffect(() => {
    fetchCasesCached()
      .then((result) => {
        setCases(normaliseCasesList(result));
      })
      .catch(() => setCases([]));
  }, []);

  useEffect(() => {
    fetchEvidenceStatisticsCached()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  const fetchInventory = useCallback(async ({ page, pageSize }) => {
    const {
      caseFilter: caseId,
      statusFilter: status,
      typeFilter: type,
      search: query,
    } = filtersRef.current;

    const params = {};
    if (caseId) params.case_id = caseId;

    const result = await fetchEvidenceInventoryCached(params);
    let items = Array.isArray(result?.items) ? result.items : [];

    if (status) {
      items = items.filter(
        (row) => String(row.status || "").toLowerCase() === status
      );
    }
    if (type) {
      items = items.filter(
        (row) => String(row.evidence_type || "").toLowerCase() === type
      );
    }
    const q = String(query || "")
      .trim()
      .toLowerCase();
    if (q) {
      items = items.filter((row) => {
        const hay = [
          row.file_name,
          row.evidence_id,
          row.case_name,
          row.mime_type,
          sha256Of(row),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    items = [...items].sort((a, b) => {
      const ta = new Date(a.registered_at || 0).getTime();
      const tb = new Date(b.registered_at || 0).getTime();
      return tb - ta;
    });

    const total = items.length;
    const start = (Math.max(1, page) - 1) * pageSize;
    const pageItems = items.slice(start, start + pageSize).map((row) => ({
      ...row,
      id: row.evidence_id,
    }));
    return { items: pageItems, total };
  }, []);

  const {
    data,
    loading,
    error,
    page,
    pageSize,
    total,
    goToPage,
    refresh,
  } = usePagination(fetchInventory, { pageSize: PAGE_SIZE });

  useEffect(() => {
    goToPage(1).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseFilter, statusFilter, typeFilter, search]);

  const diskCount = Number(stats?.by_type?.[EVIDENCE_TYPE.DISK_IMAGE]) || 0;
  const memoryCount = Number(stats?.by_type?.[EVIDENCE_TYPE.MEMORY_DUMP]) || 0;
  const totalCount = Number(stats?.total) || 0;

  const statusChart = useMemo(() => {
    const byStatus = stats?.by_status || {};
    const entries = Object.entries(byStatus).filter(([, n]) => Number(n) > 0);
    if (!entries.length) {
      return {
        labels: ["No data"],
        datasets: [{ data: [1], backgroundColor: ["#e9ecef"], borderWidth: 0 }],
      };
    }
    return {
      labels: entries.map(([key]) =>
        key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      ),
      datasets: [
        {
          data: entries.map(([, n]) => Number(n) || 0),
          backgroundColor: entries.map(
            ([key]) => EVIDENCE_STATUS_COLOURS[key] || "#6c757d"
          ),
          borderWidth: 1,
          borderColor: "#fff",
        },
      ],
    };
  }, [stats]);

  const handleValidate = async (row) => {
    setActionBusy(row.evidence_id);
    try {
      const result = await evidenceService.validate(row.evidence_id);
      if (result?.validation_passed) {
        success(
          "Validated",
          `${humanizeFileName(row.file_name, formatEvidenceId(row.evidence_id))} passed validation.`
        );
      } else {
        const failures = (result?.validation_failures || []).join("; ");
        notifyError(
          "Validation failed",
          failures || "Evidence did not pass validation."
        );
      }
      await refresh();
    } catch (err) {
      notifyError("Validate failed", err?.message || "Could not validate evidence.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleVerify = async (row) => {
    setActionBusy(row.evidence_id);
    try {
      const result = await evidenceService.verifyIntegrity(row.evidence_id);
      if (result?.integrity_verified) {
        success(
          "Integrity verified",
          `${humanizeFileName(row.file_name, formatEvidenceId(row.evidence_id))} hash matches.`
        );
      } else {
        notifyError(
          "Integrity mismatch",
          "Current file hash does not match the registered digest."
        );
      }
      await refresh();
    } catch (err) {
      notifyError("Verify failed", err?.message || "Could not verify integrity.");
    } finally {
      setActionBusy(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil((total || 0) / pageSize) || 1);
  const showPagination = !loading && total > pageSize;

  return (
    <Container fluid className="px-0">
      <PageHeader
        title="Evidence Inventory"
        subtitle="Registered forensic images and memory dumps"
        actions={
          canCreate ? (
            <Button
              variant="primary"
              onClick={() => history.push(Routes.EvidenceRegister.path)}
            >
              <FontAwesomeIcon icon={faPlus} className="me-2" />
              Register Evidence
            </Button>
          ) : null
        }
      />

      <Row className="mb-4">
        <Col xs={12} sm={6} xl={3} className="mb-3 mb-xl-0">
          <StatCard
            title="Total Evidence"
            value={totalCount}
            icon={faDatabase}
            colour="primary"
          />
        </Col>
        <Col xs={12} sm={6} xl={3} className="mb-3 mb-xl-0">
          <StatCard
            title="Disk Images"
            value={diskCount}
            icon={faHdd}
            colour="success"
          />
        </Col>
        <Col xs={12} sm={6} xl={3} className="mb-3 mb-xl-0">
          <StatCard
            title="Memory Dumps"
            value={memoryCount}
            icon={faMemory}
            colour="info"
          />
        </Col>
        <Col xs={12} sm={6} xl={3}>
          <Card border="light" className="shadow-sm h-100">
            <Card.Body className="py-2 overflow-hidden">
              <h6 className="text-muted mb-2 text-uppercase small fw-bold">
                By Status
              </h6>
              <div
                className="mx-auto"
                style={{ position: "relative", height: 100, maxWidth: 140 }}
              >
                <Doughnut
                  data={statusChart}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: 4 },
                    plugins: { legend: { display: false } },
                  }}
                />
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Card border="light" className="shadow-sm mb-4">
        <Card.Body>
          <Row className="g-3 align-items-end">
            <Col xs={12} md={3}>
              <Form.Group className="mb-0">
                <Form.Label className="small text-muted mb-1">Case</Form.Label>
                <Form.Select
                  value={caseFilter}
                  onChange={(e) => setCaseFilter(e.target.value)}
                  aria-label="Filter by case"
                >
                  <option value="">All cases</option>
                  {cases.map((c) => (
                    <option key={c.case_id} value={c.case_id}>
                      {humanizeLabel(c.case_name, formatCaseId(c.case_id))}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col xs={12} md={2}>
              <Form.Group className="mb-0">
                <Form.Label className="small text-muted mb-1">Status</Form.Label>
                <Form.Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Filter by status"
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value || "all"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col xs={12} md={2}>
              <Form.Group className="mb-0">
                <Form.Label className="small text-muted mb-1">Type</Form.Label>
                <Form.Select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  aria-label="Filter by type"
                >
                  <option value="">All types</option>
                  <option value={EVIDENCE_TYPE.DISK_IMAGE}>Disk Image</option>
                  <option value={EVIDENCE_TYPE.MEMORY_DUMP}>Memory Dump</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col xs={12} md={4}>
              <Form.Label className="small text-muted mb-1">Search</Form.Label>
              <SearchInput
                placeholder="Search filename, hash, case…"
                value={search}
                onChange={setSearch}
              />
            </Col>
            <Col xs={12} md={1}>
              <Button
                variant="outline-secondary"
                className="w-100"
                onClick={() => {
                  setCaseFilter("");
                  setStatusFilter("");
                  setTypeFilter("");
                  setSearch("");
                }}
              >
                Reset
              </Button>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {error ? (
        <ApiErrorDisplay
          error={error}
          onRetry={() => goToPage(page).catch(() => {})}
          className="mb-3"
        />
      ) : null}

      {loading ? (
        <Row className="g-3 mb-3">
          {Array.from({ length: PAGE_SIZE }).map((_, index) => (
            <Col key={`skeleton-${index}`} xs={12} md={6} xl={4}>
              <Card border="light" className="shadow-sm h-100">
                <Card.Body>
                  <SkeletonLoader type="text" rows={6} />
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>
      ) : data.length === 0 ? (
        <Card border="light" className="shadow-sm">
          <Card.Body>
            <EmptyState
              title="No evidence found"
              description="Register a forensic image to begin."
            />
            {canCreate ? (
              <div className="text-center pb-2">
                <Button
                  variant="primary"
                  onClick={() => history.push(Routes.EvidenceRegister.path)}
                >
                  <FontAwesomeIcon icon={faPlus} className="me-2" />
                  Register Evidence
                </Button>
              </div>
            ) : null}
          </Card.Body>
        </Card>
      ) : (
        <>
          <Row className="g-3 mb-3" aria-label="Evidence inventory">
            {data.map((row) => (
              <Col key={row.evidence_id} xs={12} md={6} xl={4}>
                <EvidenceCard
                  row={row}
                  busy={actionBusy === row.evidence_id}
                  canUpdate={canUpdate}
                  onValidate={handleValidate}
                  onVerify={handleVerify}
                />
              </Col>
            ))}
          </Row>

          {showPagination ? (
            <div className="d-flex justify-content-between align-items-center px-1 pb-2">
              <span className="small text-muted">
                Page {page} of {totalPages} ({total} total)
              </span>
              <nav aria-label="Evidence pagination">
                <Pagination className="mb-0">
                  <Pagination.Prev
                    disabled={page <= 1}
                    aria-label="Previous page"
                    onClick={() => goToPage(page - 1).catch(() => {})}
                  />
                  <Pagination.Item active aria-current="page">
                    {page}
                  </Pagination.Item>
                  <Pagination.Next
                    disabled={page >= totalPages}
                    aria-label="Next page"
                    onClick={() => goToPage(page + 1).catch(() => {})}
                  />
                </Pagination>
              </nav>
            </div>
          ) : null}
        </>
      )}
    </Container>
  );
}
