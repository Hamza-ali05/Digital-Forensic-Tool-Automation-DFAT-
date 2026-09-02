import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Col,
  Container,
  Row,
  Table,
} from "@themesberg/react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faClipboardList,
  faExternalLinkAlt,
  faSync,
} from "@fortawesome/free-solid-svg-icons";

import PageHeader from "components/common/PageHeader";
import ApiErrorDisplay from "components/common/ApiErrorDisplay";
import EmptyState from "components/common/EmptyState";
import SkeletonLoader from "components/common/SkeletonLoader";
import StatCard from "components/forensic/StatCard";
import { formatPercentage } from "utils/formatters";
import evaluationService from "services/evaluation.service";
import { Routes } from "routes";

function ciText(interval) {
  if (!Array.isArray(interval) || interval.length < 2) return "—";
  const lo = Number(interval[0]);
  const hi = Number(interval[1]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return "—";
  return `${lo.toFixed(2)} – ${hi.toFixed(2)}`;
}

/**
 * RQ5 usability analysis — live questionnaire results vs Tobin et al.
 */
export default function UsabilityResults() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await evaluationService.getUsabilityResults();
      setReport(payload || null);
    } catch (err) {
      setError(err);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const dimensions = useMemo(() => {
    const raw = report?.dimensions || {};
    return Object.entries(raw).map(([name, stats]) => ({
      name,
      ...(stats || {}),
    }));
  }, [report]);

  const tobin = report?.tobin_comparison || {};
  const total = Number(report?.total_responses) || 0;
  const usefulness = Number(report?.usefulness_percentage);
  const feedback = Array.isArray(report?.qualitative_feedback)
    ? report.qualitative_feedback
    : [];

  return (
    <Container fluid className="px-0">
      <PageHeader
        title="Usability Results"
        subtitle="Anonymised questionnaire analysis (RQ5) compared with Tobin et al. 2021"
        actions={
          <div className="d-flex gap-2">
            <Button
              as={Link}
              to={Routes.Questionnaire.path}
              variant="outline-primary"
              target="_blank"
            >
              <FontAwesomeIcon icon={faExternalLinkAlt} className="me-2" />
              Open questionnaire
            </Button>
            <Button variant="outline-secondary" onClick={load}>
              <FontAwesomeIcon icon={faSync} className="me-2" />
              Refresh
            </Button>
          </div>
        }
      />

      {error ? (
        <ApiErrorDisplay error={error} onRetry={load} className="mb-3" />
      ) : null}

      {loading ? (
        <SkeletonLoader type="card" rows={3} />
      ) : total === 0 ? (
        <EmptyState
          title="No peer responses yet"
          description="Share /questionnaire with MSc peers after they use the tool. Responses stay anonymous. Recruiting participants is not automated."
        />
      ) : (
        <>
          <Row className="g-3 mb-4">
            <Col xs={12} sm={6} xl={3}>
              <StatCard
                title="Responses"
                value={String(total)}
                icon={faClipboardList}
                colour="primary"
              />
            </Col>
            <Col xs={12} sm={6} xl={3}>
              <StatCard
                title="Usefulness %"
                value={
                  Number.isFinite(usefulness)
                    ? formatPercentage(usefulness)
                    : "—"
                }
                icon={faClipboardList}
                colour="success"
              />
            </Col>
            <Col xs={12} sm={6} xl={3}>
              <StatCard
                title="Tobin benchmark"
                value={`${Number(tobin.tobin_percentage || 74).toFixed(0)}%`}
                icon={faClipboardList}
                colour="info"
              />
            </Col>
            <Col xs={12} sm={6} xl={3}>
              <StatCard
                title="Difference"
                value={
                  Number.isFinite(Number(tobin.difference))
                    ? `${Number(tobin.difference) >= 0 ? "+" : ""}${Number(
                        tobin.difference
                      ).toFixed(1)} pts`
                    : "—"
                }
                icon={faClipboardList}
                colour={tobin.meets_benchmark ? "success" : "warning"}
              />
            </Col>
          </Row>

          <Alert
            variant={tobin.meets_benchmark ? "success" : "warning"}
            className="mb-4"
          >
            <div className="fw-bold mb-1">
              {tobin.meets_benchmark
                ? "Meets or exceeds Tobin et al. (2021) usefulness benchmark"
                : "Below Tobin et al. (2021) usefulness benchmark"}
            </div>
            <div className="small mb-0">
              {typeof tobin.comparison_notes === "string"
                ? tobin.comparison_notes
                : (tobin.comparison_notes || []).join(" ")}
            </div>
          </Alert>

          <Card border="light" className="shadow-sm mb-4">
            <Card.Header className="border-bottom border-light">
              <h5 className="mb-0">Dimension statistics</h5>
            </Card.Header>
            <Card.Body className="pt-0">
              <Table responsive hover className="align-middle">
                <thead className="thead-light">
                  <tr>
                    <th>Dimension</th>
                    <th>Mean</th>
                    <th>Median</th>
                    <th>Std dev</th>
                    <th>n</th>
                    <th>95% CI</th>
                  </tr>
                </thead>
                <tbody>
                  {dimensions.map((row) => (
                    <tr key={row.name}>
                      <td className="text-capitalize">{row.name}</td>
                      <td>{Number(row.mean || 0).toFixed(2)}</td>
                      <td>{Number(row.median || 0).toFixed(2)}</td>
                      <td>{Number(row.std_dev || 0).toFixed(2)}</td>
                      <td>{row.sample_size ?? 0}</td>
                      <td>{ciText(row.confidence_interval_95)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>

          <Card border="light" className="shadow-sm mb-4">
            <Card.Header className="border-bottom border-light">
              <h5 className="mb-0">Qualitative feedback</h5>
            </Card.Header>
            <Card.Body>
              {feedback.length ? (
                <ul className="mb-0">
                  {feedback.map((item, index) => (
                    <li key={`fb-${index}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted mb-0">No free-text comments submitted.</p>
              )}
            </Card.Body>
          </Card>
        </>
      )}
    </Container>
  );
}
