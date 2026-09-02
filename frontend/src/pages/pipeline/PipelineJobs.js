import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useHistory } from "react-router-dom";
import {
  Button,
  Card,
  Col,
  Container,
  Form,
  Pagination,
  ProgressBar,
  Row,
  Spinner,
} from "@themesberg/react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBan,
  faClock,
  faEye,
  faFolderOpen,
  faLayerGroup,
  faPlay,
  faPlus,
  faStopwatch,
} from "@fortawesome/free-solid-svg-icons";
import Datetime from "react-datetime";
import moment from "moment-timezone";

import PageHeader from "components/common/PageHeader";
import StatusBadge from "components/common/StatusBadge";
import ApiErrorDisplay from "components/common/ApiErrorDisplay";
import ConfirmDialog from "components/common/ConfirmDialog";
import EmptyState from "components/common/EmptyState";
import SkeletonLoader from "components/common/SkeletonLoader";
import PipelineProgressBar from "components/forensic/PipelineProgressBar";
import { JOB_STATUS } from "utils/constants";
import {
  formatCaseId,
  formatDateRelative,
  formatDuration,
  formatEvidenceId,
  formatJobId,
  humanizeFileName,
  humanizeLabel,
} from "utils/formatters";
import config from "config";
import usePermission from "hooks/usePermission";
import useNotification from "hooks/useNotification";
import useConfirmDialog from "hooks/useConfirmDialog";
import usePolling from "hooks/usePolling";
import pipelineService from "services/pipeline.service";
import {
  buildCaseMap,
  buildEvidenceMap,
  fetchCasesCached,
  fetchEvidenceInventoryCached,
  fetchPipelineJobsCached,
  normaliseCasesList,
} from "services/referenceData";
import { Routes } from "routes";

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: JOB_STATUS.QUEUED, label: "Queued" },
  { value: JOB_STATUS.RUNNING, label: "Running" },
  { value: JOB_STATUS.COMPLETED, label: "Completed" },
  { value: JOB_STATUS.FAILED, label: "Failed" },
  { value: JOB_STATUS.CANCELLED, label: "Cancelled" },
];

const ACTIVE_STATUSES = new Set([
  JOB_STATUS.QUEUED,
  JOB_STATUS.INITIALISING,
  JOB_STATUS.RUNNING,
  JOB_STATUS.STAGE_COMPLETE,
  "initializing",
  "in_progress",
]);

const CANCELABLE = new Set([
  JOB_STATUS.QUEUED,
  JOB_STATUS.INITIALISING,
  JOB_STATUS.RUNNING,
  JOB_STATUS.STAGE_COMPLETE,
  "initializing",
]);

const PAGE_SIZE = 6;

function toMoment(value) {
  if (!value) return null;
  if (moment.isMoment(value)) return value.isValid() ? value : null;
  const m = moment(value);
  return m.isValid() ? m : null;
}

function modeLabel(mode) {
  const m = String(mode || "full").toLowerCase();
  if (m === "parse-only") return "Parse Only";
  if (m === "triage-only") return "Triage Only";
  return "Full";
}

function jobDurationSeconds(job) {
  if (typeof job.total_duration_seconds === "number") {
    return job.total_duration_seconds;
  }
  const start = job.started_at || job.created_at;
  if (!start) return 0;
  const end = job.completed_at || new Date().toISOString();
  return Math.max(
    0,
    (new Date(end).getTime() - new Date(start).getTime()) / 1000
  );
}

function synthesiseProgress(job) {
  const status = String(job.status || "").toLowerCase();
  const stages = job.stage_executions || {};
  const stageKeys = Object.keys(stages);
  const completed = stageKeys.filter(
    (key) => String(stages[key]?.status || "").toLowerCase() === "completed"
  ).length;
  const total = 5;
  let percent = 0;
  if (status === JOB_STATUS.COMPLETED) percent = 100;
  else if (status === JOB_STATUS.FAILED) percent = Math.max(10, (completed / total) * 100);
  else if (ACTIVE_STATUSES.has(status)) {
    percent = Math.min(95, (completed / total) * 100 + (status === JOB_STATUS.RUNNING ? 10 : 0));
  }
  return {
    job_id: job.job_id,
    status: job.status,
    current_stage: job.current_stage,
    stages_completed: completed,
    stages_total: total,
    percent_complete: Math.round(percent * 10) / 10,
    current_parser: null,
    elapsed_seconds: jobDurationSeconds(job),
    estimated_remaining_seconds: null,
    artefacts_found_so_far: job.artefact_count || 0,
  };
}

function renderJobProgress(job, progressMap) {
  const status = String(job.status || "").toLowerCase();
  if (status === JOB_STATUS.COMPLETED) {
    return <ProgressBar now={100} variant="success" style={{ height: 8 }} />;
  }
  if (status === JOB_STATUS.FAILED) {
    return <ProgressBar now={100} variant="danger" style={{ height: 8 }} />;
  }
  if (!ACTIVE_STATUSES.has(status)) {
    return <span className="small text-muted">—</span>;
  }
  const progress = progressMap[job.job_id] || synthesiseProgress(job);
  return <PipelineProgressBar progress={progress} compact />;
}

function PipelineJobCard({
  job,
  evidenceMap,
  caseMap,
  progressMap,
  busy,
  canCreate,
  onCancel,
}) {
  const status = String(job.status || "").toLowerCase();
  const detailPath = Routes.PipelineDetail.path.replace(":jobId", job.job_id);
  const ev = evidenceMap[job.evidence_id];
  const c = caseMap[job.case_id];
  const evidenceLabel = humanizeFileName(
    ev?.file_name,
    formatEvidenceId(job.evidence_id)
  );
  const caseLabel = humanizeLabel(
    c?.case_name || job.case_name,
    formatCaseId(job.case_id)
  );
  const artefactCount =
    progressMap[job.job_id]?.artefacts_found_so_far ?? job.artefact_count ?? 0;

  return (
    <Card border="light" className="shadow-sm h-100">
      <Card.Body className="d-flex flex-column">
        <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
          <Link
            to={detailPath}
            className="fw-bold text-decoration-none"
            title={job.job_id}
          >
            {formatJobId(job.job_id)}
          </Link>
          <StatusBadge status={job.status} type="pipeline" />
        </div>

        <h5 className="h6 mb-3">
          <Link
            to={Routes.EvidenceDetail.path.replace(":id", job.evidence_id)}
            className="text-dark text-decoration-none"
            title={ev?.file_name || job.evidence_id}
          >
            {evidenceLabel}
          </Link>
        </h5>

        <div className="mb-3">
          <span className="small text-muted text-uppercase fw-bold">Mode</span>
          <div>{modeLabel(job.mode)}</div>
        </div>

        <div className="mb-3">
          <span className="small text-muted text-uppercase fw-bold">Progress</span>
          <div className="mt-1">{renderJobProgress(job, progressMap)}</div>
        </div>

        <ul className="list-unstyled small text-muted mb-3 flex-grow-1">
          <li className="d-flex align-items-start mb-2">
            <FontAwesomeIcon icon={faFolderOpen} className="me-2 mt-1" />
            <span>
              <span className="text-uppercase" style={{ fontSize: "0.7rem" }}>
                Case
              </span>
              <br />
              <Link
                to={Routes.CaseDetail.path.replace(":id", job.case_id)}
                className="text-dark"
                title={c?.case_name || job.case_id}
              >
                {caseLabel}
              </Link>
            </span>
          </li>
          <li className="d-flex align-items-center mb-2">
            <FontAwesomeIcon icon={faStopwatch} className="me-2" />
            <span>
              <span className="text-uppercase" style={{ fontSize: "0.7rem" }}>
                Duration
              </span>
              <br />
              <span className="text-dark">
                {formatDuration(jobDurationSeconds(job))}
              </span>
            </span>
          </li>
          <li className="d-flex align-items-center mb-2">
            <FontAwesomeIcon icon={faLayerGroup} className="me-2" />
            <span>
              <span className="text-uppercase" style={{ fontSize: "0.7rem" }}>
                Artefacts Found
              </span>
              <br />
              <span className="text-dark">{artefactCount}</span>
            </span>
          </li>
          <li className="d-flex align-items-center">
            <FontAwesomeIcon icon={faClock} className="me-2" />
            <span>
              <span className="text-uppercase" style={{ fontSize: "0.7rem" }}>
                Started
              </span>
              <br />
              <span className="text-dark">
                {formatDateRelative(job.started_at || job.created_at)}
              </span>
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
          {canCreate && CANCELABLE.has(status) ? (
            <Button
              variant="outline-danger"
              size="sm"
              disabled={busy}
              onClick={() => onCancel(job)}
              title="Cancel job"
            >
              {busy ? (
                <Spinner animation="border" size="sm" className="me-1" />
              ) : (
                <FontAwesomeIcon icon={faBan} className="me-1" />
              )}
              Cancel
            </Button>
          ) : null}
        </div>
      </Card.Body>
    </Card>
  );
}

/**
 * Pipeline job monitor with filters, progress, and cancel actions.
 */
export default function PipelineJobs() {
  const history = useHistory();
  const { canCreate } = usePermission("analysis");
  const { success, error: notifyError } = useNotification();
  const { dialogProps, openDialog } = useConfirmDialog();

  const [cases, setCases] = useState([]);
  const [evidenceMap, setEvidenceMap] = useState({});
  const [caseMap, setCaseMap] = useState({});
  const [statusFilter, setStatusFilter] = useState("");
  const [caseFilter, setCaseFilter] = useState("");
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [progressMap, setProgressMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [actionBusy, setActionBusy] = useState(null);

  const filtersRef = useRef({ statusFilter, caseFilter, dateFrom, dateTo });
  filtersRef.current = { statusFilter, caseFilter, dateFrom, dateTo };
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    Promise.all([fetchCasesCached(), fetchEvidenceInventoryCached()])
      .then(([caseResult, inventoryResult]) => {
        if (cancelled || !mountedRef.current) return;
        const items = normaliseCasesList(caseResult);
        setCases(items);
        setCaseMap(buildCaseMap(items));
        setEvidenceMap(buildEvidenceMap(inventoryResult?.items || inventoryResult));
      })
      .catch(() => {
        if (cancelled || !mountedRef.current) return;
        setCases([]);
        setCaseMap({});
        setEvidenceMap({});
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const applyClientFilters = useCallback((list) => {
    const { statusFilter: status, caseFilter: caseId, dateFrom: from, dateTo: to } =
      filtersRef.current;
    let items = Array.isArray(list) ? [...list] : [];

    if (status) {
      if (status === JOB_STATUS.RUNNING) {
        items = items.filter((job) =>
          ACTIVE_STATUSES.has(String(job.status || "").toLowerCase())
        );
      } else {
        items = items.filter(
          (job) => String(job.status || "").toLowerCase() === status
        );
      }
    }
    if (caseId) {
      items = items.filter((job) => job.case_id === caseId);
    }

    const fromM = toMoment(from)?.startOf("day");
    const toM = toMoment(to)?.endOf("day");
    if (fromM || toM) {
      items = items.filter((job) => {
        const stamp = toMoment(job.started_at || job.created_at);
        if (!stamp) return false;
        if (fromM && stamp.isBefore(fromM)) return false;
        if (toM && stamp.isAfter(toM)) return false;
        return true;
      });
    }

    items.sort((a, b) => {
      const ta = new Date(a.started_at || a.created_at || 0).getTime();
      const tb = new Date(b.started_at || b.created_at || 0).getTime();
      return tb - ta;
    });
    return items;
  }, []);

  const fetchJobs = useCallback(async () => {
    const { statusFilter: status, caseFilter: caseId } = filtersRef.current;
    const params = {};
    // Server supports exact status; "Running" UI filter includes several active states client-side
    if (status && status !== JOB_STATUS.RUNNING) params.status = status;
    if (caseId) params.case_id = caseId;

    const list = await fetchPipelineJobsCached(params);
    return applyClientFilters(list);
  }, [applyClientFilters]);

  const pageRef = useRef(1);
  pageRef.current = page;
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const refreshProgress = useCallback(async (jobList, onlyJobIds = null) => {
    let active = (jobList || []).filter((job) =>
      ACTIVE_STATUSES.has(String(job.status || "").toLowerCase())
    );
    if (onlyJobIds && onlyJobIds.size) {
      active = active.filter((job) => onlyJobIds.has(job.job_id));
    }
    if (!active.length) {
      if (mountedRef.current) setProgressMap((prev) => (onlyJobIds ? prev : {}));
      return {};
    }
    const entries = await Promise.all(
      active.map(async (job) => {
        try {
          const progress = await pipelineService.getProgress(job.job_id);
          return [job.job_id, progress];
        } catch {
          return [job.job_id, synthesiseProgress(job)];
        }
      })
    );
    if (!mountedRef.current) return {};
    const next = {};
    entries.forEach(([id, progress]) => {
      next[id] = progress;
    });
    setProgressMap(next);
    return next;
  }, []);

  const loadJobs = useCallback(async () => {
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const filtered = await fetchJobs();
      if (!mountedRef.current) return filtered;
      setJobs(filtered);
      const start = (Math.max(1, pageRef.current) - 1) * PAGE_SIZE;
      const visibleIds = new Set(
        filtered.slice(start, start + PAGE_SIZE).map((job) => job.job_id)
      );
      await refreshProgress(filtered, visibleIds);
      return filtered;
    } catch (err) {
      if (mountedRef.current) setError(err);
      throw err;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [fetchJobs, refreshProgress]);

  useEffect(() => {
    let cancelled = false;
    setPage(1);
    loadJobs().catch(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, caseFilter, dateFrom, dateTo]);

  const hasRunning = useMemo(
    () =>
      jobs.some((job) =>
        ACTIVE_STATUSES.has(String(job.status || "").toLowerCase())
      ),
    [jobs]
  );

  const pollJobs = useCallback(async () => {
    const filtered = await fetchJobs();
    if (!mountedRef.current) return filtered;
    setJobs(filtered);
    const start = (Math.max(1, pageRef.current) - 1) * PAGE_SIZE;
    const visibleIds = new Set(
      filtered.slice(start, start + PAGE_SIZE).map((job) => job.job_id)
    );
    await refreshProgress(filtered, visibleIds);
    return filtered;
  }, [fetchJobs, refreshProgress]);

  usePolling(pollJobs, config.pollingInterval || 30000, hasRunning);

  useEffect(() => {
    const jobList = jobsRef.current;
    if (!jobList.length) return undefined;
    const start = (Math.max(1, page) - 1) * PAGE_SIZE;
    const visibleIds = new Set(
      jobList.slice(start, start + PAGE_SIZE).map((job) => job.job_id)
    );
    refreshProgress(jobList, visibleIds).catch(() => {});
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const pagedJobs = useMemo(() => {
    const start = (Math.max(1, page) - 1) * PAGE_SIZE;
    return jobs.slice(start, start + PAGE_SIZE);
  }, [jobs, page]);

  const totalPages = Math.max(1, Math.ceil(jobs.length / PAGE_SIZE));
  const showPagination = !loading && jobs.length > PAGE_SIZE;

  const handleCancel = async (job) => {
    try {
      await openDialog({
        title: "Cancel pipeline job?",
        message: `Cancel job ${formatJobId(job.job_id)}? In-flight stage work may stop after the current step.`,
        confirmLabel: "Cancel Job",
        variant: "danger",
      });
    } catch {
      return;
    }

    setActionBusy(job.job_id);
    try {
      await pipelineService.cancel(job.job_id);
      if (!mountedRef.current) return;
      success("Job cancelled", `Pipeline ${formatJobId(job.job_id)} was cancelled.`);
      await loadJobs();
    } catch (err) {
      if (!mountedRef.current) return;
      notifyError("Cancel failed", err?.message || "Could not cancel the job.");
    } finally {
      if (mountedRef.current) setActionBusy(null);
    }
  };

  return (
    <Container fluid className="px-0">
      <PageHeader
        title="Pipeline Monitor"
        subtitle="Track forensic analysis jobs and launch new pipeline runs"
        actions={
          canCreate ? (
            <Button
              variant="primary"
              onClick={() => history.push(Routes.PipelineRun.path)}
            >
              <FontAwesomeIcon icon={faPlus} className="me-2" />
              Run Pipeline
            </Button>
          ) : null
        }
      />

      <Card border="light" className="shadow-sm mb-4">
        <Card.Body>
          <Row className="g-3 align-items-end">
            <Col xs={12} md={3}>
              <Form.Group className="mb-0">
                <Form.Label className="small text-muted mb-1">Status</Form.Label>
                <Form.Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value || "all"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col xs={12} md={3}>
              <Form.Group className="mb-0">
                <Form.Label className="small text-muted mb-1">Case</Form.Label>
                <Form.Select
                  value={caseFilter}
                  onChange={(e) => setCaseFilter(e.target.value)}
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
            <Col xs={6} md={2}>
              <Form.Group className="mb-0">
                <Form.Label className="small text-muted mb-1">From</Form.Label>
                <Datetime
                  value={dateFrom}
                  onChange={(value) => setDateFrom(toMoment(value))}
                  timeFormat={false}
                  inputProps={{
                    placeholder: "Start date",
                    className: "form-control",
                  }}
                />
              </Form.Group>
            </Col>
            <Col xs={6} md={2}>
              <Form.Group className="mb-0">
                <Form.Label className="small text-muted mb-1">To</Form.Label>
                <Datetime
                  value={dateTo}
                  onChange={(value) => setDateTo(toMoment(value))}
                  timeFormat={false}
                  inputProps={{
                    placeholder: "End date",
                    className: "form-control",
                  }}
                />
              </Form.Group>
            </Col>
            <Col xs={12} md={2}>
              <Button
                variant="outline-secondary"
                className="w-100"
                onClick={() => {
                  setStatusFilter("");
                  setCaseFilter("");
                  setDateFrom(null);
                  setDateTo(null);
                }}
              >
                Reset
              </Button>
            </Col>
          </Row>
          {hasRunning ? (
            <p className="small text-muted mb-0 mt-3">
              Auto-refreshing every 5 seconds while jobs are running.
            </p>
          ) : null}
        </Card.Body>
      </Card>

      {error ? (
        <ApiErrorDisplay
          error={error}
          onRetry={() => loadJobs().catch(() => {})}
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
      ) : jobs.length === 0 ? (
        <Card border="light" className="shadow-sm">
          <Card.Body>
            <EmptyState
              title="No pipeline jobs found"
              description="Run a pipeline against validated evidence to begin."
            />
            {canCreate ? (
              <div className="text-center pb-2">
                <Button
                  variant="primary"
                  onClick={() => history.push(Routes.PipelineRun.path)}
                >
                  <FontAwesomeIcon icon={faPlay} className="me-2" />
                  Run first pipeline
                </Button>
              </div>
            ) : null}
          </Card.Body>
        </Card>
      ) : (
        <>
          <Row className="g-3 mb-3" aria-label="Pipeline jobs">
            {pagedJobs.map((job) => (
              <Col key={job.job_id} xs={12} md={6} xl={4}>
                <PipelineJobCard
                  job={job}
                  evidenceMap={evidenceMap}
                  caseMap={caseMap}
                  progressMap={progressMap}
                  busy={actionBusy === job.job_id}
                  canCreate={canCreate}
                  onCancel={handleCancel}
                />
              </Col>
            ))}
          </Row>

          {showPagination ? (
            <div className="d-flex justify-content-between align-items-center px-1 pb-2">
              <span className="small text-muted">
                Page {page} of {totalPages} ({jobs.length} total)
              </span>
              <nav aria-label="Pipeline jobs pagination">
                <Pagination className="mb-0">
                  <Pagination.Prev
                    disabled={page <= 1}
                    aria-label="Previous page"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  />
                  <Pagination.Item active aria-current="page">
                    {page}
                  </Pagination.Item>
                  <Pagination.Next
                    disabled={page >= totalPages}
                    aria-label="Next page"
                    onClick={() =>
                      setPage((current) => Math.min(totalPages, current + 1))
                    }
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
