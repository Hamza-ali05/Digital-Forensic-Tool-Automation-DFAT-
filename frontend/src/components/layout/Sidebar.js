import React, { useCallback, useEffect, useState } from "react";
import SimpleBar from "simplebar-react";
import { Link, useLocation } from "react-router-dom";
import { CSSTransition } from "react-transition-group";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faHome,
  faFolderOpen,
  faDatabase,
  faPlayCircle,
  faMicrochip,
  faFileAlt,
  faChartBar,
  faChartLine,
  faHistory,
  faTachometerAlt,
  faCog,
  faUsers,
  faUserCircle,
  faClipboardList,
  faTimes,
  faSignOutAlt,
  faUserPlus,
  faShieldAlt,
  faClock,
  faBug,
  faAlignLeft,
  faCode,
  faBrain,
  faBook,
  faShieldVirus,
  faServer,
  faListUl,
  faThLarge,
  faChevronDown,
  faChevronRight,
} from "@fortawesome/free-solid-svg-icons";
import { Button, Nav, Navbar } from "@themesberg/react-bootstrap";

import config from "config";
import { API_ENDPOINTS } from "config/api.config";
import useAuth from "hooks/useAuth";
import usePageVisibility from "hooks/usePageVisibility";
import usePermission from "hooks/usePermission";
import { apiGet } from "services/api";
import { Routes } from "routes";

function isNavActive(pathname, link) {
  if (link === Routes.Dashboard.path) {
    return pathname === link;
  }
  if (link === Routes.Evidence.path) {
    if (pathname === link) return true;
    if (
      pathname.startsWith("/evidence/register") ||
      pathname.startsWith("/evidence/integrity")
    ) {
      return false;
    }
    return pathname.startsWith(`${link}/`);
  }
  if (link === Routes.Pipeline.path) {
    if (pathname === link) return true;
    if (pathname.startsWith("/pipeline/run")) {
      return false;
    }
    return pathname.startsWith(`${link}/`);
  }
  if (link === Routes.ArtefactsTimeline.path || link === Routes.ArtefactsIOCs.path) {
    return pathname === link;
  }
  if (link === Routes.AISummary.path || link === Routes.JSONViewer.path) {
    return pathname === link;
  }
  if (link === Routes.AIAnalysis.path) {
    return (
      pathname === link ||
      pathname.startsWith("/artefacts/timeline") ||
      pathname.startsWith("/artefacts/iocs") ||
      pathname.startsWith("/ai/summary")
    );
  }
  if (link === Routes.Reports.path) {
    if (pathname === link) return true;
    if (pathname.startsWith("/reports/json")) return true;
    return pathname.startsWith(`${link}/`);
  }
  if (
    link === Routes.Datasets.path ||
    link === Routes.MLModels.path ||
    link === Routes.Knowledge.path ||
    link === Routes.ThreatIntel.path ||
    link === Routes.AdminSystem.path ||
    link === Routes.AdminTasks.path ||
    link === Routes.AdminCapabilities.path
  ) {
    return pathname === link || pathname.startsWith(`${link}/`);
  }
  return pathname === link || pathname.startsWith(`${link}/`);
}

function isAiGroupActive(pathname) {
  return (
    isNavActive(pathname, Routes.AIAnalysis.path) ||
    pathname === Routes.ArtefactsTimeline.path ||
    pathname === Routes.ArtefactsIOCs.path ||
    pathname === Routes.AISummary.path
  );
}

function isReportsGroupActive(pathname) {
  return (
    isNavActive(pathname, Routes.Reports.path) ||
    pathname === Routes.JSONViewer.path
  );
}

function isEvaluationGroupActive(pathname) {
  return (
    isNavActive(pathname, Routes.Evaluation.path) ||
    pathname === Routes.EvaluationBenchmark.path ||
    pathname === Routes.EvaluationBenchmarkHistory.path ||
    pathname === Routes.EvaluationPerformance.path ||
    pathname === Routes.EvaluationUsability.path ||
    pathname === Routes.EvaluationLlmSummary.path
  );
}

function isSettingsGroupActive(pathname) {
  return (
    pathname === Routes.Profile.path ||
    pathname === Routes.Register.path ||
    pathname === Routes.SettingsUsers.path ||
    pathname === Routes.SettingsAudit.path ||
    pathname === Routes.AdminSystem.path ||
    pathname === Routes.AdminTasks.path ||
    pathname === Routes.AdminCapabilities.path
  );
}

function isIntelligenceGroupActive(pathname) {
  return (
    isNavActive(pathname, Routes.Datasets.path) ||
    isNavActive(pathname, Routes.MLModels.path) ||
    isNavActive(pathname, Routes.Knowledge.path) ||
    isNavActive(pathname, Routes.ThreatIntel.path)
  );
}

function getInitialExpandedGroups(pathname) {
  return {
    ai: isAiGroupActive(pathname),
    reports: isReportsGroupActive(pathname),
    evaluation: isEvaluationGroupActive(pathname),
    intelligence: isIntelligenceGroupActive(pathname),
    settings: isSettingsGroupActive(pathname),
  };
}

/**
 * DFAT forensic navigation sidebar with role-gated admin links and health.
 */
export default function Sidebar({ show = false, onClose, onToggle }) {
  const location = useLocation();
  const { pathname } = location;
  const { logout, user, role } = useAuth();
  const { canRead: canManageUsers } = usePermission("users");
  const canRegister = role === "admin" || role === "investigator";
  const canIntelligence =
    role === "admin" || role === "investigator" || role === "analyst";

  const [healthOk, setHealthOk] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState(() =>
    getInitialExpandedGroups(pathname)
  );
  const pageVisible = usePageVisibility();

  useEffect(() => {
    setExpandedGroups((prev) => ({
      ai: prev.ai || isAiGroupActive(pathname),
      reports: prev.reports || isReportsGroupActive(pathname),
      evaluation: prev.evaluation || isEvaluationGroupActive(pathname),
      intelligence: prev.intelligence || isIntelligenceGroupActive(pathname),
      settings: prev.settings || isSettingsGroupActive(pathname),
    }));
  }, [pathname]);

  const toggleGroup = useCallback((groupId) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  }, []);

  useEffect(() => {
    if (!pageVisible) return undefined;

    let cancelled = false;

    async function loadHealth() {
      try {
        await apiGet(API_ENDPOINTS.HEALTH.READY);
        if (!cancelled) setHealthOk(true);
      } catch {
        if (!cancelled) setHealthOk(false);
      }
    }

    loadHealth();
    const interval = window.setInterval(loadHealth, config.pollingInterval || 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pageVisible]);

  const showClass = show ? "show" : "";

  const NavItem = ({ title, link, icon }) => {
    const active = isNavActive(pathname, link);
    return (
      <Nav.Item className={active ? "active" : ""} onClick={onClose}>
        <Nav.Link as={Link} to={link} className="d-flex align-items-center">
          {icon ? (
            <span className="sidebar-icon">
              <FontAwesomeIcon icon={icon} aria-hidden="true" />
            </span>
          ) : null}
          <span className="sidebar-text">{title}</span>
        </Nav.Link>
      </Nav.Item>
    );
  };

  const NavSubItem = ({ title, link, icon }) => {
    const active = isNavActive(pathname, link);
    return (
      <Nav.Item className={`ms-3 ${active ? "active" : ""}`} onClick={onClose}>
        <Nav.Link as={Link} to={link} className="d-flex align-items-center py-1">
          {icon ? (
            <span className="sidebar-icon">
              <FontAwesomeIcon icon={icon} aria-hidden="true" />
            </span>
          ) : null}
          <span className="sidebar-text">{title}</span>
        </Nav.Link>
      </Nav.Item>
    );
  };

  const NavGroup = ({ groupId, title, link, icon, children, isGroupActive }) => {
    const expanded = expandedGroups[groupId];
    const active = isGroupActive(pathname);

    return (
      <>
        <Nav.Item className={active ? "active" : ""}>
          <div className="d-flex align-items-center sidebar-nav-group">
            <Nav.Link
              as={Link}
              to={link}
              className="d-flex align-items-center flex-grow-1 pe-0"
              onClick={() => {
                setExpandedGroups((prev) => ({ ...prev, [groupId]: true }));
                if (onClose) onClose();
              }}
            >
              {icon ? (
                <span className="sidebar-icon">
                  <FontAwesomeIcon icon={icon} aria-hidden="true" />
                </span>
              ) : null}
              <span className="sidebar-text">{title}</span>
            </Nav.Link>
            <button
              type="button"
              className="sidebar-nav-toggle btn btn-link text-white p-0 ms-1 me-2"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleGroup(groupId);
              }}
            >
              <FontAwesomeIcon
                icon={expanded ? faChevronDown : faChevronRight}
                className="sidebar-chevron"
                aria-hidden="true"
              />
            </button>
          </div>
        </Nav.Item>
        {expanded
          ? React.Children.map(children, (child) =>
              React.isValidElement(child) ? React.cloneElement(child, { key: child.props.link }) : child
            )
          : null}
      </>
    );
  };

  const handleSignOut = async () => {
    if (onClose) onClose();
    try {
      await logout();
    } finally {
      window.location.href = Routes.Login.path;
    }
  };

  return (
    <>
      <Navbar
        expand={false}
        collapseOnSelect
        variant="dark"
        className="navbar-theme-primary px-4 d-md-none"
      >
        <Navbar.Brand as={Link} to={Routes.Dashboard.path} className="me-lg-5">
          <span className="text-white fw-bold">{config.appName}</span>
        </Navbar.Brand>
        <Navbar.Toggle
          as={Button}
          aria-controls="sidebar-nav"
          aria-label="Open navigation"
          onClick={onToggle}
        >
          <span className="navbar-toggler-icon" />
        </Navbar.Toggle>
      </Navbar>

      <CSSTransition timeout={300} in={show} classNames="sidebar-transition">
        <SimpleBar
          id="sidebar-nav"
          className={`collapse ${showClass} sidebar d-md-block bg-primary text-white`}
          role="navigation"
          aria-label="Primary"
        >
          <div className="sidebar-inner px-4 pt-3 d-flex flex-column" style={{ minHeight: "100%" }}>
            <div className="user-card d-flex d-md-none align-items-center justify-content-between pb-4">
              <div className="d-block">
                <h6 className="mb-1">{user?.username || config.appName}</h6>
                <Button
                  as={Link}
                  to={Routes.Profile.path}
                  variant="secondary"
                  size="xs"
                  className="text-dark me-2"
                  onClick={onClose}
                >
                  Profile
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className="text-dark"
                  onClick={handleSignOut}
                >
                  <FontAwesomeIcon icon={faSignOutAlt} className="me-2" aria-hidden="true" /> Sign Out
                </Button>
              </div>
              <Button
                variant="link"
                className="collapse-close d-md-none text-white p-0"
                onClick={onClose}
                aria-label="Close navigation"
              >
                <FontAwesomeIcon icon={faTimes} aria-hidden="true" />
              </Button>
            </div>

            <Nav className="flex-column pt-3 pt-md-0 flex-grow-1">
              <Nav.Item className="mb-3">
                <Nav.Link
                  as={Link}
                  to={Routes.Dashboard.path}
                  className="d-flex align-items-center"
                  onClick={onClose}
                >
                  <span className="sidebar-text fw-bold fs-5">{config.appName}</span>
                </Nav.Link>
              </Nav.Item>

              <NavItem title="Dashboard" link={Routes.Dashboard.path} icon={faHome} />
              <NavItem
                title="Cases"
                link={Routes.Cases.path}
                icon={faFolderOpen}
              />
              <NavItem
                title="Evidence"
                link={Routes.Evidence.path}
                icon={faDatabase}
              />
              <NavItem
                title="Integrity Check"
                link={Routes.EvidenceIntegrity.path}
                icon={faShieldAlt}
              />
              <NavItem
                title="Pipeline"
                link={Routes.Pipeline.path}
                icon={faPlayCircle}
              />
              <NavGroup
                groupId="ai"
                title="AI Analysis"
                link={Routes.AIAnalysis.path}
                icon={faMicrochip}
                isGroupActive={isAiGroupActive}
              >
                <NavSubItem
                  title="Timeline"
                  link={Routes.ArtefactsTimeline.path}
                  icon={faClock}
                />
                <NavSubItem
                  title="IOCs"
                  link={Routes.ArtefactsIOCs.path}
                  icon={faBug}
                />
                <NavSubItem
                  title="Summary"
                  link={Routes.AISummary.path}
                  icon={faAlignLeft}
                />
              </NavGroup>
              <NavGroup
                groupId="reports"
                title="Reports"
                link={Routes.Reports.path}
                icon={faFileAlt}
                isGroupActive={isReportsGroupActive}
              >
                <NavSubItem
                  title="JSON Artefacts"
                  link={Routes.JSONViewer.path}
                  icon={faCode}
                />
              </NavGroup>
              <NavGroup
                groupId="evaluation"
                title="Evaluation"
                link={Routes.Evaluation.path}
                icon={faChartBar}
                isGroupActive={isEvaluationGroupActive}
              >
                <NavSubItem
                  title="Benchmark"
                  link={Routes.EvaluationBenchmark.path}
                  icon={faChartLine}
                />
                <NavSubItem
                  title="History"
                  link={Routes.EvaluationBenchmarkHistory.path}
                  icon={faHistory}
                />
                <NavSubItem
                  title="Performance"
                  link={Routes.EvaluationPerformance.path}
                  icon={faTachometerAlt}
                />
                <NavSubItem
                  title="Usability"
                  link={Routes.EvaluationUsability.path}
                  icon={faClipboardList}
                />
                <NavSubItem
                  title="LLM summaries"
                  link={Routes.EvaluationLlmSummary.path}
                  icon={faMicrochip}
                />
              </NavGroup>

              {canIntelligence ? (
                <NavGroup
                  groupId="intelligence"
                  title="Intelligence"
                  link={Routes.Datasets.path}
                  icon={faBrain}
                  isGroupActive={isIntelligenceGroupActive}
                >
                  <NavSubItem
                    title="Datasets"
                    link={Routes.Datasets.path}
                    icon={faDatabase}
                  />
                  <NavSubItem
                    title="Machine Learning"
                    link={Routes.MLModels.path}
                    icon={faBrain}
                  />
                  <NavSubItem
                    title="Knowledge Base"
                    link={Routes.Knowledge.path}
                    icon={faBook}
                  />
                  <NavSubItem
                    title="Threat Intel"
                    link={Routes.ThreatIntel.path}
                    icon={faShieldVirus}
                  />
                </NavGroup>
              ) : null}

              <Nav.Item className="my-2">
                <hr className="border-light opacity-25 my-2" />
              </Nav.Item>
              <NavGroup
                groupId="settings"
                title="Settings"
                link={Routes.Profile.path}
                icon={faCog}
                isGroupActive={isSettingsGroupActive}
              >
                <NavSubItem
                  title="Profile"
                  link={Routes.Profile.path}
                  icon={faUserCircle}
                />
                {canRegister ? (
                  <NavSubItem
                    title="Register user"
                    link={Routes.Register.path}
                    icon={faUserPlus}
                  />
                ) : null}
                {canManageUsers ? (
                  <>
                    <NavSubItem
                      title="User Management"
                      link={Routes.SettingsUsers.path}
                      icon={faUsers}
                    />
                    <NavSubItem
                      title="Audit Logs"
                      link={Routes.SettingsAudit.path}
                      icon={faClipboardList}
                    />
                    <NavSubItem
                      title="System Status"
                      link={Routes.AdminSystem.path}
                      icon={faServer}
                    />
                    <NavSubItem
                      title="Task Monitor"
                      link={Routes.AdminTasks.path}
                      icon={faListUl}
                    />
                    <NavSubItem
                      title="Capabilities"
                      link={Routes.AdminCapabilities.path}
                      icon={faThLarge}
                    />
                  </>
                ) : null}
              </NavGroup>
            </Nav>

            <div className="sidebar-footer mt-auto pt-3 pb-4 small">
              <div className="d-flex align-items-center justify-content-between text-white-50">
                <span>
                  {config.appName} v{config.appVersion}
                </span>
                <span
                  className="d-inline-flex align-items-center"
                  title={
                    healthOk === null
                      ? "Checking system health…"
                      : healthOk
                        ? "System healthy"
                        : "System unhealthy"
                  }
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor:
                        healthOk === null
                          ? "#adb5bd"
                          : healthOk
                            ? "#198754"
                            : "#dc3545",
                      display: "inline-block",
                      marginRight: 6,
                    }}
                  />
                  Health
                </span>
              </div>
            </div>
          </div>
        </SimpleBar>
      </CSSTransition>
    </>
  );
}
