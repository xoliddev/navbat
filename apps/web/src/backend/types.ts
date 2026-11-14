import type { Lang, LocalizedText, Role } from '@navbat/core';
import type {
  AnalyticsDTO,
  BookingDTO,
  BusinessDTO,
  BusinessSettings,
  CalendarDTO,
  CatalogDTO,
  ClientDetailsDTO,
  ClientDTO,
  CreatedBookingDTO,
  DayHeatDTO,
  NotificationDTO,
  ScheduleRuleDTO,
  ServiceDTO,
  SlotDTO,
  StaffDTO,
  TimeOffDTO,
} from './dto';

export type {
  AnalyticsDTO,
  BookingDTO,
  BusinessDTO,
  CalendarDTO,
  CatalogDTO,
  ClientDTO,
  ClientDetailsDTO,
  CreatedBookingDTO,
  DayHeatDTO,
  NotificationDTO,
  ScheduleRuleDTO,
  ServiceDTO,
  SlotDTO,
  StaffDTO,
  TimeOffDTO,
};

export interface SlotQuery {
  serviceIds: string[];
  staffId: string | null;
}

export interface Me {
  customer: { id: string; name: string; phone: string | null; lang: Lang };
  staff: { staffId: string; name: string; role: Role; lang: Lang } | null;
}

export interface AdminMe {
  staffId: string;
  name: string;
  role: Role;
  lang: Lang;
}

export interface ServiceInput {
  id?: string;
  categoryId?: string | null;
  name: LocalizedText;
  description?: LocalizedText;
  durationMin: number;
  price: number;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  active?: boolean;
  position?: number;
}

export interface StaffInput {
  id?: string;
  branchId?: string | null;
  name: string;
  title?: LocalizedText;
  color?: string;
  role?: Role;
  bookable?: boolean;
  active?: boolean;
  telegramUserId?: number | null;
  services?: { serviceId: string; durationMin?: number | null; price?: number | null }[];
}

/** Everything the UI needs. Implemented over HTTP (production) and over PGlite (demo). */
export interface Backend {
  readonly mode: 'http' | 'demo';
  now(): number;
  // customer
  catalog(): Promise<CatalogDTO>;
  slots(q: SlotQuery & { date: string }): Promise<SlotDTO[]>;
  availability(q: SlotQuery & { month: string }): Promise<DayHeatDTO[]>;
  firstAvailable(q: SlotQuery): Promise<string | null>;
  me(): Promise<Me>;
  patchMe(body: { lang?: Lang; name?: string; phone?: string }): Promise<Me>;
  myBookings(): Promise<BookingDTO[]>;
  createBooking(body: {
    serviceIds: string[];
    staffId: string | null;
    start: number;
    name: string;
    phone: string;
    notes?: string | null;
  }): Promise<CreatedBookingDTO>;
  booking(id: string): Promise<BookingDTO>;
  reschedule(id: string, start: number): Promise<BookingDTO>;
  cancel(id: string, reason?: string): Promise<BookingDTO>;
  late(id: string, minutes: number): Promise<BookingDTO>;
  review(id: string, rating: number, comment?: string): Promise<BookingDTO>;
  completeSandboxPayment(reference: string): Promise<BookingDTO | null>;
  // admin
  adminMe(): Promise<AdminMe>;
  adminCatalog(): Promise<CatalogDTO>;
  calendar(q: { from: string; to: string; staffIds?: string[] }): Promise<CalendarDTO>;
  adminCreateBooking(body: {
    serviceIds: string[];
    staffId: string | null;
    start: number;
    customer: { name: string; phone?: string | null };
    source: 'admin' | 'phone' | 'walkin';
    notes?: string | null;
  }): Promise<CreatedBookingDTO>;
  adminBooking(id: string): Promise<BookingDTO>;
  adminReschedule(id: string, start: number, staffId?: string): Promise<BookingDTO>;
  adminCancel(id: string, reason?: string): Promise<BookingDTO>;
  adminStatus(id: string, event: 'complete' | 'no_show' | 'confirm'): Promise<BookingDTO>;
  createTimeOff(body: {
    staffId: string | null;
    start: number;
    end: number;
    reason?: string | null;
  }): Promise<TimeOffDTO>;
  deleteTimeOff(id: string): Promise<void>;
  saveService(body: ServiceInput): Promise<ServiceDTO>;
  saveStaff(body: StaffInput): Promise<StaffDTO>;
  schedule(staffId: string): Promise<ScheduleRuleDTO[]>;
  saveSchedule(staffId: string, rules: ScheduleRuleDTO[]): Promise<ScheduleRuleDTO[]>;
  saveSettings(body: { name?: string; settings?: Partial<BusinessSettings> }): Promise<BusinessDTO>;
  clients(search?: string): Promise<ClientDTO[]>;
  client(id: string): Promise<ClientDetailsDTO>;
  analytics(q: { from: string; to: string }): Promise<AnalyticsDTO>;
  exportCsv(q: { from: string; to: string; lang: Lang }): Promise<string>;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
