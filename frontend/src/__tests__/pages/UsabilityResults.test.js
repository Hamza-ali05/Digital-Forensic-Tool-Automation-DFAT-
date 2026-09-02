import React from "react";
import { screen, wait } from "@testing-library/react";

import UsabilityResults from "pages/evaluation/UsabilityResults";
import { renderWithProviders } from "test-utils/render";
import evaluationService from "services/evaluation.service";
import authService from "services/auth.service";

jest.mock("services/evaluation.service", () => ({
  __esModule: true,
  default: {
    getUsabilityResults: jest.fn(),
  },
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

describe("UsabilityResults", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const profile = { id: "1", username: "inv", role_name: "investigator" };
    authService.getStoredUser.mockReturnValue(profile);
    authService.getCurrentUser.mockResolvedValue(profile);
  });

  test("test_empty_state_when_no_responses", async () => {
    evaluationService.getUsabilityResults.mockResolvedValue({
      total_responses: 0,
      dimensions: {},
      usefulness_percentage: 0,
      tobin_comparison: { comparison_notes: "Need more responses." },
      qualitative_feedback: [],
    });
    renderWithProviders(<UsabilityResults />, { role: "investigator" });
    await wait(() => {
      expect(screen.getByText(/No peer responses yet/i)).toBeInTheDocument();
    });
  });

  test("test_renders_usefulness_and_tobin", async () => {
    evaluationService.getUsabilityResults.mockResolvedValue({
      total_responses: 4,
      usefulness_percentage: 75,
      dimensions: {
        usefulness: {
          mean: 4.2,
          median: 4,
          std_dev: 0.5,
          sample_size: 4,
          confidence_interval_95: [3.8, 4.6],
        },
      },
      tobin_comparison: {
        tool_percentage: 75,
        tobin_percentage: 74,
        difference: 1,
        meets_benchmark: true,
        comparison_notes: "Meets Tobin benchmark.",
      },
      qualitative_feedback: ["Clear summaries"],
    });
    renderWithProviders(<UsabilityResults />, { role: "investigator" });
    await wait(() => {
      expect(screen.getByText(/75.0%/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Meets or exceeds Tobin/i)).toBeInTheDocument();
    expect(screen.getByText("Clear summaries")).toBeInTheDocument();
  });
});
