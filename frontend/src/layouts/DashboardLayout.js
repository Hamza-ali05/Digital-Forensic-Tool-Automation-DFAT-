import React, { useCallback, useState } from "react";
import { Container } from "@themesberg/react-bootstrap";

import Sidebar from "components/layout/Sidebar";
import Topbar from "components/layout/Topbar";
import SkipToContent from "components/common/SkipToContent";
import DegradedBanner from "components/common/DegradedBanner";

/**
 * Main authenticated shell: Sidebar + Topbar + content.
 * Sidebar collapse state is shared so the Topbar hamburger works on mobile.
 */
export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => !open);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  return (
    <>
      <SkipToContent />
      <Sidebar show={sidebarOpen} onClose={closeSidebar} onToggle={toggleSidebar} />
      <main id="main-content" className="content" tabIndex={-1}>
        <Topbar onToggleSidebar={toggleSidebar} />
        <DegradedBanner />
        <Container fluid className="px-0">
          {children}
        </Container>
      </main>
    </>
  );
}
