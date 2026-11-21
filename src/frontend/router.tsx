/* eslint-disable react-refresh/only-export-components -- route table: lazy page handles, not a component module */
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import type { Permission } from '@shared/types';
import { Root } from './layouts/Root';
import { StudentLayout } from './layouts/StudentLayout';
import { Require, StaffArea, StaffLayout } from './layouts/StaffLayout';
import { LoadingBlock } from './components/ui';
import Landing from './pages/Landing';
import NotFound from './pages/NotFound';
import CodeEntry from './pages/student/CodeEntry';
import StudentHome from './pages/student/Home';
import AssessmentPage from './pages/student/Assessment';
import Done from './pages/student/Done';
import StudentProgress from './pages/student/Progress';

// Staff and admin areas are lazy-loaded so students on phones never download them (or Recharts).
const Login = lazy(() => import('./pages/staff/Login'));
const InstructorDashboard = lazy(() => import('./pages/instructor/Dashboard'));
const NewSession = lazy(() => import('./pages/instructor/NewSession'));
const SessionDetail = lazy(() => import('./pages/instructor/SessionDetail'));
const CohortDetail = lazy(() => import('./pages/instructor/CohortDetail'));
const Cards = lazy(() => import('./pages/instructor/Cards'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const Reports = lazy(() => import('./pages/admin/Reports'));
const PrintReport = lazy(() => import('./pages/admin/PrintReport'));
const Students = lazy(() => import('./pages/admin/Students'));
const StudentDetail = lazy(() => import('./pages/admin/StudentDetail'));
const Catalog = lazy(() => import('./pages/admin/Catalog'));
const Assessments = lazy(() => import('./pages/admin/Assessments'));
const AssessmentCreate = lazy(() => import('./pages/admin/AssessmentCreate'));
const AssessmentDetail = lazy(() => import('./pages/admin/AssessmentDetail'));
const Consent = lazy(() => import('./pages/admin/Consent'));
const Staff = lazy(() => import('./pages/admin/Staff'));
const Audit = lazy(() => import('./pages/admin/Audit'));

const guard = (permission: Permission | Permission[], node: ReactNode) => (
  <Require permission={permission}>{node}</Require>
);

export const routes: RouteObject[] = [
  {
    element: <Root />,
    children: [
      { path: '/', element: <Landing /> },
      {
        path: '/s',
        element: <StudentLayout />,
        children: [
          { index: true, element: <CodeEntry /> },
          { path: 'home', element: <StudentHome /> },
          { path: 'assess/:sessionId', element: <AssessmentPage /> },
          { path: 'done/:sessionId', element: <Done /> },
          { path: 'progress', element: <StudentProgress /> },
        ],
      },
      {
        element: <StaffArea />,
        children: [
          {
            path: '/staff/login',
            element: (
              <Suspense
                fallback={
                  <main id="main" className="mx-auto max-w-md p-6">
                    <LoadingBlock />
                  </main>
                }
              >
                <Login />
              </Suspense>
            ),
          },
          { path: '/staff', element: <Navigate to="/staff/login" replace /> },
          {
            element: <StaffLayout />,
            children: [
              { path: '/instructor', element: guard('sessions.manage', <InstructorDashboard />) },
              {
                path: '/instructor/sessions/new',
                element: guard('sessions.manage', <NewSession />),
              },
              {
                path: '/instructor/sessions/:id',
                element: guard('sessions.manage', <SessionDetail />),
              },
              {
                path: '/instructor/cohorts/:id',
                element: guard(['sessions.manage', 'credentials.issue'], <CohortDetail />),
              },
              { path: '/instructor/cards', element: guard('credentials.issue', <Cards />) },
              { path: '/admin', element: guard('dashboard.view', <Dashboard />) },
              { path: '/admin/reports', element: guard('reports.ai', <Reports />) },
              { path: '/admin/reports/print', element: guard('reports.export', <PrintReport />) },
              { path: '/admin/students', element: guard('students.view_individual', <Students />) },
              {
                path: '/admin/students/:id',
                element: guard('students.view_individual', <StudentDetail />),
              },
              { path: '/admin/catalog', element: guard('catalog.manage', <Catalog />) },
              { path: '/admin/assessments', element: guard('catalog.manage', <Assessments />) },
              {
                path: '/admin/assessments/new',
                element: guard('catalog.manage', <AssessmentCreate />),
              },
              {
                path: '/admin/assessments/:id',
                element: guard('catalog.manage', <AssessmentDetail />),
              },
              { path: '/admin/consent', element: guard('consent.manage', <Consent />) },
              { path: '/admin/staff', element: guard('staff.manage', <Staff />) },
              { path: '/admin/audit', element: guard('audit.view', <Audit />) },
            ],
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
];
