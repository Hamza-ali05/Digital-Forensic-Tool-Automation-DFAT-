import { apiDelete, apiGet, apiPost, apiPut } from "services/api";
import { API_ENDPOINTS } from "config/api.config";

/**
 * Benchmark evaluation and usability API helpers.
 */
export async function getDatasets() {
  const { data } = await apiGet(API_ENDPOINTS.EVALUATION.BENCHMARK_DATASETS);
  return data || { dfrws: [], cfreds: [] };
}

export async function runBenchmark(payload) {
  const { data } = await apiPost(
    API_ENDPOINTS.EVALUATION.BENCHMARK_RUN,
    payload
  );
  return data;
}

export async function runOfflineBenchmark(payload) {
  const { data } = await apiPost(
    API_ENDPOINTS.EVALUATION.BENCHMARK_OFFLINE,
    payload
  );
  return data;
}

export async function getResults() {
  const { data } = await apiGet(API_ENDPOINTS.EVALUATION.BENCHMARK_RESULTS);
  return Array.isArray(data) ? data : data?.results || [];
}

export async function getResult(id) {
  const { data } = await apiGet(API_ENDPOINTS.EVALUATION.BENCHMARK_RESULT(id));
  return data;
}

export async function getPerformance(params = {}) {
  const { data } = await apiGet(
    API_ENDPOINTS.EVALUATION.BENCHMARK_PERFORMANCE,
    params
  );
  return data;
}

export async function getBaseline() {
  const { data } = await apiGet(API_ENDPOINTS.EVALUATION.BENCHMARK_BASELINE);
  return data || null;
}

export async function saveBaseline(payload) {
  const { data } = await apiPut(
    API_ENDPOINTS.EVALUATION.BENCHMARK_BASELINE,
    payload
  );
  return data;
}

export async function evaluateLlmSummary(payload) {
  const { data } = await apiPost(API_ENDPOINTS.EVALUATION.LLM_SUMMARY, payload);
  return data;
}

export async function getLlmSummaryResults() {
  const { data } = await apiGet(API_ENDPOINTS.EVALUATION.LLM_SUMMARY_RESULTS);
  return Array.isArray(data) ? data : [];
}

export async function getQuestionnaire() {
  const { data } = await apiGet(
    API_ENDPOINTS.EVALUATION.USABILITY_QUESTIONNAIRE
  );
  return data;
}

export async function submitQuestionnaire(payload) {
  const { data } = await apiPost(
    API_ENDPOINTS.EVALUATION.USABILITY_RESPOND,
    payload
  );
  return data;
}

export async function getUsabilityResults() {
  const { data } = await apiGet(API_ENDPOINTS.EVALUATION.USABILITY_RESULTS);
  return data;
}

export async function exportUsabilityResponses() {
  const { data } = await apiGet(API_ENDPOINTS.EVALUATION.USABILITY_EXPORT);
  return data;
}

export async function deleteUsabilityResponses() {
  const { data } = await apiDelete(API_ENDPOINTS.EVALUATION.USABILITY_DELETE);
  return data;
}

const evaluationService = {
  getDatasets,
  runBenchmark,
  runOfflineBenchmark,
  getResults,
  getResult,
  getPerformance,
  getBaseline,
  saveBaseline,
  evaluateLlmSummary,
  getLlmSummaryResults,
  getQuestionnaire,
  submitQuestionnaire,
  getUsabilityResults,
  exportUsabilityResponses,
  deleteUsabilityResponses,
};

export default evaluationService;
