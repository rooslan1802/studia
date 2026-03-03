import React from 'react';
import { NavLink } from 'react-router-dom';
import sidebarLogo from '../logo/Logo1.png';
import compactLogo from '../logo/logo.png';

const navItems = [
  { to: '/', label: 'Главная', icon: HomeIcon },
  { to: '/structure', label: 'Моя организация', icon: OrganizationIcon },
  { to: '/children', label: 'Ученики', icon: ChildIcon },
  { to: '/attendance', label: 'Мои табели', icon: AttendanceIcon },
  { to: '/damubala-helper', label: 'Дамубала помощник', icon: QrIcon },
  { to: '/payments', label: 'Оплаты', icon: MoneyIcon },
  { to: '/whatsapp', label: 'WhatsApp', icon: WhatsAppIcon }
];

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path d="M4 11.5L12 5l8 6.5M6.5 10v8h11v-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OrganizationIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path d="M5 18h14M7 18V9m5 9V6m5 12v-7M4 9h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChildIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path d="M12 10.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4zM5 20a7 7 0 0114 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AttendanceIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path d="M7 4v3M17 4v3M4.5 9h15M7 12l2.1 2.2L13 10.5M6 20h12a1.5 1.5 0 001.5-1.5v-11A1.5 1.5 0 0018 6H6A1.5 1.5 0 004.5 7.5v11A1.5 1.5 0 006 20z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MoneyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path d="M4.5 7.5h15v9h-15zM8 12h8M7 10.2h0M17 13.8h0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function QrIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM16 14h1M14 14h1M19 14h1M14 17h1M16 19h4M19 16h1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path d="M12 4.5a7.5 7.5 0 0 0-6.7 10.9L4.5 19.5l4.2-.8A7.5 7.5 0 1 0 12 4.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.4 9.3c.2-.2.4-.2.6-.1l1 .9c.2.2.2.4.1.6l-.4.8c.7 1.2 1.7 2 2.9 2.7l.8-.4c.2-.1.5-.1.6.1l.9 1c.1.2.1.4-.1.6-.6.6-1.4.9-2.2.7-2.5-.6-4.6-2.7-5.2-5.2-.2-.8.1-1.6.7-2.2z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Sidebar({ collapsed }) {
  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="logo logo-wrap">
        <img src={collapsed ? compactLogo : sidebarLogo} alt="Studia" className={`logo-image${collapsed ? ' compact' : ''}`} />
      </div>
      <nav>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            <span className="nav-icon"><item.icon /></span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
