import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Container,
  Pagination,
  Row,
  Spinner,
} from "@themesberg/react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheckCircle,
  faClock,
  faCode,
  faDatabase,
  faEye,
  faFileAlt,
  faFilePdf,
  faFolderOpen,
  faShieldAlt,
  faStopwatch,
  faTimesCircle,
} from "@fortawesome/free-solid-svg-icons";

import PageHeader from "components/common/PageHeader";
import ApiErrorDisplay from "components/common/ApiErrorDisplay";
import EmptyState from "components/common/EmptyState";
import SkeletonLoader from "components/common/SkeletonLoader";
import { formatDate, formatDuration } from "utils/formatters";
import useNotification from "hooks/useNotification";
import { fetchReportsCached } from "services/referenceData";
import reportsService from "services/reports.service";
import { Routes } from "routes";

const PAGE_SIZE = 6;

function shortId(id) {
  if (!id) return "—";
  return String(id).slice(0, 8);
}

function resolveAiModel(report) {
  const model = report?.llm_model_used;
  if (model && model !== "none") return model;
  return model || "LLaMA-3";
}

function VerifyFlag({ ok, label }) {
  return (
    <span className="d-inline-flex align-items-center me-3">
      <FontAwesomeIcon
        icon={ok ? faCheckCircle : faTimesCircle}
        className={`me-1 ${ok ? "text-success" : "text-danger"}`}
      />
      <span className={ok ? "text-success" : "text-danger"}>{label}</span>
    </span>
  );
}

function ReportCard({ row, busy, onExport, onVerify }) {
  const detailPath = Routes.ReportDetail.path.replace(":id", row.report_id);
  const isBusy = busy?.id === row.report_id;
  const spinning = (kind) => isBusy && busy.kind === kind;

  return (
    <Card border="light" className="shadow-sm h-100">
      <Card.Body className="d-flex flex-column">
        <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
          <Link
            to={detailPath}
            className="fw-bold text-decoration-none"
            title={row.report_id}
          >
            {shortId(row.report_id)}
          </Link>
          {row.use_fallback ? (
            <Badge bg="warning" text="dark">
              Fallback
            </Badge>
          ) : null}
        </div>

        <h5 className="h6 mb-3">
          <Link
            to={detailPath}
            className="text-dark text-decoration-none"
            title={row.case_name}
          >
            {row.case_name || "—"}
          </Link>
        </h5>

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
                  title={row.case_name}
                >
                  {row.case_name || shortId(row.case_id)}
                </Link>
              ) : (
                <span className="text-dark">{row.case_name || "—"}</span>
              )}
            </span>
          </li>
          <li className="d-flex align-items-start mb-2">
            <FontAwesomeIcon icon={faDatabase} className="me-2 mt-1" />
            <span>
              <span className="text-uppercase" style={{ fontSize: "0.7rem" }}>
                Evidence
              </span>
              <br />
              {row.evidence_id ? (
                <Link
                  to={Routes.EvidenceDetail.path.replace(":id", row.evidence_id)}
                  className="text-dark"
                  title={row.evidence_name}
                >
                  {row.evidence_name}
                </Link>
              ) : (
                <span className="text-dark">—</span>
              )}
            </span>
          </li>
          <li className="d-flex align-items-center mb-2">
            <FontAwesomeIcon icon={faClock} className="me-2" />
            <span>
              <span className="text-uppercase" style={{ fontSize: "0.7rem" }}>
                Generated
              </span>
              <br />
              <span className="text-dark">{formatDate(row.generated_at)}</span>
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
                {formatDuration(row.duration_seconds)}
              </span>
            </span>
          </li>
          <li className="d-flex align-items-start">
            <FontAwesomeIcon icon={faFileAlt} className="me-2 mt-1" />
            <span>
              <span className="text-uppercase" style={{ fontSize: "0.7rem" }}>
                AI Model
              </span>
              <br />
              <span className="text-dark">{row.ai_model}</span>
            </span>
          </li>
        </ul>

        <div className="d-flex flex-wrap gap-2 mt-auto pt-2 border-top border-light">
          <Button
            as={Link}
            to={detailPath}
            variant="outline-primary"
            size="sm"
            title="View report"
          >
            <FontAwesomeIcon icon={faEye} className="me-1" />
            View
          </Button>
          <Button
            variant="outline-secondary"
            size="sm"
            disabled={isBusy}
            onClick={() => onExport(row, "pdf")}
            title="Export PDF"
          >
            {spinning("pdf") ? (
              <Spinner animation="border" size="sm" className="me-1" />
            ) : (
              <FontAwesomeIcon icon={faFilePdf} className="me-1" />
            )}
            PDF
          </Button>
          <Button
            variant="outline-secondary"
            size="sm"
            disabled={isBusy}
            onClick={() => onExport(row, "html")}
            title="Export HTML"
          >
            {spinning("html") ? (
              <Spinner animation="border" size="sm" className="me-1" />
            ) : (
              <FontAwesomeIcon icon={faFileAlt} className="me-1" />
            )}
            HTML
          </Button>
          <Button
            variant="outline-secondary"
            size="sm"
            disabled={isBusy}
            onClick={() => onExport(row, "json")}
            title="Download JSON"
          >
            {spinning("json") ? (
              <Spinner animation="border" size="sm" className="me-1" />
            ) : (
              <FontAwesomeIcon icon={faCode} className="me-1" />
            )}
            JSON
          </Button>
          <Button
            variant="outline-success"
            size="sm"
            disabled={isBusy}
            onClick={() => onVerify(row)}
            title="Verify integrity"
          >
            {spinning("verify") ? (
              <Spinner animation="border" size="sm" className="me-1" />
            ) : (
              <FontAwesomeIcon icon={faShieldAlt} className="me-1" />
            )}
            Verify
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
}

/**
 * Forensic reports list with export and integrity actions.
 */
export default function ReportList() {
  const { success, error: notifyError, info } = useNotification();
  const mountedRef = useRef(true);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadReports = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const reports = await fetchReportsCached();
      const enriched = (reports || []).map((report) => ({
        id: report.report_id,
        report_id: report.report_id,
        case_id: report.case_id,
        case_name: report.case_name || shortId(report.case_id),
        evidence_id: report.evidence_id,
        evidence_name: report.evidence_name || shortId(report.evidence_id),
        generated_at: report.generated_at,
        duration_seconds: report.pipeline_duration_seconds || 0,
        ai_model: resolveAiModel(report),
        use_fallback: Boolean(report.use_fallback_analyzer),
      }));
      if (!mountedRef.current) return;
      setRows(enriched);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err);
      setRows([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports().catch(() => {});
  }, [loadReports]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pagedRows = useMemo(() => {
    const start = (Math.max(1, page) - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, page]);

  const showPagination = !loading && rows.length > PAGE_SIZE;

  const runExport = async (row, kind) => {
    const id = row.report_id;
    setBusy({ id, kind });
    try {
      if (kind === "pdf") await reportsService.exportPdf(id);
      else if (kind === "html") await reportsService.exportHtml(id);
      else await reportsService.exportJson(id);
      if (!mountedRef.current) return;
      info("Download started", `Report ${shortId(id)} ${kind.toUpperCase()} export.`);
    } catch (err) {
      if (!mountedRef.current) return;
      notifyError(
        "Export failed",
        err?.message || `Could not export ${kind.toUpperCase()}.`
      );
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const runVerify = async (row) => {
    const id = row.report_id;
    setBusy({ id, kind: "verify" });
    setVerifyResult(null);
    try {
      const result = await reportsService.verify(id);
      if (!mountedRef.current) return;
      setVerifyResult({ reportId: id, ...result });
      if (result.is_valid) {
        success(
          "Integrity verified",
          `Report ${shortId(id)} passed integrity verification.`
        );
      } else {
        notifyError(
          "Integrity check failed",
          (result.issues || []).join("; ") || `Report ${shortId(id)} is not valid.`
        );
      }
    } catch (err) {
      if (!mountedRef.current) return;
      notifyError(
        "Verify failed",
        err?.message || "Could not verify report integrity."
      );
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  return (
    <Container fluid className="px-0">
      <PageHeader
        title="Forensic Reports"
        subtitle="Generated dual-output reports with export and integrity verification"
      />

      {error ? (
        <ApiErrorDisplay error={error} onRetry={loadReports} className="mb-3" />
      ) : null}

      {verifyResult ? (
        <Alert
          variant={verifyResult.is_valid ? "success" : "warning"}
          dismissible
          onClose={() => setVerifyResult(null)}
          className="mb-3"
        >
          <div className="fw-bold mb-2">
            Integrity result for {shortId(verifyResult.reportId)}
          </div>
          <VerifyFlag
            ok={Boolean(verifyResult.integrity_hash_match)}
            label={
              verifyResult.integrity_hash_match
                ? "Integrity hash match"
                : "Integrity hash mismatch"
            }
          />
          <VerifyFlag
            ok={Boolean(verifyResult.schema_version_valid)}
            label={
              verifyResult.schema_version_valid
                ? "Schema version valid"
                : "Schema version invalid"
            }
          />
          <VerifyFlag
            ok={Boolean(verifyResult.is_valid)}
            label={verifyResult.is_valid ? "Validation passed" : "Validation failed"}
          />
          {(verifyResult.issues || []).length ? (
            <ul className="mb-0 mt-2 small">
              {verifyResult.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
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
      ) : rows.length === 0 ? (
        <Card border="light" className="shadow-sm">
          <Card.Body>
            <EmptyState
              title="No forensic reports yet"
              description="Complete a pipeline job to generate dual-output forensic reports."
            />
          </Card.Body>
        </Card>
      ) : (
        <>
          <Row className="g-3 mb-3" aria-label="Forensic reports">
            {pagedRows.map((row) => (
              <Col key={row.report_id} xs={12} md={6} xl={4}>
                <ReportCard
                  row={row}
                  busy={busy}
                  onExport={runExport}
                  onVerify={runVerify}
                />
              </Col>
            ))}
          </Row>

          {showPagination ? (
            <div className="d-flex justify-content-between align-items-center px-1 pb-2">
              <span className="small text-muted">
                Page {page} of {totalPages} ({rows.length} total)
              </span>
              <nav aria-label="Reports pagination">
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
    </Container>
  );
}
