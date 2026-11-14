/**
 * SQL migrations, shared verbatim by PostgreSQL 16 (API/bot) and PGlite (browser demo).
 * Each migration is a list of single statements so it runs over the extended protocol.
 */

export interface Migration {
  id: string;
  statements: string[];
}

function split(sqlText: string): string[] {
  return sqlText
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(
      (s) => s.length > 0 && !/^--/.test(s.replace(/^\s+/, '')) && s.replace(/--.*$/gm, '').trim().length > 0,
    );
}

const init = /* sql */ `
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'barbershop' CHECK (kind IN ('barbershop', 'salon', 'clinic', 'car_service', 'other')),
  timezone text NOT NULL DEFAULT 'Asia/Tashkent',
  currency text NOT NULL DEFAULT 'UZS',
  phone text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  phone text,
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE service_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name jsonb NOT NULL,
  position integer NOT NULL DEFAULT 0
);

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id uuid REFERENCES service_categories(id) ON DELETE SET NULL,
  name jsonb NOT NULL,
  description jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_min integer NOT NULL CHECK (duration_min > 0 AND duration_min <= 720),
  price integer NOT NULL CHECK (price >= 0),
  buffer_before_min integer NOT NULL DEFAULT 0 CHECK (buffer_before_min >= 0 AND buffer_before_min <= 240),
  buffer_after_min integer NOT NULL DEFAULT 0 CHECK (buffer_after_min >= 0 AND buffer_after_min <= 240),
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  name text NOT NULL,
  title jsonb NOT NULL DEFAULT '{}'::jsonb,
  bio jsonb NOT NULL DEFAULT '{}'::jsonb,
  color text NOT NULL DEFAULT '#3355dd',
  photo_url text,
  telegram_user_id bigint,
  lang text NOT NULL DEFAULT 'uz' CHECK (lang IN ('uz', 'ru', 'en')),
  role text NOT NULL DEFAULT 'master' CHECK (role IN ('owner', 'admin', 'master')),
  bookable boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, telegram_user_id)
);

CREATE TABLE staff_services (
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  duration_min integer CHECK (duration_min IS NULL OR duration_min > 0),
  price integer CHECK (price IS NULL OR price >= 0),
  PRIMARY KEY (staff_id, service_id)
);

CREATE TABLE schedule_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('work', 'break')),
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_min smallint NOT NULL CHECK (start_min >= 0 AND start_min < 1440),
  end_min smallint NOT NULL CHECK (end_min > start_min AND end_min <= 2880)
);
CREATE INDEX schedule_rules_staff ON schedule_rules (staff_id);

CREATE TABLE time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES staff(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'block' CHECK (kind IN ('day_off', 'holiday', 'block', 'vacation')),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);
CREATE INDEX time_off_range ON time_off USING gist (business_id, tstzrange(start_at, end_at, '[)'));

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  telegram_user_id bigint,
  name text NOT NULL,
  phone text,
  lang text NOT NULL DEFAULT 'uz' CHECK (lang IN ('uz', 'ru', 'en')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, telegram_user_id),
  UNIQUE (business_id, phone)
);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  staff_id uuid NOT NULL REFERENCES staff(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  code text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  occupied_start timestamptz NOT NULL,
  occupied_end timestamptz NOT NULL,
  total_price integer NOT NULL DEFAULT 0,
  deposit_amount integer NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'none' CHECK (payment_status IN ('none', 'pending', 'paid', 'refunded')),
  source text NOT NULL DEFAULT 'miniapp' CHECK (source IN ('miniapp', 'bot', 'admin', 'phone', 'walkin')),
  running_late_min integer,
  notes text,
  cancel_reason text,
  cancelled_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  CHECK (occupied_start <= start_at AND occupied_end >= end_at),
  -- The heart of "no double booking": two live bookings of one master can never overlap,
  -- whatever the application does and however many requests race each other.
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(occupied_start, occupied_end, '[)') WITH &&
  ) WHERE (status <> 'cancelled')
);
CREATE UNIQUE INDEX bookings_code ON bookings (business_id, code);
CREATE INDEX bookings_business_start ON bookings (business_id, start_at);
CREATE INDEX bookings_customer ON bookings (customer_id, start_at);

CREATE TABLE booking_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id),
  position integer NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  price integer NOT NULL,
  name jsonb NOT NULL
);
CREATE INDEX booking_items_booking ON booking_items (booking_id);

CREATE TABLE booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  type text NOT NULL,
  actor text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_events_booking ON booking_events (booking_id, created_at);

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  staff_id uuid NOT NULL REFERENCES staff(id),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('sandbox', 'payme', 'click', 'stars')),
  reference text NOT NULL UNIQUE,
  amount integer NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'UZS',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  pay_url text,
  provider_tx_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
  kind text NOT NULL,
  audience text NOT NULL CHECK (audience IN ('customer', 'staff')),
  chat_id bigint NOT NULL,
  lang text NOT NULL DEFAULT 'uz',
  payload jsonb NOT NULL,
  send_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  dedupe_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_jobs_due ON notification_jobs (status, send_at);
CREATE INDEX notification_jobs_booking ON notification_jobs (booking_id);
`;

/** Provider-specific state (e.g. Payme create/perform/cancel times) for payment webhooks. */
const paymentProviderData = /* sql */ `
ALTER TABLE payments ADD COLUMN provider_data jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX payments_provider_tx ON payments (provider, provider_tx_id);
`;

export const MIGRATIONS: Migration[] = [
  { id: '0001_init', statements: split(init) },
  { id: '0002_payment_provider_data', statements: split(paymentProviderData) },
];
