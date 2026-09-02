import React from "react";
import { Alert, Button } from "@themesberg/react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faExclamationTriangle } from "@fortawesome/free-solid-svg-icons";
import { humanizeApiError } from "utils/formatters";

function alertVariant(status) {
  if (status === 401 || status === 403) return "warning";
  if (status === 0 || status >= 500) return "danger";
  if (status === 404 || status === 422) return "warning";
  return "danger";
}

function alertHeading(status) {
  if (status === 422) return "Action needed";
  if (status === 404) return "Not found";
  if (status === 401 || status === 403) return "Access issue";
  if (status === 0) return "Connection problem";
  if (status >= 500) return "Server problem";
  return "Something went wrong";
}

/**
 * Friendly display for normalised API errors from ``services/api``.
 *
 * @param {{ error: object, onRetry?: () => void, className?: string }} props
 */
export default function ApiErrorDisplay({ error, onRetry, className = "" }) {
  if (!error) {
    return null;
  }

  const status = error.status ?? 0;
  const message = humanizeApiError(error);
  const variant = alertVariant(status);

  return (
    <Alert
      variant={variant}
      className={`dfat-api-error border-0 shadow-sm ${className}`.trim()}
    >
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
        <div className="d-flex">
          <div className={`me-3 pt-1 text-${variant}`}>
            <FontAwesomeIcon icon={faExclamationTriangle} />
          </div>
          <div>
            <p className="mb-1 fw-bold">{alertHeading(status)}</p>
            <p className="mb-0">{message}</p>
            {error.requestId ? (
              <p className="mb-0 mt-2 small text-muted">
                Reference: {error.requestId.slice(0, 8)}
              </p>
            ) : null}
          </div>
        </div>
        {typeof onRetry === "function" ? (
          <Button variant="outline-dark" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </Alert>
  );
}
