import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@renderer/api';
import Modal from '@components/Modal';

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysIso(baseIso, days = 0) {
  const base = new Date(`${baseIso}T00:00:00`);
  if (Number.isNaN(base.getTime())) return baseIso;
  base.setDate(base.getDate() + Number(days || 0));
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const day = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeDateKey(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  const isoMatch = source.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch?.[1]) return isoMatch[1];
  const ruMatch = source.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (ruMatch) return `${ruMatch[3]}-${ruMatch[2]}-${ruMatch[1]}`;
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function normalizeMonthKey(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  const m = source.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  return '';
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

function formatCycleProgress(progress, cycleLength) {
  const current = Math.max(0, Number(progress || 0));
  const total = Math.max(1, Number(cycleLength || 8));
  return `${current}/${total}`;
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
  const [commentPromisedDate, setCommentPromisedDate] = useState('');
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
  const [quickInfo, setQuickInfo] = useState('');
  const [promisedDateModal, setPromisedDateModal] = useState(null);
  const [promisedDateValue, setPromisedDateValue] = useState('');
  const payAmountRef = useRef(null);
  const payDateRef = useRef(null);
  const payMethodRef = useRef(null);

  const selectedMonth = useMemo(() => monthIso(monthOffset), [monthOffset]);
  const today = useMemo(() => todayIso(), []);
  const todayMonth = useMemo(() => today.slice(0, 7), [today]);

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

  const filteredCourses = useMemo(
    () => courses.filter((c) => !filters.cityId || Number(c.cityId) === Number(filters.cityId)),
    [courses, filters.cityId]
  );

  const monthItems = useMemo(
    () => items.filter((x) => (x.billingMonth || todayIso().slice(0, 7)) === selectedMonth),
    [items, selectedMonth]
  );
  const allUnpaidItems = useMemo(
    () => items.filter((x) => x.paymentState === 'unpaid'),
    [items]
  );
  const unpaidBlocks = useMemo(() => groupByMonthAndParent(allUnpaidItems), [allUnpaidItems]);
  const paidBlocks = useMemo(() => groupByMonthAndParent(paidTransactions), [paidTransactions]);
  const todayDueItems = useMemo(
    () => allUnpaidItems.filter((x) => {
      const key = normalizeDateKey(x.promisedDate);
      if (key) return key === today;
      const billMonth = normalizeMonthKey(x.billingMonth);
      return !billMonth || billMonth >= todayMonth;
    }),
    [allUnpaidItems, today, todayMonth]
  );
  const overdueDueItems = useMemo(
    () => allUnpaidItems.filter((x) => {
      const key = normalizeDateKey(x.promisedDate);
      if (key) return key < today;
      const billMonth = normalizeMonthKey(x.billingMonth);
      return !!billMonth && billMonth < todayMonth;
    }),
    [allUnpaidItems, today, todayMonth]
  );
  const promisedItems = useMemo(
    () => allUnpaidItems.filter((x) => {
      const key = normalizeDateKey(x.promisedDate);
      return !!key && key > today;
    }),
    [allUnpaidItems, today]
  );
  function openComment(child) {
    setCommentModal(child);
    setCommentText(child.paymentComment || '');
    setCommentPromisedDate(child.promisedDate || '');
  }

  async function openChild(child) {
    const live = items.find((x) => Number(x.childId) === Number(child.childId));
    let fullChild = null;
    if (!live) {
      try {
        fullChild = await api.getChild(child.childId);
      } catch {
        fullChild = null;
      }
    }
    setChildModal({
      ...(live || {}),
      ...child,
      lessonsCount: live?.lessonsCount ?? fullChild?.profile?.lessonsCount ?? child.lessonsCount ?? 0,
      attendedTotal: live?.attendedTotal ?? child.attendedTotal ?? 0,
      cycleLength: live?.cycleLength ?? fullChild?.profile?.cycleLength ?? child.cycleLength ?? fullChild?._meta?.cycleLength ?? 8,
      lastPaymentDate: fullChild?.profile?.lastPaymentDate || child.lastPaymentDate || live?.lastPaymentDate || null
    });
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
                          <div className="payment-reason-comment">Цикл: {formatCycleProgress(child.lessonsCount, child.cycleLength)}</div>
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

  async function quickMarkPaid(child) {
    await openChild(child);
  }

  async function quickSetPromisedDate(child) {
    const suggested = child.promisedDate || addDaysIso(todayIso(), 1);
    setPromisedDateModal(child);
    setPromisedDateValue(suggested);
  }

  async function savePromisedDateFromModal() {
    if (!promisedDateModal) return;
    if (!promisedDateValue) {
      setError('Выберите дату обещанной оплаты.');
      return;
    }
    setError('');
    setQuickInfo('');
    try {
      await api.savePaymentComment({
        childId: promisedDateModal.childId,
        comment: promisedDateModal.paymentComment || 'Обещали оплатить',
        promisedDate: promisedDateValue
      });
      setQuickInfo(`Дата оплаты обновлена: ${promisedDateModal.childFullName} → ${promisedDateValue}`);
      setPromisedDateModal(null);
      setPromisedDateValue('');
      await load();
    } catch (e) {
      setError(e?.message || 'Не удалось перенести дату оплаты.');
    }
  }

  function QuickActionsBlock({ title, rows, tone = '' }) {
    return (
      <div className={`panel payment-quick-card ${tone}`}>
        <div className="payment-quick-head">
          <b>{title}</b>
          <span>{rows.length}</span>
        </div>
        <div className="payment-quick-list">
          {rows.slice(0, 12).map((child) => (
            <div className="payment-quick-row" key={`${title}-${child.childId}`}>
              <div>
                <div>{child.childFullName}</div>
                <div style={{ color: '#97a7c3', fontSize: 12 }}>
                  {child.parentFullName || '—'} • {child.parentPhone || '—'}
                </div>
                <div style={{ color: '#97a7c3', fontSize: 12 }}>
                  {child.courseName || '—'} / {child.groupName || 'без группы'}
                </div>
                {!!child.promisedDate && (
                  <div style={{ color: '#8ec5ff', fontSize: 12 }}>Обещали: {child.promisedDate}</div>
                )}
              </div>
              <div className="row-actions" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => quickSetPromisedDate(child)}>Перенести</button>
                <button type="button" className="primary" onClick={() => quickMarkPaid(child)}>Оплачено</button>
              </div>
            </div>
          ))}
          {!rows.length && <div style={{ color: '#97a7c3' }}>Нет записей</div>}
        </div>
      </div>
    );
  }

  return (
    <section>
      <h1 className="page-title">Оплаты</h1>
      <p className="page-subtitle">Оплаты 2.0: быстрые действия по долгам, обещанным оплатам и напоминаниям.</p>
      {error && <p style={{ color: '#ff6978' }}>{error}</p>}
      {!!quickInfo && <p style={{ color: '#73e7d5' }}>{quickInfo}</p>}

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

      <div className="payment-quick-grid">
        <QuickActionsBlock title="Сегодня к оплате" rows={todayDueItems} tone="today" />
        <QuickActionsBlock title="Просрочено" rows={overdueDueItems} tone="overdue" />
        <QuickActionsBlock title="Обещали оплатить" rows={promisedItems} tone="promised" />
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
            <div><b>Занятий в текущем цикле:</b><div>{childModal.lessonsCount}</div></div>
            <div><b>Текущий цикл:</b><div>{formatCycleProgress(childModal.lessonsCount, childModal.cycleLength)}</div></div>
            <div><b>Всего посещений:</b><div>{childModal.attendedTotal || 0}</div></div>
            <div><b>Последняя оплата:</b><div>{childModal.txPaidDate || childModal.lastPaymentDate || '—'}</div></div>
          </div>

          {childModal.paymentState === 'unpaid' && (
            <div className="form-grid" style={{ marginTop: 12 }}>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Сумма оплаты (тг)</div>
                <input
                  key={`pay-amount-${childModal.childId}`}
                  ref={payAmountRef}
                  type="number"
                  min="0"
                  defaultValue={String(Number(childModal?.txAmount || 0) || '')}
                  placeholder="Например 30000"
                />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Дата оплаты</div>
                <input
                  key={`pay-date-${childModal.childId}`}
                  ref={payDateRef}
                  type="date"
                  defaultValue={todayIso()}
                />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Способ оплаты</div>
                <select key={`pay-method-${childModal.childId}`} ref={payMethodRef} defaultValue="Каспи">
                  <option value="Каспи">Каспи</option>
                  <option value="Наличные">Наличные</option>
                </select>
              </label>
              <label className="full">
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Сумма обязательна</div>
                <div style={{ color: '#97a7c3' }}>Для сохранения оплаты укажите сумму, дату и способ оплаты.</div>
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
                    <th>Посещений на момент оплаты</th>
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
                      <td>{Number(row.cycleLessons || 0)}</td>
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
                <button
                  className="primary"
                  onClick={async () => {
                    const amount = Number(payAmountRef.current?.value || 0);
                    const payDate = String(payDateRef.current?.value || '').trim();
                    const paymentMethod = String(payMethodRef.current?.value || '').trim();
                    if (!payDate || !paymentMethod || !Number.isFinite(amount) || amount <= 0) {
                      setError('Заполните сумму, дату и способ оплаты.');
                      return;
                    }
                    try {
                      await api.markPaymentPaid({
                        childId: childModal.childId,
                        paidDate: payDate || todayIso(),
                        amount,
                        paymentMethod
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
                  promisedDate: commentPromisedDate || null
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
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Обещанная дата оплаты</div>
                <input type="date" value={commentPromisedDate} onChange={(e) => setCommentPromisedDate(e.target.value)} />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" onClick={() => setCommentModal(null)}>Отмена</button>
              <button className="primary" type="submit">Сохранить</button>
            </div>
          </form>
        </Modal>
      )}

      {promisedDateModal && (
        <Modal title={`Перенести оплату: ${promisedDateModal.childFullName}`} onClose={() => setPromisedDateModal(null)}>
          <div className="form-grid">
            <label>
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Новая дата</div>
              <input
                type="date"
                value={promisedDateValue}
                onChange={(e) => setPromisedDateValue(e.target.value)}
              />
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button type="button" onClick={() => setPromisedDateModal(null)}>Отмена</button>
            <button type="button" className="primary" onClick={savePromisedDateFromModal}>Сохранить</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
