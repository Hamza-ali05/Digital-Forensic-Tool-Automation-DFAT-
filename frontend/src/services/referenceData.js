import casesService from "services/cases.service";
import evidenceService from "services/evidence.service";
import pipelineService from "services/pipeline.service";
import reportsService from "services/reports.service";
import { cachedQuery, invalidateQueryCache } from "utils/queryCache";
import { loadEvidenceOptions, normaliseEvidenceList } from "utils/artefactLoader";

const TTL = {
  cases: 60000,
  myCases: 60000,
  evidence: 45000,
  jobs: 15000,
  reports: 45000,
  evidenceOptions: 45000,
  evidenceStats: 60000,
};

export async function fetchCasesCached(params = {}) {
  return cachedQuery("cases", params, () => casesService.list(params), TTL.cases);
}

export async function fetchMyCasesCached() {
  return cachedQuery("cases-mine", "all", () => casesService.getMine(), TTL.myCases);
}

export async function fetchEvidenceInventoryCached(params = {}) {
  return cachedQuery(
    "evidence-inventory",
    params,
    () => evidenceService.getInventory(params),
    TTL.evidence
  );
}

export async function fetchEvidenceStatisticsCached() {
  return cachedQuery(
    "evidence-statistics",
    "all",
    () => evidenceService.getStatistics(),
    TTL.evidenceStats
  );
}

export async function fetchPipelineJobsCached(params = {}) {
  return cachedQuery(
    "pipeline-jobs",
    params,
    () => pipelineService.listJobs(params),
    TTL.jobs
  );
}

export async function fetchReportsCached() {
  return cachedQuery("reports", "all", () => reportsService.list(), TTL.reports);
}

export async function fetchEvidenceOptionsCached() {
  return cachedQuery(
    "evidence-options",
    "all",
    () => loadEvidenceOptions(),
    TTL.evidenceOptions
  );
}

export function normaliseCasesList(result) {
  if (Array.isArray(result?.cases)) return result.cases;
  if (Array.isArray(result)) return result;
  return result?.items || [];
}

export function buildCaseMap(cases) {
  const map = {};
  (cases || []).forEach((item) => {
    if (item?.case_id) map[item.case_id] = item;
  });
  return map;
}

export function buildEvidenceMap(items) {
  const list = Array.isArray(items) ? items : normaliseEvidenceList(items);
  const map = {};
  list.forEach((item) => {
    const id = item?.evidence_id || item?.id;
    if (id) map[id] = item;
  });
  return map;
}

export function invalidateReferenceData() {
  invalidateQueryCache("cases");
  invalidateQueryCache("cases-mine");
  invalidateQueryCache("evidence-inventory");
  invalidateQueryCache("evidence-statistics");
  invalidateQueryCache("pipeline-jobs");
  invalidateQueryCache("reports");
  invalidateQueryCache("evidence-options");
}
