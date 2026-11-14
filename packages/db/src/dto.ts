/**
 * Plain JSON shapes returned by services. Instants are epoch milliseconds so the HTTP API and
 * the in-browser demo return byte-identical data.
 */
import type { BookingStatus, BusinessSettings, Lang, LocalizedText, ProviderId, Role } from '@navbat/core';
import type { BookingSource, PaymentStatus } from './schema.js';

export interface BusinessDTO {
  id: string;
  slug: string;
  name: string;
  kind: string;
  timezone: string;
  currency: string;
  phone: string | null;
  settings: BusinessSettings;
}

export interface BranchDTO {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
}

export interface CategoryDTO {
  id: string;
  name: LocalizedText;
  position: number;
}

export interface ServiceDTO {
  id: string;
  categoryId: string | null;
  name: LocalizedText;
  description: LocalizedText;
  durationMin: number;
  price: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  position: number;
  active: boolean;
}

export interface StaffServiceDTO {
  serviceId: string;
  durationMin: number | null;
  price: number | null;
}

export interface ScheduleRuleDTO {
  kind: 'work' | 'break';
  weekday: number;
  startMin: number;
  endMin: number;
}

export interface StaffDTO {
  id: string;
  branchId: string | null;
  name: string;
  title: LocalizedText;
  bio: LocalizedText;
  color: string;
  photoUrl: string | null;
  role: Role;
  bookable: boolean;
  active: boolean;
  position: number;
  telegramUserId: number | null;
  lang: Lang;
  services: StaffServiceDTO[];
  rating: number | null;
  reviewCount: number;
}

export interface CatalogDTO {
  business: BusinessDTO;
  branches: BranchDTO[];
  categories: CategoryDTO[];
  services: ServiceDTO[];
  staff: StaffDTO[];
}

export interface SlotDTO {
  start: number;
  options: { staffId: string; end: number; price: number }[];
}

export interface DayHeatDTO {
  date: string;
  /** 0 = closed/full … 4 = wide open */
  level: 0 | 1 | 2 | 3 | 4;
  free: number;
  bookable: boolean;
}

export interface BookingItemDTO {
  serviceId: string;
  name: LocalizedText;
  startAt: number;
  endAt: number;
  price: number;
}

export interface BookingDTO {
  id: string;
  code: string;
  status: BookingStatus;
  startAt: number;
  endAt: number;
  occupiedStart: number;
  occupiedEnd: number;
  staffId: string;
  staffName: string;
  staffColor: string;
  branchId: string | null;
  branchName: string | null;
  branchAddress: string | null;
  customer: { id: string; name: string; phone: string | null; telegramUserId: number | null };
  items: BookingItemDTO[];
  totalPrice: number;
  depositAmount: number;
  paymentStatus: PaymentStatus;
  payUrl: string | null;
  source: BookingSource;
  runningLateMin: number | null;
  notes: string | null;
  cancelReason: string | null;
  createdAt: number;
  review: { rating: number; comment: string | null } | null;
}

export interface TimeOffDTO {
  id: string;
  staffId: string | null;
  kind: 'day_off' | 'holiday' | 'block' | 'vacation';
  startAt: number;
  endAt: number;
  reason: string | null;
}

export interface CalendarDTO {
  from: string;
  to: string;
  timezone: string;
  staff: StaffDTO[];
  bookings: BookingDTO[];
  timeOff: TimeOffDTO[];
  /** Working intervals (breaks removed) per staff per local date. */
  working: { staffId: string; date: string; intervals: { start: number; end: number }[] }[];
}

export interface ClientDTO {
  id: string;
  name: string;
  phone: string | null;
  lang: Lang;
  telegramUserId: number | null;
  notes: string | null;
  visits: number;
  noShows: number;
  cancellations: number;
  totalSpent: number;
  lastVisit: number | null;
  nextVisit: number | null;
  createdAt: number;
}

export interface ClientDetailsDTO extends ClientDTO {
  history: BookingDTO[];
}

export interface AnalyticsDTO {
  from: string;
  to: string;
  totals: {
    bookings: number;
    completed: number;
    cancelled: number;
    noShows: number;
    upcoming: number;
    revenue: number;
    expectedRevenue: number;
    averageTicket: number;
    utilisation: number;
    newClients: number;
    rating: number | null;
  };
  byDay: { date: string; bookings: number; revenue: number }[];
  topServices: { serviceId: string; name: LocalizedText; count: number; revenue: number }[];
  byStaff: {
    staffId: string;
    name: string;
    color: string;
    bookings: number;
    revenue: number;
    utilisation: number;
  }[];
  sources: { source: BookingSource; count: number }[];
}

export interface CreatedBookingDTO {
  booking: BookingDTO;
  payment: { provider: ProviderId; reference: string; payUrl: string; amount: number } | null;
}

export interface NotificationDTO {
  id: string;
  kind: string;
  audience: 'customer' | 'staff';
  chatId: number;
  lang: Lang;
  payload: unknown;
  sendAt: number;
  status: string;
  sentAt: number | null;
  bookingId: string | null;
}
