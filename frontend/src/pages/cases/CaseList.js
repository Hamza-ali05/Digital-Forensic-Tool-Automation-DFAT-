import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useHistory } from "react-router-dom";
import {
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
  faClock,
  faDatabase,
  faEye,
  faFolderOpen,
  faFolderPlus,
  faLock,
  faPlus,
  faUserShield,
} from "@fortawesome/free-solid-svg-icons";
import Datetime from "react-datetime";
import moment from "moment-timezone";

import PageHeader from "components/common/PageHeader";
import SearchInput from "components/common/SearchInput";
import StatusBadge from "components/common/StatusBadge";
import ApiErrorDisplay from "components/common/ApiErrorDisplay";
import ConfirmDialog from "components/common/ConfirmDialog";
import EmptyState from "components/common/EmptyState";
import SkeletonLoader from "components/common/SkeletonLoader";
import { CASE_STATUS } from "utils/constants";
import { formatCaseId, formatDateRelative } from "utils/formatters";
import usePagination from "hooks/usePagination";
import usePermission from "hooks/usePermission";
import useNotification from "hooks/useNotification";
import useConfirmDialog from "hooks/useConfirmDialog";
import casesService from "services/cases.service";
import { fetchCasesCached, normaliseCasesList } from "services/referenceData";
import { Routes } from "routes";

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: CASE_STATUS.CREATED, label: "Created" },
  { value: CASE_STATUS.OPEN, label: "Open" },
  { value: CASE_STATUS.ACTIVE, label: "Active" },
  { value: CASE_STATUS.UNDER_REVIEW, label: "Under Review" },
  { value: CASE_STATUS.CLOSED, label: "Closed" },
  { value: CASE_STATUS.ARCHIVED, label: "Archived" },
];

const CLOSEABLE = new Set([
  CASE_STATUS.OPEN,
  CASE_STATUS.ACTIVE,
  CASE_STATUS.UNDER_REVIEW,
]);

const PAGE_SIZE = 6;

function toMoment(value) {
  if (!value) return null;
  if (moment.isMoment(value)) return value.isValid() ? value : null;
  const m = moment(value);
  return m.isValid() ? m : null;
}

function leadInvestigatorLabel(row) {
  const investigators = Array.isArray(row?.investigators) ? row.investigators : [];
  const lead =
    investigators.find((inv) => String(inv?.role || "").toLowerCase() === "lead") ||
    investigators[0] ||
    null;

  const name =
    (typeof lead?.full_name === "string" && lead.full_name.trim()) ||
    (typeof lead?.username === "string" && lead.username.trim()) ||
    (typeof row?.lead_investigator_name === "string" &&
      row.lead_investigator_name.trim()) ||
    (typeof row?.lead_investigator === "string" && row.lead_investigator.trim()) ||
    "";

  if (name) return name;
  if (row?.lead_investigator_id) return "Assigned (name unavailable)";
  return "Unassigned";
}

function caseNameLabel(row) {
  let name = row?.case_name ?? row?.name ?? "";
  if (name && typeof name === "object") {
    name = name.case_name || name.name || name.label || "";
  }
  name = String(name || "").trim();
  if (!name) return formatCaseId(row?.case_id) || "Untitled case";

  const statusTokens = Object.values(CASE_STATUS)
    .map((value) => String(value).replace(/_/g, "[ _]"))
    .join("|");
  const stripped = name
    .replace(new RegExp(`[\\s]*[—–-][\\s]*(${statusTokens})$`, "i"), "")
    .replace(
      new RegExp(
        `[\\s]*[—–-][\\s]*(Created|Open|Active|Under Review|Closed|Archived)$`,
        "i"
      ),
      ""
    )
    .trim();
  return stripped || name;
}

function evidenceCountLabel(row) {
  const count = Number(
    row?.evidence_count ??
      (Array.isArray(row?.evidence_ids) ? row.evidence_ids.length : 0)
  );
  if (!Number.isFinite(count) || count <= 0) return "No evidence";
  return count === 1 ? "1 item" : `${count} items`;
}

function CaseCard({ row, busy, canUpdate, onOpen, onClose }) {
  const statusValue = String(row.status || "").toLowerCase();
  const showOpen = canUpdate && statusValue === CASE_STATUS.CREATED;
  const showClose = canUpdate && CLOSEABLE.has(statusValue);
  const detailPath = Routes.CaseDetail.path.replace(":id", row.case_id);

  return (
    <Card border="light" className="shadow-sm h-100">
      <Card.Body className="d-flex flex-column">
        <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
          <Link
            to={detailPath}
            className="fw-bold text-decoration-none"
            title={row.case_id}
          >
            {formatCaseId(row.case_id)}
          </Link>
          <StatusBadge status={row.status} type="case" />
        </div>

        <h5 className="h6 mb-3">
          <Link to={detailPath} className="text-dark text-decoration-none">
            {caseNameLabel(row)}
          </Link>
        </h5>

        <ul className="list-unstyled small text-muted mb-3 flex-grow-1">
          <li className="d-flex align-items-center mb-2">
            <FontAwesomeIcon icon={faUserShield} className="me-2" />
            <span>
              <span className="text-uppercase" style={{ fontSize: "0.7rem" }}>
                Lead
              </span>
              <br />
              <span className="text-dark">{leadInvestigatorLabel(row)}</span>
            </span>
          </li>
          <li className="d-flex align-items-center mb-2">
            <FontAwesomeIcon icon={faDatabase} className="me-2" />
            <span>
              <span className="text-uppercase" style={{ fontSize: "0.7rem" }}>
                Evidence
              </span>
              <br />
              <span className="text-dark">{evidenceCountLabel(row)}</span>
            </span>
          </li>
          <li className="d-flex align-items-center">
            <FontAwesomeIcon icon={faClock} className="me-2" />
            <span>
              <span className="text-uppercase" style={{ fontSize: "0.7rem" }}>
                Created
              </span>
              <br />
              <span className="text-dark">{formatDateRelative(row.created_at)}</span>
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
          {showOpen ? (
            <Button
              variant="outline-success"
              size="sm"
              disabled={busy}
              onClick={() => onOpen(row)}
              title="Open case"
            >
              {busy ? (
                <Spinner animation="border" size="sm" className="me-1" />
              ) : (
                <FontAwesomeIcon icon={faFolderOpen} className="me-1" />
              )}
              Open
            </Button>
          ) : null}
          {showClose ? (
            <Button
              variant="outline-warning"
              size="sm"
              disabled={busy}
              onClick={() => onClose(row)}
              title="Close case"
            >
              {busy ? (
                <Spinner animation="border" size="sm" className="me-1" />
              ) : (
                <FontAwesomeIcon icon={faLock} className="me-1" />
              )}
              Close
            </Button>
          ) : null}
        </div>
      </Card.Body>
    </Card>
  );
}

/**
 * Case list with status/search/date filters, card layout, and lifecycle actions.
 */
export default function CaseList() {
  const history = useHistory();
  const { canCreate, canUpdate } = usePermission("cases");
  const { success, error: notifyError } = useNotification();
  const { dialogProps, openDialog } = useConfirmDialog();

  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [actionBusy, setActionBusy] = useState(null);

  const filtersRef = useRef({ status, search, dateFrom, dateTo });
  filtersRef.current = { status, search, dateFrom, dateTo };

  const fetchCases = useCallback(async ({ page, pageSize }) => {
    const {
      status: statusFilter,
      search: nameQuery,
      dateFrom: from,
      dateTo: to,
    } = filtersRef.current;

    const params = {};
    if (statusFilter) params.status = statusFilter;

    const result = await fetchCasesCached(params);
    let items = normaliseCasesList(result);

    const q = String(nameQuery || "")
      .trim()
      .toLowerCase();
    if (q) {
      items = items.filter((c) =>
        String(c.case_name || "")
          .toLowerCase()
          .includes(q)
      );
    }

    const fromM = toMoment(from)?.startOf("day");
    const toM = toMoment(to)?.endOf("day");
    if (fromM || toM) {
      items = items.filter((c) => {
        const created = toMoment(c.created_at);
        if (!created) return false;
        if (fromM && created.isBefore(fromM)) return false;
        if (toM && created.isAfter(toM)) return false;
        return true;
      });
    }

    items = [...items].sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });

    const total = items.length;
    const start = (Math.max(1, page) - 1) * pageSize;
    const pageItems = items.slice(start, start + pageSize).map((c) => ({
      ...c,
      id: c.case_id,
    }));

    return { cases: pageItems, total };
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
  } = usePagination(fetchCases, { pageSize: PAGE_SIZE });

  useEffect(() => {
    goToPage(1).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, search, dateFrom, dateTo]);

  const handleOpen = async (row) => {
    try {
      await openDialog({
        title: "Open case?",
        message: `Open ${row.case_name || formatCaseId(row.case_id)}? If no lead is assigned, you will become the lead investigator.`,
        confirmLabel: "Open",
        variant: "primary",
      });
    } catch {
      return;
    }

    setActionBusy(row.case_id);
    try {
      await casesService.open(row.case_id);
      success("Case opened", `${row.case_name} is now open.`);
      await refresh();
    } catch (err) {
      notifyError(
        "Unable to open case",
        err?.message || "The case could not be opened."
      );
    } finally {
      setActionBusy(null);
    }
  };

  const handleClose = async (row) => {
    try {
      await openDialog({
        title: "Close case?",
        message: `Close ${row.case_name || formatCaseId(row.case_id)}? This seals linked evidence custody chains.`,
        confirmLabel: "Close",
        variant: "warning",
      });
    } catch {
      return;
    }

    setActionBusy(row.case_id);
    try {
      await casesService.close(row.case_id, {
        reason: "Closed from case list",
      });
      success("Case closed", `${row.case_name} has been closed.`);
      await refresh();
    } catch (err) {
      notifyError(
        "Unable to close case",
        err?.message || "The case could not be closed."
      );
    } finally {
      setActionBusy(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil((total || 0) / pageSize) || 1);
  const showPagination = !loading && total > pageSize;

  return (
    <Container fluid className="px-0">
      <PageHeader
        title="Cases"
        subtitle="Investigate and manage forensic cases"
        actions={
          canCreate ? (
            <Button
              variant="primary"
              onClick={() => history.push(Routes.CasesNew.path)}
            >
              <FontAwesomeIcon icon={faPlus} className="me-2" />
              New Case
            </Button>
          ) : null
        }
      />

      <Card border="light" className="shadow-sm mb-4">
        <Card.Body>
          <Row className="g-3 align-items-end">
            <Col xs={12} md={3}>
              <Form.Group className="mb-0">
                <Form.Label htmlFor="case-status-filter" className="small text-muted mb-1">
                  Status
                </Form.Label>
                <Form.Select
                  id="case-status-filter"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
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
            <Col xs={12} md={4}>
              <Form.Label htmlFor="case-search" className="small text-muted mb-1">
                Search
              </Form.Label>
              <SearchInput
                id="case-search"
                placeholder="Search by case name…"
                value={search}
                onChange={setSearch}
              />
            </Col>
            <Col xs={6} md={2}>
              <Form.Group className="mb-0">
                <Form.Label htmlFor="case-date-from" className="small text-muted mb-1">
                  From
                </Form.Label>
                <Datetime
                  value={dateFrom}
                  onChange={(value) => setDateFrom(toMoment(value))}
                  timeFormat={false}
                  inputProps={{
                    id: "case-date-from",
                    placeholder: "Start date",
                    className: "form-control",
                    "aria-label": "Filter from date",
                  }}
                />
              </Form.Group>
            </Col>
            <Col xs={6} md={2}>
              <Form.Group className="mb-0">
                <Form.Label htmlFor="case-date-to" className="small text-muted mb-1">
                  To
                </Form.Label>
                <Datetime
                  value={dateTo}
                  onChange={(value) => setDateTo(toMoment(value))}
                  timeFormat={false}
                  inputProps={{
                    id: "case-date-to",
                    placeholder: "End date",
                    className: "form-control",
                    "aria-label": "Filter to date",
                  }}
                />
              </Form.Group>
            </Col>
            <Col xs={12} md={1} className="d-flex">
              <Button
                variant="outline-secondary"
                className="w-100"
                onClick={() => {
                  setStatus("");
                  setSearch("");
                  setDateFrom(null);
                  setDateTo(null);
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
                  <SkeletonLoader type="text" rows={5} />
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>
      ) : data.length === 0 ? (
        <Card border="light" className="shadow-sm">
          <Card.Body>
            <EmptyState
              title="No cases found"
              description="Create your first case to begin an investigation."
            />
            {canCreate ? (
              <div className="text-center pb-2">
                <Button
                  variant="primary"
                  onClick={() => history.push(Routes.CasesNew.path)}
                >
                  <FontAwesomeIcon icon={faFolderPlus} className="me-2" />
                  Create first case
                </Button>
              </div>
            ) : null}
          </Card.Body>
        </Card>
      ) : (
        <>
          <Row className="g-3 mb-3" aria-label="Investigation cases">
            {data.map((row) => (
              <Col key={row.case_id} xs={12} md={6} xl={4}>
                <CaseCard
                  row={row}
                  busy={actionBusy === row.case_id}
                  canUpdate={canUpdate}
                  onOpen={handleOpen}
                  onClose={handleClose}
                />
              </Col>
            ))}
          </Row>

          {showPagination ? (
            <div className="d-flex justify-content-between align-items-center px-1 pb-2">
              <span className="small text-muted">
                Page {page} of {totalPages} ({total} total)
              </span>
              <nav aria-label="Cases pagination">
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

      <ConfirmDialog {...dialogProps} />
    </Container>
  );
}
