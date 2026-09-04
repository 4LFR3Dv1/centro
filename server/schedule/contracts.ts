import type { EnrollmentCategory } from '../ops/contracts.js';

export const lessonCategories = ['A', 'B', 'D'] as const;
export const lessonStatuses = ['SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const;

export type LessonCategory = typeof lessonCategories[number];
export type LessonStatus = typeof lessonStatuses[number];

export interface InstructorRecord {
  id: string;
  displayName: string;
  active: boolean;
  categories: LessonCategory[];
}

export interface VehicleRecord {
  id: string;
  plate: string;
  label: string;
  category: LessonCategory;
  active: boolean;
}

export interface SchedulePolicyRecord {
  id: string;
  name: string;
  timezone: string;
  slotMinutes: number;
  lessonMinMinutes: number;
  lessonMaxMinutes: number;
  active: boolean;
}

export interface LessonRecord {
  id: string;
  enrollmentId: string;
  studentId: string;
  instructorId: string;
  vehicleId: string;
  category: LessonCategory;
  startsAt: Date;
  endsAt: Date;
  status: LessonStatus;
  resolvedAt: Date | null;
  createdByStaffUserId: string;
}

export function assertLessonCategoryForEnrollment(
  enrollmentCategory: EnrollmentCategory,
  lessonCategory: LessonCategory,
): void {
  if (enrollmentCategory === 'AB') {
    if (lessonCategory === 'A' || lessonCategory === 'B') return;
    throw new Error('A+B Enrollment can only receive A or B lessons.');
  }

  if (enrollmentCategory !== lessonCategory) {
    throw new Error(`Lesson category ${lessonCategory} is incompatible with Enrollment category ${enrollmentCategory}.`);
  }
}

export function assertLessonWindow(startsAt: Date, endsAt: Date): void {
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
    throw new Error('Lesson window requires valid timestamps.');
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new Error('Lesson must end after it starts.');
  }
}
