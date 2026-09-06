import React from "react";
import { Card, Container } from "@themesberg/react-bootstrap";

/**
 * Lightweight placeholder for DFAT sections that are not implemented yet.
 */
export default ({ title = "Section", description = "" }) => (
  <Container fluid className="px-0">
    <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center py-4">
      <div className="d-block mb-4 mb-md-0">
        <h1 className="h2">{title}</h1>
      </div>
    </div>
    <Card border="light" className="shadow-sm">
      <Card.Body>
        <Card.Text className="mb-0 text-muted">
          {description || `${title} content is not available yet.`}
        </Card.Text>
      </Card.Body>
    </Card>
  </Container>
);
