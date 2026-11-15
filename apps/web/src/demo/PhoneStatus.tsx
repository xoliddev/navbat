/** Status bar of the desktop phone frame: live clock, signal, Wi-Fi and battery, like a real handset. */
import { useEffect, useState } from 'react';

const clock = () => {
  const d = new Date();
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function PhoneStatus() {
  const [time, setTime] = useState(clock);
  useEffect(() => {
    const id = setInterval(() => setTime(clock()), 20_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="phone-status" aria-hidden="true">
      <span className="phone-clock">{time}</span>
      <span className="phone-icons">
        <svg viewBox="0 0 18 12">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg viewBox="0 0 16 12">
          <path d="M8 2.2c2.4 0 4.6.9 6.2 2.5l1.3-1.3A10.5 10.5 0 0 0 8 .3 10.5 10.5 0 0 0 .5 3.4l1.3 1.3A8.7 8.7 0 0 1 8 2.2zm0 3.7c1.4 0 2.7.5 3.6 1.4l1.3-1.3A6.9 6.9 0 0 0 8 4a6.9 6.9 0 0 0-4.9 2l1.3 1.3c1-.9 2.2-1.4 3.6-1.4zm0 3.6c-.5 0-1 .2-1.3.6L8 11.4l1.3-1.3c-.3-.4-.8-.6-1.3-.6z" />
        </svg>
        <span className="phone-batt">
          <i />
        </span>
      </span>
    </div>
  );
}
