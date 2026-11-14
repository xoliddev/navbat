import type { BookingStatus, BusinessSettings, Lang, LocalizedText, Role } from '@navbat/core';
import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

type BookingSettingsJson = Partial<BusinessSettings>;

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;
type Json<T> = ColumnType<T, string, string>;

export interface BusinessesTable {
  id: Generated<string>;
  slug: string;
  name: string;
  kind: Generated<'barbershop' | 'salon' | 'clinic' | 'car_service' | 'other'>;
  timezone: Generated<string>;
  currency: Generated<string>;
  phone: string | null;
  settings: ColumnType<BookingSettingsJson, string | undefined, string>;
  created_at: CreatedAt;
}

export interface BranchesTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  position: Generated<number>;
  active: Generated<boolean>;
}

export interface ServiceCategoriesTable {
  id: Generated<string>;
  business_id: string;
  name: Json<LocalizedText>;
  position: Generated<number>;
}

export interface ServicesTable {
  id: Generated<string>;
  business_id: string;
  category_id: string | null;
  name: Json<LocalizedText>;
  description: ColumnType<LocalizedText, string | undefined, string>;
  duration_min: number;
  price: number;
  buffer_before_min: Generated<number>;
  buffer_after_min: Generated<number>;
  position: Generated<number>;
  active: Generated<boolean>;
  created_at: CreatedAt;
}

export interface StaffTable {
  id: Generated<string>;
  business_id: string;
  branch_id: string | null;
  name: string;
  title: ColumnType<LocalizedText, string | undefined, string>;
  bio: ColumnType<LocalizedText, string | undefined, string>;
  color: Generated<string>;
  photo_url: string | null;
  telegram_user_id: number | null;
  lang: Generated<Lang>;
  role: Generated<Role>;
  bookable: Generated<boolean>;
  position: Generated<number>;
  active: Generated<boolean>;
  created_at: CreatedAt;
}

export interface StaffServicesTable {
  staff_id: string;
  service_id: string;
  duration_min: number | null;
  price: number | null;
}

export interface ScheduleRulesTable {
  id: Generated<string>;
  staff_id: string;
  kind: 'work' | 'break';
  weekday: number;
  start_min: number;
  end_min: number;
}

export interface TimeOffTable {
  id: Generated<string>;
  business_id: string;
  staff_id: string | null;
  kind: Generated<'day_off' | 'holiday' | 'block' | 'vacation'>;
  start_at: Timestamp;
  end_at: Timestamp;
  reason: string | null;
  created_at: CreatedAt;
}

export interface CustomersTable {
  id: Generated<string>;
  business_id: string;
  telegram_user_id: number | null;
  name: string;
  phone: string | null;
  lang: Generated<Lang>;
  notes: string | null;
  created_at: CreatedAt;
}

export type BookingSource = 'miniapp' | 'bot' | 'admin' | 'phone' | 'walkin';
export type PaymentStatus = 'none' | 'pending' | 'paid' | 'refunded';

export interface BookingsTable {
  id: Generated<string>;
  business_id: string;
  branch_id: string | null;
  staff_id: string;
  customer_id: string;
  code: string;
  status: BookingStatus;
  start_at: Timestamp;
  end_at: Timestamp;
  occupied_start: Timestamp;
  occupied_end: Timestamp;
  total_price: Generated<number>;
  deposit_amount: Generated<number>;
  payment_status: Generated<PaymentStatus>;
  source: Generated<BookingSource>;
  running_late_min: number | null;
  notes: string | null;
  cancel_reason: string | null;
  cancelled_by: string | null;
  created_at: CreatedAt;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface BookingItemsTable {
  id: Generated<string>;
  booking_id: string;
  service_id: string;
  position: number;
  start_at: Timestamp;
  end_at: Timestamp;
  price: number;
  name: Json<LocalizedText>;
}

export interface BookingEventsTable {
  id: Generated<string>;
  booking_id: string;
  type: string;
  actor: string;
  data: ColumnType<Record<string, unknown>, string | undefined, string>;
  created_at: CreatedAt;
}

export interface ReviewsTable {
  id: Generated<string>;
  business_id: string;
  booking_id: string;
  customer_id: string;
  staff_id: string;
  rating: number;
  comment: string | null;
  created_at: CreatedAt;
}

export interface PaymentsTable {
  id: Generated<string>;
  booking_id: string;
  provider: 'sandbox' | 'payme' | 'click' | 'stars';
  reference: string;
  amount: number;
  currency: Generated<string>;
  status: Generated<'pending' | 'paid' | 'failed' | 'refunded'>;
  pay_url: string | null;
  provider_tx_id: string | null;
  provider_data: ColumnType<Record<string, unknown>, string | undefined, string>;
  created_at: CreatedAt;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface NotificationJobsTable {
  id: Generated<string>;
  business_id: string;
  booking_id: string | null;
  kind: string;
  audience: 'customer' | 'staff';
  chat_id: number;
  lang: Generated<Lang>;
  payload: Json<unknown>;
  send_at: Timestamp;
  status: Generated<'pending' | 'sending' | 'sent' | 'failed' | 'cancelled'>;
  attempts: Generated<number>;
  last_error: string | null;
  sent_at: Date | null;
  dedupe_key: string | null;
  created_at: CreatedAt;
}

export interface DB {
  businesses: BusinessesTable;
  branches: BranchesTable;
  service_categories: ServiceCategoriesTable;
  services: ServicesTable;
  staff: StaffTable;
  staff_services: StaffServicesTable;
  schedule_rules: ScheduleRulesTable;
  time_off: TimeOffTable;
  customers: CustomersTable;
  bookings: BookingsTable;
  booking_items: BookingItemsTable;
  booking_events: BookingEventsTable;
  reviews: ReviewsTable;
  payments: PaymentsTable;
  notification_jobs: NotificationJobsTable;
}

export type BookingRow = Selectable<BookingsTable>;
export type NewBooking = Insertable<BookingsTable>;
export type StaffRow = Selectable<StaffTable>;
export type ServiceRow = Selectable<ServicesTable>;
export type CustomerRow = Selectable<CustomersTable>;
export type NotificationJobRow = Selectable<NotificationJobsTable>;
