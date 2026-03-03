import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from '@renderer/api';
import Sidebar from '@components/Sidebar';
import NotificationsBell from '@components/NotificationsBell';
import ScrollJumpButton from '@components/ScrollJumpButton';
import DashboardPage from '@pages/DashboardPage';
import StructurePage from '@pages/StructurePage';
import ChildrenPage from '@pages/ChildrenPage';
import PaymentsPage from '@pages/PaymentsPage';
import AttendancePage from '@pages/AttendancePage';
import NotificationsPage from '@pages/NotificationsPage';
import WhatsAppPage from '@pages/WhatsAppPage';
import WhatsAppSettings from '@pages/WhatsAppSettings';
import DamubalaHelperPage from '@pages/DamubalaHelperPage';

const BACKEND_URLS = ['http://localhost:47831', 'http://127.0.0.1:47831'];

async function fetchBackendJson(path) {
  let lastError = null;
  for (const baseUrl of BACKEND_URLS) {
    try {
      const response = await fetch(`${baseUrl}${path}`);
      const data = await response.json();
      return { ok: response.ok, data };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Failed to fetch');
}

const pageTitles = {
  '/': 'Главная',
  '/structure': 'Моя организация',
  '/children': 'Ученики',
  '/attendance': 'Мои табели',
  '/payments': 'Оплаты',
  '/notifications': 'Уведомления',
  '/whatsapp': 'WhatsApp Рассылка',
  '/whatsapp-settings': 'Подключение WhatsApp',
  '/damubala-helper': 'Дамубала помощник'
};

function ChevronIcon({ collapsed }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      {collapsed ? (
        <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [damubalaStatus, setDamubalaStatus] = useState({ connected: false, syncing: false, error: '' });
  const [whatsappStatus, setWhatsappStatus] = useState({ connected: false, error: '' });
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const [findTotal, setFindTotal] = useState(0);
  const findInputRef = useRef(null);
  const findMarksRef = useRef([]);

  useEffect(() => {
    const saved = window.localStorage.getItem('studia.sidebar.collapsed.v1');
    setSidebarCollapsed(saved === '1');
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem('studia.sidebar.collapsed.v1', next ? '1' : '0');
      return next;
    });
  }

  const currentTitle = useMemo(() => {
    if (location.pathname.startsWith('/children')) return pageTitles['/children'];
    return pageTitles[location.pathname] || 'Studia';
  }, [location.pathname]);

  async function loadDamubalaStatus() {
    const result = await api.getDamubalaConnectionStatus();
    if (result?.success) {
      setDamubalaStatus((prev) => ({ ...prev, connected: !!result.connected, error: '' }));
    }
  }

  async function loadWhatsappStatus() {
    try {
      const { data } = await fetchBackendJson('/api/whatsapp/status');
      setWhatsappStatus({ connected: !!data?.connected, error: '' });
    } catch (error) {
      setWhatsappStatus({ connected: false, error: error?.message || 'status error' });
    }
  }

  useEffect(() => {
    loadDamubalaStatus();
    loadWhatsappStatus();
    const timer = window.setInterval(() => {
      loadDamubalaStatus();
      loadWhatsappStatus();
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function handleKeydown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFindOpen(true);
      } else if (event.key === 'Escape') {
        setFindOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, []);

  function getFindRoot() {
    return document.querySelector('.content');
  }

  function clearFindMarks() {
    const root = getFindRoot();
    if (!root) return;
    const marks = root.querySelectorAll('mark.inpage-find-mark, mark.inpage-find-mark-active');
    marks.forEach((mark) => {
      const textNode = document.createTextNode(mark.textContent || '');
      mark.replaceWith(textNode);
    });
    root.normalize();
    findMarksRef.current = [];
    setFindTotal(0);
    setFindIndex(0);
  }

  function collectAndMark(query) {
    const root = getFindRoot();
    if (!root) return [];
    clearFindMarks();

    const raw = String(query || '').trim();
    if (!raw) return [];
    const q = raw.toLowerCase();

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('.inpage-find-box')) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (['SCRIPT', 'STYLE', 'MARK', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON'].includes(tag)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const textNodes = [];
    let currentNode = walker.nextNode();
    while (currentNode) {
      textNodes.push(currentNode);
      currentNode = walker.nextNode();
    }

    const marks = [];
    textNodes.forEach((node) => {
      const text = node.nodeValue || '';
      const lower = text.toLowerCase();
      let cursor = 0;
      let idx = lower.indexOf(q, cursor);
      if (idx < 0) return;

      const fragment = document.createDocumentFragment();
      while (idx >= 0) {
        if (idx > cursor) {
          fragment.appendChild(document.createTextNode(text.slice(cursor, idx)));
        }
        const mark = document.createElement('mark');
        mark.className = 'inpage-find-mark';
        mark.textContent = text.slice(idx, idx + q.length);
        fragment.appendChild(mark);
        marks.push(mark);
        cursor = idx + q.length;
        idx = lower.indexOf(q, cursor);
      }
      if (cursor < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(cursor)));
      }
      node.replaceWith(fragment);
    });

    findMarksRef.current = marks;
    return marks;
  }

  function activateFindMark(nextIndex) {
    const marks = findMarksRef.current || [];
    if (!marks.length) {
      setFindTotal(0);
      setFindIndex(0);
      return;
    }
    marks.forEach((mark) => {
      mark.classList.remove('inpage-find-mark-active');
      mark.classList.add('inpage-find-mark');
    });
    const normalized = ((nextIndex % marks.length) + marks.length) % marks.length;
    const target = marks[normalized];
    target.classList.remove('inpage-find-mark');
    target.classList.add('inpage-find-mark-active');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFindIndex(normalized);
    setFindTotal(marks.length);
  }

  useEffect(() => {
    if (!findOpen) {
      clearFindMarks();
      return;
    }
    window.setTimeout(() => findInputRef.current?.focus(), 0);
  }, [findOpen]);

  useEffect(() => {
    if (!findOpen) return;
    const marks = collectAndMark(findQuery);
    if (!marks.length) {
      setFindTotal(0);
      setFindIndex(0);
      return;
    }
    activateFindMark(0);
  }, [findQuery, findOpen, location.pathname]);

  async function connectDamubalaNow() {
    setDamubalaStatus((prev) => ({ ...prev, syncing: true, error: '' }));
    const res = await api.connectDamubala();
    if (res?.success) {
      setDamubalaStatus({ connected: true, syncing: false, error: '' });
    } else {
      setDamubalaStatus({ connected: false, syncing: false, error: res?.message || 'Не удалось подключить Damubala' });
    }
  }

  return (
    <div className={`layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar collapsed={sidebarCollapsed} />
      <main className="content">
        <div className="content-topbar">
          <div className="topbar-left">
            <button
              className="topbar-collapse-btn"
              onClick={toggleSidebar}
              title={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
            >
              <ChevronIcon collapsed={sidebarCollapsed} />
            </button>
            <div className="topbar-title">{currentTitle}</div>
          </div>
          <div className="topbar-right">
            <button
              className={`status-chip ${whatsappStatus.connected ? 'ok' : 'danger'}`}
              onClick={() => navigate('/whatsapp-settings')}
              title={whatsappStatus.connected ? 'WhatsApp подключен' : 'WhatsApp не подключен'}
            >
              WhatsApp {whatsappStatus.connected ? '●' : '○'}
            </button>
            <button
              className={`status-chip ${damubalaStatus.connected ? 'ok' : 'danger'}`}
              onClick={connectDamubalaNow}
              disabled={damubalaStatus.syncing}
              title={damubalaStatus.error || (damubalaStatus.connected ? 'Damubala подключен' : 'Подключить Damubala')}
            >
              {damubalaStatus.syncing ? 'Damubala...' : `Damubala ${damubalaStatus.connected ? '●' : '○'}`}
            </button>
            <NotificationsBell />
          </div>
        </div>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/structure" element={<StructurePage />} />
          <Route path="/children" element={<ChildrenPage />} />
          <Route path="/attendance" element={<AttendancePage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/whatsapp-settings" element={<WhatsAppSettings />} />
          <Route path="/whatsapp" element={<WhatsAppPage />} />
          <Route path="/damubala-helper" element={<DamubalaHelperPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        {findOpen && (
          <div className="inpage-find-box">
            <input
              ref={findInputRef}
              value={findQuery}
              onChange={(event) => setFindQuery(event.target.value)}
              placeholder="Поиск на странице"
            />
            <span>{findTotal ? `${findIndex + 1}/${findTotal}` : '0/0'}</span>
            <button type="button" onClick={() => activateFindMark(findIndex - 1)} disabled={!findTotal}>↑</button>
            <button type="button" onClick={() => activateFindMark(findIndex + 1)} disabled={!findTotal}>↓</button>
            <button type="button" onClick={() => setFindOpen(false)}>✕</button>
          </div>
        )}
        <ScrollJumpButton />
      </main>
    </div>
  );
}
