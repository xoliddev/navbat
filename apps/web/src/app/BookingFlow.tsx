import { formatDateLong, formatDuration, formatMoney, formatPhone, normalizePhone, pickText, utcToZoned } from '@navbat/core';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { BookingDTO, CatalogDTO, CreatedBookingDTO, Me, SlotDTO } from '../backend/types';
import { errorText, useI18n } from '../i18n';
import { useBackend, useTime, useToast } from '../lib';
import { tg, useBackButton, useMainButton } from '../telegram';
import { DateTimePicker, MasterPicker, ServicePicker, quote } from './pickers';
import { Ticket } from './Ticket';
import { PaymentSheet } from './PaymentSheet';

export interface FlowStart {
  serviceIds: string[];
  /** undefined = not chosen yet, null = any master */
  staffId: string | null | undefined;
  lockedStaff: boolean;
}

const STEPS = ['stepService', 'stepMaster', 'stepTime', 'stepConfirm'] as const;

export function Stepper({ step }: { step: number }) {
  const { t } = useI18n();
  return (
    <ol className="stepper" aria-label="Progress">
      {STEPS.map((k, i) => (
        <li key={k} className={i < step ? 'done' : i === step ? 'now' : ''} aria-current={i === step ? 'step' : undefined}>
          <span className="stepper-bar" />
          <span className="stepper-label">{t[k]}</span>
        </li>
      ))}
    </ol>
  );
}

export function BookingFlow({
  catalog,
  me,
  start,
  onOpenBookings,
}: {
  catalog: CatalogDTO;
  me: Me | undefined;
  start: FlowStart;
  onOpenBookings: () => void;
}) {
  const backend = useBackend();
  const toast = useToast();
  const { t, lang } = useI18n();
  const tz = catalog.business.timezone;
  const time = useTime(tz);
  const initialStep = start.serviceIds.length ? (start.staffId !== undefined ? 2 : 1) : 0;
  const [step, setStep] = useState(initialStep);
  const [dir, setDir] = useState(1);
  const [serviceIds, setServiceIds] = useState<string[]>(start.serviceIds);
  const [staffId, setStaffId] = useState<string | null | undefined>(start.staffId);
  const [pick, setPick] = useState<{ date: string | null; slot: SlotDTO | null }>({ date: null, slot: null });
  const [name, setName] = useState(me?.customer.name ?? '');
  const [phone, setPhone] = useState(me?.customer.phone ? formatPhone(me.customer.phone) : '');
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedBookingDTO | null>(null);
  const [booking, setBooking] = useState<BookingDTO | null>(null);
  const [payOpen, setPayOpen] = useState(false);

  const lockedStaff = start.lockedStaff ? catalog.staff.find((s) => s.id === start.staffId) ?? null : null;
  const services = serviceIds.map((id) => catalog.services.find((s) => s.id === id)!).filter(Boolean);
  const staff = staffId ? (catalog.staff.find((s) => s.id === staffId) ?? null) : null;
  const q = quote(services, staff);
  const slotPrice = pick.slot?.options[0]?.price;
  const total = slotPrice ?? q.price;
  const deposit =
    catalog.business.settings.paymentProvider !== 'none' && catalog.business.settings.depositPercent > 0
      ? Math.min(total, Math.ceil((total * catalog.business.settings.depositPercent) / 100 / 1000) * 1000)
      : 0;

  const go = (s: number) => {
    setDir(s > step ? 1 : -1);
    setStep(s);
    const frame = document.getElementById('phone-screen');
    if (frame && frame.scrollHeight > frame.clientHeight) frame.scrollTo({ top: 0 });
    else window.scrollTo({ top: 0 });
  };
  const back = () => {
    if (step === 2 && start.lockedStaff) go(0);
    else go(step - 1);
  };
  useBackButton(step > 0 && step < 4 ? back : null);

  const phoneOk = normalizePhone(phone) !== null;
  const nameOk = name.trim().length > 0;

  const submit = async () => {
    setTouched(true);
    if (!pick.slot || !nameOk || !phoneOk) {
      tg.haptic('error');
      return;
    }
    setBusy(true);
    try {
      const res = await backend.createBooking({
        serviceIds,
        staffId: staffId ?? null,
        start: pick.slot.start,
        name: name.trim(),
        phone,
        notes: notes.trim() || null,
      });
      setCreated(res);
      setBooking(res.booking);
      tg.haptic('success');
      if (res.payment) setPayOpen(true);
      go(4);
    } catch (e) {
      tg.haptic('error');
      toast(errorText(t, e), 'error');
      if ((e as { code?: string }).code === 'SLOT_UNAVAILABLE') {
        setPick((p) => ({ date: p.date, slot: null }));
        go(2);
      }
    } finally {
      setBusy(false);
    }
  };

  const main =
    step === 0
      ? {
          text: serviceIds.length ? `${t.continue} · ${t.services(serviceIds.length)}` : t.chooseServices,
          visible: true,
          disabled: serviceIds.length === 0,
          onClick: () => go(start.lockedStaff ? 2 : 1),
        }
      : step === 3
        ? {
            text: deposit ? t.payAndBook(formatMoney(deposit, lang)) : t.confirmBook,
            visible: true,
            disabled: false,
            progress: busy,
            onClick: submit,
          }
        : step === 4
          ? { text: t.myBookings, visible: true, onClick: onOpenBookings }
          : { text: t.pickTimeFirst, visible: false, onClick: () => undefined };
  useMainButton(main);

  return (
    <div className="flow">
      {step < 4 && <Stepper step={step} />}
      <AnimatePresence mode="wait" custom={dir} initial={false}>
        <motion.div
          key={step}
          custom={dir}
          initial={{ opacity: 0, x: dir * 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: dir * -20 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {step === 0 && (
            <ServicePicker
              catalog={catalog}
              selected={serviceIds}
              onlyStaff={lockedStaff}
              onToggle={(id) => {
                setServiceIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
                setPick({ date: null, slot: null });
              }}
            />
          )}
          {step === 1 && (
            <MasterPicker
              catalog={catalog}
              serviceIds={serviceIds}
              selected={staffId}
              onPick={(id) => {
                setStaffId(id);
                setPick({ date: null, slot: null });
                go(2);
              }}
            />
          )}
          {step === 2 && (
            <DateTimePicker
              catalog={catalog}
              serviceIds={serviceIds}
              staffId={staffId ?? null}
              value={pick}
              title={t.chooseTime}
              onChange={(v) => {
                setPick(v);
                if (v.slot) go(3);
              }}
            />
          )}
          {step === 3 && pick.slot && (
            <div className="step">
              <h1 className="step-title">{t.confirmTitle}</h1>
              <div className="summary">
                <div className="summary-when">
                  <span className="num summary-time">
                    {time.hm(pick.slot.start)}
                    <small>–{time.hm(pick.slot.options[0]!.end)}</small>
                  </span>
                  <span>{formatDateLong(utcToZoned(pick.slot.start, tz).date, lang)}</span>
                </div>
                <ul className="summary-lines">
                  {services.map((s) => (
                    <li key={s.id}>
                      <span>{pickText(s.name, lang)}</span>
                    </li>
                  ))}
                  <li>
                    <span className="muted">{t.stepMaster}</span>
                    <span>{staff?.name ?? t.anyMaster}</span>
                  </li>
                  <li>
                    <span className="muted">{formatDuration(q.minutes, lang)}</span>
                    <span className="num">{formatMoney(total, lang)}</span>
                  </li>
                  {deposit > 0 && (
                    <li className="deposit">
                      <span>{t.deposit}</span>
                      <span className="num">{formatMoney(deposit, lang)}</span>
                    </li>
                  )}
                </ul>
                {deposit > 0 && <p className="fine">{t.depositHint(catalog.business.settings.depositPercent)}</p>}
              </div>
              <form
                className="form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <label className="field">
                  <span>{t.yourName}</span>
                  <input
                    name="name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-invalid={touched && !nameOk}
                  />
                  {touched && !nameOk && <span className="error">{t.nameRequired}</span>}
                </label>
                <label className="field">
                  <span>{t.yourPhone}</span>
                  <input
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+998 90 123 45 67"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onBlur={() => phoneOk && setPhone(formatPhone(normalizePhone(phone)!))}
                    aria-invalid={touched && !phoneOk}
                  />
                  {touched && !phoneOk ? <span className="error">{t.phoneInvalid}</span> : <span className="fine">{t.phoneHint}</span>}
                </label>
                <label className="field">
                  <span>{t.notes}</span>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />
                </label>
                <button type="submit" hidden />
              </form>
            </div>
          )}
          {step === 4 && booking && (
            <div className="step done">
              <h1 className="step-title">{booking.status === 'pending' ? t.ticketPending : t.ticketIssued}</h1>
              <Ticket booking={booking} tz={tz} business={catalog.business.name} print />
              <p className="fine center">{t.addToBot}</p>
              {booking.status === 'pending' && created?.payment && (
                <button type="button" className="btn block" onClick={() => setPayOpen(true)}>
                  {t.payNow}
                </button>
              )}
              <button
                type="button"
                className="btn ghost block"
                onClick={() => {
                  setServiceIds([]);
                  setStaffId(start.lockedStaff ? start.staffId : undefined);
                  setPick({ date: null, slot: null });
                  setBooking(null);
                  setCreated(null);
                  go(0);
                }}
              >
                {t.bookAnother}
              </button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      {created?.payment && booking && (
        <PaymentSheet
          open={payOpen}
          onClose={() => setPayOpen(false)}
          payment={created.payment}
          onPaid={(b) => {
            setBooking(b);
            setPayOpen(false);
          }}
        />
      )}
    </div>
  );
}
