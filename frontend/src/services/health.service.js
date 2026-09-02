import { apiGet } from "services/api";
import { API_ENDPOINTS } from "config/api.config";

/**
 * Readiness and detailed diagnostics helpers.
 */
export async function ready() {
  const { data } = await apiGet(API_ENDPOINTS.HEALTH.READY);
  return data;
}

export async function detailed() {
  const { data } = await apiGet(API_ENDPOINTS.HEALTH.DETAILED);
  return data;
}

const healthService = {
  ready,
  detailed,
};

export default healthService;
