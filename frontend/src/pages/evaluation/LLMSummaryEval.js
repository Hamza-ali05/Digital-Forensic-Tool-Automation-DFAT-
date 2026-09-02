import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  Card,
  Col,
  Container,
  Form,
  Row,
  Spinner,
  Table,
} from "@themesberg/react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faHistory, faPlay } from "@fortawesome/free-solid-svg-icons";

import PageHeader from "components/common/PageHeader";
import ApiErrorDisplay from "components/common/ApiErrorDisplay";
import EmptyState from "components/common/EmptyState";
import SkeletonLoader from "components/common/SkeletonLoader";
import MetricGauge, { scoreToPercent } from "components/forensic/MetricGauge";
import { formatDate, formatPercentage } from "utils/formatters";
import { validateRequired } from "utils/validators";
import usePermission from "hooks/usePermission";
import useNotification from "hooks/useNotification";
import evaluationService from "services/evaluation.service";
import { Routes } from "routes";

function shortId(id) {
  return id ? String(id).slice(0, 8) : "—";
}

/**
 * Automated RQ2 scoring of investigative summaries against artefact identifiers.
 */
export default function LLMSummaryEval() {
  const { canCreate } = usePermission("evaluation");
  const { success, error: notifyError } = useNotification();

  const [datasets, setDatasets] = useState({ dfrws: [], cfreds: [] });
  const [datasetSource, setDatasetSource] = useState("dfrws");
  const [datasetName, setDatasetName] = useState("");
  const [summaryText, setSummaryText] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [loadingLists, setLoadingLists] = useState(true);
  const [listError, setListError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const datasetOptions =
    datasetSource === "cfreds" ? datasets.cfreds || [] : datasets.dfrws || [];

  const loadLists = useCallback(async () => {
    setLoadingLists(true);
    setListError(null);
    try {
      const payload = await evaluationService.getDatasets();
      setDatasets({
        dfrws: payload?.dfrws || [],
        cfreds: payload?.cfreds || [],
      });
    } catch (err) {
      setListError(err);
    } finally {
      setLoadingLists(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const rows = await evaluationService.getLlmSummaryResults();
      const list = Array.isArray(rows) ? rows : [];
      setHistory([...list].reverse());
      setLatest((current) => current || list[list.length - 1] || null);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadLists().catch(() => {});
    loadHistory().catch(() => {});
  }, [loadLists, loadHistory]);

  useEffect(() => {
    if (!datasetOptions.includes(datasetName)) {
      setDatasetName(datasetOptions[0] || "");
    }
  }, [datasetOptions, datasetName]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const errors = {
      datasetName: validateRequired(datasetName, "Dataset name"),
    };
    setFieldErrors(errors);
    if (errors.datasetName) return;

    setSubmitting(true);
    setFormError(null);
    try {
      const result = await evaluationService.evaluateLlmSummary({
        dataset_source: datasetSource,
        ground_truth_dataset: datasetName,
        summary_text: summaryText.trim() || undefined,
      });
      setLatest(result);
      success(
        "Summary scored",
        `Accuracy proxy ${scoreToPercent(result.accuracy_proxy).toFixed(1)}%.`
      );
      await loadHistory();
    } catch (err) {
      setFormError(err);
      notifyError(
        "Evaluation failed",
        err?.message || "Could not score the investigative summary."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container fluid className="px-0">
      <PageHeader
        title="LLM Summary Evaluation"
        subtitle="Automated usefulness and accuracy proxies for investigative narratives (RQ2)"
        actions={
          <Button
            as={Link}
            to={Routes.EvaluationBenchmark.path}
            variant="outline-secondary"
          >
            <FontAwesomeIcon icon={faHistory} className="me-2" />
            Benchmarks
          </Button>
        }
      />

      {listError ? (
        <ApiErrorDisplay error={listError} onRetry={loadLists} className="mb-3" />
      ) : null}

      <Card border="light" className="shadow-sm mb-4">
        <Card.Header className="border-bottom border-light">
          <h5 className="mb-0">Score a summary</h5>
        </Card.Header>
        <Card.Body>
          <p className="small text-muted">
            Paste a local LLaMA-3 summary to score it, or leave the box empty to
            score the rule-based fallback narrative built from the selected
            ground-truth dataset. Peer Likert ratings still happen on the
            questionnaire.
          </p>
          {loadingLists ? (
            <SkeletonLoader type="card" rows={2} />
          ) : (
            <Form onSubmit={handleSubmit}>
              {formError ? (
                <ApiErrorDisplay error={formError} className="mb-3" />
              ) : null}
              <Row className="g-3">
                <Col xs={12} md={6}>
                  <Form.Group>
                    <Form.Label>Dataset source</Form.Label>
                    <div>
                      <Form.Check
                        inline
                        type="radio"
                        id="llm-source-dfrws"
                        name="llmDatasetSource"
                        label="DFRWS"
                        checked={datasetSource === "dfrws"}
                        onChange={() => setDatasetSource("dfrws")}
                      />
                      <Form.Check
                        inline
                        type="radio"
                        id="llm-source-cfreds"
                        name="llmDatasetSource"
                        label="CFReDS"
                        checked={datasetSource === "cfreds"}
                        onChange={() => setDatasetSource("cfreds")}
                      />
                    </div>
                  </Form.Group>
                  <Form.Group className="mt-3">
                    <Form.Label>Dataset name</Form.Label>
                    <Form.Select
                      value={datasetName}
                      onChange={(event) => setDatasetName(event.target.value)}
                      isInvalid={Boolean(fieldErrors.datasetName)}
                      aria-label="Dataset name"
                    >
                      <option value="">Select dataset…</option>
                      {datasetOptions.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </Form.Select>
                    <Form.Control.Feedback type="invalid">
                      {fieldErrors.datasetName}
                    </Form.Control.Feedback>
                  </Form.Group>
                </Col>
                <Col xs={12} md={6}>
                  <Form.Group>
                    <Form.Label>Summary text (optional)</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={6}
                      value={summaryText}
                      onChange={(event) => setSummaryText(event.target.value)}
                      placeholder="Paste a local LLM investigative summary, or leave blank for the rule-based fallback."
                      aria-label="Investigative summary text"
                    />
                  </Form.Group>
                </Col>
              </Row>
              <div className="mt-4">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={submitting || !canCreate}
                >
                  {submitting ? (
                    <Spinner animation="border" size="sm" className="me-2" />
                  ) : (
                    <FontAwesomeIcon icon={faPlay} className="me-2" />
                  )}
                  Score summary
                </Button>
              </div>
            </Form>
          )}
        </Card.Body>
      </Card>

      <Card border="light" className="shadow-sm mb-4">
        <Card.Header className="border-bottom border-light">
          <h5 className="mb-0">Latest scores</h5>
        </Card.Header>
        <Card.Body>
          {latest ? (
            <>
              <p className="small text-muted mb-4">
                {latest.dataset_name || "Dataset"} · {latest.summary_source} ·{" "}
                {formatDate(latest.evaluated_at)}
                {latest.evaluation_id ? ` · ${shortId(latest.evaluation_id)}` : ""}
              </p>
              <Row className="g-3">
                <Col xs={12} sm={6} xl={4}>
                  <Card border="light" className="shadow-sm h-100">
                    <Card.Body className="text-center">
                      <MetricGauge
                        value={scoreToPercent(latest.usefulness_proxy)}
                        label="Usefulness proxy"
                      />
                    </Card.Body>
                  </Card>
                </Col>
                <Col xs={12} sm={6} xl={4}>
                  <Card border="light" className="shadow-sm h-100">
                    <Card.Body className="text-center">
                      <MetricGauge
                        value={scoreToPercent(latest.accuracy_proxy)}
                        label="Accuracy proxy"
                      />
                    </Card.Body>
                  </Card>
                </Col>
                <Col xs={12} sm={6} xl={4}>
                  <Card border="light" className="shadow-sm h-100">
                    <Card.Body className="text-center">
                      <MetricGauge
                        value={scoreToPercent(latest.citation_coverage)}
                        label="Citation coverage"
                      />
                      <div className="small text-muted mt-1">
                        {latest.cited_identifiers}/{latest.expected_identifiers}{" "}
                        identifiers · risk {latest.hallucination_risk}
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
            </>
          ) : (
            <EmptyState
              title="No summary scores yet"
              description="Run a scoring pass against a local ground-truth dataset."
            />
          )}
        </Card.Body>
      </Card>

      <Card border="light" className="shadow-sm mb-4">
        <Card.Header className="border-bottom border-light">
          <h5 className="mb-0">History</h5>
        </Card.Header>
        <Card.Body className="pt-0">
          {loadingHistory ? (
            <SkeletonLoader type="table" rows={3} />
          ) : history.length ? (
            <Table responsive hover className="align-middle">
              <thead className="thead-light">
                <tr>
                  <th>When</th>
                  <th>Dataset</th>
                  <th>Source</th>
                  <th>Usefulness</th>
                  <th>Accuracy</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.evaluation_id}>
                    <td>{formatDate(row.evaluated_at)}</td>
                    <td>{row.dataset_name || "—"}</td>
                    <td>{row.summary_source}</td>
                    <td>
                      {formatPercentage(scoreToPercent(row.usefulness_proxy))}
                    </td>
                    <td>
                      {formatPercentage(scoreToPercent(row.accuracy_proxy))}
                    </td>
                    <td>{row.hallucination_risk}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-muted mb-0 pt-3">No stored summary evaluations.</p>
          )}
        </Card.Body>
      </Card>
    </Container>
  );
}
