import React, { useEffect, useMemo, useState } from 'react';
import { api } from '@renderer/api';
import Modal from '@components/Modal';

const BACKEND_URLS = ['http://localhost:47831', 'http://127.0.0.1:47831'];

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthIso(offset = 0) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthTitle(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

function cycleTo8(absoluteLesson) {
  const value = Number(absoluteLesson || 0);
  if (value <= 0) return 0;
  if (value === 1) return 1;
  return ((value - 1) % 8) + 1;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function greetingByTime(now = new Date()) {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function renderTemplate(template, childName) {
  return String(template || '')
    .replaceAll('{greeting}', greetingByTime())
    .replaceAll('{childName}', String(childName || '').trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBackendJson(path, init) {
  let lastError = null;
  for (const baseUrl of BACKEND_URLS) {
    try {
      const response = await fetch(`${baseUrl}${path}`, init);
      const data = await response.json();
      return { ok: response.ok, data };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Failed to fetch');
}

function groupByMonthAndParent(items) {
  const byMonth = new Map();
  items.forEach((item) => {
    const month = item.billingMonth || todayIso().slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, new Map());
    const parentKey = item.parentFullName || item.parentPhone || 'Без родителя';
    if (!byMonth.get(month).has(parentKey)) {
      byMonth.get(month).set(parentKey, {
        parentKey,
        parentName: item.parentFullName || 'Без имени',
        parentPhone: item.parentPhone || '—',
        children: []
      });
    }
    byMonth.get(month).get(parentKey).children.push(item);
  });

  return Array.from(byMonth.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, parentMap]) => ({
      month,
      parents: Array.from(parentMap.values()).sort((a, b) => a.parentName.localeCompare(b.parentName, 'ru'))
    }));
}

export default function PaymentsPage() {
  const [items, setItems] = useState([]);
  const [paidTransactions, setPaidTransactions] = useState([]);
  const [error, setError] = useState('');
  const [monthOffset, setMonthOffset] = useState(0);
  const [childModal, setChildModal] = useState(null);
  const [commentModal, setCommentModal] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [history, setHistory] = useState([]);
  const [cities, setCities] = useState([]);
  const [courses, setCourses] = useState([]);
  const [groups, setGroups] = useState([]);
  const [filters, setFilters] = useState({
    cityId: '',
    courseId: '',
    groupId: '',
    parentQuery: ''
  });
  const [payAmount, setPayAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Каспи');
  const [payComment, setPayComment] = useState('');
  const [payDate, setPayDate] = useState(todayIso());
  const [waStatus, setWaStatus] = useState({ connected: false, connecting: false, error: '' });
  const [waTemplate, setWaTemplate] = useState('{greeting}! Подошло время оплаты для {childName}. Могу выставить удаленный счет для оплаты?');
  const [waIntervalSec, setWaIntervalSec] = useState(35);
  const [waJitterSec, setWaJitterSec] = useState(10);
  const [waSelected, setWaSelected] = useState({});
  const [waSending, setWaSending] = useState(false);
  const [waProgress, setWaProgress] = useState({ total: 0, sent: 0, failed: 0, current: '' });
  const [waLog, setWaLog] = useState([]);

  const selectedMonth = useMemo(() => monthIso(monthOffset), [monthOffset]);

  async function loadMeta() {
    const [cityList, courseList] = await Promise.all([api.listCities(), api.listCourses()]);
    setCities(cityList);
    setCourses(courseList);
  }

  async function load() {
    const commonFilters = {
      cityId: filters.cityId || undefined,
      courseId: filters.courseId || undefined,
      groupId: filters.groupId || undefined,
      parentQuery: filters.parentQuery || undefined
    };
    const [list, txList] = await Promise.all([
      api.listPayments(commonFilters),
      api.listPaymentTransactions(commonFilters)
    ]);
    setItems(list);
    setPaidTransactions(txList);
  }

  useEffect(() => {
    loadMeta();
  }, []);

  useEffect(() => {
    load();
  }, [filters.cityId, filters.courseId, filters.groupId, filters.parentQuery]);

  useEffect(() => {
    async function loadGroups() {
      if (!filters.courseId) {
        setGroups([]);
        return;
      }
      setGroups(await api.listGroups(Number(filters.courseId)));
    }
    loadGroups();
  }, [filters.courseId]);

  useEffect(() => {
    async function loadWaStatus() {
      try {
        const { data } = await fetchBackendJson('/api/whatsapp/status');
        setWaStatus({
          connected: !!data?.connected,
          connecting: !!data?.connecting,
          error: data?.error || ''
        });
      } catch (e) {
        setWaStatus({ connected: false, connecting: false, error: e?.message || 'Не удалось получить статус WhatsApp' });
      }
    }

    loadWaStatus();
    const timer = window.setInterval(loadWaStatus, 4000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredCourses = useMemo(
    () => courses.filter((c) => !filters.cityId || Number(c.cityId) === Number(filters.cityId)),
    [courses, filters.cityId]
  );

  const monthItems = useMemo(
    () => items.filter((x) => (x.billingMonth || todayIso().slice(0, 7)) === selectedMonth),
    [items, selectedMonth]
  );
  const overdueTargets = useMemo(
    () => monthItems
      .filter((x) => x.paymentState === 'unpaid' && normalizePhone(x.parentPhone))
      .map((x) => ({
        id: String(x.childId),
        childId: x.childId,
        childFullName: x.childFullName,
        parentFullName: x.parentFullName || '—',
        parentPhone: normalizePhone(x.parentPhone),
        reason: x.reason || ''
      })),
    [monthItems]
  );
  const selectedTargets = useMemo(
    () => overdueTargets.filter((x) => waSelected[x.id]),
    [overdueTargets, waSelected]
  );
  const previewMessage = useMemo(
    () => renderTemplate(waTemplate, selectedTargets[0]?.childFullName || 'Имя ребенка'),
    [waTemplate, selectedTargets]
  );

  useEffect(() => {
    setWaSelected((prev) => {
      const next = {};
      overdueTargets.forEach((item) => {
        next[item.id] = prev[item.id] ?? true;
      });
      return next;
    });
  }, [overdueTargets]);

  const unpaidBlocks = useMemo(() => groupByMonthAndParent(monthItems.filter((x) => x.paymentState === 'unpaid')), [monthItems]);
  const paidBlocks = useMemo(() => groupByMonthAndParent(paidTransactions), [paidTransactions]);

  function openComment(child) {
    setCommentModal(child);
    setCommentText(child.paymentComment || '');
  }

  async function openChild(child) {
    const live = items.find((x) => Number(x.childId) === Number(child.childId));
    setChildModal({ ...(live || {}), ...child, lessonsCount: live?.lessonsCount ?? child.lessonsCount ?? 0 });
    setPayAmount('');
    setPaymentMethod('Каспи');
    setPayComment('');
    setPayDate(todayIso());
    setHistory(await api.getPaymentHistory(child.childId));
  }

  async function exportMonthlyExcel() {
    const XLSX = await import('xlsx');
    const report = await api.getMonthlyPaymentsReport({
      month: selectedMonth,
      cityId: filters.cityId || undefined,
      courseId: filters.courseId || undefined,
      groupId: filters.groupId || undefined,
      parentQuery: filters.parentQuery || undefined
    });

    const wb = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet([
      {
        Месяц: report.month,
        'Долгов (8+)': report.totals.debtsCount,
        Оплаченных: report.totals.paidCount,
        'Сумма оплат': report.totals.paidAmount,
        'Занятий всего': report.totals.totalSessions,
        'Проведено': report.totals.conductedSessions,
        Отменено: report.totals.cancelledSessions
      }
    ]);
    const debtsSheet = XLSX.utils.json_to_sheet(
      report.debts.map((x) => ({
        Ребенок: x.childFullName,
        Родитель: x.parentFullName || '—',
        Телефон: x.parentPhone || '—',
        Город: x.cityName || '—',
        Кружок: x.courseName || '—',
        Группа: x.groupName || '—',
        Посещений_после_оплаты: x.lessonsCount,
        Причина: x.reason
      }))
    );
    const txSheet = XLSX.utils.json_to_sheet(
      report.transactions.map((x) => ({
        Дата: x.paidDate,
        Ребенок: x.childFullName,
        Родитель: x.parentFullName || '—',
        Телефон: x.parentPhone || '—',
        Город: x.cityName || '—',
        Кружок: x.courseName || '—',
        Группа: x.groupName || '—',
        Сумма: x.amount || 0,
        Способ: x.paymentMethod || '—'
      }))
    );

    XLSX.utils.book_append_sheet(wb, summarySheet, 'Итоги');
    XLSX.utils.book_append_sheet(wb, debtsSheet, 'К оплате');
    XLSX.utils.book_append_sheet(wb, txSheet, 'Оплаты');
    XLSX.writeFile(wb, `otchet-oplaty-${report.month}.xlsx`);
  }

  async function exportMonthlyPdf() {
    const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const autoTableFn = autoTableModule.default;
    const report = await api.getMonthlyPaymentsReport({
      month: selectedMonth,
      cityId: filters.cityId || undefined,
      courseId: filters.courseId || undefined,
      groupId: filters.groupId || undefined,
      parentQuery: filters.parentQuery || undefined
    });

    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(15);
    doc.text(`Месячный отчет: ${report.month}`, 14, 16);
    doc.setFontSize(10);
    doc.text(`Долгов: ${report.totals.debtsCount} | Оплаченных: ${report.totals.paidCount} | Сумма оплат: ${report.totals.paidAmount}`, 14, 24);
    doc.text(
      `Занятий: всего ${report.totals.totalSessions}, проведено ${report.totals.conductedSessions}, отменено ${report.totals.cancelledSessions}`,
      14,
      31
    );

    autoTableFn(doc, {
      startY: 38,
      head: [['Ребенок', 'Родитель', 'Кружок', 'Группа', 'Посещений', 'Причина']],
      body: report.debts.map((x) => [x.childFullName, x.parentFullName || '—', x.courseName || '—', x.groupName || '—', x.lessonsCount, x.reason])
    });

    autoTableFn(doc, {
      startY: doc.lastAutoTable.finalY + 8,
      head: [['Дата', 'Ребенок', 'Родитель', 'Кружок', 'Группа', 'Сумма', 'Способ']],
      body: report.transactions.map((x) => [x.paidDate, x.childFullName, x.parentFullName || '—', x.courseName || '—', x.groupName || '—', x.amount || 0, x.paymentMethod || '—'])
    });

    doc.save(`otchet-oplaty-${report.month}.pdf`);
  }

  function PaymentBlock({ title, blocks, mode }) {
    return (
      <div className="payment-col">
        <div className="payment-col-head">{title}</div>
        {blocks.map((monthBlock) => (
          <div key={monthBlock.month} className="payment-month">
            <div className="payment-month-title">{monthTitle(monthBlock.month)}</div>
            {monthBlock.parents.map((parent) => (
              <div key={parent.parentKey} className="payment-parent-card">
                <div className="payment-parent-head">
                  <div>
                    <b>{parent.parentName}</b>
                    <div style={{ color: '#97a7c3', fontSize: 12 }}>{parent.parentPhone}</div>
                  </div>
                  {parent.children.length > 1 && <span className="badge warn">{parent.children.length} детей</span>}
                </div>

                {parent.children.map((child) => (
                  <div key={child.childId} className="payment-child-row" onClick={() => openChild(child)}>
                    <div>
                      <div>{child.childFullName}</div>
                      <div style={{ color: '#97a7c3', fontSize: 12 }}>
                        {child.courseName} / {child.groupName || 'без группы'}
                      </div>
                    </div>
                    <div className="row-actions">
                      {mode === 'unpaid' && (
                        <div className="payment-reason-badge">
                          <div>{child.reason}</div>
                          {child.paymentComment && <div className="payment-reason-comment">{child.paymentComment}</div>}
                        </div>
                      )}
                      {mode === 'paid' && <span className="badge ok">{child.paidStatusLabel}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
        {!blocks.length && <div className="panel" style={{ color: '#97a7c3' }}>Нет записей за выбранный месяц</div>}
      </div>
    );
  }

  async function sendBulkWhatsApp() {
    if (waSending) return;
    if (!waStatus.connected) {
      setError('Сначала подключите WhatsApp в разделе WhatsApp.');
      return;
    }
    if (!selectedTargets.length) {
      setError('Выберите хотя бы одного получателя для рассылки.');
      return;
    }

    setError('');
    setWaLog([]);
    setWaSending(true);
    setWaProgress({ total: selectedTargets.length, sent: 0, failed: 0, current: '' });

    let sent = 0;
    let failed = 0;

    for (let index = 0; index < selectedTargets.length; index += 1) {
      const target = selectedTargets[index];
      const text = renderTemplate(waTemplate, target.childFullName);
      setWaProgress((prev) => ({ ...prev, current: `${target.childFullName} (${target.parentPhone})` }));

      try {
        const { ok, data } = await fetchBackendJson('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: target.parentPhone,
            text
          })
        });

        if (!ok || !data?.success) {
          failed += 1;
          setWaLog((prev) => [...prev, `Ошибка: ${target.childFullName} (${target.parentPhone}) — ${data?.error || 'Ошибка отправки'}`]);
        } else {
          sent += 1;
          setWaLog((prev) => [...prev, `Отправлено: ${target.childFullName} (${target.parentPhone})`]);
        }
      } catch (e) {
        failed += 1;
        setWaLog((prev) => [...prev, `Ошибка: ${target.childFullName} (${target.parentPhone}) — ${e?.message || 'Failed to fetch'}`]);
      }

      setWaProgress((prev) => ({ ...prev, sent, failed }));

      if (index < selectedTargets.length - 1) {
        const safeInterval = Math.max(15, Number(waIntervalSec || 0));
        const jitter = Math.max(0, Number(waJitterSec || 0));
        const delayMs = (safeInterval + (jitter ? Math.floor(Math.random() * (jitter + 1)) : 0)) * 1000;
        await sleep(delayMs);
      }
    }

    setWaProgress((prev) => ({ ...prev, current: '' }));
    setWaSending(false);
  }

  return (
    <section>
      <h1 className="page-title">Оплаты</h1>
      <p className="page-subtitle">Первая оплата после 1-го занятия, затем каждая следующая оплата после 8 занятий цикла.</p>
      {error && <p style={{ color: '#ff6978' }}>{error}</p>}

      <div className="toolbar payment-toolbar">
        <select value={filters.cityId} onChange={(e) => setFilters((v) => ({ ...v, cityId: e.target.value, courseId: '', groupId: '' }))}>
          <option value="">Все города</option>
          {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filters.courseId} onChange={(e) => setFilters((v) => ({ ...v, courseId: e.target.value, groupId: '' }))}>
          <option value="">Все кружки</option>
          {filteredCourses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filters.groupId} onChange={(e) => setFilters((v) => ({ ...v, groupId: e.target.value }))}>
          <option value="">Все группы</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <input
          placeholder="Поиск родителя"
          value={filters.parentQuery}
          onChange={(e) => setFilters((v) => ({ ...v, parentQuery: e.target.value }))}
        />
      </div>

      <div className="toolbar payment-toolbar">
        <button onClick={() => setMonthOffset((v) => v - 1)}>←</button>
        <div className="month-chip">{monthTitle(selectedMonth)}</div>
        <button onClick={() => setMonthOffset((v) => v + 1)}>→</button>
        <button onClick={exportMonthlyExcel}>Отчет Excel</button>
        <button onClick={exportMonthlyPdf}>Отчет PDF</button>
      </div>

      <div className="payment-grid">
        <PaymentBlock title="К оплате" blocks={unpaidBlocks} mode="unpaid" />
        <PaymentBlock title="Оплаченные (история)" blocks={paidBlocks} mode="paid" />
      </div>

      {childModal && (
        <Modal title={`Оплата: ${childModal.childFullName}`} onClose={() => setChildModal(null)}>
          <div className="form-grid">
            <div><b>Родитель:</b><div>{childModal.parentFullName || '—'}</div></div>
            <div><b>Телефон:</b><div>{childModal.parentPhone || '—'}</div></div>
            <div><b>Кружок:</b><div>{childModal.courseName}</div></div>
            <div><b>Группа:</b><div>{childModal.groupName || '—'}</div></div>
            <div><b>Посещений после оплаты:</b><div>{childModal.lessonsCount}</div></div>
            <div><b>Текущий цикл:</b><div>{childModal.lessonsCount}/8</div></div>
            <div><b>Последняя оплата:</b><div>{childModal.txPaidDate || childModal.lastPaymentDate || '—'}</div></div>
            <div className="full"><b>Комментарий по долгу:</b><div>{childModal.paymentComment || '—'}</div></div>
          </div>

          {childModal.paymentState === 'unpaid' && (
            <div className="form-grid" style={{ marginTop: 12 }}>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Сумма оплаты (тг)</div>
                <input type="number" min="0" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="Например 30000" />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Дата оплаты</div>
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Способ оплаты</div>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="Каспи">Каспи</option>
                  <option value="Наличные">Наличные</option>
                </select>
              </label>
              <label className="full">
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Комментарий к оплате</div>
                <textarea rows={3} value={payComment} onChange={(e) => setPayComment(e.target.value)} placeholder="Наличные/перевод, детали оплаты" />
              </label>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <b>История оплат ребенка</b>
            <div className="panel" style={{ marginTop: 8, padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Сумма</th>
                    <th>Способ</th>
                    <th>Цикл (уроков)</th>
                    <th>Комментарий</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id}>
                      <td>{row.paidDate}</td>
                      <td>{Number(row.amount || 0).toLocaleString('ru-RU')}</td>
                      <td>{row.paymentMethod || '—'}</td>
                      <td>{cycleTo8(row.cycleLessons)}</td>
                      <td>{row.comment || '—'}</td>
                      <td>
                        <button
                          onClick={async () => {
                            if (!window.confirm('Отменить эту оплату?')) return;
                            try {
                              await api.cancelPaymentTransaction({ transactionId: row.id });
                              const refreshedHistory = await api.getPaymentHistory(childModal.childId);
                              setHistory(refreshedHistory);
                              const commonFilters = {
                                cityId: filters.cityId || undefined,
                                courseId: filters.courseId || undefined,
                                groupId: filters.groupId || undefined,
                                parentQuery: filters.parentQuery || undefined
                              };
                              const [freshList, freshTx] = await Promise.all([
                                api.listPayments(commonFilters),
                                api.listPaymentTransactions(commonFilters)
                              ]);
                              setItems(freshList);
                              setPaidTransactions(freshTx);
                            } catch (e) {
                              setError(e?.message || 'Не удалось отменить оплату.');
                            }
                          }}
                        >
                          Отмена
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!history.length && <tr><td colSpan={6}>История оплат пока пустая</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            {childModal.paymentState === 'unpaid' && (
              <>
                <button onClick={() => openComment(childModal)}>Комментарий</button>
                <button
                  className="primary"
                  onClick={async () => {
                    try {
                      await api.markPaymentPaid({
                        childId: childModal.childId,
                        paidDate: payDate || todayIso(),
                        amount: Number(payAmount || 0),
                        paymentMethod,
                        comment: payComment || 'Оплата отмечена вручную'
                      });
                      setChildModal(null);
                      await load();
                    } catch (e) {
                      setError(e?.message || 'Не удалось отметить оплату.');
                    }
                  }}
                >
                  Оплачено
                </button>
              </>
            )}
          </div>
        </Modal>
      )}

      {commentModal && (
        <Modal title={`Комментарий по оплате: ${commentModal.childFullName}`} onClose={() => setCommentModal(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api.savePaymentComment({
                  childId: commentModal.childId,
                  comment: commentText,
                  promisedDate: null
                });
                setCommentModal(null);
                await load();
              } catch (err) {
                setError(err?.message || 'Не удалось сохранить комментарий.');
              }
            }}
          >
            <div className="form-grid">
              <label className="full">
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Комментарий</div>
                <textarea value={commentText} onChange={(e) => setCommentText(e.target.value)} rows={4} required style={{ width: '100%' }} />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" onClick={() => setCommentModal(null)}>Отмена</button>
              <button className="primary" type="submit">Сохранить</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
