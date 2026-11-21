/**
 * Shape of the deterministic SYNTHETIC demo dataset. Every row type comes from the shared DB
 * contract (`src/shared/db.ts`), so the in-memory store and `supabase/seed.sql` carry exactly the
 * same data. Nothing in here describes a real person.
 */
import type {
  AssessmentAttemptRow,
  AssessmentResponseRow,
  AssessmentRow,
  AssessmentSessionRow,
  AttemptSkillScoreRow,
  AuditLogRow,
  CohortRow,
  CohortStudentRow,
  ConsentRecordRow,
  CourseRow,
  GuardianContactRow,
  ProgramRow,
  QuestionAnswerKeyRow,
  QuestionRow,
  StaffProgramAssignmentRow,
  StaffUserRow,
  StudentRow,
} from '../../shared/db';

export type {
  AssessmentAttemptRow,
  AssessmentResponseRow,
  AssessmentRow,
  AssessmentSessionRow,
  AttemptSkillScoreRow,
  AuditLogRow,
  CohortRow,
  CohortStudentRow,
  ConsentRecordRow,
  CourseRow,
  GuardianContactRow,
  ProgramRow,
  QuestionAnswerKeyRow,
  QuestionRow,
  StaffProgramAssignmentRow,
  StaffUserRow,
  StudentRow,
};

export interface DemoDataset {
  programs: ProgramRow[];
  courses: CourseRow[];
  cohorts: CohortRow[];
  staff: StaffUserRow[];
  staffAssignments: StaffProgramAssignmentRow[];
  students: StudentRow[];
  cohortStudents: CohortStudentRow[];
  consentRecords: ConsentRecordRow[];
  guardianContacts: GuardianContactRow[];
  assessments: AssessmentRow[];
  questions: QuestionRow[];
  answerKeys: QuestionAnswerKeyRow[];
  sessions: AssessmentSessionRow[];
  attempts: AssessmentAttemptRow[];
  responses: AssessmentResponseRow[];
  skillScores: AttemptSkillScoreRow[];
  auditLog: AuditLogRow[];
  /** Raw demo access codes for LOCAL DEMO ONLY. Hashed at load time with the env pepper; never stored raw. */
  demoCredentials: { studentId: string; code: string; label: string }[];
}
