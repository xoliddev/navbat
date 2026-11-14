import {
  type BusinessSettings,
  formatDuration,
  formatHm,
  formatMoney,
  parseHm,
  pickText,
  weekdayShort,
} from '@navbat/core';
import { useEffect, useState } from 'react';
import type { AdminMe, CatalogDTO, ScheduleRuleDTO, ServiceDTO, StaffDTO } from '../backend/types';
import { errorText, useI18n } from '../i18n';
import { Avatar, Sheet, useBackend, useToast } from '../lib';
import { useAdminI18n } from './strings';

function useSaver(onSaved: () => void) {
  const toast = useToast();
  const { t } = useI18n();
  const { a } = useAdminI18n();
  const [busy, setBusy] = useState(false);
  const save = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      toast(a.saved);
      onSaved();
      after?.();
    } catch (e) {
      toast(errorText(t, e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return { busy, save };
}

/* ---------------- services ---------------- */

export function ServicesView({ catalog, onSaved }: { catalog: CatalogDTO; onSaved: () => void }) {
  const { a, lang } = useAdminI18n();
  const [edit, setEdit] = useState<Partial<ServiceDTO> | null>(null);
  return (
    <section className="panel">
      <header className="panel-head">
        <h1>{a.services}</h1>
        <button
          type="button"
          className="btn small"
          onClick={() =>
            setEdit({
              name: {},
              durationMin: 30,
              price: 50_000,
              categoryId: catalog.categories[0]?.id ?? null,
              active: true,
            })
          }
        >
          + {a.addService}
        </button>
      </header>
      {catalog.categories.map((cat) => (
        <div key={cat.id} className="svc-admin-group">
          <h2 className="group-title">{pickText(cat.name, lang)}</h2>
          <div className="cards">
            {catalog.services
              .filter((s) => s.categoryId === cat.id)
              .map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`card-row ${s.active ? '' : 'inactive'}`}
                  onClick={() => setEdit(s)}
                >
                  <b>{pickText(s.name, lang)}</b>
                  <span className="muted">
                    {formatDuration(s.durationMin, lang)}
                    {s.bufferBeforeMin || s.bufferAfterMin
                      ? ` (+${s.bufferBeforeMin}/${s.bufferAfterMin})`
                      : ''}
                  </span>
                  <span className="num">{formatMoney(s.price, lang)}</span>
                  {!s.active && <span className="chip">{a.hidden}</span>}
                </button>
              ))}
          </div>
        </div>
      ))}
      <ServiceSheet value={edit} catalog={catalog} onClose={() => setEdit(null)} onSaved={onSaved} />
    </section>
  );
}

function ServiceSheet({
  value,
  catalog,
  onClose,
  onSaved,
}: {
  value: Partial<ServiceDTO> | null;
  catalog: CatalogDTO;
  onClose: () => void;
  onSaved: () => void;
}) {
  const backend = useBackend();
  const { a, lang } = useAdminI18n();
  const [v, setV] = useState<Partial<ServiceDTO>>({});
  const { busy, save } = useSaver(onSaved);
  useEffect(() => setV(value ?? {}), [value]);
  const name = v.name ?? {};
  return (
    <Sheet open={!!value} onClose={onClose} title={v.id ? a.editService : a.addService} wide>
      <form
        className="form two"
        onSubmit={(e) => {
          e.preventDefault();
          void save(
            () =>
              backend.saveService({
                id: v.id,
                categoryId: v.categoryId ?? null,
                name,
                description: v.description,
                durationMin: Number(v.durationMin),
                price: Number(v.price),
                bufferBeforeMin: Number(v.bufferBeforeMin ?? 0),
                bufferAfterMin: Number(v.bufferAfterMin ?? 0),
                active: v.active ?? true,
                position: v.position,
              }),
            onClose,
          );
        }}
      >
        {(['uz', 'ru', 'en'] as const).map((l) => (
          <label key={l} className={`field ${l === 'uz' ? 'span2' : ''}`}>
            <span>{l === 'uz' ? a.nameUz : l === 'ru' ? a.nameRu : a.nameEn}</span>
            <input
              value={name[l] ?? ''}
              required={l === 'uz'}
              onChange={(e) => setV({ ...v, name: { ...name, [l]: e.target.value } })}
            />
          </label>
        ))}
        <label className="field">
          <span>{a.category}</span>
          <select
            value={v.categoryId ?? ''}
            onChange={(e) => setV({ ...v, categoryId: e.target.value || null })}
          >
            {catalog.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {pickText(c.name, lang)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{a.duration}</span>
          <input
            type="number"
            min={5}
            max={720}
            step={5}
            value={v.durationMin ?? ''}
            onChange={(e) => setV({ ...v, durationMin: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>{a.price}</span>
          <input
            type="number"
            min={0}
            step={1000}
            value={v.price ?? ''}
            onChange={(e) => setV({ ...v, price: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>{a.bufferBefore}</span>
          <input
            type="number"
            min={0}
            max={240}
            step={5}
            value={v.bufferBeforeMin ?? 0}
            onChange={(e) => setV({ ...v, bufferBeforeMin: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>{a.bufferAfter}</span>
          <input
            type="number"
            min={0}
            max={240}
            step={5}
            value={v.bufferAfterMin ?? 0}
            onChange={(e) => setV({ ...v, bufferAfterMin: Number(e.target.value) })}
          />
        </label>
        <label className="check span2">
          <input
            type="checkbox"
            checked={v.active ?? true}
            onChange={(e) => setV({ ...v, active: e.target.checked })}
          />
          {a.active}
        </label>
        <div className="span2 form-actions">
          <button type="submit" className="btn" disabled={busy}>
            {a.save}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/* ---------------- team & schedules ---------------- */

export function TeamView({
  catalog,
  me,
  onSaved,
}: {
  catalog: CatalogDTO;
  me: AdminMe;
  onSaved: () => void;
}) {
  const { a, lang } = useAdminI18n();
  const [edit, setEdit] = useState<Partial<StaffDTO> | null>(null);
  const canStaff = me.role === 'owner';
  return (
    <section className="panel">
      <header className="panel-head">
        <h1>{a.team}</h1>
        {canStaff && (
          <button
            type="button"
            className="btn small"
            onClick={() =>
              setEdit({ name: '', role: 'master', bookable: true, color: '#0f9d8a', services: [] })
            }
          >
            + {a.addMember}
          </button>
        )}
      </header>
      <div className="cards team">
        {catalog.staff.map((s) => (
          <button
            key={s.id}
            type="button"
            className="card-row member"
            onClick={() => setEdit(s)}
            data-testid="team-member"
          >
            <Avatar name={s.name} color={s.color} size={40} />
            <span>
              <b>{s.name}</b>
              <span className="muted">
                {pickText(s.title, lang) || a.roles[s.role]} · {a.roles[s.role]}
              </span>
            </span>
            {s.rating ? <span className="num">{s.rating.toFixed(1)} ★</span> : <span />}
          </button>
        ))}
      </div>
      <StaffSheet
        value={edit}
        catalog={catalog}
        canEditProfile={canStaff}
        onClose={() => setEdit(null)}
        onSaved={onSaved}
      />
    </section>
  );
}

function StaffSheet({
  value,
  catalog,
  canEditProfile,
  onClose,
  onSaved,
}: {
  value: Partial<StaffDTO> | null;
  catalog: CatalogDTO;
  canEditProfile: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const backend = useBackend();
  const { a, lang } = useAdminI18n();
  const [v, setV] = useState<Partial<StaffDTO>>({});
  const [rules, setRules] = useState<ScheduleRuleDTO[] | null>(null);
  const { busy, save } = useSaver(onSaved);
  useEffect(() => {
    setV(value ?? {});
    setRules(null);
    if (value?.id && value.bookable) void backend.schedule(value.id).then(setRules);
    else setRules([]);
  }, [value, backend]);
  const offers = v.services ?? [];

  const day = (wd: number) => {
    const work = rules?.find((r) => r.kind === 'work' && r.weekday === wd);
    const brk = rules?.find((r) => r.kind === 'break' && r.weekday === wd);
    return { work, brk };
  };
  const setDay = (wd: number, kind: 'work' | 'break', range: [number, number] | null) => {
    setRules((rs) => {
      const rest = (rs ?? []).filter((r) => !(r.weekday === wd && r.kind === kind));
      return range ? [...rest, { kind, weekday: wd, startMin: range[0], endMin: range[1] }] : rest;
    });
  };
  const hm = (v: string) => {
    try {
      return parseHm(v);
    } catch {
      return 0;
    }
  };

  return (
    <Sheet open={!!value} onClose={onClose} title={v.id ? a.editMember : a.addMember} wide>
      <form
        className="form two"
        onSubmit={(e) => {
          e.preventDefault();
          void save(async () => {
            let id = v.id;
            if (canEditProfile) {
              const saved = await backend.saveStaff({
                id: v.id,
                branchId: v.branchId ?? catalog.branches[0]?.id ?? null,
                name: v.name ?? '',
                title: v.title,
                color: v.color,
                role: v.role,
                bookable: v.bookable,
                active: v.active ?? true,
                telegramUserId: v.telegramUserId ?? null,
                services: offers.map((o) => ({
                  serviceId: o.serviceId,
                  price: o.price,
                  durationMin: o.durationMin,
                })),
              });
              id = saved.id;
            }
            if (id && v.bookable && rules) await backend.saveSchedule(id, rules);
          }, onClose);
        }}
      >
        <label className="field">
          <span>{a.name}</span>
          <input
            value={v.name ?? ''}
            required
            disabled={!canEditProfile}
            onChange={(e) => setV({ ...v, name: e.target.value })}
          />
        </label>
        <label className="field">
          <span>{a.title}</span>
          <input
            value={v.title?.[lang] ?? ''}
            disabled={!canEditProfile}
            onChange={(e) => setV({ ...v, title: { ...(v.title ?? {}), [lang]: e.target.value } })}
          />
        </label>
        <label className="field">
          <span>{a.role}</span>
          <select
            value={v.role ?? 'master'}
            disabled={!canEditProfile}
            onChange={(e) => setV({ ...v, role: e.target.value as StaffDTO['role'] })}
          >
            {(['owner', 'admin', 'master'] as const).map((r) => (
              <option key={r} value={r}>
                {a.roles[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{a.color}</span>
          <input
            type="color"
            value={v.color ?? '#3355dd'}
            disabled={!canEditProfile}
            onChange={(e) => setV({ ...v, color: e.target.value })}
          />
        </label>
        <label className="check span2">
          <input
            type="checkbox"
            checked={!!v.bookable}
            disabled={!canEditProfile}
            onChange={(e) => setV({ ...v, bookable: e.target.checked })}
          />
          {a.bookable}
        </label>
        {v.bookable && (
          <>
            <fieldset className="span2 offers">
              <legend>{a.services}</legend>
              {catalog.services.map((s) => {
                const o = offers.find((x) => x.serviceId === s.id);
                return (
                  <div key={s.id} className="offer">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!!o}
                        disabled={!canEditProfile}
                        onChange={(e) =>
                          setV({
                            ...v,
                            services: e.target.checked
                              ? [...offers, { serviceId: s.id, price: null, durationMin: null }]
                              : offers.filter((x) => x.serviceId !== s.id),
                          })
                        }
                      />
                      {pickText(s.name, lang)}
                    </label>
                    {o && (
                      <>
                        <input
                          className="input mini-input"
                          type="number"
                          aria-label={a.ownPrice}
                          placeholder={String(s.price)}
                          value={o.price ?? ''}
                          disabled={!canEditProfile}
                          onChange={(e) =>
                            setV({
                              ...v,
                              services: offers.map((x) =>
                                x.serviceId === s.id
                                  ? { ...x, price: e.target.value ? Number(e.target.value) : null }
                                  : x,
                              ),
                            })
                          }
                        />
                        <input
                          className="input mini-input"
                          type="number"
                          aria-label={a.ownDuration}
                          placeholder={String(s.durationMin)}
                          value={o.durationMin ?? ''}
                          disabled={!canEditProfile}
                          onChange={(e) =>
                            setV({
                              ...v,
                              services: offers.map((x) =>
                                x.serviceId === s.id
                                  ? { ...x, durationMin: e.target.value ? Number(e.target.value) : null }
                                  : x,
                              ),
                            })
                          }
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </fieldset>
            <fieldset className="span2 schedule">
              <legend>{a.schedule}</legend>
              {rules === null ? (
                <div className="spinner" />
              ) : (
                [1, 2, 3, 4, 5, 6, 7].map((wd) => {
                  const { work, brk } = day(wd);
                  return (
                    <div key={wd} className="sched-row">
                      <b>{weekdayShort(wd, lang)}</b>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={!!work}
                          onChange={(e) => setDay(wd, 'work', e.target.checked ? [600, 1200] : null)}
                        />
                        {work ? a.work : a.dayOff}
                      </label>
                      {work && (
                        <>
                          <input
                            className="input mini-input"
                            type="time"
                            value={formatHm(work.startMin)}
                            onChange={(e) => setDay(wd, 'work', [hm(e.target.value), work.endMin])}
                            aria-label={`${a.work} ${a.start}`}
                          />
                          <input
                            className="input mini-input"
                            type="time"
                            value={formatHm(work.endMin)}
                            onChange={(e) => setDay(wd, 'work', [work.startMin, hm(e.target.value) || 1440])}
                            aria-label={`${a.work} ${a.end}`}
                          />
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={!!brk}
                              onChange={(e) => setDay(wd, 'break', e.target.checked ? [780, 840] : null)}
                            />
                            {a.break}
                          </label>
                          {brk && (
                            <>
                              <input
                                className="input mini-input"
                                type="time"
                                value={formatHm(brk.startMin)}
                                onChange={(e) => setDay(wd, 'break', [hm(e.target.value), brk.endMin])}
                                aria-label={`${a.break} ${a.start}`}
                              />
                              <input
                                className="input mini-input"
                                type="time"
                                value={formatHm(brk.endMin)}
                                onChange={(e) => setDay(wd, 'break', [brk.startMin, hm(e.target.value)])}
                                aria-label={`${a.break} ${a.end}`}
                              />
                            </>
                          )}
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </fieldset>
          </>
        )}
        <div className="span2 form-actions">
          <button type="submit" className="btn" disabled={busy}>
            {a.save}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/* ---------------- settings ---------------- */

export function SettingsView({ catalog, onSaved }: { catalog: CatalogDTO; onSaved: () => void }) {
  const backend = useBackend();
  const { a } = useAdminI18n();
  const [name, setName] = useState(catalog.business.name);
  const [s, setS] = useState<BusinessSettings>(catalog.business.settings);
  const { busy, save } = useSaver(onSaved);
  const num = (k: keyof BusinessSettings, label: string, min: number, max: number, step = 1) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={s[k] as number}
        onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <section className="panel narrow">
      <header className="panel-head">
        <h1>{a.settings}</h1>
      </header>
      <form
        className="form two"
        onSubmit={(e) => {
          e.preventDefault();
          void save(() => backend.saveSettings({ name, settings: s }));
        }}
      >
        <label className="field span2">
          <span>{a.businessName}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {num('minNoticeMin', a.minNotice, 0, 10080, 15)}
        {num('horizonDays', a.horizon, 1, 365)}
        {num('slotStepMin', a.slotStep, 5, 120, 5)}
        {num('cancelWindowMin', a.cancelWindow, 0, 10080, 15)}
        {num('depositPercent', a.depositPercent, 0, 100, 5)}
        <label className="field">
          <span>{a.provider}</span>
          <select
            value={s.paymentProvider}
            onChange={(e) =>
              setS({ ...s, paymentProvider: e.target.value as BusinessSettings['paymentProvider'] })
            }
          >
            <option value="none">—</option>
            <option value="sandbox">Sandbox</option>
            <option value="payme">Payme</option>
            <option value="click">Click</option>
            <option value="stars">Telegram Stars</option>
          </select>
        </label>
        {num('digestHour', a.digestHour, 0, 23)}
        <p className="fine span2">{a.providerNote}</p>
        <div className="span2 form-actions">
          <button type="submit" className="btn" disabled={busy} data-testid="save-settings">
            {a.save}
          </button>
        </div>
      </form>
    </section>
  );
}
