import React from "react";
import { screen, wait } from "@testing-library/react";

import Dashboard from "pages/dashboard/Dashboard";
import { renderWithProviders } from "test-utils/render";
import casesService from "services/cases.service";
import evidenceService from "services/evidence.service";
import pipelineService from "services/pipeline.service";
import reportsService from "services/reports.service";
import healthService from "services/health.service";
import authService from "services/auth.service";

jest.mock("services/cases.service", () => ({
  __esModule: true,
  default: { list: jest.fn() },
}));
jest.mock("services/evidence.service", () => ({
  __esModule: true,
  default: { getStatistics: jest.fn() },
}));
jest.mock("services/pipeline.service", () => ({
  __esModule: true,
  default: { listJobs: jest.fn() },
}));
jest.mock("services/reports.service", () => ({
  __esModule: true,
  default: { getTotal: jest.fn(), getJson: jest.fn(), getAuditTrail: jest.fn() },
}));
jest.mock("services/health.service", () => ({
  __esModule: true,
  default: { ready: jest.fn() },
}));
jest.mock("services/auth.service", () => {
  const service = {
    getCurrentUser: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    refreshToken: jest.fn(),
    hasRefreshToken: jest.fn(() => true),
    isAuthenticated: jest.fn(() => true),
    getStoredUser: jest.fn(),
    clearAuthStorage: jest.fn(),
    register: jest.fn(),
  };
  return { __esModule: true, default: service, ...service };
});

jest.mock("react-chartjs-2", () => ({
  Bar: () => <div data-testid="bar-chart" />,
  Doughnut: () => <div data-testid="doughnut-chart" />,
}));

describe("Dashboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const profile = {
      id: "1",
      username: "admin",
      role_name: "admin",
    };
    authService.getStoredUser.mockReturnValue(profile);
    authService.getCurrentUser.mockResolvedValue(profile);
    casesService.list.mockResolvedValue({ total: 2, cases: [] });
    evidenceService.getStatistics.mockResolvedValue({
      total: 5,
      by_type: { disk_image: 3, memory_dump: 2 },
    });
    pipelineService.listJobs.mockImplementation((params = {}) => {
      if (params.status === "running") return Promise.resolve([]);
      return Promise.resolve([
        {
          job_id: "j1",
          report_id: "r1",
          status: "completed",
          completed_at: "2026-01-01T00:00:00Z",
        },
      ]);
    });
    reportsService.getTotal.mockResolvedValue(1);
    reportsService.getAuditTrail.mockResolvedValue({ entries: [] });
    healthService.ready.mockResolvedValue({
      status: "ready",
      checks: { database: true, llm: true, storage: true },
    });
  });

  test("test_renders_stat_cards", async () => {
    renderWithProviders(<Dashboard />, { role: "admin" });
    await wait(() => {
      expect(screen.getByText(/Active Cases/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Evidence Items/i)).toBeInTheDocument();
    expect(screen.getByText(/Running Pipelines/i)).toBeInTheDocument();
  });

  test("test_renders_charts", async () => {
    renderWithProviders(<Dashboard />, { role: "admin" });
    await wait(() => {
      expect(screen.getByTestId("doughnut-chart")).toBeInTheDocument();
    });
    expect(screen.getByText(/Pipeline Jobs by Status/i)).toBeInTheDocument();
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    expect(screen.queryByText(/Artefacts by Suspicion Level/i)).not.toBeInTheDocument();
  });

  test("does not update state after unmount", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    let resolveCases;
    casesService.list.mockReturnValue(
      new Promise((resolve) => {
        resolveCases = resolve;
      })
    );

    const { unmount } = renderWithProviders(<Dashboard />, { role: "admin" });
    unmount();
    resolveCases({ total: 2, cases: [] });
    await Promise.resolve();
    await Promise.resolve();

    const leaked = consoleError.mock.calls.some((args) =>
      args.some(
        (msg) =>
          typeof msg === "string" &&
          msg.includes("Can't perform a React state update on an unmounted component")
      )
    );
    expect(leaked).toBe(false);
    consoleError.mockRestore();
  });

  test("test_quick_actions_respect_permissions", async () => {
    const viewer = {
      id: "2",
      username: "viewer",
      role_name: "viewer",
    };
    authService.getStoredUser.mockReturnValue(viewer);
    authService.getCurrentUser.mockResolvedValue(viewer);

    renderWithProviders(<Dashboard />, { role: "viewer", user: viewer });
    await wait(() => {
      expect(screen.getByText(/Active Cases/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/New Case/i)).not.toBeInTheDocument();
  });
});
