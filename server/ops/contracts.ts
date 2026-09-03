export const STUDENT_PUBLIC_ID_PATTERN = /^CEN-\d{2}-\d{5,}$/;

export const serviceTypes = [
  'FIRST_LICENSE',
  'CATEGORY_ADDITION',
  'CATEGORY_CHANGE',
  'LICENSED_TRAINING',
] as const;

export const enrollmentCategories = ['A', 'B', 'AB', 'D'] as const;
export const enrollmentStatuses = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'] as const;
export const staffRoles = ['STAFF', 'ADMIN'] as const;
export const subjectTypes = ['STUDENT', 'STAFF'] as const;
export const auditActorTypes = ['SYSTEM', 'STUDENT', 'STAFF'] as const;

export type ServiceType = typeof serviceTypes[number];
export type EnrollmentCategory = typeof enrollmentCategories[number];
export type EnrollmentStatus = typeof enrollmentStatuses[number];
export type StaffRole = typeof staffRoles[number];
export type SessionSubjectType = typeof subjectTypes[number];
export type AuditActorType = typeof auditActorTypes[number];

export interface StudentRecord {
  id: string;
  publicId: string;
  fullName: string;
  phone: string;
  email: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface EnrollmentRecord {
  id: string;
  studentId: string;
  serviceType: ServiceType;
  category: EnrollmentCategory;
  status: EnrollmentStatus;
  openedAt: Date;
  completedAt: Date | null;
}

export interface StudentCredentialRecord {
  studentId: string;
  passwordHash: string;
  mustChangePassword: boolean;
  passwordVersion: number;
  disabledAt: Date | null;
}

export interface StaffUserRecord {
  id: string;
  username: string;
  displayName: string;
  role: StaffRole;
  active: boolean;
}

export type SessionSubject =
  | { type: 'STUDENT'; studentId: string; staffUserId: null }
  | { type: 'STAFF'; studentId: null; staffUserId: string };

export type AuditActor =
  | { type: 'SYSTEM'; studentId: null; staffUserId: null }
  | { type: 'STUDENT'; studentId: string; staffUserId: null }
  | { type: 'STAFF'; studentId: null; staffUserId: string };

export function assertEnrollmentCombination(serviceType: ServiceType, category: EnrollmentCategory): void {
  if (serviceType === 'FIRST_LICENSE' && category === 'D') {
    throw new Error('Category D cannot be materialized as a first-license enrollment.');
  }
}
