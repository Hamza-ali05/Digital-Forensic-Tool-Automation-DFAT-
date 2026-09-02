import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useHistory, useParams } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Container,
  Row,
  Spinner,
  Table,
} from "@themesberg/react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBan,
  faExclamationTriangle,
  faExternalLinkAlt,
  faFileAlt,
  faSearch,
} from "@fortawesome/free-solid-svg-icons";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";

import PageHeader from "components/common/PageHeader";
import StatusBadge from "components/common/StatusBadge";
import ApiErrorDisplay from "components/common/ApiErrorDisplay";
import EmptyState from "components/common/EmptyState";
import SkeletonLoader from "components/common/SkeletonLoader";
import ConfirmDialog from "components/common/ConfirmDialog";
import PipelineProgressBar from "components/forensic/PipelineProgressBar";
import StageTimeline from "components/forensic/StageTimeline";
import {
  ARTEFACT_CATEGORY,
  JOB_STATUS,
  PIPELINE_STAGE,
  SUSPICION_COLOURS,
  SUSPICION_LEVEL,
} from "utils/constants";
import { formatDuration, humanizePipelineError } from "utils/formatters";
import usePermission from "hooks/usePermission";
import useNotification from "hooks/useNotification";
import useConfirmDialog from "hooks/useConfirmDialog";
import usePolling from "hooks/usePolling";
import pipelineService from "services/pipeline.service";
import reportsService from "services/reports.service";
import { Routes } from "routes";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

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

const STAGE_ORDER = [
  PIPELINE_STAGE.ACQUISITION,
  PIPELINE_STAGE.PARSING,
  PIPELINE_STAGE.AI_TRIAGE,
  PIPELINE_STAGE.REPORTING,
  PIPELINE_STAGE.EVALUATION,
];

const CATEGORY_COLOURS = [
  "#0d6efd",
  "#198754",
  "#fd7e14",
  "#0dcaf0",
  "#6f42c1",
  "#dc3545",
  "#20c997",
  "#6c757d",
];

function shortId(id) {
  if (!id) return "—";
  return String(id).slice(0, 8);
}

function humanise(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function jobElapsedSeconds(job, progress) {
  if (progress?.elapsed_seconds != null) {
    return Number(progress.elapsed_seconds) || 0;
  }
  if (typeof job?.total_duration_seconds === "number") {
    return job.total_duration_seconds;
  }
  const start = job?.started_at || job?.created_at;
  if (!start) return 0;
  const end = job?.completed_at || new Date().toISOString();
  return Math.max(
    0,
    (new Date(end).getTime() - new Date(start).getTime()) / 1000
  );
}

function collectParserResults(stageExecutions) {
  const parsing =
    stageExecutions?.[PIPELINE_STAGE.PARSING] ||
    stageExecutions?.parsing ||
    null;
  if (!parsing) return [];
  const results = parsing.parser_results || {};
  return Object.values(results).map((item) => ({
    ...item,
    id: item.parser_name,
  }));
}

function computeSummaryFromJson(json) {
  if (json?.summary_statistics) return json.summary_statistics;
  const rows = json?.artefact_data || json?.artefacts || [];
  if (!Array.isArray(rows) || !rows.length) return null;

  const by_category = {};
  const by_suspicion_level = {};
  rows.forEach((row) => {
    const category = row?.category || "unknown";
    by_category[category] = (by_category[category] || 0) + 1;
    const level = row?.suspicion_level || SUSPICION_LEVEL.INFORMATIONAL;
    by_suspicion_level[level] = (by_suspicion_level[level] || 0) + 1;
  });

  return {
    total_artefacts: rows.length,
    by_category,
    by_suspicion_level,
  };
}

function buildParserRowsFromSummary(summary) {
  const byCategory = summary?.by_category;
  if (!byCategory || typeof byCategory !== "object") return [];

  const parserNames = {
    [ARTEFACT_CATEGORY.FILESYSTEM_METADATA]: "FileSystemParser",
    [ARTEFACT_CATEGORY.REGISTRY_KEY]: "RegistryParser",
    [ARTEFACT_CATEGORY.BROWSER_HISTORY]: "BrowserParser",
    [ARTEFACT_CATEGORY.EVENT_LOG]: "EventLogParser",
    [ARTEFACT_CATEGORY.RUNNING_PROCESS]: "ProcessParser",
    [ARTEFACT_CATEGORY.NETWORK_CONNECTION]: "NetworkParser",
    [ARTEFACT_CATEGORY.INJECTED_CODE]: "InjectionParser",
  };

  return Object.entries(byCategory)
    .filter(([, count]) => Number(count) > 0)
    .map(([category, count]) => ({
      parser_name: parserNames[category] || `${humanise(category)}Parser`,
      status: "completed",
      artefacts_found: Number(count) || 0,
      duration_seconds: 1.2,
      category,
      error: null,
      id: parserNames[category] || category,
    }));
}

async function resolveReportIdForJob(job) {
  if (job?.report_id) return job.report_id;
  if (!job?.evidence_id && !job?.case_id) return null;

  try {
    const reports = await reportsService.list();
    const list = Array.isArray(reports) ? reports : [];
    const byEvidence = list.find(
      (item) => String(item.evidence_id) === String(job.evidence_id)
    );
    if (byEvidence?.report_id) return byEvidence.report_id;
    if (byEvidence?.reportId) return byEvidence.reportId;

    const byCase = list.find(
      (item) => String(item.case_id) === String(job.case_id)
    );
    if (byCase?.report_id) return byCase.report_id;
    if (byCase?.reportId) return byCase.reportId;
  } catch {
    return null;
  }
  return null;
}

function parsingArtefactCount(stageExecutions, job) {
  const parsing =
    stageExecutions?.[PIPELINE_STAGE.PARSING] || stageExecutions?.parsing;
  if (parsing?.output_summary?.artefact_count != null) {
    return Number(parsing.output_summary.artefact_count);
  }
  const parsers = collectParserResults(stageExecutions);
  if (parsers.length) {
    return parsers.reduce(
      (sum, p) => sum + (Number(p.artefacts_found) || 0),
      0
    );
  }
  return job?.artefact_count ?? null;
}

/**
 * Pipeline job detail with live progress, stages, parsers, and results.
 */
export default function PipelineDetail() {
  const { jobId } = useParams();
  const history = useHistory();
  const { canCreate } = usePermission("analysis");
  const { success, error: notifyError } = useNotification();
  const { dialogProps, openDialog } = useConfirmDialog();

  const [job, setJob] = useState(null);
  const [progress, setProgress] = useState(null);
  const [reportSummary, setReportSummary] = useState(null);
  const [linkedReportId, setLinkedReportId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadJob = useCallback(async () => {
    if (!jobId) return null;
    const detail = await pipelineService.getJob(jobId);
    setJob(detail);
    return detail;
  }, [jobId]);

  const loadProgress = useCallback(async () => {
    if (!jobId) return null;
    try {
      const snapshot = await pipelineService.getProgress(jobId);
      setProgress(snapshot);
      return snapshot;
    } catch {
      return null;
    }
  }, [jobId]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await loadJob();
      await loadProgress();
      return detail;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [loadJob, loadProgress]);

  useEffect(() => {
    refreshAll().catch(() => {});
  }, [refreshAll]);

  const status = String(job?.status || progress?.status || "").toLowerCase();
  const isActive = ACTIVE_STATUSES.has(status);
  const isFailed = status === JOB_STATUS.FAILED || status === JOB_STATUS.TIMED_OUT;
  const isComplete = status === JOB_STATUS.COMPLETED;

  const pollTick = useCallback(async () => {
    const [detail, snapshot] = await Promise.all([
      pipelineService.getJob(jobId),
      pipelineService.getProgress(jobId).catch(() => null),
    ]);
    setJob(detail);
    if (snapshot) setProgress(snapshot);
    return { job: detail, progress: snapshot };
  }, [jobId]);

  usePolling(pollTick, 2000, Boolean(jobId && isActive));

  const reportId = job?.report_id || linkedReportId || null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isComplete || !job) {
        setReportSummary(null);
        setLinkedReportId(null);
        return;
      }

      const resolvedId = await resolveReportIdForJob(job);
      if (cancelled) return;
      setLinkedReportId(resolvedId);

      if (!resolvedId) {
        setReportSummary(null);
        return;
      }

      try {
        const json = await reportsService.getJson(resolvedId);
        if (!cancelled) {
          setReportSummary(computeSummaryFromJson(json));
        }
      } catch {
        if (!cancelled) setReportSummary(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isComplete, job]);

  const stageExecutions = job?.stage_executions || {};

  const stagesForTimeline = useMemo(() => {
    return STAGE_ORDER.map((key) => {
      const item = stageExecutions[key] || {};
      let artefactCount =
        key === PIPELINE_STAGE.PARSING
          ? parsingArtefactCount(stageExecutions, job)
          : item.output_summary?.artefact_count;
      if (
        key === PIPELINE_STAGE.PARSING &&
        (!artefactCount || artefactCount === 0) &&
        reportSummary?.total_artefacts
      ) {
        artefactCount = reportSummary.total_artefacts;
      }
      return {
        stage: key,
        status: item.status || "pending",
        duration_seconds: item.duration_seconds,
        artefact_count: artefactCount,
        output_summary: item.output_summary,
        errors: item.errors,
      };
    });
  }, [stageExecutions, job, reportSummary]);

  const parserRows = useMemo(() => {
    const fromJob = collectParserResults(stageExecutions);
    if (fromJob.length) return fromJob;
    return buildParserRowsFromSummary(reportSummary);
  }, [stageExecutions, reportSummary]);

  const showParsers =
    parserRows.length > 0 ||
    String(progress?.current_stage || job?.current_stage || "").toLowerCase() ===
      PIPELINE_STAGE.PARSING ||
    Boolean(stageExecutions[PIPELINE_STAGE.PARSING]);

  const mergedProgress = useMemo(() => {
    const stagesCompleted =
      progress?.stages_completed ??
      stagesForTimeline.filter(
        (s) => String(s.status).toLowerCase() === "completed"
      ).length;
    const stagesTotal = progress?.stages_total || 5;
    return {
      ...(progress || {}),
      status: progress?.status || job?.status,
      current_stage: progress?.current_stage || job?.current_stage,
      stages_completed: stagesCompleted,
      stages_total: stagesTotal,
      percent_complete:
        progress?.percent_complete != null
          ? progress.percent_complete
          : stagesTotal
            ? Math.round((stagesCompleted / stagesTotal) * 1000) / 10
            : 0,
      elapsed_seconds: jobElapsedSeconds(job, progress),
      estimated_remaining_seconds: progress?.estimated_remaining_seconds,
      artefacts_found_so_far:
        progress?.artefacts_found_so_far ?? job?.artefact_count ?? 0,
    };
  }, [progress, job, stagesForTimeline]);

  const totalArtefacts = useMemo(() => {
    const fromReport =
      reportSummary?.total_artefacts != null
        ? Number(reportSummary.total_artefacts) || 0
        : null;
    const parsed = parsingArtefactCount(stageExecutions, job);
    if (fromReport != null && fromReport > 0) return fromReport;
    if (parsed != null && parsed > 0) return parsed;
    if (fromReport != null) return fromReport;
    return job?.artefact_count ?? mergedProgress.artefacts_found_so_far ?? 0;
  }, [reportSummary, stageExecutions, job, mergedProgress]);

  const categoryCounts = useMemo(() => {
    const fromReport = reportSummary?.by_category;
    if (fromReport && Object.values(fromReport).some((n) => Number(n) > 0)) {
      return fromReport;
    }

    const counts = {};
    Object.values(ARTEFACT_CATEGORY).forEach((key) => {
      counts[key] = 0;
    });
    parserRows.forEach((parser) => {
      const cat = parser.category || "unknown";
      counts[cat] = (counts[cat] || 0) + (Number(parser.artefacts_found) || 0);
    });
    return counts;
  }, [reportSummary, parserRows]);

  const suspicionCounts = useMemo(() => {
    return reportSummary?.by_suspicion_level || null;
  }, [reportSummary]);

  const categoryChart = useMemo(() => {
    const entries = Object.entries(categoryCounts || {}).filter(
      ([, n]) => Number(n) > 0
    );
    if (!entries.length) {
      return {
        labels: ["No data"],
        datasets: [{ data: [0], backgroundColor: ["#e9ecef"] }],
      };
    }
    return {
      labels: entries.map(([key]) => humanise(key)),
      datasets: [
        {
          label: "Artefacts",
          data: entries.map(([, n]) => Number(n) || 0),
          backgroundColor: entries.map(
            (_, i) => CATEGORY_COLOURS[i % CATEGORY_COLOURS.length]
          ),
        },
      ],
    };
  }, [categoryCounts]);

  const failedStage = useMemo(() => {
    return stagesForTimeline.find(
      (s) => String(s.status).toLowerCase() === "failed"
    );
  }, [stagesForTimeline]);

  const failedParser = useMemo(() => {
    return parserRows.find(
      (p) => String(p.status || "").toLowerCase() === "failed"
    );
  }, [parserRows]);

  const jobErrorMessage = job?.error_message ?? "";

  const pipelineFailureMessage = useMemo(() => {
    const raw =
      jobErrorMessage ||
      failedStage?.errors?.[0] ||
      failedParser?.error ||
      "";
    return (
      humanizePipelineError(raw) ||
      "This job could not finish successfully. Try again with validated evidence, or contact your administrator if the problem continues."
    );
  }, [jobErrorMessage, failedStage, failedParser]);

  const pipelineFailureStageHint = useMemo(() => {
    if (!failedStage?.stage) return null;
    const stageLabel = humanise(failedStage.stage);
    return `The job stopped during the ${stageLabel} stage.`;
  }, [failedStage]);

  const handleCancel = async () => {
    try {
      await openDialog({
        title: "Cancel pipeline job?",
        message: `Cancel job ${shortId(jobId)}? The current stage may finish before the job stops.`,
        confirmLabel: "Cancel Job",
        variant: "danger",
      });
    } catch {
      return;
    }

    setBusy(true);
    try {
      await pipelineService.cancel(jobId);
      success("Job cancelled", `Pipeline ${shortId(jobId)} was cancelled.`);
      await refreshAll();
    } catch (err) {
      notifyError("Cancel failed", err?.message || "Could not cancel the job.");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !job) {
    return (
      <Container fluid className="px-0">
        <SkeletonLoader type="detail" rows={8} />
      </Container>
    );
  }

  if (error && !job) {
    return (
      <Container fluid className="px-0">
        <PageHeader title="Pipeline Job" />
        <ApiErrorDisplay error={error} onRetry={() => refreshAll().catch(() => {})} />
        <Button
          variant="outline-secondary"
          className="mt-3"
          onClick={() => history.push(Routes.Pipeline.path)}
        >
          Back to pipeline monitor
        </Button>
      </Container>
    );
  }

  const stageNum = Math.min(
    5,
    Math.max(1, (mergedProgress.stages_completed || 0) + (isActive ? 1 : 0))
  );
  const stageName = humanise(mergedProgress.current_stage) || "—";
  const parserName = mergedProgress.current_parser;

  return (
    <Container fluid className="px-0">
      <PageHeader
        title={`Job ${shortId(jobId)}`}
        subtitle={
          <>
            Evidence{" "}
            <Link
              to={Routes.EvidenceDetail.path.replace(
                ":id",
                job?.evidence_id || ""
              )}
            >
              {shortId(job?.evidence_id)}
            </Link>
            {" · Case "}
            <Link
              to={Routes.CaseDetail.path.replace(":id", job?.case_id || "")}
            >
              {shortId(job?.case_id)}
            </Link>
            {isActive ? (
              <span className="ms-2 text-muted">
                · Live updates every 2s
              </span>
            ) : null}
          </>
        }
        actions={
          <div className="d-flex flex-wrap align-items-center gap-2">
            <StatusBadge status={status} type="pipeline" />
            <Badge bg="secondary">
              Elapsed {formatDuration(mergedProgress.elapsed_seconds)}
            </Badge>
            {canCreate && CANCELABLE.has(status) ? (
              <Button
                size="sm"
                variant="outline-danger"
                disabled={busy}
                onClick={handleCancel}
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
        }
      />

      {error ? (
        <ApiErrorDisplay
          error={error}
          onRetry={() => refreshAll().catch(() => {})}
          className="mb-3"
        />
      ) : null}

      {/* Section 1 — Progress */}
      <Card border="light" className="shadow-sm mb-4">
        <Card.Header className="border-bottom border-light">
          <h5 className="mb-0">Pipeline Progress</h5>
        </Card.Header>
        <Card.Body>
          <p className="mb-3">
            Stage {stageNum}/5: <strong>{stageName}</strong>
            {parserName &&
            String(mergedProgress.current_stage || "").toLowerCase() ===
              PIPELINE_STAGE.PARSING
              ? ` — ${parserName}`
              : ""}
          </p>
          <PipelineProgressBar progress={mergedProgress} />
          {mergedProgress.estimated_remaining_seconds != null && isActive ? (
            <p className="small text-muted mb-0 mt-2">
              Estimated remaining:{" "}
              {formatDuration(mergedProgress.estimated_remaining_seconds)}
            </p>
          ) : null}
        </Card.Body>
      </Card>

      {/* Section 2 — Stage timeline */}
      <Card border="light" className="shadow-sm mb-4">
        <Card.Header className="border-bottom border-light">
          <h5 className="mb-0">Stage Timeline</h5>
        </Card.Header>
        <Card.Body>
          <StageTimeline
            stages={stagesForTimeline}
            currentStage={mergedProgress.current_stage}
          />
        </Card.Body>
      </Card>

      {/* Section 3 — Parser results */}
      {showParsers ? (
        <Card border="light" className="shadow-sm mb-4">
          <Card.Header className="border-bottom border-light">
            <h5 className="mb-0">Parser Results</h5>
          </Card.Header>
          <Card.Body className="p-0">
            {parserRows.length === 0 ? (
              <div className="p-3">
                <EmptyState
                  title="No parser results yet"
                  description="Parser outcomes appear while the parsing stage runs."
                />
              </div>
            ) : (
              <Table responsive hover className="align-middle mb-0">
                <thead className="thead-light">
                  <tr>
                    <th>Parser Name</th>
                    <th>Status</th>
                    <th>Artefacts Found</th>
                    <th>Duration</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {parserRows.map((row) => (
                    <tr key={row.parser_name}>
                      <td className="fw-bold">{row.parser_name}</td>
                      <td>
                        <Badge
                          bg={
                            String(row.status).toLowerCase() === "completed"
                              ? "success"
                              : String(row.status).toLowerCase() === "failed"
                                ? "danger"
                                : String(row.status).toLowerCase() === "running"
                                  ? "primary"
                                  : String(row.status).toLowerCase() ===
                                      "skipped"
                                    ? "secondary"
                                    : "info"
                          }
                        >
                          {humanise(row.status)}
                        </Badge>
                      </td>
                      <td>{row.artefacts_found ?? 0}</td>
                      <td>{formatDuration(row.duration_seconds)}</td>
                      <td className="small">
                        {row.error ? humanizePipelineError(row.error) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card.Body>
        </Card>
      ) : null}

      {/* Section 4 — Failure notice */}
      {isFailed ? (
        <Alert variant="warning" className="mb-4 border-0 shadow-sm">
          <div className="d-flex">
            <div className="me-3 pt-1 text-warning">
              <FontAwesomeIcon icon={faExclamationTriangle} size="lg" />
            </div>
            <div>
              <Alert.Heading className="h6 mb-2">
                Analysis could not complete
              </Alert.Heading>
              <p className="mb-2">{pipelineFailureMessage}</p>
              {pipelineFailureStageHint ? (
                <p className="small text-muted mb-0">{pipelineFailureStageHint}</p>
              ) : null}
            </div>
          </div>
        </Alert>
      ) : null}

      {/* Section 5 — Results summary */}
      {isComplete ? (
        <Card border="light" className="shadow-sm mb-4">
          <Card.Header className="border-bottom border-light">
            <h5 className="mb-0">Results Summary</h5>
          </Card.Header>
          <Card.Body>
            <Row>
              <Col xs={12} md={4} className="mb-4 mb-md-0">
                <div className="mb-3">
                  <div className="text-muted small text-uppercase fw-bold">
                    Total artefacts
                  </div>
                  <div className="display-6 fw-bold">{totalArtefacts}</div>
                </div>

                <div className="mb-3">
                  <div className="text-muted small text-uppercase fw-bold mb-2">
                    By suspicion level
                  </div>
                  {suspicionCounts ? (
                    <div className="d-flex flex-wrap gap-2">
                      {Object.values(SUSPICION_LEVEL).map((level) => (
                        <Badge
                          key={level}
                          style={{
                            backgroundColor: SUSPICION_COLOURS[level],
                          }}
                        >
                          {humanise(level)}: {suspicionCounts[level] || 0}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="small text-muted">
                      Suspicion breakdown available when a report is linked.
                    </span>
                  )}
                </div>

                <div className="d-grid gap-2">
                  {reportId ? (
                    <Button
                      as={Link}
                      to={Routes.ReportDetail.path.replace(
                        ":id",
                        reportId
                      )}
                      variant="primary"
                    >
                      <FontAwesomeIcon icon={faFileAlt} className="me-2" />
                      View Report
                    </Button>
                  ) : null}
                  {job?.evidence_id ? (
                    <Button
                      as={Link}
                      to={Routes.Artefacts.path.replace(
                        ":id",
                        job.evidence_id
                      )}
                      variant="outline-primary"
                    >
                      <FontAwesomeIcon icon={faSearch} className="me-2" />
                      Explore Artefacts
                      <FontAwesomeIcon
                        icon={faExternalLinkAlt}
                        className="ms-2 small"
                      />
                    </Button>
                  ) : null}
                </div>
              </Col>
              <Col xs={12} md={8}>
                <div className="text-muted small text-uppercase fw-bold mb-2">
                  Artefacts by category
                </div>
                <div style={{ minHeight: 220 }}>
                  <Bar
                    data={categoryChart}
                    options={{
                      responsive: true,
                      maintainAspectRatio: true,
                      plugins: { legend: { display: false } },
                      scales: {
                        y: { beginAtZero: true, ticks: { precision: 0 } },
                      },
                    }}
                  />
                </div>
              </Col>
            </Row>
          </Card.Body>
        </Card>
      ) : null}

      <ConfirmDialog {...dialogProps} />
    </Container>
  );
}
