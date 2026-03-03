import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@renderer/api';

const READ_STORAGE_KEY = 'studia.notifications.read.v1';

function notificationKey(item) {
  return String(item?.id || `${item?.type}:${item?.childId || item?.sourceId || ''}`);
}

function loadReadMap() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(READ_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function targetRoute(item) {
  if (item.type === 'payment-overdue') return '/payments';
  if (item.type === 'voucher-ending-soon') return '/children?type=voucher';
  if (item.type === 'queue-voucher-ready') return '/children?type=queue';
  if (item.type === 'attendance-cancelled') return '/attendance';
  return '/notifications';
}

function soundByCategory(category) {
  if (category === 'payments') return [420, 0.16];
  if (category === 'vouchers') return [620, 0.14];
  if (category === 'queue') return [760, 0.16];
  if (category === 'attendance') return [520, 0.15];
  return [560, 0.12];
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path
        d="M6 9a6 6 0 1112 0v4.5l1.5 2H4.5L6 13.5V9zm4 9a2 2 0 004 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function NotificationsBell() {
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [readMap, setReadMap] = useState(() => loadReadMap());
  const mountedRef = useRef(false);
  const prevKeysRef = useRef(new Set());

  async function refreshNotifications() {
    const list = await api.listNotifications();
    setItems(Array.isArray(list) ? list : []);
  }

  useEffect(() => {
    refreshNotifications();
    const timer = window.setInterval(refreshNotifications, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const keys = new Set(items.map(notificationKey));
    if (!mountedRef.current) {
      mountedRef.current = true;
      prevKeysRef.current = keys;
      return;
    }

    const newItems = items.filter((item) => !prevKeysRef.current.has(notificationKey(item)) && !readMap[notificationKey(item)]);
    if (newItems.length) {
      setToasts((prev) => [...newItems.slice(0, 3), ...prev].slice(0, 6));
      const latest = newItems[0];
      const [freq, duration] = soundByCategory(latest.category);
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.value = 0.0001;
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const now = audioCtx.currentTime;
        gain.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        osc.start(now);
        osc.stop(now + duration + 0.03);
      } catch {
        // ignore audio errors
      }
    }
    prevKeysRef.current = keys;
  }, [items, readMap]);

  useEffect(() => {
    function onClickOutside(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    if (!toasts.length) return undefined;
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.slice(0, -1));
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  const unreadCount = useMemo(
    () => items.filter((item) => !readMap[notificationKey(item)]).length,
    [items, readMap]
  );

  function markAsRead(item) {
    const key = notificationKey(item);
    const next = { ...readMap, [key]: true };
    setReadMap(next);
    window.localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(next));
  }

  function onOpenToggle() {
    if (!open) refreshNotifications();
    setOpen((v) => !v);
  }

  function onNotificationClick(item) {
    markAsRead(item);
    setOpen(false);
    navigate(targetRoute(item));
  }

  return (
    <div ref={rootRef} className="notifications-wrap">
      <button className="bell-btn" onClick={onOpenToggle} title="Уведомления" aria-label="Уведомления">
        <BellIcon />
        {unreadCount > 0 && <span className="bell-count">{unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-popover">
          <div className="notif-title">Уведомления</div>
          {items.slice(0, 20).map((item, index) => {
            const isRead = Boolean(readMap[notificationKey(item)]);
            return (
              <button
                key={`${item.type}-${item.childId}-${index}`}
                className={`notif-item${isRead ? ' read' : ''}`}
                onClick={() => onNotificationClick(item)}
              >
                <div className="notif-item-head">
                  <span>{item.title}</span>
                  {!isRead && <span className="notif-dot" />}
                </div>
                <div className="notif-category">{item.category || 'system'}</div>
                <div className="notif-message">{item.message}</div>
                <div className="notif-studio">{item.studioName}</div>
              </button>
            );
          })}
          {!items.length && <div style={{ color: '#97a7c3' }}>Нет уведомлений</div>}
        </div>
      )}

      <div className="notif-toast-stack">
        {toasts.map((item) => (
          <button
            key={`toast-${notificationKey(item)}`}
            className={`notif-toast ${item.category || 'system'}`}
            onClick={() => {
              onNotificationClick(item);
              setToasts((prev) => prev.filter((x) => notificationKey(x) !== notificationKey(item)));
            }}
          >
            <div className="notif-toast-title">{item.title}</div>
            <div className="notif-toast-message">{item.message}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
