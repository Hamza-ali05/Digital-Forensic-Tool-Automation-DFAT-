import React from "react";

/**
 * Minimal placeholder used by forensic page stubs.
 */
export default function ComingSoon({ title }) {
  return (
    <div className="p-4">
      <h1 className="h4 mb-2">{title || "Page"}</h1>
      <div>This page is not available yet.</div>
    </div>
  );
}
